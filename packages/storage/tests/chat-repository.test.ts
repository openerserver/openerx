import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { ChatRepository } from "../src";

const temporaryDirectories: string[] = [];

function databasePath(): string {
  const directory = mkdtempSync(path.join(tmpdir(), "openerx-storage-"));
  temporaryDirectories.push(directory);
  return path.join(directory, "chat.sqlite");
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("ChatRepository", () => {
  it("uses a configured model for a new conversation without changing the repository fallback", () => {
    const repository = new ChatRepository(databasePath(), {
      selectedModelRef: "platform/auto",
    });
    const configured = repository.createGeneration({
      text: "使用指定模型",
      idempotencyKey: "configured-model-0001",
      modelRef: "platform/pro",
    });
    const fallback = repository.createGeneration({
      text: "使用默认模型",
      idempotencyKey: "configured-model-0002",
    });

    expect(configured.selectedModelRef).toBe("platform/pro");
    expect(
      repository.getConversation(configured.receipt.conversationId).conversation.selectedModelRef,
    ).toBe("platform/pro");
    expect(fallback.selectedModelRef).toBe("platform/auto");
    repository.close();
  });

  it("persists the conversation thinking level and resolves it for each model message", () => {
    const file = databasePath();
    const repository = new ChatRepository(file);
    const draft = repository.createGeneration({
      text: "需要仔细分析",
      idempotencyKey: "thinking-send-0001",
      thinkingLevel: "high",
    });

    expect(
      repository.getConversation(draft.receipt.conversationId).conversation.thinkingLevel,
    ).toBe("high");
    expect(repository.thinkingLevelForMessage(draft.receipt.assistantMessageId)).toBe("high");
    repository.selectConversationThinkingLevel(draft.receipt.conversationId, "off");
    expect(draft.thinkingLevel).toBe("high");
    repository.close();

    const reopened = new ChatRepository(file);
    expect(reopened.getConversation(draft.receipt.conversationId).conversation.thinkingLevel).toBe(
      "off",
    );
    expect(reopened.thinkingLevelForMessage(draft.receipt.assistantMessageId)).toBe("high");
    reopened.close();
  });

  it("persists a stream and replays strictly ordered product events", () => {
    const repository = new ChatRepository(databasePath());
    const draft = repository.createGeneration({
      text: "法国的首都是哪里？",
      idempotencyKey: "send-france-0001",
    });
    repository.appendPiEvent(draft.receipt.assistantMessageId, {
      eventId: crypto.randomUUID(),
      sequence: 1,
      occurredAt: new Date().toISOString(),
      type: "delta",
      delta: "巴黎",
    });
    repository.appendPiEvent(draft.receipt.assistantMessageId, {
      eventId: crypto.randomUUID(),
      sequence: 2,
      occurredAt: new Date().toISOString(),
      type: "completed",
    });

    const snapshot = repository.getConversation(draft.receipt.conversationId);
    expect(snapshot.messages.map(({ status }) => status)).toEqual(["completed", "completed"]);
    expect(snapshot.messages.at(-1)?.parts[0]?.text).toBe("巴黎");
    const events = repository.listEvents(draft.receipt.conversationId, 0);
    expect(events.map(({ sequence }) => sequence)).toEqual([1, 2, 3, 4]);
    expect(repository.listEvents(draft.receipt.conversationId, 2)).toHaveLength(2);
    repository.close();
  });

  it("stores text from separate model rounds as separate response parts", () => {
    const repository = new ChatRepository(databasePath());
    const draft = repository.createGeneration({
      text: "分阶段完成任务",
      idempotencyKey: "multi-round-send-0001",
    });
    repository.appendPiEvent(draft.receipt.assistantMessageId, {
      eventId: crypto.randomUUID(),
      sequence: 1,
      occurredAt: new Date().toISOString(),
      type: "delta",
      delta: "先收集资料。",
    });
    repository.appendPiEvent(draft.receipt.assistantMessageId, {
      eventId: crypto.randomUUID(),
      sequence: 2,
      occurredAt: new Date().toISOString(),
      type: "delta",
      delta: "再生成报告。",
      startsNewPart: true,
    });
    repository.appendPiEvent(draft.receipt.assistantMessageId, {
      eventId: crypto.randomUUID(),
      sequence: 3,
      occurredAt: new Date().toISOString(),
      type: "completed",
    });

    const assistant = repository.getConversation(draft.receipt.conversationId).messages.at(-1);
    expect(assistant?.parts.map((part) => part.text)).toEqual(["先收集资料。", "再生成报告。"]);
    repository.close();
  });

  it("deduplicates commands and preserves older branches on edit and regeneration", () => {
    const repository = new ChatRepository(databasePath());
    const first = repository.createGeneration({
      text: "原问题",
      idempotencyKey: "branch-send-0001",
    });
    const duplicate = repository.createGeneration({
      text: "不应再次写入",
      idempotencyKey: "branch-send-0001",
    });
    expect(duplicate.created).toBe(false);
    expect(duplicate.receipt).toEqual(first.receipt);
    repository.appendPiEvent(first.receipt.assistantMessageId, {
      eventId: crypto.randomUUID(),
      sequence: 1,
      occurredAt: new Date().toISOString(),
      type: "completed",
    });

    const edited = repository.editGeneration({
      conversationId: first.receipt.conversationId,
      messageId: first.receipt.userMessageId as string,
      text: "修改后的问题",
      idempotencyKey: "branch-edit-0001",
    });
    const activeAfterEdit = repository.getConversation(first.receipt.conversationId);
    expect(activeAfterEdit.branches).toHaveLength(2);
    expect(activeAfterEdit.messages.map((message) => message.parts[0]?.text)).toEqual([
      "修改后的问题",
      "",
    ]);

    repository.appendPiEvent(edited.receipt.assistantMessageId, {
      eventId: crypto.randomUUID(),
      sequence: 1,
      occurredAt: new Date().toISOString(),
      type: "completed",
    });
    const regenerated = repository.regenerateGeneration({
      conversationId: first.receipt.conversationId,
      assistantMessageId: edited.receipt.assistantMessageId,
      idempotencyKey: "branch-regen-0001",
    });
    expect(repository.getConversation(first.receipt.conversationId).branches).toHaveLength(3);
    repository.activateBranch(first.receipt.conversationId, first.receipt.branchId);
    expect(
      repository.getConversation(first.receipt.conversationId).messages[0]?.parts[0]?.text,
    ).toBe("原问题");
    expect(regenerated.receipt.userMessageId).toBeNull();
    repository.close();
  });

  it("marks interrupted generations failed and keeps partial output after reopening", () => {
    const file = databasePath();
    const firstRepository = new ChatRepository(file);
    const draft = firstRepository.createGeneration({
      text: "长响应",
      idempotencyKey: "restart-send-0001",
    });
    firstRepository.appendPiEvent(draft.receipt.assistantMessageId, {
      eventId: crypto.randomUUID(),
      sequence: 1,
      occurredAt: new Date().toISOString(),
      type: "delta",
      delta: "部分结果",
    });
    firstRepository.close();

    const recoveredRepository = new ChatRepository(file);
    const recoveryEvents = recoveredRepository.recoverInterrupted();
    expect(recoveryEvents).toHaveLength(1);
    expect(recoveryEvents[0]?.payload.reason).toBe("APP_SERVICE_RESTARTED");
    const assistant = recoveredRepository
      .getConversation(draft.receipt.conversationId)
      .messages.at(-1);
    expect(assistant).toMatchObject({ status: "failed", errorCode: "APP_SERVICE_RESTARTED" });
    expect(assistant?.parts[0]?.text).toBe("部分结果");
    recoveredRepository.close();
  });

  it("refuses a database created by a newer application", () => {
    const file = databasePath();
    const database = new DatabaseSync(file);
    database.exec(`
      CREATE TABLE schema_migrations (
        version INTEGER PRIMARY KEY,
        checksum TEXT NOT NULL,
        applied_at TEXT NOT NULL
      ) STRICT;
      INSERT INTO schema_migrations VALUES (99, 'future', '2026-08-25T00:00:00.000Z');
    `);
    database.close();
    expect(() => new ChatRepository(file)).toThrow("newer than supported");
  });

  it("fails closed on a corrupt database instead of replacing history", () => {
    const file = databasePath();
    writeFileSync(file, "not a sqlite database", "utf8");
    expect(() => new ChatRepository(file)).toThrow();
  });

  it("stores no reusable credential or token table in the M1 database", () => {
    const file = databasePath();
    const repository = new ChatRepository(file);
    repository.close();
    const database = new DatabaseSync(file, { readOnly: true });
    const names = database
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((row) => String(row.name));
    expect(names.join(" ")).not.toMatch(/credential|password|secret|token/i);
    database.close();
  });

  it("removes local semantic-cluster cursor state when clearing the local cache", () => {
    const file = databasePath();
    const repository = new ChatRepository(file);
    const database = new DatabaseSync(file);
    database
      .prepare(
        `INSERT INTO memory_semantic_cluster_state
         (owner_profile_id, next_pair_index, completed_cycles, updated_at, revision)
         VALUES ('local-default', 3, 1, '2026-08-30T00:00:00.000Z', 4)`,
      )
      .run();
    database.close();

    repository.clearLocalCache();
    repository.close();
    const verification = new DatabaseSync(file, { readOnly: true });
    expect(
      verification.prepare("SELECT COUNT(*) AS count FROM memory_semantic_cluster_state").get(),
    ).toEqual({ count: 0 });
    verification.close();
  });
});
