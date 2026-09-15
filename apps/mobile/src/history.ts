import {
  attachmentSchema,
  type Branch,
  branchSchema,
  conversationSchema,
  type Message,
  messageSchema,
  personalFileSyncPayloadSchema,
  type SyncChange,
  type SyncPullResult,
  syncChangeSchema,
  syncPullResultSchema,
} from "@openerx/contracts";
import { z } from "zod";
import { type MobileTask, remoteTasks } from "./presentation";
import type { DecryptedRemoteEvent } from "./remote-controller";

export const historyStateSchema = z
  .object({
    version: z.literal(1),
    accountId: z.uuid(),
    cursor: z
      .string()
      .regex(/^cursor:\d+$/)
      .nullable(),
    syncedAt: z.string().nullable(),
    objects: z.record(z.string(), syncChangeSchema),
  })
  .strict();
export type MobileHistoryState = z.infer<typeof historyStateSchema>;
export interface HistoryStorage {
  load(): Promise<unknown>;
  save(state: MobileHistoryState): Promise<void>;
  clear(): Promise<void>;
}
const historyTypes = new Set(["conversation", "branch", "message", "attachment", "personal_file"]);
const sequence = (cursor: string | null): number => Number(cursor?.slice(7) ?? 0);

export function emptyHistory(accountId: string): MobileHistoryState {
  return { version: 1, accountId, cursor: null, syncedAt: null, objects: {} };
}

function validateChange(change: SyncChange, accountId: string): SyncChange {
  if (change.accountId !== accountId) throw new Error("ACCOUNT_SCOPE_VIOLATION");
  if (change.tombstone) return change;
  const schemas = {
    conversation: conversationSchema,
    branch: branchSchema,
    message: messageSchema,
    attachment: attachmentSchema,
    personal_file: personalFileSyncPayloadSchema,
  };
  const schema = schemas[change.objectType as keyof typeof schemas];
  if (!schema) return change;
  const payload = schema.parse(change.payload) as Record<string, unknown>;
  if (
    payload.id !== change.objectId ||
    (payload.ownerProfileId && payload.ownerProfileId !== accountId)
  )
    throw new Error("ACCOUNT_SCOPE_VIOLATION");
  return { ...change, payload };
}

export function applyHistoryPage(
  state: MobileHistoryState,
  input: SyncPullResult,
): MobileHistoryState {
  const page = syncPullResultSchema.parse(input);
  if (sequence(page.nextCursor) < sequence(state.cursor)) throw new Error("SYNC_CURSOR_REGRESSED");
  const objects = { ...state.objects };
  for (const raw of page.changes) {
    const change = validateChange(raw, state.accountId);
    if (sequence(change.cursor) > sequence(page.nextCursor)) throw new Error("SYNC_CURSOR_INVALID");
    if (!historyTypes.has(change.objectType)) continue;
    const key = `${change.objectType}:${change.objectId}`;
    if ((objects[key]?.revision ?? 0) >= change.revision) continue;
    objects[key] = change;
  }
  return { ...state, objects, cursor: page.nextCursor };
}

/** Persist each page before advancing the cursor. A failed page is safe to request again. */
export class MobileHistorySync {
  state: MobileHistoryState;
  #active: Promise<void> | null = null;
  #loaded: Promise<void> | null = null;
  #closed = false;
  #writes = Promise.resolve();
  constructor(
    readonly accountId: string,
    private readonly pull: (cursor: string | null) => Promise<SyncPullResult>,
    private readonly storage: HistoryStorage,
    private readonly onChange: (state: MobileHistoryState) => void,
  ) {
    this.state = emptyHistory(accountId);
  }

  load(): Promise<void> {
    this.#loaded ??= this.#load();
    return this.#loaded;
  }
  async #load(): Promise<void> {
    const saved = await this.storage.load();
    if (this.#closed || saved === null) return;
    const parsed = historyStateSchema.safeParse(saved);
    if (!parsed.success) {
      await this.storage.clear();
      return;
    }
    const state = parsed.data;
    if (state.accountId !== this.accountId) throw new Error("ACCOUNT_SCOPE_VIOLATION");
    for (const entry of Object.values(state.objects)) validateChange(entry, this.accountId);
    this.state = state;
    this.onChange(state);
  }
  sync(): Promise<void> {
    this.#active ??= this.#sync().finally(() => {
      this.#active = null;
    });
    return this.#active;
  }
  async #sync(): Promise<void> {
    await this.load();
    while (!this.#closed) {
      let page: SyncPullResult;
      try {
        page = await this.pull(this.state.cursor);
      } catch (error) {
        if (error instanceof Error && error.message === "SYNC_CURSOR_AHEAD" && this.state.cursor) {
          // The account was cleared/reset on the server; rebuild instead of retaining old data.
          await this.#commit(emptyHistory(this.accountId));
          continue;
        }
        throw error;
      }
      if (this.#closed) return;
      if (page.changes.length && sequence(page.nextCursor) <= sequence(this.state.cursor))
        throw new Error("SYNC_CURSOR_NOT_ADVANCING");
      const next = applyHistoryPage(this.state, page);
      if (!page.changes.length) next.syncedAt = new Date().toISOString();
      await this.#commit(next);
      if (!page.changes.length) return;
    }
  }
  async #commit(state: MobileHistoryState): Promise<void> {
    const write = this.#writes.then(async () => {
      if (this.#closed) return;
      await this.storage.save(state);
      if (this.#closed) return;
      this.state = state;
      this.onChange(state);
    });
    this.#writes = write.catch(() => undefined);
    await write;
  }
  close(): void {
    this.#closed = true;
  }
  async clear(): Promise<void> {
    this.close();
    await this.#writes;
    await this.storage.clear();
    this.state = emptyHistory(this.accountId);
  }
}

