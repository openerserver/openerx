import { Database } from "bun:sqlite";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ensureLegacyRoleWorkflowMigrated } from "../../control-plane/service/src/modules/task-workflows/legacy-role-workflow-storage";

const __dirname = dirname(fileURLToPath(import.meta.url));

const CP_URL = process.env.TEST_CP_URL || "http://127.0.0.1:4097";
const PROJECT_ID = process.env.TEST_PROJECT_ID || "proj-default";
const USERNAME = process.env.TEST_USERNAME || "admin";
const PASSWORD = process.env.TEST_PASSWORD || "admin123!";
const DB_PATH =
  process.env.TEST_DB_PATH || resolve(__dirname, "../../control-plane/service/data/openerx.db");
const testDatabase = new Database(DB_PATH, { create: true });

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
const createdWorkflowTemplateIds: string[] = [];

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

function createWorkflowTemplateFixture(templateId: string, stageKeys: string[]) {
  const now = new Date().toISOString();
  createdWorkflowTemplateIds.push(templateId);

  testDatabase
    .query(
      `INSERT INTO workflow_templates (
        id, name, enabled, selectable_by_projects, stage_order_json, version, created_at, updated_at
      ) VALUES (?1, ?2, 1, 1, ?3, 1, ?4, ?5)`,
    )
    .run(templateId, `Test Template ${templateId}`, JSON.stringify(stageKeys), now, now);

  const insertStage = testDatabase.query(
    `INSERT INTO workflow_template_stages (
      id, template_id, stage_key, name, enabled, mode, primary_role_agent_id, participant_role_agent_ids_json, order_index
    ) VALUES (?1, ?2, ?3, ?4, 1, 'single', ?5, ?6, ?7)`,
  );

  for (const [index, stageKey] of stageKeys.entries()) {
    insertStage.run(
      `${templateId}-${stageKey}`,
      templateId,
      stageKey,
      stageKey,
      `role.${stageKey}`,
      JSON.stringify([]),
      index,
    );
  }
}

function countWorkflowRuns(taskId: string) {
  const row = testDatabase
    .query("SELECT COUNT(*) AS count FROM task_workflow_runs WHERE task_id = ?1")
    .get(taskId) as { count: number | bigint };
  return Number(row.count ?? 0);
}

function countStageRunsForTask(taskId: string) {
  const row = testDatabase
    .query(
      `SELECT COUNT(*) AS count
       FROM task_stage_runs
       WHERE workflow_run_id IN (SELECT id FROM task_workflow_runs WHERE task_id = ?1)`,
    )
    .get(taskId) as { count: number | bigint };
  return Number(row.count ?? 0);
}

