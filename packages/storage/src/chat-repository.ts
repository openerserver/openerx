import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import {
  type Branch,
  branchSchema,
  type ChatEvent,
  type Conversation,
  type ConversationSnapshot,
  type ConversationSummary,
  chatEventSchema,
  conversationMemorySettingsSchema,
  conversationSchema,
  conversationSnapshotSchema,
  conversationSummarySchema,
  defaultThinkingLevel,
  type GenerationReceipt,
  generationReceiptSchema,
  type Message,
  memoryEntrySchema,
  memorySettingsSchema,
  messageSchema,
  type PiHistoryMessage,
  projectDirectorySyncPayloadSchema,
  projectSyncPayloadSchema,
  type SearchResult,
  type SyncConflict,
  type SyncOperation,
  type SyncPullResult,
  type SyncPushResult,
  searchResultSchema,
  skillInstallationSyncSchema,
  syncConflictSchema,
  syncOperationSchema,
  type ThinkingLevel,
} from "@openerx/contracts";
import {
  assertMessageTransition,
  deriveConversationTitle,
  terminalMessageStatuses,
} from "@openerx/domain";
import { migrateDatabase } from "./migrations";

type SqlRow = Record<string, unknown>;

interface RepositoryOptions {
  ownerProfileId?: string;
  selectedModelRef?: string;
  thinkingLevel?: ThinkingLevel;
  now?: () => string;
  idFactory?: () => string;
  deviceId?: string;
}

export interface GenerationDraft {
  receipt: GenerationReceipt;
  events: ChatEvent[];
  created: boolean;
  selectedModelRef: string;
  thinkingLevel: ThinkingLevel;
}

export interface PiProductEvent {
  eventId: string;
  sequence: number;
  occurredAt: string;
  type: "delta" | "completed" | "stopped" | "failed";
  delta?: string;
  startsNewPart?: boolean;
  errorCode?: string;
}

export class ChatRepository {
  readonly #database: DatabaseSync;
  readonly #ownerProfileId: string;
  readonly #selectedModelRef: string;
  readonly #thinkingLevel: ThinkingLevel;
  readonly #now: () => string;
  readonly #idFactory: () => string;
  readonly #deviceId: string | null;

