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
const createdLedgerIds: string[] = [];
const createdLedgerStepIds: string[] = [];
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
    activeSessionCount: number;
    parallelTaskCount: number;
    recentTimelineItemCount: number;
    failedTasksToday: number;
  }>;
  summary: {
    runningTaskCount: number;
    activeSessionCount: number;
    parallelTaskCount: number;
    recentTimelineItemCount: number;
  };
}

interface AgentRunSummaryResponse {
  taskTitle: string;
  result: string | null;
  codeChanges: {
    changeCount: number;
    files: number;
    insertions: number;
    deletions: number;
    latestSummary: string | null;
  };
}

interface GovernanceOverviewResponse {
  summary: {
    runningTaskCount: number;
    activeSessionCount: number;
    parallelTaskCount: number;
    recentTimelineItemCount: number;
  };
  topRiskTasks: Array<{
    taskId: string;
    title: string;
    runtimeSessionId: string | null;
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

async function safeSql(query: string, params: unknown[] = []) {
  try {
    await sql.unsafe(query, params);
  } catch (error) {
    if ((error as { code?: string }).code !== "42P01") {
      throw error;
    }
  }
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
  const { data, status } =
    await authedRequest<Array<{ id: string; orgId: string }>>("/api/projects");
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

function taskBranchCompatNodeId(taskId: string, runtimeSessionId: string) {
  return `branch-node:${taskId}:${runtimeSessionId}`;
}

function taskSessionId(taskId: string, runtimeSessionId: string) {
  return `task-session:${taskId}:${runtimeSessionId}`;
}

function taskSessionMessageId(taskId: string, runtimeSessionId: string, runtimeMessageId: string) {
  return `task-session-message:${taskSessionId(taskId, runtimeSessionId)}:${runtimeMessageId}`;
}

async function patchTaskNode(nodeId: string, contentText: string, patch: Record<string, unknown>) {
  const currentRows = await sql.unsafe<{ content_json: Record<string, unknown> | null }[]>(
    "SELECT content_json FROM project_tree_nodes WHERE id = $1",
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
  const response = await authedRequest<{ id: string; status: string }>(`/api/tasks/${args.taskId}/runs`, {
    method: "POST",
    body: JSON.stringify({
      id: args.id,
      sessionId: args.sessionId,
      agentType: "builder",
      status: args.status,
      modelUsed: args.modelUsed ?? "github-copilot:gpt-5-mini",
      tokenUsed: args.tokenUsed ?? 0,
      startedAt: args.startedAt,
      finishedAt: args.finishedAt ?? null,
    }),
  });

  expect(response.status).toBe(201);
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
    await sql.unsafe("DELETE FROM audit_events WHERE id = $1", [id]);
  }
  for (const id of createdLedgerStepIds) {
    await sql.unsafe("DELETE FROM runtime_usage_ledger_steps WHERE id = $1", [id]);
  }
  for (const id of createdLedgerIds) {
    await sql.unsafe("DELETE FROM runtime_usage_ledgers WHERE id = $1", [id]);
  }

  for (const taskId of createdTaskIds) {
    await sql.unsafe("DELETE FROM task_timeline_views WHERE task_id = $1", [taskId]);
    await sql.unsafe("DELETE FROM task_usage_ledger_entries WHERE task_id = $1", [taskId]);
    await sql.unsafe("DELETE FROM task_artifacts WHERE task_id = $1", [taskId]);
    await sql.unsafe("DELETE FROM task_operations WHERE task_id = $1", [taskId]);
    await sql.unsafe("DELETE FROM task_snapshots WHERE task_id = $1", [taskId]);
    await sql.unsafe(
      "UPDATE task_sessions SET status = 'archived', archived_at = COALESCE(archived_at, CURRENT_TIMESTAMP), source_message_id = NULL, head_message_id = NULL, latest_run_id = NULL, winner_session_id = NULL, judge_session_id = NULL WHERE task_id = $1",
      [taskId],
    );
    await sql.unsafe(
      `DELETE FROM task_message_parts WHERE message_id IN (
        SELECT id FROM task_messages WHERE task_id = $1
      )`,
      [taskId],
    );
    await sql.unsafe("DELETE FROM task_messages WHERE task_id = $1", [taskId]);
    await sql.unsafe("DELETE FROM task_session_runs WHERE task_id = $1", [taskId]);
    await sql.unsafe("DELETE FROM task_sessions WHERE task_id = $1", [taskId]);
    await sql.unsafe("DELETE FROM task_domain_events WHERE task_id = $1", [taskId]);
    await safeSql("DELETE FROM task_run_edges WHERE task_id = $1", [taskId]);
    await safeSql("UPDATE task_run_nodes SET agent_run_id = NULL WHERE task_id = $1", [taskId]);
    await safeSql("DELETE FROM task_run_nodes WHERE task_id = $1", [taskId]);
    await safeSql("DELETE FROM task_runs WHERE task_id = $1", [taskId]);
    await sql.unsafe("DELETE FROM tasks WHERE id = $1", [taskId]);
  }

  const touchedProjectIds = new Set<string>([PROJECT_ID, ...createdProjectIds]);
  for (const projectId of touchedProjectIds) {
    await sql.unsafe("UPDATE project_tree_nodes SET parent_id = NULL WHERE project_id = $1", [
      projectId,
    ]);
  }

  const nodeIds = Array.from(createdNodeIds).sort((left, right) => {
    const leftIsRoot = left.startsWith("project_root:");
    const rightIsRoot = right.startsWith("project_root:");
    if (leftIsRoot === rightIsRoot) return 0;
    return leftIsRoot ? 1 : -1;
  });
  if (nodeIds.length > 0) {
    const nodePlaceholders = nodeIds.map((_, index) => `$${index + 1}`).join(", ");
    await sql.unsafe(
      `DELETE FROM task_sessions WHERE tree_node_id IN (${nodePlaceholders})`,
      nodeIds,
    );
    await sql.unsafe(`DELETE FROM tasks WHERE tree_node_id IN (${nodePlaceholders})`, nodeIds);
  }
  for (const nodeId of nodeIds) {
    await sql.unsafe(
      "DELETE FROM project_tree_links WHERE source_node_id = $1 OR target_node_id = $1",
      [nodeId],
    );
    await sql.unsafe(
      "DELETE FROM project_tree_branches WHERE task_node_id = $1 OR head_node_id = $1",
      [nodeId],
    );
    await sql.unsafe("DELETE FROM project_tree_nodes WHERE id = $1", [nodeId]);
  }

  for (const projectId of createdProjectIds) {
    await sql.unsafe(
      "DELETE FROM project_tree_links WHERE source_project_id = $1 OR target_project_id = $1",
      [projectId],
    );
    await sql.unsafe("DELETE FROM project_tree_branches WHERE project_id = $1", [projectId]);
    await sql.unsafe("DELETE FROM project_tree_nodes WHERE project_id = $1", [projectId]);
    await sql.unsafe("DELETE FROM project_roles WHERE project_id = $1", [projectId]);
    await sql.unsafe("DELETE FROM projects WHERE id = $1", [projectId]);
  }

  await sql.end();
});

describe("tree-backed task aggregations", () => {
  test("projects overview counts running tasks from task snapshots", async () => {
    const unique = `${Date.now()}`;
    const orgId = await getProjectOrgId(PROJECT_ID);
    const projectRecord = await createProject(orgId, unique);
    const baseline = await authedRequest<ProjectOverviewResponse>(
      "/api/projects/overview?page=1&pageSize=100",
    );
    expect(baseline.status).toBe(200);
    const baselineProject = baseline.data.data.find((item) => item.id === projectRecord.id);
    expect(baselineProject).toBeTruthy();

    const task = await createTaskForProject(projectRecord.id, `overview-tree-${unique}`);
    const runtimeSessionId = `overview-tree-session-${unique}`;
    createdNodeIds.add(taskBranchCompatNodeId(task.id, runtimeSessionId));

    const patchResponse = await authedRequest<{ id: string; status: string }>(
      `/api/tasks/${task.id}`,
      {
        method: "PATCH",
        body: JSON.stringify({
          status: "running",
          sessionId: runtimeSessionId,
          executionMode: "parallel",
        }),
      },
    );
    expect(patchResponse.status).toBe(200);

    const branchResponse = await authedRequest<{ id: string }>(`/api/tasks/${task.id}/sessions`, {
      method: "POST",
      body: JSON.stringify({
        runtimeSessionId,
        branchName: `overview-tree-branch-${unique}`,
        sourceType: "root",
        isActive: true,
      }),
    });
    expect([200, 201]).toContain(branchResponse.status);

    const messageResponse = await authedRequest<{ ok: boolean }>(
      `/api/tasks/${task.id}/sessions/messages`,
      {
        method: "POST",
        body: JSON.stringify({
          runtimeSessionId,
          message: {
            info: { id: `overview-tree-msg-${unique}`, role: "assistant" },
            parts: [{ type: "text", text: `overview timeline text ${unique}` }],
          },
        }),
      },
    );
    expect(messageResponse.status).toBe(201);

    await patchTaskNode(task.nodeId, `stale-overview-title-${unique}`, {
      status: "failed",
      sessionId: `stale-overview-session-${unique}`,
      executionMode: "single",
      result: `stale-overview-result-${unique}`,
    });

    const response = await authedRequest<ProjectOverviewResponse>(
      "/api/projects/overview?page=1&pageSize=100",
    );
    expect(response.status).toBe(200);
    const project = response.data.data.find((item) => item.id === projectRecord.id);
    expect(project).toBeTruthy();
    expect(project?.runningTasks).toBe((baselineProject?.runningTasks ?? 0) + 1);
    expect(project?.activeSessionCount).toBe((baselineProject?.activeSessionCount ?? 0) + 1);
    expect(project?.parallelTaskCount).toBe((baselineProject?.parallelTaskCount ?? 0) + 1);
    expect(project?.recentTimelineItemCount ?? 0).toBeGreaterThanOrEqual(
      (baselineProject?.recentTimelineItemCount ?? 0) + 1,
    );
    expect(response.data.summary.runningTaskCount).toBe(baseline.data.summary.runningTaskCount + 1);
    expect(response.data.summary.activeSessionCount).toBe(
      baseline.data.summary.activeSessionCount + 1,
    );
    expect(response.data.summary.parallelTaskCount).toBe(
      baseline.data.summary.parallelTaskCount + 1,
    );
    expect(response.data.summary.recentTimelineItemCount).toBeGreaterThanOrEqual(
      baseline.data.summary.recentTimelineItemCount + 1,
    );
  });

  test("agent run summary reads task title from task aggregate and does not recover code changes from stale tree content", async () => {
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

    const response = await authedRequest<AgentRunSummaryResponse>(
      `/api/agent-runs/${agentRunId}/summary`,
    );
    expect(response.status).toBe(200);
    expect(response.data.taskTitle).toBe(`agent-run-tree-${unique}`);
    expect(response.data.codeChanges).toMatchObject({
      changeCount: 0,
      files: 0,
      insertions: 0,
      deletions: 0,
      latestSummary: null,
    });
  });

  test("dashboard governance overview reads task title and session facts from projections when tree payload is stale", async () => {
    const unique = Date.now();
    const baseline = await authedRequest<GovernanceOverviewResponse>(
      "/api/dashboard/governance-overview?range=24h",
    );
    expect(baseline.status).toBe(200);

    const title = `dashboard-tree-${unique}`;
    const task = await createTask(title);
    const runtimeSessionId = `dashboard-tree-session-${unique}`;
    const createdAt = new Date(Date.now() - 5 * 60_000).toISOString();
    const updatedAt = new Date(Date.now() - 3 * 60_000).toISOString();
    const blockedAt = new Date(Date.now() - 60_000).toISOString();
    createdNodeIds.add(taskBranchCompatNodeId(task.id, runtimeSessionId));

    const patchResponse = await authedRequest<{ id: string; status: string }>(
      `/api/tasks/${task.id}`,
      {
        method: "PATCH",
        body: JSON.stringify({
          status: "running",
          sessionId: runtimeSessionId,
          executionMode: "parallel",
        }),
      },
    );
    expect(patchResponse.status).toBe(200);

    const branchResponse = await authedRequest<{ id: string }>(`/api/tasks/${task.id}/sessions`, {
      method: "POST",
      body: JSON.stringify({
        runtimeSessionId,
        branchName: `dashboard-tree-branch-${unique}`,
        sourceType: "root",
        isActive: true,
      }),
    });
    expect([200, 201]).toContain(branchResponse.status);

    const messageResponse = await authedRequest<{ ok: boolean }>(
      `/api/tasks/${task.id}/sessions/messages`,
      {
        method: "POST",
        body: JSON.stringify({
          runtimeSessionId,
          message: {
            info: { id: `dashboard-tree-msg-${unique}`, role: "assistant" },
            parts: [{ type: "text", text: `dashboard timeline text ${unique}` }],
          },
        }),
      },
    );
    expect(messageResponse.status).toBe(201);

    await patchTaskNode(task.nodeId, `stale-dashboard-title-${unique}`, {
      status: "failed",
      sessionId: `stale-dashboard-session-${unique}`,
      executionMode: "single",
      result: `stale-dashboard-result-${unique}`,
    });

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
    expect(response.data.summary.runningTaskCount).toBe(baseline.data.summary.runningTaskCount + 1);
    expect(response.data.summary.activeSessionCount).toBe(
      baseline.data.summary.activeSessionCount + 1,
    );
    expect(response.data.summary.parallelTaskCount).toBe(
      baseline.data.summary.parallelTaskCount + 1,
    );
    expect(response.data.summary.recentTimelineItemCount).toBeGreaterThanOrEqual(
      baseline.data.summary.recentTimelineItemCount + 1,
    );
    expect(response.data.topRiskTasks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          taskId: task.id,
          title,
          runtimeSessionId,
        }),
      ]),
    );
  });

  test("task creation emits canonical task aggregate domain events", async () => {
    const unique = Date.now();
    const task = await createTask(`projection-create-${unique}`);

    const eventRows = await sql.unsafe<Array<{ event_type: string }>>(
      "SELECT event_type FROM task_domain_events WHERE task_id = $1 ORDER BY created_at ASC, seq ASC",
      [task.id],
    );

    expect(eventRows).toEqual([{ event_type: "task.aggregate.upserted" }]);
  });

  test("task snapshot routes expose filtered projection rows and single-task metadata", async () => {
    const unique = Date.now();
    const olderTask = await createTask(`projection-snapshot-old-${unique}`);
    const newerTask = await createTask(`projection-snapshot-new-${unique}`);
    const olderSessionId = `projection-snapshot-old-session-${unique}`;
    const newerSessionId = `projection-snapshot-new-session-${unique}`;

    const olderPatch = await authedRequest<{ id: string; status: string }>(
      `/api/tasks/${olderTask.id}`,
      {
        method: "PATCH",
        body: JSON.stringify({
          status: "running",
          sessionId: olderSessionId,
          executionMode: "parallel",
          result: `older projection result ${unique}`,
        }),
      },
    );
    expect(olderPatch.status).toBe(200);

    const newerPatch = await authedRequest<{ id: string; status: string }>(
      `/api/tasks/${newerTask.id}`,
      {
        method: "PATCH",
        body: JSON.stringify({
          status: "running",
          sessionId: newerSessionId,
          executionMode: "sequential-chain",
          result: `newer projection result ${unique}`,
        }),
      },
    );
    expect(newerPatch.status).toBe(200);

    await patchTaskNode(olderTask.nodeId, `stale-snapshot-old-${unique}`, {
      status: "failed",
      sessionId: `stale-snapshot-old-session-${unique}`,
      executionMode: "single",
      result: `stale older result ${unique}`,
    });
    await patchTaskNode(newerTask.nodeId, `stale-snapshot-new-${unique}`, {
      status: "pending",
      sessionId: `stale-snapshot-new-session-${unique}`,
      executionMode: "single",
      result: `stale newer result ${unique}`,
    });

    const listResponse = await authedRequest<{
      data: Array<{
        taskId: string;
        currentStatus: string;
        currentSessionId: string | null;
        latestResult: string | null;
        orchestrationKind: string | null;
      }>;
    }>(`/api/tasks/snapshots?projectId=${PROJECT_ID}&status=running&limit=1`);

    expect(listResponse.status).toBe(200);
    expect(listResponse.data.data).toHaveLength(1);
    expect(listResponse.data.data[0]).toMatchObject({
      taskId: newerTask.id,
      currentStatus: "running",
      currentSessionId: newerSessionId,
      latestResult: `newer projection result ${unique}`,
      orchestrationKind: "sequential-chain",
    });

    const snapshotResponse = await authedRequest<{
      data: {
        taskId: string;
        currentStatus: string;
        currentSessionId: string | null;
        latestResult: string | null;
        orchestrationKind: string | null;
      } | null;
      meta: {
        readSource: string;
        complete: boolean;
      };
    }>(`/api/tasks/${olderTask.id}/snapshot`);

    expect(snapshotResponse.status).toBe(200);
    expect(snapshotResponse.data.meta).toEqual({
      readSource: "task-domain-projection",
      complete: true,
    });
    expect(snapshotResponse.data.data).toMatchObject({
      taskId: olderTask.id,
      currentStatus: "running",
      currentSessionId: olderSessionId,
      latestResult: `older projection result ${unique}`,
      orchestrationKind: "parallel",
    });
  });

  test("task timeline view route respects lineage filtering for projection reads", async () => {
    const unique = Date.now();
    const task = await createTask(`projection-timeline-${unique}`);
    const rootSessionId = `projection-timeline-root-${unique}`;
    const forkSessionId = `projection-timeline-fork-${unique}`;
    const rootMessageId = `projection-timeline-root-msg-${unique}`;
    const forkMessageId = `projection-timeline-fork-msg-${unique}`;

    createdNodeIds.add(taskBranchCompatNodeId(task.id, rootSessionId));
    createdNodeIds.add(taskBranchCompatNodeId(task.id, forkSessionId));

    const rootBranch = await authedRequest<{ id: string }>(`/api/tasks/${task.id}/sessions`, {
      method: "POST",
      body: JSON.stringify({
        runtimeSessionId: rootSessionId,
        branchName: `projection-root-${unique}`,
        sourceType: "root",
        isActive: true,
      }),
    });
    expect(rootBranch.status).toBe(201);

    const rootMessage = await authedRequest<{ ok: boolean }>(
      `/api/tasks/${task.id}/sessions/messages`,
      {
        method: "POST",
        body: JSON.stringify({
          runtimeSessionId: rootSessionId,
          message: {
            info: { id: rootMessageId, role: "assistant" },
            parts: [{ type: "text", text: `timeline root text ${unique}` }],
          },
        }),
      },
    );
    expect(rootMessage.status).toBe(201);

    const forkBranch = await authedRequest<{ id: string }>(`/api/tasks/${task.id}/sessions`, {
      method: "POST",
      body: JSON.stringify({
        runtimeSessionId: forkSessionId,
        parentRuntimeSessionId: rootSessionId,
        forkedFromMessageId: rootMessageId,
        branchName: `projection-fork-${unique}`,
        sourceType: "fork",
        isActive: true,
      }),
    });
    expect(forkBranch.status).toBe(201);

    const forkMessage = await authedRequest<{ ok: boolean }>(
      `/api/tasks/${task.id}/sessions/messages`,
      {
        method: "POST",
        body: JSON.stringify({
          runtimeSessionId: forkSessionId,
          message: {
            info: { id: forkMessageId, role: "assistant" },
            parts: [{ type: "text", text: `timeline fork text ${unique}` }],
          },
        }),
      },
    );
    expect(forkMessage.status).toBe(201);

    const leafOnlyResponse = await authedRequest<{
      data: Array<{
        sessionId: string | null;
        itemKind: string;
        displayText: string | null;
      }>;
      meta: {
        readSource: string;
        includeLineage: boolean;
        lineagePath: string[];
        cachedSessionCount: number;
        complete: boolean;
      };
    }>(
      `/api/tasks/${task.id}/timeline-view?sessionId=${taskSessionId(task.id, forkSessionId)}&includeLineage=false`,
    );

    expect(leafOnlyResponse.status).toBe(200);
    expect(leafOnlyResponse.data.meta).toMatchObject({
      readSource: "task-session-projection",
      includeLineage: false,
      lineagePath: [taskSessionId(task.id, forkSessionId)],
      cachedSessionCount: 1,
      complete: true,
    });
    expect(leafOnlyResponse.data.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sessionId: taskSessionId(task.id, forkSessionId),
          itemKind: "message",
          displayText: `timeline fork text ${unique}`,
        }),
      ]),
    );
    expect(
      leafOnlyResponse.data.data.some(
        (item) => item.displayText === `timeline root text ${unique}`,
      ),
    ).toBe(false);

    const lineageResponse = await authedRequest<{
      data: Array<{
        sessionId: string | null;
        itemKind: string;
        displayText: string | null;
      }>;
      meta: {
        readSource: string;
        includeLineage: boolean;
        lineagePath: string[];
        cachedSessionCount: number;
        complete: boolean;
      };
    }>(`/api/tasks/${task.id}/timeline-view?sessionId=${taskSessionId(task.id, forkSessionId)}`);

    expect(lineageResponse.status).toBe(200);
    expect(lineageResponse.data.meta).toMatchObject({
      readSource: "task-session-projection",
      includeLineage: true,
      lineagePath: [taskSessionId(task.id, rootSessionId), taskSessionId(task.id, forkSessionId)],
      cachedSessionCount: 2,
      complete: true,
    });
    expect(
      lineageResponse.data.data
        .filter((item) => item.itemKind === "message")
        .map((item) => item.displayText),
    ).toEqual([`timeline root text ${unique}`, `timeline fork text ${unique}`]);
  });

  test(
    "task projector replays canonical aggregate events but not session-first rows without message events",
    async () => {
    const unique = Date.now();
    const task = await createTask(`projection-replay-${unique}`);
    const runtimeSessionId = `projection-replay-session-${unique}`;

    const branchResponse = await authedRequest<{ id: string }>(`/api/tasks/${task.id}/sessions`, {
      method: "POST",
      body: JSON.stringify({
        runtimeSessionId,
        branchName: `projection-replay-branch-${unique}`,
        sourceType: "root",
        isActive: true,
      }),
    });
    expect(branchResponse.status).toBe(201);

    const messageResponse = await authedRequest<{ ok: boolean }>(
      `/api/tasks/${task.id}/sessions/messages`,
      {
        method: "POST",
        body: JSON.stringify({
          runtimeSessionId,
          message: {
            id: `projection-replay-message-${unique}`,
            info: {
              id: `projection-replay-message-${unique}`,
              role: "assistant",
              time: {
                created: new Date().toISOString(),
                completed: new Date().toISOString(),
              },
            },
            parts: [
              {
                type: "text",
                text: `projection replay text ${unique}`,
              },
            ],
          },
        }),
      },
    );
    expect(messageResponse.status).toBe(201);

    await sql.unsafe("DELETE FROM task_timeline_views WHERE task_id = $1", [task.id]);
    await sql.unsafe("DELETE FROM task_snapshots WHERE task_id = $1", [task.id]);

    const previousDatabaseUrl = process.env.DATABASE_URL;
    const previousDatabaseDialect = process.env.DATABASE_DIALECT;
    process.env.DATABASE_URL = DATABASE_URL;
    process.env.DATABASE_DIALECT = "postgres";
    let replayResult: { replayedEventCount: number };
    try {
      const { replayTaskDomainProjections } = await import(
        "../../control-plane/service/src/modules/tasks/task-domain-projector"
      );
      replayResult = await replayTaskDomainProjections(task.id);
    } finally {
      process.env.DATABASE_URL = previousDatabaseUrl;
      process.env.DATABASE_DIALECT = previousDatabaseDialect;
    }
    expect(replayResult.replayedEventCount).toBe(1);

    const rebuiltSnapshotRows = await sql.unsafe<
      Array<{ lifecycle_status: string; current_session_id: string | null }>
    >("SELECT lifecycle_status, current_session_id FROM task_snapshots WHERE task_id = $1", [
      task.id,
    ]);
    expect(rebuiltSnapshotRows).toEqual([
      expect.objectContaining({
        lifecycle_status: "draft",
        current_session_id: null,
      }),
    ]);

    const rebuiltTimelineRows = await sql.unsafe<
      Array<{ item_kind: string; display_text: string | null }>
    >("SELECT item_kind, display_text FROM task_timeline_views WHERE task_id = $1", [task.id]);
    expect(rebuiltTimelineRows).toEqual([
      expect.objectContaining({
        item_kind: "task_lifecycle",
        display_text: "任务进入 pending 状态",
      }),
    ]);
    },
  );

  test(
    "task projector replays project-scoped canonical aggregate events but not session-first rows",
    async () => {
    const unique = Date.now();
    const orgId = await getProjectOrgId(PROJECT_ID);
    const projectRecord = await createProject(orgId, `${unique}`);
    const firstTask = await createTaskForProject(
      projectRecord.id,
      `projection-project-a-${unique}`,
    );
    const secondTask = await createTaskForProject(
      projectRecord.id,
      `projection-project-b-${unique}`,
    );
    const firstRuntimeSessionId = `projection-project-session-a-${unique}`;
    const secondRuntimeSessionId = `projection-project-session-b-${unique}`;

    for (const [taskId, runtimeSessionId, suffix] of [
      [firstTask.id, firstRuntimeSessionId, "a"],
      [secondTask.id, secondRuntimeSessionId, "b"],
    ] as const) {
      const branchResponse = await authedRequest<{ id: string }>(`/api/tasks/${taskId}/sessions`, {
        method: "POST",
        body: JSON.stringify({
          runtimeSessionId,
          branchName: `projection-project-branch-${suffix}-${unique}`,
          sourceType: "root",
          isActive: true,
        }),
      });
      expect(branchResponse.status).toBe(201);

      const messageResponse = await authedRequest<{ ok: boolean }>(
        `/api/tasks/${taskId}/sessions/messages`,
        {
          method: "POST",
          body: JSON.stringify({
            runtimeSessionId,
            message: {
              id: `projection-project-message-${suffix}-${unique}`,
              info: {
                id: `projection-project-message-${suffix}-${unique}`,
                role: "assistant",
                time: {
                  created: new Date().toISOString(),
                  completed: new Date().toISOString(),
                },
              },
              parts: [
                {
                  type: "text",
                  text: `projection project text ${suffix} ${unique}`,
                },
              ],
            },
          }),
        },
      );
      expect(messageResponse.status).toBe(201);
    }

    await sql.unsafe("DELETE FROM task_timeline_views WHERE project_id = $1", [projectRecord.id]);
    await sql.unsafe("DELETE FROM task_snapshots WHERE project_id = $1", [projectRecord.id]);

    const previousDatabaseUrl = process.env.DATABASE_URL;
    const previousDatabaseDialect = process.env.DATABASE_DIALECT;
    process.env.DATABASE_URL = DATABASE_URL;
    process.env.DATABASE_DIALECT = "postgres";
    let replayResult: { replayedTaskCount: number; replayedEventCount: number };
    try {
      const { replayTaskDomainProjectionsByProject } = await import(
        "../../control-plane/service/src/modules/tasks/task-domain-projector"
      );
      replayResult = await replayTaskDomainProjectionsByProject(projectRecord.id);
    } finally {
      process.env.DATABASE_URL = previousDatabaseUrl;
      process.env.DATABASE_DIALECT = previousDatabaseDialect;
    }

    expect(replayResult.replayedTaskCount).toBe(2);
    expect(replayResult.replayedEventCount).toBe(2);

    const rebuiltSnapshotRows = await sql.unsafe<Array<{ task_id: string }>>(
      "SELECT task_id FROM task_snapshots WHERE project_id = $1 ORDER BY task_id ASC",
      [projectRecord.id],
    );
    expect(rebuiltSnapshotRows.map((row) => row.task_id)).toEqual(
      [firstTask.id, secondTask.id].sort(),
    );
    },
  );

  test("projection replay API reports canonical aggregate events for session-first task history", async () => {
    const unique = Date.now();
    const task = await createTask(`projection-route-task-${unique}`);
    const runtimeSessionId = `projection-route-session-${unique}`;

    const branchResponse = await authedRequest<{ id: string }>(`/api/tasks/${task.id}/sessions`, {
      method: "POST",
      body: JSON.stringify({
        runtimeSessionId,
        branchName: `projection-route-branch-${unique}`,
        sourceType: "root",
        isActive: true,
      }),
    });
    expect(branchResponse.status).toBe(201);

    const messageResponse = await authedRequest<{ ok: boolean }>(
      `/api/tasks/${task.id}/sessions/messages`,
      {
        method: "POST",
        body: JSON.stringify({
          runtimeSessionId,
          message: {
            id: `projection-route-message-${unique}`,
            info: {
              id: `projection-route-message-${unique}`,
              role: "assistant",
              time: {
                created: new Date().toISOString(),
                completed: new Date().toISOString(),
              },
            },
            parts: [
              { type: "text", text: `projection route text ${unique}` },
              {
                type: "tool_call",
                name: "search_code",
                input: {
                  query: "task domain projections",
                  includePattern: "control-plane/service/src/modules/tasks/**",
                },
              },
              {
                type: "file_reference",
                filePath: "docs/task-domain-radical-storage-redesign-plan.md",
                startLine: 12,
                endLine: 26,
              },
              {
                type: "diff",
                filePath: "control-plane/service/src/modules/tasks/task-domain-projector.ts",
                additions: 14,
                deletions: 3,
              },
            ],
          },
        }),
      },
    );
    expect(messageResponse.status).toBe(201);

    await sql.unsafe("DELETE FROM task_timeline_views WHERE task_id = $1", [task.id]);
    await sql.unsafe("DELETE FROM task_snapshots WHERE task_id = $1", [task.id]);

    const replayResponse = await authedRequest<{ scope: string; replayedEventCount: number }>(
      "/api/tasks/projections/replay",
      {
        method: "POST",
        body: JSON.stringify({
          scope: "task",
          taskId: task.id,
          reason: "rebuild task projection after richer timeline mapping",
        }),
      },
    );

    expect(replayResponse.status).toBe(200);
    expect(replayResponse.data.scope).toBe("task");
    expect(replayResponse.data.replayedEventCount).toBe(1);

    const rebuiltTimelineRows = await sql.unsafe<
      Array<{
        item_kind: string;
        display_text: string | null;
        metadata_json: Record<string, unknown> | null;
      }>
    >(
      "SELECT item_kind, display_text, metadata_json FROM task_timeline_views WHERE task_id = $1 ORDER BY created_at ASC",
      [task.id],
    );
    expect(rebuiltTimelineRows).toEqual([
      expect.objectContaining({
        item_kind: "task_lifecycle",
        display_text: "任务进入 pending 状态",
      }),
    ]);
  });

  test("projection replay API enforces explicit project confirmation", async () => {
    const rejected = await authedRequest<{ error?: string; issues?: unknown[] }>(
      "/api/tasks/projections/replay",
      {
        method: "POST",
        body: JSON.stringify({
          scope: "project",
          projectId: PROJECT_ID,
          reason: "rebuild project projection after projection rollout",
        }),
      },
    );

    expect(rejected.status).toBe(400);
  });

  test(
    "projection replay API accepts confirmed project scope and replays canonical aggregate events",
    async () => {
    const unique = Date.now();
    const orgId = await getProjectOrgId(PROJECT_ID);
    const projectRecord = await createProject(orgId, `${unique}`);
    const task = await createTaskForProject(projectRecord.id, `projection-route-project-${unique}`);
    const runtimeSessionId = `projection-route-project-session-${unique}`;

    const branchResponse = await authedRequest<{ id: string }>(`/api/tasks/${task.id}/sessions`, {
      method: "POST",
      body: JSON.stringify({
        runtimeSessionId,
        branchName: `projection-route-project-branch-${unique}`,
        sourceType: "fork",
        isActive: true,
      }),
    });
    expect(branchResponse.status).toBe(201);

    await sql.unsafe("DELETE FROM task_timeline_views WHERE project_id = $1", [projectRecord.id]);
    await sql.unsafe("DELETE FROM task_snapshots WHERE project_id = $1", [projectRecord.id]);

    const replayResponse = await authedRequest<{
      scope: string;
      confirmed: boolean;
      replayedTaskCount: number;
      replayedEventCount: number;
    }>("/api/tasks/projections/replay", {
      method: "POST",
      body: JSON.stringify({
        scope: "project",
        projectId: projectRecord.id,
        confirm: true,
        reason: "rebuild project projection after projector API hardening",
      }),
    });

    expect(replayResponse.status).toBe(200);
    expect(replayResponse.data.scope).toBe("project");
    expect(replayResponse.data.confirmed).toBe(true);
    expect(replayResponse.data.replayedTaskCount).toBeGreaterThanOrEqual(1);
    expect(replayResponse.data.replayedEventCount).toBe(1);
    },
  );

  test(
    "session and message persistence writes session-first tables while task domain events remain create-time only",
    async () => {
    const unique = Date.now();
    const task = await createTask(`conversation-dual-write-${unique}`);
    const runtimeSessionId = `conversation-session-${unique}`;
    const branchName = `branch-${unique}`;
    const persistedSessionId = taskSessionId(task.id, runtimeSessionId);

    const branchResponse = await authedRequest<{
      id: string;
      taskId: string;
      runtimeSessionId: string;
    }>(`/api/tasks/${task.id}/sessions`, {
      method: "POST",
      body: JSON.stringify({
        runtimeSessionId,
        branchName,
        sourceType: "root",
        isActive: true,
      }),
    });
    expect(branchResponse.status).toBe(201);

    const messagePayload = {
      id: `msg-${unique}`,
      info: {
        id: `msg-${unique}`,
        role: "assistant",
        time: {
          created: new Date().toISOString(),
          completed: new Date().toISOString(),
        },
        tokens: {
          total: 42,
        },
      },
      parts: [
        {
          type: "text",
          text: `conversation text ${unique}`,
        },
      ],
    };

    const messageResponse = await authedRequest<{ ok: boolean }>(
      `/api/tasks/${task.id}/sessions/messages`,
      {
        method: "POST",
        body: JSON.stringify({
          runtimeSessionId,
          message: messagePayload,
        }),
      },
    );
    expect(messageResponse.status).toBe(201);

    const sessionRows = await sql.unsafe<
      Array<{
        id: string;
        runtime_session_id: string;
        branch_name: string | null;
        execution_status: string;
      }>
    >(
      "SELECT id, runtime_session_id, branch_name, execution_status FROM task_sessions WHERE task_id = $1",
      [task.id],
    );
    expect(sessionRows).toEqual([
      expect.objectContaining({
        id: persistedSessionId,
        runtime_session_id: runtimeSessionId,
        branch_name: branchName,
      }),
    ]);

    const messageRows = await sql.unsafe<
      Array<{
        id: string;
        session_id: string;
        runtime_message_id: string | null;
        text_content: string | null;
      }>
    >(
      "SELECT id, session_id, runtime_message_id, text_content FROM task_messages WHERE task_id = $1",
      [task.id],
    );
    expect(messageRows).toEqual([
      expect.objectContaining({
        id: taskSessionMessageId(task.id, runtimeSessionId, `msg-${unique}`),
        session_id: persistedSessionId,
        runtime_message_id: `msg-${unique}`,
        text_content: `conversation text ${unique}`,
      }),
    ]);

    const partRows = await sql.unsafe<
      Array<{ message_id: string; part_type: string; text_content: string | null }>
    >("SELECT message_id, part_type, text_content FROM task_message_parts WHERE message_id = $1", [
      taskSessionMessageId(task.id, runtimeSessionId, `msg-${unique}`),
    ]);
    expect(partRows).toEqual([
      expect.objectContaining({
        message_id: taskSessionMessageId(task.id, runtimeSessionId, `msg-${unique}`),
        part_type: "text",
        text_content: `conversation text ${unique}`,
      }),
    ]);

    const snapshotRows = await sql.unsafe<
      Array<{
        task_id: string;
        lifecycle_status: string;
        current_session_id: string | null;
      }>
    >(
      "SELECT task_id, lifecycle_status, current_session_id FROM task_snapshots WHERE task_id = $1",
      [task.id],
    );
    expect(snapshotRows).toEqual([
      expect.objectContaining({
        task_id: task.id,
        lifecycle_status: "active",
        current_session_id: persistedSessionId,
      }),
    ]);

    const timelineRows = await sql.unsafe<
      Array<{
        message_id: string | null;
        item_kind: string;
        item_role: string | null;
        display_text: string | null;
      }>
    >(
      "SELECT message_id, item_kind, item_role, display_text FROM task_timeline_views WHERE message_id = $1",
      [taskSessionMessageId(task.id, runtimeSessionId, `msg-${unique}`)],
    );
    expect(timelineRows).toEqual([
      expect.objectContaining({
        message_id: taskSessionMessageId(task.id, runtimeSessionId, `msg-${unique}`),
        item_kind: "message",
        item_role: "assistant",
        display_text: `conversation text ${unique}`,
      }),
    ]);

    const eventRows = await sql.unsafe<Array<{ event_type: string; session_id: string | null }>>(
      "SELECT event_type, session_id FROM task_domain_events WHERE task_id = $1 ORDER BY created_at ASC",
      [task.id],
    );
    expect(eventRows).toEqual([
      {
        event_type: "task.aggregate.upserted",
        session_id: null,
      },
    ]);
    },
  );

  test("agent runs and runtime ledgers sync through canonical session operations", async () => {
    const unique = Date.now();
    const task = await createTask(`task-run-dual-write-${unique}`);
    const agentRunId = `agent-run-dual-write-${unique}`;
    const runtimeSessionId = `runtime-session-dual-write-${unique}`;
    const persistedSessionId = taskSessionId(task.id, runtimeSessionId);
    const stepId = `ledger-step-dual-write-${unique}`;

    const createRunResponse = await authedRequest<{ id: string; status: string }>(
      `/api/tasks/${task.id}/runs`,
      {
        method: "POST",
        body: JSON.stringify({
          id: agentRunId,
          sessionId: runtimeSessionId,
          agentType: "builder",
          status: "running",
          modelUsed: "github-copilot:gpt-5-mini",
          tokenUsed: 21,
        }),
      },
    );
    expect(createRunResponse.status).toBe(201);

    const patchRunResponse = await authedRequest<{ id: string; status: string }>(
      `/api/tasks/${task.id}/runs/${agentRunId}`,
      {
        method: "PATCH",
        body: JSON.stringify({
          status: "completed",
          result: `task run completed ${unique}`,
          tokenUsed: 42,
        }),
      },
    );
    expect(patchRunResponse.status).toBe(200);

    const sessionOperationRows = await sql.unsafe<
      Array<{
        id: string;
        session_id: string;
        operation_kind: string;
        status: string;
        result_text: string | null;
      }>
    >(
      "SELECT id, session_id, operation_kind, status, summary_json->>'resultText' AS result_text FROM task_operations WHERE task_id = $1",
      [task.id],
    );
    expect(sessionOperationRows).toEqual([
      expect.objectContaining({
        id: `session-operation:${task.id}:${agentRunId}`,
        session_id: persistedSessionId,
        operation_kind: "model_request",
        status: "completed",
        result_text: `task run completed ${unique}`,
      }),
    ]);

    const usageLedgerRows = await sql.unsafe<
      Array<{
        id: string;
        session_id: string | null;
        operation_id: string | null;
        entry_kind: string;
        output_tokens: number;
      }>
    >(
      "SELECT id, session_id, operation_id, entry_kind, output_tokens::int AS output_tokens FROM task_usage_ledger_entries WHERE task_id = $1 ORDER BY created_at ASC",
      [task.id],
    );
    expect(usageLedgerRows).toEqual([
      expect.objectContaining({
        session_id: persistedSessionId,
        operation_id: `session-operation:${task.id}:${agentRunId}`,
        entry_kind: "model_request",
        output_tokens: 21,
      }),
      expect.objectContaining({
        session_id: persistedSessionId,
        operation_id: `session-operation:${task.id}:${agentRunId}`,
        entry_kind: "model_request",
        output_tokens: 42,
      }),
    ]);

    const canonicalRunRows = await sql.unsafe<
      Array<{
        id: string;
        session_id: string;
        runtime_session_id: string | null;
        candidate_index: number | null;
      }>
    >(
      "SELECT id, session_id, runtime_session_id, candidate_index FROM task_session_runs WHERE task_id = $1 AND id = $2",
      [task.id, `run_${persistedSessionId}`],
    );
    expect(canonicalRunRows).toEqual([
      expect.objectContaining({
        id: `run_${persistedSessionId}`,
        session_id: persistedSessionId,
        runtime_session_id: runtimeSessionId,
        candidate_index: null,
      }),
    ]);

    const snapshotRows = await sql.unsafe<
      Array<{
        task_id: string;
        lifecycle_status: string;
        current_session_id: string | null;
        latest_result_summary: string | null;
      }>
    >(
      "SELECT task_id, lifecycle_status, current_session_id, latest_result_summary FROM task_snapshots WHERE task_id = $1",
      [task.id],
    );
    expect(snapshotRows).toEqual([
      expect.objectContaining({
        task_id: task.id,
        lifecycle_status: "done",
        current_session_id: persistedSessionId,
        latest_result_summary: `task run completed ${unique}`,
      }),
    ]);

    const timelineRows = await sql.unsafe<
      Array<{
        operation_id: string | null;
        item_kind: string;
        item_role: string | null;
        display_text: string | null;
      }>
    >(
      "SELECT operation_id, item_kind, item_role, display_text FROM task_timeline_views WHERE task_id = $1 ORDER BY created_at ASC",
      [task.id],
    );
    expect(timelineRows).toEqual([
      expect.objectContaining({
        operation_id: null,
        item_kind: "task_lifecycle",
        item_role: null,
        display_text: "任务进入 pending 状态",
      }),
    ]);

    const eventRows = await sql.unsafe<
      Array<{ event_type: string; run_id: string | null; run_node_id: string | null }>
    >(
      "SELECT event_type, run_id, run_node_id FROM task_domain_events WHERE task_id = $1 ORDER BY created_at ASC",
      [task.id],
    );
    expect(eventRows).toEqual([
      {
        event_type: "task.aggregate.upserted",
        run_id: null,
        run_node_id: null,
      },
    ]);

    const ledgerSyncResponse = await authedRequest<{
      ledger: { id: string } | null;
      stepInserted: boolean;
      deltaApplied: boolean;
    }>(`/api/projects/${PROJECT_ID}/runtime-usage-ledgers/sync`, {
      method: "POST",
      body: JSON.stringify({
        taskId: task.id,
        agentRunId,
        runtimeSessionId,
        executionSource: "task-execute",
        entrypointType: "single",
        inputTokens: 10,
        outputTokens: 8,
        totalTokens: 18,
        costUsd: 0.18,
        status: "completed",
        step: {
          id: stepId,
          stepType: "execution",
          requestIndex: 0,
          inputTokens: 10,
          outputTokens: 8,
          totalTokens: 18,
          costUsd: 0.18,
          status: "completed",
        },
      }),
    });
    expect(ledgerSyncResponse.status).toBe(200);
    expect(ledgerSyncResponse.data.stepInserted).toBe(true);
    expect(ledgerSyncResponse.data.deltaApplied).toBe(true);
    expect(ledgerSyncResponse.data.ledger?.id).toBeTruthy();

    if (ledgerSyncResponse.data.ledger?.id) {
      createdLedgerIds.push(ledgerSyncResponse.data.ledger.id);
    }
    createdLedgerStepIds.push(stepId);

    const ledgerRows = await sql.unsafe<
      Array<{ id: string; run_id: string | null; run_node_id: string | null }>
    >("SELECT id, run_id, run_node_id FROM runtime_usage_ledgers WHERE runtime_session_id = $1", [
      runtimeSessionId,
    ]);
    expect(ledgerRows).toEqual([
      expect.objectContaining({
        id: ledgerSyncResponse.data.ledger?.id,
        run_id: null,
        run_node_id: null,
      }),
    ]);

    const ledgerStepRows = await sql.unsafe<
      Array<{ id: string; run_id: string | null; run_node_id: string | null }>
    >("SELECT id, run_id, run_node_id FROM runtime_usage_ledger_steps WHERE id = $1", [stepId]);
    expect(ledgerStepRows).toEqual([
      expect.objectContaining({
        id: stepId,
        run_id: null,
        run_node_id: null,
      }),
    ]);
  });
});
