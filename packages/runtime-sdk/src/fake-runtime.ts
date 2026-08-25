import { randomUUID } from "node:crypto";
import type {
  RuntimeAdapter,
  RuntimeCapabilities,
  RuntimeEvent,
  RuntimeHandle,
  RuntimeInput,
  RuntimeStartInput,
  RuntimeUsage,
} from "./types";

interface FakeSession {
  controller: AbortController;
  events: RuntimeEvent[];
  inputCharacters: number;
  outputCharacters: number;
  started: boolean;
  terminal: boolean;
  waiters: Set<() => void>;
}

export interface FakeRuntimeOptions {
  chunkDelayMs?: number;
  now?: () => string;
}

function splitIntoChunks(text: string, size: number): string[] {
  const characters = Array.from(text);
  const chunks: string[] = [];
  for (let index = 0; index < characters.length; index += size) {
    chunks.push(characters.slice(index, index + size).join(""));
  }
  return chunks;
}

function responseFor(input: RuntimeInput): string {
  const latestUser = [...input.history].reverse().find(({ role }) => role === "user")?.text ?? "";
  const userTurns = input.history.filter(({ role }) => role === "user").length;

  if (latestUser.includes("法国的首都")) {
    return "巴黎。";
  }
  if (latestUser.includes("正式邮件") || latestUser.includes("项目延期说明")) {
    return [
      "主题：项目延期说明",
      "",
      "您好：",
      "",
      "现将项目延期说明整理如下。具体日期、人员和范围保持与原文一致，不补充未提供的信息。",
      "",
      "此致",
      "敬礼",
    ].join("\n");
  }
  if (latestUser.includes("中英双向翻译") || latestUser.includes("保留 API")) {
    return [
      "English: OpenerX API version 2.0 supports 24 requests.",
      "中文：OpenerX API 版本 2.0 支持 24 个请求。",
    ].join("\n");
  }
  if (latestUser.includes("代码块") && latestUser.includes("表格")) {
    return [
      "```ts",
      'const client = "OpenerX";',
      "```",
      "",
      "| 项目 | 状态 | 版本 |",
      "| --- | --- | --- |",
      "| Fake Runtime | ready | v1 |",
    ].join("\n");
  }
  if (latestUser.includes("2000 字") || latestUser.includes("[FAKE_SLOW]")) {
    return `长响应开始。${"这是用于验证停止后不再追加内容的固定段落。".repeat(80)}`;
  }
  if (userTurns >= 2) {
    return `这是第 ${userTurns} 轮回答。我仍记得当前对话共有 ${input.history.length} 条上下文消息。`;
  }
  return `Fake Runtime 已收到：${latestUser}\n\n这是可恢复、可停止的流式响应。`;
}

export class FakeRuntimeAdapter implements RuntimeAdapter {
  readonly id = "fake-runtime/v1";
  readonly #chunkDelayMs: number;
  readonly #now: () => string;
  readonly #sessions = new Map<string, FakeSession>();
  readonly #failedPrompts = new Set<string>();

  constructor(options: FakeRuntimeOptions = {}) {
    this.#chunkDelayMs = options.chunkDelayMs ?? 12;
    this.#now = options.now ?? (() => new Date().toISOString());
  }

  async capabilities(): Promise<RuntimeCapabilities> {
    return {
      text: true,
      streaming: true,
      stop: true,
      recovery: false,
      usage: true,
      files: false,
      tools: false,
      permissions: false,
    };
  }

