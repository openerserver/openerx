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

async function request<T>(
  path: string,
  opts: RequestInit = {},
): Promise<{ data: T; status: number }> {
  const res = await fetch(`${CP_URL}${path}`, opts);
  const text = await res.text();
  let data: unknown;
  try {
    data = text ? JSON.parse(text) : undefined;
  } catch {
    data = text;
  }
  return { data: data as T, status: res.status };
}

async function authedRequest<T>(
  token: string,
  path: string,
  opts: RequestInit = {},
): Promise<{ data: T; status: number }> {
  return request<T>(path, {
    ...opts,
    headers: {
      ...(opts.headers as Record<string, string>),
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });
}

async function login(): Promise<string> {
  const { data, status } = await request<{ token: string }>("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: USERNAME, password: PASSWORD }),
  });
  if (status !== 200) throw new Error(`Login failed: ${status} ${JSON.stringify(data)}`);
  return data.token;
}

const createdTaskIds: string[] = [];

async function createTask(token: string, title: string) {
  const { data, status } = await authedRequest<{ id: string }>(token, "/api/tasks", {
    method: "POST",
    body: JSON.stringify({
      title,
      prompt: `${title} prompt`,
      projectId: PROJECT_ID,
    }),
  });
  expect(status).toBe(201);
  createdTaskIds.push(data.id);
  return data.id;
}

afterAll(async () => {
  if (createdTaskIds.length === 0) {
    return;
  }

  const statements = createdTaskIds.flatMap((taskId) => [
    `DELETE FROM developer_change_requests WHERE task_id='${taskId}';`,
    `DELETE FROM role_aggregate_conclusions WHERE task_id='${taskId}';`,
    `DELETE FROM task_sessions WHERE task_id='${taskId}';`,
    `DELETE FROM audit_events WHERE task_id='${taskId}';`,
    `DELETE FROM agent_runs WHERE task_id='${taskId}';`,
    `DELETE FROM tasks WHERE id='${taskId}';`,
  ]);

  const { execSync } = await import("node:child_process");
  try {
    execSync(`sqlite3 "${DB_PATH}" "${statements.join(" ")}"`, { timeout: 5000 });
  } catch {
    console.warn("Cleanup failed for role-workflow-storage.test.ts");
  }
});

let token = "";

beforeAll(async () => {
  token = await login();
});

