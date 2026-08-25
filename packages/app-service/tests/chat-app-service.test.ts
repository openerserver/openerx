import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { RuntimeEventFrame, RuntimeStartFrame } from "@openerx/contracts";
import { FakeRuntimeAdapter, type RuntimeHandle } from "@openerx/runtime-sdk";
import { ChatRepository } from "@openerx/storage";
import { afterEach, describe, expect, it } from "vitest";
import { ChatAppService, type RuntimeClient } from "../src";

class AdapterRuntimeClient implements RuntimeClient {
  readonly #adapter = new FakeRuntimeAdapter({ chunkDelayMs: 1 });
  readonly #listeners = new Set<(event: RuntimeEventFrame) => void>();
  readonly #handles = new Map<string, RuntimeHandle>();

  async start(frame: RuntimeStartFrame): Promise<void> {
    const handle = await this.#adapter.start({ conversationId: frame.conversationId });
    this.#handles.set(frame.generationId, handle);
    await this.#adapter.send(handle, {
      assistantMessageId: frame.assistantMessageId,
      history: frame.history,
    });
    void this.#pump(frame.generationId, handle);
  }

  async stop(generationId: string): Promise<void> {
    const handle = this.#handles.get(generationId);
    if (handle) await this.#adapter.stop(handle);
  }

  onEvent(listener: (event: RuntimeEventFrame) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  async #pump(generationId: string, handle: RuntimeHandle): Promise<void> {
    for await (const event of this.#adapter.stream(handle)) {
      const frame: RuntimeEventFrame = { kind: "runtime.event", generationId, ...event };
      for (const listener of this.#listeners) listener(frame);
    }
  }
}

const temporaryDirectories: string[] = [];

function createService(): ChatAppService {
  const directory = mkdtempSync(path.join(tmpdir(), "openerx-app-service-"));
  temporaryDirectories.push(directory);
  return new ChatAppService(
    new ChatRepository(path.join(directory, "chat.sqlite")),
    new AdapterRuntimeClient(),
  );
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

async function waitForTerminal(service: ChatAppService, conversationId: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("terminal event timeout")), 2_000);
    const unsubscribe = service.onEvent((event) => {
      if (
        event.conversationId === conversationId &&
        ["message.completed", "message.stopped", "message.failed"].includes(event.type)
      ) {
        clearTimeout(timeout);
        unsubscribe();
        resolve();
      }
    });
  });
}

describe("ChatAppService", () => {
  it("runs a typed command through Fake Runtime into durable conversation state", async () => {
    const service = createService();
    const receipt = (await service.handle({
      command: "chat.send",
      input: {
        conversationId: null,
        text: "法国的首都是哪里？",
        idempotencyKey: "service-send-0001",
      },
    })) as { conversationId: string };
    await waitForTerminal(service, receipt.conversationId);
    const snapshot = (await service.handle({
      command: "chat.get",
      input: { conversationId: receipt.conversationId },
    })) as { messages: Array<{ status: string; parts: Array<{ text: string }> }> };
    expect(snapshot.messages.at(-1)).toMatchObject({ status: "completed" });
    expect(snapshot.messages.at(-1)?.parts[0]?.text).toBe("巴黎。");
    service.close();
  });

  it("stops a long generation without accepting later runtime deltas", async () => {
    const service = createService();
    const receipt = (await service.handle({
      command: "chat.send",
      input: {
        conversationId: null,
        text: "写 2000 字 [FAKE_SLOW]",
        idempotencyKey: "service-stop-0001",
      },
    })) as { conversationId: string; assistantMessageId: string };
    await service.handle({
      command: "chat.stop",
      input: {
        conversationId: receipt.conversationId,
        assistantMessageId: receipt.assistantMessageId,
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 30));
    const snapshot = (await service.handle({
      command: "chat.get",
      input: { conversationId: receipt.conversationId },
    })) as { messages: Array<{ status: string }> };
    expect(snapshot.messages.at(-1)?.status).toBe("stopped");
    service.close();
  });

  it("fails once with partial output and completes a regeneration branch", async () => {
    const service = createService();
    const failed = (await service.handle({
      command: "chat.send",
      input: {
        conversationId: null,
        text: "请失败 [FAKE_FAIL]",
        idempotencyKey: "service-fail-0001",
      },
    })) as { conversationId: string; assistantMessageId: string };
    await waitForTerminal(service, failed.conversationId);
    const retry = (await service.handle({
      command: "chat.regenerate",
      input: {
        conversationId: failed.conversationId,
        assistantMessageId: failed.assistantMessageId,
        idempotencyKey: "service-retry-0001",
      },
    })) as { assistantMessageId: string };
    await waitForTerminal(service, failed.conversationId);
    const snapshot = (await service.handle({
      command: "chat.get",
      input: { conversationId: failed.conversationId },
    })) as { branches: unknown[]; messages: Array<{ id: string; status: string }> };
    expect(snapshot.branches).toHaveLength(2);
    expect(snapshot.messages.find(({ id }) => id === retry.assistantMessageId)?.status).toBe(
      "completed",
    );
    service.close();
  });
});
