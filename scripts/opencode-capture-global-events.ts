import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";

type CaptureRecord =
  | {
      kind: "meta";
      phase: "start" | "connect" | "disconnect" | "shutdown";
      ts: string;
      url: string;
      outputPath: string;
      message: string;
      reconnectAttempt?: number;
      waitMs?: number;
    }
  | {
      kind: "event";
      sequence: number;
      ts: string;
      event: string;
      id?: string;
      retry?: number;
      dataRaw: string;
      dataJson?: unknown;
    }
  | {
      kind: "comment";
      ts: string;
      comment: string;
    }
  | {
      kind: "error";
      ts: string;
      url: string;
      message: string;
      reconnectAttempt: number;
      waitMs: number;
    };

type PendingEvent = {
  event: string;
  id?: string;
  retry?: number;
  dataLines: string[];
};

const DEFAULT_RUNTIME_URL = process.env.OPENCODE_URL || "http://127.0.0.1:4096";
const DEFAULT_OUTPUT_PATH = resolve(
  process.cwd(),
  "tmp",
  `opencode-global-events-${new Date().toISOString().replaceAll(":", "-")}.jsonl`,
);

function parseArgs(argv: string[]) {
  const options = {
    url: `${DEFAULT_RUNTIME_URL.replace(/\/$/, "")}/global/event`,
    outputPath: DEFAULT_OUTPUT_PATH,
    console: true,
    maxReconnectDelayMs: 30_000,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    if ((arg === "--url" || arg === "-u") && next) {
      options.url = next;
      index += 1;
      continue;
    }

    if ((arg === "--output" || arg === "-o") && next) {
      options.outputPath = resolve(process.cwd(), next);
      index += 1;
      continue;
    }

    if (arg === "--no-console") {
      options.console = false;
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    }
  }

  return options;
}

function printUsage() {
  console.log(`Capture OpenCode runtime global SSE events into a JSONL file.

Usage:
  bun run scripts/opencode-capture-global-events.ts [options]

Options:
  -u, --url <url>        SSE endpoint to connect to
  -o, --output <path>    Output JSONL file path
      --no-console       Disable stdout mirroring
  -h, --help             Show this help

Environment:
  OPENCODE_URL           Base runtime URL, default: http://127.0.0.1:4096
`);
}