describe("Role workflow storage (service)", () => {
  test("stores role conclusions and developer change requests in formal tables", async () => {
    const taskId = await createTask(token, `role-workflow-${Date.now()}`);

    const roleConclusion = {
      roleAgentId: "role.security",
      stage: "verify",
      aggregationStrategy: "merge-summary",
      status: "conflicted",
      finalDecision: "notify-developer",
      aggregateRiskLevel: "high",
      confidenceScore: 0.86,
      consensusScore: 0.62,
      winningRationale: "发现高风险依赖，需要开发者修复。",
      mergedFindings: [{ key: "dep-1", title: "依赖版本过低", severity: "high" }],
      minorityFindings: [{ key: "cfg-1", title: "配置项存在隐患", severity: "medium" }],
      conflicts: [{ type: "risk", severity: "high", summary: "安全与发布结论不一致" }],
      approvalRecommendation: { required: true },
    };

    const postConclusion = await authedRequest<{ ok: boolean; data: Array<Record<string, unknown>> }>(
      token,
      `/api/tasks/${taskId}/role-conclusions`,
      {
        method: "POST",
        body: JSON.stringify(roleConclusion),
      },
    );
    expect(postConclusion.status).toBe(200);
    expect(postConclusion.data.ok).toBe(true);

    const getConclusions = await authedRequest<{
      data: Array<{
        roleAgentId: string;
        stage: string;
        winningRationale: string;
      }>;
    }>(token, `/api/tasks/${taskId}/role-conclusions`);
    expect(getConclusions.status).toBe(200);
    expect(getConclusions.data.data).toHaveLength(1);
    expect(getConclusions.data.data[0]).toMatchObject({
      roleAgentId: "role.security",
      stage: "verify",
      winningRationale: "发现高风险依赖，需要开发者修复。",
    });

    const postChangeRequest = await authedRequest<{ ok: boolean; id: string }>(
      token,
      `/api/tasks/${taskId}/developer-change-requests`,
      {
        method: "POST",
        body: JSON.stringify({
          sourceRoleAgentId: "role.security",
          priority: "high",
          title: "升级风险依赖",
          summary: "请升级存在漏洞的运行时依赖。",
          requiredChanges: ["升级依赖 A 到安全版本", "补充回归验证"],
          relatedFindingKeys: ["dep-1"],
          blocking: true,
          approvalRequired: false,
        }),
      },
    );
    expect(postChangeRequest.status).toBe(201);

    const patchChangeRequest = await authedRequest<{ ok: boolean }>(
      token,
      `/api/tasks/${taskId}/developer-change-requests`,
      {
        method: "PATCH",
        body: JSON.stringify({
          requestId: postChangeRequest.data.id,
          status: "resolved",
          resolutionNote: "已升级并验证。",
        }),
      },
    );
    expect(patchChangeRequest.status).toBe(200);

    const getChangeRequests = await authedRequest<{
      data: Array<{
        id: string;
        status: string;
        resolutionNote?: string | null;
        requiredChanges: string[];
      }>;
    }>(token, `/api/tasks/${taskId}/developer-change-requests`);
    expect(getChangeRequests.status).toBe(200);
    expect(getChangeRequests.data.data).toHaveLength(1);
    expect(getChangeRequests.data.data[0]).toMatchObject({
      id: postChangeRequest.data.id,
      status: "resolved",
      resolutionNote: "已升级并验证。",
      requiredChanges: ["升级依赖 A 到安全版本", "补充回归验证"],
    });
  });

  test("lazily migrates legacy strategy role workflow data into formal tables", async () => {
    const taskId = await createTask(token, `legacy-role-workflow-${Date.now()}`);

    const legacyStrategy = {
      roleAggregateConclusions: [
        {
          id: "legacy-conclusion-1",
          roleAgentId: "role.architect",
          stage: "design",
          aggregationStrategy: "merge-summary",
          status: "aligned",
          finalDecision: "allow",
          aggregateRiskLevel: "medium",
          confidenceScore: 0.91,
          consensusScore: 0.88,
          winningRationale: "方案结构合理，可以继续实现。",
          mergedFindings: [{ key: "arch-1", title: "服务边界清晰", severity: "medium" }],
          minorityFindings: [],
          conflicts: [],
          generatedAt: new Date().toISOString(),
        },
      ],
      developerChangeRequests: [
        {
          id: "legacy-request-1",
          sourceRoleAgentId: "role.qa",
          priority: "medium",
          title: "补充回归测试",
          summary: "请覆盖一个缺失的回归场景。",
          requiredChanges: ["补充工作流接口回归测试"],
          blocking: false,
          approvalRequired: false,
          status: "open",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
    };

    const patchTask = await authedRequest<Record<string, unknown>>(token, `/api/tasks/${taskId}`, {
      method: "PATCH",
      body: JSON.stringify({ strategy: JSON.stringify(legacyStrategy) }),
    });
    expect(patchTask.status).toBe(200);

    const migratedConclusions = await authedRequest<{ data: Array<{ id: string; roleAgentId: string }> }>(
      token,
      `/api/tasks/${taskId}/role-conclusions`,
    );
    expect(migratedConclusions.status).toBe(200);
    expect(migratedConclusions.data.data).toEqual([
      expect.objectContaining({ id: "legacy-conclusion-1", roleAgentId: "role.architect" }),
    ]);

    const migratedRequests = await authedRequest<{ data: Array<{ id: string; sourceRoleAgentId: string }> }>(
      token,
      `/api/tasks/${taskId}/developer-change-requests`,
    );
    expect(migratedRequests.status).toBe(200);
    expect(migratedRequests.data.data).toEqual([
      expect.objectContaining({ id: "legacy-request-1", sourceRoleAgentId: "role.qa" }),
    ]);

    const taskAfterMigration = await authedRequest<{ strategy?: string | null }>(token, `/api/tasks/${taskId}`);
    expect(taskAfterMigration.status).toBe(200);
    const parsedStrategy = taskAfterMigration.data.strategy ? JSON.parse(taskAfterMigration.data.strategy) : {};
    expect(parsedStrategy.roleAggregateConclusions).toBeUndefined();
    expect(parsedStrategy.developerChangeRequests).toBeUndefined();
  });
});