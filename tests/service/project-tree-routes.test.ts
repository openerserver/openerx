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

function escapeLiteral(value: string) {
  return `'${value.replace(/'/g, "''")}'`;
}

function taskSessionNodeId(taskId: string, runtimeSessionId: string) {
  return `task_session:${taskId}:${runtimeSessionId}`;
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
  if (createdLinkIds.length > 0) {
    await sql.unsafe(
      `DELETE FROM project_tree_links WHERE id IN (${createdLinkIds.map(escapeLiteral).join(", ")})`,
    );
  }

  if (nodeIds.length > 0) {
    const nodeList = nodeIds.map(escapeLiteral).join(", ");
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

    const contextNode = await authedRequest<{ id: string; nodeType: string }>(
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

    const taskLinks = await authedRequest<{
      data: Array<{ id: string; direction: string; targetNodeId: string }>;
    }>(`/api/projects/${PROJECT_ID}/tree/${task.nodeId}/links`);

    expect(taskLinks.status).toBe(200);
    expect(taskLinks.data.data).toContainEqual(
      expect.objectContaining({
        id: createdLink.data.id,
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
    const sessionNodeId = taskSessionNodeId(task.id, runtimeSessionId);

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

    const createdSession = await authedRequest<{ id: string }>(`/api/tasks/${task.id}/branches`, {
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
      `/api/tasks/${task.id}/branches/messages`,
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

    const sessionMessages = await authedRequest<{
      data: Array<{
        info?: { id?: string; role?: string };
        parts?: Array<{ type?: string; text?: string }>;
      }>;
      meta: {
        includeLineage: boolean;
        cacheState: "none" | "partial" | "complete";
        cachedSessionCount: number;
      };
    }>(`/api/tasks/${task.id}/branches/${runtimeSessionId}/messages`);

    expect(sessionMessages.status).toBe(200);
    expect(sessionMessages.data.meta).toEqual(
      expect.objectContaining({
        includeLineage: false,
        cacheState: "complete",
        cachedSessionCount: 1,
      }),
    );
    expect(sessionMessages.data.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          info: expect.objectContaining({ id: "msg-search-1", role: "assistant" }),
          parts: expect.arrayContaining([
            expect.objectContaining({
              type: "text",
              text: "Rollback migration now and verify the final state.",
            }),
          ]),
        }),
      ]),
    );
  });

  test("supports branch-level persisted event feed in chronological order", async () => {
    const task = await createTask(`tree-events-feed-${Date.now()}`);
    const runtimeSessionId = `ses_events_feed_${Date.now()}`;
    const sessionNodeId = taskSessionNodeId(task.id, runtimeSessionId);

    createdNodeIds.add(sessionNodeId);

    const createdSession = await authedRequest<{ id: string }>(`/api/tasks/${task.id}/branches`, {
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
        `/api/tasks/${task.id}/branches/messages`,
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
        seq: number;
        eventType: string;
        payload: {
          runtimeSessionId?: string;
          messageId?: string;
          role?: string | null;
          text?: string | null;
        };
        createdAt: string;
      }>;
      meta: {
        includeLineage: boolean;
        cacheState: "none" | "partial" | "complete";
        cachedSessionCount: number;
        eventCount: number;
      };
    }>(`/api/tasks/${task.id}/branches/${runtimeSessionId}/events`);

    expect(events.status).toBe(200);
    expect(events.data.meta).toEqual(
      expect.objectContaining({
        includeLineage: false,
        cacheState: "complete",
        cachedSessionCount: 1,
        eventCount: 4,
      }),
    );
    expect(events.data.data).toHaveLength(4);
    expect(events.data.data.map((item) => item.eventType)).toEqual([
      "session.message.created",
      "session.message.snapshot",
      "session.message.created",
      "session.message.snapshot",
    ]);
    expect(
      events.data.data.every((item) => item.payload.runtimeSessionId === runtimeSessionId),
    ).toBe(true);
    expect(events.data.data[0]?.payload.messageId).toBe("msg-feed-1");
    expect(events.data.data[0]?.payload.text).toBe("first incremental event payload");
    expect(events.data.data[0]?.seq).toBeLessThan(events.data.data[3]?.seq ?? 0);
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
        executionPlan: JSON.stringify({ mode: "parallel", candidates: [] }),
        parallelRunHistory: JSON.stringify([{ parallelRunId: "legacy-run" }]),
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
    const rootSessionNodeId = taskSessionNodeId(task.id, rootRuntimeSessionId);
    const forkSessionNodeId = taskSessionNodeId(task.id, forkRuntimeSessionId);

    createdNodeIds.add(rootSessionNodeId);
    createdNodeIds.add(forkSessionNodeId);

    const rootSession = await authedRequest<{ id: string; runtimeSessionId: string }>(
      `/api/tasks/${task.id}/branches`,
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
      `/api/tasks/${task.id}/branches`,
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
      `/api/tasks/${task.id}/branches/${forkSessionNodeId}/activate`,
      { method: "POST" },
    );

    expect(activateFork.status).toBe(200);
    expect(activateFork.data.activatedSessionId).toBe(forkRuntimeSessionId);

    const archiveRoot = await authedRequest<{ ok: boolean }>(
      `/api/tasks/${task.id}/branches/${rootSessionNodeId}/archive`,
      { method: "POST" },
    );

    expect(archiveRoot.status).toBe(200);
    expect(archiveRoot.data.ok).toBe(true);

    const sessions = await authedRequest<{
      data: Array<{
        id: string;
        runtimeSessionId: string;
        isActive: boolean;
        archivedAt: string | null;
      }>;
    }>(`/api/tasks/${task.id}/branches`);

    expect(sessions.status).toBe(200);
    expect(sessions.data.data).toContainEqual(
      expect.objectContaining({
        id: rootSessionNodeId,
        runtimeSessionId: rootRuntimeSessionId,
      }),
    );
    expect(sessions.data.data).toContainEqual(
      expect.objectContaining({
        id: forkSessionNodeId,
        runtimeSessionId: forkRuntimeSessionId,
      }),
    );
    expect(sessions.data.data).toContainEqual(
      expect.objectContaining({
        runtimeSessionId: rootRuntimeSessionId,
        isActive: false,
        archivedAt: expect.any(String),
      }),
    );
    expect(sessions.data.data).toContainEqual(
      expect.objectContaining({
        runtimeSessionId: forkRuntimeSessionId,
        isActive: true,
        archivedAt: null,
      }),
    );

    const rootNode = await authedRequest<{
      id: string;
      isActive: boolean;
      archivedAt: string | null;
      parentId: string | null;
    }>(`/api/projects/${PROJECT_ID}/tree/${rootSessionNodeId}`);

    expect(rootNode.status).toBe(200);
    expect(rootNode.data.parentId).toBe(task.id);
    expect(rootNode.data.isActive).toBe(false);
    expect(rootNode.data.archivedAt).toEqual(expect.any(String));

    const forkNode = await authedRequest<{
      id: string;
      isActive: boolean;
      archivedAt: string | null;
      parentId: string | null;
    }>(`/api/projects/${PROJECT_ID}/tree/${forkSessionNodeId}`);

    expect(forkNode.status).toBe(200);
    expect(forkNode.data.parentId).toBe(rootSessionNodeId);
    expect(forkNode.data.isActive).toBe(true);
    expect(forkNode.data.archivedAt).toBeNull();

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

  test("reactivating an archived session clears legacy and tree archived state", async () => {
    const task = await createTask(`tree-reactivate-${Date.now()}`);
    const rootRuntimeSessionId = `ses_reactivate_root_${Date.now()}`;
    const forkRuntimeSessionId = `ses_reactivate_fork_${Date.now()}`;
    const rootSessionNodeId = taskSessionNodeId(task.id, rootRuntimeSessionId);
    const forkSessionNodeId = taskSessionNodeId(task.id, forkRuntimeSessionId);

    createdNodeIds.add(rootSessionNodeId);
    createdNodeIds.add(forkSessionNodeId);

    const rootSession = await authedRequest<{ id: string }>(`/api/tasks/${task.id}/branches`, {
      method: "POST",
      body: JSON.stringify({
        runtimeSessionId: rootRuntimeSessionId,
        branchName: "main-root",
        sourceType: "root",
        isActive: true,
      }),
    });
    expect(rootSession.status).toBe(201);

    const forkSession = await authedRequest<{ id: string }>(`/api/tasks/${task.id}/branches`, {
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
      `/api/tasks/${task.id}/branches/${rootSessionNodeId}/archive`,
      { method: "POST" },
    );
    expect(archiveRoot.status).toBe(200);
    expect(archiveRoot.data.ok).toBe(true);

    const reactivateRoot = await authedRequest<{ ok: boolean; activatedSessionId: string }>(
      `/api/tasks/${task.id}/branches/${rootSessionNodeId}/activate`,
      { method: "POST" },
    );
    expect(reactivateRoot.status).toBe(200);
    expect(reactivateRoot.data.activatedSessionId).toBe(rootRuntimeSessionId);

    const sessions = await authedRequest<{
      data: Array<{
        id: string;
        runtimeSessionId: string;
        isActive: boolean;
        archivedAt: string | null;
      }>;
    }>(`/api/tasks/${task.id}/branches`);

    expect(sessions.status).toBe(200);
    expect(sessions.data.data).toContainEqual(
      expect.objectContaining({
        id: rootSessionNodeId,
        runtimeSessionId: rootRuntimeSessionId,
        isActive: true,
        archivedAt: null,
      }),
    );
    expect(sessions.data.data).toContainEqual(
      expect.objectContaining({
        id: forkSessionNodeId,
        runtimeSessionId: forkRuntimeSessionId,
        isActive: false,
      }),
    );

    const rootNode = await authedRequest<{
      id: string;
      isActive: boolean;
      archivedAt: string | null;
      parentId: string | null;
    }>(`/api/projects/${PROJECT_ID}/tree/${rootSessionNodeId}`);

    expect(rootNode.status).toBe(200);
    expect(rootNode.data.parentId).toBe(task.id);
    expect(rootNode.data.isActive).toBe(true);
    expect(rootNode.data.archivedAt).toBeNull();
  });

  test("keeps session reads and writes alive from legacy tree lineage records only", async () => {
    const task = await createTask(`tree-primary-session-${Date.now()}`);
    const rootRuntimeSessionId = `ses_primary_root_${Date.now()}`;
    const forkRuntimeSessionId = `ses_primary_fork_${Date.now()}`;
    const rootSessionNodeId = taskSessionNodeId(task.id, rootRuntimeSessionId);
    const forkSessionNodeId = taskSessionNodeId(task.id, forkRuntimeSessionId);

    createdNodeIds.add(rootSessionNodeId);
    createdNodeIds.add(forkSessionNodeId);

    const rootSession = await authedRequest<{ id: string }>(`/api/tasks/${task.id}/branches`, {
      method: "POST",
      body: JSON.stringify({
        runtimeSessionId: rootRuntimeSessionId,
        branchName: "main-root",
        sourceType: "root",
        isActive: true,
      }),
    });
    expect(rootSession.status).toBe(201);

    const forkSession = await authedRequest<{ id: string }>(`/api/tasks/${task.id}/branches`, {
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
    }>(`/api/tasks/${task.id}/branches`);

    expect(listed.status).toBe(200);
    expect(listed.data.data).toContainEqual(
      expect.objectContaining({ id: rootSessionNodeId, runtimeSessionId: rootRuntimeSessionId }),
    );
    expect(listed.data.data).toContainEqual(
      expect.objectContaining({ id: forkSessionNodeId, runtimeSessionId: forkRuntimeSessionId }),
    );

    const activateFork = await authedRequest<{ ok: boolean; activatedSessionId: string }>(
      `/api/tasks/${task.id}/branches/${forkSessionNodeId}/activate`,
      { method: "POST" },
    );

    expect(activateFork.status).toBe(200);
    expect(activateFork.data.activatedSessionId).toBe(forkRuntimeSessionId);

    const persistForkMessage = await authedRequest<{ ok: boolean; seq: number }>(
      `/api/tasks/${task.id}/branches/messages`,
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

    const replayed = await authedRequest<{
      data: Array<{ info: { id: string }; parts: Array<{ type: string; text?: string }> }>;
    }>(`/api/tasks/${task.id}/branches/${forkRuntimeSessionId}/messages`);

    expect(replayed.status).toBe(200);
    expect(replayed.data.data[0]?.info.id).toBe("fork-msg-1");
    expect(replayed.data.data[0]?.parts).toEqual([
      { type: "text", text: "tree-first session payload" },
    ]);

    const branchNodes = await sql.unsafe<Array<{ id: string; runtime_session_id: string | null }>>(
      `SELECT id, runtime_session_id FROM project_tree_nodes WHERE node_type = 'session' AND id LIKE $1 ORDER BY runtime_session_id`,
      [`task_session:${task.id}:%`],
    );

    expect(branchNodes.some((row) => row.runtime_session_id === forkRuntimeSessionId)).toBe(true);
  });

  test("reads single-session messages from conversation tables when legacy tree message events are absent", async () => {
    const task = await createTask(`conversation-primary-${Date.now()}`);
    const runtimeSessionId = `ses_conversation_${Date.now()}`;
    const sessionNodeId = taskSessionNodeId(task.id, runtimeSessionId);

    createdNodeIds.add(sessionNodeId);

    const session = await authedRequest<{ id: string }>(`/api/tasks/${task.id}/branches`, {
      method: "POST",
      body: JSON.stringify({
        runtimeSessionId,
        branchName: "conversation-main",
        sourceType: "root",
        isActive: true,
      }),
    });

    expect(session.status).toBe(201);

    const persisted = await authedRequest<{ ok: boolean }>(
      `/api/tasks/${task.id}/branches/messages`,
      {
        method: "POST",
        body: JSON.stringify({
          runtimeSessionId,
          message: {
            info: {
              id: "msg-conversation-1",
              role: "assistant",
              time: { created: Date.parse("2026-03-22T09:00:00.000Z") },
            },
            parts: [{ type: "text", text: "conversation table answer" }],
          },
        }),
      },
    );

    expect(persisted.status).toBe(201);
    const messages = await authedRequest<{
      data: Array<Record<string, unknown>>;
      meta: { cacheState: string; complete: boolean; readSource?: string };
    }>(`/api/tasks/${task.id}/branches/${runtimeSessionId}/messages`);

    expect(messages.status).toBe(200);
    expect(messages.data.meta.cacheState).toBe("complete");
    expect(messages.data.meta.complete).toBe(true);
    expect(messages.data.meta.readSource).toBe("conversation-table");
    expect(messages.data.data).toHaveLength(1);
    expect(messages.data.data[0]).toMatchObject({
      info: expect.objectContaining({ id: "msg-conversation-1", role: "assistant" }),
    });
  });

  test("persists task session messages in conversation storage and replays latest state", async () => {
    const task = await createTask(`tree-message-cache-${Date.now()}`);
    const runtimeSessionId = `ses_cached_${Date.now()}`;
    const sessionNodeId = taskSessionNodeId(task.id, runtimeSessionId);

    createdNodeIds.add(sessionNodeId);

    const session = await authedRequest<{ id: string; runtimeSessionId: string }>(
      `/api/tasks/${task.id}/branches`,
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

    const firstPersist = await authedRequest<{ ok: boolean; seq: number }>(
      `/api/tasks/${task.id}/branches/messages`,
      {
        method: "POST",
        body: JSON.stringify({
          runtimeSessionId,
          message: {
            info: {
              id: "msg-1",
              role: "assistant",
              time: { completed: Date.parse("2026-03-12T10:03:00.000Z") },
            },
            parts: [{ type: "text", text: "draft result" }],
          },
        }),
      },
    );

    expect(firstPersist.status).toBe(201);
    expect(firstPersist.data.seq).toBeGreaterThan(0);

    const secondPersist = await authedRequest<{ ok: boolean; seq: number }>(
      `/api/tasks/${task.id}/branches/messages`,
      {
        method: "POST",
        body: JSON.stringify({
          runtimeSessionId,
          message: {
            info: {
              id: "msg-1",
              role: "assistant",
              time: { completed: Date.parse("2026-03-12T10:03:01.000Z") },
            },
            parts: [{ type: "text", text: "final result" }],
          },
        }),
      },
    );

    expect(secondPersist.status).toBe(201);
    expect(secondPersist.data.seq).toBeGreaterThan(firstPersist.data.seq);

    const replayed = await authedRequest<{
      data: Array<{ info: { id: string }; parts: Array<{ type: string; text?: string }> }>;
    }>(`/api/tasks/${task.id}/branches/${runtimeSessionId}/messages`);

    expect(replayed.status).toBe(200);
    expect(replayed.data.data).toHaveLength(1);
    expect(replayed.data.data[0]?.info.id).toBe("msg-1");
    expect(replayed.data.data[0]?.parts).toEqual([{ type: "text", text: "final result" }]);
  });

  test("aggregates lineage-aware session messages from persisted conversation state", async () => {
    const task = await createTask(`tree-lineage-cache-${Date.now()}`);
    const rootRuntimeSessionId = `ses_lineage_root_${Date.now()}`;
    const forkRuntimeSessionId = `ses_lineage_fork_${Date.now()}`;
    const rootSessionNodeId = taskSessionNodeId(task.id, rootRuntimeSessionId);
    const forkSessionNodeId = taskSessionNodeId(task.id, forkRuntimeSessionId);

    createdNodeIds.add(rootSessionNodeId);
    createdNodeIds.add(forkSessionNodeId);

    const rootSession = await authedRequest<{ id: string; runtimeSessionId: string }>(
      `/api/tasks/${task.id}/branches`,
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

    const forkSession = await authedRequest<{ id: string; runtimeSessionId: string }>(
      `/api/tasks/${task.id}/branches`,
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

    const persistRootUser = await authedRequest<{ ok: boolean; seq: number }>(
      `/api/tasks/${task.id}/branches/messages`,
      {
        method: "POST",
        body: JSON.stringify({
          runtimeSessionId: rootRuntimeSessionId,
          message: {
            info: { id: "root-user", role: "user" },
            parts: [{ type: "text", text: "历史提问" }],
          },
        }),
      },
    );
    expect(persistRootUser.status).toBe(201);

    const persistRootAssistant = await authedRequest<{ ok: boolean; seq: number }>(
      `/api/tasks/${task.id}/branches/messages`,
      {
        method: "POST",
        body: JSON.stringify({
          runtimeSessionId: rootRuntimeSessionId,
          message: {
            info: { id: "root-assistant", role: "assistant" },
            parts: [{ type: "text", text: "历史回答" }],
          },
        }),
      },
    );
    expect(persistRootAssistant.status).toBe(201);

    const persistRootAfterFork = await authedRequest<{ ok: boolean; seq: number }>(
      `/api/tasks/${task.id}/branches/messages`,
      {
        method: "POST",
        body: JSON.stringify({
          runtimeSessionId: rootRuntimeSessionId,
          message: {
            info: { id: "root-after-fork", role: "assistant" },
            parts: [{ type: "text", text: "不应再进入分叉上下文" }],
          },
        }),
      },
    );
    expect(persistRootAfterFork.status).toBe(201);

    const persistLeafUser = await authedRequest<{ ok: boolean; seq: number }>(
      `/api/tasks/${task.id}/branches/messages`,
      {
        method: "POST",
        body: JSON.stringify({
          runtimeSessionId: forkRuntimeSessionId,
          message: {
            info: { id: "leaf-user", role: "user" },
            parts: [{ type: "text", text: "当前提问" }],
          },
        }),
      },
    );
    expect(persistLeafUser.status).toBe(201);

    const persistLeafAssistant = await authedRequest<{ ok: boolean; seq: number }>(
      `/api/tasks/${task.id}/branches/messages`,
      {
        method: "POST",
        body: JSON.stringify({
          runtimeSessionId: forkRuntimeSessionId,
          message: {
            info: { id: "leaf-assistant", role: "assistant" },
            parts: [{ type: "text", text: "当前回答" }],
          },
        }),
      },
    );
    expect(persistLeafAssistant.status).toBe(201);

    const replayed = await authedRequest<{
      data: Array<{ info: { id: string }; parts: Array<{ type: string; text?: string }> }>;
      meta: {
        includeLineage: boolean;
        cacheState: "none" | "partial" | "complete";
        complete: boolean;
        lineagePath: string[];
        cachedSessionCount: number;
      };
    }>(`/api/tasks/${task.id}/branches/${forkRuntimeSessionId}/messages?includeLineage=true`);

    expect(replayed.status).toBe(200);
    expect(replayed.data.meta).toEqual(
      expect.objectContaining({
        includeLineage: true,
        cacheState: "complete",
        complete: true,
        lineagePath: [rootRuntimeSessionId, forkRuntimeSessionId],
        cachedSessionCount: 2,
        readSource: "conversation-table",
      }),
    );
    expect(replayed.data.data.map((message) => message.info.id)).toEqual([
      "root-user",
      "root-assistant",
      "leaf-user",
      "leaf-assistant",
    ]);
  });

  test("aggregates lineage-aware session messages from conversation tables across lineage", async () => {
    const task = await createTask(`conversation-lineage-${Date.now()}`);
    const rootRuntimeSessionId = `ses_conversation_root_${Date.now()}`;
    const forkRuntimeSessionId = `ses_conversation_fork_${Date.now()}`;
    const rootSessionNodeId = taskSessionNodeId(task.id, rootRuntimeSessionId);
    const forkSessionNodeId = taskSessionNodeId(task.id, forkRuntimeSessionId);

    createdNodeIds.add(rootSessionNodeId);
    createdNodeIds.add(forkSessionNodeId);

    await authedRequest(`/api/tasks/${task.id}/branches`, {
      method: "POST",
      body: JSON.stringify({
        runtimeSessionId: rootRuntimeSessionId,
        branchName: "conversation-root",
        sourceType: "root",
        isActive: false,
      }),
    });

    await authedRequest(`/api/tasks/${task.id}/branches`, {
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
        { info: { id: "root-user", role: "user" }, parts: [{ type: "text", text: "历史提问" }] },
      ],
      [
        rootRuntimeSessionId,
        {
          info: { id: "root-assistant", role: "assistant" },
          parts: [{ type: "text", text: "历史回答" }],
        },
      ],
      [
        rootRuntimeSessionId,
        {
          info: { id: "root-after-fork", role: "assistant" },
          parts: [{ type: "text", text: "不应再进入分叉上下文" }],
        },
      ],
      [
        forkRuntimeSessionId,
        { info: { id: "leaf-user", role: "user" }, parts: [{ type: "text", text: "当前提问" }] },
      ],
      [
        forkRuntimeSessionId,
        {
          info: { id: "leaf-assistant", role: "assistant" },
          parts: [{ type: "text", text: "当前回答" }],
        },
      ],
    ] as const) {
      const persisted = await authedRequest<{ ok: boolean }>(
        `/api/tasks/${task.id}/branches/messages`,
        {
          method: "POST",
          body: JSON.stringify({ runtimeSessionId, message }),
        },
      );
      expect(persisted.status).toBe(201);
    }
    const replayed = await authedRequest<{
      data: Array<{ info: { id: string } }>;
      meta: {
        includeLineage: boolean;
        cacheState: "none" | "partial" | "complete";
        complete: boolean;
        lineagePath: string[];
        cachedSessionCount: number;
        readSource: string;
      };
    }>(`/api/tasks/${task.id}/branches/${forkRuntimeSessionId}/messages?includeLineage=true`);

    expect(replayed.status).toBe(200);
    expect(replayed.data.meta).toEqual(
      expect.objectContaining({
        includeLineage: true,
        cacheState: "complete",
        complete: true,
        lineagePath: [rootRuntimeSessionId, forkRuntimeSessionId],
        cachedSessionCount: 2,
        readSource: "conversation-table",
      }),
    );
    expect(replayed.data.data.map((message) => message.info.id)).toEqual([
      "root-user",
      "root-assistant",
      "leaf-user",
      "leaf-assistant",
    ]);
  });

  test("returns task domain run detail with candidate and judge nodes", async () => {
    const task = await createTask(`domain-run-detail-${Date.now()}`);
    const rootRuntimeSessionId = `ses_domain_run_${Date.now()}`;

    const patchedTask = await authedRequest(`/api/tasks/${task.id}`, {
      method: "PATCH",
      body: JSON.stringify({
        status: "running",
        sessionId: rootRuntimeSessionId,
        executionMode: "parallel",
      }),
    });
    expect(patchedTask.status).toBe(200);

    const candidateA = await authedRequest<{ id: string }>(`/api/tasks/${task.id}/runs`, {
      method: "POST",
      body: JSON.stringify({
        sessionId: rootRuntimeSessionId,
        agentType: "executor",
        candidateIndex: 0,
        status: "completed",
        modelUsed: "model-a",
        result: "answer-a",
      }),
    });
    expect(candidateA.status).toBe(201);

    const candidateB = await authedRequest<{ id: string }>(`/api/tasks/${task.id}/runs`, {
      method: "POST",
      body: JSON.stringify({
        sessionId: rootRuntimeSessionId,
        agentType: "executor",
        candidateIndex: 1,
        status: "completed",
        modelUsed: "model-b",
        result: "answer-b",
      }),
    });
    expect(candidateB.status).toBe(201);

    const judge = await authedRequest<{ id: string }>(`/api/tasks/${task.id}/runs`, {
      method: "POST",
      body: JSON.stringify({
        sessionId: rootRuntimeSessionId,
        agentType: "judge",
        status: "completed",
        modelUsed: "judge-model",
        result: "candidate 2 is stronger",
      }),
    });
    expect(judge.status).toBe(201);

    const domainRuns = await authedRequest<{ data: Array<{ id: string }> }>(
      `/api/tasks/${task.id}/domain-runs`,
    );
    expect(domainRuns.status).toBe(200);
    const runId = domainRuns.data.data[0]?.id;
    expect(runId).toBeTruthy();

    await sql.unsafe(
      `UPDATE task_runs
       SET winner_node_id = (
         SELECT id FROM task_run_nodes WHERE run_id = $1 AND candidate_index = 1 LIMIT 1
       ),
           judge_node_id = (
         SELECT id FROM task_run_nodes WHERE run_id = $1 AND node_kind = 'judge' LIMIT 1
       )
       WHERE id = $1`,
      [runId],
    );

    const detail = await authedRequest<{
      data: {
        run: {
          id: string;
          orchestrationKind: string;
          winnerNodeId?: string | null;
          judgeNodeId?: string | null;
        };
        nodes: Array<{ id: string; nodeKind: string }>;
        candidateNodes: Array<{
          candidateIndex?: number | null;
          modelUsed?: string | null;
          resultSummary?: string | null;
        }>;
        judgeNode: { nodeKind: string; resultSummary?: string | null } | null;
        winnerCandidateIndex: number | null;
      };
    }>(`/api/tasks/${task.id}/domain-runs/${runId}`);

    expect(detail.status).toBe(200);
    expect(detail.data.data.run.id).toBe(runId);
    expect(detail.data.data.run.orchestrationKind).toBe("parallel");
    expect(detail.data.data.nodes.some((node) => node.nodeKind === "judge")).toBe(true);
    expect(detail.data.data.candidateNodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          candidateIndex: 0,
          modelUsed: "model-a",
          resultSummary: "answer-a",
        }),
        expect.objectContaining({
          candidateIndex: 1,
          modelUsed: "model-b",
          resultSummary: "answer-b",
        }),
      ]),
    );
    expect(detail.data.data.judgeNode).toEqual(
      expect.objectContaining({ nodeKind: "judge", resultSummary: "candidate 2 is stronger" }),
    );
    expect(detail.data.data.winnerCandidateIndex).toBe(1);
  });

  test("reports none partial and complete cache states for lineage aggregation", async () => {
    const task = await createTask(`tree-cache-state-${Date.now()}`);
    const rootRuntimeSessionId = `ses_cache_root_${Date.now()}`;
    const forkRuntimeSessionId = `ses_cache_fork_${Date.now()}`;

    createdNodeIds.add(taskSessionNodeId(task.id, rootRuntimeSessionId));
    createdNodeIds.add(taskSessionNodeId(task.id, forkRuntimeSessionId));

    const rootSession = await authedRequest<{ id: string }>(`/api/tasks/${task.id}/branches`, {
      method: "POST",
      body: JSON.stringify({
        runtimeSessionId: rootRuntimeSessionId,
        branchName: "main-root",
        sourceType: "root",
        isActive: false,
      }),
    });
    expect(rootSession.status).toBe(201);

    const forkSession = await authedRequest<{ id: string }>(`/api/tasks/${task.id}/branches`, {
      method: "POST",
      body: JSON.stringify({
        runtimeSessionId: forkRuntimeSessionId,
        parentRuntimeSessionId: rootRuntimeSessionId,
        forkedFromMessageId: "root-user",
        branchName: "branch-fork",
        sourceType: "fork",
        isActive: true,
      }),
    });
    expect(forkSession.status).toBe(201);

    const noneState = await authedRequest<{
      data: Array<unknown>;
      meta: {
        cacheState: "none" | "partial" | "complete";
        complete: boolean;
        cachedSessionCount: number;
      };
    }>(`/api/tasks/${task.id}/branches/${forkRuntimeSessionId}/messages?includeLineage=true`);
    expect(noneState.status).toBe(200);
    expect(noneState.data.meta).toEqual(
      expect.objectContaining({
        cacheState: "none",
        complete: false,
        cachedSessionCount: 0,
      }),
    );

    const persistLeafOnly = await authedRequest<{ ok: boolean; seq: number }>(
      `/api/tasks/${task.id}/branches/messages`,
      {
        method: "POST",
        body: JSON.stringify({
          runtimeSessionId: forkRuntimeSessionId,
          message: {
            info: { id: "leaf-only", role: "assistant" },
            parts: [{ type: "text", text: "只有分支缓存" }],
          },
        }),
      },
    );
    expect(persistLeafOnly.status).toBe(201);

    const partialState = await authedRequest<{
      data: Array<unknown>;
      meta: {
        cacheState: "none" | "partial" | "complete";
        complete: boolean;
        cachedSessionCount: number;
      };
    }>(`/api/tasks/${task.id}/branches/${forkRuntimeSessionId}/messages?includeLineage=true`);
    expect(partialState.status).toBe(200);
    expect(partialState.data.meta).toEqual(
      expect.objectContaining({
        cacheState: "partial",
        complete: false,
        cachedSessionCount: 1,
      }),
    );

    const persistRoot = await authedRequest<{ ok: boolean; seq: number }>(
      `/api/tasks/${task.id}/branches/messages`,
      {
        method: "POST",
        body: JSON.stringify({
          runtimeSessionId: rootRuntimeSessionId,
          message: {
            info: { id: "root-user", role: "user" },
            parts: [{ type: "text", text: "根节点缓存" }],
          },
        }),
      },
    );
    expect(persistRoot.status).toBe(201);

    const completeState = await authedRequest<{
      data: Array<unknown>;
      meta: {
        cacheState: "none" | "partial" | "complete";
        complete: boolean;
        cachedSessionCount: number;
      };
    }>(`/api/tasks/${task.id}/branches/${forkRuntimeSessionId}/messages?includeLineage=true`);
    expect(completeState.status).toBe(200);
    expect(completeState.data.meta).toEqual(
      expect.objectContaining({
        cacheState: "complete",
        complete: true,
        cachedSessionCount: 2,
      }),
    );
  });

  test("records synthetic session message events from conversation domain history", async () => {
    const task = await createTask(`tree-events-${Date.now()}`);
    const runtimeSessionId = `ses_events_${Date.now()}`;
    const sessionNodeId = taskSessionNodeId(task.id, runtimeSessionId);

    createdNodeIds.add(sessionNodeId);

    const session = await authedRequest<{ id: string; runtimeSessionId: string }>(
      `/api/tasks/${task.id}/branches`,
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

    const createdPersist = await authedRequest<{ ok: boolean; seq: number }>(
      `/api/tasks/${task.id}/branches/messages`,
      {
        method: "POST",
        body: JSON.stringify({
          runtimeSessionId,
          message: {
            info: { id: "msg-evt-1", role: "assistant" },
            parts: [{ type: "text", text: "进行中结果" }],
          },
        }),
      },
    );
    expect(createdPersist.status).toBe(201);

    const completedPersist = await authedRequest<{ ok: boolean; seq: number }>(
      `/api/tasks/${task.id}/branches/messages`,
      {
        method: "POST",
        body: JSON.stringify({
          runtimeSessionId,
          message: {
            info: {
              id: "msg-evt-1",
              role: "assistant",
              time: { completed: Date.parse("2026-03-12T10:03:02.000Z") },
            },
            parts: [{ type: "text", text: "最终结果" }],
          },
        }),
      },
    );
    expect(completedPersist.status).toBe(201);
    const events = await authedRequest<{
      data: Array<{
        eventType: string;
        payload: { messageId?: string; text?: string | null; completedAt?: number | null };
      }>;
      meta: { cacheState: "none" | "partial" | "complete"; eventCount: number };
    }>(`/api/tasks/${task.id}/branches/${runtimeSessionId}/events`);

    expect(events.status).toBe(200);
    expect(events.data.meta.cacheState).toBe("complete");
    expect(events.data.meta.eventCount).toBe(4);
    expect(events.data.data.map((event) => event.eventType)).toEqual([
      "session.message.created",
      "session.message.snapshot",
      "session.message.updated",
      "session.message.completed",
    ]);
    expect(events.data.data[0]?.payload).toMatchObject({
      messageId: "msg-evt-1",
      text: "进行中结果",
    });
    expect(events.data.data[3]?.payload).toMatchObject({
      messageId: "msg-evt-1",
      completedAt: Date.parse("2026-03-12T10:03:02.000Z"),
    });
  });

  test("builds lineage aware timeline items from conversation state with historical replay metadata", async () => {
    const task = await createTask(`tree-timeline-${Date.now()}`);
    const rootRuntimeSessionId = `ses_timeline_root_${Date.now()}`;
    const forkRuntimeSessionId = `ses_timeline_fork_${Date.now()}`;
    const rootSessionNodeId = taskSessionNodeId(task.id, rootRuntimeSessionId);
    const forkSessionNodeId = taskSessionNodeId(task.id, forkRuntimeSessionId);

    createdNodeIds.add(rootSessionNodeId);
    createdNodeIds.add(forkSessionNodeId);

    const rootSession = await authedRequest<{ id: string }>(`/api/tasks/${task.id}/branches`, {
      method: "POST",
      body: JSON.stringify({
        runtimeSessionId: rootRuntimeSessionId,
        branchName: "timeline-root",
        sourceType: "root",
        isActive: false,
      }),
    });
    expect(rootSession.status).toBe(201);

    const forkSession = await authedRequest<{ id: string }>(`/api/tasks/${task.id}/branches`, {
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
            id: "root-user",
            role: "user",
            time: { created: Date.parse("2026-03-20T09:00:00.000Z") },
          },
          parts: [{ type: "text", text: "历史提问" }],
        },
      ],
      [
        rootRuntimeSessionId,
        {
          info: {
            id: "root-assistant",
            role: "assistant",
            time: {
              created: Date.parse("2026-03-20T09:00:03.000Z"),
              completed: Date.parse("2026-03-20T09:00:04.000Z"),
            },
          },
          parts: [{ type: "text", text: "历史回答" }],
        },
      ],
      [
        rootRuntimeSessionId,
        {
          info: {
            id: "root-after-fork",
            role: "assistant",
            time: { created: Date.parse("2026-03-20T09:00:05.000Z") },
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
            time: { created: Date.parse("2026-03-20T09:01:00.000Z") },
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
            time: { created: Date.parse("2026-03-20T09:01:05.000Z") },
          },
          parts: [{ type: "text", text: "当前回答" }],
        },
      ],
    ] as const) {
      const persisted = await authedRequest<{ ok: boolean; seq: number }>(
        `/api/tasks/${task.id}/branches/messages`,
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
        role: string;
        text: string;
        createdAt?: string;
        completedAt?: string | null;
        sourceEventTypes: string[];
      }>;
      meta: {
        cacheState: "none" | "partial" | "complete";
        complete: boolean;
        cachedSessionCount: number;
        lineagePath: string[];
        itemCount: number;
      };
    }>(`/api/tasks/${task.id}/branches/${forkRuntimeSessionId}/timeline?includeLineage=true`);

    expect(timeline.status).toBe(200);
    expect(timeline.data.meta).toEqual({
      includeLineage: true,
      cacheState: "complete",
      complete: true,
      cachedSessionCount: 2,
      lineagePath: [rootRuntimeSessionId, forkRuntimeSessionId],
      itemCount: 4,
    });
    expect(timeline.data.data.map((item) => item.id)).toEqual([
      "root-user",
      "root-assistant",
      "leaf-user",
      "leaf-assistant",
    ]);
    expect(timeline.data.data[1]).toMatchObject({
      id: "root-assistant",
      role: "assistant",
      text: "历史回答",
      completedAt: "2026-03-20T09:00:04.000Z",
    });
    expect(timeline.data.data[1]?.sourceEventTypes).toEqual([
      "session.message.created",
      "session.message.completed",
      "session.message.snapshot",
    ]);
  });
});
