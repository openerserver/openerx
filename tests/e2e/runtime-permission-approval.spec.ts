import { writeFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";

const liveBackendTest = process.env.PLAYWRIGHT_LIVE_BACKEND === "1" ? test : test.skip;

const BFF_URL = process.env.PLAYWRIGHT_BFF_URL || "http://127.0.0.1:4098";
const CONTROL_PLANE_URL = process.env.PLAYWRIGHT_CONTROL_PLANE_URL || "http://127.0.0.1:4097";
const RUNTIME_URL = process.env.PLAYWRIGHT_OPENCODE_URL || "http://127.0.0.1:4096";
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

type RuntimeSessionPayload = {
  id: string;
};

type ModelListPayload = {
  data?: Array<{ id?: string; provider?: string }>;
};

type TestPolicyPayload = {
  data?: {
    effectiveModel?: string | null;
    configuredModel?: string | null;
  };
};

type RuntimePermissionRecord = {
  id: string;
  sessionID: string;
  permission: string;
  metadata?: {
    filepath?: string;
    parentDir?: string;
  } | null;
};

type RuntimeMessageRecord = {
  info?: {
    role?: string;
  };
  parts?: Array<{
    type?: string;
    tool?: string;
    toolName?: string;
    text?: string;
    state?: {
      status?: string;
      output?: string;
      error?: string;
      metadata?: {
        output?: string;
        error?: string;
      };
    };
  }>;
};

async function apiRequest<T>(
  request: Parameters<typeof test>[0]["request"],
  path: string,
  options: {
    baseUrl?: string;
    method?: "GET" | "POST" | "PATCH" | "DELETE";
    token?: string;
    data?: unknown;
  } = {},
): Promise<T> {
  const response = await request.fetch(`${options.baseUrl || BFF_URL}${path}`, {
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

async function login(request: Parameters<typeof test>[0]["request"]): Promise<LoginPayload> {
  return apiRequest<LoginPayload>(request, "/api/auth/login", {
    method: "POST",
    data: { username: USERNAME, password: PASSWORD },
  });
}

async function getAvailableExecutionModel(
  request: Parameters<typeof test>[0]["request"],
  token: string,
): Promise<string> {
  const [modelList, testPolicy] = await Promise.all([
    apiRequest<ModelListPayload>(request, "/api/config/models/list", { token }),
    apiRequest<TestPolicyPayload>(request, "/api/config/models/test-policy", { token }),
  ]);

  const effectiveModel = testPolicy.data?.effectiveModel?.trim();
  if (effectiveModel) {
    return effectiveModel;
  }

  const configuredModel = testPolicy.data?.configuredModel?.trim();
  if (configuredModel) {
    return configuredModel;
  }

  const preferred = (modelList.data || []).find(
    (item) =>
      item.provider === "github-copilot" &&
      typeof item.id === "string" &&
      item.id.trim().length > 0,
  );
  if (preferred?.id) {
    return `${preferred.provider}:${preferred.id}`;
  }

  return "github-copilot:gpt-5-mini";
}

async function waitForRuntimePermission(
  request: Parameters<typeof test>[0]["request"],
  filepath: string,
  timeoutMs = 120_000,
): Promise<RuntimePermissionRecord> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const permissions = await apiRequest<RuntimePermissionRecord[]>(request, "/permission", {
      baseUrl: RUNTIME_URL,
    });
    const hit = (permissions || []).find(
      (item) => item.permission === "external_directory" && item.metadata?.filepath === filepath,
    );
    if (hit) {
      return hit;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error(`Timed out waiting for runtime permission on ${filepath}`);
}

async function ensureControlPlaneTaskSession(
  request: Parameters<typeof test>[0]["request"],
  token: string,
  taskId: string,
  sessionId: string,
): Promise<void> {
  await apiRequest(request, `/api/tasks/${taskId}/branches`, {
    baseUrl: CONTROL_PLANE_URL,
    method: "POST",
    token,
    data: {
      runtimeSessionId: sessionId,
      branchName: "runtime-permission-e2e",
      sourceType: "root",
      isActive: true,
    },
  });
}

async function createRuntimeSession(
  request: Parameters<typeof test>[0]["request"],
  title: string,
): Promise<RuntimeSessionPayload> {
  return apiRequest<RuntimeSessionPayload>(request, "/session", {
    baseUrl: RUNTIME_URL,
    method: "POST",
    data: { title },
  });
}

async function sendRuntimePrompt(
  request: Parameters<typeof test>[0]["request"],
  sessionId: string,
  prompt: string,
  selectedModel: string,
): Promise<void> {
  const delimiterIndex = selectedModel.indexOf(":");
  const providerID =
    delimiterIndex >= 0 ? selectedModel.slice(0, delimiterIndex) : "github-copilot";
  const rawModelID = delimiterIndex >= 0 ? selectedModel.slice(delimiterIndex + 1) : selectedModel;
  const modelID = rawModelID.startsWith(`${providerID}/`)
    ? rawModelID.slice(providerID.length + 1)
    : rawModelID;

  await apiRequest(request, `/session/${sessionId}/prompt_async`, {
    baseUrl: RUNTIME_URL,
    method: "POST",
    data: {
      parts: [{ type: "text", text: prompt }],
      model: { providerID, modelID },
      agent: "build",
    },
  });
}

async function waitForPermissionCleared(
  request: Parameters<typeof test>[0]["request"],
  requestId: string,
  timeoutMs = 30_000,
): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const permissions = await apiRequest<RuntimePermissionRecord[]>(request, "/permission", {
      baseUrl: RUNTIME_URL,
    });
    if (!(permissions || []).some((item) => item.id === requestId)) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error(`Timed out waiting for permission ${requestId} to clear`);
}

function extractTextFromRuntimeMessages(messages: RuntimeMessageRecord[]): string {
  return messages
    .flatMap((message) => message.parts || [])
    .map((part) => {
      const output =
        part.state?.output ||
        part.state?.metadata?.output ||
        part.state?.error ||
        part.state?.metadata?.error ||
        part.text;
      return typeof output === "string" ? output : "";
    })
    .filter(Boolean)
    .join("\n");
}

async function waitForRuntimeReadCompletion(
  request: Parameters<typeof test>[0]["request"],
  sessionId: string,
  marker: string,
  timeoutMs = 60_000,
): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const messages = await apiRequest<RuntimeMessageRecord[]>(
      request,
      `/session/${sessionId}/message?limit=50`,
      { baseUrl: RUNTIME_URL },
    );

    const hasCompletedRead = (messages || []).some((message) =>
      (message.parts || []).some(
        (part) =>
          part.type === "tool" &&
          (part.tool === "read" || part.toolName === "read") &&
          part.state?.status === "completed",
      ),
    );
    const text = extractTextFromRuntimeMessages(messages || []);
    if (hasCompletedRead && text.includes(marker)) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error(`Timed out waiting for runtime session ${sessionId} to resume after approval`);
}

liveBackendTest(
  "task detail V3 can approve a real external_directory request and resume runtime execution",
  async ({ page, request }) => {
    test.setTimeout(180_000);

    const auth = await login(request);
    const token = auth.token;
    const selectedModel = await getAvailableExecutionModel(request, token);
    const unique = Date.now();
    const filepath = `/tmp/openerx-runtime-permission-e2e-${unique}.txt`;
    const marker = `EXTERNAL_DIRECTORY_APPROVAL_E2E_${unique}`;

    await writeFile(
      filepath,
      `${marker}\nThis file is outside the runtime workspace and should require approval.\n`,
      "utf8",
    );

    const createdTask = await apiRequest<TaskCreatePayload>(request, "/api/tasks", {
      method: "POST",
      token,
      data: {
        title: `runtime-permission-e2e-${unique}`,
        prompt: `Use the read tool immediately on the exact absolute path ${filepath}. Do not ask for confirmation. After the tool returns, answer with exactly the first line from that file and nothing else.`,
        projectId: PROJECT_ID,
        selectedModel,
      },
    });

    const runtimeSession = await createRuntimeSession(
      request,
      `[Task ${createdTask.id}] runtime-permission-e2e`,
    );
    await sendRuntimePrompt(
      request,
      runtimeSession.id,
      `Use the read tool immediately on the exact absolute path ${filepath}. Do not ask for confirmation. After the tool returns, answer with exactly the first line from that file and nothing else.`,
      selectedModel,
    );

    const permission = await waitForRuntimePermission(request, filepath);
    await ensureControlPlaneTaskSession(request, token, createdTask.id, permission.sessionID);

    await page.addInitScript(
      ({ authToken, user }) => {
        window.localStorage.setItem("auth", JSON.stringify({ token: authToken, user }));
      },
      { authToken: token, user: auth.user },
    );

    await page.goto(`${UI_URL}/tasks/${createdTask.id}/v3?session=${permission.sessionID}`);
    await expect(page.getByText("运行时审批")).toBeVisible();
    await expect(page.locator(".runtime-permission-card__path")).toHaveText(filepath);

    const approveButton = page.getByRole("button", { name: "允许本次" });
    await approveButton.evaluate((node) => {
      if (node instanceof HTMLElement) {
        node.click();
      }
    });

    await expect(page.getByText("已允许本次访问")).toBeVisible();
    await waitForPermissionCleared(request, permission.id);
    await waitForRuntimeReadCompletion(request, permission.sessionID, marker);

    await expect(page.getByText(marker)).toBeVisible();
  },
);
