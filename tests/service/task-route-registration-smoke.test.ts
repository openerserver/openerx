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

const createdTaskIds: string[] = [];
const createdNodeIds = new Set<string>();
const createdAgentRunIds: string[] = [];
let token = "";

interface ApiResult<T> {
  data: T;
  status: number;
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
  const { data, status } = await authedRequest<{ id: string; nodeId: string }>("/api/tasks", {
    method: "POST",
    body: JSON.stringify({
      projectId: PROJECT_ID,
      title,
      prompt: `${title} prompt`,
    }),
  });

  expect(status).toBe(201);
  createdTaskIds.push(data.id);
  createdNodeIds.add(data.nodeId);
  return data;
}

beforeAll(async () => {
  token = await login();
});

afterAll(async () => {
  for (const taskId of createdTaskIds) {
    await sql.unsafe("DELETE FROM task_timeline_views WHERE task_id = $1", [taskId]);
    await sql.unsafe("DELETE FROM task_domain_events WHERE task_id = $1", [taskId]);
    await sql.unsafe(
      `DELETE FROM conversation_message_parts WHERE message_id IN (
        SELECT id FROM conversation_messages WHERE task_id = $1
      )`,
      [taskId],
    );
    await sql.unsafe("DELETE FROM conversation_messages WHERE task_id = $1", [taskId]);
    await sql.unsafe("DELETE FROM conversation_sessions WHERE task_id = $1", [taskId]);
    await sql.unsafe("DELETE FROM task_snapshots WHERE task_id = $1", [taskId]);
    await sql.unsafe("DELETE FROM task_run_edges WHERE task_id = $1", [taskId]);
    await sql.unsafe("UPDATE agent_runs SET run_node_id = NULL, run_id = NULL WHERE task_id = $1", [
      taskId,
    ]);
    await sql.unsafe("UPDATE task_run_nodes SET agent_run_id = NULL WHERE task_id = $1", [taskId]);
    await sql.unsafe("DELETE FROM task_run_nodes WHERE task_id = $1", [taskId]);
    await sql.unsafe("DELETE FROM agent_runs WHERE task_id = $1", [taskId]);
    await sql.unsafe("DELETE FROM task_runs WHERE task_id = $1", [taskId]);
    await sql.unsafe("DELETE FROM tasks WHERE id = $1", [taskId]);
  }

  const nodeIds = Array.from(createdNodeIds);
  if (nodeIds.length > 0) {
    for (const nodeId of nodeIds) {
      await sql.unsafe(
        `WITH RECURSIVE descendants AS (
          SELECT id FROM project_tree_nodes WHERE id = $1
          UNION ALL
          SELECT child.id
          FROM project_tree_nodes child
          INNER JOIN descendants parent ON child.parent_id = parent.id
        )
        DELETE FROM project_tree_links
        WHERE source_node_id IN (SELECT id FROM descendants)
           OR target_node_id IN (SELECT id FROM descendants)`,
        [nodeId],
      );
      await sql.unsafe(
        `WITH RECURSIVE descendants AS (
          SELECT id FROM project_tree_nodes WHERE id = $1
          UNION ALL
          SELECT child.id
          FROM project_tree_nodes child
          INNER JOIN descendants parent ON child.parent_id = parent.id
        )
        DELETE FROM project_tree_branches
        WHERE task_node_id IN (SELECT id FROM descendants)
           OR head_node_id IN (SELECT id FROM descendants)`,
        [nodeId],
      );
      await sql.unsafe(
        `WITH RECURSIVE descendants AS (
          SELECT id FROM project_tree_nodes WHERE id = $1
          UNION ALL
          SELECT child.id
          FROM project_tree_nodes child
          INNER JOIN descendants parent ON child.parent_id = parent.id
        )
        DELETE FROM project_tree_nodes WHERE id IN (SELECT id FROM descendants)`,
        [nodeId],
      );
    }
  }

  await sql.end();
});

