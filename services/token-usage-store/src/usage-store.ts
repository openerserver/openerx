import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import {
  type UsageAggregate,
  type UsageRecord,
  usageAggregateSchema,
  usageRecordSchema,
} from "@openerx/contracts";

type SqlRow = Record<string, unknown>;
type TokenField =
  | "inputTokens"
  | "cachedInputTokens"
  | "outputTokens"
  | "reasoningTokens"
  | "totalTokens";

const tokenColumns: Record<TokenField, string> = {
  inputTokens: "input_tokens",
  cachedInputTokens: "cached_input_tokens",
  outputTokens: "output_tokens",
  reasoningTokens: "reasoning_tokens",
  totalTokens: "total_tokens",
};

function recordHash(record: UsageRecord): string {
  return createHash("sha256").update(JSON.stringify(record), "utf8").digest("hex");
}

function measurementHash(record: UsageRecord): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        usageId: record.usageId,
        accountId: record.accountId,
        conversationId: record.conversationId,
        messageId: record.messageId,
        runId: record.runId,
        toolCallId: record.toolCallId,
        selectedModelRef: record.selectedModelRef,
        effectiveModelRef: record.effectiveModelRef,
        fallbackReason: record.fallbackReason ?? null,
        inputTokens: record.inputTokens,
        cachedInputTokens: record.cachedInputTokens,
        outputTokens: record.outputTokens,
        reasoningTokens: record.reasoningTokens,
        totalTokens: record.totalTokens,
        providerReported: record.providerReported,
        missingReasons: Object.fromEntries(Object.entries(record.missingReasons).sort()),
        dedupeKey: record.dedupeKey,
      }),
      "utf8",
    )
    .digest("hex");
}

export class UsageStore {
  readonly #database: DatabaseSync;

  constructor(databasePath: string) {
    this.#database = new DatabaseSync(databasePath);
    this.#migrate();
  }

  close(): void {
    this.#database.close();
  }

