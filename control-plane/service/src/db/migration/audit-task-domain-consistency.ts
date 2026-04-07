#!/usr/bin/env bun

import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { desc, eq } from "drizzle-orm";
import { taskSnapshots, tasks } from "../schema";
import { getBooleanArg, parseCliArgs } from "./metadata";

type DbModule = typeof import("../index");

type AuditDimensionKey =
  | "status"
  | "currentSession"
  | "runGraph"
  | "messageCount"
  | "timelineItemCount";

type AuditDimension = {
  ok: boolean;
  reasons: string[];
  details: Record<string, unknown>;
};

type TaskAuditRecord = {
  taskId: string;
  projectId: string;
  title: string;
  createdAt: string;
  healthy: boolean;
  mismatchCount: number;
  dimensions: Record<AuditDimensionKey, AuditDimension>;
};

type AuditReport = {
  schemaVersion: 1;
  generatedAt: string;
  scope: {
    taskId: string | null;
    projectId: string | null;
    limit: number;
    includeHealthy: boolean;
  };
  totals: {
    auditedTaskCount: number;
    healthyTaskCount: number;
    mismatchedTaskCount: number;
    mismatchedDimensionCount: number;
  };
  tasks: TaskAuditRecord[];
};

type AuditTaskRow = {
  taskId: string;
  projectId: string;
  title: string;
  createdAt: string;
  taskLifecycleStatus: string;
  snapshotLifecycleStatus: string | null;
  snapshotCurrentSessionId: string | null;
  snapshotActiveCandidateCount: number | null;
  snapshotTotalChainSteps: number | null;
  snapshotCompletedChainSteps: number | null;
};

type TaskRunRecord = {
  id: string;
  taskId: string;
  status: string | null;
  orchestrationKind: string | null;
  candidateCount: number | null;
  pipelineStepCount: number | null;
  winnerNodeId: string | null;
};

type AuditRunGraphStats = {
  actualExecutionNodes: number;
  actualCandidateNodes: number;
  actualActiveCandidateNodes: number;
  actualCompletedCandidateNodes: number;
  actualFailedCandidateNodes: number;
  actualChainNodes: number;
  actualCompletedChainNodes: number;
  winnerExists: boolean;
};

type AuditTimelineStats = {
  statusEventCount: number;
  sessionCount: number;
  runNodeCount: number;
  taskMessageCount: number;
  eligibleMessagePartCount: number;
  actualTimelineItemCount: number;
  expectedTimelineItemCount: number;
};

type TaskAuditContext = {
  effectiveCurrentRunId: string | null;
  effectiveCurrentSessionId: string | null;
  currentRun: TaskRunRecord | null;
  runGraphCounts: CountRow;
  runGraphStats: AuditRunGraphStats;
  currentSession: CountRow;
  currentSessionDbId: string | null;
  currentSessionMessageCounts: CountRow;
  timelineCounts: CountRow;
  timelineStats: AuditTimelineStats;
};

type CountRow = Record<string, number | string | null>;

let dbModulePromise: Promise<DbModule> | null = null;

async function loadDbModule() {
  if (!dbModulePromise) {
    dbModulePromise = import("../index");
  }

  return dbModulePromise;
}

function parseOptionalString(value: string | boolean | undefined) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function parseLimit(value: string | boolean | undefined) {
  if (typeof value !== "string") {
    return 50;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return 50;
  }

  return Math.max(1, Math.min(500, Math.trunc(parsed)));
}

function parseCount(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  return 0;
}

function parseNullableString(value: unknown) {
  return typeof value === "string" && value.trim() ? value : null;
}

function mapLegacyStatusToLifecycleStatus(value: string | null | undefined) {
  if (!value) {
    return "draft";
  }
  if (value === "completed") {
    return "done";
  }

  return "active";
}

function createDimension(details: Record<string, unknown>, reasons: string[]): AuditDimension {
  return {
    ok: reasons.length === 0,
    reasons,
    details,
  };
}

function formatTaskLabel(task: { taskId: string; title: string }) {
  return `${task.taskId} ${task.title}`;
}

async function writeJsonReport(report: AuditReport, outputPath: string) {
  await mkdir(dirname(outputPath), { recursive: true });
  await Bun.write(outputPath, `${JSON.stringify(report, null, 2)}\n`);
}

async function querySingleRow<T extends CountRow>(query: Promise<T[]>) {
  const rows = await query;
  return rows[0] ?? ({} as T);
}

