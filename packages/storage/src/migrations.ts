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
  {
    version: 6,
    checksum: "conversation-bound-tool-scope-v6-20260826",
    sql: `
      ALTER TABLE capability_scopes ADD COLUMN conversation_id TEXT;
      CREATE INDEX capability_scopes_conversation_idx
        ON capability_scopes(owner_profile_id, conversation_id, capability, revoked_at);
    `,
  },
  {
    version: 7,
    checksum: "remote-command-application-v7-20260826",
    sql: `
      CREATE TABLE remote_command_applications (
        command_id TEXT PRIMARY KEY,
        command_digest TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('applying', 'applied', 'rejected')),
        result_json TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;
    `,
  },
  {
    version: 8,
    checksum: "skill-installation-lifecycle-v8-20260826",
    sql: `
      CREATE TABLE skill_installations (
        id TEXT PRIMARY KEY,
        owner_profile_id TEXT NOT NULL,
        name TEXT NOT NULL,
        display_name TEXT NOT NULL,
        description TEXT NOT NULL,
        publisher TEXT NOT NULL,
        scope TEXT NOT NULL CHECK (scope IN ('builtin', 'personal', 'workspace')),
        workspace_id TEXT,
        source_kind TEXT NOT NULL CHECK (source_kind IN (
          'built_in', 'local_directory', 'archive', 'platform_catalog'
        )),
        source_label TEXT NOT NULL,
        trust TEXT NOT NULL CHECK (trust IN ('bundled', 'signed', 'unverified')),
        desired_enabled INTEGER NOT NULL CHECK (desired_enabled IN (0, 1)),
        enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
        auto_invoke INTEGER NOT NULL CHECK (auto_invoke IN (0, 1)),
        package_state TEXT NOT NULL CHECK (package_state IN ('installed', 'missing', 'damaged')),
        active_version_id TEXT,
        selected_version TEXT NOT NULL,
        selected_checksum_sha256 TEXT NOT NULL,
        permission_digest TEXT NOT NULL,
        approved_permission_digest TEXT,
        declared_tools_json TEXT NOT NULL,
        declared_mcp_servers_json TEXT NOT NULL,
        permissions_json TEXT NOT NULL,
        platforms_json TEXT NOT NULL,
        installed_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_used_at TEXT,
        deleted_at TEXT,
        revision INTEGER NOT NULL CHECK (revision > 0),
        CHECK ((scope = 'workspace' AND workspace_id IS NOT NULL) OR
               (scope != 'workspace' AND workspace_id IS NULL))
      ) STRICT;
      CREATE TABLE skill_versions (
        id TEXT PRIMARY KEY,
        installation_id TEXT NOT NULL REFERENCES skill_installations(id) ON DELETE CASCADE,
        version TEXT NOT NULL,
        checksum_sha256 TEXT NOT NULL,
        package_path TEXT NOT NULL,
        scripts_json TEXT NOT NULL,
        metadata_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(installation_id, version)
      ) STRICT;
      CREATE TABLE skill_invocations (
        id TEXT PRIMARY KEY,
        installation_id TEXT NOT NULL REFERENCES skill_installations(id) ON DELETE CASCADE,
        generation_id TEXT NOT NULL,
        conversation_id TEXT NOT NULL,
        trigger TEXT NOT NULL CHECK (trigger IN ('explicit', 'automatic')),
        status TEXT NOT NULL CHECK (status IN (
          'selected', 'loaded', 'completed', 'failed', 'cancelled'
        )),
        reason TEXT NOT NULL,
        started_at TEXT NOT NULL,
        completed_at TEXT,
        error_code TEXT,
        UNIQUE(generation_id, installation_id)
      ) STRICT;
      CREATE UNIQUE INDEX skill_installations_identity_idx
        ON skill_installations(owner_profile_id, name, scope, COALESCE(workspace_id, ''))
        WHERE deleted_at IS NULL;
      CREATE INDEX skill_installations_owner_idx
        ON skill_installations(owner_profile_id, deleted_at, scope, name);
      CREATE INDEX skill_versions_installation_idx
        ON skill_versions(installation_id, created_at DESC);
      CREATE INDEX skill_invocations_generation_idx
        ON skill_invocations(generation_id, started_at);
    `,
  },
  {
    version: 9,
    checksum: "skill-tool-policy-v9-20260826",
    sql: `
      ALTER TABLE permission_requests RENAME TO permission_requests_v8;
      ALTER TABLE tool_side_effects RENAME TO tool_side_effects_v8;
      ALTER TABLE tool_calls RENAME TO tool_calls_v8;
      ALTER TABLE capability_scopes RENAME TO capability_scopes_v8;

      CREATE TABLE tool_calls (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL REFERENCES execution_runs(id) ON DELETE CASCADE,
        step_id TEXT NOT NULL REFERENCES run_steps(id) ON DELETE CASCADE,
        pi_call_ref TEXT NOT NULL,
        tool_name TEXT NOT NULL,
        source TEXT NOT NULL CHECK (source IN ('builtin', 'openerx', 'mcp', 'skill')),
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
          'browser', 'shell', 'desktop', 'mcp', 'skill'
        )),
        resource_type TEXT NOT NULL CHECK (resource_type IN (
          'builtin', 'workspace', 'path', 'domain', 'application', 'server', 'skill'
        )),
        resource TEXT NOT NULL,
        actions_json TEXT NOT NULL,
        max_risk TEXT NOT NULL CHECK (max_risk IN ('L0', 'L1', 'L2', 'L3', 'L4', 'L5')),
        session_only INTEGER NOT NULL CHECK (session_only IN (0, 1)),
        expires_at TEXT,
        revoked_at TEXT,
        created_at TEXT NOT NULL,
        conversation_id TEXT
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

      INSERT INTO tool_calls SELECT * FROM tool_calls_v8;
      INSERT INTO capability_scopes
        (id, owner_profile_id, capability, resource_type, resource, actions_json, max_risk,
         session_only, expires_at, revoked_at, created_at, conversation_id)
        SELECT id, owner_profile_id, capability, resource_type, resource, actions_json, max_risk,
               session_only, expires_at, revoked_at, created_at, conversation_id
        FROM capability_scopes_v8;
      INSERT INTO permission_requests SELECT * FROM permission_requests_v8;
      INSERT INTO tool_side_effects SELECT * FROM tool_side_effects_v8;

      DROP TABLE permission_requests_v8;
      DROP TABLE tool_side_effects_v8;
      DROP TABLE tool_calls_v8;
      DROP TABLE capability_scopes_v8;

      CREATE INDEX tool_calls_run_idx ON tool_calls(run_id, updated_at);
      CREATE INDEX capability_scopes_match_idx
        ON capability_scopes(owner_profile_id, capability, resource_type, resource, revoked_at);
      CREATE INDEX capability_scopes_conversation_idx
        ON capability_scopes(owner_profile_id, conversation_id, capability, revoked_at);
      CREATE INDEX permission_requests_pending_idx
        ON permission_requests(owner_profile_id, status, requested_at);
    `,
  },
  {
    version: 10,
    checksum: "conversation-thinking-level-v10-20260826",
    sql: `
      ALTER TABLE conversations ADD COLUMN thinking_level TEXT NOT NULL DEFAULT 'medium'
        CHECK (thinking_level IN ('off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'));
    `,
  },
  {
    version: 11,
    checksum: "codex-p0-run-scope-journal-v11-20260826",
    sql: `
      ALTER TABLE messages ADD COLUMN selected_model_ref TEXT;
      ALTER TABLE messages ADD COLUMN thinking_level TEXT
        CHECK (thinking_level IN ('off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'));
      ALTER TABLE messages ADD COLUMN cancellation_requested_at TEXT;
      UPDATE messages
         SET selected_model_ref = (
               SELECT conversations.selected_model_ref
                 FROM conversations
                WHERE conversations.id = messages.conversation_id
             ),
             thinking_level = (
               SELECT conversations.thinking_level
                 FROM conversations
                WHERE conversations.id = messages.conversation_id
             );

      ALTER TABLE execution_runs ADD COLUMN branch_id TEXT;
      ALTER TABLE execution_runs ADD COLUMN thinking_level TEXT NOT NULL DEFAULT 'medium'
        CHECK (thinking_level IN ('off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'));
      ALTER TABLE execution_runs ADD COLUMN usage_records_json TEXT NOT NULL DEFAULT '[]';
      ALTER TABLE execution_runs ADD COLUMN cancellation_requested_at TEXT;
      ALTER TABLE tool_calls ADD COLUMN result_content_json TEXT NOT NULL DEFAULT '[]';
      UPDATE execution_runs
         SET branch_id = (
               SELECT messages.branch_id
                 FROM work_items
                 JOIN messages ON messages.id = work_items.message_id
                WHERE work_items.id = execution_runs.work_item_id
             ),
             thinking_level = COALESCE((
               SELECT messages.thinking_level
                 FROM work_items
                 JOIN messages ON messages.id = work_items.message_id
                WHERE work_items.id = execution_runs.work_item_id
             ), 'medium');

      ALTER TABLE permission_requests RENAME TO permission_requests_v10;
      ALTER TABLE capability_scopes RENAME TO capability_scopes_v10;

      CREATE TABLE capability_scopes (
        id TEXT PRIMARY KEY,
        owner_profile_id TEXT NOT NULL,
        capability TEXT NOT NULL CHECK (capability IN (
          'builtin.compute', 'builtin.structured_data', 'file', 'web.search', 'image.generate',
          'browser', 'shell', 'desktop', 'mcp', 'skill'
        )),
        resource_type TEXT NOT NULL CHECK (resource_type IN (
          'builtin', 'workspace', 'path', 'domain', 'application', 'server', 'skill'
        )),
        resource TEXT NOT NULL,
        actions_json TEXT NOT NULL,
        max_risk TEXT NOT NULL CHECK (max_risk IN ('L0', 'L1', 'L2', 'L3', 'L4', 'L5')),
        session_only INTEGER NOT NULL CHECK (session_only IN (0, 1)),
        expires_at TEXT,
        revoked_at TEXT,
        created_at TEXT NOT NULL,
        conversation_id TEXT
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

      INSERT INTO capability_scopes
        (id, owner_profile_id, capability, resource_type, resource, actions_json, max_risk,
         session_only, expires_at, revoked_at, created_at, conversation_id)
        SELECT id, owner_profile_id,
               CASE
                 WHEN capability = 'web.search'
                  AND resource = 'image-generation.openerx.platform'
                 THEN 'image.generate'
                 ELSE capability
               END,
               resource_type, resource, actions_json, max_risk,
               session_only, expires_at, revoked_at, created_at, conversation_id
          FROM capability_scopes_v10;
      INSERT INTO permission_requests
        (id, owner_profile_id, work_item_id, run_id, tool_call_id, capability, risk,
         resource_type, resource, actions_json, reason, payload_digest, status, requested_at,
         expires_at, resolved_at, resolution, scope_id)
        SELECT id, owner_profile_id, work_item_id, run_id, tool_call_id,
               CASE
                 WHEN capability = 'web.search'
                  AND resource = 'image-generation.openerx.platform'
                 THEN 'image.generate'
                 ELSE capability
               END,
               risk, resource_type, resource, actions_json, reason, payload_digest, status,
               requested_at, expires_at, resolved_at, resolution, scope_id
          FROM permission_requests_v10;

      DROP TABLE permission_requests_v10;
      DROP TABLE capability_scopes_v10;

      CREATE INDEX capability_scopes_match_idx
        ON capability_scopes(owner_profile_id, capability, resource_type, resource, revoked_at);
      CREATE INDEX capability_scopes_conversation_idx
        ON capability_scopes(owner_profile_id, conversation_id, capability, revoked_at);
      CREATE INDEX permission_requests_pending_idx
        ON permission_requests(owner_profile_id, status, requested_at);

      CREATE TABLE tool_side_effect_attempts (
        idempotency_key TEXT PRIMARY KEY,
        tool_call_id TEXT NOT NULL REFERENCES tool_calls(id) ON DELETE CASCADE,
        status TEXT NOT NULL CHECK (status IN ('executing', 'committed', 'outcome_unknown')),
        result_json TEXT,
        started_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;
      CREATE INDEX tool_side_effect_attempts_status_idx
        ON tool_side_effect_attempts(status, updated_at);
    `,
  },
  {
    version: 12,
    checksum: "codex-p1-workspace-turn-snapshot-v12-20260827",
    sql: `
      ALTER TABLE execution_runs ADD COLUMN fallback_reason TEXT;
      ALTER TABLE execution_runs ADD COLUMN initial_tool_names_json TEXT NOT NULL DEFAULT '[]';
      ALTER TABLE execution_runs ADD COLUMN available_tool_names_json TEXT NOT NULL DEFAULT '[]';
      ALTER TABLE execution_runs ADD COLUMN skill_installation_ids_json TEXT NOT NULL DEFAULT '[]';
      ALTER TABLE execution_runs ADD COLUMN instruction_sources_json TEXT NOT NULL DEFAULT '[]';
      ALTER TABLE execution_runs ADD COLUMN configuration_frozen_at TEXT;

      ALTER TABLE permission_requests RENAME TO permission_requests_v11;
      ALTER TABLE capability_scopes RENAME TO capability_scopes_v11;

      CREATE TABLE capability_scopes (
        id TEXT PRIMARY KEY,
        owner_profile_id TEXT NOT NULL,
        capability TEXT NOT NULL CHECK (capability IN (
          'builtin.compute', 'builtin.structured_data', 'file', 'workspace', 'web.search',
          'image.generate', 'browser', 'shell', 'desktop', 'mcp', 'skill'
        )),
        resource_type TEXT NOT NULL CHECK (resource_type IN (
          'builtin', 'workspace', 'path', 'domain', 'application', 'server', 'skill'
        )),
        resource TEXT NOT NULL,
        actions_json TEXT NOT NULL,
        max_risk TEXT NOT NULL CHECK (max_risk IN ('L0', 'L1', 'L2', 'L3', 'L4', 'L5')),
        session_only INTEGER NOT NULL CHECK (session_only IN (0, 1)),
        expires_at TEXT,
        revoked_at TEXT,
        created_at TEXT NOT NULL,
        conversation_id TEXT
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
      INSERT INTO capability_scopes SELECT * FROM capability_scopes_v11;
      INSERT INTO permission_requests SELECT * FROM permission_requests_v11;
      DROP TABLE permission_requests_v11;
      DROP TABLE capability_scopes_v11;
      CREATE INDEX capability_scopes_match_idx
        ON capability_scopes(owner_profile_id, capability, resource_type, resource, revoked_at);
      CREATE INDEX capability_scopes_conversation_idx
        ON capability_scopes(owner_profile_id, conversation_id, capability, revoked_at);
      CREATE INDEX permission_requests_pending_idx
        ON permission_requests(owner_profile_id, status, requested_at);

      CREATE TABLE workspace_grants (
        id TEXT PRIMARY KEY,
        owner_profile_id TEXT NOT NULL,
        conversation_id TEXT,
        display_name TEXT NOT NULL,
        root_path TEXT NOT NULL,
        access TEXT NOT NULL CHECK (access IN ('read_only', 'read_write')),
        allow_network INTEGER NOT NULL CHECK (allow_network IN (0, 1)),
        expires_at TEXT,
        revoked_at TEXT,
        created_at TEXT NOT NULL
      ) STRICT;
      CREATE INDEX workspace_grants_active_idx
        ON workspace_grants(owner_profile_id, conversation_id, revoked_at, expires_at);

      CREATE TABLE workspace_changes (
        id TEXT PRIMARY KEY,
        owner_profile_id TEXT NOT NULL,
        workspace_grant_id TEXT NOT NULL REFERENCES workspace_grants(id),
        run_id TEXT NOT NULL REFERENCES execution_runs(id) ON DELETE CASCADE,
        relative_path TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN (
          'preparing', 'applied', 'reverted', 'failed', 'outcome_unknown'
        )),
        before_sha256 TEXT,
        after_sha256 TEXT NOT NULL,
        before_text TEXT,
        after_text TEXT NOT NULL,
        diff TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;
      CREATE INDEX workspace_changes_run_idx ON workspace_changes(run_id, created_at);
      CREATE INDEX workspace_changes_grant_idx
        ON workspace_changes(workspace_grant_id, relative_path, created_at);
    `,
  },
  {
    version: 13,
    checksum: "codex-p1-rich-run-items-v13-20260827",
    sql: `
      ALTER TABLE tool_calls ADD COLUMN input_json TEXT;

      CREATE TABLE run_items (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL REFERENCES execution_runs(id) ON DELETE CASCADE,
        sequence INTEGER NOT NULL CHECK (sequence > 0),
        pi_item_ref TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN (
          'queued', 'running', 'completed', 'failed', 'cancelled'
        )),
        content_json TEXT NOT NULL,
        started_at TEXT,
        completed_at TEXT,
        error_code TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(run_id, pi_item_ref)
      ) STRICT;
      CREATE INDEX run_items_replay_idx ON run_items(run_id, sequence, created_at, id);

      INSERT INTO run_items
        (id, run_id, sequence, pi_item_ref, status, content_json, started_at,
         completed_at, error_code, created_at, updated_at)
        SELECT tc.id, tc.run_id, rs.sequence, 'tool:' || tc.pi_call_ref,
               CASE
                 WHEN tc.status = 'completed' THEN 'completed'
                 WHEN tc.status = 'failed' THEN 'failed'
                 WHEN tc.status = 'cancelled' THEN 'cancelled'
                 ELSE 'running'
               END,
               json_object(
                 'type', 'tool',
                 'toolCallId', tc.id,
                 'toolName', tc.tool_name,
                 'input', NULL,
                 'inputSummary', tc.input_summary,
                 'targetSummary', tc.target_summary
               ),
               tc.started_at, tc.completed_at, tc.error_code,
               COALESCE(tc.started_at, er.created_at), tc.updated_at
          FROM tool_calls tc
          JOIN run_steps rs ON rs.id = tc.step_id
          JOIN execution_runs er ON er.id = tc.run_id;

      INSERT INTO run_items
        (id, run_id, sequence, pi_item_ref, status, content_json, started_at,
         completed_at, error_code, created_at, updated_at)
        SELECT rs.id, rs.run_id, rs.sequence, rs.pi_step_ref, rs.status,
               CASE rs.kind
                 WHEN 'model' THEN json_object(
                   'type', 'model', 'modelRef', er.selected_model_ref, 'summary', rs.title
                 )
                 WHEN 'compaction' THEN json_object(
                   'type', 'compaction', 'reason', 'unknown',
                   'tokensBefore', NULL, 'tokensAfter', NULL
                 )
                 ELSE json_object(
                   'type', 'retry', 'attempt', 1, 'maxAttempts', 1,
                   'delayMs', 0, 'summary', rs.title
                 )
               END,
               rs.started_at, rs.completed_at, rs.error_code,
               COALESCE(rs.started_at, er.created_at),
               COALESCE(rs.completed_at, rs.started_at, er.updated_at)
          FROM run_steps rs
          JOIN execution_runs er ON er.id = rs.run_id
         WHERE rs.kind IN ('model', 'compaction', 'retry');

      INSERT INTO run_items
        (id, run_id, sequence, pi_item_ref, status, content_json, started_at,
         completed_at, error_code, created_at, updated_at)
        SELECT pr.id, pr.run_id, 1000000 + pr.rowid, 'approval:' || pr.id,
               CASE
                 WHEN pr.status = 'pending' THEN 'running'
                 WHEN pr.status = 'approved' THEN 'completed'
                 WHEN pr.status = 'denied' THEN 'failed'
                 WHEN pr.status = 'cancelled' THEN 'cancelled'
                 ELSE 'failed'
               END,
               json_object(
                 'type', 'approval',
                 'permissionRequestId', pr.id,
                 'toolCallId', pr.tool_call_id,
                 'capability', pr.capability,
                 'risk', pr.risk,
                 'resource', pr.resource,
                 'reason', pr.reason
               ),
               pr.requested_at, pr.resolved_at,
               CASE WHEN pr.status = 'expired' THEN 'PERMISSION_EXPIRED' ELSE NULL END,
               pr.requested_at, COALESCE(pr.resolved_at, pr.requested_at)
          FROM permission_requests pr;
    `,
  },
  {
    version: 14,
    checksum: "pbash-workspace-change-sets-v14-20260828",
    sql: `
      CREATE TABLE workspace_change_sets (
        id TEXT PRIMARY KEY,
        owner_profile_id TEXT NOT NULL,
        workspace_grant_id TEXT NOT NULL REFERENCES workspace_grants(id),
        run_id TEXT NOT NULL REFERENCES execution_runs(id) ON DELETE CASCADE,
        tool_call_id TEXT NOT NULL REFERENCES tool_calls(id) ON DELETE CASCADE,
        status TEXT NOT NULL CHECK (status IN (
          'pending_review', 'reviewed', 'applying', 'applied', 'reverted', 'discarded', 'blocked',
          'apply_failed', 'outcome_unknown'
        )),
        baseline_revision TEXT NOT NULL,
        final_revision TEXT NOT NULL,
        manifest_json TEXT NOT NULL,
        diffs_json TEXT NOT NULL,
        entries_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;
      CREATE INDEX workspace_change_sets_grant_idx
        ON workspace_change_sets(owner_profile_id, workspace_grant_id, updated_at DESC);
      CREATE INDEX workspace_change_sets_run_idx
        ON workspace_change_sets(run_id, created_at);
    `,
  },
  {
    version: 15,
    checksum: "pbash-remote-idempotency-reconciliation-v15-20260828",
    sql: `
      ALTER TABLE tool_side_effects
        ADD COLUMN operation_digest TEXT NOT NULL DEFAULT '';
      ALTER TABLE tool_side_effect_attempts
        ADD COLUMN operation_digest TEXT NOT NULL DEFAULT '';

      ALTER TABLE remote_command_applications RENAME TO remote_command_applications_v15;
      CREATE TABLE remote_command_applications (
        command_id TEXT PRIMARY KEY,
        command_digest TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('applying', 'applied', 'rejected', 'outcome_unknown')),
        result_json TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;
      INSERT INTO remote_command_applications
        (command_id, command_digest, status, result_json, created_at, updated_at)
        SELECT command_id, command_digest, status, result_json, created_at, updated_at
          FROM remote_command_applications_v15;
      DROP TABLE remote_command_applications_v15;
    `,
  },
  {
    version: 16,
    checksum: "local-web-search-settings-v16-20260829",
    sql: `
      CREATE TABLE local_web_search_settings (
        owner_profile_id TEXT PRIMARY KEY,
        provider_id TEXT NOT NULL CHECK (provider_id IN (
          'direct:baidu-json', 'direct:bing-html'
        )),
        locale TEXT NOT NULL CHECK (locale IN ('zh-CN', 'en-US')),
        safe_search TEXT NOT NULL CHECK (safe_search IN ('off', 'moderate', 'strict')),
        updated_at TEXT NOT NULL
      ) STRICT;
    `,
  },
];

export function migrateDatabase(
  database: DatabaseSync,
  options: { throughVersion?: number } = {},
): void {
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
  const targetVersion = options.throughVersion ?? latestSupported;
  if (!Number.isInteger(targetVersion) || targetVersion < 0 || targetVersion > latestSupported) {
    throw new Error(`Unsupported database migration target ${targetVersion}`);
  }
  const latestApplied = Number(rows.at(-1)?.version ?? 0);
  if (latestApplied > latestSupported) {
    throw new Error(
      `Database schema ${latestApplied} is newer than supported schema ${latestSupported}`,
    );
  }
  if (latestApplied > targetVersion) {
    throw new Error(
      `Database schema ${latestApplied} is newer than requested schema ${targetVersion}`,
    );
  }
  for (const row of rows) {
    const expected = migrations.find(({ version }) => version === Number(row.version));
    if (!expected || expected.checksum !== row.checksum) {
      throw new Error(`Database migration checksum mismatch at version ${row.version}`);
    }
  }
  for (const migration of migrations) {
    if (migration.version <= latestApplied || migration.version > targetVersion) continue;
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
