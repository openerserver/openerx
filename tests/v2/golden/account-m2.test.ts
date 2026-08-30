import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { AccountSyncService, type SyncPrincipal } from "@openerx/account-sync-api";
import { ChatRepository, MemoryRepository } from "@openerx/storage";
import { afterEach, describe, expect, it } from "vitest";

const temporaryDirectories: string[] = [];
const repositories: ChatRepository[] = [];
const memoryRepositories: MemoryRepository[] = [];
const services: AccountSyncService[] = [];

afterEach(() => {
  for (const repository of memoryRepositories.splice(0)) repository.close();
  for (const repository of repositories.splice(0)) repository.close();
  for (const service of services.splice(0)) service.close();
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function replica(accountId: string, deviceId: string): ChatRepository {
  const directory = mkdtempSync(path.join(tmpdir(), "openerx-account-replica-"));
  temporaryDirectories.push(directory);
  const repository = new ChatRepository(path.join(directory, "replica.sqlite"), {
    ownerProfileId: accountId,
    deviceId,
    selectedModelRef: "platform/standard",
  });
  repositories.push(repository);
  return repository;
}

function principal(accountId: string, deviceId: string): SyncPrincipal {
  return { accountId, deviceId, sessionId: randomUUID() };
}

function memoryReplica(
  accountId: string,
  deviceId: string,
  now: () => string,
): { chat: ChatRepository; memories: MemoryRepository } {
  const directory = mkdtempSync(path.join(tmpdir(), "openerx-memory-replica-"));
  temporaryDirectories.push(directory);
  const databasePath = path.join(directory, "replica.sqlite");
  const chat = new ChatRepository(databasePath, { ownerProfileId: accountId, deviceId, now });
  const memories = new MemoryRepository(databasePath, { ownerProfileId: accountId, deviceId, now });
  repositories.push(chat);
  memoryRepositories.push(memories);
  return { chat, memories };
}

function sync(repository: ChatRepository, actor: SyncPrincipal, cloud: AccountSyncService): void {
  for (const operation of repository.pendingSyncOperations()) {
    repository.acknowledgeSync(cloud.push(actor, operation));
  }
  repository.applySyncPull(cloud.pull(actor, repository.syncCursor()));
}

describe("GT-ACCOUNT client sync replicas", () => {
  it("converges concurrent memory conflict slots and restores the prior value after deletion", () => {
    const cloud = new AccountSyncService(":memory:");
    services.push(cloud);
    const accountId = randomUUID();
    const firstDevice = randomUUID();
    const secondDevice = randomUUID();
    const cleanDevice = randomUUID();
    const first = memoryReplica(accountId, firstDevice, () => "2026-08-30T10:00:00.000Z");
    const second = memoryReplica(accountId, secondDevice, () => "2026-08-30T10:01:00.000Z");
    const clean = memoryReplica(accountId, cleanDevice, () => "2026-08-30T10:02:00.000Z");
    first.memories.updateSettings({
      memoriesEnabled: true,
      useMemories: true,
      syncMemories: true,
    });
    sync(first.chat, principal(accountId, firstDevice), cloud);
    sync(second.chat, principal(accountId, secondDevice), cloud);
    expect(second.memories.settings()).toMatchObject({
      memoriesEnabled: true,
      syncMemories: true,
    });

    const chinese = first.memories.upsert({
      kind: "preference",
      content: "用户偏好使用中文回复。",
      conflictKey: "response.language",
      idempotencyKey: "memory-device-a-language-0001",
    });
    sync(first.chat, principal(accountId, firstDevice), cloud);
    sync(second.chat, principal(accountId, secondDevice), cloud);
    const english = second.memories.upsert({
      kind: "preference",
      content: "用户偏好使用英文回复。",
      conflictKey: "response.language",
      idempotencyKey: "memory-device-b-language-0001",
    });
    const french = first.memories.upsert({
      kind: "preference",
      content: "用户偏好使用法文回复。",
      conflictKey: "response.language",
      idempotencyKey: "memory-device-a-language-0002",
    });
    expect(
      first.chat
        .pendingSyncOperations()
        .filter(({ objectType }) => objectType === "memory_entry")
        .map(({ objectId }) => objectId),
    ).toEqual([french.id]);
    expect(
      second.chat
        .pendingSyncOperations()
        .filter(({ objectType }) => objectType === "memory_entry")
        .map(({ objectId }) => objectId),
    ).toEqual([english.id]);

    sync(second.chat, principal(accountId, secondDevice), cloud);
    sync(first.chat, principal(accountId, firstDevice), cloud);
    sync(second.chat, principal(accountId, secondDevice), cloud);
    sync(clean.chat, principal(accountId, cleanDevice), cloud);
    for (const replica of [first, second, clean]) {
      expect(replica.memories.list({ status: "active", limit: 50 })).toEqual([
        expect.objectContaining({ id: english.id, supersedesMemoryId: french.id }),
      ]);
      expect(replica.memories.get(french.id)).toMatchObject({
        status: "superseded",
        supersedesMemoryId: chinese.id,
      });
      expect(replica.memories.get(chinese.id).status).toBe("superseded");
      expect(replica.chat.syncConflicts()).toEqual([]);
    }

    first.memories.delete({
      memoryId: english.id,
      idempotencyKey: "memory-device-a-undo-language-0001",
    });
    expect(
      first.chat
        .pendingSyncOperations()
        .filter(({ objectType }) => objectType === "memory_entry")
        .map(({ objectId, mutation }) => ({ objectId, mutation })),
    ).toEqual([{ objectId: english.id, mutation: "delete" }]);
    sync(first.chat, principal(accountId, firstDevice), cloud);
    sync(second.chat, principal(accountId, secondDevice), cloud);
    sync(clean.chat, principal(accountId, cleanDevice), cloud);
    clean.chat.clearLocalCache();
    sync(clean.chat, principal(accountId, cleanDevice), cloud);
    for (const replica of [first, second, clean]) {
      expect(replica.memories.get(english.id).status).toBe("deleted");
      expect(replica.memories.list({ status: "active", limit: 50 })).toEqual([
        expect.objectContaining({ id: french.id, supersedesMemoryId: chinese.id }),
      ]);
    }
  });

  it("restores a conversation across devices and preserves model selection", () => {
    const cloud = new AccountSyncService(":memory:");
    services.push(cloud);
    const accountId = randomUUID();
    const deviceA = randomUUID();
    const deviceB = randomUUID();
    const first = replica(accountId, deviceA);
    const second = replica(accountId, deviceB);
    const draft = first.createGeneration({
      text: "从 Windows 创建的消息",
      idempotencyKey: "device-a-create-message",
    });
    first.appendPiEvent(draft.receipt.assistantMessageId, {
      eventId: randomUUID(),
      sequence: 1,
      occurredAt: "2026-08-25T10:00:01.000Z",
      type: "delta",
      delta: "跨设备回答",
    });
    first.appendPiEvent(draft.receipt.assistantMessageId, {
      eventId: randomUUID(),
      sequence: 2,
      occurredAt: "2026-08-25T10:00:02.000Z",
      type: "completed",
    });
    first.selectConversationModel(draft.receipt.conversationId, "platform/tools");
    expect(first.pendingSyncOperations().length).toBeGreaterThan(0);
    sync(first, principal(accountId, deviceA), cloud);
    sync(second, principal(accountId, deviceB), cloud);

    const restored = second.getConversation(draft.receipt.conversationId);
    expect(restored.conversation.selectedModelRef).toBe("platform/tools");
    expect(restored.messages.map((message) => message.parts[0]?.text)).toEqual([
      "从 Windows 创建的消息",
      "跨设备回答",
    ]);
    expect(second.pendingSyncOperations()).toEqual([]);
  });

  it("keeps both concurrent edits visible and restores a clean replica after cache clear", () => {
    const cloud = new AccountSyncService(":memory:");
    services.push(cloud);
    const accountId = randomUUID();
    const deviceA = randomUUID();
    const deviceB = randomUUID();
    const cleanDevice = randomUUID();
    const first = replica(accountId, deviceA);
    const second = replica(accountId, deviceB);
    const cleanReplica = replica(accountId, cleanDevice);
    const draft = first.createGeneration({
      text: "冲突测试",
      idempotencyKey: "conflict-create-message",
    });
    sync(first, principal(accountId, deviceA), cloud);
    sync(second, principal(accountId, deviceB), cloud);

    first.renameConversation(draft.receipt.conversationId, "设备 A 标题");
    second.renameConversation(draft.receipt.conversationId, "设备 B 标题");
    sync(first, principal(accountId, deviceA), cloud);
    sync(second, principal(accountId, deviceB), cloud);
    expect(second.syncConflicts()).toEqual([
      expect.objectContaining({
        clientPayload: expect.objectContaining({ title: "设备 B 标题" }),
        serverPayload: expect.objectContaining({ title: "设备 A 标题" }),
      }),
    ]);
    expect(second.getConversation(draft.receipt.conversationId).conversation.title).toBe(
      "设备 B 标题",
    );
    expect(() => second.clearLocalCache()).toThrow("SYNC_UNRESOLVED_CONFLICTS_EXIST");

    const [conflict] = second.syncConflicts();
    if (!conflict) throw new Error("Expected a visible sync conflict");
    cloud.resolveConflict(principal(accountId, deviceB), conflict.conflictId);
    second.resolveSyncConflict(conflict.conflictId, "cloud");
    expect(second.syncConflicts()).toEqual([]);
    expect(second.getConversation(draft.receipt.conversationId).conversation.title).toBe(
      "设备 A 标题",
    );

    first.renameConversation(draft.receipt.conversationId, "设备 A 再次编辑");
    sync(first, principal(accountId, deviceA), cloud);
    second.renameConversation(draft.receipt.conversationId, "设备 B 保留本机");
    sync(second, principal(accountId, deviceB), cloud);
    const [localWinner] = second.syncConflicts();
    if (!localWinner) throw new Error("Expected a second visible sync conflict");
    cloud.resolveConflict(principal(accountId, deviceB), localWinner.conflictId);
    second.resolveSyncConflict(localWinner.conflictId, "local");
    sync(second, principal(accountId, deviceB), cloud);
    sync(first, principal(accountId, deviceA), cloud);
    expect(second.syncConflicts()).toEqual([]);
    expect(first.getConversation(draft.receipt.conversationId).conversation.title).toBe(
      "设备 B 保留本机",
    );

    sync(cleanReplica, principal(accountId, cleanDevice), cloud);
    cleanReplica.clearLocalCache();
    expect(cleanReplica.listConversations()).toEqual([]);
    sync(cleanReplica, principal(accountId, cleanDevice), cloud);
    expect(cleanReplica.getConversation(draft.receipt.conversationId).conversation.title).toBe(
      "设备 B 保留本机",
    );
  });

  it("propagates tombstones and never exposes another account", () => {
    const cloud = new AccountSyncService(":memory:");
    services.push(cloud);
    const accountId = randomUUID();
    const deviceA = randomUUID();
    const deviceB = randomUUID();
    const owner = replica(accountId, deviceA);
    const peer = replica(accountId, deviceB);
    const strangerAccountId = randomUUID();
    const strangerDeviceId = randomUUID();
    const stranger = replica(strangerAccountId, strangerDeviceId);
    const draft = owner.createGeneration({
      text: "仅账户本人可见",
      idempotencyKey: "private-create-message",
    });
    sync(owner, principal(accountId, deviceA), cloud);
    sync(peer, principal(accountId, deviceB), cloud);
    sync(stranger, principal(strangerAccountId, strangerDeviceId), cloud);
    expect(stranger.listConversations()).toEqual([]);

    owner.deleteConversation(draft.receipt.conversationId);
    sync(owner, principal(accountId, deviceA), cloud);
    sync(peer, principal(accountId, deviceB), cloud);
    expect(peer.listConversations()).toEqual([]);
    expect(() => peer.getConversation(draft.receipt.conversationId)).toThrow(
      "Conversation not found",
    );
  });

  it("keeps local cache clear separate from account cloud deletion", () => {
    const cloud = new AccountSyncService(":memory:");
    services.push(cloud);
    const accountId = randomUUID();
    const deviceA = randomUUID();
    const deviceB = randomUUID();
    const first = replica(accountId, deviceA);
    const second = replica(accountId, deviceB);
    first.createGeneration({
      text: "删除边界",
      idempotencyKey: "cloud-delete-boundary",
    });
    sync(first, principal(accountId, deviceA), cloud);
    sync(second, principal(accountId, deviceB), cloud);

    first.clearLocalCache();
    expect(first.listConversations()).toEqual([]);
    sync(first, principal(accountId, deviceA), cloud);
    expect(first.listConversations()).toHaveLength(1);

    const deletion = cloud.deleteAccountData(principal(accountId, deviceB));
    expect(deletion.deletedObjects).toBeGreaterThan(0);
    sync(first, principal(accountId, deviceA), cloud);
    sync(second, principal(accountId, deviceB), cloud);
    expect(first.listConversations()).toEqual([]);
    expect(second.listConversations()).toEqual([]);
  });
});
