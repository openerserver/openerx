import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { buildDeleteByIdsStatements, runPostgresCleanupStatements } from "./service-teardown-helpers";

const CP_URL = process.env.TEST_CP_URL || "http://127.0.0.1:4097";
const PROJECT_ID = process.env.TEST_PROJECT_ID || "proj-default";
const USERNAME = process.env.TEST_USERNAME || "admin";
const PASSWORD = process.env.TEST_PASSWORD || "admin123!";

const createdAuditIds: string[] = [];
const createdCostRecordIds: string[] = [];
const createdRoleAgentIds: string[] = [];
const createdBindingIds: string[] = [];
const createdOverrideIds: string[] = [];
const createdWorkflowTemplateIds: string[] = [];

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

  if (status !== 200) {
    throw new Error(`Login failed: ${status} ${JSON.stringify(data)}`);
  }

  return data.token;
}

afterAll(async () => {
  const statements = [
    ...buildDeleteByIdsStatements("audit_events", createdAuditIds),
    ...buildDeleteByIdsStatements("cost_records", createdCostRecordIds),
    ...buildDeleteByIdsStatements("role_agent_project_overrides", createdOverrideIds),
    ...buildDeleteByIdsStatements("role_agent_bindings", createdBindingIds),
    ...buildDeleteByIdsStatements("role_agents", createdRoleAgentIds),
    ...buildDeleteByIdsStatements("workflow_templates", createdWorkflowTemplateIds),
  ];

  if (statements.length === 0) {
    return;
  }

  runPostgresCleanupStatements(statements, "residual-route-timestamps.test.ts");
});

let token = "";

beforeAll(async () => {
  token = await login();
});

