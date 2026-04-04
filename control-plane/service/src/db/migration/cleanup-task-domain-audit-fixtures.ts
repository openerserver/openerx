#!/usr/bin/env bun

import { closeDatabase, postgresSql } from "../index";
import { getBooleanArg, getStringArg, parseCliArgs } from "./metadata";

const FIXTURE_TITLE_PREFIXES = [
  "tree-cache-state-",
  "tree-primary-task-",
  "tree-task-sync-",
  "conversation-dual-write-",
  "task-run-dual-write-",
  "dashboard-tree-",
  "agent-run-tree-",
  "completion-sync-test-",
  "direct-completion-test-",
  "terminate-regression-",
] as const;

type CleanupCandidate = {
  id: string;
  treeNodeId: string | null;
  title: string;
  createdAt: string;
};

type CleanupSummary = {
  projectId: string;
  dryRun: boolean;
  matchedTaskCount: number;
  deletedTaskCount: number;
  taskIds: string[];
};

function matchesFixtureTitle(title: string) {
  return FIXTURE_TITLE_PREFIXES.some((prefix) => title.startsWith(prefix));
}

async function loadCleanupCandidates(projectId: string) {
  const rows = await postgresSql<CleanupCandidate[]>`
    select
      id,
      tree_node_id as "treeNodeId",
      title,
      created_at as "createdAt"
    from tasks
    where project_id = ${projectId}
    order by created_at asc
  `;

  return rows.filter((row) => matchesFixtureTitle(row.title));
}

function collectNodeIds(
  task: CleanupCandidate,
  sessionRows: Array<{ id: string; treeNodeId: string | null }>,
) {
  const nodeIds = new Set<string>();
  nodeIds.add(task.id);

  if (task.treeNodeId) {
    nodeIds.add(task.treeNodeId);
  }

  for (const sessionRow of sessionRows) {
    nodeIds.add(sessionRow.id);
    if (sessionRow.treeNodeId) {
      nodeIds.add(sessionRow.treeNodeId);
    }
  }

  return Array.from(nodeIds);
}

