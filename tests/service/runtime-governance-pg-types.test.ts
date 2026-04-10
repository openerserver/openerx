import { afterAll, expect, test } from "bun:test";
import postgres from "../../control-plane/service/node_modules/postgres";
import { runDeleteByIds } from "./service-teardown-helpers";

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
  await sql.unsafe(toPostgresPlaceholders(query), params as never[]);
}

async function safeWriteDb(query: string, params: unknown[]) {
  try {
    await writeDb(query, params);
  } catch {
    // Best-effort cleanup only.
  }
}

const createdLeaseIds: string[] = [];
const createdLedgerIds: string[] = [];
const createdStepIds: string[] = [];
const createdBaselineIds: string[] = [];

afterAll(async () => {
  try {
    await runDeleteByIds(safeWriteDb, "runtime_usage_ledger_steps", createdStepIds);
    await runDeleteByIds(safeWriteDb, "runtime_usage_ledgers", createdLedgerIds);
    await runDeleteByIds(safeWriteDb, "runtime_usage_baselines", createdBaselineIds);
    await runDeleteByIds(safeWriteDb, "paid_execution_leases", createdLeaseIds);
  } finally {
    await sql.end();
  }
});

test("runtime governance PG tightened columns accept enum values and ISO timestamps", async () => {
  const [project] = await sql.unsafe<Array<{ id: string }>>(
    "SELECT id FROM projects ORDER BY created_at ASC LIMIT 1",
  );
  const [user] = await sql.unsafe<Array<{ id: string }>>(
    "SELECT id FROM users ORDER BY created_at ASC LIMIT 1",
  );

  expect(project?.id).toBeTruthy();
  expect(user?.id).toBeTruthy();

  const suffix = Date.now().toString(36);
  const leaseId = `lease-pg-${suffix}`;
  const ledgerId = `runtime-ledger-pg-${suffix}`;
  const stepId = `runtime-step-pg-${suffix}`;
  const baselineId = `runtime-baseline-pg-${suffix}`;
  const startedAt = "2025-04-11T08:00:00.000Z";
  const finishedAt = "2025-04-11T08:05:00.000Z";
  const syncedAt = "2025-04-11T08:06:00.000Z";
  const expiresAt = "2025-04-11T09:00:00.000Z";
  const revokedAt = "2025-04-11T09:05:00.000Z";

  createdLeaseIds.push(leaseId);
  createdLedgerIds.push(ledgerId);
  createdStepIds.push(stepId);
  createdBaselineIds.push(baselineId);

  await writeDb(
    `INSERT INTO paid_execution_leases (
      id,
      project_id,
      issued_by_user_id,
      revoked_by_user_id,
      reason,
      status,
      expires_at,
      created_at,
      updated_at,
      revoked_at
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
      ?10
    )`,
    [
      leaseId,
      project?.id,
      user?.id,
      user?.id,
      "runtime governance pg type smoke",
      "revoked",
      expiresAt,
      startedAt,
      finishedAt,
      revokedAt,
    ],
  );

  await writeDb(
    `INSERT INTO runtime_usage_ledgers (
      id,
      project_id,
      task_id,
      agent_run_id,
      run_id,
      run_node_id,
      runtime_session_id,
      execution_source,
      entrypoint_type,
      orchestration_fingerprint,
      default_provider_id,
      default_model_id,
      request_count,
      step_count,
      input_tokens,
      output_tokens,
      total_tokens,
      cost_usd,
      candidate_count,
      judge_request_count,
      hook_request_count,
      status,
      started_at,
      finished_at,
      synced_at,
      created_at,
      updated_at
    ) VALUES (
      ?1,
      ?2,
      NULL,
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
      ?13,
      ?14,
      ?15,
      ?16,
      ?17,
      ?18,
      ?19,
      ?20,
      ?21,
      ?22,
      ?23,
      ?24,
      ?25,
      ?26
    )`,
    [
      ledgerId,
      project?.id,
      `agent-run-${suffix}`,
      `run-${suffix}`,
      `run-node-${suffix}`,
      `runtime-session-${suffix}`,
      "task-execute",
      "single-task",
      `fp-${suffix}`,
      "github-copilot",
      "gpt-5-mini",
      1,
      1,
      120,
      80,
      200,
      0.2,
      2,
      1,
      1,
      "completed",
      startedAt,
      finishedAt,
      syncedAt,
      startedAt,
      syncedAt,
    ],
  );

  await writeDb(
    `INSERT INTO runtime_usage_ledger_steps (
      id,
      ledger_id,
      project_id,
      task_id,
      agent_run_id,
      run_id,
      run_node_id,
      runtime_session_id,
      step_type,
      trigger_type,
      hook_id,
      candidate_index,
      request_index,
      provider_id,
      model_id,
      input_tokens,
      output_tokens,
      total_tokens,
      cost_usd,
      amplification_source,
      status,
      started_at,
      finished_at,
      created_at,
      updated_at
    ) VALUES (
      ?1,
      ?2,
      ?3,
      NULL,
      ?4,
      ?5,
      ?6,
      ?7,
      ?8,
      ?9,
      ?10,
      ?11,
      ?12,
      ?13,
      ?14,
      ?15,
      ?16,
      ?17,
      ?18,
      ?19,
      ?20,
      ?21,
      ?22,
      ?23,
      ?24
    )`,
    [
      stepId,
      ledgerId,
      project?.id,
      `agent-run-${suffix}`,
      `run-${suffix}`,
      `run-node-${suffix}`,
      `runtime-session-${suffix}`,
      "hook",
      "manual",
      `hook-${suffix}`,
      1,
      0,
      "github-copilot",
      "gpt-5-mini",
      100,
      50,
      150,
      0.15,
      "batch",
      "failed",
      startedAt,
      finishedAt,
      startedAt,
      finishedAt,
    ],
  );

  await writeDb(
    `INSERT INTO runtime_usage_baselines (
      id,
      project_id,
      provider_id,
      model_id,
      entrypoint_type,
      orchestration_fingerprint,
      match_scope,
      sample_size,
      p50_request_count,
      p90_request_count,
      p50_input_tokens,
      p90_input_tokens,
      p50_output_tokens,
      p90_output_tokens,
      p50_total_tokens,
      p90_total_tokens,
      p50_cost_usd,
      p90_cost_usd,
      last_ledger_at,
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
      ?13,
      ?14,
      ?15,
      ?16,
      ?17,
      ?18,
      ?19,
      ?20,
      ?21,
      ?22
    )`,
    [
      baselineId,
      project?.id,
      "github-copilot",
      "gpt-5-mini",
      "single-task",
      `fp-${suffix}`,
      "project+provider+model+entrypoint+fingerprint",
      5,
      1,
      2,
      120,
      160,
      80,
      120,
      200,
      280,
      0.2,
      0.3,
      finishedAt,
      syncedAt,
      startedAt,
      syncedAt,
    ],
  );

  const [leaseRow] = await sql.unsafe<
    Array<{
      statusType: string;
      expiresAtType: string;
      createdAtType: string;
      updatedAtType: string;
      revokedAtType: string;
    }>
  >(
    `SELECT
      pg_typeof(status)::text AS "statusType",
      pg_typeof(expires_at)::text AS "expiresAtType",
      pg_typeof(created_at)::text AS "createdAtType",
      pg_typeof(updated_at)::text AS "updatedAtType",
      pg_typeof(revoked_at)::text AS "revokedAtType"
    FROM paid_execution_leases
    WHERE id = $1`,
    [leaseId],
  );
  expect(leaseRow).toMatchObject({
    statusType: "paid_execution_lease_status",
    expiresAtType: "timestamp with time zone",
    createdAtType: "timestamp with time zone",
    updatedAtType: "timestamp with time zone",
    revokedAtType: "timestamp with time zone",
  });

  const [ledgerRow] = await sql.unsafe<
    Array<{
      statusType: string;
      startedAtType: string;
      finishedAtType: string;
      syncedAtType: string;
      createdAtType: string;
      updatedAtType: string;
      finishedAtText: string;
    }>
  >(
    `SELECT
      pg_typeof(status)::text AS "statusType",
      pg_typeof(started_at)::text AS "startedAtType",
      pg_typeof(finished_at)::text AS "finishedAtType",
      pg_typeof(synced_at)::text AS "syncedAtType",
      pg_typeof(created_at)::text AS "createdAtType",
      pg_typeof(updated_at)::text AS "updatedAtType",
      (finished_at AT TIME ZONE 'UTC')::text AS "finishedAtText"
    FROM runtime_usage_ledgers
    WHERE id = $1`,
    [ledgerId],
  );
  expect(ledgerRow).toMatchObject({
    statusType: "runtime_usage_ledger_status",
    startedAtType: "timestamp with time zone",
    finishedAtType: "timestamp with time zone",
    syncedAtType: "timestamp with time zone",
    createdAtType: "timestamp with time zone",
    updatedAtType: "timestamp with time zone",
  });
  expect(ledgerRow.finishedAtText).toContain("2025-04-11 08:05:00");

  const [stepRow] = await sql.unsafe<
    Array<{
      stepTypeType: string;
      statusType: string;
      startedAtType: string;
      finishedAtType: string;
      createdAtType: string;
      updatedAtType: string;
    }>
  >(
    `SELECT
      pg_typeof(step_type)::text AS "stepTypeType",
      pg_typeof(status)::text AS "statusType",
      pg_typeof(started_at)::text AS "startedAtType",
      pg_typeof(finished_at)::text AS "finishedAtType",
      pg_typeof(created_at)::text AS "createdAtType",
      pg_typeof(updated_at)::text AS "updatedAtType"
    FROM runtime_usage_ledger_steps
    WHERE id = $1`,
    [stepId],
  );
  expect(stepRow).toMatchObject({
    stepTypeType: "runtime_usage_ledger_step_type",
    statusType: "runtime_usage_ledger_step_status",
    startedAtType: "timestamp with time zone",
    finishedAtType: "timestamp with time zone",
    createdAtType: "timestamp with time zone",
    updatedAtType: "timestamp with time zone",
  });

  const [baselineRow] = await sql.unsafe<
    Array<{
      matchScopeType: string;
      lastLedgerAtType: string;
      generatedAtType: string;
      createdAtType: string;
      updatedAtType: string;
      matchScope: string;
    }>
  >(
    `SELECT
      pg_typeof(match_scope)::text AS "matchScopeType",
      pg_typeof(last_ledger_at)::text AS "lastLedgerAtType",
      pg_typeof(generated_at)::text AS "generatedAtType",
      pg_typeof(created_at)::text AS "createdAtType",
      pg_typeof(updated_at)::text AS "updatedAtType",
      match_scope::text AS "matchScope"
    FROM runtime_usage_baselines
    WHERE id = $1`,
    [baselineId],
  );
  expect(baselineRow).toMatchObject({
    matchScopeType: "runtime_usage_baseline_match_scope",
    lastLedgerAtType: "timestamp with time zone",
    generatedAtType: "timestamp with time zone",
    createdAtType: "timestamp with time zone",
    updatedAtType: "timestamp with time zone",
    matchScope: "project+provider+model+entrypoint+fingerprint",
  });
});