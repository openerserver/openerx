import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { getCurrentTools } from "@earendil-works/pi-ai";
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai/providers/faux";
import { piHostContractVersion } from "@openerx/contracts";
import { describe, expect, it } from "vitest";
import { ModelRuntime } from "../src/agent-session";
import { startPiHostProcess } from "../src/host";

type Frame = { kind: string; [key: string]: unknown };

async function runHost(
  nativeToolsEnabled: boolean,
  code: string,
  handleRequest?: (frame: Frame, port: EventEmitter) => void,
) {
  const root = mkdtempSync(path.join(tmpdir(), "openerx-native-host-"));
  const parent = new EventEmitter();
  const frames: Frame[] = [];
  let resolveTerminal!: (frame: Frame) => void;
  const terminal = new Promise<Frame>((resolve) => {
    resolveTerminal = resolve;
  });
  const port = Object.assign(new EventEmitter(), {
    postMessage(frame: Frame) {
      frames.push(frame);
      if (frame.kind === "pi.tool.request" || frame.kind === "pi.file-tool.request") {
        queueMicrotask(() => handleRequest?.(frame, port));
      }
      if (frame.kind === "pi.product-event" && frame.type !== "delta") resolveTerminal(frame);
    },
    start() {},
  });
  const runtime = await ModelRuntime.create({
    modelsPath: null,
    authPath: path.join(root, "auth.json"),
    refreshOnCreate: false,
  });
  const faux = fauxProvider({ tokensPerSecond: 10_000 });
  runtime.registerNativeProvider(faux.provider);
  let declared: string[] = [];
  faux.setResponses([
    (context) => {
      declared = getCurrentTools(context.messages).map(({ name }) => name);
      return nativeToolsEnabled
        ? fauxAssistantMessage(fauxToolCall("codemode", { code }))
        : fauxAssistantMessage("Default mode complete.");
    },
    fauxAssistantMessage("Native mode complete."),
  ]);
  startPiHostProcess(parent as unknown as Electron.ParentPort, {
    modelRuntime: runtime,
    model: faux.getModel(),
  });
  parent.emit("message", {
    data: {
      kind: "pi-host.bootstrap",
      contractVersion: piHostContractVersion,
      nonce: "a".repeat(64),
      profileDirectory: root,
    },
    ports: [port],
  });
  port.emit("message", {
    data: {
      kind: "pi.session.prompt",
      generationId: randomUUID(),
      conversationId: randomUUID(),
      branchId: randomUUID(),
      assistantMessageId: randomUUID(),
      history: [{ role: "user", text: "Run controlled tools." }],
      nativeToolsEnabled,
      availableToolNames: ["openerx_calculate", "openerx_file_list"],
      initialToolNames: [],
    },
  });
  try {
    const result = await terminal;
    return { frames, declared, result };
  } finally {
    port.emit("close");
    parent.removeAllListeners();
    rmSync(root, { recursive: true, force: true });
  }
}

describe("native tools through the product Host", () => {
  it("keeps native tools absent by default", async () => {
    const { declared, frames, result } = await runHost(false, "text(1)");
    expect(declared).not.toContain("codemode");
    expect(declared).not.toContain("tool_search");
    expect(result.type).toBe("completed");
    expect(frames.filter((frame) => frame.kind === "pi.tool.request")).toEqual([]);
  });

  it("dispatches a nested computation through IPC with its real parent id", async () => {
    const { frames, declared, result } = await runHost(
      true,
      'const result = await tools.openerx_calculate({expression:"1+1"}); text(result);',
      (frame, port) =>
        port.emit("message", {
          data: {
            kind: "pi.tool.response",
            requestId: frame.requestId,
            ok: true,
            data: {
              summary: "2",
              content: [],
              data: { value: 2 },
              sources: [],
              artifacts: [],
              sideEffectCommitted: false,
              durationMs: 1,
            },
          },
        }),
    );
    expect(declared).toEqual(expect.arrayContaining(["codemode", "tool_search"]));
    expect(result.type).toBe("completed");
    const requests = frames.filter((frame) => frame.kind === "pi.tool.request");
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      toolName: "openerx_calculate",
      parentToolCallId: expect.any(String),
    });
  });

  it("propagates a script timeout to both capability and attachment requests", async () => {
    const { frames, result } = await runHost(
      true,
      '// @options: {"timeout_ms":250}\nawait Promise.all([tools.openerx_calculate({expression:"1+1"}), tools.openerx_file_list({})]);',
    );
    expect(result.type).toBe("completed");
    const requests = frames.filter((frame) =>
      ["pi.tool.request", "pi.file-tool.request"].includes(frame.kind),
    );
    expect(requests).toHaveLength(2);
    const cancels = frames.filter((frame) => frame.kind === "pi.tool.cancel");
    expect(cancels.map((frame) => frame.requestId).sort()).toEqual(
      requests.map((frame) => frame.requestId).sort(),
    );
    expect(requests.every((frame) => typeof frame.parentToolCallId === "string")).toBe(true);
  });
});