function orderMessages(messages: Message[]): Message[] {
  const byId = new Map(messages.map((message) => [message.id, message]));
  const seen = new Set<string>();
  const ordered: Message[] = [];
  for (const message of messages.sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
    const chain: Message[] = [];
    let current: Message | undefined = message;
    // Sync order and timestamps can tie. Parent links preserve the actual turn order.
    while (current && !seen.has(current.id)) {
      seen.add(current.id);
      chain.push(current);
      current = current.parentMessageId ? byId.get(current.parentMessageId) : undefined;
    }
    for (let index = chain.length - 1; index >= 0; index--) ordered.push(chain[index] as Message);
  }
  return ordered;
}

function branchMessages(branchId: string, branches: Branch[], messages: Message[]): Message[] {
  const chain: Branch[] = [];
  const visited = new Set<string>();
  let id: string | null = branchId;
  while (id && !visited.has(id)) {
    visited.add(id);
    const branch = branches.find((item) => item.id === id);
    if (!branch) break;
    chain.unshift(branch);
    id = branch.parentBranchId;
  }
  let result: Message[] = [];
  for (const branch of chain) {
    if (branch.parentBranchId) {
      const cutoff = result.findIndex((message) => message.id === branch.forkedFromMessageId);
      result = result.slice(0, cutoff + 1);
    }
    result.push(...messages.filter((message) => message.branchId === branch.id));
  }
  // The first page can contain a conversation before its branch record arrives.
  return chain.length ? result : messages.filter((message) => message.branchId === branchId);
}

export function historyTasks(
  state: MobileHistoryState,
  events: DecryptedRemoteEvent[],
  selectedBranches: Record<string, string> = {},
): MobileTask[] {
  const entries = Object.values(state.objects).filter((item) => !item.tombstone && item.payload);
  const conversations = entries
    .filter((item) => item.objectType === "conversation")
    .map((item) => conversationSchema.parse(item.payload))
    .filter((item) => !item.deletedAt);
  const messages = orderMessages(
    entries
      .filter((item) => item.objectType === "message")
      .map((item) => messageSchema.parse(item.payload)),
  );
  const branches = entries
    .filter((item) => item.objectType === "branch")
    .map((item) => branchSchema.parse(item.payload));
  const attachments = entries
    .filter((item) => item.objectType === "attachment")
    .map((item) => attachmentSchema.parse(item.payload));
  const seeds: MobileTask[] = conversations.map((conversation) => {
    const ownBranches = branches.filter((branch) => branch.conversationId === conversation.id);
    const chosen = selectedBranches[conversation.id];
    const branchId =
      chosen && ownBranches.some((branch) => branch.id === chosen)
        ? chosen
        : conversation.activeBranchId;
    const selectedMessages = branchMessages(
      branchId,
      ownBranches,
      messages.filter((message) => message.conversationId === conversation.id),
    );
    const messageIds = new Set(selectedMessages.map((message) => message.id));
    return {
      id: conversation.id,
      title: conversation.title,
      hostDeviceId: "",
      updatedAt: conversation.updatedAt,
      revision: conversation.revision,
      archivedAt: conversation.archivedAt,
      branches: ownBranches,
      activeBranchId: conversation.activeBranchId,
      viewingBranchId: branchId,
      status: "completed",
      activeMessageId: null,
      messages: selectedMessages.map((message) => ({
        id: message.id,
        role: message.role,
        text: message.parts.map((part) => part.text).join(""),
        updatedAt: message.updatedAt,
        status:
          message.status === "completed"
            ? "completed"
            : message.status === "stopped" ||
                (message.status === "interrupted" && message.cancellationRequestedAt)
              ? "stopped"
              : message.status === "failed" || message.status === "interrupted"
                ? "failed"
                : "running",
        ...(message.errorCode ? { reason: message.errorCode } : {}),
      })),
      attachments: attachments
        .filter(
          (item) =>
            item.conversationId === conversation.id &&
            (!item.messageId || messageIds.has(item.messageId)),
        )
        .map((item) => {
          const file = state.objects[`personal_file:${item.personalFileId}`];
          const payload = file?.tombstone ? null : file?.payload;
          return {
            ...item,
            displayName: String(payload?.displayName ?? "附件"),
            sizeBytes: Number(payload?.sizeBytes ?? 0),
          };
        }),
    };
  });
  const visibleEvents = events.filter(({ envelope, payload }) => {
    if (!envelope.conversationId) return false;
    const record = state.objects[`conversation:${envelope.conversationId}`];
    if (record?.tombstone || record?.payload?.deletedAt) return false;
    const chosen = selectedBranches[envelope.conversationId];
    if (chosen && record && chosen !== record.payload?.activeBranchId) return false;
    const task = seeds.find((item) => item.id === envelope.conversationId);
    const messageIds = [
      (payload.message as { id?: string } | undefined)?.id,
      (payload.userMessage as { id?: string } | undefined)?.id,
      payload.messageId,
      payload.assistantMessageId,
    ];
    for (const messageId of messageIds) {
      if (typeof messageId !== "string") continue;
      const message = state.objects[`message:${messageId}`];
      if (message?.tombstone) return false;
      if (message && task && !task.messages.some((item) => item.id === messageId)) return false;
    }
    return true;
  });
  return remoteTasks(visibleEvents, seeds);
}
