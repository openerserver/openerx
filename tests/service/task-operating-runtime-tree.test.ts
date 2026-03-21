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
let token = "";

async function request<T>(path: string, opts: RequestInit = {}): Promise<{ data: T; status: number }> {
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

function escapeSqlLiteral(value: string) {
  return value.replace(/'/g, "''");
}

beforeAll(async () => {
  token = await login();
});

afterAll(async () => {
  for (const taskId of createdTaskIds) {
    await sql.unsafe(`DELETE FROM task_operating_modes WHERE task_id = $1`, [taskId]);
    await sql.unsafe(`DELETE FROM boss_decisions WHERE task_id = $1`, [taskId]);
    await sql.unsafe(`DELETE FROM human_escalations WHERE task_id = $1`, [taskId]);
  }
  for (const nodeId of Array.from(createdNodeIds)) {
    await sql.unsafe(`DELETE FROM project_tree_links WHERE source_node_id = $1 OR target_node_id = $1`, [nodeId]);
    await sql.unsafe(`DELETE FROM project_tree_events WHERE node_id = $1`, [nodeId]);
    await sql.unsafe(`DELETE FROM project_tree_branches WHERE task_node_id = $1 OR head_node_id = $1`, [nodeId]);
    await sql.unsafe(`DELETE FROM project_tree_nodes WHERE id = $1`, [nodeId]);
  }
  await sql.end();
});

describe("task operating runtime tree-backed reads", () => {
  test("reads legacy operating mode hints from task tree strategy", async () => {
    const unique = Date.now();
    const task = await createTask(`operating-runtime-tree-${unique}`);
    const strategy = JSON.stringify({
      collaborationMode: "team",
      autopilotLevel: "L2",
      bossParticipationMode: "full-manager",
      currentStageKey: "implementation",
      currentStageStatus: "running",
    });

    await sql.unsafe(
      `UPDATE project_tree_nodes
          SET content_json = COALESCE(content_json, '{}'::jsonb) || '${escapeSqlLiteral(JSON.stringify({ strategy }))}'::jsonb,
              updated_at = CURRENT_TIMESTAMP
        WHERE id = '${escapeSqlLiteral(task.nodeId)}'`,
    );

    const treeNode = await authedRequest<{ contentJson?: Record<string, unknown> }>(
      `/api/projects/${PROJECT_ID}/tree/${task.nodeId}`,
    );
    expect(treeNode.status).toBe(200);
    expect(treeNode.data.contentJson?.strategy).toBe(strategy);

    const response = await authedRequest<{
      collaborationMode?: string;
      autopilotLevel?: string;
      bossParticipationMode?: string;
      currentStageKey?: string;
      currentStageStatus?: string;
    }>(`/api/tasks/${task.id}/operating-runtime/state`);

    expect(response.status).toBe(200);
    expect(response.data).toMatchObject({
      collaborationMode: "team",
      autopilotLevel: "L2",
      bossParticipationMode: "full-manager",
      currentStageKey: "implementation",
      currentStageStatus: "running",
    });
  });
});