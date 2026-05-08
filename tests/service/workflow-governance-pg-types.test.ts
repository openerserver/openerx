import { afterAll, expect, test } from "bun:test";
import postgres from "../../control-plane/service/node_modules/postgres";
import {
  runDeleteByIds,
  runDeleteByTaskIds,
  runTaskNodeDefensiveCleanup,
} from "./service-teardown-helpers";

const PROJECT_ID = process.env.TEST_PROJECT_ID || "proj-default";
const rawDatabaseUrl = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL || "";
const DATABASE_URL = /^(postgres|postgresql):\/\//i.test(rawDatabaseUrl)
  ? rawDatabaseUrl
  : "postgres://127.0.0.1:5432/openerx";
const sql = postgres(DATABASE_URL, { max: 1, prepare: false });

function toPostgresPlaceholders(query: string) {
  let index = 0;
  return query.replace(/\?(\d+)?/g, (_match, explicitIndex) => {
    if (explicitIndex) {
      return `$${Number(explicitIndex)}`;
    }

    index += 1;
    return `$${index}`;
  });
}

async function writeDb(query: string, params: unknown[]) {
  const normalizedQuery = toPostgresPlaceholders(query).replace(
    /CURRENT_TIMESTAMP::text/g,
    "CURRENT_TIMESTAMP",
  );
  const normalizedParams = params.map((param) =>
    typeof param === "string" && /^\d{4}-\d{2}-\d{2}T/.test(param) ? new Date(param) : param,
  );
  await sql.unsafe(normalizedQuery, normalizedParams as never[]);
}

async function safeWriteDb(query: string, params: unknown[]) {
  try {
    await writeDb(query, params);
  } catch {
    // Best-effort cleanup only.
  }
}

const createdTaskIds: string[] = [];
const createdWorkflowRunIds: string[] = [];
const createdStageRunIds: string[] = [];

afterAll(async () => {
  try {
    await runDeleteByTaskIds(safeWriteDb, "approval_tickets", createdTaskIds);
    await runDeleteByTaskIds(safeWriteDb, "boss_decisions", createdTaskIds);
    await runDeleteByTaskIds(safeWriteDb, "human_escalations", createdTaskIds);
    await runDeleteByTaskIds(safeWriteDb, "developer_change_requests", createdTaskIds);
    await runDeleteByTaskIds(safeWriteDb, "role_aggregate_conclusions", createdTaskIds);
    await runDeleteByIds(safeWriteDb, "task_stage_runs", createdStageRunIds);
    await runDeleteByIds(safeWriteDb, "task_workflow_runs", createdWorkflowRunIds);
    await runTaskNodeDefensiveCleanup(safeWriteDb, createdTaskIds);
  } finally {
    await sql.end();
  }
});

