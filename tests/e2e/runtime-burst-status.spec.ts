import { expect, test } from "@playwright/test";

const liveBackendTest = process.env.PLAYWRIGHT_LIVE_BACKEND === "1" ? test : test.skip;

const BFF_URL = process.env.PLAYWRIGHT_BFF_URL || "http://127.0.0.1:4098";
const CONTROL_PLANE_URL = process.env.PLAYWRIGHT_CONTROL_PLANE_URL || "http://127.0.0.1:4097";
const UI_URL = process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:4173";
const USERNAME = process.env.TEST_USERNAME || "admin";
const PASSWORD = process.env.TEST_PASSWORD || "admin123!";
const PROJECT_ID = process.env.TEST_PROJECT_ID || "proj-default";

type LoginPayload = {
  token: string;
  user: {
    id: string;
    username: string;
    displayName: string;
    email?: string | null;
    role: string;
    accountStatus?: "active" | "disabled";
    mustChangePassword?: boolean;
    projects?: Array<{ id: string; role: string }>;
  };
};

type TaskCreatePayload = {
  id: string;
  status: string;
};

type TaskExecutePayload = {
  agentRunId: string;
  sessionId: string;
};

type TaskSessionsPayload = {
  data: Array<{
    id: string;
    isActive: boolean;
  }>;
};

