import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { buildDeleteByIdsStatements, runPostgresCleanupStatements } from "./service-teardown-helpers";

const CP_URL = process.env.TEST_CP_URL || "http://127.0.0.1:4097";
const USERNAME = process.env.TEST_USERNAME || "admin";
const PASSWORD = process.env.TEST_PASSWORD || "admin123!";

const createdOrgIds: string[] = [];
const createdProjectIds: string[] = [];
const createdEnvIds: string[] = [];
const createdPolicyIds: string[] = [];
const createdBudgetIds: string[] = [];
const createdPluginIds: string[] = [];

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
    ...buildDeleteByIdsStatements("budget_configs", createdBudgetIds),
    ...buildDeleteByIdsStatements("policy_templates", createdPolicyIds),
    ...buildDeleteByIdsStatements("environments", createdEnvIds),
    ...buildDeleteByIdsStatements("project_roles", createdProjectIds, "project_id"),
    ...createdProjectIds.flatMap((projectId) => [
      `DELETE FROM project_tree_links WHERE source_project_id='${projectId}' OR target_project_id='${projectId}';`,
      `DELETE FROM project_tree_branches WHERE project_id='${projectId}';`,
      `DELETE FROM project_tree_nodes WHERE project_id='${projectId}';`,
    ]),
    ...buildDeleteByIdsStatements("projects", createdProjectIds),
    ...buildDeleteByIdsStatements("organizations", createdOrgIds),
    ...buildDeleteByIdsStatements("plugins", createdPluginIds),
  ];

  if (statements.length === 0) {
    return;
  }

  runPostgresCleanupStatements(statements, "metadata-route-timestamps.test.ts");
});

let token = "";

beforeAll(async () => {
  token = await login();
});