describe("task route registration smoke", () => {
  test("all split task route registrars remain wired", async () => {
    const unique = Date.now();
    const task = await createTask(`task-route-smoke-${unique}`);
    const runtimeSessionId = `task-route-smoke-session-${unique}`;
    const agentRunId = `task-route-smoke-run-${unique}`;

    const patchTask = await authedRequest<{ id: string; status: string }>(`/api/tasks/${task.id}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "running" }),
    });
    expect(patchTask.status).toBe(200);
    expect(patchTask.data.status).toBe("running");

    const branchResponse = await authedRequest<{ id: string }>(`/api/tasks/${task.id}/branches`, {
      method: "POST",
      body: JSON.stringify({
        runtimeSessionId,
        branchName: `branch-${unique}`,
        sourceType: "root",
        isActive: true,
      }),
    });
    expect(branchResponse.status).toBe(201);

    const branchMessage = await authedRequest<{ ok: boolean }>(
      `/api/tasks/${task.id}/branches/messages`,
      {
        method: "POST",
        body: JSON.stringify({
          runtimeSessionId,
          message: {
            id: `msg-${unique}`,
            role: "assistant",
            parts: [{ type: "text", text: `smoke text ${unique}` }],
          },
        }),
      },
    );
    expect([201, 202]).toContain(branchMessage.status);

    const branchCompatMessages = await authedRequest<{
      data: Array<{ id?: string; role?: string; parts?: Array<{ type?: string; text?: string }> }>;
      meta: { includeLineage: boolean; readSource?: string };
    }>(`/api/tasks/${task.id}/branches/${runtimeSessionId}/messages`);
    expect(branchCompatMessages.status).toBe(200);
    expect(branchCompatMessages.data.meta.includeLineage).toBe(false);
    expect(branchCompatMessages.data.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: `msg-${unique}`,
          role: "assistant",
          parts: expect.arrayContaining([
            expect.objectContaining({ type: "text", text: `smoke text ${unique}` }),
          ]),
        }),
      ]),
    );

    const branchCompatEvents = await authedRequest<{
      data: Array<{ eventType: string }>;
      meta: { includeLineage: boolean; eventCount: number };
    }>(`/api/tasks/${task.id}/branches/${runtimeSessionId}/events`);
    expect(branchCompatEvents.status).toBe(200);
    expect(branchCompatEvents.data.meta.includeLineage).toBe(false);
    expect(branchCompatEvents.data.meta.eventCount).toBeGreaterThan(0);

    const branchCompatTimeline = await authedRequest<{
      data: Array<{ id: string; sourceEventTypes: string[] }>;
      meta: { includeLineage: boolean; itemCount: number };
    }>(`/api/tasks/${task.id}/branches/${runtimeSessionId}/timeline`);
    expect(branchCompatTimeline.status).toBe(200);
    expect(branchCompatTimeline.data.meta.includeLineage).toBe(false);
    expect(branchCompatTimeline.data.meta.itemCount).toBeGreaterThan(0);
    expect(branchCompatTimeline.data.data[0]?.sourceEventTypes.length ?? 0).toBeGreaterThan(0);

    const createRun = await authedRequest<{ id: string; status: string }>(
      `/api/tasks/${task.id}/runs`,
      {
        method: "POST",
        body: JSON.stringify({
          id: agentRunId,
          sessionId: runtimeSessionId,
          agentType: "builder",
          status: "running",
        }),
      },
    );
    expect(createRun.status).toBe(201);
    createdAgentRunIds.push(agentRunId);

    const patchRun = await authedRequest<{ id: string; status: string }>(
      `/api/tasks/${task.id}/runs/${agentRunId}`,
      {
        method: "PATCH",
        body: JSON.stringify({
          status: "completed",
          result: `done ${unique}`,
        }),
      },
    );
    expect(patchRun.status).toBe(200);
    expect(patchRun.data.status).toBe("completed");

    const listRuns = await authedRequest<{ data: Array<{ id: string }> }>(
      `/api/tasks/${task.id}/runs`,
    );
    expect(listRuns.status).toBe(200);
    expect(listRuns.data.data).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: agentRunId })]),
    );

    const listDomainRuns = await authedRequest<{ data: Array<{ taskId: string }> }>(
      `/api/tasks/${task.id}/domain-runs`,
    );
    expect(listDomainRuns.status).toBe(200);
    expect(listDomainRuns.data.data.length).toBeGreaterThanOrEqual(1);

    const taskSnapshot = await authedRequest<{ data: { data: unknown } }>(
      `/api/tasks/${task.id}/snapshot`,
    );
    expect(taskSnapshot.status).toBe(200);

    const timelineView = await authedRequest<{
      data: unknown[];
      meta: { includeLineage: boolean };
    }>(`/api/tasks/${task.id}/timeline-view?runtimeSessionId=${runtimeSessionId}`);
    expect(timelineView.status).toBe(200);
    expect(timelineView.data.meta.includeLineage).toBe(true);

    const replayTask = await authedRequest<{ scope: string }>("/api/tasks/projections/replay", {
      method: "POST",
      body: JSON.stringify({
        scope: "task",
        taskId: task.id,
        reason: "verify task route registration smoke after modular split",
      }),
    });
    expect(replayTask.status).toBe(200);
    expect(replayTask.data.scope).toBe("task");

    const listSnapshots = await authedRequest<{ data: Array<{ taskId: string }> }>(
      `/api/tasks/snapshots?projectId=${PROJECT_ID}&limit=5`,
    );
    expect(listSnapshots.status).toBe(200);
    expect(listSnapshots.data.data).toEqual(
      expect.arrayContaining([expect.objectContaining({ taskId: task.id })]),
    );
  });
});
