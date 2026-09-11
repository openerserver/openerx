import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { ChatAppService, MessagePortPiHostClient, ToolAppService } from "@openerx/app-service";
import {
  type GenerationReceipt,
  type PiModelUsageFrame,
  piHostContractVersion,
} from "@openerx/contracts";
import { startPiHostProcess } from "@openerx/pi-host/host";
import { ChatRepository, ToolRepository } from "@openerx/storage";
import { afterEach, describe, expect, it, vi } from "vitest";

const cleanups: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const close of cleanups.splice(0).reverse()) await close();
  vi.unstubAllGlobals();
});
const selectedModelRef = "platform/byok";
const byok = {
  apiKey: "fixture-private-key",
  baseUrl: "https://fixture.invalid/v1",
  modelId: "fixture-model",
  displayName: "Fixture",
  contextWindow: 32_000,
  maxOutputTokens: 1024,
  capabilities: { imageInput: false, functionCalling: true, reasoning: false },
};

function response(text: string, totalTokens = 21, tool = false) {
  const chunk = {
    model: "fixture-model",
    choices: [
      {
        index: 0,
        delta: tool
          ? {
              tool_calls: [
                {
                  index: 0,
                  id: "call_plan",
                  type: "function",
                  function: {
                    name: "openerx_update_plan",
                    arguments: JSON.stringify({
                      items: [{ text: "fixture", status: "completed" }],
                    }),
                  },
                },
              ],
            }
          : { content: text },
        finish_reason: tool ? "tool_calls" : "stop",
      },
    ],
    usage: {
      prompt_tokens: 20,
      prompt_cache_hit_tokens: 5,
      completion_tokens: totalTokens - 20,
      total_tokens: totalTokens,
    },
  };
  return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`, {
    headers: { "content-type": "text/event-stream" },
  });
}

async function fixture(fetcher: typeof fetch) {
  vi.stubGlobal("fetch", fetcher);
  const root = mkdtempSync(path.join(tmpdir(), "openerx-byok-chain-"));
  cleanups.push(() => rmSync(root, { recursive: true, force: true }));
  const databasePath = path.join(root, "openerx.sqlite");
  const appPort = Object.assign(new EventEmitter(), {
    postMessage(data: unknown) {
      queueMicrotask(() => hostPort.emit("message", { data }));
    },
    start() {},
  });
  const frames: unknown[] = [];
  const hostPort = Object.assign(new EventEmitter(), {
    postMessage(data: unknown) {
      frames.push(data);
      queueMicrotask(() => appPort.emit("message", { data }));
    },
    start() {},
  });
  const nonce = "a".repeat(64);
  const pi = new MessagePortPiHostClient(appPort as unknown as Electron.MessagePortMain, nonce);
  const parentPort = new EventEmitter();
  startPiHostProcess(parentPort as unknown as Electron.ParentPort);
  parentPort.emit("message", {
    data: {
      kind: "pi-host.bootstrap",
      contractVersion: piHostContractVersion,
      nonce,
      profileDirectory: root,
    },
    ports: [hostPort],
  });
  await pi.ready();
  const chat = new ChatRepository(databasePath, {
    ownerProfileId: "profile-a",
    selectedModelRef,
    thinkingLevel: "off",
  });
  const tools = new ToolRepository(databasePath, { ownerProfileId: "profile-a" });
  const toolService = new ToolAppService({
    repository: tools,
    workspaceDirectory: root,
    defaultWorkspaceDirectory: path.join(root, "workspace"),
    host: {
      availability: async () => ({ availableToolNames: [], unavailableReasons: {} }),
      execute: async () => {
        throw new Error("unused");
      },
      resolve: async () => "fixture",
    },
    resolveUploadPath: () => {
      throw new Error("unused");
    },
    ingestDownload: async () => {
      throw new Error("unused");
    },
    selectedModelRef: () => selectedModelRef,
    emit: () => {},
  });
  const service = new ChatAppService(chat, pi, null, null, toolService);
  service.initialize();
  cleanups.push(async () => {
    hostPort.emit("close");
    service.close();
    await new Promise<void>((resolve) => setImmediate(resolve));
  });
  return { chat, tools, service, pi, appPort, frames };
}

describe("BYOK provider to Desktop storage chain", () => {
  it("persists separate calls across a real Pi tool loop and exposes the local query", async () => {
    const fetcher = vi
      .fn()
      .mockImplementationOnce(async () => response("", 21, true))
      .mockImplementationOnce(async () => response("finished", 22));
    const { service, tools } = await fixture(fetcher);
    const receipt = (await service.handle(
      { command: "chat.send", input: { text: "fixture", idempotencyKey: randomUUID() } },
      undefined,
      byok,
    )) as GenerationReceipt;
    await vi.waitFor(() =>
      expect(tools.byokUsage({ messageId: receipt.assistantMessageId }).records).toHaveLength(2),
    );
    const result = (await service.handle({
      command: "usage.byok.list",
      input: { messageId: receipt.assistantMessageId },
    })) as ReturnType<ToolRepository["byokUsage"]>;
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(result.selectedModelRef).toBe(selectedModelRef);
    expect(result.records.map(({ totalTokens }) => totalTokens)).toEqual([21, 22]);
    const run = tools.run(result.records[0]?.runId ?? "");
    expect(run).toMatchObject({
      status: "completed",
      usageRecords: [{ totalTokens: 21 }, { totalTokens: 22 }],
    });
    expect(JSON.stringify(result)).not.toContain(byok.apiKey);
  });

  it("preserves earlier consumption when a later call fails and stores the classified error", async () => {
    const fetcher = vi
      .fn()
      .mockImplementationOnce(async () => response("", 21, true))
      .mockImplementationOnce(async () =>
        Response.json(
          { error: { code: "invalid_api_key", message: `invalid ${byok.apiKey}` } },
          { status: 401 },
        ),
      );
    const { service, tools, chat, appPort, frames } = await fixture(fetcher);
    const receipt = (await service.handle(
      { command: "chat.send", input: { text: "fixture", idempotencyKey: randomUUID() } },
      undefined,
      byok,
    )) as GenerationReceipt;
    await vi.waitFor(() =>
      expect(tools.byokUsage({ messageId: receipt.assistantMessageId }).records).toHaveLength(2),
    );
    const records = tools.byokUsage({ messageId: receipt.assistantMessageId }).records;
    expect(records[1]).toMatchObject({
      status: "failed",
      totalTokens: null,
      failure: { code: "MODEL_AUTHENTICATION_FAILED" },
    });
    expect(tools.run(records[0]?.runId ?? "")).toMatchObject({
      status: "failed",
      errorCode: "MODEL_AUTHENTICATION_FAILED",
      usageRecords: [{ totalTokens: 21 }, { totalTokens: null }],
    });
    const snapshot = chat.getConversation(receipt.conversationId);
    expect(snapshot.messages.find(({ id }) => id === receipt.assistantMessageId)?.errorCode).toBe(
      "MODEL_AUTHENTICATION_FAILED",
    );
    const replay = frames.find(
      (frame): frame is PiModelUsageFrame => (frame as PiModelUsageFrame).kind === "pi.model-usage",
    );
    appPort.emit("message", { data: replay });
    expect(tools.byokUsage().records).toHaveLength(2);
  });

  it("records background extraction and clustering through the same accounting channel", async () => {
    const { pi, chat, tools } = await fixture(
      vi
        .fn()
        .mockImplementationOnce(async () => response('{"candidates":[]}'))
        .mockImplementationOnce(async () => response('{"proposals":[]}')),
    );
    const generation = chat.createGeneration({ text: "fixture", idempotencyKey: randomUUID() });
    const extraction = await pi.extractMemories({
      kind: "pi.memory.extract",
      requestId: randomUUID(),
      jobId: randomUUID(),
      conversationId: generation.receipt.conversationId,
      sourceAssistantMessageId: generation.receipt.assistantMessageId,
      messages: [
        { messageId: randomUUID(), text: "first fixture source" },
        { messageId: randomUUID(), text: "second fixture source" },
      ],
      thinkingLevel: "off",
      selectedModelRef,
      byok,
    });
    expect(extraction.ok).toBe(true);
    const clustering = await pi.clusterMemories({
      kind: "pi.memory.cluster",
      requestId: randomUUID(),
      runId: randomUUID(),
      memories: [
        { id: randomUUID(), kind: "preference", content: "first fixture memory" },
        { id: randomUUID(), kind: "preference", content: "second fixture memory" },
      ],
      thinkingLevel: "off",
      selectedModelRef,
      byok,
    });
    expect(clustering.ok).toBe(true);
    expect(tools.byokUsage().records.map(({ operation }) => operation)).toEqual([
      "memory_extraction",
      "memory_clustering",
    ]);
  });
});