async function deleteTaskFixture(task: CleanupCandidate) {
  const sessionRows = await postgresSql<Array<{ id: string; treeNodeId: string | null }>>`
    select
      id,
      tree_node_id as "treeNodeId"
    from conversation_sessions
    where task_id = ${task.id}
  `;

  const nodeIds = collectNodeIds(task, sessionRows);

  await postgresSql.begin(async (transaction) => {
    await transaction.unsafe("DELETE FROM task_timeline_views WHERE task_id = $1", [
      task.id,
    ] as never[]);
    await transaction.unsafe("DELETE FROM task_domain_events WHERE task_id = $1", [
      task.id,
    ] as never[]);
    await transaction.unsafe(
      `DELETE FROM conversation_message_parts WHERE message_id IN (
        SELECT id FROM conversation_messages WHERE task_id = $1
      )`,
      [task.id] as never[],
    );
    await transaction.unsafe("DELETE FROM conversation_messages WHERE task_id = $1", [
      task.id,
    ] as never[]);
    await transaction.unsafe("DELETE FROM conversation_sessions WHERE task_id = $1", [
      task.id,
    ] as never[]);
    await transaction.unsafe("DELETE FROM task_snapshots WHERE task_id = $1", [task.id] as never[]);
    await transaction.unsafe("DELETE FROM task_run_edges WHERE task_id = $1", [task.id] as never[]);
    await transaction.unsafe("UPDATE task_run_nodes SET agent_run_id = NULL WHERE task_id = $1", [
      task.id,
    ] as never[]);

    await transaction.unsafe(
      `DELETE FROM task_stage_runs
        WHERE workflow_run_id IN (
          SELECT id FROM task_workflow_runs WHERE task_id = $1
        )`,
      [task.id] as never[],
    );
    await transaction.unsafe("DELETE FROM task_workflow_runs WHERE task_id = $1", [
      task.id,
    ] as never[]);
    await transaction.unsafe("DELETE FROM task_operating_modes WHERE task_id = $1", [
      task.id,
    ] as never[]);
    await transaction.unsafe("DELETE FROM boss_decisions WHERE task_id = $1", [task.id] as never[]);
    await transaction.unsafe("DELETE FROM human_escalations WHERE task_id = $1", [
      task.id,
    ] as never[]);
    await transaction.unsafe("DELETE FROM developer_change_requests WHERE task_id = $1", [
      task.id,
    ] as never[]);
    await transaction.unsafe("DELETE FROM role_aggregate_conclusions WHERE task_id = $1", [
      task.id,
    ] as never[]);
    await transaction.unsafe("DELETE FROM runtime_usage_ledger_steps WHERE task_id = $1", [
      task.id,
    ] as never[]);
    await transaction.unsafe("DELETE FROM runtime_usage_ledgers WHERE task_id = $1", [
      task.id,
    ] as never[]);
    await transaction.unsafe(
      `DELETE FROM file_changes
        WHERE change_id IN (
          SELECT id FROM code_changes WHERE task_id = $1
        )`,
      [task.id] as never[],
    );
    await transaction.unsafe("DELETE FROM code_changes WHERE task_id = $1", [task.id] as never[]);

    await transaction.unsafe("DELETE FROM task_run_nodes WHERE task_id = $1", [task.id] as never[]);

    await transaction.unsafe("DELETE FROM task_runs WHERE task_id = $1", [task.id] as never[]);
    await transaction.unsafe("DELETE FROM tasks WHERE id = $1", [task.id] as never[]);

    if (nodeIds.length > 0) {
      await transaction.unsafe(
        `UPDATE project_tree_nodes
            SET parent_id = NULL,
                superseded_by = NULL
          WHERE parent_id = ANY($1::text[])
             OR superseded_by = ANY($1::text[])`,
        [nodeIds] as never[],
      );
      await transaction.unsafe(
        `DELETE FROM project_tree_links
          WHERE source_node_id = ANY($1::text[])
             OR target_node_id = ANY($1::text[])`,
        [nodeIds] as never[],
      );
      await transaction.unsafe(
        `DELETE FROM project_tree_branches
          WHERE task_node_id = ANY($1::text[])
             OR head_node_id = ANY($1::text[])`,
        [nodeIds] as never[],
      );
      await transaction.unsafe("DELETE FROM project_tree_nodes WHERE id = ANY($1::text[])", [
        nodeIds,
      ] as never[]);
    }
  });
}

function printSummary(summary: CleanupSummary) {
  console.log("Task-domain audit fixture cleanup");
  console.log(
    JSON.stringify(
      {
        projectId: summary.projectId,
        dryRun: summary.dryRun,
        matchedTaskCount: summary.matchedTaskCount,
        deletedTaskCount: summary.deletedTaskCount,
      },
      null,
      2,
    ),
  );

  if (summary.taskIds.length === 0) {
    console.log("No fixture tasks matched the cleanup scope.");
    return;
  }

  for (const taskId of summary.taskIds) {
    console.log(`- ${taskId}`);
  }
}

async function main() {
  const args = parseCliArgs();
  const projectId = getStringArg(args, "project-id", "proj-default");
  const dryRun = getBooleanArg(args, "dry-run", false);
  const help = getBooleanArg(args, "help", false);

  if (help) {
    console.log(
      "Usage: bun run src/db/migration/cleanup-task-domain-audit-fixtures.ts [--project-id <projectId>] [--dry-run]",
    );
    console.log(
      "Deletes known task-domain regression fixture tasks left behind in a PostgreSQL runtime database.",
    );
    return;
  }

  const candidates = await loadCleanupCandidates(projectId);
  const summary: CleanupSummary = {
    projectId,
    dryRun,
    matchedTaskCount: candidates.length,
    deletedTaskCount: 0,
    taskIds: candidates.map((candidate) => candidate.id),
  };

  if (!dryRun) {
    for (const candidate of candidates) {
      await deleteTaskFixture(candidate);
      summary.deletedTaskCount += 1;
    }
  }

  printSummary(summary);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDatabase();
  });
