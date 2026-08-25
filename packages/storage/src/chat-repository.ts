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
  conversationSchema,
  conversationSnapshotSchema,
  conversationSummarySchema,
  type GenerationReceipt,
  generationReceiptSchema,
  type Message,
  messageSchema,
  type SearchResult,
  searchResultSchema,
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
  now?: () => string;
  idFactory?: () => string;
}

export interface GenerationDraft {
  receipt: GenerationReceipt;
  events: ChatEvent[];
  created: boolean;
}

export interface RuntimeProductEvent {
  eventId: string;
  sequence: number;
  occurredAt: string;
  type: "delta" | "completed" | "stopped" | "failed";
  delta?: string;
  errorCode?: string;
}

export class ChatRepository {
  readonly #database: DatabaseSync;
  readonly #ownerProfileId: string;
  readonly #selectedModelRef: string;
  readonly #now: () => string;
  readonly #idFactory: () => string;

  constructor(databasePath: string, options: RepositoryOptions = {}) {
    this.#database = new DatabaseSync(databasePath);
    this.#ownerProfileId = options.ownerProfileId ?? "local-default";
    this.#selectedModelRef = options.selectedModelRef ?? "fake-runtime/v1";
    this.#now = options.now ?? (() => new Date().toISOString());
    this.#idFactory = options.idFactory ?? randomUUID;
    migrateDatabase(this.#database);
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

  createGeneration(input: {
    conversationId?: string | null;
    text: string;
    idempotencyKey: string;
  }): GenerationDraft {
    const duplicate = this.#idempotentResult(input.idempotencyKey, "chat.send");
    if (duplicate) return { receipt: duplicate, events: [], created: false };
    return this.#transaction(() => {
      const now = this.#now();
      let conversation: Conversation;
      let branchId: string;
      const events: ChatEvent[] = [];
      if (input.conversationId) {
        conversation = this.#getConversationEntity(input.conversationId);
        if (conversation.deletedAt) throw new Error("Conversation not found");
        branchId = conversation.activeBranchId;
      } else {
        const conversationId = this.#idFactory();
        branchId = this.#idFactory();
        this.#database
          .prepare(
            `INSERT INTO conversations
             (id, owner_profile_id, title, active_branch_id, selected_model_ref, created_at,
              updated_at, archived_at, deleted_at, revision)
             VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, 1)`,
          )
          .run(
            conversationId,
            this.#ownerProfileId,
            deriveConversationTitle(input.text),
            branchId,
            this.#selectedModelRef,
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
      const parentMessageId = this.#resolveBranch(branchId).at(-1)?.id ?? null;
      const userMessage = this.#insertMessage({
        conversationId: conversation.id,
        branchId,
        parentMessageId,
        role: "user",
        status: "completed",
        text: input.text,
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
        attempt: 1,
        now,
      });
      this.#touchConversation(conversation.id, now);
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
      return { receipt, events, created: true };
    });
  }

