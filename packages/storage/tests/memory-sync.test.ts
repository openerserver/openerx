import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ChatRepository, MemoryRepository } from "../src";

const directories: string[] = [];
const owner = "10000000-0000-4000-8000-000000000001";
const device = "20000000-0000-4000-8000-000000000002";
const memoryId = "30000000-0000-4000-8000-000000000003";
const conversationId = "70000000-0000-4000-8000-000000000007";
const changedAt = "2026-08-30T00:00:00.000Z";

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe("memory account sync", () => {
  it("protects explicit conflict slots and restores a synced predecessor on tombstone", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "openerx-memory-conflict-sync-"));
    directories.push(directory);
    const file = path.join(directory, "sync.sqlite");
    const chat = new ChatRepository(file, { ownerProfileId: owner, deviceId: device });
    const memories = new MemoryRepository(file, { ownerProfileId: owner, deviceId: device });
    memories.updateSettings({ memoriesEnabled: true });
    const localExplicit = memories.upsert({
      kind: "preference",
      content: "用户明确要求中文回复。",
      conflictKey: "response.language",
      idempotencyKey: "memory-sync-local-explicit-0001",
    });
    const automaticId = "30000000-0000-4000-8000-000000000030";
    chat.applySyncPull({
      changes: [
        {
          cursor: "cursor:1",
          accountId: owner,
          objectType: "memory_entry",
          objectId: automaticId,
          revision: 1,
          tombstone: false,
          payloadVersion: 1,
          payload: {
            id: automaticId,
            ownerProfileId: owner,
            scope: "personal",
            kind: "preference",
            content: "用户偏好英文回复。",
            retrievalKeys: ["英文"],
            canonicalKey: "preference:automatic-english",
            conflictKey: "response.language",
            origin: "automatic",
            confidence: 0.99,
            status: "active",
            sourceConversationId: null,
            sourceMessageId: null,
            supersedesMemoryId: null,
            expiresAt: null,
            createdAt: changedAt,
            updatedAt: changedAt,
            revision: 1,
          },
          operationId: "40000000-0000-4000-8000-000000000030",
          changedAt,
          retainUntil: null,
        },
      ],
      nextCursor: "cursor:1",
    });
    expect(memories.get(localExplicit.id).status).toBe("active");
    expect(memories.get(automaticId).status).toBe("superseded");

    const remoteExplicitId = "30000000-0000-4000-8000-000000000031";
    chat.applySyncPull({
      changes: [
        {
          cursor: "cursor:2",
          accountId: owner,
          objectType: "memory_entry",
          objectId: remoteExplicitId,
          revision: 1,
          tombstone: false,
          payloadVersion: 1,
          payload: {
            id: remoteExplicitId,
            ownerProfileId: owner,
            scope: "personal",
            kind: "preference",
            content: "用户明确要求英文回复。",
            retrievalKeys: ["英文"],
            canonicalKey: "preference:explicit-english",
            conflictKey: "response.language",
            origin: "explicit",
            confidence: 1,
            status: "active",
            sourceConversationId: null,
            sourceMessageId: null,
            supersedesMemoryId: localExplicit.id,
            expiresAt: null,
            createdAt: changedAt,
            updatedAt: changedAt,
            revision: 1,
          },
          operationId: "40000000-0000-4000-8000-000000000031",
          changedAt,
          retainUntil: null,
        },
      ],
      nextCursor: "cursor:2",
    });
    expect(memories.get(localExplicit.id).status).toBe("superseded");
    expect(memories.get(remoteExplicitId).status).toBe("active");

    chat.applySyncPull({
      changes: [
        {
          cursor: "cursor:3",
          accountId: owner,
          objectType: "memory_entry",
          objectId: remoteExplicitId,
          revision: 2,
          tombstone: true,
          payloadVersion: 1,
          payload: null,
          operationId: "40000000-0000-4000-8000-000000000032",
          changedAt,
          retainUntil: "2026-09-29T00:00:00.000Z",
        },
      ],
      nextCursor: "cursor:3",
    });
    expect(memories.get(remoteExplicitId).status).toBe("deleted");
    expect(memories.get(localExplicit.id).status).toBe("active");
    memories.close();
    chat.close();
  });

  it("applies remote settings, entries, and tombstones to the shared local store", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "openerx-memory-sync-"));
    directories.push(directory);
    const file = path.join(directory, "sync.sqlite");
    const chat = new ChatRepository(file, { ownerProfileId: owner, deviceId: device });
    chat.applySyncPull({
      changes: [
        {
          cursor: "cursor:1",
          accountId: owner,
          objectType: "memory_settings",
          objectId: owner,
          revision: 1,
          tombstone: false,
          payloadVersion: 1,
          payload: {
            ownerProfileId: owner,
            memoriesEnabled: true,
            useMemories: true,
            generateMemories: false,
            syncMemories: true,
            updatedAt: changedAt,
            revision: 1,
          },
          operationId: "40000000-0000-4000-8000-000000000004",
          changedAt,
          retainUntil: null,
        },
        {
          cursor: "cursor:2",
          accountId: owner,
          objectType: "memory_entry",
          objectId: memoryId,
          revision: 1,
          tombstone: false,
          payloadVersion: 1,
          payload: {
            id: memoryId,
            ownerProfileId: owner,
            scope: "personal",
            kind: "profile",
            content: "用户常驻上海。",
            retrievalKeys: ["上海"],
            canonicalKey: "profile:用户常驻上海。",
            conflictKey: "profile.home_city",
            origin: "explicit",
            confidence: 1,
            status: "active",
            sourceConversationId: null,
            sourceMessageId: null,
            supersedesMemoryId: null,
            expiresAt: null,
            createdAt: changedAt,
            updatedAt: changedAt,
            revision: 1,
          },
          operationId: "50000000-0000-4000-8000-000000000005",
          changedAt,
          retainUntil: null,
        },
      ],
      nextCursor: "cursor:2",
    });
    const memories = new MemoryRepository(file, { ownerProfileId: owner, deviceId: device });
    expect(memories.settings()).toMatchObject({ memoriesEnabled: true, syncMemories: true });
    expect(memories.list({ status: "active", limit: 50 })).toEqual([
      expect.objectContaining({ id: memoryId, content: "用户常驻上海。" }),
    ]);

    chat.applySyncPull({
      changes: [
        {
          cursor: "cursor:3",
          accountId: owner,
          objectType: "memory_entry",
          objectId: memoryId,
          revision: 2,
          tombstone: true,
          payloadVersion: 1,
          payload: null,
          operationId: "60000000-0000-4000-8000-000000000006",
          changedAt,
          retainUntil: "2026-09-29T00:00:00.000Z",
        },
      ],
      nextCursor: "cursor:3",
    });
    expect(memories.get(memoryId).status).toBe("deleted");
    expect(chat.syncCursor()).toBe("cursor:3");
    memories.close();
    chat.close();
  });

  it("applies and removes remote chat-level memory controls", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "openerx-memory-chat-sync-"));
    directories.push(directory);
    const file = path.join(directory, "sync.sqlite");
    const chat = new ChatRepository(file, { ownerProfileId: owner, deviceId: device });
    chat.applySyncPull({
      changes: [
        {
          cursor: "cursor:1",
          accountId: owner,
          objectType: "memory_conversation_settings",
          objectId: conversationId,
          revision: 1,
          tombstone: false,
          payloadVersion: 1,
          payload: {
            conversationId,
            ownerProfileId: owner,
            useMemories: false,
            generateMemories: null,
            updatedAt: changedAt,
            revision: 1,
          },
          operationId: "80000000-0000-4000-8000-000000000008",
          changedAt,
          retainUntil: null,
        },
      ],
      nextCursor: "cursor:1",
    });
    const memories = new MemoryRepository(file, { ownerProfileId: owner, deviceId: device });
    expect(memories.conversationSettings(conversationId)).toMatchObject({
      useMemories: false,
      generateMemories: null,
    });

    chat.applySyncPull({
      changes: [
        {
          cursor: "cursor:2",
          accountId: owner,
          objectType: "memory_conversation_settings",
          objectId: conversationId,
          revision: 2,
          tombstone: true,
          payloadVersion: 1,
          payload: null,
          operationId: "90000000-0000-4000-8000-000000000009",
          changedAt,
          retainUntil: "2026-09-29T00:00:00.000Z",
        },
      ],
      nextCursor: "cursor:2",
    });
    expect(memories.conversationSettings(conversationId)).toMatchObject({
      useMemories: null,
      generateMemories: null,
    });
    memories.close();
    chat.close();
  });
});