test("workflow/governance PG tightened columns accept enum values and ISO timestamps", async () => {
  const [project] = await sql.unsafe<Array<{ id: string }>>(
    "SELECT id FROM projects WHERE id = $1 LIMIT 1",
    [PROJECT_ID],
  );
  expect(project?.id).toBe(PROJECT_ID);

  const suffix = Date.now().toString(36);
  const taskId = `pg-type-task-${suffix}`;
  const workflowRunId = `pg-type-workflow-${suffix}`;
  const stageRunId = `pg-type-stage-${suffix}`;
  const path = `pg_type_task_${suffix}`;
  const baseTs = "2025-04-10T12:34:56.789Z";
  const nextTs = "2025-04-10T12:39:56.789Z";
  const endTs = "2025-04-10T12:44:56.789Z";

  createdTaskIds.push(taskId);
  createdWorkflowRunIds.push(workflowRunId);
  createdStageRunIds.push(stageRunId);

  await writeDb(
    `INSERT INTO project_tree_nodes (
      id,
      project_id,
      parent_id,
      path,
      depth,
      node_type,
      is_active,
      created_at,
      updated_at
    ) VALUES (
      ?1,
      ?2,
      NULL,
      ?3,
      0,
      'task',
      true,
      CURRENT_TIMESTAMP::text,
      CURRENT_TIMESTAMP::text
    )`,
    [taskId, PROJECT_ID, path],
  );

  await writeDb(
    `INSERT INTO approval_tickets (
      id,
      task_id,
      agent_run_id,
      action_type,
      risk_level,
      status,
      request_detail,
      approver,
      comment,
      created_at,
      resolved_at,
      expires_at
    ) VALUES (
      ?1,
      ?2,
      ?3,
      ?4,
      ?5,
      ?6,
      ?7::jsonb,
      ?8,
      ?9,
      ?10,
      ?11,
      ?12
    )`,
    [
      `approval-${suffix}`,
      taskId,
      `agent-run-${suffix}`,
      "batch_edit",
      "high",
      "approved",
      JSON.stringify({ files: 3 }),
      "tester",
      "approved during pg smoke",
      baseTs,
      nextTs,
      endTs,
    ],
  );

  await writeDb(
    `INSERT INTO task_workflow_runs (
      id,
      task_id,
      template_id,
      current_stage,
      status,
      started_at,
      finished_at,
      created_at,
      updated_at
    ) VALUES (
      ?1,
      ?2,
      ?3,
      ?4,
      ?5,
      ?6,
      ?7,
      ?8,
      ?9
    )`,
    [
      workflowRunId,
      taskId,
      `template-${suffix}`,
      "verify",
      "completed",
      baseTs,
      endTs,
      baseTs,
      nextTs,
    ],
  );

  await writeDb(
    `INSERT INTO task_stage_runs (
      id,
      workflow_run_id,
      stage_key,
      status,
      primary_role_agent_id,
      participant_role_agent_ids_json,
      started_at,
      finished_at,
      blocking_reason,
      approval_state,
      artifacts_summary_json,
      created_at,
      updated_at
    ) VALUES (
      ?1,
      ?2,
      ?3,
      ?4,
      ?5,
      ?6::jsonb,
      ?7,
      ?8,
      NULL,
      ?9,
      ?10::jsonb,
      ?11,
      ?12
    )`,
    [
      stageRunId,
      workflowRunId,
      "verify",
      "completed",
      "role.qa",
      JSON.stringify(["role.security"]),
      baseTs,
      endTs,
      "approved",
      JSON.stringify({ artifactCount: 2 }),
      baseTs,
      nextTs,
    ],
  );

  await writeDb(
    `INSERT INTO role_aggregate_conclusions (
      id,
      task_id,
      task_stage_run_id,
      role_agent_id,
      stage,
      aggregation_strategy,
      status,
      final_decision,
      aggregate_risk_level,
      confidence_score,
      consensus_score,
      winning_rationale,
      merged_findings_json,
      minority_findings_json,
      conflicts_json,
      approval_recommendation_json,
      generated_at,
      created_at,
      updated_at
    ) VALUES (
      ?1,
      ?2,
      ?3,
      ?4,
      ?5,
      ?6,
      ?7,
      ?8,
      ?9,
      ?10,
      ?11,
      ?12,
      ?13::jsonb,
      ?14::jsonb,
      ?15::jsonb,
      ?16::jsonb,
      ?17,
      ?18,
      ?19
    )`,
    [
      `conclusion-${suffix}`,
      taskId,
      stageRunId,
      "role.architect",
      "verify",
      "merge-summary",
      "aligned",
      "allow",
      "medium",
      0.93,
      0.88,
      "pg types smoke",
      JSON.stringify([{ key: "finding-1" }]),
      JSON.stringify([]),
      JSON.stringify([]),
      JSON.stringify({ required: false }),
      nextTs,
      baseTs,
      nextTs,
    ],
  );

  await writeDb(
    `INSERT INTO developer_change_requests (
      id,
      task_id,
      task_stage_run_id,
      source_role_agent_id,
      assigned_role_agent_id,
      priority,
      title,
      summary,
      required_changes_json,
      related_finding_keys_json,
      blocking,
      approval_required,
      status,
      resolution_note,
      created_at,
      updated_at,
      resolved_at
    ) VALUES (
      ?1,
      ?2,
      ?3,
      ?4,
      ?5,
      ?6,
      ?7,
      ?8,
      ?9::jsonb,
      ?10::jsonb,
      ?11,
      ?12,
      ?13,
      ?14,
      ?15,
      ?16,
      ?17
    )`,
    [
      `change-${suffix}`,
      taskId,
      stageRunId,
      "role.reviewer",
      "role.developer",
      "high",
      "Adjust schema usage",
      "Keep timestamps typed.",
      JSON.stringify(["update insert path"]),
      JSON.stringify(["finding-1"]),
      true,
      false,
      "resolved",
      "done",
      baseTs,
      nextTs,
      endTs,
    ],
  );

  await writeDb(
    `INSERT INTO boss_decisions (
      id,
      task_id,
      ts,
      decision_type,
      reason,
      confidence,
      stage_key,
      metadata_json,
      created_at
    ) VALUES (
      ?1,
      ?2,
      ?3,
      ?4,
      ?5,
      ?6,
      ?7,
      ?8::jsonb,
      ?9
    )`,
    [
      `boss-${suffix}`,
      taskId,
      baseTs,
      "select-template",
      "prefer merge-summary",
      0.82,
      "verify",
      JSON.stringify({ selectedTemplateId: `template-${suffix}` }),
      nextTs,
    ],
  );

  await writeDb(
    `INSERT INTO human_escalations (
      id,
      task_id,
      ts,
      reason,
      status,
      stage_key,
      requested_by,
      metadata_json,
      created_at
    ) VALUES (
      ?1,
      ?2,
      ?3,
      ?4,
      ?5,
      ?6,
      ?7,
      ?8::jsonb,
      ?9
    )`,
    [
      `escalation-${suffix}`,
      taskId,
      endTs,
      "manual review required",
      "pending-human-review",
      "verify",
      "role.security",
      JSON.stringify({ severity: "medium" }),
      endTs,
    ],
  );

  const [approvalRow] = await sql.unsafe<
    Array<{
      actionTypeType: string;
      statusType: string;
      createdAtType: string;
      resolvedAtType: string;
      expiresAtType: string;
      createdAtText: string;
    }>
  >(
    `SELECT
      pg_typeof(action_type)::text AS "actionTypeType",
      pg_typeof(status)::text AS "statusType",
      pg_typeof(created_at)::text AS "createdAtType",
      pg_typeof(resolved_at)::text AS "resolvedAtType",
      pg_typeof(expires_at)::text AS "expiresAtType",
      (created_at AT TIME ZONE 'UTC')::text AS "createdAtText"
    FROM approval_tickets
    WHERE id = $1`,
    [`approval-${suffix}`],
  );
  expect(approvalRow).toMatchObject({
    actionTypeType: "approval_ticket_action_type",
    statusType: "approval_ticket_status",
    createdAtType: "timestamp with time zone",
    resolvedAtType: "timestamp with time zone",
    expiresAtType: "timestamp with time zone",
  });
  expect(approvalRow.createdAtText).toContain("2025-04-10 12:34:56.789");

  const [workflowRow] = await sql.unsafe<
    Array<{
      statusType: string;
      startedAtType: string;
      finishedAtType: string;
      createdAtType: string;
      updatedAtType: string;
      status: string;
    }>
  >(
    `SELECT
      pg_typeof(status)::text AS "statusType",
      pg_typeof(started_at)::text AS "startedAtType",
      pg_typeof(finished_at)::text AS "finishedAtType",
      pg_typeof(created_at)::text AS "createdAtType",
      pg_typeof(updated_at)::text AS "updatedAtType",
      status::text AS "status"
    FROM task_workflow_runs
    WHERE id = $1`,
    [workflowRunId],
  );
  expect(workflowRow).toMatchObject({
    statusType: "task_workflow_run_status",
    startedAtType: "timestamp with time zone",
    finishedAtType: "timestamp with time zone",
    createdAtType: "timestamp with time zone",
    updatedAtType: "timestamp with time zone",
    status: "completed",
  });

  const [stageRow] = await sql.unsafe<
    Array<{
      statusType: string;
      startedAtType: string;
      finishedAtType: string;
      approvalStateType: string;
      createdAtType: string;
      updatedAtType: string;
      approvalState: string;
    }>
  >(
    `SELECT
      pg_typeof(status)::text AS "statusType",
      pg_typeof(started_at)::text AS "startedAtType",
      pg_typeof(finished_at)::text AS "finishedAtType",
      pg_typeof(approval_state)::text AS "approvalStateType",
      pg_typeof(created_at)::text AS "createdAtType",
      pg_typeof(updated_at)::text AS "updatedAtType",
      approval_state::text AS "approvalState"
    FROM task_stage_runs
    WHERE id = $1`,
    [stageRunId],
  );
  expect(stageRow).toMatchObject({
    statusType: "task_stage_run_status",
    startedAtType: "timestamp with time zone",
    finishedAtType: "timestamp with time zone",
    approvalStateType: "task_stage_run_approval_state",
    createdAtType: "timestamp with time zone",
    updatedAtType: "timestamp with time zone",
    approvalState: "approved",
  });

  const [conclusionRow] = await sql.unsafe<
    Array<{
      aggregationStrategyType: string;
      statusType: string;
      finalDecisionType: string;
      aggregateRiskLevelType: string;
      generatedAtType: string;
      createdAtType: string;
      updatedAtType: string;
    }>
  >(
    `SELECT
      pg_typeof(aggregation_strategy)::text AS "aggregationStrategyType",
      pg_typeof(status)::text AS "statusType",
      pg_typeof(final_decision)::text AS "finalDecisionType",
      pg_typeof(aggregate_risk_level)::text AS "aggregateRiskLevelType",
      pg_typeof(generated_at)::text AS "generatedAtType",
      pg_typeof(created_at)::text AS "createdAtType",
      pg_typeof(updated_at)::text AS "updatedAtType"
    FROM role_aggregate_conclusions
    WHERE id = $1`,
    [`conclusion-${suffix}`],
  );
  expect(conclusionRow).toMatchObject({
    aggregationStrategyType: "role_aggregate_conclusion_aggregation_strategy",
    statusType: "role_aggregate_conclusion_status",
    finalDecisionType: "role_aggregate_conclusion_final_decision",
    aggregateRiskLevelType: "role_aggregate_conclusion_risk_level",
    generatedAtType: "timestamp with time zone",
    createdAtType: "timestamp with time zone",
    updatedAtType: "timestamp with time zone",
  });

  const [changeRequestRow] = await sql.unsafe<
    Array<{
      statusType: string;
      createdAtType: string;
      updatedAtType: string;
      resolvedAtType: string;
      status: string;
    }>
  >(
    `SELECT
      pg_typeof(status)::text AS "statusType",
      pg_typeof(created_at)::text AS "createdAtType",
      pg_typeof(updated_at)::text AS "updatedAtType",
      pg_typeof(resolved_at)::text AS "resolvedAtType",
      status::text AS "status"
    FROM developer_change_requests
    WHERE id = $1`,
    [`change-${suffix}`],
  );
  expect(changeRequestRow).toMatchObject({
    statusType: "developer_change_request_status",
    createdAtType: "timestamp with time zone",
    updatedAtType: "timestamp with time zone",
    resolvedAtType: "timestamp with time zone",
    status: "resolved",
  });

  const [bossDecisionRow] = await sql.unsafe<
    Array<{
      tsType: string;
      createdAtType: string;
      tsText: string;
    }>
  >(
    `SELECT
      pg_typeof(ts)::text AS "tsType",
      pg_typeof(created_at)::text AS "createdAtType",
      (ts AT TIME ZONE 'UTC')::text AS "tsText"
    FROM boss_decisions
    WHERE id = $1`,
    [`boss-${suffix}`],
  );
  expect(bossDecisionRow).toMatchObject({
    tsType: "timestamp with time zone",
    createdAtType: "timestamp with time zone",
  });
  expect(bossDecisionRow.tsText).toContain("2025-04-10 12:34:56.789");

  const [escalationRow] = await sql.unsafe<
    Array<{
      tsType: string;
      createdAtType: string;
      tsText: string;
    }>
  >(
    `SELECT
      pg_typeof(ts)::text AS "tsType",
      pg_typeof(created_at)::text AS "createdAtType",
      (ts AT TIME ZONE 'UTC')::text AS "tsText"
    FROM human_escalations
    WHERE id = $1`,
    [`escalation-${suffix}`],
  );
  expect(escalationRow).toMatchObject({
    tsType: "timestamp with time zone",
    createdAtType: "timestamp with time zone",
  });
  expect(escalationRow.tsText).toContain("2025-04-10 12:44:56.789");
});