  regenerateGeneration(input: {
    conversationId: string;
    assistantMessageId: string;
    idempotencyKey: string;
  }): GenerationDraft {
    const duplicate = this.#idempotentResult(input.idempotencyKey, "chat.regenerate");
    if (duplicate) return { receipt: duplicate, events: [], created: false };
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
    if (duplicate) return { receipt: duplicate, events: [], created: false };
    return this.#forkGeneration({
      command: "chat.edit",
      conversationId: input.conversationId,
      targetMessageId: input.messageId,
      idempotencyKey: input.idempotencyKey,
      replacementText: input.text,
    });
  }

  appendRuntimeEvent(assistantMessageId: string, event: RuntimeProductEvent): ChatEvent | null {
    return this.#transaction(() => {
      const row = this.#messageRow(assistantMessageId);
      const currentSequence = Number(row.runtime_sequence);
      if (event.sequence <= currentSequence) return null;
      if (event.sequence !== currentSequence + 1) {
        throw new Error(
          `Runtime event gap for ${assistantMessageId}: expected ${currentSequence + 1}, received ${event.sequence}`,
        );
      }
      const currentStatus = String(row.status) as Message["status"];
      if (terminalMessageStatuses.has(currentStatus)) return null;
      let nextStatus = currentStatus;
      let eventType: ChatEvent["type"];
      let errorCode = row.error_code === null ? null : String(row.error_code);
      if (event.type === "delta") {
        nextStatus = "streaming";
        eventType = "message.delta";
      } else if (event.type === "completed") {
        nextStatus = "completed";
        eventType = "message.completed";
      } else if (event.type === "stopped") {
        nextStatus = "stopped";
        eventType = "message.stopped";
      } else {
        nextStatus = "failed";
        errorCode = event.errorCode ?? "RUNTIME_FAILURE";
        eventType = "message.failed";
      }
      assertMessageTransition(currentStatus, nextStatus);
      if (event.delta) {
        this.#database
          .prepare(
            "UPDATE message_parts SET text = text || ? WHERE message_id = ? AND position = 1",
          )
          .run(event.delta, assistantMessageId);
      }
      this.#database
        .prepare(
          `UPDATE messages SET status = ?, error_code = ?, updated_at = ?, revision = revision + 1,
           runtime_sequence = ? WHERE id = ?`,
        )
        .run(nextStatus, errorCode, event.occurredAt, event.sequence, assistantMessageId);
      const message = this.#message(assistantMessageId);
      this.#touchConversation(message.conversationId, event.occurredAt);
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

  stopMessage(
    conversationId: string,
    assistantMessageId: string,
  ): { message: Message; event: ChatEvent | null } {
    return this.#transaction(() => {
      const before = this.#message(assistantMessageId);
      if (before.conversationId !== conversationId)
        throw new Error("Message does not belong to conversation");
      if (terminalMessageStatuses.has(before.status)) return { message: before, event: null };
      assertMessageTransition(before.status, "stopped");
      const now = this.#now();
      this.#database
        .prepare(
          `UPDATE messages SET status = 'stopped', updated_at = ?, revision = revision + 1
           WHERE id = ?`,
        )
        .run(now, assistantMessageId);
      this.#touchConversation(conversationId, now);
      const message = this.#message(assistantMessageId);
      const event = this.#appendEvent({
        type: "message.stopped",
        conversationId,
        messageId: assistantMessageId,
        payload: { message },
      });
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

  listEvents(conversationId: string, afterSequence: number): ChatEvent[] {
    return this.#eventRows(conversationId, afterSequence);
  }

  runtimeHistory(
    assistantMessageId: string,
  ): Array<{ role: "user" | "assistant" | "system"; text: string }> {
    const assistant = this.#message(assistantMessageId);
    return this.#resolveBranch(assistant.branchId)
      .filter((message) => message.id !== assistantMessageId)
      .filter((message) => message.role !== "assistant" || message.status === "completed")
      .map((message) => ({ role: message.role, text: message.parts[0]?.text ?? "" }));
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
      let parentMessageId = forkedFromMessageId;
      if (input.replacementText !== null) {
        const user = this.#insertMessage({
          conversationId: input.conversationId,
          branchId,
          parentMessageId,
          role: "user",
          status: "completed",
          text: input.replacementText,
          attempt: target.attempt + 1,
          now,
        });
        userMessageId = user.id;
        parentMessageId = user.id;
      }
      const assistant = this.#insertMessage({
        conversationId: input.conversationId,
        branchId,
        parentMessageId,
        role: "assistant",
        status: "pending",
        text: "",
        attempt: target.attempt + 1,
        now,
      });
      this.#database
        .prepare(
          `UPDATE conversations SET active_branch_id = ?, updated_at = ?, revision = revision + 1
           WHERE id = ?`,
        )
        .run(branchId, now, input.conversationId);
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
      return { receipt, events, created: true };
    });
  }

  #insertMessage(input: {
    conversationId: string;
    branchId: string;
    parentMessageId: string | null;
    role: Message["role"];
    status: Message["status"];
    text: string;
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
          created_at, updated_at, revision, position, runtime_sequence)
         VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, 1, ?, 0)`,
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
    return messageSchema.parse({
      id: row.id,
      conversationId: row.conversation_id,
      branchId: row.branch_id,
      parentMessageId: row.parent_message_id,
      role: row.role,
      status: row.status,
      parts,
      errorCode: row.error_code,
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
      title: row.title,
      activeBranchId: row.active_branch_id,
      selectedModelRef: row.selected_model_ref,
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
      const event = this.#appendEvent({
        type: "conversation.updated",
        conversationId,
        messageId: null,
        payload: { conversation },
      });
      return { conversation, event };
    });
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