function buildRunGraphStats(runGraphCounts: CountRow): AuditRunGraphStats {
  return {
    actualExecutionNodes: parseCount(runGraphCounts.execution_nodes),
    actualCandidateNodes: parseCount(runGraphCounts.candidate_nodes),
    actualActiveCandidateNodes: parseCount(runGraphCounts.active_candidate_nodes),
    actualCompletedCandidateNodes: parseCount(runGraphCounts.completed_candidate_nodes),
    actualFailedCandidateNodes: parseCount(runGraphCounts.failed_candidate_nodes),
    actualChainNodes: parseCount(runGraphCounts.chain_nodes),
    actualCompletedChainNodes: parseCount(runGraphCounts.completed_chain_nodes),
    winnerExists: parseCount(runGraphCounts.winner_exists) > 0,
  };
}

function buildTimelineStats(timelineCounts: CountRow): AuditTimelineStats {
  const statusEventCount = parseCount(timelineCounts.status_event_count);
  const sessionCount = parseCount(timelineCounts.session_count);
  const runNodeCount = parseCount(timelineCounts.run_node_count);
  const taskMessageCount = parseCount(timelineCounts.message_count);
  const eligibleMessagePartCount = parseCount(timelineCounts.eligible_message_part_count);
  const actualTimelineItemCount = parseCount(timelineCounts.actual_timeline_item_count);
  const expectedTimelineItemCount =
    statusEventCount + sessionCount + runNodeCount + taskMessageCount + eligibleMessagePartCount;

  return {
    statusEventCount,
    sessionCount,
    runNodeCount,
    taskMessageCount,
    eligibleMessagePartCount,
    actualTimelineItemCount,
    expectedTimelineItemCount,
  };
}

async function loadCurrentRun(task: AuditTaskRow, effectiveCurrentRunId: string | null) {
  if (!effectiveCurrentRunId) {
    return null;
  }

  const { postgresSql } = await loadDbModule();
  const rows = await postgresSql`
    select
      id,
      task_id as "taskId",
      status,
      orchestration_kind as "orchestrationKind",
      candidate_count as "candidateCount",
      pipeline_step_count as "pipelineStepCount",
      winner_node_id as "winnerNodeId"
    from task_runs
    where id = ${effectiveCurrentRunId}
      and task_id = ${task.taskId}
    limit 1
  `;
  const row = rows[0] as Record<string, unknown> | undefined;
  if (!row) {
    return null;
  }

  return {
    id: parseNullableString(row.id) ?? effectiveCurrentRunId,
    taskId: parseNullableString(row.taskId) ?? task.taskId,
    status: parseNullableString(row.status),
    orchestrationKind: parseNullableString(row.orchestrationKind),
    candidateCount: row.candidateCount == null ? null : parseCount(row.candidateCount),
    pipelineStepCount: row.pipelineStepCount == null ? null : parseCount(row.pipelineStepCount),
    winnerNodeId: parseNullableString(row.winnerNodeId),
  };
}

async function loadRunGraphCounts(args: {
  task: AuditTaskRow;
  effectiveCurrentRunId: string | null;
  winnerNodeId: string | null;
}) {
  const { postgresSql } = await loadDbModule();
  return args.effectiveCurrentRunId
    ? querySingleRow<CountRow>(postgresSql`
        select
          count(*)::int as total_nodes,
          count(*) filter (where node_kind = 'execution')::int as execution_nodes,
          count(*) filter (where node_kind = 'candidate')::int as candidate_nodes,
          count(*) filter (
            where node_kind = 'candidate' and status in ('pending', 'running', 'paused')
          )::int as active_candidate_nodes,
          count(*) filter (where node_kind = 'candidate' and status = 'completed')::int as completed_candidate_nodes,
          count(*) filter (
            where node_kind = 'candidate' and status in ('failed', 'cancelled')
          )::int as failed_candidate_nodes,
          count(*) filter (where node_kind = 'chain-step')::int as chain_nodes,
          count(*) filter (
            where node_kind = 'chain-step' and status = 'completed'
          )::int as completed_chain_nodes,
          count(*) filter (where id = ${args.winnerNodeId ?? ""})::int as winner_exists
        from task_run_nodes
        where run_id = ${args.effectiveCurrentRunId}
          and task_id = ${args.task.taskId}
      `)
    : {};
}

