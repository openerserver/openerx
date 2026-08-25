import { postgresSql } from "../../db";

export type CanonicalAgentRunRecord = {
  id: string;
  taskId: string;
  sessionId: string | null;
  agentType: string;
  status: string;
  modelUsed: string | null;
  tokenUsed: number;
  result: string | null;
  error: string | null;
  candidateIndex: number | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
};

type CanonicalAgentRunRow = {
  id: string | null;
  taskId: string;
  sessionId: string | null;
  agentType: string | null;
  status: string | null;
  modelUsed: string | null;
  tokenUsed: number | null;
  result: string | null;
  error: string | null;
  candidateIndex: number | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
};

function normalizeLegacyAgentRunStatus(status: string | null) {
  if (!status) {
    return "pending";
  }
  if (status === "queued") {
    return "pending";
  }
  if (status === "cancelled") {
    return "terminated";
  }

  return status;
}

function normalizeCanonicalAgentRunRecord(
  row: CanonicalAgentRunRow | undefined,
): CanonicalAgentRunRecord | null {
  if (!row?.id || !row.taskId || !row.createdAt) {
    return null;
  }

  return {
    id: row.id,
    taskId: row.taskId,
    sessionId: row.sessionId,
    agentType: row.agentType ?? "assistant",
    status: normalizeLegacyAgentRunStatus(row.status),
    modelUsed: row.modelUsed,
    tokenUsed: row.tokenUsed ?? 0,
    result: row.result,
    error: row.error,
    candidateIndex: row.candidateIndex,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
    createdAt: row.createdAt,
  };
}

async function queryCanonicalAgentRuns(whereClause: ReturnType<typeof postgresSql>) {
  const rows = await postgresSql<CanonicalAgentRunRow[]>`
    select
      coalesce(
        nullif(op.summary_json->>'agentRunId', ''),
        case
          when op.runtime_operation_id like 'agent-run:%' then substring(op.runtime_operation_id from 11)
          else null
        end
      ) as "id",
      op.task_id as "taskId",
      coalesce(tsr.runtime_session_id, ts.runtime_session_id) as "sessionId",
      coalesce(nullif(op.summary_json->>'agentType', ''), nullif(op.title, ''), tsr.executor_kind) as "agentType",
      coalesce(
        nullif(op.summary_json->>'status', ''),
        case
          when tsr.status::text = 'queued' then 'pending'
          when tsr.status::text = 'cancelled' then 'terminated'
          else tsr.status::text
        end
      ) as status,
      coalesce(nullif(op.summary_json->>'modelUsed', ''), tsr.model_route) as "modelUsed",
      coalesce(nullif(op.summary_json->>'tokenUsed', '')::integer, tsr.total_tokens::integer, 0) as "tokenUsed",
      coalesce(nullif(op.summary_json->>'resultText', ''), tsr.result_summary) as result,
      coalesce(nullif(op.summary_json->>'errorText', ''), tsr.error_text) as error,
      coalesce(nullif(op.summary_json->>'candidateIndex', '')::integer, tsr.candidate_index) as "candidateIndex",
      coalesce(op.started_at, tsr.started_at) as "startedAt",
      coalesce(op.finished_at, tsr.finished_at) as "finishedAt",
      op.created_at as "createdAt"
    from task_operations op
    left join task_session_runs tsr on tsr.id = op.run_id and tsr.task_id = op.task_id
    left join task_sessions ts on ts.id = op.session_id and ts.task_id = op.task_id
    where (
      op.runtime_operation_id like 'agent-run:%'
      or coalesce(op.summary_json->>'agentRunId', '') <> ''
    )
      and ${whereClause}
    order by op.created_at desc
  `;

  return rows
    .map((row) => normalizeCanonicalAgentRunRecord(row))
    .filter((row): row is CanonicalAgentRunRecord => Boolean(row));
}

export async function listCanonicalTaskAgentRuns(taskId: string) {
  return queryCanonicalAgentRuns(postgresSql`op.task_id = ${taskId}`);
}

export async function listCanonicalAgentRuns() {
  return queryCanonicalAgentRuns(postgresSql`true`);
}

export async function loadCanonicalAgentRun(agentRunId: string) {
  const rows = await queryCanonicalAgentRuns(
    postgresSql`
      op.runtime_operation_id = ${`agent-run:${agentRunId}`}
      or op.summary_json->>'agentRunId' = ${agentRunId}
    `,
  );

  return rows[0] ?? null;
}