  record(input: UsageRecord): { record: UsageRecord; replayed: boolean } {
    const record = usageRecordSchema.parse(input);
    const hash = recordHash(record);
    const existing = this.#database
      .prepare(
        `SELECT record_hash, usage_id FROM usage_records
         WHERE account_id = ? AND dedupe_key = ?`,
      )
      .get(record.accountId, record.dedupeKey) as SqlRow | undefined;
    if (existing) {
      const stored = this.get(record.accountId, String(existing.usage_id));
      const sameMeasurement = measurementHash(record) === measurementHash(stored);
      if (existing.record_hash !== hash && !sameMeasurement) {
        throw new Error("USAGE_DEDUPE_MISMATCH");
      }
      return { record: stored, replayed: true };
    }
    this.#database
      .prepare(
        `INSERT INTO usage_records
         (usage_id, account_id, conversation_id, message_id, run_id, tool_call_id,
          selected_model_ref, effective_model_ref, fallback_reason, input_tokens, cached_input_tokens,
          output_tokens, reasoning_tokens, total_tokens, provider_reported,
          missing_reasons_json, dedupe_key, recorded_at, record_hash)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        record.usageId,
        record.accountId,
        record.conversationId,
        record.messageId,
        record.runId,
        record.toolCallId,
        record.selectedModelRef,
        record.effectiveModelRef,
        record.fallbackReason ?? null,
        record.inputTokens,
        record.cachedInputTokens,
        record.outputTokens,
        record.reasoningTokens,
        record.totalTokens,
        record.providerReported ? 1 : 0,
        JSON.stringify(record.missingReasons),
        record.dedupeKey,
        record.recordedAt,
        hash,
      );
    return { record: this.get(record.accountId, record.usageId), replayed: false };
  }

  get(accountId: string, usageId: string): UsageRecord {
    const row = this.#database
      .prepare("SELECT * FROM usage_records WHERE account_id = ? AND usage_id = ?")
      .get(accountId, usageId) as SqlRow | undefined;
    if (!row) throw new Error("USAGE_NOT_FOUND");
    return this.#record(row);
  }

  list(input: { accountId: string; conversationId?: string; messageId?: string }): UsageRecord[] {
    const predicates = ["account_id = ?"];
    const parameters: string[] = [input.accountId];
    if (input.conversationId) {
      predicates.push("conversation_id = ?");
      parameters.push(input.conversationId);
    }
    if (input.messageId) {
      predicates.push("message_id = ?");
      parameters.push(input.messageId);
    }
    return (
      this.#database
        .prepare(
          `SELECT * FROM usage_records WHERE ${predicates.join(" AND ")}
           ORDER BY recorded_at, usage_id`,
        )
        .all(...parameters) as SqlRow[]
    ).map((row) => this.#record(row));
  }

  aggregate(input: {
    accountId: string;
    conversationId?: string;
    messageId?: string;
  }): UsageAggregate {
    const records = this.list(input);
    const aggregateField = (field: TokenField) => ({
      known: records.reduce((sum, record) => sum + (record[field] ?? 0), 0),
      unknownRecords: records.filter((record) => record[field] === null).length,
    });
    return usageAggregateSchema.parse({
      accountId: input.accountId,
      conversationId: input.conversationId ?? null,
      messageId: input.messageId ?? null,
      records: records.length,
      inputTokens: aggregateField("inputTokens"),
      cachedInputTokens: aggregateField("cachedInputTokens"),
      outputTokens: aggregateField("outputTokens"),
      reasoningTokens: aggregateField("reasoningTokens"),
      totalTokens: aggregateField("totalTokens"),
    });
  }

  #record(row: SqlRow): UsageRecord {
    return usageRecordSchema.parse({
      usageId: row.usage_id,
      accountId: row.account_id,
      conversationId: row.conversation_id,
      messageId: row.message_id,
      runId: row.run_id,
      toolCallId: row.tool_call_id,
      selectedModelRef: row.selected_model_ref,
      effectiveModelRef: row.effective_model_ref,
      ...(row.fallback_reason === null ? {} : { fallbackReason: row.fallback_reason }),
      inputTokens: row.input_tokens,
      cachedInputTokens: row.cached_input_tokens,
      outputTokens: row.output_tokens,
      reasoningTokens: row.reasoning_tokens,
      totalTokens: row.total_tokens,
      providerReported: Boolean(row.provider_reported),
      missingReasons: JSON.parse(String(row.missing_reasons_json)),
      dedupeKey: row.dedupe_key,
      recordedAt: row.recorded_at,
    });
  }

  #migrate(): void {
    this.#database.exec(`
      CREATE TABLE IF NOT EXISTS usage_records (
        usage_id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL,
        conversation_id TEXT NOT NULL,
        message_id TEXT NOT NULL,
        run_id TEXT,
        tool_call_id TEXT,
        selected_model_ref TEXT NOT NULL,
        effective_model_ref TEXT NOT NULL,
        fallback_reason TEXT,
        input_tokens INTEGER CHECK (input_tokens IS NULL OR input_tokens >= 0),
        cached_input_tokens INTEGER CHECK (cached_input_tokens IS NULL OR cached_input_tokens >= 0),
        output_tokens INTEGER CHECK (output_tokens IS NULL OR output_tokens >= 0),
        reasoning_tokens INTEGER CHECK (reasoning_tokens IS NULL OR reasoning_tokens >= 0),
        total_tokens INTEGER CHECK (total_tokens IS NULL OR total_tokens >= 0),
        provider_reported INTEGER NOT NULL CHECK (provider_reported IN (0, 1)),
        missing_reasons_json TEXT NOT NULL,
        dedupe_key TEXT NOT NULL,
        recorded_at TEXT NOT NULL,
        record_hash TEXT NOT NULL,
        UNIQUE(account_id, dedupe_key)
      ) STRICT;
      CREATE INDEX IF NOT EXISTS usage_message_idx
        ON usage_records(account_id, message_id, recorded_at);
      CREATE INDEX IF NOT EXISTS usage_conversation_idx
        ON usage_records(account_id, conversation_id, recorded_at);
    `);
    const columns = new Set(
      (this.#database.prepare("PRAGMA table_info(usage_records)").all() as SqlRow[]).map((row) =>
        String(row.name),
      ),
    );
    if (!columns.has("fallback_reason")) {
      this.#database.exec("ALTER TABLE usage_records ADD COLUMN fallback_reason TEXT");
    }
  }
}

export { tokenColumns };
