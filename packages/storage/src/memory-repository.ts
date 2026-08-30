import { createHash, randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import {
  type AutomaticMemoryCandidate,
  type ConversationMemorySettings,
  type ConversationMemorySettingsUpdateInput,
  conversationMemorySettingsSchema,
  type MemoryClearResult,
  type MemoryDeleteInput,
  type MemoryEntry,
  type MemoryExtractionJob,
  type MemoryExtractionSkipReason,
  type MemoryKind,
  type MemoryListInput,
  type MemorySettings,
  type MemorySettingsUpdateInput,
  type MemorySourceLink,
  type MemoryUpsertInput,
  memoryClearResultSchema,
  memoryEntrySchema,
  memoryExtractionJobSchema,
  memorySettingsSchema,
  memorySourceLinkSchema,
  type RecalledMemory,
  recalledMemorySchema,
  redactSensitiveText,
  type SyncOperation,
} from "@openerx/contracts";
import { migrateDatabase } from "./migrations";

type SqlRow = Record<string, unknown>;

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const extraSensitivePatterns: readonly RegExp[] = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/iu,
  /\b(?:cookie|session[_ -]?token|client[_ -]?secret|secret[_ -]?key)\s*[:=]\s*["']?\S+/iu,
  /(?:\b(?:otp|one[- ]?time (?:password|code)|verification code)\s*[:=]?\s*\d{4,8}\b|(?:验证码|校验码)\s*[:：=]?\s*\d{4,8})/iu,
  /(?:身份证(?:号|号码)?|national id)\s*[:：=]?\s*\d{17}[\dXx]/iu,
  /(?:银行卡(?:号|号码)?|card number|account number|银行账号)\s*[:：=]?\s*(?:\d[ -]?){12,19}/iu,
  /(?:^|\s)(?:[A-Za-z]:\\[^\s]+|\/(?:Users|home)\/[^\s]+)/u,
];

export interface MemoryRepositoryOptions {
  ownerProfileId?: string;
  deviceId?: string | null;
  now?: () => string;
  idFactory?: () => string;
}

function normalize(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/gu, " ").toLocaleLowerCase();
}

function tokens(value: string): string[] {
  const normalized = normalize(value);
  const words = (normalized.match(/[\p{L}\p{N}_-]{2,}/gu) ?? []).map((word) => word.slice(0, 120));
  const hanRuns = normalized.match(/[\p{Script=Han}]+/gu) ?? [];
  const hanTokens = hanRuns.flatMap((run) => {
    const points = [...run];
    if (points.length < 2) return points;
    return points.slice(0, -1).map((point, index) => `${point}${points[index + 1]}`);
  });
  return [...new Set([...words, ...hanTokens])].slice(0, 50);
}

function canonicalKey(kind: MemoryKind, content: string): string {
  return `${kind}:${createHash("sha256").update(normalize(content)).digest("hex")}`;
}

function estimatedTokenCount(value: string): number {
  const hanCharacters = value.match(/[\p{Script=Han}]/gu)?.length ?? 0;
  return hanCharacters + Math.ceil((value.length - hanCharacters) / 4);
}

function assertSafeMemoryContent(content: string): void {
  if (redactSensitiveText(content) !== content)
    throw new Error("MEMORY_SENSITIVE_CONTENT_REJECTED");
  if (extraSensitivePatterns.some((pattern) => pattern.test(content))) {
    throw new Error("MEMORY_SENSITIVE_CONTENT_REJECTED");
  }
}

export class MemoryRepository {
  readonly #database: DatabaseSync;
  readonly #ownerProfileId: string;
  readonly #deviceId: string | null;
  readonly #now: () => string;
  readonly #idFactory: () => string;