function wait(ms: number) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function tryParseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  await mkdir(dirname(options.outputPath), { recursive: true });

  const writer = createWriteStream(options.outputPath, { flags: "a" });
  let isShuttingDown = false;
  let reconnectAttempt = 0;
  let sequence = 0;
  let activeAbortController: AbortController | null = null;

  const writeRecord = async (record: CaptureRecord) => {
    const line = `${JSON.stringify(record)}\n`;
    const canContinue = writer.write(line);

    if (!options.console) {
      if (canContinue) {
        return;
      }

      await new Promise<void>((resolvePromise) => writer.once("drain", resolvePromise));
      return;
    }

    if (record.kind === "event") {
      const preview = isObject(record.dataJson)
        ? JSON.stringify(record.dataJson)
        : record.dataRaw.slice(0, 200);
      console.log(`[${record.sequence}] ${record.event} ${preview}`);
    } else if (record.kind === "comment") {
      console.log(`[comment] ${record.comment}`);
    } else if (record.kind === "error") {
      console.error(`[error] ${record.message} (retry in ${record.waitMs}ms)`);
    } else {
      console.log(`[meta] ${record.phase} ${record.message}`);
    }

    if (!canContinue) {
      await new Promise<void>((resolvePromise) => writer.once("drain", resolvePromise));
    }
  };

  const shutdown = async (signal: string) => {
    if (isShuttingDown) {
      return;
    }

    isShuttingDown = true;
    activeAbortController?.abort();
    await writeRecord({
      kind: "meta",
      phase: "shutdown",
      ts: new Date().toISOString(),
      url: options.url,
      outputPath: options.outputPath,
      message: `Received ${signal}`,
    });
    await new Promise<void>((resolvePromise, rejectPromise) => {
      writer.end((error) => {
        if (error) {
          rejectPromise(error);
          return;
        }
        resolvePromise();
      });
    });
    process.exit(0);
  };

  process.on("SIGINT", () => {
    void shutdown("SIGINT");
  });
  process.on("SIGTERM", () => {
    void shutdown("SIGTERM");
  });

  await writeRecord({
    kind: "meta",
    phase: "start",
    ts: new Date().toISOString(),
    url: options.url,
    outputPath: options.outputPath,
    message: "Starting OpenCode global event capture",
  });

  while (!isShuttingDown) {
    const abortController = new AbortController();
    activeAbortController = abortController;

    try {
      await writeRecord({
        kind: "meta",
        phase: "connect",
        ts: new Date().toISOString(),
        url: options.url,
        outputPath: options.outputPath,
        message: "Connecting to SSE endpoint",
        reconnectAttempt,
      });

      const response = await fetch(options.url, {
        headers: {
          Accept: "text/event-stream",
          "Cache-Control": "no-cache",
        },
        signal: abortController.signal,
      });

      if (!response.ok || !response.body) {
        throw new Error(`SSE connection failed with status ${response.status}`);
      }

      reconnectAttempt = 0;

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let pendingEvent: PendingEvent = {
        event: "message",
        dataLines: [],
      };

      const flushEvent = async () => {
        if (
          pendingEvent.dataLines.length === 0 &&
          !pendingEvent.id &&
          typeof pendingEvent.retry !== "number"
        ) {
          pendingEvent = { event: "message", dataLines: [] };
          return;
        }

        sequence += 1;
        const dataRaw = pendingEvent.dataLines.join("\n");
        await writeRecord({
          kind: "event",
          sequence,
          ts: new Date().toISOString(),
          event: pendingEvent.event,
          id: pendingEvent.id,
          retry: pendingEvent.retry,
          dataRaw,
          dataJson: tryParseJson(dataRaw),
        });
        pendingEvent = { event: "message", dataLines: [] };
      };

      while (!isShuttingDown) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const rawLine of lines) {
          const line = rawLine.replace(/\r$/, "");

          if (line === "") {
            await flushEvent();
            continue;
          }

          if (line.startsWith(":")) {
            await writeRecord({
              kind: "comment",
              ts: new Date().toISOString(),
              comment: line.slice(1).trim(),
            });
            continue;
          }

          const separatorIndex = line.indexOf(":");
          const field = separatorIndex === -1 ? line : line.slice(0, separatorIndex);
          const valueText =
            separatorIndex === -1 ? "" : line.slice(separatorIndex + 1).replace(/^ /, "");

          switch (field) {
            case "event":
              pendingEvent.event = valueText || "message";
              break;
            case "data":
              pendingEvent.dataLines.push(valueText);
              break;
            case "id":
              pendingEvent.id = valueText;
              break;
            case "retry": {
              const retry = Number.parseInt(valueText, 10);
              if (Number.isFinite(retry)) {
                pendingEvent.retry = retry;
              }
              break;
            }
            default:
              break;
          }
        }
      }

      if (buffer.trim().length > 0) {
        const trailingLines = buffer.split("\n");
        for (const rawLine of trailingLines) {
          const line = rawLine.replace(/\r$/, "");
          if (line.startsWith("data:")) {
            pendingEvent.dataLines.push(line.slice(5).trim());
          }
        }
      }

      await flushEvent();

      if (isShuttingDown) {
        break;
      }

      await writeRecord({
        kind: "meta",
        phase: "disconnect",
        ts: new Date().toISOString(),
        url: options.url,
        outputPath: options.outputPath,
        message: "SSE stream closed by remote peer",
      });
    } catch (error) {
      if (isShuttingDown) {
        break;
      }

      reconnectAttempt += 1;
      const waitMs = Math.min(1000 * 2 ** (reconnectAttempt - 1), options.maxReconnectDelayMs);
      await writeRecord({
        kind: "error",
        ts: new Date().toISOString(),
        url: options.url,
        message: error instanceof Error ? error.message : String(error),
        reconnectAttempt,
        waitMs,
      });
      await wait(waitMs);
    }
  }
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
