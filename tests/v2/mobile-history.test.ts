import { randomUUID } from "node:crypto";
import { AccountSyncService } from "@openerx/account-sync-api";
import {
  branchSchema,
  conversationSchema,
  messageSchema,
  type SyncChange,
  type SyncPullResult,
} from "@openerx/contracts";
import { describe, expect, it, vi } from "vitest";
import {
  applyHistoryPage,
  emptyHistory,
  type HistoryStorage,
  historyTasks,
  type MobileHistoryState,
  MobileHistorySync,
} from "../../apps/mobile/src/history";
import type { DecryptedRemoteEvent } from "../../apps/mobile/src/remote-controller";

const now = "2026-09-15T08:00:00.000Z";
const accountId = randomUUID();
function fixture(title = "来自电脑的历史任务") {
  const id = randomUUID();
  const branchId = randomUUID();
  const conversation = conversationSchema.parse({
    id,
    ownerProfileId: accountId,
    title,
    activeBranchId: branchId,
    selectedModelRef: "platform/auto",
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
    deletedAt: null,
    revision: 4,
  });
  const branch = branchSchema.parse({
    id: branchId,
    conversationId: id,
    parentBranchId: null,
    forkedFromMessageId: null,
    label: "main",
    createdAt: now,
  });
  const user = messageSchema.parse({
    id: randomUUID(),
    conversationId: id,
    branchId,
    parentMessageId: null,
    role: "user",
    status: "completed",
    parts: [{ id: randomUUID(), type: "text", text: title }],
    errorCode: null,
    cancellationRequestedAt: null,
    attempt: 1,
    createdAt: now,
    updatedAt: now,
    revision: 1,
  });
  const assistant = messageSchema.parse({
    ...user,
    id: randomUUID(),
    role: "assistant",
    parentMessageId: user.id,
    parts: [{ id: randomUUID(), type: "text", text: "完整回答" }],
  });
  return { conversation, branch, user, assistant };
}
function change(
  objectType: SyncChange["objectType"],
  payload: Record<string, unknown>,
  index: number,
  revision = 1,
): SyncChange {
  return {
    cursor: `cursor:${index}`,
    accountId,
    objectType,
    objectId: String(payload.id),
    revision,
    tombstone: false,
    payloadVersion: 1,
    payload,
    operationId: randomUUID(),
    changedAt: now,
    retainUntil: null,
  };
}
function page(f: ReturnType<typeof fixture>): SyncPullResult {
  return {
    changes: [
      change("conversation", f.conversation, 1),
      change("branch", f.branch, 2),
      change("message", f.user, 3),
      change("message", f.assistant, 4),
    ],
    nextCursor: "cursor:4",
  };
}
function storage(): HistoryStorage & { saved: MobileHistoryState | null } {
  return {
    saved: null,
    async load() {
      return this.saved;
    },
    async save(value) {
      this.saved = structuredClone(value);
    },
    async clear() {
      this.saved = null;
    },
  };
}
function remoteEvent(
  f: ReturnType<typeof fixture>,
  kind: "message.delta" | "message.completed",
  occurredAt: string,
): DecryptedRemoteEvent {
  return {
    envelope: {
      version: 1,
      eventId: randomUUID(),
      accountId,
      hostDeviceId: randomUUID(),
      conversationId: f.conversation.id,
      kind,
      occurredAt,
      cursor: "remote:1",
      encryptedPayload: "encrypted",
    },
    payload:
      kind === "message.delta"
        ? { messageId: f.assistant.id, delta: "旧片段" }
        : {
            message: {
              id: f.assistant.id,
              role: "assistant",
              text: "完整回答",
              status: "completed",
            },
          },
  };
}