async function loadCurrentSession(task: AuditTaskRow, effectiveCurrentSessionId: string | null) {
  const { postgresSql } = await loadDbModule();
  return effectiveCurrentSessionId
    ? querySingleRow<CountRow>(postgresSql`
        select
          id,
          runtime_session_id,
          is_active,
          archived_at
        from conversation_sessions
        where task_id = ${task.taskId}
          and runtime_session_id = ${effectiveCurrentSessionId}
        order by created_at desc
        limit 1
      `)
    : {};
}

function resolveCurrentSessionDbId(currentSession: CountRow) {
  return typeof currentSession.id === "string" && currentSession.id.trim()
    ? currentSession.id
    : null;
}

function pushNumericMismatchReason(args: {
  reasons: string[];
  expected: number | null;
  actual: number;
  label: string;
  actualLabel: string;
}) {
  if (args.expected != null && args.expected !== args.actual) {
    args.reasons.push(`${args.label}=${args.expected} but ${args.actualLabel}=${args.actual}`);
  }
}

function buildRunGraphCountMismatchReasons(task: AuditTaskRow, context: TaskAuditContext) {
  if (!context.currentRun) {
    return [] as string[];
  }

  const reasons: string[] = [];
  const stats = context.runGraphStats;
  const comparableCandidateNodes =
    context.currentRun.orchestrationKind === "single"
      ? Math.max(stats.actualExecutionNodes, stats.actualCandidateNodes)
      : stats.actualCandidateNodes;

  pushNumericMismatchReason({
    reasons,
    expected: context.currentRun.candidateCount,
    actual: comparableCandidateNodes,
    label: "task_runs.candidate_count",
    actualLabel: "comparable nodes",
  });
  pushNumericMismatchReason({
    reasons,
    expected: context.currentRun.pipelineStepCount,
    actual: stats.actualChainNodes,
    label: "task_runs.pipeline_step_count",
    actualLabel: "chain-step nodes",
  });
  pushNumericMismatchReason({
    reasons,
    expected: task.snapshotActiveCandidateCount,
    actual: stats.actualActiveCandidateNodes,
    label: "task_snapshots.active_candidate_count",
    actualLabel: "active candidate nodes",
  });
  pushNumericMismatchReason({
    reasons,
    expected: task.snapshotTotalChainSteps,
    actual: stats.actualChainNodes,
    label: "task_snapshots.total_chain_steps",
    actualLabel: "chain-step nodes",
  });
  pushNumericMismatchReason({
    reasons,
    expected: task.snapshotCompletedChainSteps,
    actual: stats.actualCompletedChainNodes,
    label: "task_snapshots.completed_chain_steps",
    actualLabel: "completed chain-step nodes",
  });

  return reasons;
}

function buildRunGraphStructuralReasons(context: TaskAuditContext) {
  const reasons: string[] = [];

  if (context.effectiveCurrentRunId && !context.currentRun) {
    reasons.push(`task_runs missing id=${context.effectiveCurrentRunId}`);
  }
  if (context.currentRun?.winnerNodeId && !context.runGraphStats.winnerExists) {
    reasons.push(`winner node ${context.currentRun.winnerNodeId} is missing from task_run_nodes`);
  }

  return reasons;
}

function buildRunGraphReasonList(task: AuditTaskRow, context: TaskAuditContext) {
  return [
    ...buildRunGraphStructuralReasons(context),
    ...buildRunGraphCountMismatchReasons(task, context),
  ];
}

async function loadCurrentSessionMessageCounts(taskId: string, currentSessionDbId: string | null) {
  const { postgresSql } = await loadDbModule();
  return currentSessionDbId
    ? querySingleRow<CountRow>(postgresSql`
        select
          (
            select count(*)::int
            from conversation_messages
            where session_id = ${currentSessionDbId}
          ) as message_count,
          (
            select count(distinct message_id)::int
            from task_timeline_views
            where task_id = ${taskId}
              and session_id = ${currentSessionDbId}
              and message_id is not null
          ) as projected_distinct_message_count
      `)
    : {};
}

