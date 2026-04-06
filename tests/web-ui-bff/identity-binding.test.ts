/**
 * Identity Binding — BFF Integration Tests
 *
 * Tests the BFF credential proxy routes and the identity resolution
 * flow that happens during task execution.
 *
 * Requires: CP service on TEST_CP_URL, BFF on TEST_BFF_URL,
 *           with seed data already applied (admin/admin123!, proj-default).
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { selectCredentialForIdentity } from "../../control-plane/web-ui-bff/src/modules/tasks/routes";
import {
  paidExecutionIntegrationDescribe,
  resolveExecutionIntegrationModel,
} from "./execution-integration-guard";
import {
  buildDeleteStatements,
  buildTaskCleanupStatements,
  resolveBffUrl,
  resolveControlPlaneUrl,
  runCleanupStatements,
} from "./test-env";

const BFF_URL = resolveBffUrl();
const CP_URL = resolveControlPlaneUrl();
const PROJECT_ID = process.env.TEST_PROJECT_ID || "proj-default";
const USERNAME = process.env.TEST_USERNAME || "admin";
const PASSWORD = process.env.TEST_PASSWORD || "admin123!";
const executionIntegrationDescribe = paidExecutionIntegrationDescribe;

interface ConfigModelRecord {
  id?: string;
  provider?: string;
}

interface TaskBranchRecord {
  id: string;
  taskSessionId: string;
  title?: string;
  isActive?: boolean;
}

interface TaskExecutionTraceSegment {
  type?: string;
  content?: string | null;
  toolName?: string | null;
  toolStatus?: string | null;
}

interface TaskExecutionTracePayload {
  finalPrompt?: string | null;
  latestResponse?: string | null;
  timelineMeta?: {
    readSource?: string | null;
  } | null;
  snapshot?: {
    currentStatus?: string | null;
    latestResult?: string | null;
  } | null;
  segments?: TaskExecutionTraceSegment[];
}

interface AgentMessagePartRecord {
  type?: string;
  text?: string;
  toolName?: string;
  tool?: string;
  callID?: string;
  state?: {
    output?: unknown;
    error?: unknown;
  };
}

interface AgentMessageRecord {
  info?: {
    role?: string;
    id?: string;
  };
  parts?: AgentMessagePartRecord[];
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

function readAgentMessagePartToolName(part: AgentMessagePartRecord): string | undefined {
  return typeof part.toolName === "string" && part.toolName
    ? part.toolName
    : typeof part.tool === "string" && part.tool
      ? part.tool
      : undefined;
}

function readAgentMessagePartText(part: AgentMessagePartRecord): string | undefined {
  if (typeof part.text === "string" && part.text) {
    return part.text;
  }

  return typeof part.state?.output === "string" && part.state.output ? part.state.output : undefined;
}

// ── Helpers ────────────────────────────────────────────────────────

async function request<T>(
  baseUrl: string,
  path: string,
  opts: RequestInit = {},
): Promise<{ data: T; status: number }> {
  const res = await fetch(`${baseUrl}${path}`, opts);
  const text = await res.text();
  let data: unknown;
  try {
    data = text ? JSON.parse(text) : undefined;
  } catch {
    data = text;
  }
  return { data: data as T, status: res.status };
}

async function bffRequest<T>(token: string, path: string, opts: RequestInit = {}) {
  return request<T>(BFF_URL, path, {
    ...opts,
    headers: {
      ...(opts.headers as Record<string, string>),
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });
}

async function cpRequest<T>(token: string, path: string, opts: RequestInit = {}) {
  return request<T>(CP_URL, path, {
    ...opts,
    headers: {
      ...(opts.headers as Record<string, string>),
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });
}

async function login(): Promise<string> {
  // Login via BFF
  const { data, status } = await request<{ token: string }>(BFF_URL, "/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: USERNAME, password: PASSWORD }),
  });
  if (status !== 200) throw new Error(`Login failed: ${status} ${JSON.stringify(data)}`);
  return data.token;
}

async function getAvailableCopilotModel(token: string): Promise<string> {
  const [{ data: modelList, status: modelStatus }, { data: testPolicy }] = await Promise.all([
    bffRequest<{ data?: ConfigModelRecord[] }>(token, "/api/config/models/list"),
    bffRequest<{ data?: { effectiveModel?: string | null } }>(
      token,
      "/api/config/models/test-policy",
    ),
  ]);
  const configuredModels = modelStatus === 200 ? modelList.data || [] : [];
  return resolveExecutionIntegrationModel(configuredModels, testPolicy.data?.effectiveModel);
}

// ── Cleanup ────────────────────────────────────────────────────────

const createdCredentialIds: string[] = [];
const createdTaskIds: string[] = [];
const createdRepositoryIds: string[] = [];

afterAll(async () => {
  const stmts = [
    ...buildTaskCleanupStatements(createdTaskIds),
    ...buildDeleteStatements("repository_credentials", createdCredentialIds),
    ...buildDeleteStatements("repositories", createdRepositoryIds),
  ];
  await runCleanupStatements(stmts, "identity binding test");
});

// ── State ──────────────────────────────────────────────────────────

let token = "";

beforeAll(async () => {
  token = await login();
});

async function waitForTaskIdentity(
  taskId: string,
  predicate: (task: Record<string, unknown>) => boolean,
  timeoutMs = 15000,
): Promise<Record<string, unknown>> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const { data, status } = await cpRequest<Record<string, unknown>>(
      token,
      `/api/project-tree/tasks/${taskId}`,
    );

    if (status === 200 && predicate(data)) {
      return data;
    }

    await sleep(250);
  }

  throw new Error(`Timed out waiting for identity snapshot on task ${taskId}`);
}

async function waitForTaskExecutionTrace(
  taskId: string,
  predicate: (trace: TaskExecutionTracePayload) => boolean,
  timeoutMs = 120000,
): Promise<TaskExecutionTracePayload> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const { data, status } = await bffRequest<TaskExecutionTracePayload>(
      token,
      `/api/tasks/${taskId}/execution-trace`,
    );

    if (status === 200 && predicate(data)) {
      return data;
    }

    await sleep(1000);
  }

  throw new Error(`Timed out waiting for execution trace on task ${taskId}`);
}

async function waitForAgentMessages(
  agentRunId: string,
  predicate: (messages: AgentMessageRecord[]) => boolean,
  timeoutMs = 120000,
): Promise<AgentMessageRecord[]> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const { data, status } = await bffRequest<{
      ok?: boolean;
      data?: AgentMessageRecord[];
    }>(token, `/api/agents/${encodeURIComponent(agentRunId)}/messages`);

    if (status === 200 && predicate(data.data || [])) {
      return data.data || [];
    }

    await sleep(1000);
  }

  throw new Error(`Timed out waiting for agent messages on agent run ${agentRunId}`);
}

describe("Identity selection helper", () => {
  test("falls back to project default when repo has no dedicated credential", () => {
    const selected = selectCredentialForIdentity(
      [
        {
          id: "project-default",
          label: "Project Default",
          repoId: null,
          scope: "project",
          isDefault: true,
          status: "active",
        },
      ],
      "repo-1",
    );

    expect(selected?.id).toBe("project-default");
  });

  test("prefers repo default and skips revoked credentials", () => {
    const selected = selectCredentialForIdentity(
      [
        {
          id: "revoked-repo-default",
          label: "Revoked Repo Default",
          repoId: "repo-1",
          scope: "project",
          isDefault: true,
          status: "revoked",
        },
        {
          id: "repo-active",
          label: "Repo Active",
          repoId: "repo-1",
          scope: "project",
          isDefault: true,
          status: "active",
        },
        {
          id: "project-default",
          label: "Project Default",
          repoId: null,
          scope: "project",
          isDefault: true,
          status: "active",
        },
      ],
      "repo-1",
    );

    expect(selected?.id).toBe("repo-active");
  });
});

// ════════════════════════════════════════════════════════════════════
// 1. BFF Credential Proxy Routes
// ════════════════════════════════════════════════════════════════════

describe("BFF Credential Proxy", () => {
  let credId = "";

  test("POST create credential via BFF", async () => {
    const { data, status } = await bffRequest<{ id: string; label: string }>(
      token,
      "/api/credentials",
      {
        method: "POST",
        body: JSON.stringify({
          projectId: PROJECT_ID,
          label: "bff-test-cred",
          provider: "github",
          credentialType: "pat",
          secretRef: "vault://bff-test/pat-ref",
          gitAuthorName: "BFF Test Author",
          gitAuthorEmail: "bff@test.openerx.dev",
          scope: "project",
          isDefault: false,
        }),
      },
    );

    expect(status).toBe(201);
    expect(data.id).toBeTruthy();
    expect(data.label).toBe("bff-test-cred");
    credId = data.id;
    createdCredentialIds.push(credId);
  });

  test("GET list credentials via BFF", async () => {
    const { data, status } = await bffRequest<{ data: Array<Record<string, unknown>> }>(
      token,
      `/api/credentials?projectId=${PROJECT_ID}`,
    );

    expect(status).toBe(200);
    expect(Array.isArray(data.data)).toBe(true);
    const found = data.data.find((c) => c.id === credId);
    expect(found).toBeTruthy();
    expect(found?.label).toBe("bff-test-cred");
  });

  test("GET single credential via BFF masks secret", async () => {
    const { data, status } = await bffRequest<Record<string, unknown>>(
      token,
      `/api/credentials/${credId}?projectId=${PROJECT_ID}`,
    );

    expect(status).toBe(200);
    expect(data.id).toBe(credId);
    expect(data.secretRefMasked).toBe("***");
    expect(data.secretRef).toBeUndefined();
  });

  test("PATCH update credential via BFF", async () => {
    const { data, status } = await bffRequest<Record<string, unknown>>(
      token,
      `/api/credentials/${credId}`,
      {
        method: "PATCH",
        body: JSON.stringify({
          projectId: PROJECT_ID,
          label: "bff-updated-label",
        }),
      },
    );

    expect(status).toBe(200);
    expect(data.label).toBe("bff-updated-label");
  });

  test("DELETE credential via BFF", async () => {
    // Create a disposable credential to delete
    const { data: created } = await bffRequest<{ id: string }>(token, "/api/credentials", {
      method: "POST",
      body: JSON.stringify({
        projectId: PROJECT_ID,
        label: "disposable-cred",
        provider: "github",
        credentialType: "pat",
        secretRef: "vault://disposable",
      }),
    });
    createdCredentialIds.push(created.id);

    const { data, status } = await bffRequest<{ ok: boolean }>(
      token,
      `/api/credentials/${created.id}?projectId=${PROJECT_ID}`,
      { method: "DELETE" },
    );

    expect(status).toBe(200);
    expect(data.ok).toBe(true);

    // Verify revoked via CP
    const { data: check } = await cpRequest<Record<string, unknown>>(
      token,
      `/api/projects/${PROJECT_ID}/credentials/${created.id}`,
    );
    expect(check.status).toBe("revoked");
  });

  test("BFF credential routes reject missing projectId", async () => {
    const { status } = await bffRequest(token, "/api/credentials");
    expect(status).toBe(400);
  });
});

// ════════════════════════════════════════════════════════════════════
// 2. Task Creation Through BFF with Identity
// ════════════════════════════════════════════════════════════════════

describe("BFF Task with Identity", () => {
  let credId = "";

  beforeAll(async () => {
    // Create credential to attach to task
    const { data } = await cpRequest<{ id: string }>(
      token,
      `/api/projects/${PROJECT_ID}/credentials`,
      {
        method: "POST",
        body: JSON.stringify({
          label: "bff-task-cred",
          provider: "github",
          credentialType: "pat",
          secretRef: "vault://bff-task/cred",
          gitAuthorName: "BFF Task Author",
          gitAuthorEmail: "bff-task@test.openerx.dev",
          scope: "project",
          isDefault: true,
        }),
      },
    );
    credId = data.id;
    createdCredentialIds.push(credId);
  });

  test("POST create task with credentialId via BFF", async () => {
    const { data, status } = await bffRequest<{ id: string; status: string }>(token, "/api/tasks", {
      method: "POST",
      body: JSON.stringify({
        title: "BFF Identity Task",
        prompt: "Test task creation through BFF with credential",
        projectId: PROJECT_ID,
        credentialId: credId,
        gitAuthorName: "BFF Author",
        gitAuthorEmail: "bff-author@test.openerx.dev",
      }),
    });

    expect(status).toBe(201);
    expect(data.id).toBeTruthy();
    createdTaskIds.push(data.id);

    // Verify identity fields persisted via CP
    const { data: detail, status: detailStatus } = await cpRequest<Record<string, unknown>>(
      token,
      `/api/project-tree/tasks/${data.id}`,
    );
    expect(detailStatus).toBe(200);
    expect(detail.credentialId).toBe(credId);
    expect(detail.gitAuthorName).toBe("BFF Author");
    expect(detail.gitAuthorEmail).toBe("bff-author@test.openerx.dev");
  });

  test("POST create task without credential (backwards compat) via BFF", async () => {
    const { data, status } = await bffRequest<{ id: string }>(token, "/api/tasks", {
      method: "POST",
      body: JSON.stringify({
        title: "BFF Legacy Task",
        prompt: "No credential, should still work",
        projectId: PROJECT_ID,
      }),
    });

    expect(status).toBe(201);
    createdTaskIds.push(data.id);

    const { data: detail, status: detailStatus } = await cpRequest<Record<string, unknown>>(
      token,
      `/api/project-tree/tasks/${data.id}`,
    );
    expect(detailStatus).toBe(200);
    expect(detail.credentialId).toBeNull();
    expect(detail.gitAuthorName).toBeNull();
  });
});

// ════════════════════════════════════════════════════════════════════
// 3. Cross-Layer Consistency
// ════════════════════════════════════════════════════════════════════

describe("Cross-Layer Consistency", () => {
  test("credential created via BFF is visible via CP", async () => {
    const { data: created } = await bffRequest<{ id: string }>(token, "/api/credentials", {
      method: "POST",
      body: JSON.stringify({
        projectId: PROJECT_ID,
        label: "cross-layer-cred",
        provider: "gitlab",
        credentialType: "oauth_token",
        secretRef: "vault://cross-layer/token",
        gitAuthorName: "Cross Layer",
        gitAuthorEmail: "cross@test.openerx.dev",
        scope: "shared",
      }),
    });
    createdCredentialIds.push(created.id);

    // Fetch directly from CP
    const { data: cpCred, status } = await cpRequest<Record<string, unknown>>(
      token,
      `/api/projects/${PROJECT_ID}/credentials/${created.id}`,
    );

    expect(status).toBe(200);
    expect(cpCred.id).toBe(created.id);
    expect(cpCred.provider).toBe("gitlab");
    expect(cpCred.scope).toBe("shared");
    expect(cpCred.gitAuthorName).toBe("Cross Layer");
    expect(cpCred.secretRefMasked).toBe("***");
  });

  test("task with credential shows credentialLabel in list", async () => {
    // Create credential
    const { data: cred } = await cpRequest<{ id: string }>(
      token,
      `/api/projects/${PROJECT_ID}/credentials`,
      {
        method: "POST",
        body: JSON.stringify({
          label: "list-label-cred",
          provider: "github",
          credentialType: "pat",
          secretRef: "vault://list-test",
        }),
      },
    );
    createdCredentialIds.push(cred.id);

    // Create task with that credential
    const { data: task } = await cpRequest<{ id: string }>(token, "/api/tasks", {
      method: "POST",
      body: JSON.stringify({
        title: "Label Verification Task",
        prompt: "Verify credentialLabel in list",
        projectId: PROJECT_ID,
        credentialId: cred.id,
      }),
    });
    createdTaskIds.push(task.id);

    // Fetch task list
    const { data: list, status: listStatus } = await cpRequest<{
      data: Array<Record<string, unknown>>;
    }>(token, `/api/project-tree/tasks?projectId=${PROJECT_ID}`);
    expect(listStatus).toBe(200);

    const found = list.data.find((t) => t.id === task.id);
    expect(found).toBeTruthy();
    expect(found?.credentialLabel).toBe("list-label-cred");
  });
});

// ════════════════════════════════════════════════════════════════════
// 4. Execute Route Identity Resolution
// ════════════════════════════════════════════════════════════════════

executionIntegrationDescribe("Execute route identity resolution", () => {
  test("POST execute falls back to project default credential and patches task identity", async () => {
    const selectedModel = await getAvailableCopilotModel(token);
    const repoName = `exec-fallback-repo-${Date.now()}`;
    const { data: repository, status: repoStatus } = await bffRequest<{ id: string }>(
      token,
      "/api/repositories",
      {
        method: "POST",
        body: JSON.stringify({
          projectId: PROJECT_ID,
          name: repoName,
          provider: "github",
          remoteUrl: `https://github.com/openerx/${repoName}.git`,
          defaultBranch: "main",
        }),
      },
    );

    expect(repoStatus).toBe(201);
    createdRepositoryIds.push(repository.id);

    const { data: credential, status: credentialStatus } = await bffRequest<{ id: string }>(
      token,
      "/api/credentials",
      {
        method: "POST",
        body: JSON.stringify({
          projectId: PROJECT_ID,
          label: `exec-project-default-${Date.now()}`,
          provider: "github",
          credentialType: "pat",
          secretRef: "vault://exec/project-default",
          gitAuthorName: "Execute Default Author",
          gitAuthorEmail: "execute-default@test.openerx.dev",
          scope: "project",
          isDefault: true,
        }),
      },
    );

    expect(credentialStatus).toBe(201);
    createdCredentialIds.push(credential.id);

    const { data: task, status: taskStatus } = await bffRequest<{ id: string }>(
      token,
      "/api/tasks",
      {
        method: "POST",
        body: JSON.stringify({
          title: `Execute Fallback Task ${Date.now()}`,
          prompt: "Inspect the repository briefly and return one concise status line.",
          projectId: PROJECT_ID,
          repoId: repository.id,
          selectedModel,
        }),
      },
    );

    expect(taskStatus).toBe(201);
    createdTaskIds.push(task.id);

    let agentRunId: string | undefined;

    try {
      const { data: execution, status: executeStatus } = await bffRequest<{
        agentRunId: string;
        sessionId: string;
        status: string;
      }>(token, `/api/tasks/${task.id}/execute`, {
        method: "POST",
      });

      expect(executeStatus).toBe(200);
      expect(execution.status).toBe("running");
      expect(execution.sessionId).toBeTruthy();
      expect(execution.agentRunId).toBeTruthy();
      agentRunId = execution.agentRunId;

      const patchedTask = await waitForTaskIdentity(
        task.id,
        (currentTask) =>
          typeof currentTask.credentialId === "string" &&
          currentTask.credentialId.length > 0 &&
          typeof currentTask.gitAuthorName === "string" &&
          currentTask.gitAuthorName.length > 0 &&
          typeof currentTask.gitAuthorEmail === "string" &&
          currentTask.gitAuthorEmail.length > 0,
      );

      const { data: resolvedCredential, status: resolvedCredentialStatus } = await cpRequest<{
        id: string;
        repoId: string | null;
        isDefault: boolean;
        gitAuthorName: string | null;
        gitAuthorEmail: string | null;
      }>(
        token,
        `/api/projects/${PROJECT_ID}/credentials/${encodeURIComponent(String(patchedTask.credentialId))}`,
      );

      expect(resolvedCredentialStatus).toBe(200);
      expect(resolvedCredential.repoId).toBeNull();
      expect(resolvedCredential.isDefault).toBe(true);
      expect(patchedTask.gitAuthorName).toBe(resolvedCredential.gitAuthorName);
      expect(patchedTask.gitAuthorEmail).toBe(resolvedCredential.gitAuthorEmail);
      expect(patchedTask.gitCommitterName).toBe(resolvedCredential.gitAuthorName);
      expect(patchedTask.gitCommitterEmail).toBe(resolvedCredential.gitAuthorEmail);
      expect(patchedTask.status === "running" || patchedTask.status === "completed").toBe(true);
    } finally {
      if (agentRunId) {
        await bffRequest(token, `/api/agents/${agentRunId}/terminate`, {
          method: "POST",
        }).catch(() => undefined);
      }
    }
  });
});

executionIntegrationDescribe("Execute route live roundtrip", () => {
  test("persists live assistant roundtrip into execution trace latestResponse", async () => {
    const selectedModel = await getAvailableCopilotModel(token);
    const uniqueMarker = `assistant-roundtrip-${Date.now()}`;
    const { data: task, status: taskStatus } = await bffRequest<{ id: string }>(token, "/api/tasks", {
      method: "POST",
      body: JSON.stringify({
        title: `Assistant Roundtrip ${Date.now()}`,
        prompt: [
          "Reply with exactly one line.",
          `Include the exact token ${uniqueMarker}.`,
          "Do not use tools unless absolutely required.",
        ].join(" "),
        projectId: PROJECT_ID,
        selectedModel,
      }),
    });

    expect(taskStatus).toBe(201);
    createdTaskIds.push(task.id);

    let agentRunId: string | undefined;

    try {
      const { data: execution, status: executeStatus } = await bffRequest<{
        agentRunId: string;
        sessionId: string;
        status: string;
      }>(token, `/api/tasks/${task.id}/execute`, {
        method: "POST",
      });

      expect(executeStatus).toBe(200);
      expect(execution.agentRunId).toBeTruthy();
      expect(execution.sessionId).toBeTruthy();
      agentRunId = execution.agentRunId;

      const trace = await waitForTaskExecutionTrace(
        task.id,
        (payload) =>
          payload.snapshot?.currentStatus === "completed" &&
          typeof payload.latestResponse === "string" &&
          payload.latestResponse.trim().length > 0 &&
          payload.latestResponse.includes("assistant-roundtrip-"),
      );

      expect(trace.latestResponse).toContain("assistant-roundtrip-");
      expect(trace.snapshot?.currentStatus).toBe("completed");
      expect(trace.timelineMeta?.readSource).toBe("task-session-projection");
      expect(
        trace.snapshot?.latestResult == null ||
          (typeof trace.snapshot.latestResult === "string" &&
            trace.snapshot.latestResult.includes("assistant-roundtrip-")),
      ).toBe(true);
    } finally {
      if (agentRunId) {
        await bffRequest(token, `/api/agents/${agentRunId}/terminate`, {
          method: "POST",
        }).catch(() => undefined);
      }
    }
  });

  test("persists live tool roundtrip into execution trace and task-domain tool records", async () => {
    const selectedModel = await getAvailableCopilotModel(token);
    const uniqueMarker = `tool-roundtrip-${Date.now()}`;
    const { data: task, status: taskStatus } = await bffRequest<{ id: string }>(token, "/api/tasks", {
      method: "POST",
      body: JSON.stringify({
        title: `Tool Roundtrip ${Date.now()}`,
        prompt: [
          "You must call the bash tool before answering.",
          "Run the command pwd.",
          `Then reply with exactly one line that starts with ${uniqueMarker}: followed by the pwd output.`,
          "Do not answer from memory and do not skip the tool call.",
        ].join(" "),
        projectId: PROJECT_ID,
        selectedModel,
      }),
    });

    expect(taskStatus).toBe(201);
    createdTaskIds.push(task.id);

    let agentRunId: string | undefined;

    try {
      const { data: execution, status: executeStatus } = await bffRequest<{
        agentRunId: string;
        sessionId: string;
        status: string;
      }>(token, `/api/tasks/${task.id}/execute`, {
        method: "POST",
      });

      expect(executeStatus).toBe(200);
      expect(execution.agentRunId).toBeTruthy();
      expect(execution.sessionId).toBeTruthy();
      agentRunId = execution.agentRunId;

      const trace = await waitForTaskExecutionTrace(task.id, (payload) => {
        return (
          payload.snapshot?.currentStatus === "completed" &&
          typeof payload.latestResponse === "string" &&
          payload.latestResponse.trim().startsWith(`${uniqueMarker}:`)
        );
      });

      expect(trace.latestResponse).toStartWith(`${uniqueMarker}:`);
      expect(trace.snapshot?.currentStatus).toBe("completed");
      expect(trace.timelineMeta?.readSource).toBe("task-session-projection");
      expect(
        Array.isArray(trace.segments) &&
          trace.segments.some((segment) => segment.type === "tool-call" && segment.toolName === "bash"),
      ).toBe(true);
      expect(
        Array.isArray(trace.segments) &&
          trace.segments.some((segment) => segment.type === "tool-output" && segment.toolName === "bash"),
      ).toBe(true);

      const expectedToolOutput = trace.latestResponse
        .slice(`${uniqueMarker}:`.length)
        .trim();

      const messages = await waitForAgentMessages(agentRunId, (records) => {
        const hasToolCall = records.some(
          (record) =>
            Array.isArray(record.parts) &&
            record.parts.some(
              (part) => part.type === "tool" && readAgentMessagePartToolName(part) === "bash",
            ),
        );
        const hasToolResult = records.some(
          (record) =>
            Array.isArray(record.parts) &&
            record.parts.some(
              (part) =>
                typeof readAgentMessagePartText(part) === "string" &&
                readAgentMessagePartText(part)?.includes(expectedToolOutput),
            ),
        );
        return hasToolCall && hasToolResult;
      });

      expect(
        messages.some(
          (record) =>
            Array.isArray(record.parts) &&
            record.parts.some(
              (part) => part.type === "tool" && readAgentMessagePartToolName(part) === "bash",
            ),
        ),
      ).toBe(true);
      expect(
        messages.some(
          (record) =>
            Array.isArray(record.parts) &&
            record.parts.some(
              (part) =>
                typeof readAgentMessagePartText(part) === "string" &&
                readAgentMessagePartText(part)?.includes(expectedToolOutput),
            ),
        ),
      ).toBe(true);
    } finally {
      if (agentRunId) {
        await bffRequest(token, `/api/agents/${agentRunId}/terminate`, {
          method: "POST",
        }).catch(() => undefined);
      }
    }
  });
});
