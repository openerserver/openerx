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
  {
    version: 3,
    checksum: "files-artifacts-v3-20260825",
    sql: `
      CREATE TABLE file_scopes (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL CHECK (kind IN ('file', 'directory')),
        display_name TEXT NOT NULL,
        root_path TEXT NOT NULL,
        access TEXT NOT NULL CHECK (access IN ('read', 'read_write')),
        expires_at TEXT,
        revoked_at TEXT,
        created_at TEXT NOT NULL
      ) STRICT;
      CREATE TABLE personal_files (
        id TEXT PRIMARY KEY,
        owner_profile_id TEXT NOT NULL,
        display_name TEXT NOT NULL,
        format TEXT NOT NULL,
        media_type TEXT NOT NULL,
        size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0),
        checksum_sha256 TEXT NOT NULL,
        object_ref TEXT NOT NULL,
        source_scope_id TEXT REFERENCES file_scopes(id),
        source_relative_path TEXT NOT NULL,
        parse_status TEXT NOT NULL CHECK (parse_status IN ('pending', 'ready', 'failed')),
        parse_error_code TEXT,
        parsed_text TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        revision INTEGER NOT NULL CHECK (revision > 0),
        UNIQUE(owner_profile_id, checksum_sha256, source_scope_id, source_relative_path)
      ) STRICT;
      CREATE TABLE file_citations (
        id TEXT PRIMARY KEY,
        personal_file_id TEXT NOT NULL REFERENCES personal_files(id) ON DELETE CASCADE,
        locator_json TEXT NOT NULL,
        excerpt TEXT NOT NULL,
        confidence REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
        position INTEGER NOT NULL CHECK (position > 0),
        UNIQUE(personal_file_id, position)
      ) STRICT;
      CREATE TABLE attachments (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        message_id TEXT REFERENCES messages(id) ON DELETE SET NULL,
        personal_file_id TEXT NOT NULL REFERENCES personal_files(id),
        created_at TEXT NOT NULL,
        UNIQUE(conversation_id, message_id, personal_file_id)
      ) STRICT;
      CREATE TABLE artifacts (
        id TEXT PRIMARY KEY,
        owner_profile_id TEXT NOT NULL,
        display_name TEXT NOT NULL,
        format TEXT NOT NULL,
        media_type TEXT NOT NULL,
        current_version INTEGER NOT NULL CHECK (current_version > 0),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        revision INTEGER NOT NULL CHECK (revision > 0)
      ) STRICT;
      CREATE TABLE artifact_versions (
        id TEXT PRIMARY KEY,
        artifact_id TEXT NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
        version INTEGER NOT NULL CHECK (version > 0),
        size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0),
        checksum_sha256 TEXT NOT NULL,
        object_ref TEXT NOT NULL,
        source_personal_file_id TEXT REFERENCES personal_files(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL,
        UNIQUE(artifact_id, version)
      ) STRICT;
      CREATE INDEX personal_files_owner_idx
        ON personal_files(owner_profile_id, updated_at DESC);
      CREATE INDEX file_citations_file_idx
        ON file_citations(personal_file_id, position);
      CREATE INDEX attachments_conversation_idx
        ON attachments(conversation_id, created_at);
      CREATE INDEX artifact_versions_artifact_idx
        ON artifact_versions(artifact_id, version);
    `,
  },
  {
    version: 4,
    checksum: "tool-runs-permissions-v4-20260826",
    sql: `
      CREATE TABLE work_items (
        id TEXT PRIMARY KEY,
        owner_profile_id TEXT NOT NULL,
        conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN (
          'queued', 'running', 'waiting_for_user', 'waiting_for_permission',
          'completed', 'failed', 'cancelled'
        )),
        active_run_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        completed_at TEXT,
        revision INTEGER NOT NULL CHECK (revision > 0),
        UNIQUE(owner_profile_id, message_id)
      ) STRICT;
      CREATE TABLE execution_runs (
        id TEXT PRIMARY KEY,
        work_item_id TEXT NOT NULL REFERENCES work_items(id) ON DELETE CASCADE,
        attempt INTEGER NOT NULL CHECK (attempt > 0),
        status TEXT NOT NULL CHECK (status IN (
          'queued', 'running', 'waiting_for_user', 'waiting_for_permission',
          'completed', 'failed', 'cancelled'
        )),
        pi_package_version TEXT NOT NULL,
        pi_host_contract_version INTEGER NOT NULL CHECK (pi_host_contract_version > 0),
        selected_model_ref TEXT NOT NULL,
        effective_model_ref TEXT,
        pi_session_ref TEXT,
        last_pi_event_sequence INTEGER NOT NULL DEFAULT 0 CHECK (last_pi_event_sequence >= 0),
        retry_count INTEGER NOT NULL DEFAULT 0 CHECK (retry_count >= 0),
        compaction_count INTEGER NOT NULL DEFAULT 0 CHECK (compaction_count >= 0),
        error_code TEXT,
        created_at TEXT NOT NULL,
        started_at TEXT,
        completed_at TEXT,
        updated_at TEXT NOT NULL,
        UNIQUE(work_item_id, attempt)
      ) STRICT;
      CREATE TABLE run_steps (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL REFERENCES execution_runs(id) ON DELETE CASCADE,
        pi_step_ref TEXT NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('tool', 'compaction', 'retry', 'model')),
        title TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'completed', 'failed', 'cancelled')),
        sequence INTEGER NOT NULL CHECK (sequence > 0),
        started_at TEXT,
        completed_at TEXT,
        error_code TEXT,
        UNIQUE(run_id, pi_step_ref),
        UNIQUE(run_id, sequence)
      ) STRICT;
      CREATE TABLE tool_calls (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL REFERENCES execution_runs(id) ON DELETE CASCADE,
        step_id TEXT NOT NULL REFERENCES run_steps(id) ON DELETE CASCADE,
        pi_call_ref TEXT NOT NULL,
        tool_name TEXT NOT NULL,
        source TEXT NOT NULL CHECK (source IN ('builtin', 'openerx', 'mcp')),
        status TEXT NOT NULL CHECK (status IN (
          'requested', 'waiting_for_permission', 'running', 'completed', 'failed', 'cancelled'
        )),
        risk TEXT NOT NULL CHECK (risk IN ('L0', 'L1', 'L2', 'L3', 'L4', 'L5')),
        idempotency_key TEXT NOT NULL,
        input_summary TEXT NOT NULL,
        target_summary TEXT NOT NULL,
        result_summary TEXT,
        error_code TEXT,
        started_at TEXT,
        completed_at TEXT,
        updated_at TEXT NOT NULL,
        UNIQUE(run_id, pi_call_ref),
        UNIQUE(idempotency_key)
      ) STRICT;
      CREATE TABLE capability_scopes (
        id TEXT PRIMARY KEY,
        owner_profile_id TEXT NOT NULL,
        capability TEXT NOT NULL CHECK (capability IN (
          'builtin.compute', 'builtin.structured_data', 'file', 'web.search',
          'browser', 'shell', 'desktop', 'mcp'
        )),
        resource_type TEXT NOT NULL CHECK (resource_type IN (
          'builtin', 'workspace', 'path', 'domain', 'application', 'server'
        )),
        resource TEXT NOT NULL,
        actions_json TEXT NOT NULL,
        max_risk TEXT NOT NULL CHECK (max_risk IN ('L0', 'L1', 'L2', 'L3', 'L4', 'L5')),
        session_only INTEGER NOT NULL CHECK (session_only IN (0, 1)),
        expires_at TEXT,
        revoked_at TEXT,
        created_at TEXT NOT NULL
      ) STRICT;
      CREATE TABLE permission_requests (
        id TEXT PRIMARY KEY,
        owner_profile_id TEXT NOT NULL,
        work_item_id TEXT NOT NULL REFERENCES work_items(id) ON DELETE CASCADE,
        run_id TEXT NOT NULL REFERENCES execution_runs(id) ON DELETE CASCADE,
        tool_call_id TEXT NOT NULL REFERENCES tool_calls(id) ON DELETE CASCADE,
        capability TEXT NOT NULL,
        risk TEXT NOT NULL CHECK (risk IN ('L0', 'L1', 'L2', 'L3', 'L4', 'L5')),
        resource_type TEXT NOT NULL,
        resource TEXT NOT NULL,
        actions_json TEXT NOT NULL,
        reason TEXT NOT NULL,
        payload_digest TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'denied', 'expired', 'cancelled')),
        requested_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        resolved_at TEXT,
        resolution TEXT CHECK (resolution IN ('once', 'session', 'persistent', 'deny')),
        scope_id TEXT REFERENCES capability_scopes(id),
        UNIQUE(tool_call_id, payload_digest)
      ) STRICT;
      CREATE TABLE tool_side_effects (
        idempotency_key TEXT PRIMARY KEY,
        tool_call_id TEXT NOT NULL REFERENCES tool_calls(id) ON DELETE CASCADE,
        result_json TEXT NOT NULL,
        committed_at TEXT NOT NULL
      ) STRICT;
      CREATE INDEX work_items_conversation_idx
        ON work_items(owner_profile_id, conversation_id, updated_at DESC);
      CREATE INDEX execution_runs_work_item_idx
        ON execution_runs(work_item_id, attempt DESC);
      CREATE INDEX run_steps_run_idx ON run_steps(run_id, sequence);
      CREATE INDEX tool_calls_run_idx ON tool_calls(run_id, updated_at);
      CREATE INDEX capability_scopes_match_idx
        ON capability_scopes(owner_profile_id, capability, resource_type, resource, revoked_at);
      CREATE INDEX permission_requests_pending_idx
        ON permission_requests(owner_profile_id, status, requested_at);
    `,
  },
  {
    version: 5,
    checksum: "mcp-device-config-v5-20260826",
    sql: `
      CREATE TABLE mcp_server_configs (
        id TEXT PRIMARY KEY,
        owner_profile_id TEXT NOT NULL,
        config_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;
      CREATE INDEX mcp_server_configs_owner_idx
        ON mcp_server_configs(owner_profile_id, updated_at DESC);
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
