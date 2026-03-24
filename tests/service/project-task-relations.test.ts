import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const CP_URL = process.env.TEST_CP_URL || "http://127.0.0.1:4097";
const PROJECT_ID = process.env.TEST_PROJECT_ID || "proj-default";
const USERNAME = process.env.TEST_USERNAME || "admin";
const PASSWORD = process.env.TEST_PASSWORD || "admin123!";
const DB_PATH =
  process.env.TEST_DB_PATH || resolve(__dirname, "../../control-plane/service/data/openerx.db");
const DATABASE_URL =
  process.env.TEST_DATABASE_URL || process.env.DATABASE_URL || "postgres://127.0.0.1:5432/openerx";
const DATABASE_DIALECT =
  process.env.TEST_DATABASE_DIALECT ||
  process.env.DATABASE_DIALECT ||
  (/^(postgres|postgresql):\/\//i.test(DATABASE_URL) ? "postgres" : "sqlite");

const createdTaskIds: string[] = [];
const relationIds: string[] = [];
let token = "";

interface ProjectTreeLinkRecord {
  id: string;
  sourceNodeId: string;
  sourceProjectId: string;
  targetNodeId: string;
  targetProjectId: string;
  linkType: "depends-on" | "blocks" | "cites" | "forked-from" | "spawned" | "related";
  metadata?: Record<string, unknown> | null;
}

async function request<T>(
  path: string,
  opts: RequestInit = {},
): Promise<{ data: T; status: number }> {
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

async function createTask(title: string, relations?: Array<Record<string, unknown>>) {
  const { data, status } = await authedRequest<{ id: string; status: string }>("/api/tasks", {
    method: "POST",
    body: JSON.stringify({
      title,
      prompt: `${title} 的执行说明`,
      projectId: PROJECT_ID,
      ...(relations ? { relations } : {}),
    }),
  });
  expect(status).toBe(201);
  createdTaskIds.push(data.id);
  return data.id;
}

async function createTaskWithBody(title: string, body: Record<string, unknown>) {
  const { data, status } = await authedRequest<{ id: string; status: string }>("/api/tasks", {
    method: "POST",
    body: JSON.stringify({
      title,
      prompt: `${title} 的执行说明`,
      projectId: PROJECT_ID,
      ...body,
    }),
  });
  expect(status).toBe(201);
  createdTaskIds.push(data.id);
  return data.id;
}

beforeAll(async () => {
  token = await login();
});

afterAll(async () => {
  const relationCleanupStatements =
    DATABASE_DIALECT === "postgres"
      ? [
          ...relationIds.map((id) => `DELETE FROM project_tree_links WHERE id='${id}';`),
          ...createdTaskIds.map(
            (id) =>
              `DELETE FROM project_tree_links WHERE source_node_id='${id}' OR target_node_id='${id}';`,
          ),
          ...createdTaskIds.map((id) => `DELETE FROM project_tree_events WHERE node_id='${id}';`),
          ...createdTaskIds.map(
            (id) =>
              `DELETE FROM project_tree_branches WHERE task_node_id='${id}' OR head_node_id='${id}';`,
          ),
          ...createdTaskIds.map((id) => `DELETE FROM project_tree_nodes WHERE id='${id}';`),
        ]
      : [];
  const statements = [
    ...createdTaskIds.map((id) => `DELETE FROM tasks WHERE id='${id}';`),
    ...relationCleanupStatements,
  ];

  if (statements.length === 0) {
    return;
  }

  const { execSync } = await import("node:child_process");
  try {
    if (DATABASE_DIALECT === "postgres") {
      execSync(`psql "${DATABASE_URL}" -v ON_ERROR_STOP=1 -c "${statements.join(" ")}"`, {
        timeout: 5000,
      });
    } else {
      execSync(`sqlite3 "${DB_PATH}" "${statements.join(" ")}"`, { timeout: 5000 });
    }
  } catch {
    console.warn("Cleanup failed for project-task-relations.test.ts");
  }
});

describe("project tree task links", () => {
  test("persists task relations on create and exposes them via project links route", async () => {
    const upstreamTaskId = await createTask(`依赖源任务-${Date.now()}`);
    const blockedTaskId = await createTask(`阻塞目标任务-${Date.now()}`);
    const createdTaskId = await createTask(`派生任务-${Date.now()}`, [
      {
        sourceTaskId: upstreamTaskId,
        type: "depends-on",
        metadata: { reason: "wait-for-upstream" },
      },
      {
        sourceTaskId: blockedTaskId,
        targetTaskId: upstreamTaskId,
        type: "blocks",
        metadata: { severity: "high" },
      },
      {
        sourceTaskId: upstreamTaskId,
        type: "spawned-from",
        metadata: { trigger: "manual-split" },
      },
    ]);

    const { data, status } = await authedRequest<{ data: ProjectTreeLinkRecord[] }>(
      `/api/projects/${PROJECT_ID}/links`,
    );

    expect(status).toBe(200);

    const dependsOn = data.data.find(
      (relation) =>
        relation.sourceNodeId === upstreamTaskId &&
        relation.targetNodeId === createdTaskId &&
        relation.linkType === "depends-on",
    );
    const blocks = data.data.find(
      (relation) =>
        relation.sourceNodeId === blockedTaskId &&
        relation.targetNodeId === upstreamTaskId &&
        relation.linkType === "blocks",
    );
    const spawnedFrom = data.data.find(
      (relation) =>
        relation.sourceNodeId === upstreamTaskId &&
        relation.targetNodeId === createdTaskId &&
        relation.linkType === "spawned",
    );

    expect(dependsOn?.metadata).toEqual({
      reason: "wait-for-upstream",
      relationSource: "task-create",
    });
    expect(blocks?.metadata?.relationSource).toBe("task-create");
    expect(spawnedFrom?.metadata?.relationSource).toBe("task-create");

    relationIds.push(dependsOn?.id, blocks?.id, spawnedFrom?.id);
  });

  test("creates project-level manual links via tree link route", async () => {
    const sourceTaskId = await createTask(`批量关系源-${Date.now()}`);
    const targetTaskId = await createTask(`批量关系目标-${Date.now()}`);

    const { data, status } = await authedRequest<ProjectTreeLinkRecord>(
      `/api/projects/${PROJECT_ID}/tree/${sourceTaskId}/links`,
      {
        method: "POST",
        body: JSON.stringify({
          targetNodeId: targetTaskId,
          linkType: "depends-on",
          metadata: { source: "test", relationSource: "manual" },
        }),
      },
    );

    expect(status).toBe(201);
    expect(data.linkType).toBe("depends-on");
    expect(data.metadata).toEqual({ source: "test", relationSource: "manual" });

    relationIds.push(String(data.id));
  });

  test("expands relationContext into default cross-task tree links", async () => {
    const upstreamTaskId = await createTask(`协议依赖源-${Date.now()}`);
    const blockedTaskId = await createTask(`协议阻塞目标-${Date.now()}`);

    const createdTaskId = await createTaskWithBody(`协议派生任务-${Date.now()}`, {
      relationContext: {
        spawnedFromTaskId: upstreamTaskId,
        dependsOnTaskIds: [upstreamTaskId],
        blocksTaskIds: [blockedTaskId],
      },
    });

    const { data, status } = await authedRequest<{ data: ProjectTreeLinkRecord[] }>(
      `/api/projects/${PROJECT_ID}/links`,
    );

    expect(status).toBe(200);

    const dependsOn = data.data.find(
      (relation) =>
        relation.sourceNodeId === upstreamTaskId &&
        relation.targetNodeId === createdTaskId &&
        relation.linkType === "depends-on",
    );
    const spawnedFrom = data.data.find(
      (relation) =>
        relation.sourceNodeId === upstreamTaskId &&
        relation.targetNodeId === createdTaskId &&
        relation.linkType === "spawned",
    );
    const blocks = data.data.find(
      (relation) =>
        relation.sourceNodeId === createdTaskId &&
        relation.targetNodeId === blockedTaskId &&
        relation.linkType === "blocks",
    );

    expect(dependsOn?.metadata?.relationSource).toBe("task-create");
    expect(spawnedFrom?.metadata?.relationSource).toBe("task-create");
    expect(blocks?.metadata?.relationSource).toBe("task-create");
    expect(dependsOn?.metadata?.protocol).toBe("relation-context-v1");

    relationIds.push(dependsOn?.id, spawnedFrom?.id, blocks?.id);
  });

  test("rejects create-time relations that reference missing tasks", async () => {
    const missingTaskId = `missing-task-${Date.now()}`;
    const { data, status } = await authedRequest<{ error: string }>("/api/tasks", {
      method: "POST",
      body: JSON.stringify({
        title: `非法关系任务-${Date.now()}`,
        prompt: "关系校验",
        projectId: PROJECT_ID,
        relations: [
          {
            sourceTaskId: missingTaskId,
            type: "depends-on",
          },
        ],
      }),
    });

    expect(status).toBe(400);
    expect(data.error).toBe(`Related task ${missingTaskId} not found in this project`);
  });
});
