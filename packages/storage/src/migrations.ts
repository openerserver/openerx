import type { DatabaseSync } from "node:sqlite";

interface Migration {
  version: number;
  checksum: string;
  sql: string;
}

const migrations: readonly Migration[] = [
  {
    version: 1,
    checksum: "chat-alpha-v1-20260825",
    sql: `
      CREATE TABLE conversations (
        id TEXT PRIMARY KEY,
        owner_profile_id TEXT NOT NULL,
        title TEXT NOT NULL,
        active_branch_id TEXT NOT NULL,
        selected_model_ref TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        archived_at TEXT,
        deleted_at TEXT,
        revision INTEGER NOT NULL CHECK (revision > 0)
      ) STRICT;
      CREATE TABLE branches (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL REFERENCES conversations(id),
        parent_branch_id TEXT REFERENCES branches(id),
        forked_from_message_id TEXT,
        label TEXT NOT NULL,
        created_at TEXT NOT NULL
      ) STRICT;
      CREATE TABLE messages (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL REFERENCES conversations(id),
        branch_id TEXT NOT NULL REFERENCES branches(id),
        parent_message_id TEXT,
        role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
        status TEXT NOT NULL CHECK (status IN ('pending', 'streaming', 'completed', 'stopped', 'failed')),
        error_code TEXT,
        attempt INTEGER NOT NULL CHECK (attempt > 0),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        revision INTEGER NOT NULL CHECK (revision > 0),
        position INTEGER NOT NULL CHECK (position > 0),
        runtime_sequence INTEGER NOT NULL DEFAULT 0 CHECK (runtime_sequence >= 0),
        UNIQUE (branch_id, position)
      ) STRICT;
      CREATE TABLE message_parts (
        id TEXT PRIMARY KEY,
        message_id TEXT NOT NULL REFERENCES messages(id),
        position INTEGER NOT NULL CHECK (position > 0),
        type TEXT NOT NULL CHECK (type = 'text'),
        text TEXT NOT NULL,
        UNIQUE (message_id, position)
      ) STRICT;
      CREATE TABLE events (
        event_id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL REFERENCES conversations(id),
        message_id TEXT,
        sequence INTEGER NOT NULL CHECK (sequence > 0),
        type TEXT NOT NULL,
        occurred_at TEXT NOT NULL,
        payload_version INTEGER NOT NULL CHECK (payload_version = 1),
        payload_json TEXT NOT NULL,
        UNIQUE (conversation_id, sequence)
      ) STRICT;
      CREATE TABLE idempotency (
        key TEXT PRIMARY KEY,
        command TEXT NOT NULL,
        result_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      ) STRICT;
      CREATE INDEX conversations_updated_idx ON conversations(deleted_at, archived_at, updated_at DESC);
      CREATE INDEX branches_conversation_idx ON branches(conversation_id, created_at);
      CREATE INDEX messages_branch_idx ON messages(branch_id, position);
      CREATE INDEX messages_conversation_idx ON messages(conversation_id, updated_at);
      CREATE INDEX events_replay_idx ON events(conversation_id, sequence);
    `,
  },
  {
    version: 2,
    checksum: "account-sync-outbox-v2-20260825",
    sql: `
      CREATE TABLE sync_object_state (
        account_id TEXT NOT NULL,
        object_type TEXT NOT NULL,
        object_id TEXT NOT NULL,
        cloud_revision INTEGER NOT NULL CHECK (cloud_revision >= 0),
        last_synced_payload_json TEXT,
        PRIMARY KEY(account_id, object_type, object_id)
      ) STRICT;
      CREATE TABLE sync_outbox (
        operation_id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL,
        device_id TEXT NOT NULL,
        object_type TEXT NOT NULL,
        object_id TEXT NOT NULL,
        mutation TEXT NOT NULL CHECK (mutation IN ('upsert', 'delete')),
        base_revision INTEGER NOT NULL CHECK (base_revision >= 0),
        payload_version INTEGER NOT NULL CHECK (payload_version = 1),
        payload_json TEXT,
        idempotency_key TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('pending', 'committed', 'conflict'))
      ) STRICT;
      CREATE TABLE sync_replica_state (
        account_id TEXT PRIMARY KEY,
        cursor TEXT NOT NULL
      ) STRICT;
      CREATE TABLE sync_local_conflicts (
        conflict_id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL,
        conflict_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      ) STRICT;
      CREATE INDEX sync_outbox_pending_idx
        ON sync_outbox(account_id, status, created_at, operation_id);
    `,
  },
];

export function migrateDatabase(database: DatabaseSync): void {
  database.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      checksum TEXT NOT NULL,
      applied_at TEXT NOT NULL
    ) STRICT;
  `);
  const rows = database
    .prepare("SELECT version, checksum FROM schema_migrations ORDER BY version")
    .all() as Array<{ version: number; checksum: string }>;
  const latestSupported = migrations.at(-1)?.version ?? 0;
  const latestApplied = Number(rows.at(-1)?.version ?? 0);
  if (latestApplied > latestSupported) {
    throw new Error(
      `Database schema ${latestApplied} is newer than supported schema ${latestSupported}`,
    );
  }
  for (const row of rows) {
    const expected = migrations.find(({ version }) => version === Number(row.version));
    if (!expected || expected.checksum !== row.checksum) {
      throw new Error(`Database migration checksum mismatch at version ${row.version}`);
    }
  }
  for (const migration of migrations) {
    if (migration.version <= latestApplied) continue;
    database.exec("BEGIN IMMEDIATE");
    try {
      database.exec(migration.sql);
      database
        .prepare("INSERT INTO schema_migrations(version, checksum, applied_at) VALUES (?, ?, ?)")
        .run(migration.version, migration.checksum, new Date().toISOString());
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  }
  const integrity = database.prepare("PRAGMA quick_check").get() as
    | { quick_check: string }
    | undefined;
  if (integrity?.quick_check !== "ok") {
    throw new Error("Database integrity check failed");
  }
}
