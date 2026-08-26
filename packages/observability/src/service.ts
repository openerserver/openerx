import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import {
  type DiagnosticsPreview,
  diagnosticsPreviewSchema,
  type LocalExportResult,
  type PerformanceMetric,
  redactSensitiveText,
} from "@openerx/contracts";
import { atomicJsonExport } from "./personal-data";

export interface DiagnosticEventInput {
  source: "desktop" | "app_service" | "pi_host" | "remote" | "renderer";
  level: "info" | "warning" | "error";
  code: string;
  attributes?: Record<string, unknown>;
}

interface DiagnosticEvent extends DiagnosticEventInput {
  occurredAt: string;
}

const sensitiveKeys =
  /(?:prompt|response|message|content|diff|terminal|screenshot|path|token|secret|password|authorization|cookie|credential|key)/iu;
const localPathPattern = /(?:\/[A-Za-z0-9._~ -]+){2,}|[A-Za-z]:\\(?:[^\\\r\n]+\\)+[^\\\r\n]*/gu;
const maximumLogBytes = 1024 * 1024;

function redactValue(value: unknown, key = ""): unknown {
  if (sensitiveKeys.test(key)) return "[REDACTED]";
  if (typeof value === "string") {
    return redactSensitiveText(value).replace(localPathPattern, "[LOCAL_PATH]").slice(0, 2_048);
  }
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => redactValue(item));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .slice(0, 50)
        .map(([entryKey, entryValue]) => [entryKey, redactValue(entryValue, entryKey)]),
    );
  }
  return value;
}

export class PerformanceBudgetTracker {
  readonly #startedAt: number;
  readonly #now: () => number;
  readonly #rss: () => number;
  #desktopInteractiveAt: number | null = null;
  #appServiceReadyAt: number | null = null;

  constructor(
    startedAt: number,
    now: () => number = () => performance.now(),
    rss: () => number = () => process.memoryUsage().rss,
  ) {
    this.#startedAt = startedAt;
    this.#now = now;
    this.#rss = rss;
  }

  markDesktopInteractive(): void {
    this.#desktopInteractiveAt ??= this.#now();
  }

  markAppServiceReady(): void {
    this.#appServiceReadyAt ??= this.#now();
  }

  snapshot(): PerformanceMetric[] {
    return [
      this.#durationMetric("desktop_interactive", this.#desktopInteractiveAt, 5_000),
      this.#durationMetric("app_service_ready", this.#appServiceReadyAt, 5_000),
      this.#metric("idle_rss", this.#rss() / 1024 / 1024, "mib", 512),
    ];
  }

  #durationMetric(
    name: "desktop_interactive" | "app_service_ready",
    end: number | null,
    budget: number,
  ): PerformanceMetric {
    if (end === null) return { name, value: 0, unit: "ms", budget, status: "pending" };
    return this.#metric(name, Math.max(0, end - this.#startedAt), "ms", budget);
  }

  #metric(
    name: PerformanceMetric["name"],
    value: number,
    unit: PerformanceMetric["unit"],
    budget: number,
  ): PerformanceMetric {
    return {
      name,
      value: Math.round(value * 10) / 10,
      unit,
      budget,
      status: value <= budget ? "pass" : "over_budget",
    };
  }
}

export class DiagnosticsService {
  readonly #logPath: string;
  readonly #performance: PerformanceBudgetTracker;
  readonly #now: () => Date;

  constructor(
    logPath: string,
    performance: PerformanceBudgetTracker,
    now: () => Date = () => new Date(),
  ) {
    this.#logPath = logPath;
    this.#performance = performance;
    this.#now = now;
    mkdirSync(path.dirname(logPath), { recursive: true });
  }

  record(input: DiagnosticEventInput): void {
    const event: DiagnosticEvent = {
      ...input,
      attributes: redactValue(input.attributes ?? {}) as Record<string, unknown>,
      occurredAt: this.#now().toISOString(),
    };
    appendFileSync(this.#logPath, `${JSON.stringify(event)}\n`, { encoding: "utf8", mode: 0o600 });
    this.#trimLog();
  }

  preview(): DiagnosticsPreview {
    const events = this.#events();
    const performance = this.#performance.snapshot();
    const errorCount = events.filter(({ level }) => level === "error").length;
    const warningCount = events.filter(({ level }) => level === "warning").length;
    const restartCount = events.filter(({ code }) => code === "service.restarting").length;
    const collecting = performance.some(({ status }) => status === "pending");
    return diagnosticsPreviewSchema.parse({
      generatedAt: this.#now().toISOString(),
      health:
        errorCount > 0 || performance.some(({ status }) => status === "over_budget")
          ? "attention"
          : collecting
            ? "collecting"
            : "ready",
      eventCount: events.length,
      errorCount,
      warningCount,
      restartCount,
      firstEventAt: events[0]?.occurredAt ?? null,
      lastEventAt: events.at(-1)?.occurredAt ?? null,
      sources: [...new Set(events.map(({ source }) => source))].sort(),
      performance,
      includes: ["应用版本与运行平台", "脱敏生命周期事件", "启动与内存预算结果"],
      excludes: ["对话与 Prompt 正文", "文件、Diff、终端和截图内容", "本地路径与全部凭证"],
    });
  }

  export(destinationPath: string, runtime: Record<string, unknown>): LocalExportResult {
    return atomicJsonExport(
      destinationPath,
      "diagnostics",
      {
        format: "openerx.diagnostics.v1",
        preview: this.preview(),
        runtime: redactValue(runtime),
        events: this.#events(),
      },
      this.#now,
    );
  }

  #events(): DiagnosticEvent[] {
    if (!existsSync(this.#logPath) || statSync(this.#logPath).size === 0) return [];
    return readFileSync(this.#logPath, "utf8")
      .split("\n")
      .filter(Boolean)
      .slice(-1_000)
      .flatMap((line) => {
        try {
          return [JSON.parse(line) as DiagnosticEvent];
        } catch {
          return [];
        }
      });
  }

  #trimLog(): void {
    if (statSync(this.#logPath).size <= maximumLogBytes) return;
    const lines = readFileSync(this.#logPath, "utf8").split("\n").filter(Boolean);
    const selected: string[] = [];
    let bytes = 0;
    for (const line of lines.reverse()) {
      const lineBytes = Buffer.byteLength(line) + 1;
      if (selected.length >= 1_000 || bytes + lineBytes > maximumLogBytes / 2) break;
      selected.push(line);
      bytes += lineBytes;
    }
    writeFileSync(this.#logPath, `${selected.reverse().join("\n")}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
  }
}

export { redactValue as redactDiagnosticValue };
