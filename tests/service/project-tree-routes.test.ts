import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import postgres from "../../control-plane/service/node_modules/postgres";
import { assertSessionNodeLineageOnlyContentJson } from "./task-route-test-helpers";

const CP_URL = process.env.TEST_CP_URL || "http://127.0.0.1:4097";
const PROJECT_ID = process.env.TEST_PROJECT_ID || "proj-default";
const USERNAME = process.env.TEST_USERNAME || "admin";
const PASSWORD = process.env.TEST_PASSWORD || "admin123!";
const rawDatabaseUrl = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL || "";
const DATABASE_URL = /^(postgres|postgresql):\/\//i.test(rawDatabaseUrl)
  ? rawDatabaseUrl
  : "postgres://127.0.0.1:5432/openerx";
const PROJECT_ROOT_NODE_ID = `project_root:${PROJECT_ID}`;

const sql = postgres(DATABASE_URL, { max: 1, prepare: false });

const createdTaskIds: string[] = [];
const createdNodeIds = new Set<string>();
const createdLinkIds: string[] = [];
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

function escapeLiteral(value: string) {
  return `'${value.replace(/'/g, "''")}'`;
}

function taskBranchCompatNodeId(taskId: string, runtimeSessionId: string) {
  return `branch-node:${taskId}:${runtimeSessionId}`;
}

function taskSessionId(taskId: string, runtimeSessionId: string) {
  return `task-session:${taskId}:${runtimeSessionId}`;
}

function buildNormalizedConversationPath(
  taskId: string,
  options: {
    sessionId?: string | null;
    includeLineage?: boolean;
  } = {},
) {
  const query = new URLSearchParams();
  if (options.sessionId) {
    query.set("sessionId", options.sessionId);
  }
  if (typeof options.includeLineage === "boolean") {
    query.set("includeLineage", String(options.includeLineage));
  }

  const queryString = query.toString();
  return `/api/tasks/${taskId}/query/normalized-conversation${queryString ? `?${queryString}` : ""}`;
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

async function queryNormalizedConversation<T>(
  taskId: string,
  options: {
    sessionId?: string | null;
    includeLineage?: boolean;
  } = {},
) {
  return authedRequest<T>(buildNormalizedConversationPath(taskId, options));
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
    await sql.unsafe("DELETE FROM task_usage_ledger_entries WHERE task_id = $1", [taskId]);
    await sql.unsafe("DELETE FROM task_artifacts WHERE task_id = $1", [taskId]);
    await sql.unsafe("DELETE FROM task_operations WHERE task_id = $1", [taskId]);
    await safeSql("UPDATE task_snapshots SET current_session_id = NULL WHERE task_id = $1", [
      taskId,
    ]);
    await sql.unsafe("DELETE FROM task_snapshots WHERE task_id = $1", [taskId]);
    await safeSql(
      "UPDATE task_sessions SET status = 'archived', archived_at = COALESCE(archived_at, CURRENT_TIMESTAMP), source_message_id = NULL, head_message_id = NULL, latest_run_id = NULL, winner_session_id = NULL, judge_session_id = NULL WHERE task_id = $1",
      [taskId],
    );
    await safeSql(
      `DELETE FROM task_message_parts WHERE message_id IN (
        SELECT id FROM task_messages WHERE task_id = $1
      )`,
      [taskId],
    );
    await safeSql("DELETE FROM task_messages WHERE task_id = $1", [taskId]);
    await safeSql("DELETE FROM task_session_runs WHERE task_id = $1", [taskId]);
    await sql.unsafe("DELETE FROM task_sessions WHERE task_id = $1", [taskId]);
    await sql.unsafe("DELETE FROM task_domain_events WHERE task_id = $1", [taskId]);
    await safeSql("DELETE FROM task_run_edges WHERE task_id = $1", [taskId]);
    await sql.unsafe(
      `DELETE FROM task_stage_runs
        WHERE workflow_run_id IN (
          SELECT id FROM task_workflow_runs WHERE task_id = $1
        )`,
      [taskId],
    );
    await sql.unsafe("DELETE FROM task_workflow_runs WHERE task_id = $1", [taskId]);
    await sql.unsafe("DELETE FROM task_operating_modes WHERE task_id = $1", [taskId]);
    await sql.unsafe("DELETE FROM boss_decisions WHERE task_id = $1", [taskId]);
    await sql.unsafe("DELETE FROM human_escalations WHERE task_id = $1", [taskId]);
    await sql.unsafe("DELETE FROM developer_change_requests WHERE task_id = $1", [taskId]);
    await sql.unsafe("DELETE FROM role_aggregate_conclusions WHERE task_id = $1", [taskId]);
    await sql.unsafe("DELETE FROM runtime_usage_ledger_steps WHERE task_id = $1", [taskId]);
    await sql.unsafe("DELETE FROM runtime_usage_ledgers WHERE task_id = $1", [taskId]);
    await sql.unsafe(
      `DELETE FROM file_changes
        WHERE change_id IN (
          SELECT id FROM code_changes WHERE task_id = $1
        )`,
      [taskId],
    );
    await sql.unsafe("DELETE FROM code_changes WHERE task_id = $1", [taskId]);
    await safeSql("UPDATE task_run_nodes SET agent_run_id = NULL WHERE task_id = $1", [taskId]);
    await safeSql("DELETE FROM task_run_nodes WHERE task_id = $1", [taskId]);
    await safeSql("DELETE FROM task_runs WHERE task_id = $1", [taskId]);
    await sql.unsafe("DELETE FROM tasks WHERE id = $1", [taskId]);
  }

  const nodeIds = Array.from(createdNodeIds);
  if (createdLinkIds.length > 0) {
    await sql.unsafe(
      `DELETE FROM project_tree_links WHERE id IN (${createdLinkIds.map(escapeLiteral).join(", ")})`,
    );
  }

  if (nodeIds.length > 0) {
    const nodeList = nodeIds.map(escapeLiteral).join(", ");
    await sql.unsafe(`DELETE FROM task_sessions WHERE tree_node_id IN (${nodeList})`);
    await sql.unsafe(`DELETE FROM tasks WHERE tree_node_id IN (${nodeList})`);
    await sql.unsafe(
      `UPDATE project_tree_nodes
          SET parent_id = NULL,
              superseded_by = NULL
        WHERE parent_id IN (${nodeList})
           OR superseded_by IN (${nodeList})`,
    );
    await sql.unsafe(
      `DELETE FROM project_tree_links WHERE source_node_id IN (${nodeList}) OR target_node_id IN (${nodeList})`,
    );
    await sql.unsafe(
      `DELETE FROM project_tree_branches WHERE task_node_id IN (${nodeList}) OR head_node_id IN (${nodeList})`,
    );
    await sql.unsafe(`DELETE FROM project_tree_nodes WHERE id IN (${nodeList})`);
  }

  await sql.end();
});