  constructor(databasePath: string, options: MemoryRepositoryOptions = {}) {
    this.#database = new DatabaseSync(databasePath);
    this.#ownerProfileId = options.ownerProfileId ?? "local-default";
    this.#deviceId = options.deviceId ?? null;
    this.#now = options.now ?? (() => new Date().toISOString());
    this.#idFactory = options.idFactory ?? randomUUID;
    migrateDatabase(this.#database);
  }

  close(): void {
    this.#database.close();
  }

  settings(): MemorySettings {
    let row = this.#database
      .prepare("SELECT * FROM memory_settings WHERE owner_profile_id = ?")
      .get(this.#ownerProfileId) as SqlRow | undefined;
    if (!row) {
      const now = this.#now();
      this.#database
        .prepare(
          `INSERT INTO memory_settings
           (owner_profile_id, memories_enabled, use_memories, generate_memories, sync_memories,
            disable_on_external_context, idle_delay_minutes,
            min_rate_limit_remaining_percent, updated_at, revision)
           VALUES (?, 0, 0, 0, 0, 1, 30, 20, ?, 1)`,
        )
        .run(this.#ownerProfileId, now);
      row = this.#database
        .prepare("SELECT * FROM memory_settings WHERE owner_profile_id = ?")
        .get(this.#ownerProfileId) as SqlRow;
    }
    return this.#settingsFromRow(row);
  }

  updateSettings(input: MemorySettingsUpdateInput): MemorySettings {
    return this.#transaction(() => {
      const current = this.settings();
      const now = this.#now();
      const updated = memorySettingsSchema.parse({
        ...current,
        ...input,
        updatedAt: now,
        revision: current.revision + 1,
      });
      this.#database
        .prepare(
          `UPDATE memory_settings SET memories_enabled = ?, use_memories = ?,
           generate_memories = ?, sync_memories = ?, disable_on_external_context = ?,
           idle_delay_minutes = ?, min_rate_limit_remaining_percent = ?,
           updated_at = ?, revision = ?
           WHERE owner_profile_id = ?`,
        )
        .run(
          updated.memoriesEnabled ? 1 : 0,
          updated.useMemories ? 1 : 0,
          updated.generateMemories ? 1 : 0,
          updated.syncMemories ? 1 : 0,
          updated.disableOnExternalContext ? 1 : 0,
          updated.idleDelayMinutes,
          updated.minRateLimitRemainingPercent,
          updated.updatedAt,
          updated.revision,
          this.#ownerProfileId,
        );
      if (current.syncMemories || updated.syncMemories) {
        this.#queueSync("memory_settings", this.#ownerProfileId, "upsert", updated, now);
      }
      if (!current.syncMemories && updated.syncMemories) {
        const active = (
          this.#database
            .prepare(
              `SELECT * FROM memory_entries
               WHERE owner_profile_id = ? AND status = 'active' ORDER BY updated_at DESC, id`,
            )
            .all(this.#ownerProfileId) as SqlRow[]
        ).map((row) => this.#entryFromRow(row));
        for (const memory of active) {
          this.#queueSync("memory_entry", memory.id, "upsert", memory, now);
        }
        const conversationSettings = (
          this.#database
            .prepare(
              `SELECT * FROM memory_conversation_settings
               WHERE owner_profile_id = ? ORDER BY updated_at DESC, conversation_id`,
            )
            .all(this.#ownerProfileId) as SqlRow[]
        ).map((row) => this.#conversationSettingsFromRow(row));
        for (const conversationSetting of conversationSettings) {
          this.#queueSync(
            "memory_conversation_settings",
            conversationSetting.conversationId,
            "upsert",
            conversationSetting,
            now,
          );
        }
      }
      return updated;
    });
  }

  conversationSettings(conversationId: string): ConversationMemorySettings {
    const row = this.#database
      .prepare(
        `SELECT * FROM memory_conversation_settings
         WHERE conversation_id = ? AND owner_profile_id = ?`,
      )
      .get(conversationId, this.#ownerProfileId) as SqlRow | undefined;
    if (row) return this.#conversationSettingsFromRow(row);
    return conversationMemorySettingsSchema.parse({
      conversationId,
      ownerProfileId: this.#ownerProfileId,
      useMemories: null,
      generateMemories: null,
      updatedAt: this.#now(),
      revision: 1,
    });
  }

  updateConversationSettings(
    input: ConversationMemorySettingsUpdateInput,
  ): ConversationMemorySettings {
    return this.#transaction(() => {
      const existing = this.#database
        .prepare(
          `SELECT * FROM memory_conversation_settings
           WHERE conversation_id = ? AND owner_profile_id = ?`,
        )
        .get(input.conversationId, this.#ownerProfileId) as SqlRow | undefined;
      const current = existing
        ? this.#conversationSettingsFromRow(existing)
        : this.conversationSettings(input.conversationId);
      const now = this.#now();
      const updated = conversationMemorySettingsSchema.parse({
        ...current,
        ...input,
        ownerProfileId: this.#ownerProfileId,
        updatedAt: now,
        revision: existing ? current.revision + 1 : 1,
      });
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
          updated.conversationId,
          updated.ownerProfileId,
          updated.useMemories === null ? null : updated.useMemories ? 1 : 0,
          updated.generateMemories === null ? null : updated.generateMemories ? 1 : 0,
          updated.updatedAt,
          updated.revision,
        );
      if (this.settings().syncMemories) {
        this.#queueSync(
          "memory_conversation_settings",
          updated.conversationId,
          "upsert",
          updated,
          now,
        );
      }
      return updated;
    });
  }

  list(input: MemoryListInput = { limit: 50 }): MemoryEntry[] {
    const clauses = ["owner_profile_id = ?"];
    const values: Array<string | number> = [this.#ownerProfileId];
    if (input.kind) {
      clauses.push("kind = ?");
      values.push(input.kind);
    }
    if (input.status) {
      clauses.push("status = ?");
      values.push(input.status);
    } else {
      clauses.push("status != 'deleted'");
    }
    if (input.query) {
      clauses.push("(content LIKE ? ESCAPE '\\' OR retrieval_keys_json LIKE ? ESCAPE '\\')");
      const escaped = input.query.replace(/[\\%_]/gu, (value) => `\\${value}`);
      values.push(`%${escaped}%`, `%${escaped}%`);
    }
    values.push(input.limit ?? 50);
    const rows = this.#database
      .prepare(
        `SELECT * FROM memory_entries WHERE ${clauses.join(" AND ")}
         ORDER BY updated_at DESC, id LIMIT ?`,
      )
      .all(...values) as SqlRow[];
    return rows.map((row) => this.#entryFromRow(row));
  }

  get(memoryId: string): MemoryEntry {
    const row = this.#database
      .prepare("SELECT * FROM memory_entries WHERE id = ? AND owner_profile_id = ?")
      .get(memoryId, this.#ownerProfileId) as SqlRow | undefined;
    if (!row) throw new Error("MEMORY_NOT_FOUND");
    return this.#entryFromRow(row);
  }

  sources(memoryId: string): MemorySourceLink[] {
    this.get(memoryId);
    const rows = this.#database
      .prepare(
        `SELECT links.*, conversations.title AS conversation_title,
                conversations.deleted_at AS conversation_deleted_at
         FROM memory_source_links AS links
         LEFT JOIN conversations ON conversations.id = links.conversation_id
         WHERE links.memory_id = ? AND links.owner_profile_id = ?
         ORDER BY links.created_at DESC, links.conversation_id
         LIMIT 200`,
      )
      .all(memoryId, this.#ownerProfileId) as SqlRow[];
    return rows.map((row) => this.#sourceLinkFromRow(row));
  }

  search(query: string, limit = 8): MemoryEntry[] {
    const queryTokens = new Set(tokens(query));
    const normalizedQuery = normalize(query);
    return this.list({ status: "active", limit: 100 })
      .map((entry) => {
        const normalizedContent = normalize(entry.content);
        const entryTokens = new Set([...entry.retrievalKeys, ...tokens(entry.content)]);
        const overlap = [...queryTokens].filter((token) => entryTokens.has(token)).length;
        const score =
          (normalizedContent.includes(normalizedQuery) ? 2 : 0) +
          (queryTokens.size === 0 ? 0 : overlap / queryTokens.size);
        return { entry, score };
      })
      .filter(({ score }) => score > 0)
      .sort(
        (left, right) =>
          right.score - left.score || right.entry.updatedAt.localeCompare(left.entry.updatedAt),
      )
      .slice(0, Math.max(1, Math.min(limit, 20)))
      .map(({ entry }) => entry);
  }

  upsert(input: MemoryUpsertInput): MemoryEntry {
    assertSafeMemoryContent(input.content);
    return this.#idempotent("memory.upsert", input.idempotencyKey, memoryEntrySchema, () => {
      if (!this.settings().memoriesEnabled) throw new Error("MEMORY_DISABLED");
      const now = this.#now();
      const key = input.canonicalKey ?? canonicalKey(input.kind, input.content);
      const requested = input.id
        ? (this.#database
            .prepare("SELECT * FROM memory_entries WHERE id = ? AND owner_profile_id = ?")
            .get(input.id, this.#ownerProfileId) as SqlRow | undefined)
        : undefined;
      const duplicate = this.#database
        .prepare(
          `SELECT * FROM memory_entries
             WHERE owner_profile_id = ? AND kind = ? AND canonical_key = ? AND status = 'active'`,
        )
        .get(this.#ownerProfileId, input.kind, key) as SqlRow | undefined;
      const existing = requested ?? duplicate;
      if (requested && duplicate && requested.id !== duplicate.id) {
        throw new Error("MEMORY_CANONICAL_CONFLICT");
      }
      const existingEntry = existing ? this.#entryFromRow(existing) : undefined;
      const id = existing ? String(existing.id) : (input.id ?? this.#idFactory());
      const createdAt = existingEntry?.createdAt ?? now;
      const revision = existingEntry ? existingEntry.revision + 1 : 1;
      const entry = memoryEntrySchema.parse({
        id,
        ownerProfileId: this.#ownerProfileId,
        scope: "personal",
        kind: input.kind,
        content: input.content,
        retrievalKeys:
          input.retrievalKeys && input.retrievalKeys.length > 0
            ? [...new Set(input.retrievalKeys.map(normalize))]
            : tokens(input.content),
        canonicalKey: key,
        origin: "explicit",
        confidence: 1,
        status: "active",
        sourceConversationId:
          input.sourceConversationId === undefined
            ? (existingEntry?.sourceConversationId ?? null)
            : input.sourceConversationId,
        sourceMessageId:
          input.sourceMessageId === undefined
            ? (existingEntry?.sourceMessageId ?? null)
            : input.sourceMessageId,
        supersedesMemoryId: null,
        expiresAt:
          input.expiresAt === undefined ? (existingEntry?.expiresAt ?? null) : input.expiresAt,
        createdAt,
        updatedAt: now,
        revision,
      });
      this.#database
        .prepare(
          `INSERT INTO memory_entries
             (id, owner_profile_id, scope, kind, content, retrieval_keys_json, canonical_key,
              origin, confidence, status, source_conversation_id, source_message_id,
              supersedes_memory_id, expires_at, created_at, updated_at, revision)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(id) DO UPDATE SET
               kind = excluded.kind, content = excluded.content,
               retrieval_keys_json = excluded.retrieval_keys_json,
               canonical_key = excluded.canonical_key, origin = excluded.origin,
               confidence = excluded.confidence, status = excluded.status,
               source_conversation_id = excluded.source_conversation_id,
               source_message_id = excluded.source_message_id,
               expires_at = excluded.expires_at, updated_at = excluded.updated_at,
               revision = excluded.revision
             WHERE owner_profile_id = excluded.owner_profile_id`,
        )
        .run(
          entry.id,
          entry.ownerProfileId,
          entry.scope,
          entry.kind,
          entry.content,
          JSON.stringify(entry.retrievalKeys),
          entry.canonicalKey,
          entry.origin,
          entry.confidence,
          entry.status,
          entry.sourceConversationId,
          entry.sourceMessageId,
          entry.supersedesMemoryId,
          entry.expiresAt,
          entry.createdAt,
          entry.updatedAt,
          entry.revision,
        );
      if (input.sourceConversationId) {
        this.#recordSourceLink({
          memoryId: entry.id,
          conversationId: input.sourceConversationId,
          messageId: input.sourceMessageId ?? null,
          origin: "explicit",
          confidence: 1,
          createdAt: now,
        });
      }
      if (this.settings().syncMemories) {
        this.#queueSync("memory_entry", entry.id, "upsert", entry, now);
      }
      return entry;
    });
  }

  delete(input: MemoryDeleteInput): MemoryEntry {
    return this.#idempotent("memory.delete", input.idempotencyKey, memoryEntrySchema, () => {
      const entry = this.get(input.memoryId);
      if (entry.status === "deleted") return entry;
      const now = this.#now();
      this.#database
        .prepare(
          `UPDATE memory_entries SET status = 'deleted', updated_at = ?, revision = revision + 1
             WHERE id = ? AND owner_profile_id = ?`,
        )
        .run(now, input.memoryId, this.#ownerProfileId);
      const deleted = this.get(input.memoryId);
      if (this.settings().syncMemories) {
        this.#queueSync("memory_entry", deleted.id, "delete", null, now);
      }
      return deleted;
    });
  }

  clear(idempotencyKey: string, kind?: MemoryKind): MemoryClearResult {
    return this.#idempotent(
      `memory.clear:${kind ?? "all"}`,
      idempotencyKey,
      memoryClearResultSchema,
      () => {
        const clauses = ["owner_profile_id = ?", "status != 'deleted'"];
        const values: string[] = [this.#ownerProfileId];
        if (kind) {
          clauses.push("kind = ?");
          values.push(kind);
        }
        const active = (
          this.#database
            .prepare(
              `SELECT * FROM memory_entries
             WHERE ${clauses.join(" AND ")} ORDER BY updated_at DESC, id`,
            )
            .all(...values) as SqlRow[]
        ).map((row) => this.#entryFromRow(row));
        const now = this.#now();
        this.#deleteEntries(active, now);
        return memoryClearResultSchema.parse({ deleted: active.length, clearedAt: now });
      },
    );
  }

  deleteBySourceConversation(conversationId: string, idempotencyKey: string): MemoryClearResult {
    return this.#idempotent(
      `memory.clear-source:${conversationId}`,
      idempotencyKey,
      memoryClearResultSchema,
      () => {
        const affected = (
          this.#database
            .prepare(
              `SELECT DISTINCT entries.* FROM memory_entries AS entries
               INNER JOIN memory_source_links AS links ON links.memory_id = entries.id
               WHERE entries.owner_profile_id = ? AND links.owner_profile_id = ?
                 AND links.conversation_id = ? AND entries.status != 'deleted'
               ORDER BY entries.updated_at DESC, entries.id`,
            )
            .all(this.#ownerProfileId, this.#ownerProfileId, conversationId) as SqlRow[]
        ).map((row) => this.#entryFromRow(row));
        const now = this.#now();
        this.#database
          .prepare(
            `DELETE FROM memory_source_links
             WHERE owner_profile_id = ? AND conversation_id = ?`,
          )
          .run(this.#ownerProfileId, conversationId);
        const deleted: MemoryEntry[] = [];
        const syncMemories = this.settings().syncMemories;
        for (const entry of affected) {
          const replacement = this.#database
            .prepare(
              `SELECT * FROM memory_source_links
               WHERE owner_profile_id = ? AND memory_id = ?
               ORDER BY created_at DESC, conversation_id LIMIT 1`,
            )
            .get(this.#ownerProfileId, entry.id) as SqlRow | undefined;
          if (!replacement) {
            deleted.push(entry);
            continue;
          }
          if (entry.sourceConversationId !== conversationId) continue;
          this.#database
            .prepare(
              `UPDATE memory_entries
               SET source_conversation_id = ?, source_message_id = ?, updated_at = ?,
                   revision = revision + 1
               WHERE id = ? AND owner_profile_id = ?`,
            )
            .run(
              String(replacement.conversation_id),
              replacement.message_id === null ? null : String(replacement.message_id),
              now,
              entry.id,
              this.#ownerProfileId,
            );
          if (syncMemories) {
            const updated = this.get(entry.id);
            this.#queueSync("memory_entry", updated.id, "upsert", updated, now);
          }
        }
        this.#deleteEntries(deleted, now);
        return memoryClearResultSchema.parse({ deleted: deleted.length, clearedAt: now });
      },
    );
  }

  markExternalContext(conversationId: string): void {
    const now = this.#now();
    this.#database
      .prepare(
        `INSERT INTO memory_conversation_context
         (owner_profile_id, conversation_id, external_context_used, updated_at)
         VALUES (?, ?, 1, ?)
         ON CONFLICT(owner_profile_id, conversation_id) DO UPDATE SET
           external_context_used = 1, updated_at = excluded.updated_at`,
      )
      .run(this.#ownerProfileId, conversationId, now);
  }

  hasExternalContext(conversationId: string): boolean {
    const recorded = this.#database
      .prepare(
        `SELECT external_context_used FROM memory_conversation_context
         WHERE owner_profile_id = ? AND conversation_id = ?`,
      )
      .get(this.#ownerProfileId, conversationId) as
      | { external_context_used: number }
      | undefined;
    if (Number(recorded?.external_context_used ?? 0) === 1) return true;
    const tool = this.#database
      .prepare(
        `SELECT 1
         FROM tool_calls tc
         JOIN execution_runs er ON er.id = tc.run_id
         JOIN work_items wi ON wi.id = er.work_item_id
         WHERE wi.owner_profile_id = ? AND wi.conversation_id = ?
           AND tc.tool_name NOT LIKE 'openerx_memory_%'
         LIMIT 1`,
      )
      .get(this.#ownerProfileId, conversationId);
    return tool !== undefined;
  }

  deleteExtractionState(conversationId: string): void {
    this.#transaction(() => {
      this.#database
        .prepare(
          `DELETE FROM memory_extraction_jobs
           WHERE owner_profile_id = ? AND conversation_id = ?`,
        )
        .run(this.#ownerProfileId, conversationId);
      this.#database
        .prepare(
          `DELETE FROM memory_conversation_context
           WHERE owner_profile_id = ? AND conversation_id = ?`,
        )
        .run(this.#ownerProfileId, conversationId);
    });
  }

  scheduleExtraction(conversationId: string, sourceAssistantMessageId: string): MemoryExtractionJob {
    const settings = this.settings();
    const conversationSettings = this.conversationSettings(conversationId);
    if (
      !settings.memoriesEnabled ||
      !settings.generateMemories ||
      conversationSettings.generateMemories === false
    ) {
      throw new Error("MEMORY_GENERATION_DISABLED");
    }
    return this.#transaction(() => {
      const now = this.#now();
      const eligibleAt = new Date(
        Date.parse(now) + settings.idleDelayMinutes * 60_000,
      ).toISOString();
      const existing = this.#database
        .prepare(
          `SELECT * FROM memory_extraction_jobs
           WHERE owner_profile_id = ? AND conversation_id = ?`,
        )
        .get(this.#ownerProfileId, conversationId) as SqlRow | undefined;
      const id = existing ? String(existing.id) : this.#idFactory();
      const createdAt = existing ? String(existing.created_at) : now;
      this.#database
        .prepare(
          `INSERT INTO memory_extraction_jobs
           (id, owner_profile_id, conversation_id, source_assistant_message_id, status,
            eligible_at, attempt, candidate_count, skip_reason, last_error_code,
            created_at, updated_at, completed_at)
           VALUES (?, ?, ?, ?, 'pending', ?, 0, 0, NULL, NULL, ?, ?, NULL)
           ON CONFLICT(owner_profile_id, conversation_id) DO UPDATE SET
             source_assistant_message_id = excluded.source_assistant_message_id,
             status = 'pending', eligible_at = excluded.eligible_at, attempt = 0,
             candidate_count = 0, skip_reason = NULL, last_error_code = NULL,
             updated_at = excluded.updated_at, completed_at = NULL`,
        )
        .run(
          id,
          this.#ownerProfileId,
          conversationId,
          sourceAssistantMessageId,
          eligibleAt,
          createdAt,
          now,
        );
      return this.#getExtractionJob(id);
    });
  }

  claimDueExtractionJob(): MemoryExtractionJob | null {
    return this.#transaction(() => {
      const now = this.#now();
      const staleAt = new Date(Date.parse(now) - 10 * 60_000).toISOString();
      this.#database
        .prepare(
          `UPDATE memory_extraction_jobs
           SET status = 'pending', last_error_code = 'MEMORY_EXTRACTION_RECOVERED',
               updated_at = ?
           WHERE owner_profile_id = ? AND status = 'running' AND updated_at <= ?`,
        )
        .run(now, this.#ownerProfileId, staleAt);
      const row = this.#database
        .prepare(
          `SELECT * FROM memory_extraction_jobs
           WHERE owner_profile_id = ? AND status = 'pending' AND eligible_at <= ?
           ORDER BY eligible_at, created_at, id LIMIT 1`,
        )
        .get(this.#ownerProfileId, now) as SqlRow | undefined;
      if (!row) return null;
      const changed = this.#database
        .prepare(
          `UPDATE memory_extraction_jobs
           SET status = 'running', attempt = attempt + 1, updated_at = ?
           WHERE id = ? AND owner_profile_id = ? AND status = 'pending'`,
        )
        .run(now, String(row.id), this.#ownerProfileId);
      return Number(changed.changes) === 1 ? this.#getExtractionJob(String(row.id)) : null;
    });
  }

  deferExtractionJob(jobId: string, delayMinutes = 5): MemoryExtractionJob {
    const now = this.#now();
    const eligibleAt = new Date(Date.parse(now) + Math.max(1, delayMinutes) * 60_000).toISOString();
    this.#database
      .prepare(
        `UPDATE memory_extraction_jobs
         SET status = 'pending', eligible_at = ?, updated_at = ?
         WHERE id = ? AND owner_profile_id = ?`,
      )
      .run(eligibleAt, now, jobId, this.#ownerProfileId);
    return this.#getExtractionJob(jobId);
  }

  skipExtractionJob(
    jobId: string,
    reason: MemoryExtractionSkipReason,
  ): MemoryExtractionJob {
    const now = this.#now();
    this.#database
      .prepare(
        `UPDATE memory_extraction_jobs
         SET status = 'skipped', skip_reason = ?, last_error_code = NULL,
             updated_at = ?, completed_at = ?
         WHERE id = ? AND owner_profile_id = ?`,
      )
      .run(reason, now, now, jobId, this.#ownerProfileId);
    return this.#getExtractionJob(jobId);
  }

  failExtractionJob(jobId: string, errorCode: string): MemoryExtractionJob {
    const now = this.#now();
    this.#database
      .prepare(
        `UPDATE memory_extraction_jobs
         SET status = 'failed', last_error_code = ?, updated_at = ?, completed_at = ?
         WHERE id = ? AND owner_profile_id = ?`,
      )
      .run(errorCode.slice(0, 200), now, now, jobId, this.#ownerProfileId);
    return this.#getExtractionJob(jobId);
  }

  completeExtractionJob(jobId: string, candidateCount: number): MemoryExtractionJob {
    const now = this.#now();
    this.#database
      .prepare(
        `UPDATE memory_extraction_jobs
         SET status = 'completed', candidate_count = ?, skip_reason = NULL,
             last_error_code = NULL, updated_at = ?, completed_at = ?
         WHERE id = ? AND owner_profile_id = ?`,
      )
      .run(Math.max(0, candidateCount), now, now, jobId, this.#ownerProfileId);
    return this.#getExtractionJob(jobId);
  }

  listExtractionJobs(limit = 50): MemoryExtractionJob[] {
    const rows = this.#database
      .prepare(
        `SELECT * FROM memory_extraction_jobs
         WHERE owner_profile_id = ? ORDER BY updated_at DESC, id LIMIT ?`,
      )
      .all(this.#ownerProfileId, Math.max(1, Math.min(limit, 100))) as SqlRow[];
    return rows.map((row) => this.#extractionJobFromRow(row));
  }

  upsertAutomatic(input: {
    candidate: AutomaticMemoryCandidate;
    conversationId: string;
    jobId: string;
  }): MemoryEntry {
    const candidate = input.candidate;
    assertSafeMemoryContent(candidate.content);
    if (candidate.confidence < 0.72) throw new Error("MEMORY_CANDIDATE_LOW_CONFIDENCE");
    const key = canonicalKey(candidate.kind, candidate.content);
    return this.#idempotent(
      "memory.upsert-automatic",
      `memory-auto:${input.jobId}:${key}`,
      memoryEntrySchema,
      () => {
        const settings = this.settings();
        const conversationSettings = this.conversationSettings(input.conversationId);
        if (!settings.memoriesEnabled || !settings.generateMemories) {
          throw new Error("MEMORY_GENERATION_DISABLED");
        }
        if (conversationSettings.generateMemories === false) {
          throw new Error("MEMORY_CONVERSATION_GENERATION_DISABLED");
        }
        const source = this.#database
          .prepare(
            `SELECT role, status, conversation_id FROM messages WHERE id = ?`,
          )
          .get(candidate.sourceMessageId) as
          | { role: string; status: string; conversation_id: string }
          | undefined;
        if (
          source?.role !== "user" ||
          source.status !== "completed" ||
          source.conversation_id !== input.conversationId
        ) {
          throw new Error("MEMORY_CANDIDATE_SOURCE_INVALID");
        }
        const now = this.#now();
        const duplicate = this.#database
          .prepare(
            `SELECT * FROM memory_entries
             WHERE owner_profile_id = ? AND kind = ? AND canonical_key = ? AND status = 'active'`,
          )
          .get(this.#ownerProfileId, candidate.kind, key) as SqlRow | undefined;
        if (duplicate) {
          const entry = this.#entryFromRow(duplicate);
          this.#recordSourceLink({
            memoryId: entry.id,
            conversationId: input.conversationId,
            messageId: candidate.sourceMessageId,
            origin: "automatic",
            confidence: candidate.confidence,
            createdAt: now,
          });
          return entry;
        }
        const expiresAt =
          candidate.kind === "ongoing_context"
            ? new Date(Date.parse(now) + 90 * 86_400_000).toISOString()
            : null;
        const entry = memoryEntrySchema.parse({
          id: this.#idFactory(),
          ownerProfileId: this.#ownerProfileId,
          scope: "personal",
          kind: candidate.kind,
          content: candidate.content,
          retrievalKeys:
            candidate.retrievalKeys.length > 0
              ? [...new Set(candidate.retrievalKeys.map(normalize))]
              : tokens(candidate.content),
          canonicalKey: key,
          origin: "automatic",
          confidence: candidate.confidence,
          status: "active",
          sourceConversationId: input.conversationId,
          sourceMessageId: candidate.sourceMessageId,
          supersedesMemoryId: null,
          expiresAt,
          createdAt: now,
          updatedAt: now,
          revision: 1,
        });
        this.#database
          .prepare(
            `INSERT INTO memory_entries
             (id, owner_profile_id, scope, kind, content, retrieval_keys_json, canonical_key,
              origin, confidence, status, source_conversation_id, source_message_id,
              supersedes_memory_id, expires_at, created_at, updated_at, revision)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            entry.id,
            entry.ownerProfileId,
            entry.scope,
            entry.kind,
            entry.content,
            JSON.stringify(entry.retrievalKeys),
            entry.canonicalKey,
            entry.origin,
            entry.confidence,
            entry.status,
            entry.sourceConversationId,
            entry.sourceMessageId,
            entry.supersedesMemoryId,
            entry.expiresAt,
            entry.createdAt,
            entry.updatedAt,
            entry.revision,
          );
        this.#recordSourceLink({
          memoryId: entry.id,
          conversationId: input.conversationId,
          messageId: candidate.sourceMessageId,
          origin: "automatic",
          confidence: candidate.confidence,
          createdAt: now,
        });
        if (settings.syncMemories) {
          this.#queueSync("memory_entry", entry.id, "upsert", entry, now);
        }
        return entry;
      },
    );
  }

  recall(query: string, limit = 8, tokenBudget = 1_200, conversationId?: string): RecalledMemory[] {
    const settings = this.settings();
    const conversationSettings = conversationId ? this.conversationSettings(conversationId) : null;
    if (
      !settings.memoriesEnabled ||
      !settings.useMemories ||
      conversationSettings?.useMemories === false
    ) {
      return [];
    }
    const queryTokens = new Set(tokens(query));
    const now = Date.parse(this.#now());
    const candidates = this.list({ status: "active", limit: 100 }).filter(
      (entry) => entry.expiresAt === null || Date.parse(entry.expiresAt) > now,
    );
    const baseByKind: Record<MemoryKind, number> = {
      profile: 0.36,
      preference: 0.34,
      workflow: 0.2,
      ongoing_context: 0.12,
    };
    const ranked = candidates
      .map((entry) => {
        const entryTokens = new Set([...entry.retrievalKeys, ...tokens(entry.content)]);
        const overlap = [...queryTokens].filter((token) => entryTokens.has(token)).length;
        const lexical = queryTokens.size === 0 ? 0 : overlap / queryTokens.size;
        const ageDays = Math.max(0, (now - Date.parse(entry.updatedAt)) / 86_400_000);
        const recency = Math.max(0, 0.08 - (Math.min(ageDays, 365) / 365) * 0.08);
        const score = Math.min(1, baseByKind[entry.kind] + lexical * 0.5 + recency);
        return recalledMemorySchema.parse({
          id: entry.id,
          kind: entry.kind,
          content: entry.content,
          score,
          updatedAt: entry.updatedAt,
        });
      })
      .filter((memory) => memory.score >= 0.2)
      .sort(
        (left, right) => right.score - left.score || right.updatedAt.localeCompare(left.updatedAt),
      );
    const selected: RecalledMemory[] = [];
    let usedTokens = 0;
    for (const memory of ranked) {
      if (selected.length >= Math.max(1, Math.min(limit, 8))) break;
      const memoryTokens = estimatedTokenCount(memory.content);
      if (usedTokens + memoryTokens > tokenBudget) continue;
      selected.push(memory);
      usedTokens += memoryTokens;
    }
    return selected;
  }

  recordUsage(input: {
    conversationId: string;
    assistantMessageId: string;
    memories: RecalledMemory[];
  }): void {
    const statement = this.#database.prepare(
      `INSERT OR IGNORE INTO memory_usage_events
       (id, owner_profile_id, conversation_id, assistant_message_id, memory_id, score, used_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    const now = this.#now();
    for (const memory of input.memories) {
      statement.run(
        this.#idFactory(),
        this.#ownerProfileId,
        input.conversationId,
        input.assistantMessageId,
        memory.id,
        memory.score,
        now,
      );
    }
  }

  #deleteEntries(entries: MemoryEntry[], now: string): void {
    const syncMemories = this.settings().syncMemories;
    const statement = this.#database.prepare(
      `UPDATE memory_entries SET status = 'deleted', updated_at = ?, revision = revision + 1
       WHERE id = ? AND owner_profile_id = ?`,
    );
    for (const entry of entries) {
      statement.run(now, entry.id, this.#ownerProfileId);
      if (syncMemories) this.#queueSync("memory_entry", entry.id, "delete", null, now);
    }
  }

  #settingsFromRow(row: SqlRow): MemorySettings {
    return memorySettingsSchema.parse({
      ownerProfileId: row.owner_profile_id,
      memoriesEnabled: Number(row.memories_enabled) === 1,
      useMemories: Number(row.use_memories) === 1,
      generateMemories: Number(row.generate_memories) === 1,
      syncMemories: Number(row.sync_memories) === 1,
      disableOnExternalContext: Number(row.disable_on_external_context) === 1,
      idleDelayMinutes: Number(row.idle_delay_minutes),
      minRateLimitRemainingPercent: Number(row.min_rate_limit_remaining_percent),
      updatedAt: row.updated_at,
      revision: Number(row.revision),
    });
  }

  #conversationSettingsFromRow(row: SqlRow): ConversationMemorySettings {
    return conversationMemorySettingsSchema.parse({
      conversationId: row.conversation_id,
      ownerProfileId: row.owner_profile_id,
      useMemories: row.use_memories === null ? null : Number(row.use_memories) === 1,
      generateMemories: row.generate_memories === null ? null : Number(row.generate_memories) === 1,
      updatedAt: row.updated_at,
      revision: Number(row.revision),
    });
  }

  #recordSourceLink(input: {
    memoryId: string;
    conversationId: string;
    messageId: string | null;
    origin: MemoryEntry["origin"];
    confidence: number;
    createdAt: string;
  }): void {
    this.#database
      .prepare(
        `INSERT INTO memory_source_links
         (memory_id, owner_profile_id, conversation_id, message_id, origin, confidence, created_at)
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
        input.memoryId,
        this.#ownerProfileId,
        input.conversationId,
        input.messageId,
        input.origin,
        input.confidence,
        input.createdAt,
      );
  }

  #sourceLinkFromRow(row: SqlRow): MemorySourceLink {
    return memorySourceLinkSchema.parse({
      memoryId: row.memory_id,
      ownerProfileId: row.owner_profile_id,
      conversationId: row.conversation_id,
      messageId: row.message_id,
      origin: row.origin,
      confidence: Number(row.confidence),
      conversationTitle: row.conversation_title ?? null,
      conversationDeletedAt: row.conversation_deleted_at ?? null,
      createdAt: row.created_at,
    });
  }

  #entryFromRow(row: SqlRow): MemoryEntry {
    return memoryEntrySchema.parse({
      id: row.id,
      ownerProfileId: row.owner_profile_id,
      scope: row.scope,
      kind: row.kind,
      content: row.content,
      retrievalKeys: JSON.parse(String(row.retrieval_keys_json)),
      canonicalKey: row.canonical_key,
      origin: row.origin,
      confidence: Number(row.confidence),
      status: row.status,
      sourceConversationId: row.source_conversation_id,
      sourceMessageId: row.source_message_id,
      supersedesMemoryId: row.supersedes_memory_id,
      expiresAt: row.expires_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      revision: Number(row.revision),
    });
  }

  #getExtractionJob(jobId: string): MemoryExtractionJob {
    const row = this.#database
      .prepare(
        `SELECT * FROM memory_extraction_jobs WHERE id = ? AND owner_profile_id = ?`,
      )
      .get(jobId, this.#ownerProfileId) as SqlRow | undefined;
    if (!row) throw new Error("MEMORY_EXTRACTION_JOB_NOT_FOUND");
    return this.#extractionJobFromRow(row);
  }

  #extractionJobFromRow(row: SqlRow): MemoryExtractionJob {
    return memoryExtractionJobSchema.parse({
      id: row.id,
      ownerProfileId: row.owner_profile_id,
      conversationId: row.conversation_id,
      sourceAssistantMessageId: row.source_assistant_message_id,
      status: row.status,
      eligibleAt: row.eligible_at,
      attempt: Number(row.attempt),
      candidateCount: Number(row.candidate_count),
      skipReason: row.skip_reason,
      lastErrorCode: row.last_error_code,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      completedAt: row.completed_at,
    });
  }

  #idempotent<T>(
    command: string,
    key: string,
    schema: { parse(value: unknown): T },
    operation: () => T,
  ): T {
    return this.#transaction(() => {
      const existing = this.#database
        .prepare(
          "SELECT command, result_json FROM memory_idempotency WHERE key = ? AND owner_profile_id = ?",
        )
        .get(key, this.#ownerProfileId) as { command: string; result_json: string } | undefined;
      if (existing) {
        if (existing.command !== command) throw new Error("IDEMPOTENCY_KEY_REUSED");
        return schema.parse(JSON.parse(existing.result_json));
      }
      const result = operation();
      this.#database
        .prepare(
          `INSERT INTO memory_idempotency(key, owner_profile_id, command, result_json, created_at)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .run(key, this.#ownerProfileId, command, JSON.stringify(result), this.#now());
      return result;
    });
  }

  #syncEnabled(): boolean {
    return (
      uuidPattern.test(this.#ownerProfileId) &&
      this.#deviceId !== null &&
      uuidPattern.test(this.#deviceId)
    );
  }

  #queueSync(
    objectType: SyncOperation["objectType"],
    objectId: string,
    mutation: "upsert" | "delete",
    payload:
      | Record<string, unknown>
      | ConversationMemorySettings
      | MemoryEntry
      | MemorySettings
      | null,
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
         (operation_id, account_id, device_id, object_type, object_id, mutation, base_revision,
          payload_version, payload_json, idempotency_key, created_at, status)
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