  async start(_input: RuntimeStartInput): Promise<RuntimeHandle> {
    const handle = { id: randomUUID() };
    this.#sessions.set(handle.id, {
      controller: new AbortController(),
      events: [],
      inputCharacters: 0,
      outputCharacters: 0,
      started: false,
      terminal: false,
      waiters: new Set(),
    });
    return handle;
  }

  async send(handle: RuntimeHandle, input: RuntimeInput): Promise<void> {
    const session = this.#session(handle);
    if (session.started) {
      throw new Error("Fake Runtime handle already has an active input");
    }
    session.started = true;
    session.inputCharacters = input.history.reduce(
      (total, message) => total + message.text.length,
      0,
    );
    const response = responseFor(input);
    const chunks = splitIntoChunks(response, response.length > 500 ? 8 : 5);
    const latestText = input.history.at(-1)?.text ?? "";
    const shouldFail = latestText.includes("[FAKE_FAIL]") && !this.#failedPrompts.has(latestText);
    if (shouldFail) this.#failedPrompts.add(latestText);

    void this.#run(session, chunks, shouldFail);
  }

  async stop(handle: RuntimeHandle): Promise<void> {
    const session = this.#session(handle);
    if (session.terminal) {
      return;
    }
    session.controller.abort();
    this.#append(session, { type: "stopped" });
  }

  async replyPermission(_handle: RuntimeHandle, _reply: unknown): Promise<void> {
    throw new Error("Fake Runtime does not support permissions");
  }

  async *stream(handle: RuntimeHandle, cursor = "0"): AsyncIterable<RuntimeEvent> {
    const session = this.#session(handle);
    let index = Number.parseInt(cursor, 10);
    if (!Number.isSafeInteger(index) || index < 0) {
      throw new Error(`Invalid Fake Runtime cursor: ${cursor}`);
    }

    while (true) {
      while (index < session.events.length) {
        const event = session.events[index];
        index += 1;
        if (event) {
          yield event;
        }
      }
      if (session.terminal) {
        return;
      }
      await new Promise<void>((resolve) => session.waiters.add(resolve));
    }
  }

  async usage(handle: RuntimeHandle): Promise<RuntimeUsage> {
    const session = this.#session(handle);
    return {
      inputCharacters: session.inputCharacters,
      outputCharacters: session.outputCharacters,
    };
  }

  async dispose(handle: RuntimeHandle): Promise<void> {
    const session = this.#sessions.get(handle.id);
    session?.controller.abort();
    if (session) {
      for (const resolve of session.waiters) resolve();
    }
    this.#sessions.delete(handle.id);
  }

  async #run(session: FakeSession, chunks: string[], shouldFail: boolean): Promise<void> {
    for (let index = 0; index < chunks.length; index += 1) {
      if (!(await this.#delay(session.controller.signal))) {
        return;
      }
      const delta = chunks[index];
      if (!delta || session.terminal) {
        return;
      }
      session.outputCharacters += delta.length;
      this.#append(session, { type: "delta", delta });
      if (shouldFail && index === 1) {
        this.#append(session, { type: "failed", errorCode: "FAKE_RUNTIME_FAILURE" });
        return;
      }
    }
    if (!session.terminal) {
      this.#append(session, { type: "completed" });
    }
  }

  async #delay(signal: AbortSignal): Promise<boolean> {
    if (signal.aborted) return false;
    return await new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        signal.removeEventListener("abort", onAbort);
        resolve(true);
      }, this.#chunkDelayMs);
      const onAbort = () => {
        clearTimeout(timer);
        resolve(false);
      };
      signal.addEventListener("abort", onAbort, { once: true });
    });
  }

  #append(
    session: FakeSession,
    event: Pick<RuntimeEvent, "type"> & Partial<Pick<RuntimeEvent, "delta" | "errorCode">>,
  ): void {
    if (session.terminal) {
      return;
    }
    const next: RuntimeEvent = {
      eventId: randomUUID(),
      sequence: session.events.length + 1,
      occurredAt: this.#now(),
      type: event.type,
      ...(event.delta === undefined ? {} : { delta: event.delta }),
      ...(event.errorCode === undefined ? {} : { errorCode: event.errorCode }),
    };
    session.events.push(next);
    if (next.type !== "delta") {
      session.terminal = true;
    }
    for (const resolve of session.waiters) resolve();
    session.waiters.clear();
  }

  #session(handle: RuntimeHandle): FakeSession {
    const session = this.#sessions.get(handle.id);
    if (!session) {
      throw new Error(`Unknown Fake Runtime handle: ${handle.id}`);
    }
    return session;
  }
}
