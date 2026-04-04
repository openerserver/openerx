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

async function safeSql(query: string, params: unknown[] = []) {
  try {
    await sql.unsafe(query, params);
  } catch (error) {
    if ((error as { code?: string }).code !== "42P01") {
      throw error;
    }
  }
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
    await safeSql(
      `DELETE FROM task_session_message_parts WHERE message_id IN (
        SELECT id FROM task_session_messages WHERE task_id = $1
      )`,
      [taskId],
    );
    await safeSql("DELETE FROM task_session_messages WHERE task_id = $1", [taskId]);
    await safeSql("DELETE FROM session_operations WHERE task_id = $1", [taskId]);
    await safeSql("DELETE FROM task_artifacts WHERE task_id = $1", [taskId]);
    await safeSql("DELETE FROM task_usage_ledger_entries WHERE task_id = $1", [taskId]);
    await safeSql("DELETE FROM task_sessions WHERE task_id = $1", [taskId]);
    await safeSql("DELETE FROM task_timeline_views WHERE task_id = $1", [taskId]);
    await safeSql("DELETE FROM task_message_events WHERE task_id = $1", [taskId]);
    await safeSql("DELETE FROM task_domain_events WHERE task_id = $1", [taskId]);
    await safeSql(
      `DELETE FROM task_stage_runs WHERE workflow_run_id IN (
        SELECT id FROM task_workflow_runs WHERE task_id = $1
      )`,
      [taskId],
    );
    await safeSql("DELETE FROM task_workflow_runs WHERE task_id = $1", [taskId]);
    await safeSql(
      `DELETE FROM conversation_message_parts WHERE message_id IN (
        SELECT id FROM conversation_messages WHERE task_id = $1
      )`,
      [taskId],
    );
    await safeSql("DELETE FROM conversation_messages WHERE task_id = $1", [taskId]);
    await safeSql("DELETE FROM conversation_sessions WHERE task_id = $1", [taskId]);
    await safeSql("DELETE FROM task_snapshots WHERE task_id = $1", [taskId]);
    await safeSql("DELETE FROM task_run_edges WHERE task_id = $1", [taskId]);
    await safeSql("UPDATE agent_runs SET run_node_id = NULL, run_id = NULL WHERE task_id = $1", [
      taskId,
    ]);
    await safeSql("UPDATE task_run_nodes SET agent_run_id = NULL WHERE task_id = $1", [taskId]);
    await safeSql("DELETE FROM task_run_nodes WHERE task_id = $1", [taskId]);
    await safeSql("DELETE FROM agent_runs WHERE task_id = $1", [taskId]);
    await safeSql("DELETE FROM task_runs WHERE task_id = $1", [taskId]);
    await safeSql("DELETE FROM tasks WHERE id = $1", [taskId]);
  }

  const nodeIds = Array.from(createdNodeIds);
  if (nodeIds.length > 0) {
    const nodePlaceholders = nodeIds.map((_, index) => `$${index + 1}`).join(", ");
    await safeSql(
      `DELETE FROM conversation_sessions WHERE tree_node_id IN (${nodePlaceholders})`,
      nodeIds,
    );
    await safeSql(`DELETE FROM tasks WHERE tree_node_id IN (${nodePlaceholders})`, nodeIds);
    for (const nodeId of nodeIds) {
      await safeSql(
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
      await safeSql(
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
      await safeSql(
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
    const runtimeMessageId = `msg-${unique}`;

    const patchTask = await authedRequest<{ id: string; status: string }>(`/api/tasks/${task.id}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "running" }),
    });
    expect(patchTask.status).toBe(200);
    expect(patchTask.data.status).toBe("running");

    const sessionResponse = await authedRequest<{
      id: string;
      taskId: string;
      runtimeSessionId: string;
    }>(`/api/tasks/${task.id}/sessions`, {
      method: "POST",
      body: JSON.stringify({
        runtimeSessionId,
        branchName: `session-${unique}`,
        sourceType: "root",
        sessionKind: "sequential_step",
        executionModeSnapshot: "sequential_chain",
        isActive: true,
        stepIndex: 0,
        selectedModel: "gpt-5-mini",
      }),
    });
    expect(sessionResponse.status).toBe(201);
    expect(sessionResponse.data).toMatchObject({
      taskId: task.id,
      runtimeSessionId,
    });
    const sessionId = sessionResponse.data.id;
    const clientMessageId = `cli-${unique}`;

    const sessionMessage = await authedRequest<{
      ok: boolean;
      messageId: string;
      sessionId: string;
      seq: number;
    }>(
      `/api/tasks/${task.id}/sessions/messages`,
      {
        method: "POST",
        body: JSON.stringify({
          runtimeSessionId,
          message: {
            id: runtimeMessageId,
            role: "assistant",
            parts: [{ type: "text", text: `smoke text ${unique}` }],
          },
        }),
      },
    );
    expect(sessionMessage.status).toBe(201);
    expect(sessionMessage.data).toMatchObject({
      ok: true,
      sessionId,
      seq: 0,
    });

    const canonicalMessage = await authedRequest<{
      task_id: string;
      session_id: string;
      user_message: {
        id: string;
        client_message_id?: string;
        role: string;
        status: string;
        text: string | null;
      };
      assistant_message: {
        id: string;
        role: string;
        status: string;
        text?: string | null;
      };
      operation: {
        id: string;
        kind: string;
        status: string;
      };
    }>(`/api/tasks/${task.id}/sessions/${encodeURIComponent(sessionId)}/messages`, {
      method: "POST",
      body: JSON.stringify({
        client_message_id: clientMessageId,
        text: `user prompt ${unique}`,
        attachments: [],
      }),
    });
    expect(canonicalMessage.status).toBe(201);
    expect(canonicalMessage.data).toMatchObject({
      task_id: task.id,
      session_id: sessionId,
      user_message: {
        client_message_id: clientMessageId,
        role: "user",
        status: "completed",
        text: `user prompt ${unique}`,
      },
      assistant_message: {
        role: "assistant",
        status: "pending",
        text: null,
      },
      operation: {
        kind: "model_request",
        status: "queued",
      },
    });

    const canonicalMessageReplay = await authedRequest<{
      task_id: string;
      session_id: string;
      user_message: { id: string };
      assistant_message: { id: string };
      operation: { id: string };
    }>(`/api/tasks/${task.id}/sessions/${encodeURIComponent(sessionId)}/messages`, {
      method: "POST",
      body: JSON.stringify({
        client_message_id: clientMessageId,
        text: `user prompt ${unique}`,
        attachments: [],
      }),
    });
    expect(canonicalMessageReplay.status).toBe(200);
    expect(canonicalMessageReplay.data).toMatchObject({
      task_id: task.id,
      session_id: sessionId,
      user_message: {
        id: canonicalMessage.data.user_message.id,
      },
      assistant_message: {
        id: canonicalMessage.data.assistant_message.id,
      },
      operation: {
        id: canonicalMessage.data.operation.id,
      },
    });

    const sessionsList = await authedRequest<{
      data: Array<{ id: string; runtimeSessionId: string | null; branchName: string | null }>;
      meta: { readSource: string; sessionCount: number };
    }>(`/api/tasks/${task.id}/sessions`);
    expect(sessionsList.status).toBe(200);
    expect(sessionsList.data.meta).toMatchObject({
      readSource: "task-session-first",
      sessionCount: 1,
    });
    expect(sessionsList.data.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: sessionId,
          runtimeSessionId,
          branchName: `session-${unique}`,
          sessionKind: "sequential_step",
          executionModeSnapshot: "sequential_chain",
          stepIndex: 0,
          selectedModel: "gpt-5-mini",
        }),
      ]),
    );

    const sessionDetail = await authedRequest<{
      data: { id: string; runtimeSessionId: string | null; branchName: string | null };
      meta: { readSource: string; lineagePath: string[]; isCurrent: boolean; isLatest: boolean };
    }>(`/api/tasks/${task.id}/sessions/${encodeURIComponent(sessionId)}`);
    expect(sessionDetail.status).toBe(200);
    expect(sessionDetail.data.data).toMatchObject({
      id: sessionId,
      runtimeSessionId,
      branchName: `session-${unique}`,
      sessionKind: "sequential_step",
      executionModeSnapshot: "sequential_chain",
      stepIndex: 0,
      selectedModel: "gpt-5-mini",
    });
    expect(sessionDetail.data.meta).toMatchObject({
      readSource: "task-session-first",
      lineagePath: [sessionId],
      isLatest: true,
    });

    const storedMessages = await authedRequest<{
      error: string;
    }>(`/api/tasks/${task.id}/sessions/${encodeURIComponent(sessionId)}/messages`);
    expect(storedMessages.status).toBe(410);
    expect(storedMessages.data).toEqual(
      expect.objectContaining({
        error: expect.stringContaining("Deprecated route"),
      }),
    );

    const taskConversationMessages = await authedRequest<{
      error: string;
    }>(`/api/tasks/${task.id}/messages`);
    expect(taskConversationMessages.status).toBe(410);
    expect(taskConversationMessages.data).toEqual(
      expect.objectContaining({
        error: expect.stringContaining("Deprecated route"),
      }),
    );

    const taskTree = await authedRequest<{
      meta: { taskId: string; currentSessionId: string | null };
      sessions: Array<{ id: string }>;
      messages: Array<{
        runtimeMessageId: string;
        role: string;
        textContent?: string | null;
        clientMessageId?: string | null;
        status?: string | null;
      }>;
      messageParts: Array<{ partType: string; textContent: string | null }>;
    }>(`/api/tasks/${task.id}/tree?sessionId=${encodeURIComponent(sessionId)}&includeLineage=false`);
    expect(taskTree.status).toBe(200);
    expect(taskTree.data.meta).toMatchObject({
      taskId: task.id,
      currentSessionId: sessionId,
    });
    expect(taskTree.data.sessions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: sessionId,
        }),
      ]),
    );
    expect(taskTree.data.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          runtimeMessageId,
          role: "assistant",
          textContent: `smoke text ${unique}`,
        }),
        expect.objectContaining({
          runtimeMessageId: `user:${clientMessageId}`,
          role: "user",
          clientMessageId,
          textContent: `user prompt ${unique}`,
        }),
        expect.objectContaining({
          runtimeMessageId: `assistant:${clientMessageId}`,
          role: "assistant",
          status: "pending",
        }),
      ]),
    );
    expect(taskTree.data.messageParts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ partType: "text", textContent: `smoke text ${unique}` }),
      ]),
    );

    const operations = await authedRequest<{
      data: unknown[];
      meta: { readSource: string; sessionId: string; operationCount: number };
    }>(`/api/tasks/${task.id}/sessions/${encodeURIComponent(sessionId)}/operations`);
    expect(operations.status).toBe(200);
    expect(operations.data.meta).toMatchObject({
      readSource: "task-session-first",
      sessionId,
      operationCount: 1,
    });
    expect(operations.data.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: canonicalMessage.data.operation.id,
          executionStatus: "queued",
          operationKind: "executor",
        }),
      ]),
    );

    const artifacts = await authedRequest<{
      data: unknown[];
      meta: { readSource: string; sessionId: string; artifactCount: number };
    }>(`/api/tasks/${task.id}/sessions/${encodeURIComponent(sessionId)}/artifacts`);
    expect(artifacts.status).toBe(200);
    expect(artifacts.data.meta).toMatchObject({
      readSource: "task-session-first",
      sessionId,
      artifactCount: 0,
    });

    const usageLedger = await authedRequest<{
      data: unknown[];
      meta: { readSource: string; sessionId: string | null; entryCount: number };
    }>(`/api/tasks/${task.id}/sessions/${encodeURIComponent(sessionId)}/usage-ledger`);
    expect(usageLedger.status).toBe(200);
    expect(usageLedger.data.meta).toMatchObject({
      readSource: "task-session-first",
      sessionId,
      entryCount: 0,
    });

    const sessionTimeline = await authedRequest<{
      data: unknown[];
      meta: { readSource: string; sessionId: string | null; includeLineage: boolean; itemCount: number };
    }>(`/api/tasks/${task.id}/sessions/${encodeURIComponent(sessionId)}/timeline?includeLineage=false`);
    expect(sessionTimeline.status).toBe(200);
    expect(sessionTimeline.data.meta).toMatchObject({
      readSource: "task-session-projection",
      sessionId,
      includeLineage: false,
    });

    const createRun = await authedRequest<{ id: string; status: string }>(
      `/api/tasks/${task.id}/runs`,
      {
        method: "POST",
        body: JSON.stringify({
          id: agentRunId,
          sessionId,
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

    const taskSnapshot = await authedRequest<{ data: { data: unknown } }>(
      `/api/tasks/${task.id}/snapshot`,
    );
    expect(taskSnapshot.status).toBe(200);

    const timelineView = await authedRequest<{
      data: unknown[];
      meta: { readSource: string; includeLineage: boolean; lineagePath: string[] };
    }>(`/api/tasks/${task.id}/timeline-view?sessionId=${encodeURIComponent(sessionId)}`);
    expect(timelineView.status).toBe(200);
    expect(timelineView.data.meta).toMatchObject({
      readSource: "task-session-projection",
      includeLineage: true,
      lineagePath: [sessionId],
    });

    const executionTrace = await authedRequest<{
      data: {
        selectedSessionId: string | null;
        sessions: Array<{ id: string }>;
        messages: Array<{ runtimeMessageId?: string }>;
      };
      meta: { readSource: string; timelineReadSource: string; includeLineage: boolean; sessionCount: number };
    }>(`/api/tasks/${task.id}/execution-trace?sessionId=${encodeURIComponent(sessionId)}`);
    expect(executionTrace.status).toBe(200);
    expect(executionTrace.data.meta).toMatchObject({
      readSource: "task-session-first",
      timelineReadSource: "task-session-projection",
      includeLineage: true,
      sessionCount: 1,
    });
    expect(executionTrace.data.data.selectedSessionId).toBe(sessionId);
    expect(executionTrace.data.data.sessions).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: sessionId })]),
    );
    expect(executionTrace.data.data.messages).toEqual(
      expect.arrayContaining([expect.objectContaining({ runtimeMessageId })]),
    );

    const listSnapshots = await authedRequest<{ data: Array<{ taskId: string }> }>(
      `/api/tasks/snapshots?projectId=${PROJECT_ID}&limit=5`,
    );
    expect(listSnapshots.status).toBe(200);
    expect(listSnapshots.data.data).toEqual(
      expect.arrayContaining([expect.objectContaining({ taskId: task.id })]),
    );
  });
});