  constructor(databasePath: string, options: RepositoryOptions = {}) {
    this.#database = new DatabaseSync(databasePath);
    this.#ownerProfileId = options.ownerProfileId ?? "local-default";
    this.#selectedModelRef = options.selectedModelRef ?? "pi/default";
    this.#thinkingLevel = options.thinkingLevel ?? defaultThinkingLevel;
    this.#now = options.now ?? (() => new Date().toISOString());
    this.#idFactory = options.idFactory ?? randomUUID;
    this.#deviceId = options.deviceId ?? null;
    try {
      migrateDatabase(this.#database);
    } catch (error) {
      this.#database.close();
      throw error;
    }
  }

  close(): void {
    this.#database.close();
  }

  listConversations(includeArchived = false): ConversationSummary[] {
    const rows = this.#database
      .prepare(
        `SELECT * FROM conversations
         WHERE deleted_at IS NULL AND (? = 1 OR archived_at IS NULL)
         ORDER BY updated_at DESC`,
      )
      .all(includeArchived ? 1 : 0) as SqlRow[];
    return rows.map((row) => {
      const conversation = this.#conversation(row);
      const messages = this.#resolveBranch(conversation.activeBranchId);
      return conversationSummarySchema.parse({
        ...conversation,
        lastMessagePreview: messages.at(-1)?.parts[0]?.text.slice(0, 120) ?? "",
        messageCount: messages.length,
      });
    });
  }

  getConversation(conversationId: string): ConversationSnapshot {
    const conversation = this.#getConversationEntity(conversationId);
    if (conversation.deletedAt) throw new Error("Conversation not found");
    const branches = (
      this.#database
        .prepare("SELECT * FROM branches WHERE conversation_id = ? ORDER BY created_at, id")
        .all(conversationId) as SqlRow[]
    ).map((row) => this.#branch(row));
    return conversationSnapshotSchema.parse({
      conversation,
      branches,
      messages: this.#resolveBranch(conversation.activeBranchId),
    });
  }

  conversationRevision(conversationId: string | null): number {
    return conversationId ? this.#getConversationEntity(conversationId).revision : 0;
  }

  hasActiveGeneration(conversationId: string): boolean {
    const row = this.#database
      .prepare(
        `SELECT 1 FROM messages
         WHERE conversation_id = ? AND status IN ('pending', 'streaming') LIMIT 1`,
      )
      .get(conversationId);
    return row !== undefined;
  }

  createGeneration(input: {
    conversationId?: string | null;
    projectId?: string | null;
    text: string;
    idempotencyKey: string;
    modelRef?: string;
    thinkingLevel?: ThinkingLevel;
  }): GenerationDraft {
    const duplicate = this.#idempotentResult(input.idempotencyKey, "chat.send");
    if (duplicate) {
      return {
        receipt: duplicate,
        events: [],
        created: false,
        selectedModelRef: this.selectedModelForMessage(duplicate.assistantMessageId),
        thinkingLevel: this.thinkingLevelForMessage(duplicate.assistantMessageId),
      };
    }
    return this.#transaction(() => {
      const now = this.#now();
      let conversation: Conversation;
      let branchId: string;
      const events: ChatEvent[] = [];
      if (input.conversationId) {
        conversation = this.#getConversationEntity(input.conversationId);
        if (conversation.deletedAt) throw new Error("Conversation not found");
        if (input.projectId !== undefined && input.projectId !== conversation.projectId) {
          throw new Error("PROJECT_SCOPE_MISMATCH");
        }
        branchId = conversation.activeBranchId;
      } else {
        const conversationId = this.#idFactory();
        branchId = this.#idFactory();
        const projectId = input.projectId ?? null;
        if (projectId) this.#assertProjectAvailable(projectId);
        this.#database
          .prepare(
            `INSERT INTO conversations
             (id, owner_profile_id, project_id, title, active_branch_id, selected_model_ref, thinking_level,
              created_at, updated_at, archived_at, deleted_at, revision)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, 1)`,
          )
          .run(
            conversationId,
            this.#ownerProfileId,
            projectId,
            deriveConversationTitle(input.text),
            branchId,
            input.modelRef ?? this.#selectedModelRef,
            input.thinkingLevel ?? this.#thinkingLevel,
            now,
            now,
          );
        this.#database
          .prepare(
            `INSERT INTO branches
             (id, conversation_id, parent_branch_id, forked_from_message_id, label, created_at)
             VALUES (?, ?, NULL, NULL, ?, ?)`,
          )
          .run(branchId, conversationId, "主分支", now);
        conversation = this.#getConversationEntity(conversationId);
        events.push(
          this.#appendEvent({
            type: "conversation.created",
            conversationId,
            messageId: null,
            payload: { conversation },
          }),
        );
      }
      const generationThinkingLevel = input.thinkingLevel ?? conversation.thinkingLevel;
      const parentMessageId = this.#resolveBranch(branchId).at(-1)?.id ?? null;
      const userMessage = this.#insertMessage({
        conversationId: conversation.id,
        branchId,
        parentMessageId,
        role: "user",
        status: "completed",
        text: input.text,
        selectedModelRef: conversation.selectedModelRef,
        thinkingLevel: generationThinkingLevel,
        attempt: 1,
        now,
      });
      const assistantMessage = this.#insertMessage({
        conversationId: conversation.id,
        branchId,
        parentMessageId: userMessage.id,
        role: "assistant",
        status: "pending",
        text: "",
        selectedModelRef: conversation.selectedModelRef,
        thinkingLevel: generationThinkingLevel,
        attempt: 1,
        now,
      });
      this.#touchConversation(conversation.id, now);
      this.#queueSyncUpsert(
        "conversation",
        conversation.id,
        this.#getConversationEntity(conversation.id),
        now,
      );
      this.#queueSyncUpsert("branch", branchId, this.#getBranch(branchId), now);
      this.#queueSyncUpsert("message", userMessage.id, userMessage, now);
      this.#queueSyncUpsert("message", assistantMessage.id, assistantMessage, now);
      events.push(
        this.#appendEvent({
          type: "message.accepted",
          conversationId: conversation.id,
          messageId: assistantMessage.id,
          payload: { message: assistantMessage },
        }),
      );
      const receipt = generationReceiptSchema.parse({
        conversationId: conversation.id,
        branchId,
        userMessageId: userMessage.id,
        assistantMessageId: assistantMessage.id,
      });
      this.#storeIdempotentResult(input.idempotencyKey, "chat.send", receipt, now);
      return {
        receipt,
        events,
        created: true,
        selectedModelRef: conversation.selectedModelRef,
        thinkingLevel: generationThinkingLevel,
      };
    });
  }

  regenerateGeneration(input: {
    conversationId: string;
    assistantMessageId: string;
    idempotencyKey: string;
  }): GenerationDraft {
    const duplicate = this.#idempotentResult(input.idempotencyKey, "chat.regenerate");
    if (duplicate) {
      return {
        receipt: duplicate,
        events: [],
        created: false,
        selectedModelRef: this.selectedModelForMessage(duplicate.assistantMessageId),
        thinkingLevel: this.thinkingLevelForMessage(duplicate.assistantMessageId),
      };
    }
    return this.#forkGeneration({
      command: "chat.regenerate",
      conversationId: input.conversationId,
      targetMessageId: input.assistantMessageId,
      idempotencyKey: input.idempotencyKey,
      replacementText: null,
    });
  }

  editGeneration(input: {
    conversationId: string;
    messageId: string;
    text: string;
    idempotencyKey: string;
  }): GenerationDraft {
    const duplicate = this.#idempotentResult(input.idempotencyKey, "chat.edit");
    if (duplicate) {
      return {
        receipt: duplicate,
        events: [],
        created: false,
        selectedModelRef: this.selectedModelForMessage(duplicate.assistantMessageId),
        thinkingLevel: this.thinkingLevelForMessage(duplicate.assistantMessageId),
      };
    }
    return this.#forkGeneration({
      command: "chat.edit",
      conversationId: input.conversationId,
      targetMessageId: input.messageId,
      idempotencyKey: input.idempotencyKey,
      replacementText: input.text,
    });
  }

  appendPiEvent(assistantMessageId: string, event: PiProductEvent): ChatEvent | null {
    return this.#transaction(() => {
      const row = this.#messageRow(assistantMessageId);
      const currentSequence = Number(row.runtime_sequence);
      if (event.sequence <= currentSequence) return null;
      if (event.sequence !== currentSequence + 1) {
        throw new Error(
          `Runtime event gap for ${assistantMessageId}: expected ${currentSequence + 1}, received ${event.sequence}`,
        );
      }
      const storedStatus = String(row.status) as Message["status"];
      const currentStatus: Message["status"] =
        row.cancellation_requested_at !== null &&
        (storedStatus === "pending" || storedStatus === "streaming")
          ? "cancelling"
          : storedStatus;
      if (terminalMessageStatuses.has(currentStatus)) return null;
      let nextStatus = currentStatus;
      let storedNextStatus = storedStatus;
      let eventType: ChatEvent["type"];
      let errorCode = row.error_code === null ? null : String(row.error_code);
      if (event.type === "delta") {
        nextStatus = currentStatus === "cancelling" ? "cancelling" : "streaming";
        storedNextStatus = "streaming";
        eventType = "message.delta";
      } else if (event.type === "completed") {
        nextStatus = "completed";
        storedNextStatus = "completed";
        eventType = "message.completed";
      } else if (event.type === "stopped") {
        nextStatus = row.cancellation_requested_at === null ? "stopped" : "interrupted";
        storedNextStatus = "stopped";
        eventType =
          row.cancellation_requested_at === null ? "message.stopped" : "message.interrupted";
      } else {
        nextStatus = "failed";
        storedNextStatus = "failed";
        errorCode = event.errorCode ?? "RUNTIME_FAILURE";
        eventType = "message.failed";
      }
      assertMessageTransition(currentStatus, nextStatus);
      if (event.delta) {
        const latestPart = this.#database
          .prepare(
            `SELECT id, position, text FROM message_parts
             WHERE message_id = ? ORDER BY position DESC LIMIT 1`,
          )
          .get(assistantMessageId) as { id: string; position: number; text: string } | undefined;
        if (event.startsNewPart && latestPart?.text) {
          this.#database
            .prepare(
              `INSERT INTO message_parts(id, message_id, position, type, text)
               VALUES (?, ?, ?, 'text', ?)`,
            )
            .run(
              this.#idFactory(),
              assistantMessageId,
              Number(latestPart.position) + 1,
              event.delta,
            );
        } else if (latestPart) {
          this.#database
            .prepare("UPDATE message_parts SET text = text || ? WHERE id = ?")
            .run(event.delta, latestPart.id);
        }
      }
      this.#database
        .prepare(
          `UPDATE messages SET status = ?, error_code = ?, updated_at = ?, revision = revision + 1,
           runtime_sequence = ? WHERE id = ?`,
        )
        .run(storedNextStatus, errorCode, event.occurredAt, event.sequence, assistantMessageId);
      const message = this.#message(assistantMessageId);
      this.#touchConversation(message.conversationId, event.occurredAt);
      this.#queueSyncUpsert("message", message.id, message, event.occurredAt);
      this.#queueSyncUpsert(
        "conversation",
        message.conversationId,
        this.#getConversationEntity(message.conversationId),
        event.occurredAt,
      );
      return this.#appendEvent({
        type: eventType,
        conversationId: message.conversationId,
        messageId: message.id,
        occurredAt: event.occurredAt,
        payload: {
          message,
          ...(event.delta === undefined ? {} : { delta: event.delta }),
          ...(errorCode === null ? {} : { reason: errorCode }),
        },
      });
    });
  }

  requestStopMessage(
    conversationId: string,
    assistantMessageId: string,
  ): { message: Message; event: ChatEvent | null } {
    return this.#transaction(() => {
      const before = this.#message(assistantMessageId);
      if (before.conversationId !== conversationId)
        throw new Error("Message does not belong to conversation");
      if (terminalMessageStatuses.has(before.status)) return { message: before, event: null };
      if (before.status === "cancelling") return { message: before, event: null };
      assertMessageTransition(before.status, "cancelling");
      const now = this.#now();
      this.#database
        .prepare(
          `UPDATE messages SET cancellation_requested_at = COALESCE(cancellation_requested_at, ?),
           updated_at = ?, revision = revision + 1
           WHERE id = ?`,
        )
        .run(now, now, assistantMessageId);
      this.#touchConversation(conversationId, now);
      const message = this.#message(assistantMessageId);
      const event = this.#appendEvent({
        type: "message.cancelling",
        conversationId,
        messageId: assistantMessageId,
        payload: { message, reason: "USER_CANCEL_REQUESTED" },
      });
      this.#queueSyncUpsert("message", message.id, message, now);
      return { message, event };
    });
  }

  recoverInterrupted(): ChatEvent[] {
    const rows = this.#database
      .prepare("SELECT id, conversation_id FROM messages WHERE status IN ('pending', 'streaming')")
      .all() as Array<{ id: string; conversation_id: string }>;
    return this.#transaction(() =>
      rows.map((row) => {
        const now = this.#now();
        this.#database
          .prepare(
            `UPDATE messages SET status = 'failed', error_code = 'APP_SERVICE_RESTARTED',
             updated_at = ?, revision = revision + 1 WHERE id = ?`,
          )
          .run(now, row.id);
        this.#touchConversation(row.conversation_id, now);
        const message = this.#message(row.id);
        return this.#appendEvent({
          type: "message.failed",
          conversationId: row.conversation_id,
          messageId: row.id,
          payload: { message, reason: "APP_SERVICE_RESTARTED" },
        });
      }),
    );
  }

  renameConversation(
    conversationId: string,
    title: string,
  ): { conversation: Conversation; event: ChatEvent } {
    return this.#updateConversation(conversationId, "title = ?", [title]);
  }

  selectConversationModel(
    conversationId: string,
    modelRef: string,
  ): { conversation: Conversation; event: ChatEvent } {
    return this.#updateConversation(conversationId, "selected_model_ref = ?", [modelRef]);
  }

  selectConversationThinkingLevel(
    conversationId: string,
    thinkingLevel: ThinkingLevel,
  ): { conversation: Conversation; event: ChatEvent } {
    return this.#updateConversation(conversationId, "thinking_level = ?", [thinkingLevel]);
  }

  selectedModelForMessage(messageId: string): string {
    const row = this.#database
      .prepare(
        `SELECT COALESCE(m.selected_model_ref, c.selected_model_ref) AS selected_model_ref
         FROM messages m
         JOIN conversations c ON c.id = m.conversation_id WHERE m.id = ?`,
      )
      .get(messageId) as SqlRow | undefined;
    if (!row) throw new Error("Message not found");
    return String(row.selected_model_ref);
  }

  thinkingLevelForMessage(messageId: string): ThinkingLevel {
    const row = this.#database
      .prepare(
        `SELECT COALESCE(m.thinking_level, c.thinking_level) AS thinking_level
         FROM messages m
         JOIN conversations c ON c.id = m.conversation_id WHERE m.id = ?`,
      )
      .get(messageId) as SqlRow | undefined;
    if (!row) throw new Error("Message not found");
    return String(row.thinking_level) as ThinkingLevel;
  }

  setConversationArchived(
    conversationId: string,
    archived: boolean,
  ): { conversation: Conversation; event: ChatEvent } {
    return this.#updateConversation(conversationId, "archived_at = ?", [
      archived ? this.#now() : null,
    ]);
  }

  deleteConversation(conversationId: string): {
    conversationId: string;
    deletedAt: string;
    event: ChatEvent | null;
  } {
    return this.#transaction(() => {
      const conversation = this.#getConversationEntity(conversationId);
      if (conversation.deletedAt) {
        return { conversationId, deletedAt: conversation.deletedAt, event: null };
      }
      const deletedAt = this.#now();
      this.#database
        .prepare(
          `UPDATE conversations SET deleted_at = ?, updated_at = ?, revision = revision + 1
           WHERE id = ?`,
        )
        .run(deletedAt, deletedAt, conversationId);
      const updated = this.#getConversationEntity(conversationId);
      this.#queueSyncDelete("conversation", conversationId, deletedAt);
      const event = this.#appendEvent({
        type: "conversation.deleted",
        conversationId,
        messageId: null,
        payload: { conversation: updated },
      });
      return { conversationId, deletedAt, event };
    });
  }

  activateBranch(
    conversationId: string,
    branchId: string,
  ): { snapshot: ConversationSnapshot; event: ChatEvent } {
    return this.#transaction(() => {
      const branch = this.#getBranch(branchId);
      if (branch.conversationId !== conversationId)
        throw new Error("Branch does not belong to conversation");
      const now = this.#now();
      this.#database
        .prepare(
          `UPDATE conversations SET active_branch_id = ?, updated_at = ?, revision = revision + 1
           WHERE id = ?`,
        )
        .run(branchId, now, conversationId);
      const snapshot = this.getConversation(conversationId);
      this.#queueSyncUpsert("conversation", conversationId, snapshot.conversation, now);
      const event = this.#appendEvent({
        type: "branch.activated",
        conversationId,
        messageId: null,
        payload: { conversation: snapshot.conversation },
      });
      return { snapshot, event };
    });
  }

  search(query: string, includeArchived = false): SearchResult[] {
    const escaped = query.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");
    const pattern = `%${escaped}%`;
    const rows = this.#database
      .prepare(
        `SELECT c.id AS conversation_id, c.active_branch_id AS branch_id, NULL AS message_id,
                c.title,
                CASE WHEN c.title LIKE ? ESCAPE '\\' THEN c.title ELSE (
                  SELECT p.text FROM messages m
                  JOIN message_parts p ON p.message_id = m.id AND p.position = 1
                  WHERE m.conversation_id = c.id AND p.text LIKE ? ESCAPE '\\'
                  ORDER BY m.updated_at DESC LIMIT 1
                ) END AS text,
                c.updated_at
         FROM conversations c
         WHERE c.deleted_at IS NULL AND (? = 1 OR c.archived_at IS NULL)
           AND (c.title LIKE ? ESCAPE '\\' OR EXISTS (
             SELECT 1 FROM messages m
             JOIN message_parts p ON p.message_id = m.id AND p.position = 1
             WHERE m.conversation_id = c.id AND p.text LIKE ? ESCAPE '\\'
           ))
         ORDER BY c.updated_at DESC LIMIT 100`,
      )
      .all(pattern, pattern, includeArchived ? 1 : 0, pattern, pattern) as SqlRow[];
    return rows.map((row) => {
      const text = row.text === null ? String(row.title) : String(row.text);
      const index = text.toLocaleLowerCase().indexOf(query.toLocaleLowerCase());
      return searchResultSchema.parse({
        conversationId: String(row.conversation_id),
        branchId:
          row.branch_id === null
            ? this.#getConversationEntity(String(row.conversation_id)).activeBranchId
            : String(row.branch_id),
        messageId: row.message_id === null ? null : String(row.message_id),
        title: String(row.title),
        excerpt: text.slice(Math.max(0, index - 40), Math.max(0, index - 40) + 140),
        updatedAt: String(row.updated_at),
      });
    });
  }

  pendingSyncOperations(): SyncOperation[] {
    if (!this.#syncEnabled()) return [];
    return (
      this.#database
        .prepare(
          `SELECT * FROM sync_outbox WHERE account_id = ? AND status = 'pending'
           ORDER BY rowid`,
        )
        .all(this.#ownerProfileId) as SqlRow[]
    ).map((row) =>
      syncOperationSchema.parse({
        operationId: row.operation_id,
        accountId: row.account_id,
        deviceId: row.device_id,
        objectType: row.object_type,
        objectId: row.object_id,
        mutation: row.mutation,
        baseRevision: row.base_revision,
        payloadVersion: row.payload_version,
        payload: row.payload_json === null ? null : JSON.parse(String(row.payload_json)),
        idempotencyKey: row.idempotency_key,
        createdAt: row.created_at,
      }),
    );
  }

  acknowledgeSync(result: SyncPushResult): void {
    if (!this.#syncEnabled()) return;
    this.#transaction(() => {
      const row = this.#database
        .prepare("SELECT * FROM sync_outbox WHERE operation_id = ? AND account_id = ?")
        .get(result.operationId, this.#ownerProfileId) as SqlRow | undefined;
      if (!row) throw new Error("SYNC_OUTBOX_OPERATION_NOT_FOUND");
      if (result.status === "committed") {
        this.#database
          .prepare("UPDATE sync_outbox SET status = 'committed' WHERE operation_id = ?")
          .run(result.operationId);
        this.#database
          .prepare(
            `INSERT INTO sync_object_state
             (account_id, object_type, object_id, cloud_revision, last_synced_payload_json)
             VALUES (?, ?, ?, ?, ?)
             ON CONFLICT(account_id, object_type, object_id) DO UPDATE SET
               cloud_revision = excluded.cloud_revision,
               last_synced_payload_json = excluded.last_synced_payload_json`,
          )
          .run(
            this.#ownerProfileId,
            String(row.object_type),
            String(row.object_id),
            result.revision,
            row.payload_json === null ? null : String(row.payload_json),
          );
      } else {
        this.#database
          .prepare("UPDATE sync_outbox SET status = 'conflict' WHERE operation_id = ?")
          .run(result.operationId);
        this.#database
          .prepare(
            `INSERT OR IGNORE INTO sync_local_conflicts
             (conflict_id, account_id, conflict_json, created_at) VALUES (?, ?, ?, ?)`,
          )
          .run(
            result.conflict.conflictId,
            this.#ownerProfileId,
            JSON.stringify(result.conflict),
            result.conflict.createdAt,
          );
      }
    });
  }

  applySyncPull(result: SyncPullResult): void {
    if (!this.#syncEnabled()) return;
    this.#transaction(() => {
      for (const change of result.changes) {
        if (change.accountId !== this.#ownerProfileId) throw new Error("ACCOUNT_SCOPE_VIOLATION");
        const localWrite = this.#database
          .prepare(
            `SELECT 1 FROM sync_outbox
             WHERE account_id = ? AND object_type = ? AND object_id = ?
               AND status IN ('pending', 'conflict')
             LIMIT 1`,
          )
          .get(this.#ownerProfileId, change.objectType, change.objectId);
        if (!localWrite) {
          this.#applySyncChange(
            change.objectType,
            change.objectId,
            change.tombstone,
            change.payload,
          );
        }
        this.#database
          .prepare(
            `INSERT INTO sync_object_state
             (account_id, object_type, object_id, cloud_revision, last_synced_payload_json)
             VALUES (?, ?, ?, ?, ?)
             ON CONFLICT(account_id, object_type, object_id) DO UPDATE SET
               cloud_revision = excluded.cloud_revision,
               last_synced_payload_json = excluded.last_synced_payload_json`,
          )
          .run(
            this.#ownerProfileId,
            change.objectType,
            change.objectId,
            change.revision,
            change.payload === null ? null : JSON.stringify(change.payload),
          );
      }
      this.#database
        .prepare(
          `INSERT INTO sync_replica_state(account_id, cursor) VALUES (?, ?)
           ON CONFLICT(account_id) DO UPDATE SET cursor = excluded.cursor`,
        )
        .run(this.#ownerProfileId, result.nextCursor);
    });
  }

  syncCursor(): string | null {
    if (!this.#syncEnabled()) return null;
    const row = this.#database
      .prepare("SELECT cursor FROM sync_replica_state WHERE account_id = ?")
      .get(this.#ownerProfileId) as SqlRow | undefined;
    return row ? String(row.cursor) : null;
  }

  syncConflicts(): SyncConflict[] {
    if (!this.#syncEnabled()) return [];
    return (
      this.#database
        .prepare(
          "SELECT conflict_json FROM sync_local_conflicts WHERE account_id = ? ORDER BY created_at",
        )
        .all(this.#ownerProfileId) as SqlRow[]
    ).map((row) => syncConflictSchema.parse(JSON.parse(String(row.conflict_json))));
  }

  resolveSyncConflict(conflictId: string, resolution: "local" | "cloud"): SyncConflict {
    return this.#transaction(() => {
      const row = this.#database
        .prepare(
          "SELECT conflict_json FROM sync_local_conflicts WHERE conflict_id = ? AND account_id = ?",
        )
        .get(conflictId, this.#ownerProfileId) as SqlRow | undefined;
      if (!row) throw new Error("SYNC_CONFLICT_NOT_FOUND");
      const conflict = syncConflictSchema.parse(JSON.parse(String(row.conflict_json)));
      this.#database
        .prepare("DELETE FROM sync_outbox WHERE operation_id = ? AND account_id = ?")
        .run(conflict.operationId, this.#ownerProfileId);
      if (resolution === "cloud") {
        this.#applySyncChange(
          conflict.objectType,
          conflict.objectId,
          conflict.serverPayload === null,
          conflict.serverPayload,
        );
      } else {
        this.#queueSync(
          conflict.objectType,
          conflict.objectId,
          conflict.clientPayload === null ? "delete" : "upsert",
          conflict.clientPayload,
          this.#now(),
        );
      }
      this.#database
        .prepare("DELETE FROM sync_local_conflicts WHERE conflict_id = ?")
        .run(conflictId);
      return syncConflictSchema.parse({ ...conflict, resolvedAt: this.#now() });
    });
  }

  clearLocalCache(): void {
    if (this.pendingSyncOperations().length > 0) throw new Error("SYNC_PENDING_WRITES_EXIST");
    if (this.syncConflicts().length > 0) throw new Error("SYNC_UNRESOLVED_CONFLICTS_EXIST");
    this.#transaction(() => {
      const now = this.#now();
      this.#database
        .prepare(
          `UPDATE workspace_grants SET revoked_at = COALESCE(revoked_at, ?)
           WHERE id IN (
             SELECT workspace_grant_id FROM project_directory_bindings
             WHERE owner_profile_id = ?
             UNION
             SELECT workspace_grant_id FROM workspace_bindings
             WHERE owner_profile_id = ? AND project_directory_binding_id IS NOT NULL
           )`,
        )
        .run(now, this.#ownerProfileId, this.#ownerProfileId);
      this.#database
        .prepare(
          `UPDATE capability_scopes SET revoked_at = COALESCE(revoked_at, ?)
           WHERE owner_profile_id = ? AND resource_type = 'workspace'
             AND resource IN (
               SELECT workspace_grant_id FROM project_directory_bindings
               WHERE owner_profile_id = ?
               UNION
               SELECT workspace_grant_id FROM workspace_bindings
               WHERE owner_profile_id = ? AND project_directory_binding_id IS NOT NULL
             )`,
        )
        .run(now, this.#ownerProfileId, this.#ownerProfileId, this.#ownerProfileId);
      this.#database.exec(`
        DELETE FROM byok_usage_records;
        DELETE FROM memory_merge_reviews;
        DELETE FROM memory_semantic_cluster_state;
        DELETE FROM memory_consolidation_runs;
        DELETE FROM memory_extraction_jobs;
        DELETE FROM memory_conversation_context;
        DELETE FROM memory_usage_events;
        DELETE FROM memory_entries;
        DELETE FROM memory_idempotency;
        DELETE FROM memory_conversation_settings;
        DELETE FROM memory_settings;
        DELETE FROM events;
        DELETE FROM message_parts;
        DELETE FROM messages;
        DELETE FROM branches;
        DELETE FROM conversations;
        DELETE FROM workspace_bindings WHERE project_directory_binding_id IS NOT NULL;
        DELETE FROM project_directory_bindings;
        DELETE FROM project_directories;
        DELETE FROM projects;
        DELETE FROM idempotency;
        DELETE FROM sync_object_state;
        DELETE FROM sync_replica_state;
        DELETE FROM sync_local_conflicts;
        DELETE FROM sync_outbox;
      `);
    });
  }

  listEvents(conversationId: string, afterSequence: number): ChatEvent[] {
    return this.#eventRows(conversationId, afterSequence);
  }

  piHistory(assistantMessageId: string): PiHistoryMessage[] {
    const assistant = this.#message(assistantMessageId);
    return this.#resolveBranch(assistant.branchId)
      .filter((message) => message.id !== assistantMessageId)
      .filter((message) => message.role !== "assistant" || message.status === "completed")
      .map((message) => ({
        messageId: message.id,
        role: message.role,
        text: message.parts.map((part) => part.text).join("\n\n"),
      }));
  }

  branchMessageIds(assistantMessageId: string): string[] {
    const assistant = this.#message(assistantMessageId);
    return this.#resolveBranch(assistant.branchId).map(({ id }) => id);
  }

  message(messageId: string): Message {
    return this.#message(messageId);
  }

  #forkGeneration(input: {
    command: "chat.regenerate" | "chat.edit";
    conversationId: string;
    targetMessageId: string;
    idempotencyKey: string;
    replacementText: string | null;
  }): GenerationDraft {
    return this.#transaction(() => {
      const conversation = this.#getConversationEntity(input.conversationId);
      const path = this.#resolveBranch(conversation.activeBranchId);
      const targetIndex = path.findIndex(({ id }) => id === input.targetMessageId);
      const target = path[targetIndex];
      if (!target) throw new Error("Target message is not on the active branch");
      if (input.replacementText === null && target.role !== "assistant") {
        throw new Error("Only assistant messages can be regenerated");
      }
      if (input.replacementText !== null && target.role !== "user") {
        throw new Error("Only user messages can be edited");
      }
      const forkedFromMessageId = path[targetIndex - 1]?.id ?? null;
      const now = this.#now();
      const branchId = this.#idFactory();
      this.#database
        .prepare(
          `INSERT INTO branches
           (id, conversation_id, parent_branch_id, forked_from_message_id, label, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(
          branchId,
          input.conversationId,
          conversation.activeBranchId,
          forkedFromMessageId,
          `分支 ${this.#branchCount(input.conversationId) + 1}`,
          now,
        );
      let userMessageId: string | null = null;
      let replacementUser: Message | null = null;
      let parentMessageId = forkedFromMessageId;
      if (input.replacementText !== null) {
        const user = this.#insertMessage({
          conversationId: input.conversationId,
          branchId,
          parentMessageId,
          role: "user",
          status: "completed",
          text: input.replacementText,
          selectedModelRef: conversation.selectedModelRef,
          thinkingLevel: conversation.thinkingLevel,
          attempt: target.attempt + 1,
          now,
        });
        userMessageId = user.id;
        replacementUser = user;
        parentMessageId = user.id;
      }
      const assistant = this.#insertMessage({
        conversationId: input.conversationId,
        branchId,
        parentMessageId,
        role: "assistant",
        status: "pending",
        text: "",
        selectedModelRef: conversation.selectedModelRef,
        thinkingLevel: conversation.thinkingLevel,
        attempt: target.attempt + 1,
        now,
      });
      this.#database
        .prepare(
          `UPDATE conversations SET active_branch_id = ?, updated_at = ?, revision = revision + 1
           WHERE id = ?`,
        )
        .run(branchId, now, input.conversationId);
      this.#queueSyncUpsert("branch", branchId, this.#getBranch(branchId), now);
      if (replacementUser) {
        this.#queueSyncUpsert("message", replacementUser.id, replacementUser, now);
      }
      this.#queueSyncUpsert("message", assistant.id, assistant, now);
      this.#queueSyncUpsert(
        "conversation",
        input.conversationId,
        this.#getConversationEntity(input.conversationId),
        now,
      );
      const events = [
        this.#appendEvent({
          type: "branch.activated",
          conversationId: input.conversationId,
          messageId: null,
          payload: { conversation: this.#getConversationEntity(input.conversationId) },
        }),
        this.#appendEvent({
          type: "message.accepted",
          conversationId: input.conversationId,
          messageId: assistant.id,
          payload: { message: assistant },
        }),
      ];
      const receipt = generationReceiptSchema.parse({
        conversationId: input.conversationId,
        branchId,
        userMessageId,
        assistantMessageId: assistant.id,
      });
      this.#storeIdempotentResult(input.idempotencyKey, input.command, receipt, now);
      return {
        receipt,
        events,
        created: true,
        selectedModelRef: conversation.selectedModelRef,
        thinkingLevel: conversation.thinkingLevel,
      };
    });
  }

  #insertMessage(input: {
    conversationId: string;
    branchId: string;
    parentMessageId: string | null;
    role: Message["role"];
    status: Message["status"];
    text: string;
    selectedModelRef: string;
    thinkingLevel: ThinkingLevel;
    attempt: number;
    now: string;
  }): Message {
    const id = this.#idFactory();
    const positionRow = this.#database
      .prepare(
        "SELECT COALESCE(MAX(position), 0) + 1 AS position FROM messages WHERE branch_id = ?",
      )
      .get(input.branchId) as { position: number };
    this.#database
      .prepare(
        `INSERT INTO messages
         (id, conversation_id, branch_id, parent_message_id, role, status, error_code, attempt,
          created_at, updated_at, revision, position, runtime_sequence, selected_model_ref,
          thinking_level)
         VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, 1, ?, 0, ?, ?)`,
      )
      .run(
        id,
        input.conversationId,
        input.branchId,
        input.parentMessageId,
        input.role,
        input.status,
        input.attempt,
        input.now,
        input.now,
        Number(positionRow.position),
        input.selectedModelRef,
        input.thinkingLevel,
      );
    this.#database
      .prepare(
        "INSERT INTO message_parts(id, message_id, position, type, text) VALUES (?, ?, 1, 'text', ?)",
      )
      .run(this.#idFactory(), id, input.text);
    return this.#message(id);
  }

  #resolveBranch(branchId: string): Message[] {
    const chain: Branch[] = [];
    let cursor: string | null = branchId;
    while (cursor) {
      const branch = this.#getBranch(cursor);
      chain.push(branch);
      cursor = branch.parentBranchId;
      if (chain.length > 100) throw new Error("Branch ancestry limit exceeded");
    }
    chain.reverse();
    let resolved: Message[] = [];
    for (const branch of chain) {
      if (branch.parentBranchId) {
        if (branch.forkedFromMessageId === null) {
          resolved = [];
        } else {
          const cutoff = resolved.findIndex(({ id }) => id === branch.forkedFromMessageId);
          if (cutoff < 0) throw new Error(`Invalid branch cutoff: ${branch.forkedFromMessageId}`);
          resolved = resolved.slice(0, cutoff + 1);
        }
      }
      const ownRows = this.#database
        .prepare("SELECT * FROM messages WHERE branch_id = ? ORDER BY position")
        .all(branch.id) as SqlRow[];
      resolved.push(...ownRows.map((row) => this.#messageFromRow(row)));
    }
    return resolved;
  }

  #message(id: string): Message {
    return this.#messageFromRow(this.#messageRow(id));
  }

  #messageRow(id: string): SqlRow {
    const row = this.#database.prepare("SELECT * FROM messages WHERE id = ?").get(id) as
      | SqlRow
      | undefined;
    if (!row) throw new Error("Message not found");
    return row;
  }

  #messageFromRow(row: SqlRow): Message {
    const parts = this.#database
      .prepare("SELECT id, type, text FROM message_parts WHERE message_id = ? ORDER BY position")
      .all(String(row.id));
    const storedStatus = String(row.status) as Message["status"];
    const cancellationRequestedAt = row.cancellation_requested_at ?? null;
    const status: Message["status"] =
      cancellationRequestedAt !== null &&
      (storedStatus === "pending" || storedStatus === "streaming")
        ? "cancelling"
        : cancellationRequestedAt !== null && storedStatus === "stopped"
          ? "interrupted"
          : storedStatus;
    return messageSchema.parse({
      id: row.id,
      conversationId: row.conversation_id,
      branchId: row.branch_id,
      parentMessageId: row.parent_message_id,
      role: row.role,
      status,
      parts,
      errorCode: row.error_code,
      cancellationRequestedAt,
      attempt: Number(row.attempt),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      revision: Number(row.revision),
    });
  }

  #getConversationEntity(id: string): Conversation {
    const row = this.#database.prepare("SELECT * FROM conversations WHERE id = ?").get(id) as
      | SqlRow
      | undefined;
    if (!row) throw new Error("Conversation not found");
    return this.#conversation(row);
  }

  #conversation(row: SqlRow): Conversation {
    return conversationSchema.parse({
      id: row.id,
      ownerProfileId: row.owner_profile_id,
      projectId: row.project_id,
      title: row.title,
      activeBranchId: row.active_branch_id,
      selectedModelRef: row.selected_model_ref,
      thinkingLevel: row.thinking_level,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      archivedAt: row.archived_at,
      deletedAt: row.deleted_at,
      revision: Number(row.revision),
    });
  }

  #getBranch(id: string): Branch {
    const row = this.#database.prepare("SELECT * FROM branches WHERE id = ?").get(id) as
      | SqlRow
      | undefined;
    if (!row) throw new Error("Branch not found");
    return this.#branch(row);
  }

  #assertProjectAvailable(projectId: string): void {
    const row = this.#database
      .prepare(
        `SELECT archived_at FROM projects
         WHERE id = ? AND owner_profile_id = ?`,
      )
      .get(projectId, this.#ownerProfileId) as { archived_at: string | null } | undefined;
    if (!row) throw new Error("PROJECT_NOT_FOUND");
    if (row.archived_at) throw new Error("PROJECT_ARCHIVED");
  }

  #branch(row: SqlRow): Branch {
    return branchSchema.parse({
      id: row.id,
      conversationId: row.conversation_id,
      parentBranchId: row.parent_branch_id,
      forkedFromMessageId: row.forked_from_message_id,
      label: row.label,
      createdAt: row.created_at,
    });
  }

  #touchConversation(conversationId: string, now: string): void {
    this.#database
      .prepare("UPDATE conversations SET updated_at = ?, revision = revision + 1 WHERE id = ?")
      .run(now, conversationId);
  }

  #appendEvent(input: {
    type: ChatEvent["type"];
    conversationId: string;
    messageId: string | null;
    occurredAt?: string;
    payload: ChatEvent["payload"];
  }): ChatEvent {
    const sequenceRow = this.#database
      .prepare(
        "SELECT COALESCE(MAX(sequence), 0) + 1 AS sequence FROM events WHERE conversation_id = ?",
      )
      .get(input.conversationId) as { sequence: number };
    const event = chatEventSchema.parse({
      eventId: this.#idFactory(),
      type: input.type,
      conversationId: input.conversationId,
      messageId: input.messageId,
      sequence: Number(sequenceRow.sequence),
      occurredAt: input.occurredAt ?? this.#now(),
      payloadVersion: 1,
      payload: input.payload,
    });
    this.#database
      .prepare(
        `INSERT INTO events
         (event_id, conversation_id, message_id, sequence, type, occurred_at, payload_version, payload_json)
         VALUES (?, ?, ?, ?, ?, ?, 1, ?)`,
      )
      .run(
        event.eventId,
        event.conversationId,
        event.messageId,
        event.sequence,
        event.type,
        event.occurredAt,
        JSON.stringify(event.payload),
      );
    return event;
  }

  #eventRows(conversationId: string, afterSequence: number): ChatEvent[] {
    const rows = this.#database
      .prepare("SELECT * FROM events WHERE conversation_id = ? AND sequence > ? ORDER BY sequence")
      .all(conversationId, afterSequence) as SqlRow[];
    return rows.map((row) =>
      chatEventSchema.parse({
        eventId: row.event_id,
        type: row.type,
        conversationId: row.conversation_id,
        messageId: row.message_id,
        sequence: Number(row.sequence),
        occurredAt: row.occurred_at,
        payloadVersion: 1,
        payload: JSON.parse(String(row.payload_json)) as unknown,
      }),
    );
  }

  #updateConversation(
    conversationId: string,
    assignment: string,
    values: Array<string | null>,
  ): { conversation: Conversation; event: ChatEvent } {
    return this.#transaction(() => {
      this.#getConversationEntity(conversationId);
      const now = this.#now();
      this.#database
        .prepare(
          `UPDATE conversations SET ${assignment}, updated_at = ?, revision = revision + 1 WHERE id = ?`,
        )
        .run(...values, now, conversationId);
      const conversation = this.#getConversationEntity(conversationId);
      this.#queueSyncUpsert("conversation", conversationId, conversation, now);
      const event = this.#appendEvent({
        type: "conversation.updated",
        conversationId,
        messageId: null,
        payload: { conversation },
      });
      return { conversation, event };
    });
  }

  #syncEnabled(): boolean {
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    return uuid.test(this.#ownerProfileId) && this.#deviceId !== null && uuid.test(this.#deviceId);
  }

  #queueSyncUpsert(
    objectType: "conversation" | "branch" | "message",
    objectId: string,
    payload: Conversation | Branch | Message,
    createdAt: string,
  ): void {
    this.#queueSync(objectType, objectId, "upsert", JSON.parse(JSON.stringify(payload)), createdAt);
  }

  #queueSyncDelete(objectType: "conversation", objectId: string, createdAt: string): void {
    this.#queueSync(objectType, objectId, "delete", null, createdAt);
  }

  #queueSync(
    objectType: SyncOperation["objectType"],
    objectId: string,
    mutation: "upsert" | "delete",
    payload: Record<string, unknown> | null,
    createdAt: string,
  ): void {
    if (!this.#syncEnabled() || !this.#deviceId) return;
    const state = this.#database
      .prepare(
        `SELECT cloud_revision FROM sync_object_state
         WHERE account_id = ? AND object_type = ? AND object_id = ?`,
      )
      .get(this.#ownerProfileId, objectType, objectId) as SqlRow | undefined;
    const pending = this.#database
      .prepare(
        `SELECT COUNT(*) AS count FROM sync_outbox
         WHERE account_id = ? AND object_type = ? AND object_id = ? AND status = 'pending'`,
      )
      .get(this.#ownerProfileId, objectType, objectId) as { count: number };
    const operationId = this.#idFactory();
    this.#database
      .prepare(
        `INSERT INTO sync_outbox
         (operation_id, account_id, device_id, object_type, object_id, mutation,
          base_revision, payload_version, payload_json, idempotency_key, created_at, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, 'pending')`,
      )
      .run(
        operationId,
        this.#ownerProfileId,
        this.#deviceId,
        objectType,
        objectId,
        mutation,
        Number(state?.cloud_revision ?? 0) + Number(pending.count),
        payload === null ? null : JSON.stringify(payload),
        `sync:${operationId}`,
        createdAt,
      );
  }

  #reconcileMemoryGroup(
    kind: string,
    canonicalKey: string | null,
    conflictKey: string | null,
    now: string,
  ): void {
    type SlotRow = {
      id: string;
      origin: "explicit" | "automatic" | "consolidated";
      status: "active" | "superseded";
      canonical_key: string | null;
      supersedes_memory_id: string | null;
      expires_at: string | null;
      created_at: string;
      updated_at: string;
    };
    const entries = (
      conflictKey
        ? this.#database
            .prepare(
              `SELECT id, origin, status, canonical_key, supersedes_memory_id,
                      expires_at, created_at, updated_at
               FROM memory_entries
               WHERE owner_profile_id = ? AND kind = ? AND conflict_key = ?
                 AND status != 'deleted'
               ORDER BY id`,
            )
            .all(this.#ownerProfileId, kind, conflictKey)
        : this.#database
            .prepare(
              `SELECT id, origin, status, canonical_key, supersedes_memory_id,
                      expires_at, created_at, updated_at
               FROM memory_entries
               WHERE owner_profile_id = ? AND kind = ? AND canonical_key = ?
                 AND status != 'deleted'
               ORDER BY id`,
            )
            .all(this.#ownerProfileId, kind, canonicalKey)
    ) as SlotRow[];
    if (entries.length === 0) return;
    const nowMs = Date.parse(now);
    const viable = (entry: SlotRow): boolean =>
      entry.expires_at === null || Date.parse(entry.expires_at) > nowMs;
    const originPriority = (entry: SlotRow): number => (entry.origin === "explicit" ? 2 : 1);
    const compare = (left: SlotRow, right: SlotRow): number => {
      const leftViable = viable(left);
      const rightViable = viable(right);
      if (leftViable !== rightViable) return leftViable ? -1 : 1;
      const priority = originPriority(right) - originPriority(left);
      if (priority !== 0) return priority;
      if (left.updated_at !== right.updated_at) {
        return left.updated_at > right.updated_at ? -1 : 1;
      }
      if (left.created_at !== right.created_at) {
        return left.created_at > right.created_at ? -1 : 1;
      }
      if (left.id === right.id) return 0;
      return left.id > right.id ? -1 : 1;
    };
    const remaining = new Map(entries.map((entry) => [entry.id, entry]));
    const ordered: SlotRow[] = [];
    while (remaining.size > 0) {
      const candidates = [...remaining.values()];
      const viableCandidates = candidates.filter(viable);
      const pool = viableCandidates.length > 0 ? viableCandidates : candidates;
      const highestPriority = Math.max(...pool.map(originPriority));
      const preferred = pool.filter((entry) => originPriority(entry) === highestPriority);
      const preferredIds = new Set(preferred.map(({ id }) => id));
      const supersededIds = new Set(
        preferred
          .map(({ supersedes_memory_id: supersedesMemoryId }) => supersedesMemoryId)
          .filter(
            (memoryId): memoryId is string => memoryId !== null && preferredIds.has(memoryId),
          ),
      );
      const roots = preferred.filter(({ id }) => !supersededIds.has(id));
      const next = [...(roots.length > 0 ? roots : preferred)].sort(compare)[0];
      if (!next) break;
      ordered.push(next);
      remaining.delete(next.id);
    }
    const winner = entries.some(viable) ? ordered[0] : undefined;
    const update = this.#database.prepare(
      `UPDATE memory_entries
       SET status = ?, supersedes_memory_id = ?, revision = revision + 1
       WHERE id = ? AND owner_profile_id = ?`,
    );
    for (let index = 1; index < ordered.length; index += 1) {
      const entry = ordered[index];
      if (!entry) continue;
      const supersedesMemoryId = ordered[index + 1]?.id ?? null;
      if (entry.status === "superseded" && entry.supersedes_memory_id === supersedesMemoryId) {
        continue;
      }
      update.run("superseded", supersedesMemoryId, entry.id, this.#ownerProfileId);
    }
    const first = ordered[0];
    if (!first) return;
    let firstStatus = winner ? "active" : "superseded";
    if (firstStatus === "active" && first.canonical_key) {
      const canonicalCollision = this.#database
        .prepare(
          `SELECT 1 FROM memory_entries
           WHERE owner_profile_id = ? AND kind = ? AND canonical_key = ?
             AND status = 'active' AND id != ? LIMIT 1`,
        )
        .get(this.#ownerProfileId, kind, first.canonical_key, first.id);
      if (canonicalCollision) firstStatus = "superseded";
    }
    const firstSupersedesMemoryId = ordered[1]?.id ?? null;
    if (first.status !== firstStatus || first.supersedes_memory_id !== firstSupersedesMemoryId) {
      update.run(firstStatus, firstSupersedesMemoryId, first.id, this.#ownerProfileId);
    }
  }

  #revokeSyncedProjectDirectory(projectDirectoryId: string, now: string): void {
    const bindings = this.#database
      .prepare(
        `SELECT id, workspace_grant_id FROM project_directory_bindings
         WHERE project_directory_id = ? AND owner_profile_id = ? AND revoked_at IS NULL`,
      )
      .all(projectDirectoryId, this.#ownerProfileId) as Array<{
      id: string;
      workspace_grant_id: string;
    }>;
    for (const binding of bindings) {
      this.#database
        .prepare(
          `UPDATE workspace_grants
           SET revoked_at = COALESCE(revoked_at, ?)
           WHERE id = ? OR id IN (
             SELECT workspace_grant_id FROM workspace_bindings
             WHERE project_directory_binding_id = ?
           )`,
        )
        .run(now, binding.workspace_grant_id, binding.id);
      this.#database
        .prepare(
          `UPDATE capability_scopes
           SET revoked_at = COALESCE(revoked_at, ?)
           WHERE owner_profile_id = ? AND resource_type = 'workspace'
             AND (
               resource = ? OR resource IN (
                 SELECT workspace_grant_id FROM workspace_bindings
                 WHERE project_directory_binding_id = ?
               )
             )`,
        )
        .run(now, this.#ownerProfileId, binding.workspace_grant_id, binding.id);
      this.#database
        .prepare("DELETE FROM workspace_bindings WHERE project_directory_binding_id = ?")
        .run(binding.id);
      this.#database
        .prepare(
          `UPDATE project_directory_bindings
           SET revoked_at = COALESCE(revoked_at, ?), updated_at = ?, revision = revision + 1
           WHERE id = ? AND owner_profile_id = ?`,
        )
        .run(now, now, binding.id, this.#ownerProfileId);
    }
  }

  #applySyncChange(
    objectType: string,
    objectId: string,
    tombstone: boolean,
    payload: Record<string, unknown> | null,
  ): void {
    if (tombstone) {
      if (objectType === "project_directory") {
        const now = this.#now();
        this.#revokeSyncedProjectDirectory(objectId, now);
        this.#database
          .prepare(
            `UPDATE project_directories
             SET deleted_at = COALESCE(deleted_at, ?), updated_at = ?
             WHERE id = ? AND owner_profile_id = ?`,
          )
          .run(now, now, objectId, this.#ownerProfileId);
      }
      if (objectType === "project") {
        const now = this.#now();
        this.#database
          .prepare(
            `UPDATE projects SET archived_at = COALESCE(archived_at, ?), updated_at = ?
             WHERE id = ? AND owner_profile_id = ?`,
          )
          .run(now, now, objectId, this.#ownerProfileId);
      }
      if (objectType === "conversation") {
        this.#database
          .prepare("UPDATE conversations SET deleted_at = COALESCE(deleted_at, ?) WHERE id = ?")
          .run(this.#now(), objectId);
      }
      if (objectType === "skill_installation") {
        this.#database
          .prepare(
            `UPDATE skill_installations SET enabled = 0, desired_enabled = 0,
             deleted_at = COALESCE(deleted_at, ?), updated_at = ?
             WHERE id = ? AND owner_profile_id = ?`,
          )
          .run(this.#now(), this.#now(), objectId, this.#ownerProfileId);
      }
      if (objectType === "memory_entry") {
        const now = this.#now();
        const existing = this.#database
          .prepare(
            `SELECT kind, canonical_key, conflict_key
             FROM memory_entries WHERE id = ? AND owner_profile_id = ?`,
          )
          .get(objectId, this.#ownerProfileId) as
          | {
              kind: string;
              canonical_key: string | null;
              conflict_key: string | null;
            }
          | undefined;
        this.#database
          .prepare(
            `UPDATE memory_entries SET status = 'deleted', updated_at = ?, revision = revision + 1
             WHERE id = ? AND owner_profile_id = ?`,
          )
          .run(now, objectId, this.#ownerProfileId);
        if (existing && (existing.canonical_key || existing.conflict_key)) {
          this.#reconcileMemoryGroup(
            existing.kind,
            existing.canonical_key,
            existing.conflict_key,
            now,
          );
        }
      }
      if (objectType === "memory_settings") {
        this.#database
          .prepare("DELETE FROM memory_settings WHERE owner_profile_id = ?")
          .run(this.#ownerProfileId);
      }
      if (objectType === "memory_conversation_settings") {
        this.#database
          .prepare(
            `DELETE FROM memory_conversation_settings
             WHERE conversation_id = ? AND owner_profile_id = ?`,
          )
          .run(objectId, this.#ownerProfileId);
      }
      return;
    }
    if (!payload) throw new Error("SYNC_PAYLOAD_MISSING");
    if (objectType === "project") {
      const project = projectSyncPayloadSchema.parse(payload);
      if (project.ownerProfileId !== this.#ownerProfileId || project.id !== objectId) {
        throw new Error("ACCOUNT_SCOPE_VIOLATION");
      }
      this.#database
        .prepare(
          `INSERT INTO projects
           (id, owner_profile_id, name, instructions, pinned_rank, created_at, updated_at,
            archived_at, revision)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             name = excluded.name,
             instructions = excluded.instructions,
             pinned_rank = excluded.pinned_rank,
             updated_at = excluded.updated_at,
             archived_at = excluded.archived_at,
             revision = excluded.revision
           WHERE owner_profile_id = excluded.owner_profile_id`,
        )
        .run(
          project.id,
          project.ownerProfileId,
          project.name,
          project.instructions,
          project.pinnedRank,
          project.createdAt,
          project.updatedAt,
          project.archivedAt,
          project.revision,
        );
      return;
    }
    if (objectType === "project_directory") {
      const directory = projectDirectorySyncPayloadSchema.parse(payload);
      if (directory.ownerProfileId !== this.#ownerProfileId || directory.id !== objectId) {
        throw new Error("ACCOUNT_SCOPE_VIOLATION");
      }
      const project = this.#database
        .prepare("SELECT owner_profile_id FROM projects WHERE id = ?")
        .get(directory.projectId) as { owner_profile_id: string } | undefined;
      if (!project || project.owner_profile_id !== this.#ownerProfileId) {
        throw new Error("ACCOUNT_SCOPE_VIOLATION");
      }
      this.#database
        .prepare(
          `INSERT INTO project_directories
           (id, owner_profile_id, project_id, display_name, role, desired_access,
            created_at, updated_at, deleted_at, revision)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)
           ON CONFLICT(id) DO UPDATE SET
             project_id = excluded.project_id,
             display_name = excluded.display_name,
             role = excluded.role,
             desired_access = excluded.desired_access,
             updated_at = excluded.updated_at,
             deleted_at = NULL,
             revision = excluded.revision
           WHERE owner_profile_id = excluded.owner_profile_id`,
        )
        .run(
          directory.id,
          directory.ownerProfileId,
          directory.projectId,
          directory.displayName,
          directory.role,
          directory.desiredAccess,
          directory.createdAt,
          directory.updatedAt,
          directory.revision,
        );
      return;
    }
    if (objectType === "memory_settings") {
      const settings = memorySettingsSchema.parse(payload);
      if (settings.ownerProfileId !== this.#ownerProfileId || objectId !== this.#ownerProfileId) {
        throw new Error("ACCOUNT_SCOPE_VIOLATION");
      }
      this.#database
        .prepare(
          `INSERT INTO memory_settings
           (owner_profile_id, memories_enabled, use_memories, generate_memories, sync_memories,
            disable_on_external_context, idle_delay_minutes,
            min_rate_limit_remaining_percent, updated_at, revision)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(owner_profile_id) DO UPDATE SET
             memories_enabled = excluded.memories_enabled,
             use_memories = excluded.use_memories,
             generate_memories = excluded.generate_memories,
             sync_memories = excluded.sync_memories,
             disable_on_external_context = excluded.disable_on_external_context,
             idle_delay_minutes = excluded.idle_delay_minutes,
             min_rate_limit_remaining_percent = excluded.min_rate_limit_remaining_percent,
             updated_at = excluded.updated_at,
             revision = excluded.revision`,
        )
        .run(
          settings.ownerProfileId,
          settings.memoriesEnabled ? 1 : 0,
          settings.useMemories ? 1 : 0,
          settings.generateMemories ? 1 : 0,
          settings.syncMemories ? 1 : 0,
          settings.disableOnExternalContext ? 1 : 0,
          settings.idleDelayMinutes,
          settings.minRateLimitRemainingPercent,
          settings.updatedAt,
          settings.revision,
        );
      return;
    }
    if (objectType === "memory_entry") {
      const receivedMemory = memoryEntrySchema.parse(payload);
      let memory = receivedMemory;
      if (memory.ownerProfileId !== this.#ownerProfileId || memory.id !== objectId) {
        throw new Error("ACCOUNT_SCOPE_VIOLATION");
      }
      if (
        memory.status === "active" &&
        (memory.canonicalKey !== null || memory.conflictKey !== null)
      ) {
        const existingActive = this.#database
          .prepare(
            `SELECT id FROM memory_entries
             WHERE owner_profile_id = ? AND kind = ? AND status = 'active' AND id != ?
               AND ((? IS NOT NULL AND canonical_key = ?)
                 OR (? IS NOT NULL AND conflict_key = ?))
             LIMIT 1`,
          )
          .get(
            this.#ownerProfileId,
            memory.kind,
            memory.id,
            memory.canonicalKey,
            memory.canonicalKey,
            memory.conflictKey,
            memory.conflictKey,
          );
        if (existingActive) {
          memory = memoryEntrySchema.parse({ ...receivedMemory, status: "superseded" });
        }
      }
      this.#database
        .prepare(
          `INSERT INTO memory_entries
           (id, owner_profile_id, scope, kind, content, retrieval_keys_json, canonical_key, conflict_key,
             origin, confidence, status, source_conversation_id, source_message_id,
             supersedes_memory_id, expires_at, created_at, updated_at, revision)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             scope = excluded.scope, kind = excluded.kind, content = excluded.content,
             retrieval_keys_json = excluded.retrieval_keys_json,
              canonical_key = excluded.canonical_key, conflict_key = excluded.conflict_key,
              origin = excluded.origin,
             confidence = excluded.confidence, status = excluded.status,
             source_conversation_id = excluded.source_conversation_id,
             source_message_id = excluded.source_message_id,
             supersedes_memory_id = excluded.supersedes_memory_id,
             expires_at = excluded.expires_at, updated_at = excluded.updated_at,
             revision = excluded.revision
           WHERE owner_profile_id = excluded.owner_profile_id`,
        )
        .run(
          memory.id,
          memory.ownerProfileId,
          memory.scope,
          memory.kind,
          memory.content,
          JSON.stringify(memory.retrievalKeys),
          memory.canonicalKey,
          memory.conflictKey,
          memory.origin,
          memory.confidence,
          memory.status,
          memory.sourceConversationId,
          memory.sourceMessageId,
          memory.supersedesMemoryId,
          memory.expiresAt,
          memory.createdAt,
          memory.updatedAt,
          memory.revision,
        );
      if (memory.canonicalKey !== null || memory.conflictKey !== null) {
        this.#reconcileMemoryGroup(
          memory.kind,
          memory.canonicalKey,
          memory.conflictKey,
          this.#now(),
        );
      }
      if (memory.sourceConversationId) {
        this.#database
          .prepare(
            `INSERT INTO memory_source_links
             (memory_id, owner_profile_id, conversation_id, message_id,
              origin, confidence, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(owner_profile_id, memory_id, conversation_id) DO UPDATE SET
               message_id = COALESCE(excluded.message_id, memory_source_links.message_id),
               origin = CASE
                 WHEN memory_source_links.origin = 'explicit' THEN 'explicit'
                 WHEN excluded.origin = 'explicit' THEN 'explicit'
                 WHEN memory_source_links.origin = 'consolidated' THEN 'consolidated'
                 ELSE excluded.origin
               END,
               confidence = MAX(memory_source_links.confidence, excluded.confidence)`,
          )
          .run(
            memory.id,
            memory.ownerProfileId,
            memory.sourceConversationId,
            memory.sourceMessageId,
            memory.origin,
            memory.confidence,
            memory.createdAt,
          );
      }
      return;
    }
    if (objectType === "memory_conversation_settings") {
      const settings = conversationMemorySettingsSchema.parse(payload);
      if (
        settings.ownerProfileId !== this.#ownerProfileId ||
        settings.conversationId !== objectId
      ) {
        throw new Error("ACCOUNT_SCOPE_VIOLATION");
      }
      this.#database
        .prepare(
          `INSERT INTO memory_conversation_settings
           (conversation_id, owner_profile_id, use_memories, generate_memories, updated_at, revision)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(owner_profile_id, conversation_id) DO UPDATE SET
             use_memories = excluded.use_memories,
             generate_memories = excluded.generate_memories,
             updated_at = excluded.updated_at,
             revision = excluded.revision`,
        )
        .run(
          settings.conversationId,
          settings.ownerProfileId,
          settings.useMemories === null ? null : settings.useMemories ? 1 : 0,
          settings.generateMemories === null ? null : settings.generateMemories ? 1 : 0,
          settings.updatedAt,
          settings.revision,
        );
      return;
    }
    if (objectType === "skill_installation") {
      const skill = skillInstallationSyncSchema.parse(payload);
      if (skill.ownerProfileId !== this.#ownerProfileId || skill.id !== objectId) {
        throw new Error("ACCOUNT_SCOPE_VIOLATION");
      }
      const localVersion = this.#database
        .prepare(
          `SELECT id FROM skill_versions
           WHERE installation_id = ? AND version = ? AND checksum_sha256 = ?`,
        )
        .get(skill.id, skill.version, skill.checksumSha256) as { id: string } | undefined;
      const existing = this.#database
        .prepare(
          `SELECT approved_permission_digest FROM skill_installations
           WHERE id = ? AND owner_profile_id = ?`,
        )
        .get(skill.id, this.#ownerProfileId) as
        | { approved_permission_digest: string | null }
        | undefined;
      const approved =
        existing?.approved_permission_digest === skill.permissionDigest
          ? existing.approved_permission_digest
          : null;
      const enabled =
        Boolean(localVersion) &&
        skill.enabled &&
        (skill.permissions.length === 0 || approved === skill.permissionDigest);
      this.#database
        .prepare(
          `INSERT INTO skill_installations
           (id, owner_profile_id, name, display_name, description, publisher, scope, workspace_id,
            source_kind, source_label, trust, desired_enabled, enabled, auto_invoke, package_state,
            active_version_id, selected_version, selected_checksum_sha256, permission_digest,
            approved_permission_digest, declared_tools_json, declared_mcp_servers_json,
            permissions_json, platforms_json, installed_at, updated_at, last_used_at, deleted_at,
            revision)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                   NULL, NULL, ?)
           ON CONFLICT(id) DO UPDATE SET
             name = excluded.name, display_name = excluded.display_name,
             description = excluded.description, publisher = excluded.publisher,
             scope = excluded.scope, workspace_id = excluded.workspace_id,
             source_kind = excluded.source_kind, source_label = excluded.source_label,
             trust = excluded.trust, desired_enabled = excluded.desired_enabled,
             enabled = excluded.enabled, auto_invoke = excluded.auto_invoke,
             package_state = excluded.package_state, active_version_id = excluded.active_version_id,
             selected_version = excluded.selected_version,
             selected_checksum_sha256 = excluded.selected_checksum_sha256,
             permission_digest = excluded.permission_digest,
             approved_permission_digest = excluded.approved_permission_digest,
             declared_tools_json = excluded.declared_tools_json,
             declared_mcp_servers_json = excluded.declared_mcp_servers_json,
             permissions_json = excluded.permissions_json, platforms_json = excluded.platforms_json,
             updated_at = excluded.updated_at, deleted_at = NULL, revision = excluded.revision
           WHERE owner_profile_id = excluded.owner_profile_id`,
        )
        .run(
          skill.id,
          skill.ownerProfileId,
          skill.name,
          skill.displayName,
          skill.description,
          skill.publisher,
          skill.scope,
          skill.workspaceId,
          skill.sourceKind,
          skill.sourceLabel,
          skill.trust,
          skill.enabled ? 1 : 0,
          enabled ? 1 : 0,
          skill.autoInvoke ? 1 : 0,
          localVersion ? "installed" : "missing",
          localVersion?.id ?? null,
          skill.version,
          skill.checksumSha256,
          skill.permissionDigest,
          approved,
          JSON.stringify(skill.declaredTools),
          JSON.stringify(skill.declaredMcpServers),
          JSON.stringify(skill.permissions),
          JSON.stringify(skill.platforms),
          skill.installedAt,
          skill.updatedAt,
          skill.revision,
        );
      return;
    }
    if (objectType === "conversation") {
      const conversation = conversationSchema.parse(payload);
      if (conversation.ownerProfileId !== this.#ownerProfileId) {
        throw new Error("ACCOUNT_SCOPE_VIOLATION");
      }
      this.#database
        .prepare(
          `INSERT INTO conversations
            (id, owner_profile_id, project_id, title, active_branch_id, selected_model_ref, thinking_level,
             created_at, updated_at, archived_at, deleted_at, revision)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
              owner_profile_id = excluded.owner_profile_id,
              project_id = excluded.project_id,
              title = excluded.title,
             active_branch_id = excluded.active_branch_id,
             selected_model_ref = excluded.selected_model_ref,
             thinking_level = excluded.thinking_level,
             updated_at = excluded.updated_at,
             archived_at = excluded.archived_at,
             deleted_at = excluded.deleted_at,
             revision = excluded.revision`,
        )
        .run(
          conversation.id,
          conversation.ownerProfileId,
          conversation.projectId,
          conversation.title,
          conversation.activeBranchId,
          conversation.selectedModelRef,
          conversation.thinkingLevel,
          conversation.createdAt,
          conversation.updatedAt,
          conversation.archivedAt,
          conversation.deletedAt,
          conversation.revision,
        );
      return;
    }
    if (objectType === "branch") {
      const branch = branchSchema.parse(payload);
      this.#database
        .prepare(
          `INSERT INTO branches
           (id, conversation_id, parent_branch_id, forked_from_message_id, label, created_at)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             parent_branch_id = excluded.parent_branch_id,
             forked_from_message_id = excluded.forked_from_message_id,
             label = excluded.label`,
        )
        .run(
          branch.id,
          branch.conversationId,
          branch.parentBranchId,
          branch.forkedFromMessageId,
          branch.label,
          branch.createdAt,
        );
      return;
    }
    if (objectType === "message") {
      const message = messageSchema.parse(payload);
      const existing = this.#database
        .prepare("SELECT position, status FROM messages WHERE id = ?")
        .get(message.id) as SqlRow | undefined;
      const position = existing
        ? Number(existing.position)
        : Number(
            (
              this.#database
                .prepare(
                  "SELECT COALESCE(MAX(position), 0) + 1 AS position FROM messages WHERE branch_id = ?",
                )
                .get(message.branchId) as { position: number }
            ).position,
          );
      this.#database
        .prepare(
          `INSERT INTO messages
           (id, conversation_id, branch_id, parent_message_id, role, status, error_code, attempt,
            created_at, updated_at, revision, position, runtime_sequence, cancellation_requested_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
           ON CONFLICT(id) DO UPDATE SET
             status = excluded.status,
             error_code = excluded.error_code,
             cancellation_requested_at = excluded.cancellation_requested_at,
             updated_at = excluded.updated_at,
             revision = excluded.revision`,
        )
        .run(
          message.id,
          message.conversationId,
          message.branchId,
          message.parentMessageId,
          message.role,
          message.status === "cancelling"
            ? String(existing?.status ?? "pending")
            : message.status === "interrupted"
              ? "stopped"
              : message.status,
          message.errorCode,
          message.attempt,
          message.createdAt,
          message.updatedAt,
          message.revision,
          position,
          message.cancellationRequestedAt,
        );
      this.#database.prepare("DELETE FROM message_parts WHERE message_id = ?").run(message.id);
      message.parts.forEach((part, index) => {
        this.#database
          .prepare(
            `INSERT INTO message_parts(id, message_id, position, type, text)
             VALUES (?, ?, ?, 'text', ?)`,
          )
          .run(part.id, message.id, index + 1, part.text);
      });
    }
  }

  #idempotentResult(key: string, command: string): GenerationReceipt | null {
    const row = this.#database
      .prepare("SELECT command, result_json FROM idempotency WHERE key = ?")
      .get(key) as { command: string; result_json: string } | undefined;
    if (!row) return null;
    if (row.command !== command)
      throw new Error("Idempotency key already belongs to another command");
    return generationReceiptSchema.parse(JSON.parse(row.result_json) as unknown);
  }

  #storeIdempotentResult(
    key: string,
    command: string,
    result: GenerationReceipt,
    createdAt: string,
  ): void {
    this.#database
      .prepare("INSERT INTO idempotency(key, command, result_json, created_at) VALUES (?, ?, ?, ?)")
      .run(key, command, JSON.stringify(result), createdAt);
  }

  #branchCount(conversationId: string): number {
    const row = this.#database
      .prepare("SELECT COUNT(*) AS count FROM branches WHERE conversation_id = ?")
      .get(conversationId) as { count: number };
    return Number(row.count);
  }

  #transaction<T>(operation: () => T): T {
    this.#database.exec("BEGIN IMMEDIATE");
    try {
      const result = operation();
      this.#database.exec("COMMIT");
      return result;
    } catch (error) {
      this.#database.exec("ROLLBACK");
      throw error;
    }
  }
}