afterAll(async () => {
  try {
    const deleteTaskStageRuns = testDatabase.query(
      "DELETE FROM task_stage_runs WHERE workflow_run_id IN (SELECT id FROM task_workflow_runs WHERE task_id = ?1)",
    );
    const deleteTaskWorkflowRuns = testDatabase.query(
      "DELETE FROM task_workflow_runs WHERE task_id = ?1",
    );
    const deleteChangeRequests = testDatabase.query(
      "DELETE FROM developer_change_requests WHERE task_id = ?1",
    );
    const deleteRoleConclusions = testDatabase.query(
      "DELETE FROM role_aggregate_conclusions WHERE task_id = ?1",
    );
    const deleteTaskSessions = testDatabase.query("DELETE FROM task_sessions WHERE task_id = ?1");
    const deleteAuditEvents = testDatabase.query("DELETE FROM audit_events WHERE task_id = ?1");
    const deleteAgentRuns = testDatabase.query("DELETE FROM agent_runs WHERE task_id = ?1");
    const deleteTasks = testDatabase.query("DELETE FROM tasks WHERE id = ?1");
    const deleteTemplateStages = testDatabase.query(
      "DELETE FROM workflow_template_stages WHERE template_id = ?1",
    );
    const deleteTemplates = testDatabase.query("DELETE FROM workflow_templates WHERE id = ?1");

    for (const taskId of createdTaskIds) {
      deleteTaskStageRuns.run(taskId);
      deleteTaskWorkflowRuns.run(taskId);
      deleteChangeRequests.run(taskId);
      deleteRoleConclusions.run(taskId);
      deleteTaskSessions.run(taskId);
      deleteAuditEvents.run(taskId);
      deleteAgentRuns.run(taskId);
      deleteTasks.run(taskId);
    }

    for (const templateId of createdWorkflowTemplateIds) {
      deleteTemplateStages.run(templateId);
      deleteTemplates.run(templateId);
    }
  } finally {
    testDatabase.close();
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

    const postConclusion = await authedRequest<{
      ok: boolean;
      data: Array<Record<string, unknown>>;
    }>(token, `/api/tasks/${taskId}/role-conclusions`, {
      method: "POST",
      body: JSON.stringify(roleConclusion),
    });
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

    const migratedConclusions = await authedRequest<{
      data: Array<{ id: string; roleAgentId: string }>;
    }>(token, `/api/tasks/${taskId}/role-conclusions`);
    expect(migratedConclusions.status).toBe(200);
    expect(migratedConclusions.data.data).toEqual([
      expect.objectContaining({ id: "legacy-conclusion-1", roleAgentId: "role.architect" }),
    ]);

    const migratedRequests = await authedRequest<{
      data: Array<{ id: string; sourceRoleAgentId: string }>;
    }>(token, `/api/tasks/${taskId}/developer-change-requests`);
    expect(migratedRequests.status).toBe(200);
    expect(migratedRequests.data.data).toEqual([
      expect.objectContaining({ id: "legacy-request-1", sourceRoleAgentId: "role.qa" }),
    ]);

    const taskAfterMigration = await authedRequest<{ strategy?: string | null }>(
      token,
      `/api/tasks/${taskId}`,
    );
    expect(taskAfterMigration.status).toBe(200);
    const parsedStrategy = taskAfterMigration.data.strategy
      ? JSON.parse(taskAfterMigration.data.strategy)
      : {};
    expect(parsedStrategy.roleAggregateConclusions).toBeUndefined();
    expect(parsedStrategy.developerChangeRequests).toBeUndefined();
  });

  test("lazily creates a workflow run for historical tasks when workflow data is missing", async () => {
    const taskId = await createTask(token, `legacy-task-workflow-${Date.now()}`);

    const patchTask = await authedRequest<Record<string, unknown>>(token, `/api/tasks/${taskId}`, {
      method: "PATCH",
      body: JSON.stringify({
        status: "running",
        strategy: JSON.stringify({
          selectedTemplateId: "legacy-template-1",
          roleAggregateConclusions: [
            {
              id: "legacy-conclusion-wf-1",
              roleAgentId: "role.qa",
              stage: "verify",
              aggregationStrategy: "merge-summary",
              status: "aligned",
              finalDecision: "allow",
              aggregateRiskLevel: "medium",
              confidenceScore: 0.8,
              consensusScore: 0.75,
              winningRationale: "已进入验证阶段。",
            },
          ],
        }),
      }),
    });
    expect(patchTask.status).toBe(200);

    const workflow = await authedRequest<{
      data: {
        workflowRun: { templateId: string; currentStage: string; status: string } | null;
        stages: Array<Record<string, unknown>>;
      };
    }>(token, `/api/tasks/${taskId}/workflow`);

    expect(workflow.status).toBe(200);
    expect(workflow.data.data.workflowRun).toMatchObject({
      templateId: "legacy-template-1",
      currentStage: "verify",
      status: "running",
    });
  });

  test("keeps lazy workflow migration idempotent under concurrent reads", async () => {
    const taskId = await createTask(token, `legacy-task-workflow-concurrent-${Date.now()}`);

    const patchTask = await authedRequest<Record<string, unknown>>(token, `/api/tasks/${taskId}`, {
      method: "PATCH",
      body: JSON.stringify({
        status: "running",
        strategy: JSON.stringify({
          selectedTemplateId: "legacy-template-concurrent",
          roleAggregateConclusions: [
            {
              id: "legacy-conclusion-concurrent-1",
              roleAgentId: "role.qa",
              stage: "verify",
              aggregationStrategy: "merge-summary",
              status: "aligned",
              finalDecision: "allow",
              aggregateRiskLevel: "medium",
              confidenceScore: 0.8,
              consensusScore: 0.75,
              winningRationale: "并发读取下也应只生成一条 workflow run。",
            },
          ],
        }),
      }),
    });
    expect(patchTask.status).toBe(200);

    await Promise.all([
      ensureLegacyRoleWorkflowMigrated(taskId),
      ensureLegacyRoleWorkflowMigrated(taskId),
    ]);

    expect(countWorkflowRuns(taskId)).toBe(1);
  });

  test("backfills missing stage runs when a historical task already has workflow run", async () => {
    const taskId = await createTask(token, `legacy-task-stage-backfill-${Date.now()}`);
    const templateId = `legacy-template-backfill-${Date.now()}`;
    createWorkflowTemplateFixture(templateId, ["design", "verify"]);

    const patchTask = await authedRequest<Record<string, unknown>>(token, `/api/tasks/${taskId}`, {
      method: "PATCH",
      body: JSON.stringify({
        status: "running",
        strategy: JSON.stringify({
          selectedTemplateId: templateId,
          currentStage: "verify",
          roleAggregateConclusions: [
            {
              id: "legacy-conclusion-stage-backfill-1",
              roleAgentId: "role.qa",
              stage: "verify",
              aggregationStrategy: "merge-summary",
              status: "aligned",
              finalDecision: "allow",
              aggregateRiskLevel: "medium",
              confidenceScore: 0.8,
              consensusScore: 0.75,
              winningRationale: "已有 workflow run，但缺 stage runs。",
            },
          ],
        }),
      }),
    });
    expect(patchTask.status).toBe(200);

    const now = new Date().toISOString();
    testDatabase
      .query(
        `INSERT INTO task_workflow_runs (
          id, task_id, template_id, current_stage, status, started_at, created_at, updated_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
      )
      .run(`workflow-run-${taskId}`, taskId, templateId, "verify", "running", now, now, now);

    const workflow = await authedRequest<{
      data: {
        workflowRun: { templateId: string; currentStage: string; status: string } | null;
        stages: Array<{ stageKey: string; status: string }>;
      };
    }>(token, `/api/tasks/${taskId}/workflow`);

    expect(workflow.status).toBe(200);
    expect(workflow.data.data.workflowRun).toMatchObject({
      templateId,
      currentStage: "verify",
      status: "running",
    });
    expect(workflow.data.data.stages).toHaveLength(2);
    expect(countStageRunsForTask(taskId)).toBe(2);

    const retryStage = await authedRequest<{ ok: boolean }>(
      token,
      `/api/tasks/${taskId}/workflow/retry-stage`,
      {
        method: "POST",
        body: JSON.stringify({ stageKey: "verify" }),
      },
    );
    expect(retryStage.status).toBe(200);
    expect(retryStage.data.ok).toBe(true);
  });
});
