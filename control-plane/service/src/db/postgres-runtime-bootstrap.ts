import type { Sql } from "postgres";

export type PostgresRuntimeBootstrapSummary = {
  durationMs: number;
  catalogReadCount: number;
  tablesCreated: number;
  indexesCreated: number;
  columnsAdded: number;
  foreignKeysDropped: number;
  foreignKeysAdded: number;
};

type BootstrapRelationDefinition = {
  relationName: string;
  statement: string;
};

type BootstrapColumnPatch = {
  tableName: string;
  columnName: string;
  statement: string;
};

type BootstrapForeignKeyPatch = {
  tableName: string;
  columnName: string;
  expectedReferencesTable: string | null;
  addStatement?: string;
  legacyReferencesTables?: string[];
};

type BootstrapRelationRow = {
  relationName: string;
};

type BootstrapColumnRow = {
  tableName: string;
  columnName: string;
};

type BootstrapForeignKeyRow = {
  tableName: string;
  constraintName: string;
  columnName: string;
  referencesTable: string;
};

type BootstrapEnumValueRow = {
  enumLabel: string;
};

type BootstrapState = {
  relations: Set<string>;
  columns: Set<string>;
  foreignKeys: BootstrapForeignKeyRow[];
};

type BootstrapSummaryCounterKey = Exclude<
  keyof PostgresRuntimeBootstrapSummary,
  "durationMs" | "catalogReadCount"
>;

