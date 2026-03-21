import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import postgres from "../../control-plane/service/node_modules/postgres";

const CP_URL = process.env.TEST_CP_URL || "http://127.0.0.1:4097";
const PROJECT_ID = process.env.TEST_PROJECT_ID || "proj-default";
const USERNAME = process.env.TEST_USERNAME || "admin";
const PASSWORD = process.env.TEST_PASSWORD || "admin123!";
const rawDatabaseUrl = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL || "";
const DATABASE_URL = /^(postgres|postgresql):\/\//i.test(rawDatabaseUrl)
  ? rawDatabaseUrl
  : "postgres://127.0.0.1:5432/openerx";

const sql = postgres(DATABASE_URL, { max: 1, prepare: false });

const createdProjectIds: string[] = [];
const createdTaskIds: string[] = [];
const createdNodeIds = new Set<string>();
const createdAgentRunIds: string[] = [];
const createdLedgerIds: string[] = [];
const createdAuditIds: string[] = [];
let token = "";
let currentUserId = "";

interface ApiResult<T> {
  data: T;
  status: number;
}

interface ProjectOverviewResponse {
  data: Array<{
    id: string;
    runningTasks: number;
    failedTasksToday: number;
  }>;
}

interface AgentRunSummaryResponse {
  taskTitle: string;
  result: string | null;
  codeChanges: {
    files: number;
    insertions: number;
    deletions: number;
  };
}

interface GovernanceOverviewResponse {
  topRiskTasks: Array<{
    taskId: string;
    title: string;
  }>;
}

async function request<T>(path: string, opts: RequestInit = {}): Promise<ApiResult<T>> {
  const response = await fetch(`${CP_URL}${path}`, opts);
  const text = await response.text();
  let data: unknown;
  try {
    data = text ? JSON.parse(text) : undefined;
  } catch {
    data = text;
  }

  return { data: data as T, status: response.status };
}

async function authedRequest<T>(path: string, opts: RequestInit = {}) {
  return request<T>(path, {
    ...opts,
    headers: {
      ...(opts.headers as Record<string, string>),
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });
}

function decodeJwtPayload(jwt: string) {
  const [, payload] = jwt.split(".");
  if (!payload) {
    throw new Error("JWT payload missing");
  }

  return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { sub: string };
}

async function login() {
  const { data, status } = await request<{ token: string }>("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: USERNAME, password: PASSWORD }),
  });

  if (status !== 200) {
    throw new Error(`Login failed: ${status} ${JSON.stringify(data)}`);
  }

  return data.token;
}

async function createTask(title: string) {
  return createTaskForProject(PROJECT_ID, title);
}

async function createTaskForProject(projectId: string, title: string) {
  const { data, status } = await authedRequest<{ id: string; nodeId: string }>("/api/tasks", {
    method: "POST",
    body: JSON.stringify({
      projectId,
      title,
      prompt: `${title} prompt`,
    }),
  });

  expect(status).toBe(201);
  createdTaskIds.push(data.id);
  createdNodeIds.add(data.nodeId);
  return data;
}

async function getProjectOrgId(projectId: string) {
  const { data, status } = await authedRequest<Array<{ id: string; orgId: string }>>("/api/projects");
  expect(status).toBe(200);
  const project = data.find((item) => item.id === projectId);
  expect(project).toBeTruthy();
  return project?.orgId ?? "";
}

async function createProject(orgId: string, unique: string) {
  const { data, status } = await authedRequest<{ id: string; rootNodeId: string }>(
    "/api/projects",
    {
      method: "POST",
      body: JSON.stringify({
        orgId,
        name: `tree-aggregation-${unique}`,
        slug: `tree-aggregation-${unique}`,
        description: "tree aggregation isolated project",
      }),
    },
  );
  expect(status).toBe(201);
  createdProjectIds.push(data.id);
  createdNodeIds.add(data.rootNodeId);
  return data;
}

async function patchTaskNode(nodeId: string, contentText: string, patch: Record<string, unknown>) {
  const currentRows = await sql.unsafe<{ content_json: Record<string, unknown> | null }[]>(
    `SELECT content_json FROM project_tree_nodes WHERE id = $1`,
    [nodeId],
  );
  const currentContent = currentRows[0]?.content_json ?? {};

  await sql.unsafe(
    `UPDATE project_tree_nodes
        SET content_text = $1,
            content_json = $2::jsonb,
            updated_at = CURRENT_TIMESTAMP
      WHERE id = $3`,
    [contentText, JSON.stringify({ ...currentContent, ...patch }), nodeId],
  );
}