async function apiRequest<T>(
  request: Parameters<typeof test>[0]["request"],
  path: string,
  options: {
    method?: "GET" | "POST" | "PATCH" | "DELETE";
    token?: string;
    data?: unknown;
  } = {},
): Promise<T> {
  const response = await request.fetch(`${BFF_URL}${path}`, {
    method: options.method || "GET",
    headers: {
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
      ...(options.data !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    data: options.data,
  });

  const body = await response.text();
  if (!response.ok()) {
    throw new Error(`${options.method || "GET"} ${path} failed: ${response.status()} ${body}`);
  }

  return body ? (JSON.parse(body) as T) : (undefined as T);
}

async function waitForTaskSession(
  request: Parameters<typeof test>[0]["request"],
  token: string,
  taskId: string,
  sessionId: string,
): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 30000) {
    const payload = await apiRequest<TaskSessionsPayload>(
      request,
      `/api/tasks/${taskId}/sessions`,
      {
        token,
      },
    );
    if (payload.data.some((item) => item.id === sessionId)) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error(`Timed out waiting for task session ${sessionId}`);
}

async function ensureControlPlaneTaskSession(
  request: Parameters<typeof test>[0]["request"],
  token: string,
  taskId: string,
  sessionId: string,
): Promise<void> {
  const response = await request.fetch(`${CONTROL_PLANE_URL}/api/tasks/${taskId}/task-sessions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    data: {
      runtimeSessionId: sessionId,
      sourceType: "root",
      isActive: true,
    },
  });

  const body = await response.text();
  if (!response.ok()) {
    throw new Error(`POST control-plane task session failed: ${response.status()} ${body}`);
  }
}

async function login(request: Parameters<typeof test>[0]["request"]): Promise<LoginPayload> {
  return apiRequest<LoginPayload>(request, "/api/auth/login", {
    method: "POST",
    data: { username: USERNAME, password: PASSWORD },
  });
}

async function injectSessionStatus(
  request: Parameters<typeof test>[0]["request"],
  token: string,
  payload: {
    taskId: string;
    projectId: string;
    sessionId: string;
    agentRunId: string;
    info: {
      type: "warning" | "paused-approval" | "cooldown";
      metadata?: Record<string, unknown>;
      until?: string;
      requests?: number;
      tokens?: number;
      cost?: number;
    };
  },
) {
  await apiRequest(request, "/api/realtime/dev/inject-session-status", {
    method: "POST",
    token,
    data: payload,
  });
}

liveBackendTest(
  "task detail shows warning then paused approval and cooldown from runtime session.status",
  async ({ page, request }) => {
    test.setTimeout(90_000);

    const auth = await login(request);
    const token = auth.token;
    const modelList = await apiRequest<{ data?: Array<{ id?: string; provider?: string }> }>(
      request,
      "/api/config/models/list",
      { token },
    );
    const preferredModel = (modelList.data || []).find(
      (item) =>
        typeof item.provider === "string" &&
        item.provider.startsWith("github-copilot") &&
        typeof item.id === "string" &&
        item.id.trim().length > 0,
    );
    const selectedModel = preferredModel
      ? `${preferredModel.provider}:${preferredModel.id}`
      : "github-copilot:gpt-5.4";

    const createdTask = await apiRequest<TaskCreatePayload>(request, "/api/tasks", {
      method: "POST",
      token,
      data: {
        title: `runtime-burst-e2e-${Date.now()}`,
        prompt: "Reply with exactly one line: RUNTIME_BURST_E2E",
        projectId: PROJECT_ID,
        selectedModel,
      },
    });

    let agentRunId: string | null = null;

    try {
      const execution = await apiRequest<TaskExecutePayload>(
        request,
        `/api/tasks/${createdTask.id}/execute`,
        {
          method: "POST",
          token,
        },
      );
      agentRunId = execution.agentRunId;

      await ensureControlPlaneTaskSession(request, token, createdTask.id, execution.sessionId);
      await waitForTaskSession(request, token, createdTask.id, execution.sessionId);

      await page.addInitScript(
        ({ token: authToken, user }) => {
          window.localStorage.setItem("auth", JSON.stringify({ token: authToken, user }));
        },
        { token, user: auth.user },
      );

      await page.goto(`${UI_URL}/tasks/${createdTask.id}`);
      await page.waitForLoadState("domcontentloaded");

      await expect(page.getByText("回复主视图")).toBeVisible();

      await injectSessionStatus(request, token, {
        taskId: createdTask.id,
        projectId: PROJECT_ID,
        sessionId: execution.sessionId,
        agentRunId: execution.agentRunId,
        info: {
          type: "warning",
          metadata: {
            source: "runtime_burst_guard",
            decision: "warning",
            ratio: 0.82,
            window: { seconds: 60 },
          },
          requests: 4,
          tokens: 128,
          cost: 0.32,
        },
      });

      await expect(page.getByText("突发预警").first()).toBeVisible();
      await expect(page.getByText("1 分钟窗口 使用已逼近上限").first()).toBeVisible();
      await expect(
        page.getByText("4 次请求 / 128 tokens / 成本 0.32 / 阈值占用 82%").first(),
      ).toBeVisible();

      await injectSessionStatus(request, token, {
        taskId: createdTask.id,
        projectId: PROJECT_ID,
        sessionId: execution.sessionId,
        agentRunId: execution.agentRunId,
        info: {
          type: "paused-approval",
          metadata: {
            source: "runtime_burst_guard",
            permission: "model_burst_resume",
            decision: "paused-approval",
            window: { seconds: 60 },
          },
          requests: 4,
          tokens: 128,
          cost: 0.32,
        },
      });

      await expect(page.getByText("当前分支已暂停，等待批准继续").first()).toBeVisible();
      await expect(page.getByText("审批项：model_burst_resume")).toBeVisible();
      await expect(page.getByText("待审批").first()).toBeVisible();

      const cooldownUntil = new Date(Date.now() + 65_000).toISOString();
      await injectSessionStatus(request, token, {
        taskId: createdTask.id,
        projectId: PROJECT_ID,
        sessionId: execution.sessionId,
        agentRunId: execution.agentRunId,
        info: {
          type: "cooldown",
          metadata: {
            source: "runtime_burst_guard",
            permission: "model_burst_resume",
            decision: "cooldown",
            window: { seconds: 60 },
          },
          until: cooldownUntil,
          requests: 4,
          tokens: 128,
          cost: 0.32,
        },
      });

      await expect(page.getByText(/审批已通过，冷却剩余/).first()).toBeVisible();
      await expect(page.getByText(/冷却剩余/).first()).toBeVisible();
      await expect(page.getByText("冷却中").first()).toBeVisible();
    } finally {
      if (agentRunId) {
        await request
          .fetch(`${BFF_URL}/api/agents/${agentRunId}/terminate`, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${token}`,
            },
          })
          .catch(() => undefined);
      }

      await request
        .fetch(`${BFF_URL}/api/tasks/${createdTask.id}`, {
          method: "DELETE",
          headers: {
            Authorization: `Bearer ${token}`,
          },
        })
        .catch(() => undefined);
    }
  },
);