describe("residual route timestamp normalization", () => {
  test("returns ISO timestamps across audit, cost, role-agent, and workflow-template routes", async () => {
    const unique = Date.now().toString(36);
    const auditTraceId = `trace-${unique}`;
    const costTaskId = `cost-task-${unique}`;
    const roleAgentId = `role.timestamp.${unique}`;
    const workflowTemplateId = `workflow-template-${unique}`;

    const createAudit = await authedRequest<{ ok: boolean }>(token, "/api/audit", {
      method: "POST",
      body: JSON.stringify({
        projectId: PROJECT_ID,
        taskId: costTaskId,
        eventType: "timestamp.route.audit",
        action: "created",
        target: `target-${unique}`,
        traceId: auditTraceId,
        detail: { source: "route-test" },
      }),
    });
    expect(createAudit.status).toBe(201);

    const auditList = await authedRequest<{
      data: Array<{ id: string; ts: string; traceId?: string | null; target?: string | null }>;
    }>(token, `/api/audit?projectId=${PROJECT_ID}&type=timestamp.route.audit&limit=20`);
    expect(auditList.status).toBe(200);
    const listedAudit = auditList.data.data.find(
      (event) => event.traceId === auditTraceId && event.target === `target-${unique}`,
    );
    expect(listedAudit?.ts).toEqual(expect.stringMatching(/Z$/));
    expect(listedAudit?.id).toBeTruthy();
    if (!listedAudit?.id) {
      return;
    }
    createdAuditIds.push(listedAudit.id);

    const auditDetail = await authedRequest<{ id: string; ts: string }>(
      token,
      `/api/audit/${listedAudit.id}`,
    );
    expect(auditDetail.status).toBe(200);
    expect(auditDetail.data.ts).toMatch(/Z$/);

    const auditTrace = await authedRequest<Array<{ id: string; ts: string }>>(
      token,
      `/api/audit/trace/${auditTraceId}`,
    );
    expect(auditTrace.status).toBe(200);
    expect(auditTrace.data.find((event) => event.id === listedAudit.id)?.ts).toEqual(
      expect.stringMatching(/Z$/),
    );

    const createdCost = await authedRequest<{ id: string; ts: string }>(token, "/api/cost/records", {
      method: "POST",
      body: JSON.stringify({
        projectId: PROJECT_ID,
        taskId: costTaskId,
        modelId: "gpt-5-mini",
        providerId: "github-copilot",
        inputTokens: 11,
        outputTokens: 7,
        cost: 0.018,
        budgetPeriod: "monthly",
      }),
    });
    expect(createdCost.status).toBe(201);
    createdCostRecordIds.push(createdCost.data.id);
    expect(createdCost.data.ts).toMatch(/Z$/);

    const costDetail = await authedRequest<{
      taskId: string;
      records: Array<{ id: string; ts: string }>;
    }>(token, `/api/cost/detail?taskId=${costTaskId}`);
    expect(costDetail.status).toBe(200);
    expect(costDetail.data.records.find((record) => record.id === createdCost.data.id)?.ts).toEqual(
      expect.stringMatching(/Z$/),
    );

    const createdRoleAgent = await authedRequest<{
      id: string;
      createdAt: string;
      updatedAt: string;
    }>(token, "/api/role-agents", {
      method: "POST",
      body: JSON.stringify({
        id: roleAgentId,
        projectId: PROJECT_ID,
        name: `Timestamp Role ${unique}`,
        description: "route timestamp coverage",
        scope: "project",
        permissionProfile: "perm.review",
        toolProfile: "tools.review",
        defaultExecutionMode: "single",
        allowedStages: ["design"],
      }),
    });
    expect(createdRoleAgent.status).toBe(201);
    createdRoleAgentIds.push(createdRoleAgent.data.id);
    expect(createdRoleAgent.data.createdAt).toMatch(/Z$/);
    expect(createdRoleAgent.data.updatedAt).toMatch(/Z$/);

    const roleAgentDetail = await authedRequest<{
      data: { id: string; createdAt: string; updatedAt: string };
    }>(token, `/api/role-agents/${roleAgentId}`);
    expect(roleAgentDetail.status).toBe(200);
    expect(roleAgentDetail.data.data.createdAt).toMatch(/Z$/);
    expect(roleAgentDetail.data.data.updatedAt).toMatch(/Z$/);

    const patchedRoleAgent = await authedRequest<{ id: string; updatedAt: string }>(
      token,
      `/api/role-agents/${roleAgentId}`,
      {
        method: "PATCH",
        body: JSON.stringify({ description: "route timestamp coverage updated" }),
      },
    );
    expect(patchedRoleAgent.status).toBe(200);
    expect(patchedRoleAgent.data.updatedAt).toMatch(/Z$/);

    const createdBinding = await authedRequest<{
      id: string;
      createdAt: string;
      updatedAt: string;
    }>(token, `/api/role-agents/${roleAgentId}/bindings`, {
      method: "POST",
      body: JSON.stringify({
        projectId: PROJECT_ID,
        bindingKey: `binding-${unique}`,
        runtimeAgent: "gpt-5-mini",
        label: `Binding ${unique}`,
        enabled: true,
        priority: 1,
      }),
    });
    expect(createdBinding.status).toBe(201);
    createdBindingIds.push(createdBinding.data.id);
    expect(createdBinding.data.createdAt).toMatch(/Z$/);
    expect(createdBinding.data.updatedAt).toMatch(/Z$/);

    const bindingList = await authedRequest<{
      data: Array<{ id: string; createdAt: string; updatedAt: string }>;
    }>(token, `/api/role-agents/${roleAgentId}/bindings?projectId=${PROJECT_ID}`);
    expect(bindingList.status).toBe(200);
    const listedBinding = bindingList.data.data.find((binding) => binding.id === createdBinding.data.id);
    expect(listedBinding?.createdAt).toEqual(expect.stringMatching(/Z$/));
    expect(listedBinding?.updatedAt).toEqual(expect.stringMatching(/Z$/));

    const patchedBinding = await authedRequest<{ id: string; updatedAt: string }>(
      token,
      `/api/role-agents/${roleAgentId}/bindings/${createdBinding.data.id}`,
      {
        method: "PATCH",
        body: JSON.stringify({ priority: 2 }),
      },
    );
    expect(patchedBinding.status).toBe(200);
    expect(patchedBinding.data.updatedAt).toMatch(/Z$/);

    const roleAgentList = await authedRequest<{
      data: Array<{
        id: string;
        createdAt: string;
        updatedAt: string;
        bindings: Array<{ id: string; createdAt: string; updatedAt: string }>;
      }>;
    }>(
      token,
      `/api/role-agents?projectId=${PROJECT_ID}&includeBindings=true&includeDisabledBindings=true`,
    );
    expect(roleAgentList.status).toBe(200);
    const listedRoleAgent = roleAgentList.data.data.find((role) => role.id === roleAgentId);
    expect(listedRoleAgent?.createdAt).toEqual(expect.stringMatching(/Z$/));
    expect(listedRoleAgent?.updatedAt).toEqual(expect.stringMatching(/Z$/));
    expect(listedRoleAgent?.bindings[0]?.createdAt).toEqual(expect.stringMatching(/Z$/));
    expect(listedRoleAgent?.bindings[0]?.updatedAt).toEqual(expect.stringMatching(/Z$/));

    const putOverride = await authedRequest<{
      data: { id: string; createdAt: string; updatedAt: string } | null;
    }>(token, `/api/role-agents/${roleAgentId}/projects/${PROJECT_ID}/override`, {
      method: "PUT",
      body: JSON.stringify({
        name: `Override ${unique}`,
        description: "override timestamp coverage",
        status: "active",
        bindingsMode: "replace",
      }),
    });
    expect(putOverride.status).toBe(200);
    expect(putOverride.data.data?.createdAt).toEqual(expect.stringMatching(/Z$/));
    expect(putOverride.data.data?.updatedAt).toEqual(expect.stringMatching(/Z$/));
    if (!putOverride.data.data?.id) {
      return;
    }
    createdOverrideIds.push(putOverride.data.data.id);

    const getOverride = await authedRequest<{
      data: { id: string; createdAt: string; updatedAt: string };
    }>(token, `/api/role-agents/${roleAgentId}/projects/${PROJECT_ID}/override`);
    expect(getOverride.status).toBe(200);
    expect(getOverride.data.data.createdAt).toMatch(/Z$/);
    expect(getOverride.data.data.updatedAt).toMatch(/Z$/);

    const patchOverride = await authedRequest<{
      data: { id: string; updatedAt: string } | null;
    }>(token, `/api/role-agents/${roleAgentId}/projects/${PROJECT_ID}/override`, {
      method: "PATCH",
      body: JSON.stringify({ description: "override timestamp coverage updated" }),
    });
    expect(patchOverride.status).toBe(200);
    expect(patchOverride.data.data?.updatedAt).toEqual(expect.stringMatching(/Z$/));

    const createdTemplate = await authedRequest<{
      id: string;
      createdAt: string;
      updatedAt: string;
    }>(token, "/api/workflow-templates", {
      method: "POST",
      body: JSON.stringify({
        id: workflowTemplateId,
        projectId: PROJECT_ID,
        name: `Template ${unique}`,
        description: "workflow template timestamp coverage",
        enabled: true,
        selectableByProjects: true,
        stageOrder: ["design"],
      }),
    });
    expect(createdTemplate.status).toBe(201);
    createdWorkflowTemplateIds.push(createdTemplate.data.id);
    expect(createdTemplate.data.createdAt).toMatch(/Z$/);
    expect(createdTemplate.data.updatedAt).toMatch(/Z$/);

    const templateList = await authedRequest<{
      data: Array<{ id: string; createdAt: string; updatedAt: string }>;
    }>(token, `/api/workflow-templates?projectId=${PROJECT_ID}`);
    expect(templateList.status).toBe(200);
    const listedTemplate = templateList.data.data.find((template) => template.id === workflowTemplateId);
    expect(listedTemplate?.createdAt).toEqual(expect.stringMatching(/Z$/));
    expect(listedTemplate?.updatedAt).toEqual(expect.stringMatching(/Z$/));

    const patchedTemplate = await authedRequest<{
      id: string;
      createdAt: string;
      updatedAt: string;
    }>(token, `/api/workflow-templates/${workflowTemplateId}`, {
      method: "PATCH",
      body: JSON.stringify({ description: "workflow template timestamp coverage updated" }),
    });
    expect(patchedTemplate.status).toBe(200);
    expect(patchedTemplate.data.createdAt).toMatch(/Z$/);
    expect(patchedTemplate.data.updatedAt).toMatch(/Z$/);
  });
});