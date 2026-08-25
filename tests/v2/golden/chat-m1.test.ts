import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  FakeRuntimeAdapter,
  type RuntimeEvent,
  type RuntimeInputMessage,
} from "@openerx/runtime-sdk";
import { ChatRepository } from "@openerx/storage";
import { afterEach, describe, expect, it } from "vitest";

const temporaryDirectories: string[] = [];

function databasePath(): string {
  const directory = mkdtempSync(path.join(tmpdir(), "openerx-golden-chat-"));
  temporaryDirectories.push(directory);
  return path.join(directory, "chat.sqlite");
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

async function runPrompt(
  adapter: FakeRuntimeAdapter,
  history: RuntimeInputMessage[],
): Promise<{ text: string; events: RuntimeEvent[] }> {
  const handle = await adapter.start({ conversationId: crypto.randomUUID() });
  await adapter.send(handle, { assistantMessageId: crypto.randomUUID(), history });
  const events: RuntimeEvent[] = [];
  for await (const event of adapter.stream(handle)) events.push(event);
  return {
    text: events
      .filter(({ type }) => type === "delta")
      .map(({ delta }) => delta)
      .join(""),
    events,
  };
}

describe("M1 Fake Runtime golden chat gates", () => {
  it("GT-CHAT-01..04 stream deterministic knowledge, email, translation and Markdown", async () => {
    const adapter = new FakeRuntimeAdapter({ chunkDelayMs: 0 });
    const knowledge = await runPrompt(adapter, [{ role: "user", text: "法国的首都是哪里？" }]);
    expect(knowledge.text).toBe("巴黎。");
    expect(knowledge.events.at(-1)?.type).toBe("completed");
    expect(knowledge.events.some(({ type }) => type === "delta")).toBe(true);

    const email = await runPrompt(adapter, [{ role: "user", text: "改写为正式邮件，不添加事实" }]);
    expect(email.text).toContain("主题：项目延期说明");
    expect(email.text).toContain("不补充未提供的信息");

    const translation = await runPrompt(adapter, [
      { role: "user", text: "中英双向翻译，保留 API、OpenerX、2.0 和 24" },
    ]);
    for (const term of ["API", "OpenerX", "2.0", "24"]) expect(translation.text).toContain(term);
    expect(translation.text).toContain("English:");
    expect(translation.text).toContain("中文：");

    const markdown = await runPrompt(adapter, [
      { role: "user", text: "生成 TypeScript 代码块和表格" },
    ]);
    expect(markdown.text).toContain("```ts");
    expect(markdown.text).toContain("| 项目 | 状态 | 版本 |");
  });

  it("GT-CHAT-05 retains ten turns and reports observable context size", async () => {
    const adapter = new FakeRuntimeAdapter({ chunkDelayMs: 0 });
    const history: RuntimeInputMessage[] = [];
    let finalText = "";
    for (let turn = 1; turn <= 10; turn += 1) {
      history.push({ role: "user", text: `第 ${turn} 轮追问` });
      const result = await runPrompt(adapter, history);
      finalText = result.text;
      history.push({ role: "assistant", text: finalText });
    }
    expect(finalText).toContain("第 10 轮回答");
    expect(finalText).toContain("19 条上下文消息");
  });

  it("GT-CHAT-06 stops with exactly one terminal event and no later delta", async () => {
    const adapter = new FakeRuntimeAdapter({ chunkDelayMs: 1 });
    const handle = await adapter.start({ conversationId: crypto.randomUUID() });
    await adapter.send(handle, {
      assistantMessageId: crypto.randomUUID(),
      history: [{ role: "user", text: "生成一篇 2000 字说明 [FAKE_SLOW]" }],
    });
    const events: RuntimeEvent[] = [];
    for await (const event of adapter.stream(handle)) {
      events.push(event);
      if (event.type === "delta") await adapter.stop(handle);
    }
    expect(events.filter(({ type }) => type === "stopped")).toHaveLength(1);
    expect(events.map(({ type }) => type).lastIndexOf("delta")).toBeLessThan(events.length - 1);
  });

  it("GT-CHAT-07..08 retain original regeneration and edit branches", () => {
    const repository = new ChatRepository(databasePath());
    const original = repository.createGeneration({
      text: "原始问题",
      idempotencyKey: "golden-original-0001",
    });
    repository.appendRuntimeEvent(original.receipt.assistantMessageId, {
      eventId: crypto.randomUUID(),
      sequence: 1,
      occurredAt: new Date().toISOString(),
      type: "completed",
    });
    const regenerated = repository.regenerateGeneration({
      conversationId: original.receipt.conversationId,
      assistantMessageId: original.receipt.assistantMessageId,
      idempotencyKey: "golden-regenerate-0001",
    });
    expect(regenerated.receipt.assistantMessageId).not.toBe(original.receipt.assistantMessageId);
    repository.activateBranch(original.receipt.conversationId, original.receipt.branchId);
    expect(
      repository.getConversation(original.receipt.conversationId).messages[0]?.parts[0]?.text,
    ).toBe("原始问题");
    const edited = repository.editGeneration({
      conversationId: original.receipt.conversationId,
      messageId: original.receipt.userMessageId as string,
      text: "编辑后的问题",
      idempotencyKey: "golden-edit-0001",
    });
    expect(repository.getConversation(original.receipt.conversationId).branches).toHaveLength(3);
    expect(edited.receipt.branchId).not.toBe(original.receipt.branchId);
    repository.close();
  });

  it("GT-CHAT-09 restores ordered history from the same profile database", () => {
    const file = databasePath();
    const first = new ChatRepository(file);
    const draft = first.createGeneration({
      text: "重启测试",
      idempotencyKey: "golden-restart-0001",
    });
    first.appendRuntimeEvent(draft.receipt.assistantMessageId, {
      eventId: crypto.randomUUID(),
      sequence: 1,
      occurredAt: new Date().toISOString(),
      type: "delta",
      delta: "部分输出",
    });
    const beforeIds = first
      .getConversation(draft.receipt.conversationId)
      .messages.map(({ id }) => id);
    first.close();
    const reopened = new ChatRepository(file);
    reopened.recoverInterrupted();
    const snapshot = reopened.getConversation(draft.receipt.conversationId);
    expect(snapshot.messages.map(({ id }) => id)).toEqual(beforeIds);
    expect(snapshot.messages.at(-1)).toMatchObject({
      status: "failed",
      errorCode: "APP_SERVICE_RESTARTED",
    });
    reopened.close();
  });

  it("GT-CHAT-10 keeps search, archive and one deletion tombstone consistent", () => {
    const repository = new ChatRepository(databasePath());
    const draft = repository.createGeneration({
      text: "可搜索的火星计划",
      idempotencyKey: "golden-delete-0001",
    });
    expect(repository.search("火星计划")).toHaveLength(1);
    repository.setConversationArchived(draft.receipt.conversationId, true);
    expect(repository.search("火星计划")).toHaveLength(0);
    expect(repository.search("火星计划", true)).toHaveLength(1);
    repository.deleteConversation(draft.receipt.conversationId);
    repository.deleteConversation(draft.receipt.conversationId);
    expect(repository.search("火星计划", true)).toHaveLength(0);
    expect(
      repository
        .listEvents(draft.receipt.conversationId, 0)
        .filter(({ type }) => type === "conversation.deleted"),
    ).toHaveLength(1);
    repository.close();
  });
});