async function loadTimelineCounts(taskId: string) {
  const { postgresSql } = await loadDbModule();
  return querySingleRow<CountRow>(postgresSql`
    select
      (
        select count(*)::int
        from task_domain_events
        where task_id = ${taskId}
          and event_type = 'task.aggregate.upserted'
      ) as status_event_count,
      (
        select count(*)::int
        from conversation_sessions
        where task_id = ${taskId}
      ) as session_count,
      (
        select count(*)::int
        from task_run_nodes
        where task_id = ${taskId}
      ) as run_node_count,
      (
        select count(*)::int
        from conversation_messages
        where task_id = ${taskId}
      ) as message_count,
      (
        select count(*)::int
        from conversation_message_parts parts
        join conversation_messages messages on messages.id = parts.message_id
        where messages.task_id = ${taskId}
          and (
            parts.part_type in ('tool_call', 'thinking', 'file_reference', 'diff')
            or (parts.part_type = 'tool_result' and coalesce(messages.role, '') <> 'tool')
          )
      ) as eligible_message_part_count,
      (
        select count(*)::int
        from task_timeline_views
        where task_id = ${taskId}
      ) as actual_timeline_item_count
  `);
}

async function loadLatestActiveRunId(taskId: string): Promise<string | null> {
  const { postgresSql } = await loadDbModule();
  const rows = await postgresSql`
    select id from task_runs
    where task_id = ${taskId}
      and status in ('running', 'pending')
    order by created_at desc
    limit 1
  `;
  return parseNullableString((rows[0] as Record<string, unknown> | undefined)?.id ?? null);
}

async function loadTaskAuditContext(task: AuditTaskRow): Promise<TaskAuditContext> {
  const effectiveCurrentRunId = await loadLatestActiveRunId(task.taskId);
  const effectiveCurrentSessionId = task.snapshotCurrentSessionId;
  const currentRun = await loadCurrentRun(task, effectiveCurrentRunId);
  const runGraphCounts = await loadRunGraphCounts({
    task,
    effectiveCurrentRunId,
    winnerNodeId: currentRun?.winnerNodeId ?? null,
  });
  const currentSession = await loadCurrentSession(task, effectiveCurrentSessionId);
  const currentSessionDbId = resolveCurrentSessionDbId(currentSession);
  const currentSessionMessageCounts = await loadCurrentSessionMessageCounts(
    task.taskId,
    currentSessionDbId,
  );
  const timelineCounts = await loadTimelineCounts(task.taskId);

  return {
    effectiveCurrentRunId,
    effectiveCurrentSessionId,
    currentRun,
    runGraphCounts,
    runGraphStats: buildRunGraphStats(runGraphCounts),
    currentSession,
    currentSessionDbId,
    currentSessionMessageCounts,
    timelineCounts,
    timelineStats: buildTimelineStats(timelineCounts),
  };
}

function buildStatusDimension(task: AuditTaskRow, context: TaskAuditContext) {
  const reasons: string[] = [];
  const currentRunLifecycleStatus = mapLegacyStatusToLifecycleStatus(context.currentRun?.status);

  if (!task.snapshotLifecycleStatus) {
    reasons.push("missing task_snapshots row");
  }
  if (task.snapshotLifecycleStatus && task.taskLifecycleStatus !== task.snapshotLifecycleStatus) {
    reasons.push(
      `tasks.lifecycle_status=${task.taskLifecycleStatus} but task_snapshots.lifecycle_status=${task.snapshotLifecycleStatus}`,
    );
  }
  if (
    task.snapshotLifecycleStatus &&
    context.currentRun?.status &&
    currentRunLifecycleStatus !== task.snapshotLifecycleStatus
  ) {
    reasons.push(
      `current run status=${context.currentRun.status} maps to lifecycle_status=${currentRunLifecycleStatus} but snapshot lifecycle_status=${task.snapshotLifecycleStatus}`,
    );
  }

  return createDimension(
    {
      taskLifecycleStatus: task.taskLifecycleStatus,
      snapshotLifecycleStatus: task.snapshotLifecycleStatus,
      currentRunStatus: context.currentRun?.status ?? null,
      currentRunLifecycleStatus,
    },
    reasons,
  );
}

function buildCurrentSessionDimension(task: AuditTaskRow, context: TaskAuditContext) {
  const reasons: string[] = [];

  if (context.effectiveCurrentSessionId && !context.currentSessionDbId) {
    reasons.push(
      `conversation_sessions missing runtime_session_id=${context.effectiveCurrentSessionId}`,
    );
  }

  return createDimension(
    {
      snapshotCurrentSessionId: task.snapshotCurrentSessionId,
      effectiveCurrentSessionId: context.effectiveCurrentSessionId,
      conversationSessionId: context.currentSessionDbId,
      sessionIsActive:
        typeof context.currentSession.is_active === "boolean"
          ? context.currentSession.is_active
          : null,
      sessionArchivedAt:
        typeof context.currentSession.archived_at === "string"
          ? context.currentSession.archived_at
          : null,
    },
    reasons,
  );
}

