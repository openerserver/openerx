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
  it("runs memory extraction as a no-tool in-memory Pi task with strict candidates", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "openerx-pi-memory-extract-"));
    temporaryDirectories.push(root);
    const parentPort = new EventEmitter();
    let resolveResult!: (frame: unknown) => void;
    const result = new Promise<unknown>((resolve) => {
      resolveResult = resolve;
    });
    const piPort = Object.assign(new EventEmitter(), {
      sent: [] as unknown[],
      postMessage(frame: unknown): void {
        this.sent.push(frame);
        if (
          typeof frame === "object" &&
          frame !== null &&
          "kind" in frame &&
          frame.kind === "pi.memory.extract-result"
        ) {
          resolveResult(frame);
        }
      },
      start(): void {},
    });
    const modelRuntime = await ModelRuntime.create({ modelsPath: null, refreshOnCreate: false });
    const faux = fauxProvider({ tokensPerSecond: 10_000 });
    modelRuntime.registerNativeProvider(faux.provider);
    const sourceMessageId = randomUUID();
    const relatedMemoryId = randomUUID();
    faux.setResponses([
      fauxAssistantMessage(
        JSON.stringify({
          candidates: [
            {
              kind: "preference",
              content: "用户希望先给结论。",
              retrievalKeys: ["结论"],
              conflictKey: "response.structure",
              confidence: 0.93,
              sourceMessageId,
              semanticRelation: "duplicate",
              relatedMemoryId,
            },
          ],
        }),
      ),
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
    const requestId = randomUUID();
    piPort.emit("message", {
      data: {
        kind: "pi.memory.extract",
        requestId,
        jobId: randomUUID(),
        conversationId: randomUUID(),
        sourceAssistantMessageId: randomUUID(),
        messages: [
          { messageId: sourceMessageId, text: "我希望回答先给结论。" },
          { messageId: randomUUID(), text: "这是第二条足够长的用户消息，用于满足抽取资格。" },
        ],
        existingMemories: [
          {
            id: relatedMemoryId,
            kind: "preference",
            content: "用户偏好结论优先。",
            conflictKey: null,
          },
        ],
      },
    });

    await expect(result).resolves.toMatchObject({
      kind: "pi.memory.extract-result",
      requestId,
      ok: true,
      output: {
        candidates: [
          expect.objectContaining({ sourceMessageId, relatedMemoryId, confidence: 0.93 }),
        ],
      },
    });
    expect(
      piPort.sent.some(
        (frame) =>
          typeof frame === "object" &&
          frame !== null &&
          "kind" in frame &&
          frame.kind === "pi.tool.request",
      ),
    ).toBe(false);
  });

  it("runs historical memory clustering as a no-tool review task", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "openerx-pi-memory-cluster-"));
    temporaryDirectories.push(root);
    const parentPort = new EventEmitter();
    let resolveResult!: (frame: unknown) => void;
    const result = new Promise<unknown>((resolve) => {
      resolveResult = resolve;
    });
    const piPort = Object.assign(new EventEmitter(), {
      sent: [] as unknown[],
      postMessage(frame: unknown): void {
        this.sent.push(frame);
        if (
          typeof frame === "object" &&
          frame !== null &&
          "kind" in frame &&
          frame.kind === "pi.memory.cluster-result"
        ) {
          resolveResult(frame);
        }
      },
      start(): void {},
    });
    const modelRuntime = await ModelRuntime.create({ modelsPath: null, refreshOnCreate: false });
    const faux = fauxProvider({ tokensPerSecond: 10_000 });
    modelRuntime.registerNativeProvider(faux.provider);
    const leftMemoryId = randomUUID();
    const rightMemoryId = randomUUID();
    faux.setResponses([
      fauxAssistantMessage(
        JSON.stringify({
          proposals: [
            {
              relation: "duplicate",
              leftMemoryId,
              rightMemoryId,
              confidence: 0.94,
            },
          ],
        }),
      ),
    ]);
    startPiHostProcess(parentPort as unknown as Electron.ParentPort, {
      modelRuntime,
      model: faux.getModel(),
    });
    parentPort.emit("message", {
      data: {
        kind: "pi-host.bootstrap",
        contractVersion: piHostContractVersion,
        nonce: "e".repeat(64),
        profileDirectory: root,
      },
      ports: [piPort],
    });
    const requestId = randomUUID();
    piPort.emit("message", {
      data: {
        kind: "pi.memory.cluster",
        requestId,
        runId: randomUUID(),
        memories: [
          { id: leftMemoryId, kind: "preference", content: "用户希望先给结论。" },
          { id: rightMemoryId, kind: "preference", content: "用户偏好结论优先。" },
        ],
      },
    });

    await expect(result).resolves.toMatchObject({
      kind: "pi.memory.cluster-result",
      requestId,
      ok: true,
      output: {
        proposals: [expect.objectContaining({ leftMemoryId, rightMemoryId, confidence: 0.94 })],
      },
    });
    expect(
      piPort.sent.some(
        (frame) =>
          typeof frame === "object" &&
          frame !== null &&
          "kind" in frame &&
          frame.kind === "pi.tool.request",
      ),
    ).toBe(false);
  });

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

  it("stops an active stream without draining queued steer or follow-up model rounds", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "openerx-pi-host-queued-abort-"));
    temporaryDirectories.push(root);
    type ObservedFrame = { kind: string; [key: string]: unknown };
    class FakePort extends EventEmitter {
      readonly sent: ObservedFrame[] = [];
      postMessage(frame: ObservedFrame): void {
        this.sent.push(frame);
        this.emit("sent", frame);
      }
      start(): void {}
      waitFor(predicate: (frame: ObservedFrame) => boolean): Promise<ObservedFrame> {
        const existing = this.sent.find(predicate);
        if (existing) return Promise.resolve(existing);
        return new Promise((resolve, reject) => {
          const received = (frame: ObservedFrame) => {
            if (!predicate(frame)) return;
            clearTimeout(timer);
            this.removeListener("sent", received);
            resolve(frame);
          };
          const timer = setTimeout(() => {
            this.removeListener("sent", received);
            reject(new Error("Pi stream/control did not settle within 1500 ms"));
          }, 1500);
          this.on("sent", received);
        });
      }
    }
    const parentPort = new EventEmitter();
    const piPort = new FakePort();
    const modelRuntime = await ModelRuntime.create({ modelsPath: null, refreshOnCreate: false });
    const faux = fauxProvider({ tokensPerSecond: 200, tokenSize: { min: 4, max: 4 } });
    modelRuntime.registerNativeProvider(faux.provider);
    let modelCalls = 0;
    faux.setResponses([
      () => {
        modelCalls += 1;
        return fauxAssistantMessage("active streaming output ".repeat(100));
      },
      () => {
        modelCalls += 1;
        return fauxAssistantMessage("QUEUED_STEERING_MUST_NOT_START");
      },
      () => {
        modelCalls += 1;
        return fauxAssistantMessage("QUEUED_FOLLOW_UP_MUST_NOT_START");
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
        nonce: "f".repeat(64),
        profileDirectory: root,
      },
      ports: [piPort],
    });
    const generationId = randomUUID();
    const control = (action: "steer" | "follow_up" | "abort", text?: string) => {
      const requestId = randomUUID();
      piPort.emit("message", {
        data: {
          kind: "pi.session.control",
          requestId,
          generationId,
          action,
          ...(text === undefined ? {} : { text }),
        },
      });
      return piPort.waitFor(
        (frame) => frame.kind === "pi.session.control-result" && frame.requestId === requestId,
      );
    };
    try {
      piPort.emit("message", {
        data: {
          kind: "pi.session.prompt",
          generationId,
          conversationId: randomUUID(),
          branchId: randomUUID(),
          assistantMessageId: randomUUID(),
          history: [{ role: "user", text: "Start a stream so I can interrupt it." }],
        },
      });
      await piPort.waitFor(
        (frame) =>
          frame.kind === "pi.product-event" &&
          frame.generationId === generationId &&
          frame.type === "delta",
      );
      await expect(control("steer", "Queued steering before stop.")).resolves.toMatchObject({
        ok: true,
      });
      await expect(control("follow_up", "Queued follow-up before stop.")).resolves.toMatchObject({
        ok: true,
      });
      expect(modelCalls).toBe(1);

      // These arrive while abort is still settling. They must not refill the
      // queues after Stop has cleared them and before its ACK is posted.
      const abortResult = control("abort");
      const lateSteer = control("steer", "Must be refused after Stop.");
      const lateFollowUp = control("follow_up", "Must also be refused after Stop.");
      await expect(abortResult).resolves.toMatchObject({ ok: true });
      await expect(lateSteer).resolves.toMatchObject({
        ok: false,
        errorCode: "PI_GENERATION_NOT_ACTIVE",
      });
      await expect(lateFollowUp).resolves.toMatchObject({
        ok: false,
        errorCode: "PI_GENERATION_NOT_ACTIVE",
      });
      await piPort.waitFor(
        (frame) =>
          frame.kind === "pi.product-event" &&
          frame.generationId === generationId &&
          frame.type === "stopped",
      );
      const settledFrameCount = piPort.sent.length;
      await new Promise((resolve) => setTimeout(resolve, 150));
      expect(piPort.sent).toHaveLength(settledFrameCount);
      expect(modelCalls).toBe(1);
      expect(
        piPort.sent.filter(
          (frame) => frame.kind === "pi.activity-event" && frame.type === "model.started",
        ),
      ).toHaveLength(1);
      expect(
        piPort.sent.filter(
          (frame) => frame.kind === "pi.product-event" && frame.type !== "delta",
        ),
      ).toEqual([expect.objectContaining({ generationId, type: "stopped" })]);
      expect(JSON.stringify(piPort.sent)).not.toContain("QUEUED_");
    } finally {
      piPort.emit("close");
      parentPort.removeAllListeners();
    }
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
      (context) => {
        expect(context.systemPrompt).toContain("plan of distinct evidence angles");
        expect(context.systemPrompt).toContain("search count itself is not the stopping criterion");
        return fauxAssistantMessage(
          `Pi context messages: ${context.messages.length}; response: 巴黎。`,
        );
      },
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
        [
          fauxText("开始执行。"),
          fauxToolCall("openerx_update_plan", {
            explanation: "Implement then verify",
            items: [
              { text: "Implement", status: "in_progress" },
              { text: "Verify", status: "pending" },
            ],
          }),
        ],
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

    const deltaEvents = piPort.sent.filter(
      (frame): frame is { delta: string; startsNewPart?: boolean } =>
        typeof frame === "object" &&
        frame !== null &&
        "kind" in frame &&
        frame.kind === "pi.product-event" &&
        "type" in frame &&
        frame.type === "delta" &&
        "delta" in frame &&
        typeof frame.delta === "string",
    );
    const boundaryIndex = deltaEvents.findIndex((event) => event.startsNewPart === true);
    expect(boundaryIndex).toBeGreaterThan(0);
    expect(
      deltaEvents
        .slice(0, boundaryIndex)
        .map(({ delta }) => delta)
        .join(""),
    ).toBe("开始执行。");
    expect(
      deltaEvents
        .slice(boundaryIndex)
        .map(({ delta }) => delta)
        .join(""),
    ).toBe("Plan accepted.");
    expect(deltaEvents.filter((event) => event.startsNewPart)).toHaveLength(1);

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
