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

type BootstrapRequiredColumn = {
  tableName: string;
  columnName: string;
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

type BootstrapState = {
  relations: Set<string>;
  columns: Set<string>;
  foreignKeys: BootstrapForeignKeyRow[];
};

type BootstrapSummaryCounterKey = Exclude<
  keyof PostgresRuntimeBootstrapSummary,
  "durationMs" | "catalogReadCount"
>;

const REQUIRED_CANONICAL_RELATIONS = [
  "task_domain_events",
  "task_sessions",
  "task_session_runs",
  "task_messages",
  "task_message_parts",
  "task_operations",
  "task_snapshots",
  "task_artifacts",
  "task_usage_ledger_entries",
  "task_timeline_views",
  "task_execution_phases",
] as const;

const REQUIRED_CANONICAL_COLUMNS: BootstrapRequiredColumn[] = [
  { tableName: "workflow_template_stages", columnName: "initial_task_definition_json" },
  { tableName: "task_domain_events", columnName: "project_id" },
  { tableName: "task_domain_events", columnName: "event_type" },
  { tableName: "task_domain_events", columnName: "payload_json" },
  { tableName: "task_messages", columnName: "user_input_text" },
  { tableName: "task_messages", columnName: "system_context_text" },
  { tableName: "task_messages", columnName: "final_sent_text" },
  { tableName: "task_sessions", columnName: "phase_id" },
  { tableName: "task_sessions", columnName: "phase_role" },
  { tableName: "task_sessions", columnName: "phase_item_index" },
  { tableName: "task_session_runs", columnName: "phase_id" },
  { tableName: "task_snapshots", columnName: "current_phase_id" },
  { tableName: "task_snapshots", columnName: "latest_phase_id" },
  { tableName: "task_timeline_views", columnName: "message_id" },
  { tableName: "task_timeline_views", columnName: "operation_id" },
  { tableName: "task_timeline_views", columnName: "artifact_id" },
  { tableName: "task_timeline_views", columnName: "updated_at" },
  { tableName: "task_timeline_views", columnName: "phase_id" },
  { tableName: "task_timeline_views", columnName: "phase_index" },
  { tableName: "task_timeline_views", columnName: "phase_kind" },
  { tableName: "task_timeline_views", columnName: "phase_role" },
  { tableName: "task_timeline_views", columnName: "phase_item_index" },
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
    [
      ...REQUIRED_CANONICAL_RELATIONS,
      ...REQUIRED_CANONICAL_COLUMNS.map((column) => column.tableName),
      ...POSTGRES_RUNTIME_FOREIGN_KEY_PATCHES.map((patch) => patch.tableName),
    ].sort(),
  ),
];

const POSTGRES_RUNTIME_RELATION_NAMES = [
  ...new Set([...POSTGRES_RUNTIME_TABLE_NAMES, ...REQUIRED_CANONICAL_RELATIONS].sort()),
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

function incrementBootstrapSummary(
  summary: PostgresRuntimeBootstrapSummary,
  key: BootstrapSummaryCounterKey,
) {
  summary[key] += 1;
}

function assertCanonicalSchema(state: BootstrapState) {
  const missingRelations = REQUIRED_CANONICAL_RELATIONS.filter(
    (relationName) => !state.relations.has(relationName),
  );
  const missingColumns = REQUIRED_CANONICAL_COLUMNS.filter(
    (column) => !state.columns.has(buildColumnKey(column.tableName, column.columnName)),
  );

  if (missingRelations.length === 0 && missingColumns.length === 0) {
    return;
  }

  const detailParts: string[] = [];
  if (missingRelations.length > 0) {
    detailParts.push(`missing relations: ${missingRelations.join(", ")}`);
  }
  if (missingColumns.length > 0) {
    detailParts.push(
      `missing columns: ${missingColumns.map((column) => buildColumnKey(column.tableName, column.columnName)).join(", ")}`,
    );
  }

  throw new Error(
    `PostgreSQL canonical schema is incomplete after startup migrations; ${detailParts.join("; ")}. ` +
      `Run db:reconcile:migration-state and db:migrate against this database if it was built from a legacy snapshot.`,
  );
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

  const state = await loadBootstrapState(sql);
  summary.catalogReadCount += 1;
  assertCanonicalSchema(state);
  await reconcileForeignKeys(sql, state, summary);

  summary.durationMs = Date.now() - startedAt;
  return summary;
}
