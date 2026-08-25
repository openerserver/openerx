import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { PiHostEventFrame, PiPromptFrame } from "@openerx/contracts";
import { ChatRepository } from "@openerx/storage";
import { afterEach, describe, expect, it } from "vitest";
import { ChatAppService, type PiHostClient } from "../src";

interface TestGeneration {
  controller: AbortController;
  sequence: number;
  terminal: boolean;
}

class ScriptedPiHostClient implements PiHostClient {
  readonly #listeners = new Set<(event: PiHostEventFrame) => void>();
  readonly #generations = new Map<string, TestGeneration>();
  readonly #failedPrompts = new Set<string>();

  async prompt(frame: PiPromptFrame): Promise<void> {
    const generation: TestGeneration = {
      controller: new AbortController(),
      sequence: 0,
      terminal: false,
    };
    this.#generations.set(frame.generationId, generation);
    void this.#run(frame, generation);
  }

  async abort(generationId: string): Promise<void> {
    const generation = this.#generations.get(generationId);
    if (!generation) return;
    generation.controller.abort();
    this.#emit(generationId, generation, { type: "stopped" });
  }

  onEvent(listener: (event: PiHostEventFrame) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  async #run(frame: PiPromptFrame, generation: TestGeneration): Promise<void> {
    const prompt = frame.history.at(-1)?.text ?? "";
    const shouldFail = prompt.includes("[PI_TEST_FAIL]") && !this.#failedPrompts.has(prompt);
    if (shouldFail) this.#failedPrompts.add(prompt);
    const response = this.#response(frame);
    const chunks = Array.from({ length: Math.ceil(response.length / 5) }, (_, index) =>
      response.slice(index * 5, index * 5 + 5),
    );
    for (let index = 0; index < chunks.length; index += 1) {
      await new Promise((resolve) => setTimeout(resolve, 1));
      if (generation.controller.signal.aborted || generation.terminal) return;
      this.#emit(frame.generationId, generation, { type: "delta", delta: chunks[index] });
      if (shouldFail && index === 1) {
        this.#emit(frame.generationId, generation, {
          type: "failed",
          errorCode: "PI_TEST_PROVIDER_FAILURE",
        });
        return;
      }
    }
    this.#emit(frame.generationId, generation, { type: "completed" });
  }

  #response(frame: PiPromptFrame): string {
    const prompt = frame.history.at(-1)?.text ?? "";
    if (prompt.includes("法国的首都")) return "巴黎。";
    if (prompt.includes("2000 字") || prompt.includes("[PI_TEST_SLOW]")) {
      return "这是用于验证停止后不再追加内容的固定段落。".repeat(80);
    }
    return `Pi AgentSession 已收到：${prompt}`;
  }

  #emit(
    generationId: string,
    generation: TestGeneration,
    event: Pick<PiHostEventFrame, "type"> & Partial<Pick<PiHostEventFrame, "delta" | "errorCode">>,
  ): void {
    if (generation.terminal) return;
    generation.sequence += 1;
    const frame: PiHostEventFrame = {
      kind: "pi.product-event",
      generationId,
      eventId: crypto.randomUUID(),
      sequence: generation.sequence,
      occurredAt: new Date().toISOString(),
      type: event.type,
      ...(event.delta === undefined ? {} : { delta: event.delta }),
      ...(event.errorCode === undefined ? {} : { errorCode: event.errorCode }),
    };
    if (event.type !== "delta") {
      generation.terminal = true;
      this.#generations.delete(generationId);
    }
    for (const listener of this.#listeners) listener(frame);
  }
}

const temporaryDirectories: string[] = [];

function createService(): ChatAppService {
  const directory = mkdtempSync(path.join(tmpdir(), "openerx-app-service-"));
  temporaryDirectories.push(directory);
  return new ChatAppService(
    new ChatRepository(path.join(directory, "chat.sqlite")),
    new ScriptedPiHostClient(),
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
  it("projects Pi Host events into durable conversation state", async () => {
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

  it("stops a long generation without accepting later Pi deltas", async () => {
    const service = createService();
    const receipt = (await service.handle({
      command: "chat.send",
      input: {
        conversationId: null,
        text: "写 2000 字 [PI_TEST_SLOW]",
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
        text: "请失败 [PI_TEST_FAIL]",
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
