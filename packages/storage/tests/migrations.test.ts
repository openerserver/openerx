import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { migrateDatabase } from "../src";

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe("database migrations", () => {
  it("rolls back the entire pending upgrade on failure and can retry after reopening", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "openerx-migration-rollback-"));
    directories.push(directory);
    const file = path.join(directory, "openerx.sqlite");
    let database = new DatabaseSync(file);
    try {
      migrateDatabase(database, { throughVersion: 30 });
      database.exec(`
        CREATE TRIGGER fail_upgrade BEFORE INSERT ON schema_migrations
        WHEN NEW.version = 32
        BEGIN SELECT RAISE(ABORT, 'fixture upgrade failure'); END;
      `);
      expect(() => migrateDatabase(database)).toThrow("fixture upgrade failure");
      expect(
        database.prepare("SELECT MAX(version) AS version FROM schema_migrations").get(),
      ).toEqual({
        version: 30,
      });
      expect(
        database.prepare("SELECT name FROM sqlite_master WHERE name = 'projects'").get(),
      ).toBeUndefined();
      expect(
        database
          .prepare("SELECT name FROM pragma_table_info('conversations') WHERE name = 'project_id'")
          .get(),
      ).toBeUndefined();
      expect(database.prepare("PRAGMA quick_check").get()).toEqual({ quick_check: "ok" });
      database.exec("DROP TRIGGER fail_upgrade");
    } finally {
      database.close();
    }

    database = new DatabaseSync(file);
    try {
      migrateDatabase(database);
      expect(
        database.prepare("SELECT MAX(version) AS version FROM schema_migrations").get(),
      ).toEqual({
        version: 32,
      });
      expect(
        database.prepare("SELECT name FROM sqlite_master WHERE name = 'projects'").get(),
      ).toEqual({
        name: "projects",
      });
      expect(database.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
      expect(() => migrateDatabase(database)).not.toThrow();
    } finally {
      database.close();
    }
  });

  it("adds personal projects while keeping directory grants device-local", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "openerx-project-migration-"));
    directories.push(directory);
    const database = new DatabaseSync(path.join(directory, "openerx.sqlite"));
    migrateDatabase(database, { throughVersion: 30 });
    const now = "2026-09-04T00:00:00.000Z";
    const conversationId = "20000000-0000-4000-8000-000000000001";
    const branchId = "20000000-0000-4000-8000-000000000002";
    const grantId = "20000000-0000-4000-8000-000000000003";
    database
      .prepare(
        `INSERT INTO conversations
         (id, owner_profile_id, title, active_branch_id, selected_model_ref, thinking_level,
          created_at, updated_at, archived_at, deleted_at, revision)
         VALUES (?, 'local-default', 'legacy manual workspace', ?, 'platform/auto', 'medium',
                 ?, ?, NULL, NULL, 1)`,
      )
      .run(conversationId, branchId, now, now);
    database
      .prepare(
        `INSERT INTO workspace_grants
         (id, owner_profile_id, conversation_id, display_name, root_path, access, allow_network,
          expires_at, revoked_at, created_at)
         VALUES (?, 'local-default', ?, 'legacy', 'C:\\legacy', 'read_write', 0,
                 NULL, NULL, ?)`,
      )
      .run(grantId, conversationId, now);
    database
      .prepare(
        `INSERT INTO workspace_bindings
         (workspace_grant_id, owner_profile_id, conversation_id, role, source, created_at, updated_at)
         VALUES (?, 'local-default', ?, 'primary', 'project', ?, ?)`,
      )
      .run(grantId, conversationId, now, now);

    migrateDatabase(database);

    expect(
      database
        .prepare(
          `SELECT name FROM sqlite_master
           WHERE type = 'table' AND name IN
             ('projects', 'project_directories', 'project_directory_bindings')
           ORDER BY name`,
        )
        .all(),
    ).toEqual([
      { name: "project_directories" },
      { name: "project_directory_bindings" },
      { name: "projects" },
    ]);
    expect(
      database
        .prepare("SELECT source FROM workspace_bindings WHERE workspace_grant_id = ?")
        .get(grantId),
    ).toEqual({ source: "user_added" });
    expect(
      database
        .prepare("SELECT name FROM pragma_table_info('conversations') WHERE name = 'project_id'")
        .get(),
    ).toEqual({ name: "project_id" });
    expect(
      database
        .prepare(
          `SELECT name FROM pragma_table_info('workspace_bindings')
           WHERE name IN ('project_directory_binding_id', 'source_revision') ORDER BY name`,
        )
        .all(),
    ).toEqual([{ name: "project_directory_binding_id" }, { name: "source_revision" }]);
    expect(
      database
        .prepare(
          "SELECT name FROM pragma_table_info('workspace_grants') WHERE name = 'project_operation_id'",
        )
        .get(),
    ).toEqual({ name: "project_operation_id" });
    expect(
      database
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'workspace_grants_project_operation_idx'",
        )
        .get(),
    ).toEqual({ name: "workspace_grants_project_operation_idx" });
    database.close();
  });

  it("enables untouched legacy memory defaults without overriding explicit choices", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "openerx-memory-default-migration-"));
    directories.push(directory);
    const database = new DatabaseSync(path.join(directory, "openerx.sqlite"));
    migrateDatabase(database, { throughVersion: 27 });
    const insert = database.prepare(
      `INSERT INTO memory_settings
       (owner_profile_id, memories_enabled, use_memories, generate_memories, sync_memories,
        disable_on_external_context, idle_delay_minutes, min_rate_limit_remaining_percent,
        updated_at, revision)
       VALUES (?, 0, 0, 0, 0, 1, 30, ?, '2026-08-30T00:00:00.000Z', ?)`,
    );
    insert.run("untouched-default", 20, 1);
    insert.run("explicitly-disabled", 20, 2);
    insert.run("custom-guard", 35, 1);

    migrateDatabase(database);

    expect(
      database
        .prepare(
          `SELECT owner_profile_id AS ownerProfileId, memories_enabled AS memoriesEnabled,
                  use_memories AS useMemories, generate_memories AS generateMemories,
                  min_rate_limit_remaining_percent AS minimumRemaining, revision
           FROM memory_settings ORDER BY owner_profile_id`,
        )
        .all(),
    ).toEqual([
      {
        ownerProfileId: "custom-guard",
        memoriesEnabled: 0,
        useMemories: 0,
        generateMemories: 0,
        minimumRemaining: 35,
        revision: 1,
      },
      {
        ownerProfileId: "explicitly-disabled",
        memoriesEnabled: 0,
        useMemories: 0,
        generateMemories: 0,
        minimumRemaining: 20,
        revision: 2,
      },
      {
        ownerProfileId: "untouched-default",
        memoriesEnabled: 1,
        useMemories: 1,
        generateMemories: 1,
        minimumRemaining: 20,
        revision: 1,
      },
    ]);
    database.close();
  });

  it("adds durable memory merge reviews with bounded review indexes", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "openerx-memory-review-migration-"));
    directories.push(directory);
    const database = new DatabaseSync(path.join(directory, "openerx.sqlite"));
    migrateDatabase(database, { throughVersion: 24 });
    migrateDatabase(database);

    expect(
      database
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'memory_merge_reviews'",
        )
        .get(),
    ).toEqual({ name: "memory_merge_reviews" });
    expect(
      database
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'memory_merge_reviews_status_idx'",
        )
        .get(),
    ).toEqual({ name: "memory_merge_reviews_status_idx" });
    expect(
      database
        .prepare(
          "SELECT name FROM pragma_table_info('memory_merge_reviews') WHERE name = 'proposal_memory_id'",
        )
        .get(),
    ).toEqual({ name: "proposal_memory_id" });
    expect(
      database
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'memory_merge_reviews_proposal_idx'",
        )
        .get(),
    ).toEqual({ name: "memory_merge_reviews_proposal_idx" });
    expect(
      database
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'memory_semantic_cluster_state'",
        )
        .get(),
    ).toEqual({ name: "memory_semantic_cluster_state" });
    database.close();
  });

  it("adds persistent memory consolidation runs with one running job per profile", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "openerx-memory-consolidation-migration-"));
    directories.push(directory);
    const database = new DatabaseSync(path.join(directory, "openerx.sqlite"));
    migrateDatabase(database, { throughVersion: 23 });
    migrateDatabase(database);

    expect(
      database
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'memory_consolidation_runs'",
        )
        .get(),
    ).toEqual({ name: "memory_consolidation_runs" });
    expect(
      database
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'memory_consolidation_runs_running_idx'",
        )
        .get(),
    ).toEqual({ name: "memory_consolidation_runs_running_idx" });
    database.close();
  });

  it("adds a nullable conflict slot with one active value per kind", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "openerx-memory-conflict-migration-"));
    directories.push(directory);
    const database = new DatabaseSync(path.join(directory, "openerx.sqlite"));
    migrateDatabase(database, { throughVersion: 22 });
    migrateDatabase(database);

    expect(
      database
        .prepare("SELECT name FROM pragma_table_info('memory_entries') WHERE name = 'conflict_key'")
        .get(),
    ).toEqual({ name: "conflict_key" });
    expect(
      database
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'memory_entries_active_conflict_idx'",
        )
        .get(),
    ).toEqual({ name: "memory_entries_active_conflict_idx" });
    database.close();
  });

  it("backfills primary memory provenance into multi-source links", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "openerx-memory-source-migration-"));
    directories.push(directory);
    const database = new DatabaseSync(path.join(directory, "openerx.sqlite"));
    migrateDatabase(database, { throughVersion: 21 });
    const now = "2026-08-30T00:00:00.000Z";
    const conversationId = "10000000-0000-4000-8000-000000000001";
    const memoryId = "10000000-0000-4000-8000-000000000002";
    database
      .prepare(
        `INSERT INTO memory_entries
         (id, owner_profile_id, scope, kind, content, retrieval_keys_json, canonical_key,
          origin, confidence, status, source_conversation_id, source_message_id,
          supersedes_memory_id, expires_at, created_at, updated_at, revision)
         VALUES (?, 'local-default', 'personal', 'preference', '先给结论。', '[]',
                 'preference:test', 'automatic', 0.9, 'active', ?, NULL,
                 NULL, NULL, ?, ?, 1)`,
      )
      .run(memoryId, conversationId, now, now);

    migrateDatabase(database);

    expect(
      database
        .prepare(
          `SELECT memory_id, owner_profile_id, conversation_id, origin, confidence
           FROM memory_source_links WHERE memory_id = ?`,
        )
        .get(memoryId),
    ).toEqual({
      memory_id: memoryId,
      owner_profile_id: "local-default",
      conversation_id: conversationId,
      origin: "automatic",
      confidence: 0.9,
    });
    database.close();
  });

  it("moves legacy image-generation scopes and requests off web.search", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "openerx-migration-"));
    directories.push(directory);
    const database = new DatabaseSync(path.join(directory, "openerx.sqlite"));
    migrateDatabase(database, { throughVersion: 10 });
    const now = "2026-08-26T00:00:00.000Z";
    const ids = {
      conversation: "00000000-0000-4000-8000-000000000001",
      branch: "00000000-0000-4000-8000-000000000002",
      message: "00000000-0000-4000-8000-000000000003",
      workItem: "00000000-0000-4000-8000-000000000004",
      run: "00000000-0000-4000-8000-000000000005",
      step: "00000000-0000-4000-8000-000000000006",
      toolCall: "00000000-0000-4000-8000-000000000007",
      scope: "00000000-0000-4000-8000-000000000008",
      permission: "00000000-0000-4000-8000-000000000009",
    };
    database
      .prepare(
        `INSERT INTO conversations
         (id, owner_profile_id, title, active_branch_id, selected_model_ref, created_at, updated_at,
          archived_at, deleted_at, revision, thinking_level)
         VALUES (?, 'local-default', 'migration', ?, 'platform/auto', ?, ?, NULL, NULL, 1, 'medium')`,
      )
      .run(ids.conversation, ids.branch, now, now);
    database
      .prepare(
        `INSERT INTO branches
         (id, conversation_id, parent_branch_id, forked_from_message_id, label, created_at)
         VALUES (?, ?, NULL, NULL, 'main', ?)`,
      )
      .run(ids.branch, ids.conversation, now);
    database
      .prepare(
        `INSERT INTO messages
         (id, conversation_id, branch_id, parent_message_id, role, status, error_code, attempt,
          created_at, updated_at, revision, position, runtime_sequence)
         VALUES (?, ?, ?, NULL, 'assistant', 'pending', NULL, 1, ?, ?, 1, 1, 0)`,
      )
      .run(ids.message, ids.conversation, ids.branch, now, now);
    database
      .prepare(
        `INSERT INTO work_items
         (id, owner_profile_id, conversation_id, message_id, title, status, active_run_id,
          created_at, updated_at, completed_at, revision)
         VALUES (?, 'local-default', ?, ?, 'migration', 'running', ?, ?, ?, NULL, 1)`,
      )
      .run(ids.workItem, ids.conversation, ids.message, ids.run, now, now);
    database
      .prepare(
        `INSERT INTO execution_runs
         (id, work_item_id, attempt, status, pi_package_version, pi_host_contract_version,
          selected_model_ref, effective_model_ref, pi_session_ref, last_pi_event_sequence,
          retry_count, compaction_count, error_code, created_at, started_at, completed_at, updated_at)
         VALUES (?, ?, 1, 'running', '0.84.3', 1, 'platform/auto', NULL, NULL, 0, 0, 0,
                 NULL, ?, ?, NULL, ?)`,
      )
      .run(ids.run, ids.workItem, now, now, now);
    database
      .prepare(
        `INSERT INTO run_steps
         (id, run_id, pi_step_ref, kind, title, status, sequence, started_at, completed_at, error_code)
         VALUES (?, ?, 'legacy-image', 'tool', 'image', 'running', 1, ?, NULL, NULL)`,
      )
      .run(ids.step, ids.run, now);
    database
      .prepare(
        `INSERT INTO tool_calls
         (id, run_id, step_id, pi_call_ref, tool_name, source, status, risk, idempotency_key,
          input_summary, target_summary, result_summary, error_code, started_at, completed_at,
          updated_at)
         VALUES (?, ?, ?, 'legacy-image', 'openerx_image_generate', 'openerx', 'waiting_for_permission',
                 'L2', 'legacy-image-generate-0001', 'prompt', 'platform', NULL, NULL, ?, NULL, ?)`,
      )
      .run(ids.toolCall, ids.run, ids.step, now, now);
    database
      .prepare(
        `INSERT INTO capability_scopes
         (id, owner_profile_id, capability, resource_type, resource, actions_json, max_risk,
          session_only, expires_at, revoked_at, created_at, conversation_id)
         VALUES (?, 'local-default', 'web.search', 'server', 'image-generation.openerx.platform',
                 '["create"]', 'L2', 1, NULL, NULL, ?, ?)`,
      )
      .run(ids.scope, now, ids.conversation);
    database
      .prepare(
        `INSERT INTO permission_requests
         (id, owner_profile_id, work_item_id, run_id, tool_call_id, capability, risk,
          resource_type, resource, actions_json, reason, payload_digest, status, requested_at,
          expires_at, resolved_at, resolution, scope_id)
         VALUES (?, 'local-default', ?, ?, ?, 'web.search', 'L2', 'server',
                 'image-generation.openerx.platform', '["create"]', 'legacy image permission', ?,
                 'approved', ?, ?, ?, 'session', ?)`,
      )
      .run(
        ids.permission,
        ids.workItem,
        ids.run,
        ids.toolCall,
        "a".repeat(64),
        now,
        now,
        now,
        ids.scope,
      );

    migrateDatabase(database);

    expect(
      database.prepare("SELECT capability FROM capability_scopes WHERE id = ?").get(ids.scope),
    ).toEqual({ capability: "image.generate" });
    expect(
      database
        .prepare("SELECT capability FROM permission_requests WHERE id = ?")
        .get(ids.permission),
    ).toEqual({ capability: "image.generate" });
    expect(
      database
        .prepare(
          `SELECT id, json_extract(content_json, '$.type') AS type, status
           FROM run_items WHERE run_id = ? ORDER BY sequence`,
        )
        .all(ids.run),
    ).toEqual([
      { id: ids.toolCall, type: "tool", status: "running" },
      { id: ids.permission, type: "approval", status: "completed" },
    ]);
    expect(
      database.prepare("SELECT input_json FROM tool_calls WHERE id = ?").get(ids.toolCall),
    ).toEqual({ input_json: null });
    database.close();
  });
});