describe("project tree routes", () => {
  test("supports ancestors lookup and link deletion", async () => {
    const task = await createTask(`tree-links-${Date.now()}`);

    const contextNode = await authedRequest<{
      id: string;
      nodeType: string;
      createdAt: string;
      updatedAt: string;
      archivedAt: string | null;
    }>(
      `/api/projects/${PROJECT_ID}/tree/${PROJECT_ROOT_NODE_ID}/children`,
      {
        method: "POST",
        body: JSON.stringify({
          nodeType: "context",
          contentText: "context for ancestors",
          contentJson: { source: "project-tree-routes-test" },
        }),
      },
    );

    expect(contextNode.status).toBe(201);
    createdNodeIds.add(contextNode.data.id);
  expect(contextNode.data.createdAt).toMatch(/Z$/);
  expect(contextNode.data.updatedAt).toMatch(/Z$/);
  expect(contextNode.data.archivedAt).toBeNull();

    const ancestors = await authedRequest<{ data: Array<{ id: string }> }>(
      `/api/projects/${PROJECT_ID}/tree/${contextNode.data.id}/ancestors`,
    );

    expect(ancestors.status).toBe(200);
    expect(ancestors.data.data.map((node) => node.id)).toEqual([
      PROJECT_ROOT_NODE_ID,
      contextNode.data.id,
    ]);

    const createdLink = await authedRequest<{
      id: string;
      sourceNodeId: string;
      targetNodeId: string;
      createdAt: string;
    }>(`/api/projects/${PROJECT_ID}/tree/${task.nodeId}/links`, {
      method: "POST",
      body: JSON.stringify({
        targetNodeId: contextNode.data.id,
        linkType: "cites",
        metadata: { source: "project-tree-routes-test" },
      }),
    });

    expect(createdLink.status).toBe(201);
    createdLinkIds.push(createdLink.data.id);
    expect(createdLink.data.createdAt).toMatch(/Z$/);

    const taskLinks = await authedRequest<{
      data: Array<{ id: string; direction: string; targetNodeId: string; createdAt: string }>;
    }>(`/api/projects/${PROJECT_ID}/tree/${task.nodeId}/links`);

    expect(taskLinks.status).toBe(200);
    expect(taskLinks.data.data).toContainEqual(
      expect.objectContaining({
        id: createdLink.data.id,
        createdAt: expect.stringMatching(/Z$/),
        direction: "outgoing",
        targetNodeId: contextNode.data.id,
      }),
    );

    const deleted = await authedRequest<{ ok: boolean }>(
      `/api/projects/${PROJECT_ID}/links/${createdLink.data.id}`,
      { method: "DELETE" },
    );

    expect(deleted.status).toBe(200);
    expect(deleted.data.ok).toBe(true);

    const linksAfterDelete = await authedRequest<{
      data: Array<{ id: string }>;
    }>(`/api/projects/${PROJECT_ID}/tree/${task.nodeId}/links`);

    expect(linksAfterDelete.status).toBe(200);
    expect(linksAfterDelete.data.data.some((link) => link.id === createdLink.data.id)).toBe(false);
  });

  test("supports project-level tree search across context nodes and persisted message snapshots", async () => {
    const task = await createTask(`tree-search-${Date.now()}`);
    const runtimeSessionId = `ses_search_${Date.now()}`;
    const sessionNodeId = taskBranchCompatNodeId(task.id, runtimeSessionId);

    createdNodeIds.add(sessionNodeId);

    const contextNode = await authedRequest<{ id: string }>(
      `/api/projects/${PROJECT_ID}/tree/${PROJECT_ROOT_NODE_ID}/children`,
      {
        method: "POST",
        body: JSON.stringify({
          nodeType: "context",
          contentText: "Rollback checklist for production migration verification",
          contentJson: { source: "tree-search-test" },
        }),
      },
    );

    expect(contextNode.status).toBe(201);
    createdNodeIds.add(contextNode.data.id);

    const createdSession = await authedRequest<{ id: string }>(`/api/tasks/${task.id}/sessions`, {
      method: "POST",
      body: JSON.stringify({
        runtimeSessionId,
        branchName: "search-main",
        sourceType: "root",
        isActive: true,
      }),
    });

    expect(createdSession.status).toBe(201);

    const persisted = await authedRequest<{ ok: boolean }>(
      `/api/tasks/${task.id}/sessions/messages`,
      {
        method: "POST",
        body: JSON.stringify({
          runtimeSessionId,
          message: {
            info: { id: "msg-search-1", role: "assistant" },
            parts: [{ type: "text", text: "Rollback migration now and verify the final state." }],
          },
        }),
      },
    );

    expect(persisted.status).toBe(201);
    expect(persisted.data.ok).toBe(true);

    const childNodes = await authedRequest<{
      data: Array<{
        id: string;
        nodeType: string;
        contentText: string | null;
      }>;
    }>(`/api/projects/${PROJECT_ID}/tree/${PROJECT_ROOT_NODE_ID}/children`);

    expect(childNodes.status).toBe(200);
    expect(childNodes.data.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: contextNode.data.id,
          nodeType: "context",
          contentText: "Rollback checklist for production migration verification",
        }),
      ]),
    );

    const sessionMessages = await queryNormalizedConversation<{
      data: Array<{
        runtimeMessageId?: string | null;
        role?: string;
        textContent?: string | null;
        parts?: Array<{ partType?: string; textContent?: string | null }>;
      }>;
      meta: {
        readSource: string;
        sessionId: string;
        messageCount: number;
      };
    }>(task.id, { sessionId: taskSessionId(task.id, runtimeSessionId) });

    expect(sessionMessages.status).toBe(200);
    expect(sessionMessages.data.meta).toEqual(
      expect.objectContaining({
        readSource: "task-session-first",
        sessionId: taskSessionId(task.id, runtimeSessionId),
        messageCount: 1,
      }),
    );
    expect(sessionMessages.data.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          runtimeMessageId: "msg-search-1",
          role: "assistant",
          textContent: "Rollback migration now and verify the final state.",
          parts: expect.arrayContaining([
            expect.objectContaining({
              partType: "text",
              textContent: "Rollback migration now and verify the final state.",
            }),
          ]),
        }),
      ]),
    );
  });

  test("supports session-level timeline feed in chronological order", async () => {
    const task = await createTask(`tree-events-feed-${Date.now()}`);
    const runtimeSessionId = `ses_events_feed_${Date.now()}`;
    const sessionNodeId = taskBranchCompatNodeId(task.id, runtimeSessionId);
    const sessionRecordId = taskSessionId(task.id, runtimeSessionId);

    createdNodeIds.add(sessionNodeId);

    const createdSession = await authedRequest<{ id: string }>(`/api/tasks/${task.id}/sessions`, {
      method: "POST",
      body: JSON.stringify({
        runtimeSessionId,
        branchName: "events-feed-main",
        sourceType: "root",
        isActive: true,
      }),
    });

    expect(createdSession.status).toBe(201);

    for (const [messageId, text] of [
      ["msg-feed-1", "first incremental event payload"],
      ["msg-feed-2", "second incremental event payload"],
    ] as const) {
      const persisted = await authedRequest<{ ok: boolean }>(
        `/api/tasks/${task.id}/sessions/messages`,
        {
          method: "POST",
          body: JSON.stringify({
            runtimeSessionId,
            message: {
              info: { id: messageId, role: "assistant" },
              parts: [{ type: "text", text }],
            },
          }),
        },
      );

      expect(persisted.status).toBe(201);
      expect(persisted.data.ok).toBe(true);
    }

    const events = await authedRequest<{
      data: Array<{
        sessionId: string | null;
        messageId: string | null;
        itemKind: string;
        itemRole: string | null;
        displayText: string | null;
      }>;
      meta: {
        includeLineage: boolean;
        readSource: string;
        lineagePath: string[];
        itemCount: number;
        complete: boolean;
      };
    }>(`/api/tasks/${task.id}/sessions/${sessionRecordId}/timeline?includeLineage=false`);

    expect(events.status).toBe(200);
    expect(events.data.meta).toEqual(
      expect.objectContaining({
        includeLineage: false,
        readSource: "task-session-projection",
        lineagePath: [sessionRecordId],
        itemCount: 2,
        complete: true,
      }),
    );
    expect(events.data.data).toHaveLength(2);
    expect(events.data.data.map((item) => item.itemKind)).toEqual(["message", "message"]);
    expect(events.data.data.map((item) => item.itemRole)).toEqual(["assistant", "assistant"]);
    expect(events.data.data.map((item) => item.displayText)).toEqual([
      "first incremental event payload",
      "second incremental event payload",
    ]);
  });
  test("syncs task patch updates into the task tree node", async () => {
    const task = await createTask(`tree-task-sync-${Date.now()}`);

    const patched = await authedRequest<{
      id: string;
      status: string;
      sessionId: string;
      selectedModel: string;
      executionMode: string;
      workingBranch: string;
      result: string;
    }>(`/api/tasks/${task.id}`, {
      method: "PATCH",
      body: JSON.stringify({
        status: "running",
        sessionId: "ses_task_sync_runtime",
        selectedModel: "github-copilot:gpt-5.4",
        executionMode: "parallel",
        workingBranch: "feature/tree-sync",
        result: "task node should mirror latest task state",
      }),
    });

    expect(patched.status).toBe(200);
    expect(patched.data).toMatchObject({
      id: task.id,
      status: "running",
      sessionId: "ses_task_sync_runtime",
      selectedModel: "github-copilot:gpt-5.4",
      executionMode: "parallel",
      workingBranch: "feature/tree-sync",
      result: "task node should mirror latest task state",
    });

    const taskNode = await authedRequest<{
      id: string;
      contentText: string | null;
      runtimeSessionId: string | null;
      branchName: string | null;
      contentJson?: Record<string, unknown> | null;
    }>(`/api/projects/${PROJECT_ID}/tree/${task.nodeId}`);

    expect(taskNode.status).toBe(200);
    expect(taskNode.data.id).toBe(task.id);
    expect(taskNode.data.contentText).toContain("tree-task-sync-");
    expect(taskNode.data.runtimeSessionId).toBe("ses_task_sync_runtime");
    expect(taskNode.data.branchName).toBe("feature/tree-sync");
    expect(taskNode.data.contentJson).toEqual({});
    expect(taskNode.data.contentJson).not.toHaveProperty("executionMode");
    expect(taskNode.data.contentJson).not.toHaveProperty("autoAdvanceStages");
    expect(taskNode.data.contentJson).not.toHaveProperty("gitCommitterName");
    expect(taskNode.data.contentJson).not.toHaveProperty("gitCommitterEmail");
    expect(taskNode.data.contentJson).not.toHaveProperty("status");
    expect(taskNode.data.contentJson).not.toHaveProperty("sessionId");
    expect(taskNode.data.contentJson).not.toHaveProperty("selectedModel");
    expect(taskNode.data.contentJson).not.toHaveProperty("workingBranch");
    expect(taskNode.data.contentJson).not.toHaveProperty("result");
    expect(taskNode.data.contentJson).not.toHaveProperty("executionPlan");
    expect(taskNode.data.contentJson).not.toHaveProperty("parallelRunHistory");
  });

  test("keeps task reads and writes alive without any legacy task mirror", async () => {
    const task = await createTask(`tree-primary-task-${Date.now()}`);

    const fetched = await authedRequest<{
      id: string;
      title: string;
      status: string;
    }>(`/api/project-tree/tasks/${task.id}`);

    expect(fetched.status).toBe(200);
    expect(fetched.data.id).toBe(task.id);
    expect(fetched.data.title).toContain("tree-primary-task-");
    expect(fetched.data.status).toBe("pending");

    const patched = await authedRequest<{
      id: string;
      status: string;
      sessionId: string;
      workingBranch: string;
    }>(`/api/tasks/${task.id}`, {
      method: "PATCH",
      body: JSON.stringify({
        status: "running",
        sessionId: "ses_primary_tree_task",
        workingBranch: "feature/tree-primary-task",
      }),
    });

    expect(patched.status).toBe(200);
    expect(patched.data).toMatchObject({
      id: task.id,
      status: "running",
      sessionId: "ses_primary_tree_task",
      workingBranch: "feature/tree-primary-task",
    });

    const taskNode = await authedRequest<{
      id: string;
      runtimeSessionId: string | null;
      branchName: string | null;
      contentJson?: Record<string, unknown> | null;
    }>(`/api/projects/${PROJECT_ID}/tree/${task.id}`);

    expect(taskNode.status).toBe(200);
    expect(taskNode.data.runtimeSessionId).toBe("ses_primary_tree_task");
    expect(taskNode.data.branchName).toBe("feature/tree-primary-task");
    expect(taskNode.data.contentJson).toEqual({});
    expect(taskNode.data.contentJson).not.toHaveProperty("status");
    expect(taskNode.data.contentJson).not.toHaveProperty("sessionId");
    expect(taskNode.data.contentJson).not.toHaveProperty("workingBranch");
  });

  test("reads task detail and filtered lists from task aggregates when tree payload is stale", async () => {
    const task = await createTask(`tree-aggregate-read-${Date.now()}`);

    const patched = await authedRequest<{
      id: string;
      status: string;
      sessionId: string;
      executionMode: string;
      workingBranch: string;
      result: string;
    }>(`/api/tasks/${task.id}`, {
      method: "PATCH",
      body: JSON.stringify({
        status: "running",
        sessionId: "ses_tree_aggregate_read",
        executionMode: "parallel",
        workingBranch: "feature/tree-aggregate-read",
        result: "aggregate-backed result",
        executionPlan: JSON.stringify({ mode: "parallel", candidates: [] }),
        parallelRunHistory: JSON.stringify([{ parallelRunId: "legacy-run-aggregate" }]),
      }),
    });

    expect(patched.status).toBe(200);

    await sql.unsafe(
      `UPDATE project_tree_nodes
       SET content_json = jsonb_set(
         jsonb_set(
           jsonb_set(
             jsonb_set(coalesce(content_json, '{}'::jsonb), '{status}', '"pending"'::jsonb, true),
             '{workingBranch}', '"feature/tree-stale"'::jsonb, true
           ),
           '{executionMode}', '"single"'::jsonb, true
         ),
         '{result}', '"stale tree result"'::jsonb, true
       )
       WHERE id = $1`,
      [task.id],
    );

    const detail = await authedRequest<{
      id: string;
      status: string;
      sessionId: string | null;
      executionMode: string | null;
      orchestrationKind: string | null;
      workingBranch: string | null;
      result: string | null;
    }>(`/api/project-tree/tasks/${task.id}`);

    expect(detail.status).toBe(200);
    expect(detail.data).toMatchObject({
      id: task.id,
      status: "running",
      sessionId: "ses_tree_aggregate_read",
      executionMode: "parallel",
      orchestrationKind: "parallel",
      workingBranch: "feature/tree-aggregate-read",
      result: "aggregate-backed result",
    });
    expect(detail.data).not.toHaveProperty("executionPlan");
    expect(detail.data).not.toHaveProperty("parallelRunHistory");

    const filtered = await authedRequest<{
      data: Array<{
        id: string;
        status: string;
        executionMode: string | null;
        orchestrationKind: string | null;
        workingBranch: string | null;
        result: string | null;
      }>;
    }>(`/api/project-tree/tasks?projectId=${PROJECT_ID}&status=running`);

    expect(filtered.status).toBe(200);
    expect(filtered.data.data).toContainEqual(
      expect.objectContaining({
        id: task.id,
        status: "running",
        executionMode: "parallel",
        orchestrationKind: "parallel",
        workingBranch: "feature/tree-aggregate-read",
        result: "aggregate-backed result",
      }),
    );
    const filteredTask = filtered.data.data.find((entry) => entry.id === task.id);
    expect(filteredTask).toBeDefined();
    expect(filteredTask).not.toHaveProperty("executionPlan");
    expect(filteredTask).not.toHaveProperty("parallelRunHistory");
  });

  test("does not recover execution fields from legacy aggregate strategy json", async () => {
    const task = await createTask(`tree-strategy-compat-${Date.now()}`);

    await sql.unsafe(
      `UPDATE tasks
       SET strategy_json = '{"executionMode":"parallel","autoAdvanceStages":true}'::jsonb
       WHERE id = $1`,
      [task.id],
    );

    const detail = await authedRequest<{
      id: string;
      status: string;
      executionMode: string | null;
      autoAdvanceStages: boolean;
      orchestrationKind: string | null;
      strategy: Record<string, unknown> | null;
    }>(`/api/project-tree/tasks/${task.id}`);

    expect(detail.status).toBe(200);
    expect(detail.data).toMatchObject({
      id: task.id,
      status: "pending",
      executionMode: null,
      autoAdvanceStages: false,
      orchestrationKind: null,
      strategy: {
        executionMode: "parallel",
        autoAdvanceStages: true,
      },
    });

    const filtered = await authedRequest<{
      data: Array<{
        id: string;
        executionMode: string | null;
        autoAdvanceStages: boolean;
        orchestrationKind: string | null;
      }>;
    }>(`/api/project-tree/tasks?projectId=${PROJECT_ID}&status=pending`);

    expect(filtered.status).toBe(200);
    expect(filtered.data.data).toContainEqual(
      expect.objectContaining({
        id: task.id,
        executionMode: null,
        autoAdvanceStages: false,
        orchestrationKind: null,
      }),
    );
  });

  test("syncs session activate and archive to project tree nodes", async () => {
    const task = await createTask(`tree-sessions-${Date.now()}`);
    const rootRuntimeSessionId = `ses_root_${Date.now()}`;
    const forkRuntimeSessionId = `ses_fork_${Date.now()}`;
    const rootSessionRecordId = taskSessionId(task.id, rootRuntimeSessionId);
    const forkSessionRecordId = taskSessionId(task.id, forkRuntimeSessionId);
    const rootSessionNodeId = taskBranchCompatNodeId(task.id, rootRuntimeSessionId);
    const forkSessionNodeId = taskBranchCompatNodeId(task.id, forkRuntimeSessionId);

    createdNodeIds.add(rootSessionNodeId);
    createdNodeIds.add(forkSessionNodeId);

    const rootSession = await authedRequest<{ id: string; runtimeSessionId: string }>(
      `/api/tasks/${task.id}/sessions`,
      {
        method: "POST",
        body: JSON.stringify({
          runtimeSessionId: rootRuntimeSessionId,
          branchName: "main-root",
          sourceType: "root",
          isActive: true,
        }),
      },
    );

    expect(rootSession.status).toBe(201);

    const forkSession = await authedRequest<{ id: string; runtimeSessionId: string }>(
      `/api/tasks/${task.id}/sessions`,
      {
        method: "POST",
        body: JSON.stringify({
          runtimeSessionId: forkRuntimeSessionId,
          parentRuntimeSessionId: rootRuntimeSessionId,
          branchName: "branch-fork",
          sourceType: "fork",
          isActive: false,
        }),
      },
    );

    expect(forkSession.status).toBe(201);

    const activateFork = await authedRequest<{ ok: boolean; activatedSessionId: string }>(
      `/api/tasks/${task.id}/sessions/${forkSessionRecordId}/activate`,
      { method: "POST" },
    );

    expect(activateFork.status).toBe(200);
    expect(activateFork.data.activatedSessionId).toBe(forkRuntimeSessionId);

    const archiveRoot = await authedRequest<{ ok: boolean }>(
      `/api/tasks/${task.id}/sessions/${rootSessionRecordId}/archive`,
      { method: "POST" },
    );

    expect(archiveRoot.status).toBe(200);
    expect(archiveRoot.data.ok).toBe(true);

    const sessions = await authedRequest<{
      data: Array<{
        id: string;
        runtimeSessionId: string;
        executionStatus: string;
        archivedAt: string | null;
      }>;
    }>(`/api/tasks/${task.id}/sessions`);

    expect(sessions.status).toBe(200);
    expect(sessions.data.data).toContainEqual(
      expect.objectContaining({
        id: rootSessionRecordId,
        runtimeSessionId: rootRuntimeSessionId,
      }),
    );
    expect(sessions.data.data).toContainEqual(
      expect.objectContaining({
        id: forkSessionRecordId,
        runtimeSessionId: forkRuntimeSessionId,
      }),
    );
    expect(sessions.data.data).toContainEqual(
      expect.objectContaining({
        runtimeSessionId: rootRuntimeSessionId,
        executionStatus: "cancelled",
        archivedAt: expect.any(String),
      }),
    );
    expect(sessions.data.data).toContainEqual(
      expect.objectContaining({
        runtimeSessionId: forkRuntimeSessionId,
        executionStatus: "running",
        archivedAt: null,
      }),
    );

    const rootNode = await authedRequest<{
      id: string;
      isActive: boolean;
      archivedAt: string | null;
      parentId: string | null;
      contentJson?: Record<string, unknown> | null;
    }>(`/api/projects/${PROJECT_ID}/tree/${rootSessionNodeId}`);

    expect(rootNode.status).toBe(200);
    expect(rootNode.data.parentId).toBe(task.id);
    expect(rootNode.data.isActive).toBe(false);
    expect(rootNode.data.archivedAt).toEqual(expect.any(String));
    assertSessionNodeLineageOnlyContentJson(rootNode.data.contentJson, {
      sourceType: "root",
      parentRuntimeSessionId: null,
      forkedFromMessageId: null,
    });

    const forkNode = await authedRequest<{
      id: string;
      isActive: boolean;
      archivedAt: string | null;
      parentId: string | null;
      contentJson?: Record<string, unknown> | null;
    }>(`/api/projects/${PROJECT_ID}/tree/${forkSessionNodeId}`);

    expect(forkNode.status).toBe(200);
    expect(forkNode.data.parentId).toBe(rootSessionNodeId);
    expect(forkNode.data.isActive).toBe(true);
    expect(forkNode.data.archivedAt).toBeNull();
    assertSessionNodeLineageOnlyContentJson(forkNode.data.contentJson, {
      sourceType: "fork",
      parentRuntimeSessionId: rootRuntimeSessionId,
      forkedFromMessageId: null,
    });

    const forkAncestors = await authedRequest<{ data: Array<{ id: string }> }>(
      `/api/projects/${PROJECT_ID}/tree/${forkSessionNodeId}/ancestors`,
    );

    expect(forkAncestors.status).toBe(200);
    expect(forkAncestors.data.data.map((node) => node.id)).toEqual([
      PROJECT_ROOT_NODE_ID,
      task.id,
      rootSessionNodeId,
      forkSessionNodeId,
    ]);
  });

  test("keeps session node content_json on the lineage-only whitelist across create activate and archive", async () => {
    const task = await createTask(`tree-session-whitelist-${Date.now()}`);
    const rootRuntimeSessionId = `ses_whitelist_root_${Date.now()}`;
    const forkRuntimeSessionId = `ses_whitelist_fork_${Date.now()}`;
    const rootSessionRecordId = taskSessionId(task.id, rootRuntimeSessionId);
    const forkSessionRecordId = taskSessionId(task.id, forkRuntimeSessionId);
    const rootSessionNodeId = taskBranchCompatNodeId(task.id, rootRuntimeSessionId);
    const forkSessionNodeId = taskBranchCompatNodeId(task.id, forkRuntimeSessionId);

    createdNodeIds.add(rootSessionNodeId);
    createdNodeIds.add(forkSessionNodeId);

    const rootSession = await authedRequest<{ id: string }>(`/api/tasks/${task.id}/sessions`, {
      method: "POST",
      body: JSON.stringify({
        runtimeSessionId: rootRuntimeSessionId,
        branchName: "main-root",
        sourceType: "root",
        isActive: true,
      }),
    });

    expect(rootSession.status).toBe(201);

    const rootAnchorTime = Date.now();

    const persistRootAnchor = await authedRequest<{ ok: boolean; seq: number }>(
      `/api/tasks/${task.id}/sessions/messages`,
      {
        method: "POST",
        body: JSON.stringify({
          runtimeSessionId: rootRuntimeSessionId,
          message: {
            info: {
              id: "root-user-1",
              role: "user",
              time: { created: rootAnchorTime, completed: rootAnchorTime },
            },
            parts: [{ type: "text", text: "fork anchor" }],
          },
        }),
      },
    );

    expect(persistRootAnchor.status).toBe(201);

    const forkSession = await authedRequest<{ id: string }>(`/api/tasks/${task.id}/sessions`, {
      method: "POST",
      body: JSON.stringify({
        runtimeSessionId: forkRuntimeSessionId,
        parentRuntimeSessionId: rootRuntimeSessionId,
        forkedFromMessageId: "root-user-1",
        branchName: "branch-fork",
        sourceType: "fork",
        isActive: false,
      }),
    });

    expect(forkSession.status).toBe(201);

    const rootNodeAfterCreate = await authedRequest<{
      id: string;
      contentJson?: Record<string, unknown> | null;
    }>(`/api/projects/${PROJECT_ID}/tree/${rootSessionNodeId}`);

    expect(rootNodeAfterCreate.status).toBe(200);
    assertSessionNodeLineageOnlyContentJson(rootNodeAfterCreate.data.contentJson, {
      sourceType: "root",
      parentRuntimeSessionId: null,
      forkedFromMessageId: null,
    });

    const forkNodeAfterCreate = await authedRequest<{
      id: string;
      contentJson?: Record<string, unknown> | null;
    }>(`/api/projects/${PROJECT_ID}/tree/${forkSessionNodeId}`);

    expect(forkNodeAfterCreate.status).toBe(200);
    assertSessionNodeLineageOnlyContentJson(forkNodeAfterCreate.data.contentJson, {
      sourceType: "fork",
      parentRuntimeSessionId: rootRuntimeSessionId,
      forkedFromMessageId: "root-user-1",
    });

    const activateFork = await authedRequest<{ ok: boolean; activatedSessionId: string }>(
      `/api/tasks/${task.id}/sessions/${forkSessionRecordId}/activate`,
      { method: "POST" },
    );

    expect(activateFork.status).toBe(200);
    expect(activateFork.data.activatedSessionId).toBe(forkRuntimeSessionId);

    const archiveRoot = await authedRequest<{ ok: boolean }>(
      `/api/tasks/${task.id}/sessions/${rootSessionRecordId}/archive`,
      { method: "POST" },
    );

    expect(archiveRoot.status).toBe(200);
    expect(archiveRoot.data.ok).toBe(true);

    const rootNodeAfterArchive = await authedRequest<{
      id: string;
      contentJson?: Record<string, unknown> | null;
    }>(`/api/projects/${PROJECT_ID}/tree/${rootSessionNodeId}`);

    expect(rootNodeAfterArchive.status).toBe(200);
    assertSessionNodeLineageOnlyContentJson(rootNodeAfterArchive.data.contentJson, {
      sourceType: "root",
      parentRuntimeSessionId: null,
      forkedFromMessageId: null,
    });

    const forkNodeAfterActivate = await authedRequest<{
      id: string;
      contentJson?: Record<string, unknown> | null;
    }>(`/api/projects/${PROJECT_ID}/tree/${forkSessionNodeId}`);

    expect(forkNodeAfterActivate.status).toBe(200);
    assertSessionNodeLineageOnlyContentJson(forkNodeAfterActivate.data.contentJson, {
      sourceType: "fork",
      parentRuntimeSessionId: rootRuntimeSessionId,
      forkedFromMessageId: "root-user-1",
    });
  });

  test("reactivating an archived session clears legacy and tree archived state", async () => {
    const task = await createTask(`tree-reactivate-${Date.now()}`);
    const rootRuntimeSessionId = `ses_reactivate_root_${Date.now()}`;
    const forkRuntimeSessionId = `ses_reactivate_fork_${Date.now()}`;
    const rootSessionRecordId = taskSessionId(task.id, rootRuntimeSessionId);
    const forkSessionRecordId = taskSessionId(task.id, forkRuntimeSessionId);
    const rootSessionNodeId = taskBranchCompatNodeId(task.id, rootRuntimeSessionId);
    const forkSessionNodeId = taskBranchCompatNodeId(task.id, forkRuntimeSessionId);

    createdNodeIds.add(rootSessionNodeId);
    createdNodeIds.add(forkSessionNodeId);

    const rootSession = await authedRequest<{ id: string }>(`/api/tasks/${task.id}/sessions`, {
      method: "POST",
      body: JSON.stringify({
        runtimeSessionId: rootRuntimeSessionId,
        branchName: "main-root",
        sourceType: "root",
        isActive: true,
      }),
    });
    expect(rootSession.status).toBe(201);

    const timelineBaseTime = Date.now();

    const persistRootUser = await authedRequest<{ ok: boolean; seq: number }>(
      `/api/tasks/${task.id}/sessions/messages`,
      {
        method: "POST",
        body: JSON.stringify({
          runtimeSessionId: rootRuntimeSessionId,
          message: {
            info: {
              id: "root-user",
              role: "user",
              time: {
                created: timelineBaseTime,
                completed: timelineBaseTime,
              },
            },
            parts: [{ type: "text", text: "历史提问" }],
          },
        }),
      },
    );
    expect(persistRootUser.status).toBe(201);

    const persistRootAssistant = await authedRequest<{ ok: boolean; seq: number }>(
      `/api/tasks/${task.id}/sessions/messages`,
      {
        method: "POST",
        body: JSON.stringify({
          runtimeSessionId: rootRuntimeSessionId,
          message: {
            info: {
              id: "root-assistant",
              role: "assistant",
              time: {
                created: timelineBaseTime + 3_000,
                completed: timelineBaseTime + 4_000,
              },
            },
            parts: [{ type: "text", text: "历史回答" }],
          },
        }),
      },
    );
    expect(persistRootAssistant.status).toBe(201);

    const forkSession = await authedRequest<{ id: string }>(`/api/tasks/${task.id}/sessions`, {
      method: "POST",
      body: JSON.stringify({
        runtimeSessionId: forkRuntimeSessionId,
        parentRuntimeSessionId: rootRuntimeSessionId,
        branchName: "branch-fork",
        sourceType: "fork",
        isActive: false,
      }),
    });
    expect(forkSession.status).toBe(201);

    const archiveRoot = await authedRequest<{ ok: boolean }>(
      `/api/tasks/${task.id}/sessions/${rootSessionRecordId}/archive`,
      { method: "POST" },
    );
    expect(archiveRoot.status).toBe(200);
    expect(archiveRoot.data.ok).toBe(true);

    const reactivateRoot = await authedRequest<{ ok: boolean; activatedSessionId: string }>(
      `/api/tasks/${task.id}/sessions/${rootSessionRecordId}/activate`,
      { method: "POST" },
    );
    expect(reactivateRoot.status).toBe(200);
    expect(reactivateRoot.data.activatedSessionId).toBe(rootRuntimeSessionId);

    const sessions = await authedRequest<{
      data: Array<{
        id: string;
        runtimeSessionId: string;
        executionStatus: string;
        archivedAt: string | null;
      }>;
    }>(`/api/tasks/${task.id}/sessions`);

    expect(sessions.status).toBe(200);
    expect(sessions.data.data).toContainEqual(
      expect.objectContaining({
        id: rootSessionRecordId,
        runtimeSessionId: rootRuntimeSessionId,
        executionStatus: "running",
        archivedAt: null,
      }),
    );
    expect(sessions.data.data).toContainEqual(
      expect.objectContaining({
        id: forkSessionRecordId,
        runtimeSessionId: forkRuntimeSessionId,
        executionStatus: "complete",
      }),
    );

    const rootNode = await authedRequest<{
      id: string;
      isActive: boolean;
      archivedAt: string | null;
      parentId: string | null;
      contentJson?: Record<string, unknown> | null;
    }>(`/api/projects/${PROJECT_ID}/tree/${rootSessionNodeId}`);

    expect(rootNode.status).toBe(200);
    expect(rootNode.data.parentId).toBe(task.id);
    expect(rootNode.data.isActive).toBe(true);
    expect(rootNode.data.archivedAt).toBeNull();
    assertSessionNodeLineageOnlyContentJson(rootNode.data.contentJson, {
      sourceType: "root",
      parentRuntimeSessionId: null,
      forkedFromMessageId: null,
    });
  });

  test("keeps session reads and writes alive from legacy tree lineage records only", async () => {
    const task = await createTask(`tree-primary-session-${Date.now()}`);
    const rootRuntimeSessionId = `ses_primary_root_${Date.now()}`;
    const forkRuntimeSessionId = `ses_primary_fork_${Date.now()}`;
    const rootSessionRecordId = taskSessionId(task.id, rootRuntimeSessionId);
    const forkSessionRecordId = taskSessionId(task.id, forkRuntimeSessionId);
    const rootSessionNodeId = taskBranchCompatNodeId(task.id, rootRuntimeSessionId);
    const forkSessionNodeId = taskBranchCompatNodeId(task.id, forkRuntimeSessionId);

    createdNodeIds.add(rootSessionNodeId);
    createdNodeIds.add(forkSessionNodeId);

    const rootSession = await authedRequest<{ id: string }>(`/api/tasks/${task.id}/sessions`, {
      method: "POST",
      body: JSON.stringify({
        runtimeSessionId: rootRuntimeSessionId,
        branchName: "main-root",
        sourceType: "root",
        isActive: true,
      }),
    });
    expect(rootSession.status).toBe(201);

    const rootAnchorTime = Date.now();

    const persistRootAnchor = await authedRequest<{ ok: boolean; seq: number }>(
      `/api/tasks/${task.id}/sessions/messages`,
      {
        method: "POST",
        body: JSON.stringify({
          runtimeSessionId: rootRuntimeSessionId,
          message: {
            info: {
              id: "root-user-1",
              role: "user",
              time: { created: rootAnchorTime, completed: rootAnchorTime },
            },
            parts: [{ type: "text", text: "tree-first root anchor" }],
          },
        }),
      },
    );
    expect(persistRootAnchor.status).toBe(201);

    const forkSession = await authedRequest<{ id: string }>(`/api/tasks/${task.id}/sessions`, {
      method: "POST",
      body: JSON.stringify({
        runtimeSessionId: forkRuntimeSessionId,
        parentRuntimeSessionId: rootRuntimeSessionId,
        forkedFromMessageId: "root-user-1",
        branchName: "branch-fork",
        sourceType: "fork",
        isActive: false,
      }),
    });
    expect(forkSession.status).toBe(201);

    const listed = await authedRequest<{
      data: Array<{ id: string; runtimeSessionId: string }>;
    }>(`/api/tasks/${task.id}/sessions`);

    expect(listed.status).toBe(200);
    expect(listed.data.data).toContainEqual(
      expect.objectContaining({ id: rootSessionRecordId, runtimeSessionId: rootRuntimeSessionId }),
    );
    expect(listed.data.data).toContainEqual(
      expect.objectContaining({ id: forkSessionRecordId, runtimeSessionId: forkRuntimeSessionId }),
    );

    const activateFork = await authedRequest<{ ok: boolean; activatedSessionId: string }>(
      `/api/tasks/${task.id}/sessions/${forkSessionRecordId}/activate`,
      { method: "POST" },
    );

    expect(activateFork.status).toBe(200);
    expect(activateFork.data.activatedSessionId).toBe(forkRuntimeSessionId);

    const persistForkMessage = await authedRequest<{ ok: boolean; seq: number }>(
      `/api/tasks/${task.id}/sessions/messages`,
      {
        method: "POST",
        body: JSON.stringify({
          runtimeSessionId: forkRuntimeSessionId,
          message: {
            info: { id: "fork-msg-1", role: "assistant" },
            parts: [{ type: "text", text: "tree-first session payload" }],
          },
        }),
      },
    );

    expect(persistForkMessage.status).toBe(201);
    expect(persistForkMessage.data.ok).toBe(true);

    const replayed = await queryNormalizedConversation<{
      data: Array<{
        runtimeMessageId: string;
        textContent: string | null;
        parts: Array<{ partType: string; textContent: string | null }>;
      }>;
    }>(task.id, { sessionId: forkSessionRecordId, includeLineage: false });

    expect(replayed.status).toBe(200);
    expect(replayed.data.data[0]?.runtimeMessageId).toBe("fork-msg-1");
    expect(replayed.data.data[0]?.textContent).toBe("tree-first session payload");
    expect(replayed.data.data[0]?.parts).toEqual([
      expect.objectContaining({ partType: "text", textContent: "tree-first session payload" }),
    ]);

    const branchNodes = await sql.unsafe<
      Array<{
        id: string;
        runtime_session_id: string | null;
        content_json: Record<string, unknown> | null;
      }>
    >(
      `SELECT id, runtime_session_id, content_json FROM project_tree_nodes WHERE node_type = 'session' AND id LIKE $1 ORDER BY runtime_session_id`,
      [`branch-node:${task.id}:%`],
    );

    expect(branchNodes.some((row) => row.runtime_session_id === forkRuntimeSessionId)).toBe(true);
    const rootBranchNode = branchNodes.find(
      (row) => row.runtime_session_id === rootRuntimeSessionId,
    );
    const forkBranchNode = branchNodes.find(
      (row) => row.runtime_session_id === forkRuntimeSessionId,
    );
    expect(rootBranchNode).toBeDefined();
    expect(forkBranchNode).toBeDefined();
    assertSessionNodeLineageOnlyContentJson(rootBranchNode?.content_json, {
      sourceType: "root",
      parentRuntimeSessionId: null,
      forkedFromMessageId: null,
    });
    assertSessionNodeLineageOnlyContentJson(forkBranchNode?.content_json, {
      sourceType: "fork",
      parentRuntimeSessionId: rootRuntimeSessionId,
      forkedFromMessageId: "root-user-1",
    });
  });

  test("reads single-session normalized conversation from session-first storage when legacy tree message events are absent", async () => {
    const task = await createTask(`conversation-primary-${Date.now()}`);
    const runtimeSessionId = `ses_conversation_${Date.now()}`;
    const sessionRecordId = taskSessionId(task.id, runtimeSessionId);
    const sessionNodeId = taskBranchCompatNodeId(task.id, runtimeSessionId);

    createdNodeIds.add(sessionNodeId);

    const session = await authedRequest<{ id: string }>(`/api/tasks/${task.id}/sessions`, {
      method: "POST",
      body: JSON.stringify({
        runtimeSessionId,
        branchName: "conversation-main",
        sourceType: "root",
        isActive: true,
      }),
    });

    expect(session.status).toBe(201);

    const conversationMessageCreatedAt = Date.now();

    const persisted = await authedRequest<{ ok: boolean }>(
      `/api/tasks/${task.id}/sessions/messages`,
      {
        method: "POST",
        body: JSON.stringify({
          runtimeSessionId,
          message: {
            info: {
              id: "msg-conversation-1",
              role: "assistant",
              time: {
                created: conversationMessageCreatedAt,
                completed: conversationMessageCreatedAt,
              },
            },
            parts: [{ type: "text", text: "conversation table answer" }],
          },
        }),
      },
    );

    expect(persisted.status).toBe(201);
    const messages = await queryNormalizedConversation<{
      data: Array<Record<string, unknown>>;
      meta: { cacheState: string; complete: boolean; readSource?: string };
    }>(task.id, { sessionId: sessionRecordId });

    expect(messages.status).toBe(200);
    expect(messages.data.meta).toEqual(
      expect.objectContaining({
        readSource: "task-session-first",
        sessionId: sessionRecordId,
        messageCount: 1,
      }),
    );
    expect(messages.data.data).toHaveLength(1);
    expect(messages.data.data[0]).toMatchObject({
      runtimeMessageId: "msg-conversation-1",
      role: "assistant",
      textContent: "conversation table answer",
    });
  });

  test("routes duplicated parallel candidate prompts to the parent session", async () => {
    const unique = Date.now();
    const task = await createTask(`conversation-parallel-prompt-${unique}`);
    const promptText = `并行提示 ${unique}`;
    const rootRuntimeSessionId = `ses_parallel_root_${unique}`;
    const candidateARuntimeSessionId = `ses_parallel_candidate_a_${unique}`;
    const candidateBRuntimeSessionId = `ses_parallel_candidate_b_${unique}`;
    const rootSessionRecordId = taskSessionId(task.id, rootRuntimeSessionId);
    const candidateASessionRecordId = taskSessionId(task.id, candidateARuntimeSessionId);
    const candidateBSessionRecordId = taskSessionId(task.id, candidateBRuntimeSessionId);

    createdNodeIds.add(taskBranchCompatNodeId(task.id, rootRuntimeSessionId));
    createdNodeIds.add(taskBranchCompatNodeId(task.id, candidateARuntimeSessionId));
    createdNodeIds.add(taskBranchCompatNodeId(task.id, candidateBRuntimeSessionId));

    const rootSession = await authedRequest<{ id: string }>(`/api/tasks/${task.id}/sessions`, {
      method: "POST",
      body: JSON.stringify({
        runtimeSessionId: rootRuntimeSessionId,
        branchName: "parallel-root",
        sourceType: "root",
        isActive: false,
      }),
    });
    expect(rootSession.status).toBe(201);

    for (const [runtimeSessionId, candidateIndex, selectedModel, isActive] of [
      [candidateARuntimeSessionId, 0, "model-a", false],
      [candidateBRuntimeSessionId, 1, "model-b", true],
    ] as const) {
      const created = await authedRequest<{ id: string }>(`/api/tasks/${task.id}/sessions`, {
        method: "POST",
        body: JSON.stringify({
          runtimeSessionId,
          parentRuntimeSessionId: rootRuntimeSessionId,
          branchName: `parallel-candidate-${candidateIndex + 1}`,
          sourceType: "root",
          sessionKind: "candidate",
          executionModeSnapshot: "parallel",
          candidateIndex,
          selectedModel,
          isActive,
        }),
      });
      expect(created.status).toBe(201);
    }

    const baseTime = Date.now();

    for (const [runtimeSessionId, messageId, createdAt] of [
      [candidateARuntimeSessionId, "candidate-a-user", baseTime],
      [candidateBRuntimeSessionId, "candidate-b-user", baseTime + 500],
    ] as const) {
      const persisted = await authedRequest<{ ok: boolean }>(
        `/api/tasks/${task.id}/sessions/messages`,
        {
          method: "POST",
          body: JSON.stringify({
            runtimeSessionId,
            message: {
              info: {
                id: messageId,
                role: "user",
                time: { created: createdAt, completed: createdAt },
              },
              parts: [{ type: "text", text: promptText }],
            },
          }),
        },
      );
      expect(persisted.status).toBe(201);
    }

    for (const [runtimeSessionId, messageId, replyText, createdAt] of [
      [
        candidateARuntimeSessionId,
        "candidate-a-assistant",
        `候选 A 回复 ${unique}`,
        baseTime + 1_000,
      ],
      [
        candidateBRuntimeSessionId,
        "candidate-b-assistant",
        `候选 B 回复 ${unique}`,
        baseTime + 2_000,
      ],
    ] as const) {
      const persisted = await authedRequest<{ ok: boolean }>(
        `/api/tasks/${task.id}/sessions/messages`,
        {
          method: "POST",
          body: JSON.stringify({
            runtimeSessionId,
            message: {
              info: {
                id: messageId,
                role: "assistant",
                time: { created: createdAt, completed: createdAt },
              },
              parts: [{ type: "text", text: replyText }],
            },
          }),
        },
      );
      expect(persisted.status).toBe(201);
    }

    const rootMessages = await queryNormalizedConversation<{
      data: Array<{ role: string | null; textContent: string | null }>;
      meta: { messageCount: number; readSource?: string };
    }>(task.id, { sessionId: rootSessionRecordId, includeLineage: false });

    expect(rootMessages.status).toBe(200);
    expect(rootMessages.data.meta).toEqual(
      expect.objectContaining({
        readSource: "task-session-first",
        messageCount: 1,
      }),
    );
    expect(rootMessages.data.data).toEqual([
      expect.objectContaining({ role: "user", textContent: promptText }),
    ]);

    const candidateAMessages = await queryNormalizedConversation<{
      data: Array<{ role: string | null; textContent: string | null }>;
      meta: { messageCount: number };
    }>(task.id, { sessionId: candidateASessionRecordId, includeLineage: false });

    expect(candidateAMessages.status).toBe(200);
    expect(candidateAMessages.data.meta).toEqual(expect.objectContaining({ messageCount: 1 }));
    expect(candidateAMessages.data.data).toEqual([
      expect.objectContaining({ role: "assistant", textContent: `候选 A 回复 ${unique}` }),
    ]);

    const candidateBMessages = await queryNormalizedConversation<{
      data: Array<{ role: string | null; textContent: string | null }>;
      meta: { messageCount: number };
    }>(task.id, { sessionId: candidateBSessionRecordId, includeLineage: false });

    expect(candidateBMessages.status).toBe(200);
    expect(candidateBMessages.data.meta).toEqual(expect.objectContaining({ messageCount: 1 }));
    expect(candidateBMessages.data.data).toEqual([
      expect.objectContaining({ role: "assistant", textContent: `候选 B 回复 ${unique}` }),
    ]);

    const taskMessages = await queryNormalizedConversation<{
      data: Array<{ sessionId: string | null; role: string | null; textContent: string | null }>;
      meta: { messageCount: number; readSource?: string };
    }>(task.id);

    expect(taskMessages.status).toBe(200);
    expect(taskMessages.data.meta).toEqual(
      expect.objectContaining({
        readSource: "task-session-first",
        messageCount: 3,
      }),
    );
    expect(
      taskMessages.data.data.filter((message) => message.textContent === promptText),
    ).toHaveLength(1);
    expect(taskMessages.data.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sessionId: rootSessionRecordId,
          role: "user",
          textContent: promptText,
        }),
        expect.objectContaining({
          sessionId: candidateASessionRecordId,
          role: "assistant",
          textContent: `候选 A 回复 ${unique}`,
        }),
        expect.objectContaining({
          sessionId: candidateBSessionRecordId,
          role: "assistant",
          textContent: `候选 B 回复 ${unique}`,
        }),
      ]),
    );
  });

  test("routes duplicated parallel candidate prompts to the round anchor session", async () => {
    const unique = Date.now();
    const task = await createTask(`conversation-parallel-round-anchor-${unique}`);
    const promptText = `并行第 3 轮输入 ${unique}`;
    const rootRuntimeSessionId = `ses_parallel_root_${unique}`;
    const roundAnchorRuntimeSessionId = `round_anchor_${unique}`;
    const candidateARuntimeSessionId = `ses_parallel_round_candidate_a_${unique}`;
    const candidateBRuntimeSessionId = `ses_parallel_round_candidate_b_${unique}`;
    const rootSessionRecordId = taskSessionId(task.id, rootRuntimeSessionId);
    const roundAnchorSessionRecordId = taskSessionId(task.id, roundAnchorRuntimeSessionId);
    const candidateASessionRecordId = taskSessionId(task.id, candidateARuntimeSessionId);
    const candidateBSessionRecordId = taskSessionId(task.id, candidateBRuntimeSessionId);

    createdNodeIds.add(taskBranchCompatNodeId(task.id, rootRuntimeSessionId));
    createdNodeIds.add(taskBranchCompatNodeId(task.id, roundAnchorRuntimeSessionId));
    createdNodeIds.add(taskBranchCompatNodeId(task.id, candidateARuntimeSessionId));
    createdNodeIds.add(taskBranchCompatNodeId(task.id, candidateBRuntimeSessionId));

    const rootSession = await authedRequest<{ id: string }>(`/api/tasks/${task.id}/sessions`, {
      method: "POST",
      body: JSON.stringify({
        runtimeSessionId: rootRuntimeSessionId,
        branchName: "round-1-root",
        sourceType: "root",
        isActive: false,
      }),
    });
    expect(rootSession.status).toBe(201);

    const roundAnchor = await authedRequest<{ id: string }>(`/api/tasks/${task.id}/sessions`, {
      method: "POST",
      body: JSON.stringify({
        runtimeSessionId: roundAnchorRuntimeSessionId,
        parentRuntimeSessionId: rootRuntimeSessionId,
        branchName: promptText,
        sourceType: "sub_session",
        sessionKind: "resume",
        executionModeSnapshot: "parallel",
        isActive: false,
      }),
    });
    expect(roundAnchor.status).toBe(201);

    for (const [runtimeSessionId, candidateIndex, selectedModel, isActive] of [
      [candidateARuntimeSessionId, 0, "model-a", false],
      [candidateBRuntimeSessionId, 1, "model-b", true],
    ] as const) {
      const created = await authedRequest<{ id: string }>(`/api/tasks/${task.id}/sessions`, {
        method: "POST",
        body: JSON.stringify({
          runtimeSessionId,
          parentRuntimeSessionId: roundAnchorRuntimeSessionId,
          branchName: `parallel-candidate-${candidateIndex + 1}`,
          sourceType: "parallel",
          sessionKind: "candidate",
          executionModeSnapshot: "parallel",
          candidateIndex,
          selectedModel,
          isActive,
        }),
      });
      expect(created.status).toBe(201);
    }

    const sessions = await authedRequest<{
      data: Array<{
        id: string;
        runtimeSessionId: string;
        parentRuntimeSessionId: string | null;
        sourceType: string;
      }>;
    }>(`/api/tasks/${task.id}/sessions`);

    expect(sessions.status).toBe(200);
    expect(sessions.data.data).toContainEqual(
      expect.objectContaining({
        id: candidateASessionRecordId,
        runtimeSessionId: candidateARuntimeSessionId,
        parentRuntimeSessionId: roundAnchorRuntimeSessionId,
        sourceType: "parallel",
      }),
    );
    expect(sessions.data.data).toContainEqual(
      expect.objectContaining({
        id: candidateBSessionRecordId,
        runtimeSessionId: candidateBRuntimeSessionId,
        parentRuntimeSessionId: roundAnchorRuntimeSessionId,
        sourceType: "parallel",
      }),
    );

    const baseTime = Date.now();

    for (const [runtimeSessionId, messageId, createdAt] of [
      [candidateARuntimeSessionId, "candidate-a-user", baseTime],
      [candidateBRuntimeSessionId, "candidate-b-user", baseTime + 500],
    ] as const) {
      const persisted = await authedRequest<{ ok: boolean }>(
        `/api/tasks/${task.id}/sessions/messages`,
        {
          method: "POST",
          body: JSON.stringify({
            runtimeSessionId,
            message: {
              info: {
                id: messageId,
                role: "user",
                time: { created: createdAt, completed: createdAt },
              },
              parts: [{ type: "text", text: promptText }],
            },
          }),
        },
      );
      expect(persisted.status).toBe(201);
    }

    for (const [runtimeSessionId, messageId, replyText, createdAt] of [
      [
        candidateARuntimeSessionId,
        "candidate-a-assistant",
        `Round anchor 候选 A 回复 ${unique}`,
        baseTime + 1_000,
      ],
      [
        candidateBRuntimeSessionId,
        "candidate-b-assistant",
        `Round anchor 候选 B 回复 ${unique}`,
        baseTime + 2_000,
      ],
    ] as const) {
      const persisted = await authedRequest<{ ok: boolean }>(
        `/api/tasks/${task.id}/sessions/messages`,
        {
          method: "POST",
          body: JSON.stringify({
            runtimeSessionId,
            message: {
              info: {
                id: messageId,
                role: "assistant",
                time: { created: createdAt, completed: createdAt },
              },
              parts: [{ type: "text", text: replyText }],
            },
          }),
        },
      );
      expect(persisted.status).toBe(201);
    }

    const rootMessages = await queryNormalizedConversation<{
      data: Array<{ role: string | null; textContent: string | null }>;
      meta: { messageCount: number; readSource?: string };
    }>(task.id, { sessionId: rootSessionRecordId, includeLineage: false });

    expect(rootMessages.status).toBe(200);
    expect(rootMessages.data.meta).toEqual(
      expect.objectContaining({
        readSource: "task-session-first",
        messageCount: 0,
      }),
    );
    expect(rootMessages.data.data).toEqual([]);

    const roundAnchorMessages = await queryNormalizedConversation<{
      data: Array<{ role: string | null; textContent: string | null }>;
      meta: { messageCount: number; readSource?: string };
    }>(task.id, { sessionId: roundAnchorSessionRecordId, includeLineage: false });

    expect(roundAnchorMessages.status).toBe(200);
    expect(roundAnchorMessages.data.meta).toEqual(
      expect.objectContaining({
        readSource: "task-session-first",
        messageCount: 1,
      }),
    );
    expect(roundAnchorMessages.data.data).toEqual([
      expect.objectContaining({ role: "user", textContent: promptText }),
    ]);

    const candidateAMessages = await queryNormalizedConversation<{
      data: Array<{ role: string | null; textContent: string | null }>;
      meta: { messageCount: number };
    }>(task.id, { sessionId: candidateASessionRecordId, includeLineage: false });

    expect(candidateAMessages.status).toBe(200);
    expect(candidateAMessages.data.meta).toEqual(expect.objectContaining({ messageCount: 1 }));
    expect(candidateAMessages.data.data).toEqual([
      expect.objectContaining({
        role: "assistant",
        textContent: `Round anchor 候选 A 回复 ${unique}`,
      }),
    ]);

    const candidateBMessages = await queryNormalizedConversation<{
      data: Array<{ role: string | null; textContent: string | null }>;
      meta: { messageCount: number };
    }>(task.id, { sessionId: candidateBSessionRecordId, includeLineage: false });

    expect(candidateBMessages.status).toBe(200);
    expect(candidateBMessages.data.meta).toEqual(expect.objectContaining({ messageCount: 1 }));
    expect(candidateBMessages.data.data).toEqual([
      expect.objectContaining({
        role: "assistant",
        textContent: `Round anchor 候选 B 回复 ${unique}`,
      }),
    ]);

    const taskMessages = await queryNormalizedConversation<{
      data: Array<{ sessionId: string | null; role: string | null; textContent: string | null }>;
      meta: { messageCount: number; readSource?: string };
    }>(task.id);

    expect(taskMessages.status).toBe(200);
    expect(taskMessages.data.meta).toEqual(
      expect.objectContaining({
        readSource: "task-session-first",
        messageCount: 3,
      }),
    );
    expect(taskMessages.data.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sessionId: roundAnchorSessionRecordId,
          role: "user",
          textContent: promptText,
        }),
        expect.objectContaining({
          sessionId: candidateASessionRecordId,
          role: "assistant",
          textContent: `Round anchor 候选 A 回复 ${unique}`,
        }),
        expect.objectContaining({
          sessionId: candidateBSessionRecordId,
          role: "assistant",
          textContent: `Round anchor 候选 B 回复 ${unique}`,
        }),
      ]),
    );
  });

  test("keeps legacy tool-call assistant turns with identical final stop replies as separate canonical messages", async () => {
    const unique = Date.now();
    const task = await createTask(`conversation-tool-call-merge-${unique}`);
    const runtimeSessionId = `ses_tool_merge_${unique}`;
    const sessionRecordId = taskSessionId(task.id, runtimeSessionId);

    createdNodeIds.add(taskBranchCompatNodeId(task.id, runtimeSessionId));

    const session = await authedRequest<{ id: string }>(`/api/tasks/${task.id}/sessions`, {
      method: "POST",
      body: JSON.stringify({
        runtimeSessionId,
        branchName: "tool-call-merge",
        sourceType: "root",
        isActive: true,
      }),
    });
    expect(session.status).toBe(201);

    const replyText = `合并后的最终回复 ${unique}`;
    const baseTime = Date.now();

    const toolTurnPersist = await authedRequest<{ ok: boolean }>(
      `/api/tasks/${task.id}/sessions/messages`,
      {
        method: "POST",
        body: JSON.stringify({
          runtimeSessionId,
          message: {
            info: {
              id: `assistant-tool-${unique}`,
              role: "assistant",
              finish: "tool-calls",
              parentID: `user-${unique}`,
              time: {
                created: baseTime + 1_000,
                completed: baseTime + 1_000,
              },
            },
            parts: [
              { type: "step-start" },
              {
                type: "tool",
                tool: "webfetch",
                toolName: "webfetch",
                state: "completed",
                input: { url: "https://example.com/whisper" },
              },
              { type: "step-finish", reason: "tool-calls" },
              { type: "text", text: replyText },
            ],
          },
        }),
      },
    );

    expect(toolTurnPersist.status).toBe(201);

    const finalTurnBody = {
      runtimeSessionId,
      message: {
        info: {
          id: `assistant-final-${unique}`,
          role: "assistant",
          finish: "stop",
          parentID: `user-${unique}`,
          time: {
            created: baseTime + 4_000,
            completed: baseTime + 5_000,
          },
        },
        parts: [
          { type: "step-start" },
          { type: "text", text: replyText },
          { type: "step-finish", reason: "stop" },
        ],
      },
    };

    const finalTurnPersist = await authedRequest<{ ok: boolean }>(
      `/api/tasks/${task.id}/sessions/messages`,
      {
        method: "POST",
        body: JSON.stringify(finalTurnBody),
      },
    );

    expect(finalTurnPersist.status).toBe(201);

    const replayFinalTurnPersist = await authedRequest<{ ok: boolean }>(
      `/api/tasks/${task.id}/sessions/messages`,
      {
        method: "POST",
        body: JSON.stringify(finalTurnBody),
      },
    );

    expect(replayFinalTurnPersist.status).toBe(201);

    const messages = await queryNormalizedConversation<{
      data: Array<Record<string, unknown>>;
      meta: { messageCount: number; readSource?: string };
    }>(task.id, { sessionId: sessionRecordId, includeLineage: false });

    expect(messages.status).toBe(200);
    expect(messages.data.meta).toEqual(
      expect.objectContaining({
        readSource: "task-session-first",
        messageCount: 2,
      }),
    );
    expect(messages.data.data).toHaveLength(2);
    expect(messages.data.data[0]).toMatchObject({
      role: "assistant",
      textContent: replyText,
      rawPayload: expect.objectContaining({
        info: expect.objectContaining({
          finish: "tool-calls",
        }),
      }),
    });

    const parts = Array.isArray(messages.data.data[0]?.parts)
      ? (messages.data.data[0].parts as Array<Record<string, unknown>>)
      : [];

    expect(parts.map((part) => part.partType)).toEqual(["text", "tool_result", "text", "text"]);
    expect(parts[1]).toEqual(
      expect.objectContaining({
        partType: "tool_result",
        jsonPayload: expect.objectContaining({
          type: "tool",
          tool: "webfetch",
        }),
      }),
    );
    expect(messages.data.data[1]).toMatchObject({
      role: "assistant",
      textContent: replyText,
      rawPayload: expect.objectContaining({
        info: expect.objectContaining({
          finish: "stop",
        }),
      }),
    });

    const taskMessages = await queryNormalizedConversation<{
      data: Array<Record<string, unknown>>;
      meta: { messageCount: number; readSource?: string };
    }>(task.id);

    expect(taskMessages.status).toBe(200);
    expect(taskMessages.data.meta).toEqual(
      expect.objectContaining({
        readSource: "task-session-first",
        messageCount: 2,
      }),
    );
    expect(taskMessages.data.data).toHaveLength(2);
    expect(taskMessages.data.data.map((message) => message.textContent)).toEqual([
      replyText,
      replyText,
    ]);
  });

  test("merges normalized tool_call assistant turns with identical final stop replies", async () => {
    const unique = Date.now();
    const task = await createTask(`conversation-tool-call-merge-normalized-${unique}`);
    const runtimeSessionId = `ses_tool_merge_normalized_${unique}`;
    const sessionRecordId = taskSessionId(task.id, runtimeSessionId);

    createdNodeIds.add(taskBranchCompatNodeId(task.id, runtimeSessionId));

    const session = await authedRequest<{ id: string }>(`/api/tasks/${task.id}/sessions`, {
      method: "POST",
      body: JSON.stringify({
        runtimeSessionId,
        branchName: "tool-call-merge-normalized",
        sourceType: "root",
        isActive: true,
      }),
    });
    expect(session.status).toBe(201);

    const replyText = `标准化工具调用合并后的最终回复 ${unique}`;
    const baseTime = Date.now();

    const toolTurnPersist = await authedRequest<{ ok: boolean }>(
      `/api/tasks/${task.id}/sessions/messages`,
      {
        method: "POST",
        body: JSON.stringify({
          runtimeSessionId,
          message: {
            info: {
              id: `assistant-tool-normalized-${unique}`,
              role: "assistant",
              finish: "tool-calls",
              parentID: `user-${unique}`,
              time: {
                created: baseTime + 1_000,
                completed: baseTime + 1_000,
              },
            },
            parts: [
              { type: "step-start" },
              {
                id: `call-${unique}`,
                type: "tool_call",
                name: "search_code",
                input: { query: "task tree", includePattern: "src/**" },
              },
              {
                id: `result-${unique}`,
                type: "tool_result",
                tool: "search_code",
                state: {
                  status: "completed",
                  output: "match found",
                },
              },
              { type: "step-finish", reason: "tool-calls" },
              { type: "text", text: replyText },
            ],
          },
        }),
      },
    );

    expect(toolTurnPersist.status).toBe(201);

    const replayFinalTurnPersist = await authedRequest<{ ok: boolean }>(
      `/api/tasks/${task.id}/sessions/messages`,
      {
        method: "POST",
        body: JSON.stringify({
          runtimeSessionId,
          message: {
            info: {
              id: `assistant-final-normalized-${unique}`,
              role: "assistant",
              finish: "stop",
              parentID: `user-${unique}`,
              time: {
                created: baseTime + 4_000,
                completed: baseTime + 5_000,
              },
            },
            parts: [
              { type: "step-start" },
              { type: "text", text: replyText },
              { type: "step-finish", reason: "stop" },
            ],
          },
        }),
      },
    );

    expect(replayFinalTurnPersist.status).toBe(201);

    const messages = await queryNormalizedConversation<{
      data: Array<Record<string, unknown>>;
      meta: { messageCount: number; readSource?: string };
    }>(task.id, { sessionId: sessionRecordId, includeLineage: false });

    expect(messages.status).toBe(200);
    expect(messages.data.meta).toEqual(
      expect.objectContaining({
        readSource: "task-session-first",
        messageCount: 2,
      }),
    );
    expect(messages.data.data).toHaveLength(2);

    const toolCallParts = Array.isArray(messages.data.data[0]?.parts)
      ? (messages.data.data[0].parts as Array<Record<string, unknown>>)
      : [];

    expect(toolCallParts.map((part) => part.partType)).toEqual([
      "text",
      "tool_call",
      "tool_result",
      "text",
      "text",
    ]);
    expect(toolCallParts[1]).toEqual(
      expect.objectContaining({
        partType: "tool_call",
        jsonPayload: expect.objectContaining({
          type: "tool_call",
          name: "search_code",
        }),
      }),
    );
    expect(toolCallParts[2]).toEqual(
      expect.objectContaining({
        partType: "tool_result",
        jsonPayload: expect.objectContaining({
          type: "tool_result",
          tool: "search_code",
        }),
      }),
    );
    expect(messages.data.data[1]).toMatchObject({
      role: "assistant",
      textContent: replyText,
      rawPayload: expect.objectContaining({
        info: expect.objectContaining({
          finish: "stop",
        }),
      }),
    });
  });

  test("persists task session messages in session storage and replays latest normalized conversation state", async () => {
    const task = await createTask(`tree-message-cache-${Date.now()}`);
    const runtimeSessionId = `ses_cached_${Date.now()}`;
    const sessionRecordId = taskSessionId(task.id, runtimeSessionId);
    const sessionNodeId = taskBranchCompatNodeId(task.id, runtimeSessionId);

    createdNodeIds.add(sessionNodeId);

    const session = await authedRequest<{ id: string; runtimeSessionId: string }>(
      `/api/tasks/${task.id}/sessions`,
      {
        method: "POST",
        body: JSON.stringify({
          runtimeSessionId,
          branchName: "cache-root",
          sourceType: "root",
          isActive: true,
        }),
      },
    );

    expect(session.status).toBe(201);

    const baseTime = Date.now();

    const firstPersist = await authedRequest<{ ok: boolean; seq: number }>(
      `/api/tasks/${task.id}/sessions/messages`,
      {
        method: "POST",
        body: JSON.stringify({
          runtimeSessionId,
          message: {
            info: {
              id: "msg-1",
              role: "assistant",
              time: { created: baseTime + 1_000, completed: baseTime + 1_000 },
            },
            parts: [{ type: "text", text: "draft result" }],
          },
        }),
      },
    );

    expect(firstPersist.status).toBe(201);
    expect(firstPersist.data.ok).toBe(true);

    const secondPersist = await authedRequest<{ ok: boolean; seq: number }>(
      `/api/tasks/${task.id}/sessions/messages`,
      {
        method: "POST",
        body: JSON.stringify({
          runtimeSessionId,
          message: {
            info: {
              id: "msg-1",
              role: "assistant",
              time: { created: baseTime + 2_000, completed: baseTime + 2_000 },
            },
            parts: [{ type: "text", text: "final result" }],
          },
        }),
      },
    );

    expect(secondPersist.status).toBe(201);
    expect(secondPersist.data.ok).toBe(true);

    const replayed = await queryNormalizedConversation<{
      data: Array<{
        runtimeMessageId: string;
        textContent: string | null;
        parts: Array<{ partType: string; textContent: string | null }>;
      }>;
    }>(task.id, { sessionId: sessionRecordId, includeLineage: false });

    expect(replayed.status).toBe(200);
    expect(replayed.data.data).toHaveLength(1);
    expect(replayed.data.data[0]?.runtimeMessageId).toBe("msg-1");
    expect(replayed.data.data[0]?.textContent).toBe("final result");
    expect(replayed.data.data[0]?.parts).toEqual([
      expect.objectContaining({ partType: "text", textContent: "final result" }),
    ]);
  });

  test("builds lineage timeline items from persisted session state", async () => {
    const task = await createTask(`tree-lineage-cache-${Date.now()}`);
    const rootRuntimeSessionId = `ses_lineage_root_${Date.now()}`;
    const forkRuntimeSessionId = `ses_lineage_fork_${Date.now()}`;
    const rootSessionRecordId = taskSessionId(task.id, rootRuntimeSessionId);
    const forkSessionRecordId = taskSessionId(task.id, forkRuntimeSessionId);
    const rootSessionNodeId = taskBranchCompatNodeId(task.id, rootRuntimeSessionId);
    const forkSessionNodeId = taskBranchCompatNodeId(task.id, forkRuntimeSessionId);

    createdNodeIds.add(rootSessionNodeId);
    createdNodeIds.add(forkSessionNodeId);

    const rootSession = await authedRequest<{ id: string; runtimeSessionId: string }>(
      `/api/tasks/${task.id}/sessions`,
      {
        method: "POST",
        body: JSON.stringify({
          runtimeSessionId: rootRuntimeSessionId,
          branchName: "main-root",
          sourceType: "root",
          isActive: false,
        }),
      },
    );

    expect(rootSession.status).toBe(201);

    const lineageBaseTime = Date.now();

    const persistRootUser = await authedRequest<{ ok: boolean; seq: number }>(
      `/api/tasks/${task.id}/sessions/messages`,
      {
        method: "POST",
        body: JSON.stringify({
          runtimeSessionId: rootRuntimeSessionId,
          message: {
            info: {
              id: "root-user",
              role: "user",
              time: { created: lineageBaseTime, completed: lineageBaseTime },
            },
            parts: [{ type: "text", text: "历史提问" }],
          },
        }),
      },
    );
    expect(persistRootUser.status).toBe(201);

    const persistRootAssistant = await authedRequest<{ ok: boolean; seq: number }>(
      `/api/tasks/${task.id}/sessions/messages`,
      {
        method: "POST",
        body: JSON.stringify({
          runtimeSessionId: rootRuntimeSessionId,
          message: {
            info: {
              id: "root-assistant",
              role: "assistant",
              time: {
                created: lineageBaseTime + 1_000,
                completed: lineageBaseTime + 1_000,
              },
            },
            parts: [{ type: "text", text: "历史回答" }],
          },
        }),
      },
    );
    expect(persistRootAssistant.status).toBe(201);

    const lineageMessageBaseTime = Date.now();

    const forkSession = await authedRequest<{ id: string; runtimeSessionId: string }>(
      `/api/tasks/${task.id}/sessions`,
      {
        method: "POST",
        body: JSON.stringify({
          runtimeSessionId: forkRuntimeSessionId,
          parentRuntimeSessionId: rootRuntimeSessionId,
          forkedFromMessageId: "root-assistant",
          branchName: "branch-fork",
          sourceType: "fork",
          isActive: true,
        }),
      },
    );

    expect(forkSession.status).toBe(201);

    const persistRootAfterFork = await authedRequest<{ ok: boolean; seq: number }>(
      `/api/tasks/${task.id}/sessions/messages`,
      {
        method: "POST",
        body: JSON.stringify({
          runtimeSessionId: rootRuntimeSessionId,
          message: {
            info: {
              id: "root-after-fork",
              role: "assistant",
              time: {
                created: lineageMessageBaseTime + 2_000,
                completed: lineageMessageBaseTime + 2_000,
              },
            },
            parts: [{ type: "text", text: "不应再进入分叉上下文" }],
          },
        }),
      },
    );
    expect(persistRootAfterFork.status).toBe(201);

    const persistLeafUser = await authedRequest<{ ok: boolean; seq: number }>(
      `/api/tasks/${task.id}/sessions/messages`,
      {
        method: "POST",
        body: JSON.stringify({
          runtimeSessionId: forkRuntimeSessionId,
          message: {
            info: {
              id: "leaf-user",
              role: "user",
              time: {
                created: lineageMessageBaseTime + 3_000,
                completed: lineageMessageBaseTime + 3_000,
              },
            },
            parts: [{ type: "text", text: "当前提问" }],
          },
        }),
      },
    );
    expect(persistLeafUser.status).toBe(201);

    const persistLeafAssistant = await authedRequest<{ ok: boolean; seq: number }>(
      `/api/tasks/${task.id}/sessions/messages`,
      {
        method: "POST",
        body: JSON.stringify({
          runtimeSessionId: forkRuntimeSessionId,
          message: {
            info: {
              id: "leaf-assistant",
              role: "assistant",
              time: {
                created: lineageMessageBaseTime + 4_000,
                completed: lineageMessageBaseTime + 4_000,
              },
            },
            parts: [{ type: "text", text: "当前回答" }],
          },
        }),
      },
    );
    expect(persistLeafAssistant.status).toBe(201);

    const replayed = await authedRequest<{
      data: Array<{ itemKind: string; itemRole: string | null; displayText: string | null }>;
      meta: {
        readSource: string;
        includeLineage: boolean;
        complete: boolean;
        lineagePath: string[];
        itemCount: number;
      };
    }>(`/api/tasks/${task.id}/sessions/${forkSessionRecordId}/timeline?includeLineage=true`);

    expect(replayed.status).toBe(200);
    expect(replayed.data.meta).toEqual(
      expect.objectContaining({
        readSource: "task-session-projection",
        includeLineage: true,
        complete: true,
        lineagePath: [rootSessionRecordId, forkSessionRecordId],
        itemCount: 5,
      }),
    );
    expect(replayed.data.data.map((item) => item.displayText)).toEqual([
      "历史提问",
      "历史回答",
      "不应再进入分叉上下文",
      "当前提问",
      "当前回答",
    ]);
  });

  test("builds lineage execution trace from session-first stores", async () => {
    const task = await createTask(`conversation-lineage-${Date.now()}`);
    const rootRuntimeSessionId = `ses_conversation_root_${Date.now()}`;
    const forkRuntimeSessionId = `ses_conversation_fork_${Date.now()}`;
    const rootSessionRecordId = taskSessionId(task.id, rootRuntimeSessionId);
    const forkSessionRecordId = taskSessionId(task.id, forkRuntimeSessionId);
    const rootSessionNodeId = taskBranchCompatNodeId(task.id, rootRuntimeSessionId);
    const forkSessionNodeId = taskBranchCompatNodeId(task.id, forkRuntimeSessionId);

    createdNodeIds.add(rootSessionNodeId);
    createdNodeIds.add(forkSessionNodeId);

    await authedRequest(`/api/tasks/${task.id}/sessions`, {
      method: "POST",
      body: JSON.stringify({
        runtimeSessionId: rootRuntimeSessionId,
        branchName: "conversation-root",
        sourceType: "root",
        isActive: false,
      }),
    });

    const lineageBaseTime = Date.now();

    const persistRootUser = await authedRequest<{ ok: boolean }>(
      `/api/tasks/${task.id}/sessions/messages`,
      {
        method: "POST",
        body: JSON.stringify({
          runtimeSessionId: rootRuntimeSessionId,
          message: {
            info: {
              id: "root-user",
              role: "user",
              time: { created: lineageBaseTime, completed: lineageBaseTime },
            },
            parts: [{ type: "text", text: "历史提问" }],
          },
        }),
      },
    );
    expect(persistRootUser.status).toBe(201);

    const persistRootAssistant = await authedRequest<{ ok: boolean }>(
      `/api/tasks/${task.id}/sessions/messages`,
      {
        method: "POST",
        body: JSON.stringify({
          runtimeSessionId: rootRuntimeSessionId,
          message: {
            info: {
              id: "root-assistant",
              role: "assistant",
              time: {
                created: lineageBaseTime + 1_000,
                completed: lineageBaseTime + 1_000,
              },
            },
            parts: [{ type: "text", text: "历史回答" }],
          },
        }),
      },
    );
    expect(persistRootAssistant.status).toBe(201);

    const traceMessageBaseTime = Date.now();

    await authedRequest(`/api/tasks/${task.id}/sessions`, {
      method: "POST",
      body: JSON.stringify({
        runtimeSessionId: forkRuntimeSessionId,
        parentRuntimeSessionId: rootRuntimeSessionId,
        forkedFromMessageId: "root-assistant",
        branchName: "conversation-fork",
        sourceType: "fork",
        isActive: true,
      }),
    });

    for (const [runtimeSessionId, message] of [
      [
        rootRuntimeSessionId,
        {
          info: {
            id: "root-after-fork",
            role: "assistant",
            time: {
              created: traceMessageBaseTime + 2_000,
              completed: traceMessageBaseTime + 2_000,
            },
          },
          parts: [{ type: "text", text: "不应再进入分叉上下文" }],
        },
      ],
      [
        forkRuntimeSessionId,
        {
          info: {
            id: "leaf-user",
            role: "user",
            time: {
              created: traceMessageBaseTime + 3_000,
              completed: traceMessageBaseTime + 3_000,
            },
          },
          parts: [{ type: "text", text: "当前提问" }],
        },
      ],
      [
        forkRuntimeSessionId,
        {
          info: {
            id: "leaf-assistant",
            role: "assistant",
            time: {
              created: traceMessageBaseTime + 4_000,
              completed: traceMessageBaseTime + 4_000,
            },
          },
          parts: [{ type: "text", text: "当前回答" }],
        },
      ],
    ] as const) {
      const persisted = await authedRequest<{ ok: boolean }>(
        `/api/tasks/${task.id}/sessions/messages`,
        {
          method: "POST",
          body: JSON.stringify({ runtimeSessionId, message }),
        },
      );
      expect(persisted.status).toBe(201);
    }
    const replayed = await authedRequest<{
      data: {
        selectedSessionId: string | null;
        timeline: Array<{ displayText: string | null }>;
      };
      meta: {
        readSource: string;
        timelineReadSource: string;
        includeLineage: boolean;
        complete: boolean;
        lineagePath: string[];
        timelineItemCount: number;
      };
    }>(
      `/api/tasks/${task.id}/execution-trace?sessionId=${forkSessionRecordId}&includeLineage=true`,
    );

    expect(replayed.status).toBe(200);
    expect(replayed.data.meta).toEqual(
      expect.objectContaining({
        readSource: "task-session-first",
        timelineReadSource: "task-session-projection",
        includeLineage: true,
        complete: true,
        lineagePath: [rootSessionRecordId, forkSessionRecordId],
        timelineItemCount: 5,
      }),
    );
    expect(replayed.data.data.selectedSessionId).toBe(forkSessionRecordId);
    expect(replayed.data.data.timeline.map((item) => item.displayText)).toEqual([
      "历史提问",
      "历史回答",
      "不应再进入分叉上下文",
      "当前提问",
      "当前回答",
    ]);
  });

  test("returns execution trace detail with executor and judge session operations without auto-closing parallel snapshot", async () => {
    const task = await createTask(`domain-run-detail-${Date.now()}`);
    const rootRuntimeSessionId = `ses_domain_run_${Date.now()}`;
    const sessionRecordId = taskSessionId(task.id, rootRuntimeSessionId);

    const createdSession = await authedRequest<{ id: string }>(`/api/tasks/${task.id}/sessions`, {
      method: "POST",
      body: JSON.stringify({
        runtimeSessionId: rootRuntimeSessionId,
        branchName: "domain-run-root",
        sourceType: "root",
        isActive: true,
      }),
    });
    expect(createdSession.status).toBe(201);

    const patchedTask = await authedRequest(`/api/tasks/${task.id}`, {
      method: "PATCH",
      body: JSON.stringify({
        status: "running",
        sessionId: rootRuntimeSessionId,
        executionMode: "parallel",
      }),
    });
    expect(patchedTask.status).toBe(200);

    const baseTime = Date.now();

    const candidateA = await authedRequest<{ id: string }>(`/api/tasks/${task.id}/runs`, {
      method: "POST",
      body: JSON.stringify({
        sessionId: sessionRecordId,
        agentType: "executor",
        candidateIndex: 0,
        status: "completed",
        modelUsed: "model-a",
        result: "answer-a",
        startedAt: new Date(baseTime + 1_000).toISOString(),
        finishedAt: new Date(baseTime + 2_000).toISOString(),
      }),
    });
    expect(candidateA.status).toBe(201);

    const candidateB = await authedRequest<{ id: string }>(`/api/tasks/${task.id}/runs`, {
      method: "POST",
      body: JSON.stringify({
        sessionId: sessionRecordId,
        agentType: "executor",
        candidateIndex: 1,
        status: "completed",
        modelUsed: "model-b",
        result: "answer-b",
        startedAt: new Date(baseTime + 3_000).toISOString(),
        finishedAt: new Date(baseTime + 4_000).toISOString(),
      }),
    });
    expect(candidateB.status).toBe(201);

    const judge = await authedRequest<{ id: string }>(`/api/tasks/${task.id}/runs`, {
      method: "POST",
      body: JSON.stringify({
        sessionId: sessionRecordId,
        agentType: "judge",
        status: "completed",
        modelUsed: "judge-model",
        result: "candidate 2 is stronger",
        startedAt: new Date(baseTime + 5_000).toISOString(),
        finishedAt: new Date(baseTime + 6_000).toISOString(),
      }),
    });
    expect(judge.status).toBe(201);

    const detail = await authedRequest<{
      data: {
        snapshot: {
          currentStatus: string;
          currentSessionId: string | null;
          latestResult: string | null;
        } | null;
        selectedSessionId: string | null;
        operations: Array<{
          operationKind: string;
          modelId: string | null;
          outputText: string | null;
          metadataJson: Record<string, unknown>;
        }>;
      };
      meta: {
        readSource: string;
        timelineReadSource: string;
      };
    }>(`/api/tasks/${task.id}/execution-trace?sessionId=${sessionRecordId}&includeLineage=false`);

    expect(detail.status).toBe(200);
    expect(detail.data.meta).toEqual(
      expect.objectContaining({
        readSource: "task-session-first",
        timelineReadSource: "task-session-projection",
      }),
    );
    expect(detail.data.data.selectedSessionId).toBe(sessionRecordId);
    expect(detail.data.data.snapshot).toEqual(
      expect.objectContaining({
        currentExecutionMode: "parallel",
        currentExecutionStatus: "running",
        currentSessionId: sessionRecordId,
        latestSessionId: sessionRecordId,
        latestResultSummary: null,
        lifecycleStatus: "active",
      }),
    );
    expect(detail.data.data.operations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          operationKind: "executor",
          modelId: null,
          outputText: null,
          executionStatus: "complete",
          executorLabel: "executor",
          metadataJson: expect.objectContaining({ candidateIndex: 0 }),
        }),
        expect.objectContaining({
          operationKind: "executor",
          modelId: null,
          outputText: null,
          executionStatus: "complete",
          executorLabel: "executor",
          metadataJson: expect.objectContaining({ candidateIndex: 1 }),
        }),
        expect.objectContaining({
          operationKind: "judge",
          modelId: null,
          outputText: null,
          executionStatus: "complete",
          executorLabel: "judge",
        }),
      ]),
    );
  });

  test("reports zero one and two lineage timeline items as session messages accumulate", async () => {
    const task = await createTask(`tree-cache-state-${Date.now()}`);
    const rootRuntimeSessionId = `ses_cache_root_${Date.now()}`;
    const forkRuntimeSessionId = `ses_cache_fork_${Date.now()}`;
    const rootSessionRecordId = taskSessionId(task.id, rootRuntimeSessionId);
    const forkSessionRecordId = taskSessionId(task.id, forkRuntimeSessionId);

    createdNodeIds.add(taskBranchCompatNodeId(task.id, rootRuntimeSessionId));
    createdNodeIds.add(taskBranchCompatNodeId(task.id, forkRuntimeSessionId));

    const rootSession = await authedRequest<{ id: string }>(`/api/tasks/${task.id}/sessions`, {
      method: "POST",
      body: JSON.stringify({
        runtimeSessionId: rootRuntimeSessionId,
        branchName: "main-root",
        sourceType: "root",
        isActive: false,
      }),
    });
    expect(rootSession.status).toBe(201);

    const forkSession = await authedRequest<{ id: string }>(`/api/tasks/${task.id}/sessions`, {
      method: "POST",
      body: JSON.stringify({
        runtimeSessionId: forkRuntimeSessionId,
        parentRuntimeSessionId: rootRuntimeSessionId,
        branchName: "branch-fork",
        sourceType: "fork",
        isActive: true,
      }),
    });
    expect(forkSession.status).toBe(201);

    const noneState = await authedRequest<{
      data: Array<unknown>;
      meta: {
        complete: boolean;
        lineagePath: string[];
        itemCount: number;
      };
    }>(`/api/tasks/${task.id}/sessions/${forkSessionRecordId}/timeline?includeLineage=true`);
    expect(noneState.status).toBe(200);
    expect(noneState.data.meta).toEqual(
      expect.objectContaining({
        complete: false,
        lineagePath: [rootSessionRecordId, forkSessionRecordId],
        itemCount: 0,
      }),
    );

    const timelineBaseTime = Date.now();

    const persistLeafOnly = await authedRequest<{ ok: boolean; seq: number }>(
      `/api/tasks/${task.id}/sessions/messages`,
      {
        method: "POST",
        body: JSON.stringify({
          runtimeSessionId: forkRuntimeSessionId,
          message: {
            info: {
              id: "leaf-only",
              role: "assistant",
              time: {
                created: timelineBaseTime + 1_000,
                completed: timelineBaseTime + 1_000,
              },
            },
            parts: [{ type: "text", text: "只有分支缓存" }],
          },
        }),
      },
    );
    expect(persistLeafOnly.status).toBe(201);

    const partialState = await authedRequest<{
      data: Array<{ displayText: string | null }>;
      meta: {
        complete: boolean;
        lineagePath: string[];
        itemCount: number;
      };
    }>(`/api/tasks/${task.id}/sessions/${forkSessionRecordId}/timeline?includeLineage=true`);
    expect(partialState.status).toBe(200);
    expect(partialState.data.meta).toEqual(
      expect.objectContaining({
        complete: true,
        lineagePath: [rootSessionRecordId, forkSessionRecordId],
        itemCount: 1,
      }),
    );

    const persistRoot = await authedRequest<{ ok: boolean; seq: number }>(
      `/api/tasks/${task.id}/sessions/messages`,
      {
        method: "POST",
        body: JSON.stringify({
          runtimeSessionId: rootRuntimeSessionId,
          message: {
            info: {
              id: "root-user",
              role: "user",
              time: {
                created: timelineBaseTime + 2_000,
                completed: timelineBaseTime + 2_000,
              },
            },
            parts: [{ type: "text", text: "根节点缓存" }],
          },
        }),
      },
    );
    expect(persistRoot.status).toBe(201);

    const completeState = await authedRequest<{
      data: Array<{ displayText: string | null }>;
      meta: {
        complete: boolean;
        lineagePath: string[];
        itemCount: number;
      };
    }>(`/api/tasks/${task.id}/sessions/${forkSessionRecordId}/timeline?includeLineage=true`);
    expect(completeState.status).toBe(200);
    expect(completeState.data.meta).toEqual(
      expect.objectContaining({
        complete: true,
        lineagePath: [rootSessionRecordId, forkSessionRecordId],
        itemCount: 2,
      }),
    );
  });

  test("updates session timeline latest state when a runtime message is rewritten", async () => {
    const task = await createTask(`tree-events-${Date.now()}`);
    const runtimeSessionId = `ses_events_${Date.now()}`;
    const sessionRecordId = taskSessionId(task.id, runtimeSessionId);
    const sessionNodeId = taskBranchCompatNodeId(task.id, runtimeSessionId);

    createdNodeIds.add(sessionNodeId);

    const session = await authedRequest<{ id: string; runtimeSessionId: string }>(
      `/api/tasks/${task.id}/sessions`,
      {
        method: "POST",
        body: JSON.stringify({
          runtimeSessionId,
          branchName: "events-root",
          sourceType: "root",
          isActive: true,
        }),
      },
    );
    expect(session.status).toBe(201);

    const rewriteBaseTime = Date.now();

    const createdPersist = await authedRequest<{ ok: boolean; seq: number }>(
      `/api/tasks/${task.id}/sessions/messages`,
      {
        method: "POST",
        body: JSON.stringify({
          runtimeSessionId,
          message: {
            info: {
              id: "msg-evt-1",
              role: "assistant",
              time: {
                created: rewriteBaseTime + 1_000,
                completed: rewriteBaseTime + 1_000,
              },
            },
            parts: [{ type: "text", text: "进行中结果" }],
          },
        }),
      },
    );
    expect(createdPersist.status).toBe(201);

    const completedPersist = await authedRequest<{ ok: boolean; seq: number }>(
      `/api/tasks/${task.id}/sessions/messages`,
      {
        method: "POST",
        body: JSON.stringify({
          runtimeSessionId,
          message: {
            info: {
              id: "msg-evt-1",
              role: "assistant",
              time: {
                created: rewriteBaseTime + 2_000,
                completed: rewriteBaseTime + 2_000,
              },
            },
            parts: [{ type: "text", text: "最终结果" }],
          },
        }),
      },
    );
    expect(completedPersist.status).toBe(201);

    const events = await authedRequest<{
      data: Array<{
        messageId: string | null;
        itemKind: string;
        itemRole: string | null;
        displayText: string | null;
      }>;
      meta: { includeLineage: boolean; itemCount: number; complete: boolean };
    }>(`/api/tasks/${task.id}/sessions/${sessionRecordId}/timeline?includeLineage=false`);

    expect(events.status).toBe(200);
    expect(events.data.meta).toEqual(
      expect.objectContaining({ includeLineage: false, itemCount: 1, complete: true }),
    );
    expect(events.data.data).toEqual([
      expect.objectContaining({
        itemKind: "message",
        itemRole: "assistant",
        displayText: "最终结果",
      }),
    ]);
  });

  test("builds lineage aware timeline items from session-first projection rows", async () => {
    const task = await createTask(`tree-timeline-${Date.now()}`);
    const rootRuntimeSessionId = `ses_timeline_root_${Date.now()}`;
    const forkRuntimeSessionId = `ses_timeline_fork_${Date.now()}`;
    const rootSessionRecordId = taskSessionId(task.id, rootRuntimeSessionId);
    const forkSessionRecordId = taskSessionId(task.id, forkRuntimeSessionId);
    const rootSessionNodeId = taskBranchCompatNodeId(task.id, rootRuntimeSessionId);
    const forkSessionNodeId = taskBranchCompatNodeId(task.id, forkRuntimeSessionId);

    createdNodeIds.add(rootSessionNodeId);
    createdNodeIds.add(forkSessionNodeId);

    const rootSession = await authedRequest<{ id: string }>(`/api/tasks/${task.id}/sessions`, {
      method: "POST",
      body: JSON.stringify({
        runtimeSessionId: rootRuntimeSessionId,
        branchName: "timeline-root",
        sourceType: "root",
        isActive: false,
      }),
    });
    expect(rootSession.status).toBe(201);

    const timelineBaseTime = Date.now();

    const persistRootUser = await authedRequest<{ ok: boolean; seq: number }>(
      `/api/tasks/${task.id}/sessions/messages`,
      {
        method: "POST",
        body: JSON.stringify({
          runtimeSessionId: rootRuntimeSessionId,
          message: {
            info: {
              id: "root-user",
              role: "user",
              time: {
                created: timelineBaseTime,
                completed: timelineBaseTime,
              },
            },
            parts: [{ type: "text", text: "历史提问" }],
          },
        }),
      },
    );
    expect(persistRootUser.status).toBe(201);

    const persistRootAssistant = await authedRequest<{ ok: boolean; seq: number }>(
      `/api/tasks/${task.id}/sessions/messages`,
      {
        method: "POST",
        body: JSON.stringify({
          runtimeSessionId: rootRuntimeSessionId,
          message: {
            info: {
              id: "root-assistant",
              role: "assistant",
              time: {
                created: timelineBaseTime + 3_000,
                completed: timelineBaseTime + 4_000,
              },
            },
            parts: [{ type: "text", text: "历史回答" }],
          },
        }),
      },
    );
    expect(persistRootAssistant.status).toBe(201);

    const forkSession = await authedRequest<{ id: string }>(`/api/tasks/${task.id}/sessions`, {
      method: "POST",
      body: JSON.stringify({
        runtimeSessionId: forkRuntimeSessionId,
        parentRuntimeSessionId: rootRuntimeSessionId,
        forkedFromMessageId: "root-assistant",
        branchName: "timeline-fork",
        sourceType: "fork",
        isActive: true,
      }),
    });
    expect(forkSession.status).toBe(201);

    for (const [runtimeSessionId, message] of [
      [
        rootRuntimeSessionId,
        {
          info: {
            id: "root-after-fork",
            role: "assistant",
            time: {
              created: timelineBaseTime + 5_000,
              completed: timelineBaseTime + 5_000,
            },
          },
          parts: [{ type: "text", text: "不应出现在 timeline lineage 中" }],
        },
      ],
      [
        forkRuntimeSessionId,
        {
          info: {
            id: "leaf-user",
            role: "user",
            time: {
              created: timelineBaseTime + 60_000,
              completed: timelineBaseTime + 60_000,
            },
          },
          parts: [{ type: "text", text: "当前提问" }],
        },
      ],
      [
        forkRuntimeSessionId,
        {
          info: {
            id: "leaf-assistant",
            role: "assistant",
            time: {
              created: timelineBaseTime + 65_000,
              completed: timelineBaseTime + 65_000,
            },
          },
          parts: [{ type: "text", text: "当前回答" }],
        },
      ],
    ] as const) {
      const persisted = await authedRequest<{ ok: boolean; seq: number }>(
        `/api/tasks/${task.id}/sessions/messages`,
        {
          method: "POST",
          body: JSON.stringify({
            runtimeSessionId,
            message,
          }),
        },
      );
      expect(persisted.status).toBe(201);
    }
    const timeline = await authedRequest<{
      data: Array<{
        id: string;
        itemRole: string | null;
        displayText: string | null;
      }>;
      meta: {
        readSource: string;
        includeLineage: boolean;
        complete: boolean;
        lineagePath: string[];
        itemCount: number;
      };
    }>(`/api/tasks/${task.id}/sessions/${forkSessionRecordId}/timeline?includeLineage=true`);

    expect(timeline.status).toBe(200);
    expect(timeline.data.meta).toEqual(
      expect.objectContaining({
        readSource: "task-session-projection",
        includeLineage: true,
        complete: true,
        lineagePath: [rootSessionRecordId, forkSessionRecordId],
        itemCount: 5,
      }),
    );
    expect(timeline.data.data.map((item) => item.displayText)).toEqual([
      "历史提问",
      "历史回答",
      "不应出现在 timeline lineage 中",
      "当前提问",
      "当前回答",
    ]);
    expect(timeline.data.data[1]).toMatchObject({
      itemRole: "assistant",
      displayText: "历史回答",
    });
  });
});