function buildRunGraphDimension(task: AuditTaskRow, context: TaskAuditContext) {
  const stats = context.runGraphStats;

  return createDimension(
    {
      effectiveCurrentRunId: context.effectiveCurrentRunId,
      runStatus: context.currentRun?.status ?? null,
      orchestrationKind: context.currentRun?.orchestrationKind ?? null,
      candidateCount: context.currentRun?.candidateCount ?? null,
      pipelineStepCount: context.currentRun?.pipelineStepCount ?? null,
      actualExecutionNodes: stats.actualExecutionNodes,
      actualCandidateNodes: stats.actualCandidateNodes,
      actualActiveCandidateNodes: stats.actualActiveCandidateNodes,
      actualCompletedCandidateNodes: stats.actualCompletedCandidateNodes,
      actualFailedCandidateNodes: stats.actualFailedCandidateNodes,
      actualChainNodes: stats.actualChainNodes,
      actualCompletedChainNodes: stats.actualCompletedChainNodes,
      winnerNodeId: context.currentRun?.winnerNodeId ?? null,
    },
    buildRunGraphReasonList(task, context),
  );
}

function buildMessageCountDimension(context: TaskAuditContext) {
  const reasons: string[] = [];
  const currentMessageCount = parseCount(context.currentSessionMessageCounts.message_count);
  const projectedDistinctMessageCount = parseCount(
    context.currentSessionMessageCounts.projected_distinct_message_count,
  );

  if (context.effectiveCurrentSessionId && !context.currentSessionDbId) {
    reasons.push("cannot compare messages because current session record is missing");
  } else if (currentMessageCount !== projectedDistinctMessageCount) {
    reasons.push(
      `conversation_messages=${currentMessageCount} but task_timeline_views distinct message_id=${projectedDistinctMessageCount}`,
    );
  }

  return createDimension(
    {
      effectiveCurrentSessionId: context.effectiveCurrentSessionId,
      conversationSessionId: context.currentSessionDbId,
      conversationMessageCount: currentMessageCount,
      projectedDistinctMessageCount,
    },
    reasons,
  );
}

function buildTimelineItemCountDimension(context: TaskAuditContext) {
  const reasons: string[] = [];

  if (
    context.timelineStats.actualTimelineItemCount !==
    context.timelineStats.expectedTimelineItemCount
  ) {
    reasons.push(
      `task_timeline_views=${context.timelineStats.actualTimelineItemCount} but expected=${context.timelineStats.expectedTimelineItemCount}`,
    );
  }

  return createDimension(
    {
      expectedTimelineItemCount: context.timelineStats.expectedTimelineItemCount,
      actualTimelineItemCount: context.timelineStats.actualTimelineItemCount,
      breakdown: {
        statusEventCount: context.timelineStats.statusEventCount,
        sessionCount: context.timelineStats.sessionCount,
        runNodeCount: context.timelineStats.runNodeCount,
        taskMessageCount: context.timelineStats.taskMessageCount,
        eligibleMessagePartCount: context.timelineStats.eligibleMessagePartCount,
      },
    },
    reasons,
  );
}

function buildTaskAuditDimensions(task: AuditTaskRow, context: TaskAuditContext) {
  return {
    status: buildStatusDimension(task, context),
    currentSession: buildCurrentSessionDimension(task, context),
    runGraph: buildRunGraphDimension(task, context),
    messageCount: buildMessageCountDimension(context),
    timelineItemCount: buildTimelineItemCountDimension(context),
  } satisfies Record<AuditDimensionKey, AuditDimension>;
}

async function auditTaskRecord(task: AuditTaskRow) {
  const context = await loadTaskAuditContext(task);
  const dimensions = buildTaskAuditDimensions(task, context);

  const mismatchCount = Object.values(dimensions).filter((dimension) => !dimension.ok).length;

  return {
    taskId: task.taskId,
    projectId: task.projectId,
    title: task.title,
    createdAt: task.createdAt,
    healthy: mismatchCount === 0,
    mismatchCount,
    dimensions,
  } satisfies TaskAuditRecord;
}