async function insertAgentRun(args: {
  id: string;
  taskId: string;
  sessionId: string;
  status: string;
  modelUsed?: string;
  tokenUsed?: number;
  startedAt: string;
  finishedAt?: string | null;
}) {
  await sql.unsafe(
    `INSERT INTO agent_runs (
      id, task_id, session_id, agent_type, status, model_used, token_used, result, error, started_at, finished_at, created_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, NULL, NULL, $8, $9, $10)`,
    [
      args.id,
      args.taskId,
      args.sessionId,
      "builder",
      args.status,
      args.modelUsed ?? "github-copilot:gpt-5-mini",
      args.tokenUsed ?? 0,
      args.startedAt,
      args.finishedAt ?? null,
      args.startedAt,
    ],
  );
  createdAgentRunIds.push(args.id);
}

async function insertLedger(args: {
  id: string;
  taskId: string;
  runtimeSessionId: string;
  requestCount: number;
  totalTokens: number;
  costUsd: number;
  candidateCount: number;
  judgeRequestCount: number;
  hookRequestCount: number;
  createdAt: string;
  updatedAt: string;
}) {
  await sql.unsafe(
    `INSERT INTO runtime_usage_ledgers (
      id, project_id, task_id, runtime_session_id, execution_source, entrypoint_type,
      orchestration_fingerprint, default_provider_id, default_model_id, request_count, step_count,
      input_tokens, output_tokens, total_tokens, cost_usd, candidate_count, judge_request_count,
      hook_request_count, status, started_at, finished_at, synced_at, created_at, updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24)`,
    [
      args.id,
      PROJECT_ID,
      args.taskId,
      args.runtimeSessionId,
      "task-execute",
      "parallel-candidate",
      `fp-${args.id}`,
      "github-copilot",
      "gpt-5-mini",
      args.requestCount,
      args.requestCount,
      Math.floor(args.totalTokens * 0.6),
      Math.ceil(args.totalTokens * 0.4),
      args.totalTokens,
      args.costUsd,
      args.candidateCount,
      args.judgeRequestCount,
      args.hookRequestCount,
      "completed",
      args.createdAt,
      args.updatedAt,
      args.updatedAt,
      args.createdAt,
      args.updatedAt,
    ],
  );
  createdLedgerIds.push(args.id);
}

async function insertAudit(args: {
  id: string;
  taskId: string;
  sessionId: string;
  action: string;
  ts: string;
  detail: Record<string, unknown>;
}) {
  await sql.unsafe(
    `INSERT INTO audit_events (
      id, ts, user_id, project_id, session_id, task_id, event_type, action, target, detail, risk_level
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11)`,
    [
      args.id,
      args.ts,
      currentUserId,
      PROJECT_ID,
      args.sessionId,
      args.taskId,
      "paid_execution",
      args.action,
      args.taskId,
      JSON.stringify(args.detail),
      "high",
    ],
  );
  createdAuditIds.push(args.id);
}

beforeAll(async () => {
  token = await login();
  currentUserId = decodeJwtPayload(token).sub;
});

afterAll(async () => {
  for (const id of createdAuditIds) {
    await sql.unsafe(`DELETE FROM audit_events WHERE id = $1`, [id]);
  }
  for (const id of createdLedgerIds) {
    await sql.unsafe(`DELETE FROM runtime_usage_ledgers WHERE id = $1`, [id]);
  }
  for (const id of createdAgentRunIds) {
    await sql.unsafe(`DELETE FROM agent_runs WHERE id = $1`, [id]);
  }

  const nodeIds = Array.from(createdNodeIds).sort((left, right) => {
    const leftIsRoot = left.startsWith("project_root:");
    const rightIsRoot = right.startsWith("project_root:");
    if (leftIsRoot === rightIsRoot) return 0;
    return leftIsRoot ? 1 : -1;
  });
  for (const nodeId of nodeIds) {
    await sql.unsafe(`DELETE FROM project_tree_links WHERE source_node_id = $1 OR target_node_id = $1`, [nodeId]);
    await sql.unsafe(`DELETE FROM project_tree_events WHERE node_id = $1`, [nodeId]);
    await sql.unsafe(`DELETE FROM project_tree_branches WHERE task_node_id = $1 OR head_node_id = $1`, [nodeId]);
    await sql.unsafe(`DELETE FROM project_tree_nodes WHERE id = $1`, [nodeId]);
  }

  for (const projectId of createdProjectIds) {
    await sql.unsafe(`DELETE FROM project_tree_links WHERE source_project_id = $1 OR target_project_id = $1`, [projectId]);
    await sql.unsafe(`DELETE FROM project_tree_events WHERE project_id = $1`, [projectId]);
    await sql.unsafe(`DELETE FROM project_tree_branches WHERE project_id = $1`, [projectId]);
    await sql.unsafe(`DELETE FROM project_tree_nodes WHERE project_id = $1`, [projectId]);
    await sql.unsafe(`DELETE FROM project_roles WHERE project_id = $1`, [projectId]);
    await sql.unsafe(`DELETE FROM projects WHERE id = $1`, [projectId]);
  }

  await sql.end();
});