describe("mobile account history", () => {
  it("loads all pages beyond the remote event window, survives restart, and reads with the host offline", async () => {
    const service = new AccountSyncService(":memory:");
    try {
      const principal = { accountId, deviceId: randomUUID(), sessionId: randomUUID() };
      for (let i = 0; i < 260; i++)
        for (const c of page(fixture(`历史任务 ${i}`)).changes) {
          service.push(principal, {
            operationId: c.operationId,
            accountId,
            deviceId: principal.deviceId,
            objectType: c.objectType,
            objectId: c.objectId,
            mutation: "upsert",
            baseRevision: 0,
            payloadVersion: 1,
            payload: c.payload,
            idempotencyKey: c.operationId,
            createdAt: now,
          });
        }
      const disk = storage();
      const pull = vi.fn(async (cursor: string | null) => service.pull(principal, cursor, 73));
      const sync = new MobileHistorySync(accountId, pull, disk, () => undefined);
      await sync.sync();
      expect(pull.mock.calls.length).toBeGreaterThan(10);
      expect(historyTasks(sync.state, [])).toHaveLength(260);
      expect(sync.state.cursor).toBe("cursor:1040");
      expect(sync.state.syncedAt).not.toBeNull();
      const restored = new MobileHistorySync(
        accountId,
        async () => {
          throw new Error("network offline");
        },
        disk,
        () => undefined,
      );
      await restored.load();
      await expect(restored.sync()).rejects.toThrow("network offline");
      expect(historyTasks(restored.state, []).flatMap((task) => task.messages)).toHaveLength(520);
    } finally {
      service.close();
    }
  });
  it("does not advance a failed persistence write and safely retries the page", async () => {
    const f = fixture();
    const disk = storage();
    const save = disk.save.bind(disk);
    disk.save = vi.fn().mockRejectedValueOnce(new Error("disk full")).mockImplementation(save);
    const pull = vi.fn(async (cursor: string | null) =>
      cursor ? { changes: [], nextCursor: cursor } : page(f),
    );
    const sync = new MobileHistorySync(accountId, pull, disk, () => undefined);
    await expect(sync.sync()).rejects.toThrow("disk full");
    expect(sync.state.cursor).toBeNull();
    await sync.sync();
    expect(pull.mock.calls.slice(0, 2)).toEqual([[null], [null]]);
    expect(historyTasks(sync.state, [])[0]?.messages).toHaveLength(2);
  });
  it("keeps authoritative full messages and renamed titles when old live events replay", () => {
    const f = fixture("新标题");
    const state = applyHistoryPage(emptyHistory(accountId), page(f));
    const old = remoteEvent(f, "message.delta", "2026-09-14T08:00:00.000Z");
    old.payload.title = "旧标题";
    const task = historyTasks(state, [
      old,
      remoteEvent(f, "message.delta", "2026-09-15T09:00:00.000Z"),
    ])[0];
    expect(task?.title).toBe("新标题");
    expect(task?.messages.at(-1)?.text).toBe("完整回答");
    expect(task?.status).toBe("completed");
  });
  it("keeps parent messages before replies when timestamps tie and sync arrives in reverse order", () => {
    const f = fixture();
    const input = page(f);
    input.changes.reverse();
    const state = applyHistoryPage(emptyHistory(accountId), input);
    expect(historyTasks(state, [])[0]?.messages.map((message) => message.role)).toEqual([
      "user",
      "assistant",
    ]);
  });
  it("merges new streaming deltas once and replaces them with the final cloud message", () => {
    const f = fixture();
    f.assistant.status = "pending";
    f.assistant.parts = [{ id: randomUUID(), type: "text", text: "" }];
    const state = applyHistoryPage(emptyHistory(accountId), page(f));
    const event = remoteEvent(f, "message.delta", "2026-09-15T08:01:00.000Z");
    expect(historyTasks(state, [event])[0]?.messages.at(-1)?.text).toBe("旧片段");
    f.assistant.status = "completed";
    f.assistant.updatedAt = "2026-09-15T08:02:00.000Z";
    f.assistant.parts = [{ id: randomUUID(), type: "text", text: "最终全文" }];
    const final = applyHistoryPage(state, {
      changes: [change("message", f.assistant, 5, 2)],
      nextCursor: "cursor:5",
    });
    expect(historyTasks(final, [event])[0]?.messages.at(-1)?.text).toBe("最终全文");
  });
  it("keeps archive state and prevents deleted conversations returning through retained events", () => {
    const f = fixture();
    f.conversation.archivedAt = now;
    const state = applyHistoryPage(emptyHistory(accountId), page(f));
    expect(historyTasks(state, [])[0]?.archivedAt).toBe(now);
    const deletion = {
      ...change("conversation", f.conversation, 5, 2),
      tombstone: true,
      payload: null,
    };
    const deleted = applyHistoryPage(state, { changes: [deletion], nextCursor: "cursor:5" });
    expect(historyTasks(deleted, [remoteEvent(f, "message.completed", now)])).toEqual([]);
  });
  it("retains all branches and resolves ancestor messages without mixing alternate answers", () => {
    const f = fixture();
    const altBranch = {
      ...f.branch,
      id: randomUUID(),
      parentBranchId: f.branch.id,
      forkedFromMessageId: f.user.id,
      label: "另一个回答",
    };
    const alt = {
      ...f.assistant,
      id: randomUUID(),
      branchId: altBranch.id,
      parts: [{ id: randomUUID(), type: "text" as const, text: "分支回答" }],
    };
    const state = applyHistoryPage(emptyHistory(accountId), {
      changes: [...page(f).changes, change("branch", altBranch, 5), change("message", alt, 6)],
      nextCursor: "cursor:6",
    });
    expect(historyTasks(state, [])[0]?.messages.map((m) => m.text)).toEqual([
      f.conversation.title,
      "完整回答",
    ]);
    const branch = historyTasks(state, [remoteEvent(f, "message.completed", now)], {
      [f.conversation.id]: altBranch.id,
    })[0];
    expect(branch?.messages.map((m) => m.text)).toEqual([f.conversation.title, "分支回答"]);
    expect(branch?.activeMessageId).toBeNull();
    const oldAcknowledgment = remoteEvent(f, "message.completed", now);
    oldAcknowledgment.payload = {
      userMessage: { id: alt.id, text: "其他分支的历史回执" },
      assistantMessageId: alt.id,
    };
    expect(historyTasks(state, [oldAcknowledgment])[0]?.messages.map((m) => m.text)).toEqual([
      f.conversation.title,
      "完整回答",
    ]);
  });
  it("rejects cross-account data and refuses a nonadvancing feed", async () => {
    const f = fixture();
    const leaked = page(f);
    leaked.changes = leaked.changes.map((change) => ({ ...change, accountId: randomUUID() }));
    expect(() => applyHistoryPage(emptyHistory(accountId), leaked)).toThrow(
      "ACCOUNT_SCOPE_VIOLATION",
    );
    const sync = new MobileHistorySync(
      accountId,
      async () => page(f),
      storage(),
      () => undefined,
    );
    await expect(sync.sync()).rejects.toThrow("SYNC_CURSOR_NOT_ADVANCING");
  });
  it("does not recreate a signed-out cache when a late request finishes", async () => {
    const f = fixture();
    const disk = storage();
    let resolve!: (value: SyncPullResult) => void;
    const pending = new Promise<SyncPullResult>((done) => {
      resolve = done;
    });
    const sync = new MobileHistorySync(
      accountId,
      () => pending,
      disk,
      () => undefined,
    );
    const running = sync.sync();
    await sync.load();
    await sync.clear();
    resolve(page(f));
    await running;
    expect(disk.saved).toBeNull();
    expect(sync.state.cursor).toBeNull();
  });
});