const POSTGRES_RUNTIME_TABLE_DEFINITIONS: BootstrapRelationDefinition[] = [
  {
    relationName: "task_domain_events",
    statement: `CREATE TABLE IF NOT EXISTS "task_domain_events" (
      "id" text PRIMARY KEY,
      "task_id" text,
      "session_id" text,
      "run_id" text,
      "run_node_id" text,
      "event_type" text,
      "payload_json" jsonb NOT NULL DEFAULT '{}'::jsonb,
      "created_at" text NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "seq" bigint NOT NULL DEFAULT 0
    )`,
  },
  {
    relationName: "task_sessions",
    statement: `CREATE TABLE IF NOT EXISTS "task_sessions" (
      "id" text PRIMARY KEY,
      "task_id" text NOT NULL,
      "project_id" text NOT NULL,
      "tree_node_id" text,
      "parent_session_id" text,
      "root_session_id" text,
      "session_kind" text NOT NULL,
      "trigger_type" text NOT NULL,
      "execution_mode_snapshot" text NOT NULL,
      "execution_status" text NOT NULL DEFAULT 'running',
      "branch_name" text,
      "candidate_index" integer,
      "step_index" integer,
      "runtime_session_id" text,
      "forked_from_message_id" text,
      "selected_model" text,
      "effective_model" text,
      "winner_session_id" text,
      "judge_session_id" text,
      "result_text" text,
      "result_summary" text,
      "error_text" text,
      "input_tokens" bigint NOT NULL DEFAULT 0,
      "output_tokens" bigint NOT NULL DEFAULT 0,
      "total_tokens" bigint NOT NULL DEFAULT 0,
      "cost_usd" double precision NOT NULL DEFAULT 0,
      "last_activity_at" text NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "started_at" text,
      "finished_at" text,
      "created_at" text NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updated_at" text NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "archived_at" text
    )`,
  },
  {
    relationName: "task_operations",
    statement: `CREATE TABLE IF NOT EXISTS "task_operations" (
      "id" text PRIMARY KEY,
      "session_id" text NOT NULL,
      "task_id" text NOT NULL,
      "run_id" text NOT NULL,
      "message_id" text,
      "parent_operation_id" text,
      "runtime_operation_id" text,
      "operation_index" integer NOT NULL DEFAULT 0,
      "operation_kind" text NOT NULL,
      "tool_name" text,
      "title" text,
      "status" text NOT NULL DEFAULT 'running',
      "summary_json" jsonb NOT NULL DEFAULT '{}'::jsonb,
      "started_at" text,
      "finished_at" text,
      "created_at" text NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updated_at" text NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
  },
  {
    relationName: "task_artifacts",
    statement: `CREATE TABLE IF NOT EXISTS "task_artifacts" (
      "id" text PRIMARY KEY,
      "task_id" text NOT NULL,
      "project_id" text NOT NULL,
      "session_id" text,
      "message_id" text,
      "operation_id" text,
      "parent_artifact_id" text,
      "artifact_kind" text NOT NULL,
      "storage_kind" text NOT NULL DEFAULT 'inline',
      "title" text,
      "mime_type" text,
      "file_path" text,
      "external_uri" text,
      "content_text" text,
      "payload_json" jsonb NOT NULL DEFAULT '{}'::jsonb,
      "byte_size" bigint,
      "sha256" text,
      "created_at" text NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updated_at" text NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
  },
  {
    relationName: "task_usage_ledger_entries",
    statement: `CREATE TABLE IF NOT EXISTS "task_usage_ledger_entries" (
      "id" text PRIMARY KEY,
      "task_id" text NOT NULL,
      "project_id" text NOT NULL,
      "session_id" text,
      "message_id" text,
      "operation_id" text,
      "entry_kind" text NOT NULL,
      "provider_id" text,
      "model_id" text,
      "request_count" integer NOT NULL DEFAULT 1,
      "input_tokens" bigint NOT NULL DEFAULT 0,
      "output_tokens" bigint NOT NULL DEFAULT 0,
      "total_tokens" bigint NOT NULL DEFAULT 0,
      "cost_usd" double precision NOT NULL DEFAULT 0,
      "currency_code" text NOT NULL DEFAULT 'USD',
      "recorded_at" text NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "metadata_json" jsonb NOT NULL DEFAULT '{}'::jsonb,
      "created_at" text NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
  },
  {
    relationName: "task_timeline_views",
    statement: `CREATE TABLE IF NOT EXISTS "task_timeline_views" (
      "id" text PRIMARY KEY,
      "project_id" text NOT NULL,
      "task_id" text NOT NULL,
      "session_id" text,
      "message_id" text,
      "operation_id" text,
      "artifact_id" text,
      "item_kind" text NOT NULL,
      "item_role" text,
      "title" text,
      "display_text" text,
      "metadata_json" jsonb NOT NULL DEFAULT '{}'::jsonb,
      "sort_at" text NOT NULL,
      "created_at" text NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updated_at" text NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
  },
];

const POSTGRES_RUNTIME_INDEX_DEFINITIONS: BootstrapRelationDefinition[] = [
  {
    relationName: "idx_task_domain_events_task_created_at",
    statement: `CREATE INDEX IF NOT EXISTS "idx_task_domain_events_task_created_at"
      ON "task_domain_events" ("task_id", "created_at", "seq")`,
  },
  {
    relationName: "idx_task_sessions_task_created_at",
    statement: `CREATE INDEX IF NOT EXISTS "idx_task_sessions_task_created_at"
      ON "task_sessions" ("task_id", "created_at")`,
  },
  {
    relationName: "idx_task_sessions_runtime_session_id",
    statement: `CREATE INDEX IF NOT EXISTS "idx_task_sessions_runtime_session_id"
      ON "task_sessions" ("runtime_session_id")`,
  },
  {
    relationName: "idx_task_operations_session_created_at",
    statement: `CREATE INDEX IF NOT EXISTS "idx_task_operations_session_created_at"
      ON "task_operations" ("session_id", "created_at")`,
  },
  {
    relationName: "idx_task_operations_run_operation_index",
    statement: `CREATE INDEX IF NOT EXISTS "idx_task_operations_run_operation_index"
      ON "task_operations" ("run_id", "operation_index")`,
  },
  {
    relationName: "idx_task_operations_runtime_operation_id",
    statement: `CREATE INDEX IF NOT EXISTS "idx_task_operations_runtime_operation_id"
      ON "task_operations" ("runtime_operation_id")`,
  },
  {
    relationName: "idx_task_artifacts_session_created_at",
    statement: `CREATE INDEX IF NOT EXISTS "idx_task_artifacts_session_created_at"
      ON "task_artifacts" ("session_id", "created_at")`,
  },
  {
    relationName: "idx_task_usage_ledger_entries_session_recorded_at",
    statement: `CREATE INDEX IF NOT EXISTS "idx_task_usage_ledger_entries_session_recorded_at"
      ON "task_usage_ledger_entries" ("session_id", "recorded_at")`,
  },
  {
    relationName: "idx_task_timeline_views_task_sort_at",
    statement: `CREATE INDEX IF NOT EXISTS "idx_task_timeline_views_task_sort_at"
      ON "task_timeline_views" ("task_id", "sort_at", "created_at")`,
  },
];

const POSTGRES_RUNTIME_COLUMN_PATCHES: BootstrapColumnPatch[] = [
  {
    tableName: "workflow_template_stages",
    columnName: "initial_task_definition_json",
    statement: `ALTER TABLE IF EXISTS "workflow_template_stages"
      ADD COLUMN IF NOT EXISTS "initial_task_definition_json" jsonb`,
  },
  {
    tableName: "task_messages",
    columnName: "user_input_text",
    statement: `ALTER TABLE IF EXISTS "task_messages"
      ADD COLUMN IF NOT EXISTS "user_input_text" text`,
  },
  {
    tableName: "task_messages",
    columnName: "system_context_text",
    statement: `ALTER TABLE IF EXISTS "task_messages"
      ADD COLUMN IF NOT EXISTS "system_context_text" text`,
  },
  {
    tableName: "task_messages",
    columnName: "final_sent_text",
    statement: `ALTER TABLE IF EXISTS "task_messages"
      ADD COLUMN IF NOT EXISTS "final_sent_text" text`,
  },
  {
    tableName: "task_timeline_views",
    columnName: "message_id",
    statement: `ALTER TABLE IF EXISTS "task_timeline_views"
      ADD COLUMN IF NOT EXISTS "message_id" text`,
  },
  {
    tableName: "task_timeline_views",
    columnName: "operation_id",
    statement: `ALTER TABLE IF EXISTS "task_timeline_views"
      ADD COLUMN IF NOT EXISTS "operation_id" text`,
  },
  {
    tableName: "task_timeline_views",
    columnName: "artifact_id",
    statement: `ALTER TABLE IF EXISTS "task_timeline_views"
      ADD COLUMN IF NOT EXISTS "artifact_id" text`,
  },
  {
    tableName: "task_timeline_views",
    columnName: "updated_at",
    statement: `ALTER TABLE IF EXISTS "task_timeline_views"
      ADD COLUMN IF NOT EXISTS "updated_at" text DEFAULT CURRENT_TIMESTAMP`,
  },
];

const POSTGRES_RUNTIME_FOREIGN_KEY_PATCHES: BootstrapForeignKeyPatch[] = [
  {
    tableName: "code_changes",
    columnName: "agent_run_id",
    expectedReferencesTable: null,
    legacyReferencesTables: ["agent_runs"],
  },
  {
    tableName: "runtime_usage_ledgers",
    columnName: "agent_run_id",
    expectedReferencesTable: null,
    legacyReferencesTables: ["agent_runs"],
  },
  {
    tableName: "runtime_usage_ledger_steps",
    columnName: "agent_run_id",
    expectedReferencesTable: null,
    legacyReferencesTables: ["agent_runs"],
  },
  {
    tableName: "task_run_nodes",
    columnName: "agent_run_id",
    expectedReferencesTable: null,
    legacyReferencesTables: ["agent_runs"],
  },
  {
    tableName: "task_timeline_views",
    columnName: "session_id",
    expectedReferencesTable: null,
    legacyReferencesTables: ["conversation_sessions"],
  },
  {
    tableName: "task_artifacts",
    columnName: "message_id",
    expectedReferencesTable: "task_messages",
    legacyReferencesTables: ["conversation_messages", "task_session_messages"],
    addStatement: `ALTER TABLE "task_artifacts"
      ADD CONSTRAINT "task_artifacts_message_id_task_messages_id_fk"
        FOREIGN KEY ("message_id")
        REFERENCES "task_messages" ("id")
        ON DELETE NO ACTION
        ON UPDATE NO ACTION
        NOT VALID`,
  },
  {
    tableName: "task_usage_ledger_entries",
    columnName: "message_id",
    expectedReferencesTable: "task_messages",
    legacyReferencesTables: ["conversation_messages", "task_session_messages"],
    addStatement: `ALTER TABLE "task_usage_ledger_entries"
      ADD CONSTRAINT "task_usage_ledger_entries_message_id_task_messages_id_fk"
        FOREIGN KEY ("message_id")
        REFERENCES "task_messages" ("id")
        ON DELETE NO ACTION
        ON UPDATE NO ACTION
        NOT VALID`,
  },
  {
    tableName: "task_timeline_views",
    columnName: "message_id",
    expectedReferencesTable: "task_messages",
    legacyReferencesTables: ["conversation_messages", "task_session_messages"],
    addStatement: `ALTER TABLE "task_timeline_views"
      ADD CONSTRAINT "task_timeline_views_message_id_task_messages_id_fk"
        FOREIGN KEY ("message_id")
        REFERENCES "task_messages" ("id")
        ON DELETE CASCADE
        ON UPDATE NO ACTION
        NOT VALID`,
  },
  {
    tableName: "task_artifacts",
    columnName: "operation_id",
    expectedReferencesTable: "task_operations",
    legacyReferencesTables: ["session_operations"],
    addStatement: `ALTER TABLE "task_artifacts"
      ADD CONSTRAINT "task_artifacts_operation_id_task_operations_id_fk"
        FOREIGN KEY ("operation_id")
        REFERENCES "task_operations" ("id")
        ON DELETE NO ACTION
        ON UPDATE NO ACTION
        NOT VALID`,
  },
  {
    tableName: "task_usage_ledger_entries",
    columnName: "operation_id",
    expectedReferencesTable: "task_operations",
    legacyReferencesTables: ["session_operations"],
    addStatement: `ALTER TABLE "task_usage_ledger_entries"
      ADD CONSTRAINT "task_usage_ledger_entries_operation_id_task_operations_id_fk"
        FOREIGN KEY ("operation_id")
        REFERENCES "task_operations" ("id")
        ON DELETE NO ACTION
        ON UPDATE NO ACTION
        NOT VALID`,
  },
  {
    tableName: "task_timeline_views",
    columnName: "operation_id",
    expectedReferencesTable: "task_operations",
    legacyReferencesTables: ["session_operations"],
    addStatement: `ALTER TABLE "task_timeline_views"
      ADD CONSTRAINT "task_timeline_views_operation_id_task_operations_id_fk"
        FOREIGN KEY ("operation_id")
        REFERENCES "task_operations" ("id")
        ON DELETE CASCADE
        ON UPDATE NO ACTION
        NOT VALID`,
  },
];

const POSTGRES_RUNTIME_TABLE_NAMES = [
  ...new Set(
    [...POSTGRES_RUNTIME_COLUMN_PATCHES, ...POSTGRES_RUNTIME_FOREIGN_KEY_PATCHES].map(
      (patch) => patch.tableName,
    ),
  ),
];

const POSTGRES_RUNTIME_RELATION_NAMES = [
  ...new Set(
    [
      ...POSTGRES_RUNTIME_TABLE_NAMES,
      ...POSTGRES_RUNTIME_TABLE_DEFINITIONS.map((definition) => definition.relationName),
      ...POSTGRES_RUNTIME_INDEX_DEFINITIONS.map((definition) => definition.relationName),
    ],
  ),
];

function buildColumnKey(tableName: string, columnName: string) {
  return tableName + "." + columnName;
}

function quoteIdentifier(identifier: string) {
  return '"' + identifier.replaceAll('"', '""') + '"';
}

async function loadBootstrapState(sql: Sql): Promise<BootstrapState> {
  const relationRows = await sql.unsafe<BootstrapRelationRow[]>(
    `SELECT
       relation.relname AS "relationName"
     FROM pg_class relation
     INNER JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
     WHERE namespace.nspname = 'public'
       AND relation.relname = ANY($1::text[])`,
    [POSTGRES_RUNTIME_RELATION_NAMES],
  );

  const columnRows = await sql.unsafe<BootstrapColumnRow[]>(
    `SELECT
       table_name AS "tableName",
       column_name AS "columnName"
     FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = ANY($1::text[])`,
    [POSTGRES_RUNTIME_TABLE_NAMES],
  );

  const foreignKeyRows = await sql.unsafe<BootstrapForeignKeyRow[]>(
    `SELECT
       source.relname AS "tableName",
       foreign_key.conname AS "constraintName",
       attribute.attname AS "columnName",
       target.relname AS "referencesTable"
     FROM pg_constraint foreign_key
     INNER JOIN pg_class source ON source.oid = foreign_key.conrelid
     INNER JOIN pg_namespace namespace ON namespace.oid = source.relnamespace
     INNER JOIN pg_class target ON target.oid = foreign_key.confrelid
     INNER JOIN unnest(foreign_key.conkey) WITH ORDINALITY AS column_numbers(attnum, ordinality) ON TRUE
     INNER JOIN pg_attribute attribute
       ON attribute.attrelid = foreign_key.conrelid
      AND attribute.attnum = column_numbers.attnum
     WHERE foreign_key.contype = 'f'
       AND namespace.nspname = 'public'
       AND source.relname = ANY($1::text[])`,
    [POSTGRES_RUNTIME_TABLE_NAMES],
  );

  return {
    relations: new Set(relationRows.map((row) => row.relationName)),
    columns: new Set(columnRows.map((row) => buildColumnKey(row.tableName, row.columnName))),
    foreignKeys: foreignKeyRows,
  };
}

async function ensureExecutionStatusAwaitingAdoption(sql: Sql): Promise<boolean> {
  const enumValueRows = await sql.unsafe<BootstrapEnumValueRow[]>(
    `SELECT enum.enumlabel AS "enumLabel"
     FROM pg_type type
     INNER JOIN pg_namespace namespace ON namespace.oid = type.typnamespace
     INNER JOIN pg_enum enum ON enum.enumtypid = type.oid
     WHERE namespace.nspname = 'public'
       AND type.typname = 'execution_status'`,
  );

  if (enumValueRows.length === 0) {
    return false;
  }

  if (enumValueRows.some((row) => row.enumLabel === "awaiting_adoption")) {
    return false;
  }

  await sql.unsafe(`ALTER TYPE "execution_status" ADD VALUE IF NOT EXISTS 'awaiting_adoption'`);
  return true;
}

function incrementBootstrapSummary(
  summary: PostgresRuntimeBootstrapSummary,
  key: BootstrapSummaryCounterKey,
) {
  summary[key] += 1;
}

async function createMissingRelations(
  sql: Sql,
  definitions: BootstrapRelationDefinition[],
  existingRelations: Set<string>,
  summary: PostgresRuntimeBootstrapSummary,
  kind: "table" | "index",
) {
  for (const definition of definitions) {
    if (existingRelations.has(definition.relationName)) {
      continue;
    }

    await sql.unsafe(definition.statement);
    incrementBootstrapSummary(summary, kind === "table" ? "tablesCreated" : "indexesCreated");
  }
}

async function applyMissingColumns(
  sql: Sql,
  state: BootstrapState,
  summary: PostgresRuntimeBootstrapSummary,
) {
  for (const patch of POSTGRES_RUNTIME_COLUMN_PATCHES) {
    if (!state.relations.has(patch.tableName)) {
      continue;
    }

    if (state.columns.has(buildColumnKey(patch.tableName, patch.columnName))) {
      continue;
    }

    await sql.unsafe(patch.statement);
    incrementBootstrapSummary(summary, "columnsAdded");
  }
}

function shouldDropForeignKey(
  foreignKey: BootstrapForeignKeyRow,
  patch: BootstrapForeignKeyPatch,
) {
  if (patch.expectedReferencesTable === null) {
    return patch.legacyReferencesTables?.includes(foreignKey.referencesTable) ?? false;
  }

  return foreignKey.referencesTable !== patch.expectedReferencesTable;
}

async function reconcileForeignKeys(
  sql: Sql,
  state: BootstrapState,
  summary: PostgresRuntimeBootstrapSummary,
) {
  for (const patch of POSTGRES_RUNTIME_FOREIGN_KEY_PATCHES) {
    if (!state.relations.has(patch.tableName)) {
      continue;
    }

    if (!state.columns.has(buildColumnKey(patch.tableName, patch.columnName))) {
      continue;
    }

    const matchingForeignKeys = state.foreignKeys.filter(
      (foreignKey) =>
        foreignKey.tableName === patch.tableName && foreignKey.columnName === patch.columnName,
    );

    for (const foreignKey of matchingForeignKeys) {
      if (!shouldDropForeignKey(foreignKey, patch)) {
        continue;
      }

      await sql.unsafe(
        "ALTER TABLE " +
          quoteIdentifier(foreignKey.tableName) +
          " DROP CONSTRAINT " +
          quoteIdentifier(foreignKey.constraintName),
      );
      incrementBootstrapSummary(summary, "foreignKeysDropped");
    }

    if (!patch.expectedReferencesTable || !patch.addStatement) {
      continue;
    }

    const hasExpectedForeignKey = matchingForeignKeys.some(
      (foreignKey) => foreignKey.referencesTable === patch.expectedReferencesTable,
    );
    if (hasExpectedForeignKey) {
      continue;
    }

    await sql.unsafe(patch.addStatement);
    incrementBootstrapSummary(summary, "foreignKeysAdded");
  }
}

export async function ensurePostgresRuntimeTables(
  sql: Sql,
): Promise<PostgresRuntimeBootstrapSummary> {
  const startedAt = Date.now();
  const summary: PostgresRuntimeBootstrapSummary = {
    durationMs: 0,
    catalogReadCount: 0,
    tablesCreated: 0,
    indexesCreated: 0,
    columnsAdded: 0,
    foreignKeysDropped: 0,
    foreignKeysAdded: 0,
  };

  await ensureExecutionStatusAwaitingAdoption(sql);
  summary.catalogReadCount += 1;

  const initialState = await loadBootstrapState(sql);
  summary.catalogReadCount += 1;
  await createMissingRelations(
    sql,
    POSTGRES_RUNTIME_TABLE_DEFINITIONS,
    initialState.relations,
    summary,
    "table",
  );
  await createMissingRelations(
    sql,
    POSTGRES_RUNTIME_INDEX_DEFINITIONS,
    initialState.relations,
    summary,
    "index",
  );

  const relationState = await loadBootstrapState(sql);
  summary.catalogReadCount += 1;
  await applyMissingColumns(sql, relationState, summary);

  const finalState = await loadBootstrapState(sql);
  summary.catalogReadCount += 1;
  await reconcileForeignKeys(sql, finalState, summary);

  summary.durationMs = Date.now() - startedAt;
  return summary;
}
