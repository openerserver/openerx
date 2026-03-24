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

function toPostgresPlaceholders(query: string) {
  let index = 0;
  return query.replace(/\?(\d+)?/g, (_match, explicitIndex) => {
    if (explicitIndex) {
      return `$${Number(explicitIndex)}`;
    }

    index += 1;
    return `$${index}`;
  });
}

async function writeDb(query: string, params: unknown[]) {
  await sql.unsafe(toPostgresPlaceholders(query), params as never[]);
}

async function safeWriteDb(query: string, params: unknown[]) {
  try {
    await writeDb(query, params);
  } catch {
    // Best-effort cleanup only.
  }
}

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
const createdWorkflowTemplates: Array<{ templateId: string; stageIds: string[] }> = [];

async function createTask(token: string, title: string) {
  const { data, status } = await authedRequest<{ id: string; nodeId: string }>(
    token,
    "/api/tasks",
    {
      method: "POST",
      body: JSON.stringify({
        title,
        prompt: `${title} prompt`,
        projectId: PROJECT_ID,
      }),
    },
  );
  expect(status).toBe(201);
  createdTaskIds.push(data.id);
  return data;
}

async function createWorkflowTemplateFixture(
  token: string,
  templateId: string,
  stageKeys: string[],
) {
  createdWorkflowTemplates.push({
    templateId,
    stageIds: stageKeys.map((stageKey) => `${templateId}-${stageKey}`),
  });

  const createTemplate = await authedRequest<Record<string, unknown>>(token, "/api/workflow-templates", {
    method: "POST",
    body: JSON.stringify({
      id: templateId,
      name: `Test Template ${templateId}`,
      enabled: true,
      selectableByProjects: true,
      stageOrder: stageKeys,
    }),
  });
  expect(createTemplate.status).toBe(201);
}

async function createWorkflowTemplateStages(token: string, templateId: string, stageKeys: string[]) {
  for (const [index, stageKey] of stageKeys.entries()) {
    const createStage = await authedRequest<Record<string, unknown>>(
      token,
      `/api/workflow-templates/${templateId}/stages`,
      {
        method: "POST",
        body: JSON.stringify({
          id: `${templateId}-${stageKey}`,
          stageKey,
          name: stageKey,
          enabled: true,
          mode: "single",
          primaryRoleAgentId: `role.${stageKey}`,
          participantRoleAgentIds: [],
          orderIndex: index,
        }),
      },
    );
    expect(createStage.status).toBe(201);
  }
}

afterAll(async () => {
  try {
    for (const taskId of createdTaskIds) {
      await safeWriteDb(
        "DELETE FROM task_stage_runs WHERE workflow_run_id IN (SELECT id FROM task_workflow_runs WHERE task_id = ?1)",
        [taskId],
      );
      await safeWriteDb("DELETE FROM task_timeline_views WHERE task_id = ?1", [taskId]);
      await safeWriteDb("DELETE FROM task_snapshots WHERE task_id = ?1", [taskId]);
      await safeWriteDb("DELETE FROM task_domain_events WHERE task_id = ?1", [taskId]);
      await safeWriteDb("DELETE FROM task_run_nodes WHERE task_id = ?1", [taskId]);
      await safeWriteDb("DELETE FROM task_runs WHERE task_id = ?1", [taskId]);
      await safeWriteDb("DELETE FROM task_workflow_runs WHERE task_id = ?1", [taskId]);
      await safeWriteDb("DELETE FROM developer_change_requests WHERE task_id = ?1", [taskId]);
      await safeWriteDb("DELETE FROM role_aggregate_conclusions WHERE task_id = ?1", [taskId]);
      await safeWriteDb("DELETE FROM agent_runs WHERE task_id = ?1", [taskId]);
      await safeWriteDb("DELETE FROM audit_events WHERE task_id = ?1", [taskId]);
      await safeWriteDb(
        "DELETE FROM project_tree_links WHERE source_node_id = ?1 OR target_node_id = ?1",
        [taskId],
      );
      await safeWriteDb(
        "DELETE FROM project_tree_branches WHERE task_node_id = ?1 OR head_node_id = ?1",
        [taskId],
      );
      await safeWriteDb("DELETE FROM tasks WHERE id = ?1", [taskId]);
      await safeWriteDb("DELETE FROM project_tree_nodes WHERE id = ?1", [taskId]);
    }

    for (const template of createdWorkflowTemplates) {
      for (const stageId of template.stageIds) {
        await authedRequest<{ ok: boolean }>(token, `/api/workflow-templates/${template.templateId}/stages/${stageId}`, {
          method: "DELETE",
        }).catch(() => undefined);
      }

      await safeWriteDb("DELETE FROM workflow_template_stages WHERE template_id = ?1", [template.templateId]);
      await safeWriteDb("DELETE FROM workflow_templates WHERE id = ?1", [template.templateId]);
    }
  } finally {
    await sql.end();
  }
});

let token = "";

beforeAll(async () => {
  token = await login();
});