function printHumanReport(report: {
  scope: Record<string, unknown>;
  totals: {
    auditedTaskCount: number;
    healthyTaskCount: number;
    mismatchedTaskCount: number;
    mismatchedDimensionCount: number;
  };
  tasks: TaskAuditRecord[];
}) {
  console.log("Task-domain consistency audit");
  console.log(`Scope: ${JSON.stringify(report.scope)}`);
  console.log(`Totals: ${JSON.stringify(report.totals)}`);

  if (report.tasks.length === 0) {
    if (report.totals.auditedTaskCount === 0) {
      console.log("No tasks matched the requested scope.");
    } else {
      console.log("No mismatches found in the requested scope.");
    }
    return;
  }

  for (const task of report.tasks) {
    console.log(`\n- ${formatTaskLabel(task)}${task.healthy ? " [healthy]" : " [mismatch]"}`);
    for (const [dimensionKey, dimension] of Object.entries(task.dimensions) as Array<
      [AuditDimensionKey, AuditDimension]
    >) {
      if (dimension.ok) {
        console.log(`  ${dimensionKey}: ok`);
        continue;
      }
      console.log(`  ${dimensionKey}: ${dimension.reasons.join("; ")}`);
    }
  }
}

async function main() {
  const args = parseCliArgs();
  const taskId = parseOptionalString(args["task-id"]);
  const projectId = parseOptionalString(args["project-id"]);
  const limit = parseLimit(args.limit);
  const json = getBooleanArg(args, "json", false);
  const jsonOutput = parseOptionalString(args["json-output"]);
  const includeHealthy = getBooleanArg(args, "include-healthy", false);
  const failOnMismatch = getBooleanArg(args, "fail-on-mismatch", false);
  const help = getBooleanArg(args, "help", false);

  if (help) {
    console.log(`Usage: bun run src/db/migration/audit-task-domain-consistency.ts [options]

Options:
  --task-id <id>           Audit a single task.
  --project-id <id>        Audit tasks for a project.
  --limit <n>              Max tasks to inspect when not using --task-id. Default: 50.
  --include-healthy        Include healthy tasks in the default text output.
  --json                   Emit JSON instead of text.
  --json-output <path>     Persist the JSON report to a file.
  --fail-on-mismatch       Exit with code 2 when any mismatch is found.
  --help                   Show this message.
`);
    return;
  }

  const { db } = await loadDbModule();

  const baseQuery = db
    .select({
      taskId: tasks.id,
      projectId: tasks.projectId,
      title: tasks.title,
      createdAt: tasks.createdAt,
      taskLifecycleStatus: tasks.lifecycleStatus,
      snapshotLifecycleStatus: taskSnapshots.lifecycleStatus,
      snapshotCurrentSessionId: taskSnapshots.currentSessionId,
      snapshotActiveCandidateCount: taskSnapshots.activeCandidateCount,
      snapshotTotalChainSteps: taskSnapshots.totalChainSteps,
      snapshotCompletedChainSteps: taskSnapshots.completedChainSteps,
    })
    .from(tasks)
    .leftJoin(taskSnapshots, eq(taskSnapshots.taskId, tasks.id))
    .orderBy(desc(tasks.createdAt));

  const baseTasks = taskId
    ? await baseQuery.where(eq(tasks.id, taskId))
    : projectId
      ? await baseQuery.where(eq(tasks.projectId, projectId)).limit(limit)
      : await baseQuery.limit(limit);
  const auditedTasks = await Promise.all(baseTasks.map((task) => auditTaskRecord(task)));
  const visibleTasks = includeHealthy ? auditedTasks : auditedTasks.filter((task) => !task.healthy);
  const mismatchedTasks = auditedTasks.filter((task) => !task.healthy);

  const totals = {
    auditedTaskCount: auditedTasks.length,
    healthyTaskCount: auditedTasks.filter((task) => task.healthy).length,
    mismatchedTaskCount: mismatchedTasks.length,
    mismatchedDimensionCount: mismatchedTasks.reduce((sum, task) => sum + task.mismatchCount, 0),
  };

  const report: AuditReport = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    scope: {
      taskId: taskId ?? null,
      projectId: projectId ?? null,
      limit: taskId ? 1 : limit,
      includeHealthy,
    },
    totals,
    tasks: visibleTasks,
  };

  if (jsonOutput) {
    await writeJsonReport(report, jsonOutput);
  }

  if (json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printHumanReport(report);
    if (jsonOutput) {
      console.log(`JSON report written to ${jsonOutput}`);
    }
  }

  if (failOnMismatch && mismatchedTasks.length > 0) {
    process.exitCode = 2;
  }
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    if (dbModulePromise) {
      const { closeDatabase } = await loadDbModule();
      await closeDatabase();
    }
  });
