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
  const nodeIds = Array.from(createdNodeIds);
  if (createdLinkIds.length > 0) {
    await sql.unsafe(
      `DELETE FROM project_tree_links WHERE id IN (${createdLinkIds.map(escapeLiteral).join(", ")})`,
    );
  }

  if (nodeIds.length > 0) {
    const nodeList = nodeIds.map(escapeLiteral).join(", ");
    await sql.unsafe(
      `DELETE FROM project_tree_links WHERE source_node_id IN (${nodeList}) OR target_node_id IN (${nodeList})`,
    );
    await sql.unsafe(`DELETE FROM project_tree_events WHERE node_id IN (${nodeList})`);
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

    const createdLink = await authedRequest<{ id: string; sourceNodeId: string; targetNodeId: string }>(
      `/api/projects/${PROJECT_ID}/tree/${task.nodeId}/links`,
      {
        method: "POST",
        body: JSON.stringify({
          targetNodeId: contextNode.data.id,
          linkType: "cites",
          metadata: { source: "project-tree-routes-test" },
        }),
      },
    );

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
    expect(taskNode.data.contentJson).toMatchObject({
      status: "running",
      sessionId: "ses_task_sync_runtime",
      selectedModel: "github-copilot:gpt-5.4",
      executionMode: "parallel",
      workingBranch: "feature/tree-sync",
      result: "task node should mirror latest task state",
    });
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
    expect(taskNode.data.contentJson).toMatchObject({
      status: "running",
      sessionId: "ses_primary_tree_task",
      workingBranch: "feature/tree-primary-task",
    });
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

  test("keeps session reads and writes alive from tree-backed lineage only", async () => {
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

  test("persists task session message snapshots in tree events and replays latest state", async () => {
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

  test("aggregates lineage-aware session messages from tree events", async () => {
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
    expect(replayed.data.meta).toEqual({
      includeLineage: true,
      cacheState: "complete",
      complete: true,
      lineagePath: [rootRuntimeSessionId, forkRuntimeSessionId],
      cachedSessionCount: 2,
    });
    expect(replayed.data.data.map((message) => message.info.id)).toEqual([
      "root-user",
      "root-assistant",
      "leaf-user",
      "leaf-assistant",
    ]);
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
      meta: { cacheState: "none" | "partial" | "complete"; complete: boolean; cachedSessionCount: number };
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
      meta: { cacheState: "none" | "partial" | "complete"; complete: boolean; cachedSessionCount: number };
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
      meta: { cacheState: "none" | "partial" | "complete"; complete: boolean; cachedSessionCount: number };
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

  test("records fine grained session message events for future trace and timeline reads", async () => {
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
      data: Array<{ eventType: string; payload: { messageId?: string; text?: string | null; completedAt?: number | null } }>;
      meta: { cacheState: "none" | "partial" | "complete"; eventCount: number };
    }>(`/api/tasks/${task.id}/branches/${runtimeSessionId}/events`);

    expect(events.status).toBe(200);
    expect(events.data.meta.cacheState).toBe("complete");
    expect(events.data.meta.eventCount).toBe(5);
    expect(events.data.data.map((event) => event.eventType)).toEqual([
      "session.message.created",
      "session.message.snapshot",
      "session.message.updated",
      "session.message.completed",
      "session.message.snapshot",
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

  test("builds lineage aware timeline items directly from persisted tree events", async () => {
    const task = await createTask(`tree-timeline-${Date.now()}`);
    const rootRuntimeSessionId = `ses_timeline_root_${Date.now()}`;
    const forkRuntimeSessionId = `ses_timeline_fork_${Date.now()}`;

    createdNodeIds.add(taskSessionNodeId(task.id, rootRuntimeSessionId));
    createdNodeIds.add(taskSessionNodeId(task.id, forkRuntimeSessionId));

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