describe("tree-backed task aggregations", () => {
  test("projects overview counts running tasks from task tree", async () => {
    const unique = `${Date.now()}`;
    const orgId = await getProjectOrgId(PROJECT_ID);
    const projectRecord = await createProject(orgId, unique);
    const baseline = await authedRequest<ProjectOverviewResponse>("/api/projects/overview?page=1&pageSize=100");
    expect(baseline.status).toBe(200);
    const baselineProject = baseline.data.data.find((item) => item.id === projectRecord.id);
    expect(baselineProject).toBeTruthy();

    const task = await createTaskForProject(projectRecord.id, `overview-tree-${unique}`);
    await patchTaskNode(task.nodeId, `overview-tree-running-${Date.now()}`, {
      status: "running",
      startedAt: new Date().toISOString(),
      finishedAt: null,
    });

    const response = await authedRequest<ProjectOverviewResponse>("/api/projects/overview?page=1&pageSize=100");
    expect(response.status).toBe(200);
    const project = response.data.data.find((item) => item.id === projectRecord.id);
    expect(project).toBeTruthy();
    expect(project?.runningTasks).toBe((baselineProject?.runningTasks ?? 0) + 1);
  });

  test("agent run summary reads task title and result from task tree", async () => {
    const unique = Date.now();
    const task = await createTask(`agent-run-tree-${unique}`);
    const treeTitle = `agent-run-tree-title-${unique}`;
    const treeResult = `agent-run-tree-result-${unique}`;
    await patchTaskNode(task.nodeId, treeTitle, {
      result: treeResult,
      changesSummary: {
        filesAdded: 1,
        filesModified: 2,
        filesDeleted: 0,
        totalInsertions: 24,
        totalDeletions: 6,
      },
    });

    const agentRunId = `run-tree-${unique}`;
    const startedAt = new Date(Date.now() - 60_000).toISOString();
    await insertAgentRun({
      id: agentRunId,
      taskId: task.id,
      sessionId: `session-tree-${unique}`,
      status: "completed",
      tokenUsed: 128,
      startedAt,
      finishedAt: new Date().toISOString(),
    });

    const response = await authedRequest<AgentRunSummaryResponse>(`/api/agent-runs/${agentRunId}/summary`);
    expect(response.status).toBe(200);
    expect(response.data.taskTitle).toBe(treeTitle);
    expect(response.data.codeChanges).toMatchObject({
      files: 3,
      insertions: 24,
      deletions: 6,
    });
  });

  test("dashboard governance overview reads task title from task tree", async () => {
    const unique = Date.now();
    const task = await createTask(`dashboard-tree-${unique}`);
    const treeTitle = `dashboard-tree-title-${unique}`;
    const runtimeSessionId = `dashboard-tree-session-${unique}`;
    const createdAt = new Date(Date.now() - 5 * 60_000).toISOString();
    const updatedAt = new Date(Date.now() - 3 * 60_000).toISOString();
    const blockedAt = new Date(Date.now() - 60_000).toISOString();

    await patchTaskNode(task.nodeId, treeTitle, {});
    await insertLedger({
      id: `ledger-tree-${unique}`,
      taskId: task.id,
      runtimeSessionId,
      requestCount: 6,
      totalTokens: 900,
      costUsd: 0.9,
      candidateCount: 4,
      judgeRequestCount: 2,
      hookRequestCount: 1,
      createdAt,
      updatedAt,
    });
    await insertAudit({
      id: `audit-tree-${unique}`,
      taskId: task.id,
      sessionId: runtimeSessionId,
      action: "guard_blocked_preflight",
      ts: blockedAt,
      detail: {
        guardDecision: "deny",
        guardReason: "tree title should be visible in governance overview",
      },
    });

    const response = await authedRequest<GovernanceOverviewResponse>(
      "/api/dashboard/governance-overview?range=24h",
    );
    expect(response.status).toBe(200);
    expect(response.data.topRiskTasks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          taskId: task.id,
          title: treeTitle,
        }),
      ]),
    );
  });
});