import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { AssistantMessage, Context } from "@earendil-works/pi-ai";
import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai/providers/faux";
import type { PiHistoryMessage } from "@openerx/contracts";
import { createProductPiSession, ModelRuntime } from "@openerx/pi-host";
import { ChatRepository } from "@openerx/storage";
import { afterEach, describe, expect, it } from "vitest";

interface ObservedPiEvent {
  type: "delta" | "completed" | "stopped" | "failed";
  delta?: string;
}

const temporaryDirectories: string[] = [];

function temporaryDirectory(prefix: string): string {
  const directory = mkdtempSync(path.join(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

function databasePath(): string {
  return path.join(temporaryDirectory("openerx-golden-chat-"), "chat.sqlite");
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function contentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter(
      (part): part is { type: "text"; text: string } =>
        typeof part === "object" &&
        part !== null &&
        "type" in part &&
        part.type === "text" &&
        "text" in part &&
        typeof part.text === "string",
    )
    .map(({ text }) => text)
    .join("");
}

function responseFor(context: Context): AssistantMessage {
  const userMessages = context.messages.filter(({ role }) => role === "user");
  const latestUser = contentText(userMessages.at(-1)?.content);
  const userTurns = userMessages.length;

  if (latestUser.includes("法国的首都")) return fauxAssistantMessage("巴黎。");
  if (latestUser.includes("正式邮件") || latestUser.includes("项目延期说明")) {
    return fauxAssistantMessage(
      [
        "主题：项目延期说明",
        "",
        "您好：",
        "",
        "现将项目延期说明整理如下。具体日期、人员和范围保持与原文一致，不补充未提供的信息。",
        "",
        "此致",
        "敬礼",
      ].join("\n"),
    );
  }
  if (latestUser.includes("中英双向翻译") || latestUser.includes("保留 API")) {
    return fauxAssistantMessage(
      [
        "English: OpenERX API version 2.0 supports 24 requests.",
        "中文：OpenERX API 版本 2.0 支持 24 个请求。",
      ].join("\n"),
    );
  }
  if (latestUser.includes("代码块") && latestUser.includes("表格")) {
    return fauxAssistantMessage(
      [
        "```ts",
        'const client = "OpenERX";',
        "```",
        "",
        "| 项目 | 状态 | 版本 |",
        "| --- | --- | --- |",
        "| Pi AgentSession | ready | 0.84.4 |",
      ].join("\n"),
    );
  }
  if (latestUser.includes("2000 字") || latestUser.includes("[PI_TEST_SLOW]")) {
    return fauxAssistantMessage(
      `长响应开始。${"这是用于验证停止后不再追加内容的固定段落。".repeat(80)}`,
    );
  }
  if (userTurns >= 2) {
    return fauxAssistantMessage(
      `这是第 ${userTurns} 轮回答。我仍记得当前 Pi 上下文共有 ${context.messages.length} 条消息。`,
    );
  }
  return fauxAssistantMessage(`Pi AgentSession 已收到：${latestUser}`);
}

async function runPrompt(
  history: PiHistoryMessage[],
  options: { abortAfterFirstDelta?: boolean; tokensPerSecond?: number } = {},
): Promise<{ text: string; events: ObservedPiEvent[]; activeTools: string[] }> {
  const root = temporaryDirectory("openerx-pi-golden-");
  const cwd = path.join(root, "workspace");
  const agentDir = path.join(root, "agent");
  mkdirSync(cwd, { recursive: true });
  mkdirSync(agentDir, { recursive: true });
  const modelRuntime = await ModelRuntime.create({ modelsPath: null, refreshOnCreate: false });
  const faux = fauxProvider({
    tokensPerSecond: options.tokensPerSecond ?? 10_000,
    tokenSize: { min: 1, max: 3 },
  });
  modelRuntime.registerNativeProvider(faux.provider);
  faux.setResponses([(context) => responseFor(context)]);
  const prompt = history.at(-1);
  if (prompt?.role !== "user") throw new Error("Golden prompt must end with user input");
  const { session } = await createProductPiSession({
    cwd,
    agentDir,
    history: history.slice(0, -1),
    modelRuntime,
    model: faux.getModel(),
  });
  const events: ObservedPiEvent[] = [];
  let abortRequested = false;
  const unsubscribe = session.subscribe((event) => {
    if (event.type !== "message_update" || event.assistantMessageEvent.type !== "text_delta") {
      return;
    }
    events.push({ type: "delta", delta: event.assistantMessageEvent.delta });
    if (options.abortAfterFirstDelta && !abortRequested) {
      abortRequested = true;
      void session.abort();
    }
  });
  await session.prompt(prompt.text, { expandPromptTemplates: false });
  await session.waitForIdle();
  const assistant = [...session.messages]
    .reverse()
    .find((message): message is AssistantMessage => message.role === "assistant");
  events.push({
    type:
      abortRequested || assistant?.stopReason === "aborted"
        ? "stopped"
        : assistant?.stopReason === "error"
          ? "failed"
          : "completed",
  });
  const activeTools = session.getActiveToolNames();
  unsubscribe();
  session.dispose();
  return {
    text: events
      .filter(({ type }) => type === "delta")
      .map(({ delta }) => delta)
      .join(""),
    events,
    activeTools,
  };
}

describe("M1 Pi AgentSession golden chat gates", () => {
  it("GT-CHAT-01..04 stream deterministic knowledge, email, translation and Markdown", async () => {
    const knowledge = await runPrompt([{ role: "user", text: "法国的首都是哪里？" }]);
    expect(knowledge.text).toBe("巴黎。");
    expect(knowledge.events.at(-1)?.type).toBe("completed");
    expect(knowledge.events.some(({ type }) => type === "delta")).toBe(true);
    expect(knowledge.activeTools).toEqual([]);

    const email = await runPrompt([{ role: "user", text: "改写为正式邮件，不添加事实" }]);
    expect(email.text).toContain("主题：项目延期说明");
    expect(email.text).toContain("不补充未提供的信息");

    const translation = await runPrompt([
      { role: "user", text: "中英双向翻译，保留 API、OpenERX、2.0 和 24" },
    ]);
    for (const term of ["API", "OpenERX", "2.0", "24"]) expect(translation.text).toContain(term);
    expect(translation.text).toContain("English:");
    expect(translation.text).toContain("中文：");

    const markdown = await runPrompt([{ role: "user", text: "生成 TypeScript 代码块和表格" }]);
    expect(markdown.text).toContain("```ts");
    expect(markdown.text).toContain("| 项目 | 状态 | 版本 |");
    expect(markdown.text).toContain("Pi AgentSession");
  });

  it("GT-CHAT-05 retains ten turns in Pi context", async () => {
    const history: PiHistoryMessage[] = [];
    let finalText = "";
    for (let turn = 1; turn <= 10; turn += 1) {
      history.push({ role: "user", text: `第 ${turn} 轮追问` });
      const result = await runPrompt(history);
      finalText = result.text;
      history.push({ role: "assistant", text: finalText });
    }
    expect(finalText).toContain("第 10 轮回答");
    expect(finalText).toContain("19 条消息");
  });

  it("GT-CHAT-06 aborts through AgentSession with one terminal event", async () => {
    const result = await runPrompt(
      [{ role: "user", text: "生成一篇 2000 字说明 [PI_TEST_SLOW]" }],
      { abortAfterFirstDelta: true, tokensPerSecond: 1_000 },
    );
    expect(result.events.filter(({ type }) => type === "stopped")).toHaveLength(1);
    expect(result.events.map(({ type }) => type).lastIndexOf("delta")).toBeLessThan(
      result.events.length - 1,
    );
  });

  it("GT-CHAT-07..08 retain original regeneration and edit branches", () => {
    const repository = new ChatRepository(databasePath());
    const original = repository.createGeneration({
      text: "原始问题",
      idempotencyKey: "golden-original-0001",
    });
    repository.appendPiEvent(original.receipt.assistantMessageId, {
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
    first.appendPiEvent(draft.receipt.assistantMessageId, {
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