describe("metadata route timestamp normalization", () => {
  test("returns ISO timestamps across org project env policy budget plugin routes", async () => {
    const unique = Date.now().toString(36);

    const createdOrg = await authedRequest<{ id: string; slug: string; createdAt: string }>(
      token,
      "/api/orgs",
      {
        method: "POST",
        body: JSON.stringify({
          name: `Timestamp Org ${unique}`,
          slug: `timestamp-org-${unique}`,
        }),
      },
    );
    expect(createdOrg.status).toBe(201);
    createdOrgIds.push(createdOrg.data.id);
    expect(createdOrg.data.createdAt).toMatch(/Z$/);

    const orgDetail = await authedRequest<{ id: string; createdAt: string }>(
      token,
      `/api/orgs/${createdOrg.data.id}`,
    );
    expect(orgDetail.status).toBe(200);
    expect(orgDetail.data.createdAt).toMatch(/Z$/);

    const orgList = await authedRequest<Array<{ id: string; createdAt: string }>>(token, "/api/orgs");
    expect(orgList.status).toBe(200);
    expect(orgList.data.find((org) => org.id === createdOrg.data.id)?.createdAt).toEqual(
      expect.stringMatching(/Z$/),
    );

    const createdProject = await authedRequest<{
      id: string;
      rootNodeId: string;
      createdAt: string;
    }>(token, "/api/projects", {
      method: "POST",
      body: JSON.stringify({
        orgId: createdOrg.data.id,
        name: `Timestamp Project ${unique}`,
        slug: `timestamp-project-${unique}`,
        description: "timestamp coverage",
      }),
    });
    expect(createdProject.status).toBe(201);
    createdProjectIds.push(createdProject.data.id);
    expect(createdProject.data.createdAt).toMatch(/Z$/);

    const projectDetail = await authedRequest<{
      id: string;
      createdAt: string;
      updatedAt: string;
    }>(token, `/api/projects/${createdProject.data.id}`);
    expect(projectDetail.status).toBe(200);
    expect(projectDetail.data.createdAt).toMatch(/Z$/);
    expect(projectDetail.data.updatedAt).toMatch(/Z$/);

    const projectList = await authedRequest<
      Array<{ id: string; createdAt: string; updatedAt: string }>
    >(token, `/api/projects?orgId=${createdOrg.data.id}`);
    expect(projectList.status).toBe(200);
    const listedProject = projectList.data.find((project) => project.id === createdProject.data.id);
    expect(listedProject?.createdAt).toEqual(expect.stringMatching(/Z$/));
    expect(listedProject?.updatedAt).toEqual(expect.stringMatching(/Z$/));

    const patchedProject = await authedRequest<{
      id: string;
      createdAt: string;
      updatedAt: string;
      description: string;
    }>(token, `/api/projects/${createdProject.data.id}`, {
      method: "PATCH",
      body: JSON.stringify({ description: "timestamp coverage updated" }),
    });
    expect(patchedProject.status).toBe(200);
    expect(patchedProject.data.createdAt).toMatch(/Z$/);
    expect(patchedProject.data.updatedAt).toMatch(/Z$/);

    const overview = await authedRequest<{
      data: Array<{ id: string; createdAt: string; lastActivityAt: string | null }>;
    }>(token, `/api/projects/overview?orgId=${createdOrg.data.id}&page=1&pageSize=20`);
    expect(overview.status).toBe(200);
    const overviewProject = overview.data.data.find((project) => project.id === createdProject.data.id);
    expect(overviewProject?.createdAt).toEqual(expect.stringMatching(/Z$/));
    expect(overviewProject?.lastActivityAt).toEqual(expect.stringMatching(/Z$/));

    const createdEnv = await authedRequest<{ id: string; createdAt: string }>(token, "/api/envs", {
      method: "POST",
      body: JSON.stringify({
        projectId: createdProject.data.id,
        name: `env-${unique}`,
        riskLevel: "low",
        requiresApproval: false,
      }),
    });
    expect(createdEnv.status).toBe(201);
    createdEnvIds.push(createdEnv.data.id);
    expect(createdEnv.data.createdAt).toMatch(/Z$/);

    const envList = await authedRequest<Array<{ id: string; createdAt: string }>>(
      token,
      `/api/envs?projectId=${createdProject.data.id}`,
    );
    expect(envList.status).toBe(200);
    expect(envList.data.find((env) => env.id === createdEnv.data.id)?.createdAt).toEqual(
      expect.stringMatching(/Z$/),
    );

    const createdPolicy = await authedRequest<{ id: string; createdAt: string }>(
      token,
      "/api/policies",
      {
        method: "POST",
        body: JSON.stringify({
          projectId: createdProject.data.id,
          name: `policy-${unique}`,
          type: "model",
          rules: { allow: ["gpt-5-mini"] },
          appliesTo: "all",
        }),
      },
    );
    expect(createdPolicy.status).toBe(201);
    createdPolicyIds.push(createdPolicy.data.id);
    expect(createdPolicy.data.createdAt).toMatch(/Z$/);

    const policyList = await authedRequest<Array<{ id: string; createdAt: string }>>(
      token,
      `/api/policies?projectId=${createdProject.data.id}`,
    );
    expect(policyList.status).toBe(200);
    expect(policyList.data.find((policy) => policy.id === createdPolicy.data.id)?.createdAt).toEqual(
      expect.stringMatching(/Z$/),
    );

    const createdBudget = await authedRequest<{ id: string; createdAt: string }>(
      token,
      "/api/cost/budget",
      {
        method: "POST",
        body: JSON.stringify({
          projectId: createdProject.data.id,
          period: "monthly",
          limitAmount: 100,
          warnThreshold: 0.8,
          throttleThreshold: 0.95,
        }),
      },
    );
    expect(createdBudget.status).toBe(201);
    createdBudgetIds.push(createdBudget.data.id);
    expect(createdBudget.data.createdAt).toMatch(/Z$/);

    const createdPlugin = await authedRequest<{ id: string; status: string }>(token, "/api/plugins", {
      method: "POST",
      body: JSON.stringify({
        name: `plugin-${unique}`,
        displayName: `Plugin ${unique}`,
        pluginPath: `plugins/plugin-${unique}`,
        source: "local",
      }),
    });
    expect(createdPlugin.status).toBe(201);
    createdPluginIds.push(createdPlugin.data.id);

    const verifiedAt = "2026-04-10T09:00:00.000Z";
    const patchedPlugin = await authedRequest<{
      id: string;
      updatedAt: string;
      lastVerifiedAt: string;
    }>(token, `/api/plugins/${createdPlugin.data.id}`, {
      method: "PATCH",
      body: JSON.stringify({
        version: "1.0.0",
        status: "enabled",
        lastVerifiedAt: verifiedAt,
      }),
    });
    expect(patchedPlugin.status).toBe(200);
    expect(patchedPlugin.data.updatedAt).toMatch(/Z$/);
    expect(patchedPlugin.data.lastVerifiedAt).toMatch(/Z$/);

    const pluginDetail = await authedRequest<{
      id: string;
      createdAt: string;
      updatedAt: string;
      lastVerifiedAt: string | null;
    }>(token, `/api/plugins/${createdPlugin.data.id}`);
    expect(pluginDetail.status).toBe(200);
    expect(pluginDetail.data.createdAt).toMatch(/Z$/);
    expect(pluginDetail.data.updatedAt).toMatch(/Z$/);
    expect(pluginDetail.data.lastVerifiedAt).toMatch(/Z$/);

    const pluginList = await authedRequest<{
      data: Array<{
        id: string;
        createdAt: string;
        updatedAt: string;
        lastVerifiedAt: string | null;
      }>;
    }>(token, "/api/plugins");
    expect(pluginList.status).toBe(200);
    const listedPlugin = pluginList.data.data.find((plugin) => plugin.id === createdPlugin.data.id);
    expect(listedPlugin?.createdAt).toEqual(expect.stringMatching(/Z$/));
    expect(listedPlugin?.updatedAt).toEqual(expect.stringMatching(/Z$/));
    expect(listedPlugin?.lastVerifiedAt).toEqual(expect.stringMatching(/Z$/));
  });
});