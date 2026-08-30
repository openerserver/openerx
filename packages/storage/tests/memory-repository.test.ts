import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { MemoryRepository } from "../src";

const directories: string[] = [];

function databasePath(): string {
  const directory = mkdtempSync(path.join(tmpdir(), "openerx-memory-"));
  directories.push(directory);
  return path.join(directory, "memory.sqlite");
}

function ids() {
  let sequence = 1;
  return () => `00000000-0000-4000-8000-${String(sequence++).padStart(12, "0")}`;
}

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe("MemoryRepository", () => {
  it("is opt-in, deduplicates explicit writes, recalls them, and forgets them", () => {
    const repository = new MemoryRepository(databasePath(), {
      now: () => "2026-08-30T00:00:00.000Z",
      idFactory: ids(),
    });
    expect(repository.settings()).toMatchObject({
      memoriesEnabled: false,
      useMemories: false,
      generateMemories: false,
      syncMemories: false,
    });
    expect(() =>
      repository.upsert({
        kind: "preference",
        content: "先给结论，再给必要细节。",
        idempotencyKey: "memory-disabled-0001",
      }),
    ).toThrow("MEMORY_DISABLED");

    repository.updateSettings({ memoriesEnabled: true, useMemories: true });
    const first = repository.upsert({
      kind: "preference",
      content: "先给结论，再给必要细节。",
      idempotencyKey: "memory-upsert-0001",
    });
    const replay = repository.upsert({
      kind: "preference",
      content: "先给结论，再给必要细节。",
      idempotencyKey: "memory-upsert-0001",
    });
    const deduplicated = repository.upsert({
      kind: "preference",
      content: "先给结论，再给必要细节。",
      idempotencyKey: "memory-upsert-0002",
    });

    expect(replay).toEqual(first);
    expect(deduplicated.id).toBe(first.id);
    expect(deduplicated.revision).toBe(2);
    expect(repository.list({ status: "active", limit: 50 })).toHaveLength(1);
    expect(repository.recall("请给我一个方案")).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: first.id, kind: "preference" })]),
    );

    const deleted = repository.delete({
      memoryId: first.id,
      idempotencyKey: "memory-delete-0001",
    });
    expect(deleted.status).toBe("deleted");
    expect(repository.recall("请给我一个方案")).toEqual([]);
    repository.close();
  });

  it("rejects credentials and other secret-shaped content", () => {
    const repository = new MemoryRepository(databasePath());
    repository.updateSettings({ memoriesEnabled: true });
    for (const content of [
      "api_key=sk-abcdefghijklmnop",
      "验证码 123456",
      "-----BEGIN PRIVATE KEY-----",
      "cookie=session-secret-value",
      "身份证号 310101199001011234",
      "银行卡号 6222 0000 0000 0000",
      "项目路径 C:\\Users\\alice\\secret",
    ]) {
      expect(() =>
        repository.upsert({
          kind: "profile",
          content,
          idempotencyKey: `sensitive-${content.length}-${content.charCodeAt(0)}`,
        }),
      ).toThrow("MEMORY_SENSITIVE_CONTENT_REJECTED");
    }
    repository.close();
  });

  it("enforces the eight-item and estimated 1,200-token recall budget for Chinese text", () => {
    const repository = new MemoryRepository(databasePath(), { idFactory: ids() });
    repository.updateSettings({ memoriesEnabled: true, useMemories: true });
    for (const [index, suffix] of ["甲", "乙"].entries()) {
      repository.upsert({
        kind: "preference",
        content: `${"偏".repeat(800)}${suffix}`,
        idempotencyKey: `memory-budget-${index}-0001`,
      });
    }
    expect(repository.recall("偏好")).toHaveLength(1);
    repository.close();
  });

  it("supports chat-level recall overrides, editing, search, category clear, and source clear", () => {
    const repository = new MemoryRepository(databasePath(), { idFactory: ids() });
    const sourceConversationId = "10000000-0000-4000-8000-000000000010";
    const otherConversationId = "10000000-0000-4000-8000-000000000011";
    repository.updateSettings({ memoriesEnabled: true, useMemories: true });
    const preference = repository.upsert({
      kind: "preference",
      content: "回答时先给结论。",
      sourceConversationId,
      idempotencyKey: "memory-management-pref-0001",
    });
    const workflow = repository.upsert({
      kind: "workflow",
      content: "修改代码后运行类型检查。",
      sourceConversationId: otherConversationId,
      idempotencyKey: "memory-management-flow-0001",
    });

    expect(repository.search("类型检查")).toEqual([expect.objectContaining({ id: workflow.id })]);
    const edited = repository.upsert({
      id: preference.id,
      kind: "preference",
      content: "回答时先给结论，再给必要细节。",
      idempotencyKey: "memory-management-edit-0001",
    });
    expect(edited).toMatchObject({ id: preference.id, revision: 2 });

    repository.updateConversationSettings({
      conversationId: sourceConversationId,
      useMemories: false,
      generateMemories: false,
    });
    expect(repository.recall("结论", 8, 1_200, sourceConversationId)).toEqual([]);
    expect(repository.recall("结论", 8, 1_200, otherConversationId)).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: preference.id })]),
    );

    expect(repository.clear("memory-category-clear-0001", "workflow").deleted).toBe(1);
    expect(repository.get(workflow.id).status).toBe("deleted");
    expect(
      repository.deleteBySourceConversation(sourceConversationId, "memory-source-clear-0001")
        .deleted,
    ).toBe(1);
    expect(repository.get(preference.id).status).toBe("deleted");
    repository.close();
  });

  it("queues account-scoped settings, upserts, and tombstones for sync", () => {
    const file = databasePath();
    const repository = new MemoryRepository(file, {
      ownerProfileId: "10000000-0000-4000-8000-000000000001",
      deviceId: "20000000-0000-4000-8000-000000000002",
      idFactory: ids(),
    });
    repository.updateSettings({ memoriesEnabled: true, useMemories: true, syncMemories: true });
    repository.updateConversationSettings({
      conversationId: "30000000-0000-4000-8000-000000000003",
      useMemories: false,
    });
    const memory = repository.upsert({
      kind: "workflow",
      content: "修改代码后运行类型检查。",
      idempotencyKey: "memory-sync-upsert-0001",
    });
    repository.delete({ memoryId: memory.id, idempotencyKey: "memory-sync-delete-0001" });
    repository.close();

    const database = new DatabaseSync(file, { readOnly: true });
    const rows = database
      .prepare("SELECT object_type, mutation FROM sync_outbox ORDER BY created_at, rowid")
      .all() as Array<{ object_type: string; mutation: string }>;
    expect(rows).toEqual([
      { object_type: "memory_settings", mutation: "upsert" },
      { object_type: "memory_conversation_settings", mutation: "upsert" },
      { object_type: "memory_entry", mutation: "upsert" },
      { object_type: "memory_entry", mutation: "delete" },
    ]);
    database.close();
  });

  it("uploads existing local memories when sync is enabled and publishes the disable state", () => {
    const file = databasePath();
    const repository = new MemoryRepository(file, {
      ownerProfileId: "10000000-0000-4000-8000-000000000001",
      deviceId: "20000000-0000-4000-8000-000000000002",
      idFactory: ids(),
    });
    repository.updateSettings({ memoriesEnabled: true, useMemories: true });
    const memory = repository.upsert({
      kind: "profile",
      content: "用户常驻上海。",
      idempotencyKey: "memory-local-before-sync-0001",
    });
    expect(memory.status).toBe("active");
    repository.updateSettings({ syncMemories: true });
    repository.updateSettings({ syncMemories: false });
    repository.close();

    const database = new DatabaseSync(file, { readOnly: true });
    const rows = database
      .prepare("SELECT object_type, object_id, payload_json FROM sync_outbox ORDER BY rowid")
      .all() as Array<{ object_type: string; object_id: string; payload_json: string }>;
    expect(rows.map(({ object_type, object_id }) => ({ object_type, object_id }))).toEqual([
      { object_type: "memory_settings", object_id: "10000000-0000-4000-8000-000000000001" },
      { object_type: "memory_entry", object_id: memory.id },
      { object_type: "memory_settings", object_id: "10000000-0000-4000-8000-000000000001" },
    ]);
    expect(JSON.parse(rows.at(-1)?.payload_json ?? "{}")).toMatchObject({
      syncMemories: false,
    });
    database.close();
  });
});