describe("Role workflow storage (service)", () => {
  test("stores role conclusions and developer change requests in formal tables", async () => {
    const { id: taskId } = await createTask(token, `role-workflow-${Date.now()}`);

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
    const { id: taskId } = await createTask(token, `legacy-role-workflow-${Date.now()}`);
    const legacyConclusionId = `legacy-conclusion-${taskId}`;
    const legacyRequestId = `legacy-request-${taskId}`;

    const legacyStrategy = {
      roleAggregateConclusions: [
        {
          id: legacyConclusionId,
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
          id: legacyRequestId,
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
      expect.objectContaining({ id: legacyConclusionId, roleAgentId: "role.architect" }),
    ]);

    const migratedRequests = await authedRequest<{
      data: Array<{ id: string; sourceRoleAgentId: string }>;
    }>(token, `/api/tasks/${taskId}/developer-change-requests`);
    expect(migratedRequests.status).toBe(200);
    expect(migratedRequests.data.data).toEqual([
      expect.objectContaining({ id: legacyRequestId, sourceRoleAgentId: "role.qa" }),
    ]);

    const taskAfterMigration = await authedRequest<{
      strategy?: {
        roleAggregateConclusions?: unknown;
        developerChangeRequests?: unknown;
      } | null;
    }>(token, `/api/project-tree/tasks/${taskId}`);
    expect(taskAfterMigration.status).toBe(200);
    const parsedStrategy = taskAfterMigration.data.strategy ?? {};
    expect(parsedStrategy.roleAggregateConclusions).toBeUndefined();
    expect(parsedStrategy.developerChangeRequests).toBeUndefined();
  });

  test("lazily creates a workflow run for historical tasks when workflow data is missing", async () => {
    const { id: taskId } = await createTask(token, `legacy-task-workflow-${Date.now()}`);
    const legacyConclusionId = `legacy-conclusion-wf-${taskId}`;

    const patchTask = await authedRequest<Record<string, unknown>>(token, `/api/tasks/${taskId}`, {
      method: "PATCH",
      body: JSON.stringify({
        status: "running",
        strategy: JSON.stringify({
          selectedTemplateId: "legacy-template-1",
          roleAggregateConclusions: [
            {
              id: legacyConclusionId,
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
    const { id: taskId } = await createTask(token, `legacy-task-workflow-concurrent-${Date.now()}`);
    const legacyConclusionId = `legacy-conclusion-concurrent-${taskId}`;

    const patchTask = await authedRequest<Record<string, unknown>>(token, `/api/tasks/${taskId}`, {
      method: "PATCH",
      body: JSON.stringify({
        status: "running",
        strategy: JSON.stringify({
          selectedTemplateId: "legacy-template-concurrent",
          roleAggregateConclusions: [
            {
              id: legacyConclusionId,
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

    const [firstWorkflow, secondWorkflow] = await Promise.all([
      authedRequest<{
        data: {
          workflowRun: { templateId: string; currentStage: string; status: string } | null;
          stages: Array<Record<string, unknown>>;
        };
      }>(token, `/api/tasks/${taskId}/workflow`),
      authedRequest<{
        data: {
          workflowRun: { templateId: string; currentStage: string; status: string } | null;
          stages: Array<Record<string, unknown>>;
        };
      }>(token, `/api/tasks/${taskId}/workflow`),
    ]);

    expect(firstWorkflow.status).toBe(200);
    expect(secondWorkflow.status).toBe(200);
    expect(firstWorkflow.data.data.workflowRun).toMatchObject({
      templateId: "legacy-template-concurrent",
      currentStage: "verify",
      status: "running",
    });
    expect(secondWorkflow.data.data.workflowRun).toMatchObject({
      templateId: "legacy-template-concurrent",
      currentStage: "verify",
      status: "running",
    });
    expect(firstWorkflow.data.data.workflowRun?.id).toBe(secondWorkflow.data.data.workflowRun?.id);
  });

  test("backfills missing stage runs when a historical task already has workflow run", async () => {
    const { id: taskId } = await createTask(token, `legacy-task-stage-backfill-${Date.now()}`);
    const templateId = `legacy-template-backfill-${Date.now()}`;
    const legacyConclusionId = `legacy-conclusion-stage-backfill-${taskId}`;
    await createWorkflowTemplateFixture(token, templateId, ["design", "verify"]);

    const patchTask = await authedRequest<Record<string, unknown>>(token, `/api/tasks/${taskId}`, {
      method: "PATCH",
      body: JSON.stringify({
        status: "running",
        strategy: JSON.stringify({
          selectedTemplateId: templateId,
          currentStage: "verify",
          roleAggregateConclusions: [
            {
              id: legacyConclusionId,
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

    const initialWorkflow = await authedRequest<{
      data: {
        workflowRun: { templateId: string; currentStage: string; status: string } | null;
        stages: Array<Record<string, unknown>>;
      };
    }>(token, `/api/tasks/${taskId}/workflow`);
    expect(initialWorkflow.status).toBe(200);
    expect(initialWorkflow.data.data.workflowRun).toMatchObject({
      templateId,
      currentStage: "verify",
      status: "running",
    });
    expect(initialWorkflow.data.data.stages).toHaveLength(0);

    await createWorkflowTemplateStages(token, templateId, ["design", "verify"]);

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
    expect(workflow.data.data.stages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ stageKey: "design", status: "completed" }),
        expect.objectContaining({ stageKey: "verify", status: "running" }),
      ]),
    );

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

  test("workflow migration stays available without any legacy task mirror", async () => {
    const { id: taskId } = await createTask(token, `legacy-task-tree-first-${Date.now()}`);
    const legacyConclusionId = `legacy-conclusion-tree-first-${taskId}`;

    const patchTask = await authedRequest<Record<string, unknown>>(token, `/api/tasks/${taskId}`, {
      method: "PATCH",
      body: JSON.stringify({
        status: "running",
        strategy: JSON.stringify({
          selectedTemplateId: "legacy-template-tree-first",
          roleAggregateConclusions: [
            {
              id: legacyConclusionId,
              roleAgentId: "role.qa",
              stage: "verify",
              aggregationStrategy: "merge-summary",
              status: "aligned",
              finalDecision: "allow",
              aggregateRiskLevel: "medium",
              confidenceScore: 0.8,
              consensusScore: 0.75,
              winningRationale: "切树后 workflow 仍可从 task tree 恢复。",
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
      templateId: "legacy-template-tree-first",
      currentStage: "verify",
      status: "running",
    });
  });
});
