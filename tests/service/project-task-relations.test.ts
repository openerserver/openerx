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

const createdTaskIds: string[] = [];
const relationIds: string[] = [];
let token = "";

interface ProjectTaskRelationRecord {
  id: string;
  projectId: string;
  sourceTaskId: string;
  targetTaskId: string;
  type: "depends-on" | "blocks" | "spawned-from";
  source: "manual" | "system" | "task-create";
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
  const statements = [
    ...relationIds.map((id) => `DELETE FROM project_task_relations WHERE id='${id}';`),
    ...createdTaskIds.map(
      (id) =>
        `DELETE FROM project_task_relations WHERE source_task_id='${id}' OR target_task_id='${id}';`,
    ),
    ...createdTaskIds.map((id) => `DELETE FROM tasks WHERE id='${id}';`),
  ];

  if (statements.length === 0) {
    return;
  }

  const { execSync } = await import("node:child_process");
  try {
    execSync(`sqlite3 "${DB_PATH}" "${statements.join(" ")}"`, { timeout: 5000 });
  } catch {
    console.warn("Cleanup failed for project-task-relations.test.ts");
  }
});

describe("project task relations", () => {
  test("persists relations on task creation and exposes them via project route", async () => {
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

    const { data, status } = await authedRequest<{ data: ProjectTaskRelationRecord[] }>(
      `/api/projects/${PROJECT_ID}/task-relations`,
    );

    expect(status).toBe(200);

    const dependsOn = data.data.find(
      (relation) =>
        relation.sourceTaskId === upstreamTaskId &&
        relation.targetTaskId === createdTaskId &&
        relation.type === "depends-on",
    );
    const blocks = data.data.find(
      (relation) =>
        relation.sourceTaskId === blockedTaskId &&
        relation.targetTaskId === upstreamTaskId &&
        relation.type === "blocks",
    );
    const spawnedFrom = data.data.find(
      (relation) =>
        relation.sourceTaskId === upstreamTaskId &&
        relation.targetTaskId === createdTaskId &&
        relation.type === "spawned-from",
    );

    expect(dependsOn?.source).toBe("task-create");
    expect(dependsOn?.metadata).toEqual({ reason: "wait-for-upstream" });
    expect(blocks?.source).toBe("task-create");
    expect(spawnedFrom?.source).toBe("task-create");

    relationIds.push(dependsOn?.id, blocks?.id, spawnedFrom?.id);
  });

  test("upserts project-level relations for existing tasks", async () => {
    const sourceTaskId = await createTask(`批量关系源-${Date.now()}`);
    const targetTaskId = await createTask(`批量关系目标-${Date.now()}`);

    const { data, status } = await authedRequest<{
      ok: boolean;
      data: ProjectTaskRelationRecord[];
    }>(`/api/projects/${PROJECT_ID}/task-relations`, {
      method: "PUT",
      body: JSON.stringify({
        relations: [
          {
            sourceTaskId,
            targetTaskId,
            type: "depends-on",
            source: "manual",
            metadata: { source: "test" },
          },
        ],
      }),
    });

    expect(status).toBe(200);
    expect(data.ok).toBe(true);
    expect(data.data[0]?.type).toBe("depends-on");
    expect(data.data[0]?.source).toBe("manual");

    relationIds.push(String(data.data[0]?.id));
  });

  test("expands relationContext into default cross-task relations", async () => {
    const upstreamTaskId = await createTask(`协议依赖源-${Date.now()}`);
    const blockedTaskId = await createTask(`协议阻塞目标-${Date.now()}`);

    const createdTaskId = await createTaskWithBody(`协议派生任务-${Date.now()}`, {
      relationContext: {
        spawnedFromTaskId: upstreamTaskId,
        dependsOnTaskIds: [upstreamTaskId],
        blocksTaskIds: [blockedTaskId],
      },
    });

    const { data, status } = await authedRequest<{ data: ProjectTaskRelationRecord[] }>(
      `/api/projects/${PROJECT_ID}/task-relations`,
    );

    expect(status).toBe(200);

    const dependsOn = data.data.find(
      (relation) =>
        relation.sourceTaskId === upstreamTaskId &&
        relation.targetTaskId === createdTaskId &&
        relation.type === "depends-on",
    );
    const spawnedFrom = data.data.find(
      (relation) =>
        relation.sourceTaskId === upstreamTaskId &&
        relation.targetTaskId === createdTaskId &&
        relation.type === "spawned-from",
    );
    const blocks = data.data.find(
      (relation) =>
        relation.sourceTaskId === createdTaskId &&
        relation.targetTaskId === blockedTaskId &&
        relation.type === "blocks",
    );

    expect(dependsOn?.source).toBe("task-create");
    expect(spawnedFrom?.source).toBe("task-create");
    expect(blocks?.source).toBe("task-create");
    expect(dependsOn?.metadata?.protocol).toBe("relation-context-v1");

    relationIds.push(dependsOn?.id, spawnedFrom?.id, blocks?.id);
  });
});
