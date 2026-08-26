import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai/providers/faux";
import { afterEach, describe, expect, it } from "vitest";
import { createProductPiSession, ModelRuntime } from "../src/agent-session";
import { startPiHostProcess } from "../src/host";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("Pi AgentSession composition", () => {
  it("places prompt-frame images into the Pi user message content", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "openerx-pi-host-vision-"));
    temporaryDirectories.push(root);
    const parentPort = new EventEmitter();
    let observedUserContent: unknown;
    let resolveTerminal!: () => void;
    const terminal = new Promise<void>((resolve) => {
      resolveTerminal = resolve;
    });
    const piPort = Object.assign(new EventEmitter(), {
      sent: [] as unknown[],
      postMessage(frame: unknown): void {
        this.sent.push(frame);
        if (
          typeof frame === "object" &&
          frame !== null &&
          "kind" in frame &&
          frame.kind === "pi.product-event" &&
          "type" in frame &&
          frame.type === "completed"
        ) {
          resolveTerminal();
        }
      },
      start(): void {},
    });
    const modelRuntime = await ModelRuntime.create({ modelsPath: null, refreshOnCreate: false });
    const faux = fauxProvider({ tokensPerSecond: 10_000 });
    modelRuntime.registerNativeProvider(faux.provider);
    faux.setResponses([
      (context) => {
        observedUserContent = context.messages.at(-1)?.content;
        return fauxAssistantMessage("视觉输入已接收。");
      },
    ]);
    startPiHostProcess(parentPort as unknown as Electron.ParentPort, {
      modelRuntime,
      model: faux.getModel(),
    });
    parentPort.emit("message", {
      data: {
        kind: "pi-host.bootstrap",
        contractVersion: 1,
        nonce: "b".repeat(64),
        profileDirectory: root,
      },
      ports: [piPort],
    });
    const generationId = randomUUID();
    piPort.emit("message", {
      data: {
        kind: "pi.session.prompt",
        generationId,
        conversationId: randomUUID(),
        assistantMessageId: randomUUID(),
        history: [{ role: "user", text: "图片里有什么？" }],
        images: [
          {
            personalFileId: randomUUID(),
            displayName: "fixture.png",
            data: "aW1hZ2U=",
            mimeType: "image/png",
          },
        ],
      },
    });
    await terminal;

    expect(observedUserContent).toEqual([
      { type: "text", text: "图片里有什么？" },
      { type: "image", data: "aW1hZ2U=", mimeType: "image/png" },
    ]);
  });

  it("uses Pi session state, native events and the Pi tool registry", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "openerx-pi-host-"));
    temporaryDirectories.push(root);
    const cwd = path.join(root, "workspace");
    const agentDir = path.join(root, "agent");
    mkdirSync(cwd, { recursive: true });
    mkdirSync(agentDir, { recursive: true });
    const modelRuntime = await ModelRuntime.create({ modelsPath: null, refreshOnCreate: false });
    const faux = fauxProvider({ tokensPerSecond: 10_000 });
    modelRuntime.registerNativeProvider(faux.provider);
    faux.setResponses([
      (context) =>
        fauxAssistantMessage(`Pi context messages: ${context.messages.length}; response: 巴黎。`),
    ]);
    const { session } = await createProductPiSession({
      cwd,
      agentDir,
      history: [
        { role: "user", text: "第一问" },
        { role: "assistant", text: "第一答" },
      ],
      modelRuntime,
      model: faux.getModel(),
    });
    const deltas: string[] = [];
    const eventTypes: string[] = [];
    const unsubscribe = session.subscribe((event) => {
      eventTypes.push(event.type);
      if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
        deltas.push(event.assistantMessageEvent.delta);
      }
    });
    await session.prompt("法国的首都是哪里？", { expandPromptTemplates: false });
    await session.waitForIdle();

    expect(deltas.join("")).toBe("Pi context messages: 3; response: 巴黎。");
    expect(eventTypes).toContain("agent_end");
    expect(eventTypes).toContain("agent_settled");
    expect(session.getActiveToolNames()).toEqual([]);
    expect(session.messages).toHaveLength(4);
    unsubscribe();
    session.dispose();
  });

  it("fails explicitly when the production host has no Platform Model Provider", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "openerx-pi-host-unconfigured-"));
    temporaryDirectories.push(root);
    const parentPort = new EventEmitter();
    const piPort = Object.assign(new EventEmitter(), {
      sent: [] as unknown[],
      postMessage(frame: unknown): void {
        this.sent.push(frame);
      },
      start(): void {},
    });

    startPiHostProcess(parentPort as unknown as Electron.ParentPort);
    parentPort.emit("message", {
      data: {
        kind: "pi-host.bootstrap",
        contractVersion: 1,
        nonce: "a".repeat(64),
        profileDirectory: root,
      },
      ports: [piPort],
    });
    const generationId = randomUUID();
    piPort.emit("message", {
      data: {
        kind: "pi.session.prompt",
        generationId,
        conversationId: randomUUID(),
        assistantMessageId: randomUUID(),
        history: [{ role: "user", text: "不得使用本地或固定回答模型" }],
      },
    });
    await new Promise((resolve) => setImmediate(resolve));

    expect(piPort.sent).toContainEqual(
      expect.objectContaining({
        kind: "pi.product-event",
        generationId,
        type: "failed",
        errorCode: "PI_MODEL_NOT_CONFIGURED",
      }),
    );
  });
});
