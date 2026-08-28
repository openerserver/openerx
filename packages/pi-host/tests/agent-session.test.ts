import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxText,
  fauxThinking,
  fauxToolCall,
} from "@earendil-works/pi-ai/providers/faux";
import { piHostContractVersion } from "@openerx/contracts";
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
  it("queues an abort received before the Pi session is ready", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "openerx-pi-host-early-abort-"));
    temporaryDirectories.push(root);
    const parentPort = new EventEmitter();
    let resolveTerminal!: (frame: unknown) => void;
    const terminal = new Promise<unknown>((resolve) => {
      resolveTerminal = resolve;
    });
    const controlRequestId = randomUUID();
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
          frame.type !== "delta"
        ) {
          resolveTerminal(frame);
        }
      },
      start(): void {},
    });
    const modelRuntime = await ModelRuntime.create({ modelsPath: null, refreshOnCreate: false });
    const faux = fauxProvider({ tokensPerSecond: 10_000 });
    modelRuntime.registerNativeProvider(faux.provider);
    faux.setResponses([fauxAssistantMessage("不应完成")]);
    startPiHostProcess(parentPort as unknown as Electron.ParentPort, {
      modelRuntime,
      model: faux.getModel(),
    });
    parentPort.emit("message", {
      data: {
        kind: "pi-host.bootstrap",
        contractVersion: piHostContractVersion,
        nonce: "c".repeat(64),
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
        branchId: randomUUID(),
        assistantMessageId: randomUUID(),
        history: [{ role: "user", text: "立即停止" }],
      },
    });
    piPort.emit("message", {
      data: {
        kind: "pi.session.control",
        requestId: controlRequestId,
        generationId,
        action: "abort",
      },
    });

    await expect(terminal).resolves.toMatchObject({ type: "stopped" });
    expect(piPort.sent).toContainEqual({
      kind: "pi.session.control-result",
      requestId: controlRequestId,
      ok: true,
    });
  });

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
        return fauxAssistantMessage([
          fauxThinking("PRIVATE_RAW_CHAIN_OF_THOUGHT"),
          fauxText("视觉输入已接收。"),
        ]);
      },
    ]);
    startPiHostProcess(parentPort as unknown as Electron.ParentPort, {
      modelRuntime,
      model: faux.getModel(),
    });
    parentPort.emit("message", {
      data: {
        kind: "pi-host.bootstrap",
        contractVersion: piHostContractVersion,
        nonce: "b".repeat(64),
        profileDirectory: root,
      },
      ports: [piPort],
    });
    const generationId = randomUUID();
    const branchId = randomUUID();
    piPort.emit("message", {
      data: {
        kind: "pi.session.prompt",
        generationId,
        conversationId: randomUUID(),
        branchId,
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
    expect(piPort.sent).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "pi.activity-event",
          generationId,
          type: "model.started",
          piItemRef: "model:1",
        }),
        expect.objectContaining({
          kind: "pi.activity-event",
          generationId,
          type: "model.completed",
          piItemRef: "model:1",
        }),
        expect.objectContaining({
          kind: "pi.activity-event",
          generationId,
          type: "reasoning.started",
          piItemRef: "reasoning:1:1",
        }),
        expect.objectContaining({
          kind: "pi.activity-event",
          generationId,
          type: "reasoning.completed",
          piItemRef: "reasoning:1:1",
        }),
      ]),
    );
    expect(JSON.stringify(piPort.sent)).not.toContain("PRIVATE_RAW_CHAIN_OF_THOUGHT");
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

  it("publishes typed plan updates through the internal Plan tool", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "openerx-pi-host-plan-"));
    temporaryDirectories.push(root);
    const parentPort = new EventEmitter();
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
      fauxAssistantMessage(
        fauxToolCall("openerx_update_plan", {
          explanation: "Implement then verify",
          items: [
            { text: "Implement", status: "in_progress" },
            { text: "Verify", status: "pending" },
          ],
        }),
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage("Plan accepted."),
    ]);
    startPiHostProcess(parentPort as unknown as Electron.ParentPort, {
      modelRuntime,
      model: faux.getModel(),
    });
    parentPort.emit("message", {
      data: {
        kind: "pi-host.bootstrap",
        contractVersion: piHostContractVersion,
        nonce: "d".repeat(64),
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
        branchId: randomUUID(),
        assistantMessageId: randomUUID(),
        history: [{ role: "user", text: "制定并执行计划" }],
        initialToolNames: ["openerx_update_plan"],
        availableToolNames: ["openerx_update_plan"],
      },
    });
    await terminal;

    expect(piPort.sent).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "pi.activity-event",
          generationId,
          type: "plan.updated",
          planEntries: [
            { text: "Implement", status: "in_progress" },
            { text: "Verify", status: "pending" },
          ],
          explanation: "Implement then verify",
        }),
      ]),
    );
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
        contractVersion: piHostContractVersion,
        nonce: "a".repeat(64),
        profileDirectory: root,
      },
      ports: [piPort],
    });
    const generationId = randomUUID();
    const branchId = randomUUID();
    piPort.emit("message", {
      data: {
        kind: "pi.session.prompt",
        generationId,
        conversationId: randomUUID(),
        branchId,
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
