import { afterAll, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import postgres from "../../control-plane/service/node_modules/postgres";
import { KEY_FOREIGN_KEYS } from "../../control-plane/service/src/db/migration/metadata";

const rawDatabaseUrl = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL || "";
const DATABASE_URL = /^(postgres|postgresql):\/\//i.test(rawDatabaseUrl)
  ? rawDatabaseUrl
  : "postgres://127.0.0.1:5432/openerx";
const sql = postgres(DATABASE_URL, { max: 1, prepare: false });
const schemaPgSource = readFileSync(
  resolve(import.meta.dir, "../../control-plane/service/src/db/schema.pg.ts"),
  "utf8",
);

afterAll(async () => {
  await sql.end();
});

test("project tree and task snapshot schema authority declares canonical foreign keys", () => {
  expect(schemaPgSource).toContain('export const projectTreeNodes = pgTable(\n  "project_tree_nodes"');
  expect(schemaPgSource).toContain(
    'projectId: text("project_id")\n      .notNull()\n      .references(() => projects.id)',
  );
  expect(schemaPgSource).toContain(
    'parentId: text("parent_id").references((): AnyPgColumn => projectTreeNodes.id)',
  );
  expect(schemaPgSource).toContain(
    'supersededBy: text("superseded_by").references((): AnyPgColumn => projectTreeNodes.id)',
  );
  expect(schemaPgSource).toContain('export const taskSnapshots = pgTable(\n  "task_snapshots"');
  expect(schemaPgSource).toContain(
    'taskId: text("task_id")\n      .primaryKey()\n      .references(() => tasks.id, { onDelete: "cascade" })',
  );
  expect(schemaPgSource).toContain(
    'projectId: text("project_id")\n      .notNull()\n      .references(() => projects.id)',
  );
  expect(schemaPgSource).toContain(
    'currentPhaseId: text("current_phase_id").references(() => taskExecutionPhases.id)',
  );
  expect(schemaPgSource).toContain(
    'latestPhaseId: text("latest_phase_id").references(() => taskExecutionPhases.id)',
  );
  expect(schemaPgSource).toContain(
    'currentSessionId: text("current_session_id").references((): AnyPgColumn => taskSessions.id)',
  );
  expect(schemaPgSource).toContain(
    'latestSessionId: text("latest_session_id").references((): AnyPgColumn => taskSessions.id)',
  );
});

test("project tree and task snapshot migration metadata tracks canonical foreign keys", () => {
  const relevantRules = KEY_FOREIGN_KEYS.filter(
    (rule) =>
      rule.table === "project_tree_nodes" ||
      (rule.table === "task_snapshots" &&
        ["current_phase_id", "latest_phase_id", "current_session_id", "latest_session_id"].includes(
          rule.column,
        )),
  );

  expect(relevantRules).toEqual(
    expect.arrayContaining([
      { table: "project_tree_nodes", column: "parent_id", targetTable: "project_tree_nodes" },
      {
        table: "project_tree_nodes",
        column: "superseded_by",
        targetTable: "project_tree_nodes",
      },
      {
        table: "task_snapshots",
        column: "current_phase_id",
        targetTable: "task_execution_phases",
      },
      {
        table: "task_snapshots",
        column: "latest_phase_id",
        targetTable: "task_execution_phases",
      },
      { table: "task_snapshots", column: "current_session_id", targetTable: "task_sessions" },
      { table: "task_snapshots", column: "latest_session_id", targetTable: "task_sessions" },
    ]),
  );
});

test("project tree and task snapshot PostgreSQL constraints stay aligned", async () => {
  const rows = await sql.unsafe<
    Array<{
      tableName: string;
      constraintName: string;
      constraintDef: string;
    }>
  >(
    `SELECT
      conrelid::regclass::text AS "tableName",
      conname AS "constraintName",
      pg_get_constraintdef(oid) AS "constraintDef"
    FROM pg_constraint
    WHERE contype = 'f'
      AND conrelid IN ('project_tree_nodes'::regclass, 'task_snapshots'::regclass)
    ORDER BY conrelid::regclass::text ASC, conname ASC`,
  );

  const constraints = new Map(rows.map((row) => [row.constraintName, row]));

  expect(constraints.get("project_tree_nodes_parent_id_project_tree_nodes_id_fk")).toEqual({
    tableName: "project_tree_nodes",
    constraintName: "project_tree_nodes_parent_id_project_tree_nodes_id_fk",
    constraintDef: "FOREIGN KEY (parent_id) REFERENCES project_tree_nodes(id)",
  });
  expect(constraints.get("project_tree_nodes_superseded_by_project_tree_nodes_id_fk")).toEqual({
    tableName: "project_tree_nodes",
    constraintName: "project_tree_nodes_superseded_by_project_tree_nodes_id_fk",
    constraintDef: "FOREIGN KEY (superseded_by) REFERENCES project_tree_nodes(id)",
  });
  expect(constraints.get("task_snapshots_current_phase_id_task_execution_phases_id_fk")).toEqual({
    tableName: "task_snapshots",
    constraintName: "task_snapshots_current_phase_id_task_execution_phases_id_fk",
    constraintDef: "FOREIGN KEY (current_phase_id) REFERENCES task_execution_phases(id)",
  });
  expect(constraints.get("task_snapshots_latest_phase_id_task_execution_phases_id_fk")).toEqual({
    tableName: "task_snapshots",
    constraintName: "task_snapshots_latest_phase_id_task_execution_phases_id_fk",
    constraintDef: "FOREIGN KEY (latest_phase_id) REFERENCES task_execution_phases(id)",
  });
  expect(constraints.get("task_snapshots_current_session_id_task_sessions_id_fk")).toEqual({
    tableName: "task_snapshots",
    constraintName: "task_snapshots_current_session_id_task_sessions_id_fk",
    constraintDef:
      "FOREIGN KEY (current_session_id) REFERENCES task_sessions(id) DEFERRABLE INITIALLY DEFERRED",
  });
  expect(constraints.get("task_snapshots_latest_session_id_task_sessions_id_fk")).toEqual({
    tableName: "task_snapshots",
    constraintName: "task_snapshots_latest_session_id_task_sessions_id_fk",
    constraintDef:
      "FOREIGN KEY (latest_session_id) REFERENCES task_sessions(id) DEFERRABLE INITIALLY DEFERRED",
  });
});

test("task session, run, and timeline schema authority keeps canonical phase chain and delete actions", () => {
  expect(schemaPgSource).toContain('export const taskSessions = pgTable(\n  "task_sessions"');
  expect(schemaPgSource).toContain(
    'taskId: text("task_id")\n      .notNull()\n      .references(() => tasks.id, { onDelete: "cascade" })',
  );
  expect(schemaPgSource).toContain(
    'phaseId: text("phase_id").references(() => taskExecutionPhases.id)',
  );
  expect(schemaPgSource).toContain('export const taskSessionRuns = pgTable(\n  "task_session_runs"');
  expect(schemaPgSource).toContain(
    'sessionId: text("session_id")\n      .notNull()\n      .references(() => taskSessions.id, { onDelete: "cascade" })',
  );
  expect(schemaPgSource).toContain('export const taskTimelineViews = pgTable(\n  "task_timeline_views"');
  expect(schemaPgSource).toContain(
    'taskId: text("task_id")\n      .notNull()\n      .references(() => tasks.id, { onDelete: "cascade" })',
  );
  expect(schemaPgSource).toContain(
    'sessionId: text("session_id").references(() => taskSessions.id, { onDelete: "cascade" })',
  );
  expect(schemaPgSource).toContain(
    'messageId: text("message_id").references(() => taskMessages.id, { onDelete: "cascade" })',
  );
  expect(schemaPgSource).toContain(
    'operationId: text("operation_id").references(() => taskOperations.id, { onDelete: "cascade" })',
  );
  expect(schemaPgSource).toContain(
    'artifactId: text("artifact_id").references(() => taskArtifacts.id, { onDelete: "cascade" })',
  );
});

test("task session, run, and timeline migration metadata tracks canonical foreign keys", () => {
  const relevantRules = KEY_FOREIGN_KEYS.filter((rule) =>
    ["task_sessions", "task_session_runs", "task_timeline_views"].includes(rule.table),
  );

  expect(relevantRules).toEqual(
    expect.arrayContaining([
      { table: "task_sessions", column: "task_id", targetTable: "tasks" },
      { table: "task_sessions", column: "project_id", targetTable: "projects" },
      { table: "task_sessions", column: "tree_node_id", targetTable: "project_tree_nodes" },
      { table: "task_sessions", column: "parent_session_id", targetTable: "task_sessions" },
      { table: "task_sessions", column: "root_session_id", targetTable: "task_sessions" },
      { table: "task_sessions", column: "phase_id", targetTable: "task_execution_phases" },
      { table: "task_sessions", column: "winner_session_id", targetTable: "task_sessions" },
      { table: "task_sessions", column: "judge_session_id", targetTable: "task_sessions" },
      { table: "task_session_runs", column: "task_id", targetTable: "tasks" },
      { table: "task_session_runs", column: "session_id", targetTable: "task_sessions" },
      { table: "task_session_runs", column: "phase_id", targetTable: "task_execution_phases" },
      { table: "task_timeline_views", column: "project_id", targetTable: "projects" },
      { table: "task_timeline_views", column: "task_id", targetTable: "tasks" },
      { table: "task_timeline_views", column: "phase_id", targetTable: "task_execution_phases" },
      { table: "task_timeline_views", column: "session_id", targetTable: "task_sessions" },
      { table: "task_timeline_views", column: "message_id", targetTable: "task_messages" },
      { table: "task_timeline_views", column: "operation_id", targetTable: "task_operations" },
      { table: "task_timeline_views", column: "artifact_id", targetTable: "task_artifacts" },
    ]),
  );

  expect(relevantRules).not.toEqual(
    expect.arrayContaining([
      { table: "task_timeline_views", column: "run_id", targetTable: "task_runs" },
      { table: "task_timeline_views", column: "run_node_id", targetTable: "task_run_nodes" },
      { table: "task_timeline_views", column: "session_id", targetTable: "conversation_sessions" },
      { table: "task_timeline_views", column: "message_id", targetTable: "conversation_messages" },
    ]),
  );
});

test("task session, run, and timeline PostgreSQL constraints stay aligned", async () => {
  const rows = await sql.unsafe<
    Array<{
      tableName: string;
      constraintName: string;
      constraintDef: string;
    }>
  >(
    `SELECT
      conrelid::regclass::text AS "tableName",
      conname AS "constraintName",
      pg_get_constraintdef(oid) AS "constraintDef"
    FROM pg_constraint
    WHERE contype = 'f'
      AND conrelid IN ('task_sessions'::regclass, 'task_session_runs'::regclass, 'task_timeline_views'::regclass)
    ORDER BY conrelid::regclass::text ASC, conname ASC`,
  );

  const constraints = new Map(rows.map((row) => [row.constraintName, row]));

  expect(constraints.get("task_sessions_task_id_tasks_id_fk")).toEqual({
    tableName: "task_sessions",
    constraintName: "task_sessions_task_id_tasks_id_fk",
    constraintDef: "FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE",
  });
  expect(constraints.get("task_sessions_phase_id_task_execution_phases_id_fk")).toEqual({
    tableName: "task_sessions",
    constraintName: "task_sessions_phase_id_task_execution_phases_id_fk",
    constraintDef: "FOREIGN KEY (phase_id) REFERENCES task_execution_phases(id)",
  });
  expect(constraints.get("task_session_runs_task_id_tasks_id_fk")).toEqual({
    tableName: "task_session_runs",
    constraintName: "task_session_runs_task_id_tasks_id_fk",
    constraintDef: "FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE",
  });
  expect(constraints.get("task_session_runs_session_id_task_sessions_id_fk")).toEqual({
    tableName: "task_session_runs",
    constraintName: "task_session_runs_session_id_task_sessions_id_fk",
    constraintDef: "FOREIGN KEY (session_id) REFERENCES task_sessions(id) ON DELETE CASCADE",
  });
  expect(constraints.get("task_session_runs_phase_id_task_execution_phases_id_fk")).toEqual({
    tableName: "task_session_runs",
    constraintName: "task_session_runs_phase_id_task_execution_phases_id_fk",
    constraintDef: "FOREIGN KEY (phase_id) REFERENCES task_execution_phases(id)",
  });
  expect(constraints.get("task_timeline_views_task_id_tasks_id_fk")).toEqual({
    tableName: "task_timeline_views",
    constraintName: "task_timeline_views_task_id_tasks_id_fk",
    constraintDef: "FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE",
  });
  expect(constraints.get("task_timeline_views_phase_id_task_execution_phases_id_fk")).toEqual({
    tableName: "task_timeline_views",
    constraintName: "task_timeline_views_phase_id_task_execution_phases_id_fk",
    constraintDef: "FOREIGN KEY (phase_id) REFERENCES task_execution_phases(id)",
  });
  expect(constraints.get("task_timeline_views_session_id_task_sessions_id_fk")).toEqual({
    tableName: "task_timeline_views",
    constraintName: "task_timeline_views_session_id_task_sessions_id_fk",
    constraintDef: "FOREIGN KEY (session_id) REFERENCES task_sessions(id) ON DELETE CASCADE",
  });
  expect(constraints.get("task_timeline_views_message_id_task_messages_id_fk")).toEqual({
    tableName: "task_timeline_views",
    constraintName: "task_timeline_views_message_id_task_messages_id_fk",
    constraintDef:
      "FOREIGN KEY (message_id) REFERENCES task_messages(id) ON DELETE CASCADE NOT VALID",
  });
  expect(constraints.get("task_timeline_views_operation_id_task_operations_id_fk")).toEqual({
    tableName: "task_timeline_views",
    constraintName: "task_timeline_views_operation_id_task_operations_id_fk",
    constraintDef:
      "FOREIGN KEY (operation_id) REFERENCES task_operations(id) ON DELETE CASCADE NOT VALID",
  });
  expect(constraints.get("task_timeline_views_artifact_id_task_artifacts_id_fk")).toEqual({
    tableName: "task_timeline_views",
    constraintName: "task_timeline_views_artifact_id_task_artifacts_id_fk",
    constraintDef: "FOREIGN KEY (artifact_id) REFERENCES task_artifacts(id) ON DELETE CASCADE",
  });
});
