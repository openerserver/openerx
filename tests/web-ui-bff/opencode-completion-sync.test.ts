import { expect, test } from "bun:test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const BFF_URL = process.env.TEST_BFF_URL || "http://127.0.0.1:4098";
const PROJECT_ID = process.env.TEST_PROJECT_ID || "proj-default";
const USERNAME = process.env.TEST_USERNAME || "admin";
const PASSWORD = process.env.TEST_PASSWORD || "admin123!";
const DB_PATH =
  process.env.TEST_DB_PATH || resolve(__dirname, "../../control-plane/service/data/openerx.db");
const executionIntegrationTest = process.env.RUN_EXECUTION_INTEGRATION === "1" ? test : test.skip;

function sleep(ms: number): Promise<void> {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${BFF_URL}${path}`, options);
  const text = await response.text();

  let data: unknown;
  try {
    data = text ? JSON.parse(text) : undefined;
  } catch {
    data = text;
  }

  if (!response.ok) {
    throw new Error(
      `${options.method || "GET"} ${path} failed: ${response.status} ${JSON.stringify(data)}`,
    );
  }

  return data as T;
}

async function login(): Promise<string> {
  const data = await request<{ token: string }>("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: USERNAME, password: PASSWORD }),
  });
  return data.token;
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;

  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, resolve, reject };
}

async function waitForEvent(
  events: Array<Record<string, unknown>>,
  type: string,
  predicate: (event: Record<string, unknown>) => boolean = () => true,
  timeoutMs = 120000,
): Promise<Record<string, unknown>> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const match = events.find((event) => event.type === type && predicate(event));
    if (match) {
      return match;
    }
    await sleep(250);
  }

  throw new Error(`Timed out waiting for event ${type}`);
}

function extractAssistantText(messages: unknown): string {
  const normalized = Array.isArray(messages)
    ? messages
    : typeof messages === "object" &&
        messages &&
        Array.isArray((messages as { data?: unknown[] }).data)
      ? (messages as { data: unknown[] }).data
      : [];

  for (let index = normalized.length - 1; index >= 0; index--) {
    const message = normalized[index] as {
      info?: Record<string, unknown>;
      parts?: Array<Record<string, unknown>>;
    };
    if (message?.info?.role !== "assistant") {
      continue;
    }

    const text = (message.parts || [])
      .filter((part) => part.type === "text" && typeof part.text === "string")
      .map((part) => String(part.text).trim())
      .filter(Boolean)
      .join("\n\n");

    if (text) {
      return text;
    }
  }

  return "";
}

async function waitForCompletedStatus(
  token: string,
  taskId: string,
  agentRunId: string,
): Promise<{
  agentStatus: { status: string };
  taskStatus: { status: string; result: string | null; finishedAt: string | null };
}> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < 30000) {
    const [agentStatus, taskStatus] = await Promise.all([
      request<{ status: string }>(`/api/agents/${agentRunId}/status`, {
        headers: { Authorization: `Bearer ${token}` },
      }),
      request<{ status: string; result: string | null; finishedAt: string | null }>(
        `/api/tasks/${taskId}`,
        {
          headers: { Authorization: `Bearer ${token}` },
        },
      ),
    ]);
    const completedStatuses =
      agentStatus.status === "completed" && taskStatus.status === "completed";
    const hasFinishedAt = Boolean(taskStatus.finishedAt);

    if (completedStatuses && hasFinishedAt) {
      return { agentStatus, taskStatus };
    }

    await sleep(250);
  }

  throw new Error(`Timed out waiting for completed status of task ${taskId}`);
}

async function waitForAssistantResult(
  token: string,
  taskId: string,
  agentRunId: string,
): Promise<{
  taskStatus: { status: string; result: string | null; finishedAt: string | null };
  assistantText: string;
}> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < 30000) {
    const [taskStatus, messages] = await Promise.all([
      request<{ status: string; result: string | null; finishedAt: string | null }>(
        `/api/tasks/${taskId}`,
        {
          headers: { Authorization: `Bearer ${token}` },
        },
      ),
      request(`/api/agents/${agentRunId}/messages`, {
        headers: { Authorization: `Bearer ${token}` },
      }),
    ]);

    const assistantText = extractAssistantText(messages);
    if (assistantText && taskStatus.result === assistantText) {
      return { taskStatus, assistantText };
    }

    await sleep(250);
  }

  throw new Error(`Timed out waiting for assistant result of task ${taskId}`);
}

async function deleteTask(taskId: string): Promise<void> {
  await Bun.$`sqlite3 ${DB_PATH} ${`delete from tasks where id='${taskId}';`}`;
}

async function runCompletionSyncScenario(options: {
  titlePrefix: string;
  prompt: string;
  intervene: boolean;
  expectResultSync: boolean;
}): Promise<void> {
  const health = await request<{ status: string }>("/health");
  expect(health.status).toBe("ok");

  const token = await login();
  const authHeaders = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };

  const task = await request<{ id: string }>("/api/tasks", {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({
      title: `${options.titlePrefix}-${Date.now()}`,
      projectId: PROJECT_ID,
      prompt: options.prompt,
    }),
  });

  const events: Array<Record<string, unknown>> = [];
  const wsReady = createDeferred<void>();
  const ws = new WebSocket(
    `${BFF_URL.replace("http", "ws")}/ws?token=${encodeURIComponent(token)}`,
  );

  let agentRunId = "";
  let completed = false;

  ws.addEventListener("open", () => {
    ws.send(JSON.stringify({ type: "subscribe_task", taskId: task.id, projectId: PROJECT_ID }));
    wsReady.resolve();
  });

  ws.addEventListener("message", (message) => {
    try {
      const event = JSON.parse(String(message.data)) as Record<string, unknown>;
      event._receivedAt = Date.now();
      events.push(event);
    } catch {
      // ignore malformed frames
    }
  });

  ws.addEventListener("error", (error) => wsReady.reject(error));

  try {
    await wsReady.promise;

    const execution = await request<{ agentRunId: string; sessionId: string }>(
      `/api/tasks/${task.id}/execute`,
      {
        method: "POST",
        headers: authHeaders,
      },
    );

    agentRunId = execution.agentRunId;

    await waitForEvent(events, "agent.started", (event) => event.agentRunId === agentRunId, 15000);

    if (options.intervene) {
      const pauseResult = await request<{ ok: boolean }>(`/api/agents/${agentRunId}/pause`, {
        method: "POST",
        headers: authHeaders,
      });
      expect(pauseResult.ok).toBe(true);
      await waitForEvent(events, "agent.paused", (event) => event.agentRunId === agentRunId, 15000);

      const guidanceResult = await request<{ ok: boolean }>(`/api/agents/${agentRunId}/guidance`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({
          content:
            "After resume, keep the final answer to exactly 3 bullets and mention one concrete BFF/runtime integration risk.",
          mode: "noReply",
        }),
      });
      expect(guidanceResult.ok).toBe(true);
      await waitForEvent(
        events,
        "guidance.injected",
        (event) => event.agentRunId === agentRunId,
        15000,
      );

      const resumeResult = await request<{ ok: boolean }>(`/api/agents/${agentRunId}/resume`, {
        method: "POST",
        headers: authHeaders,
      });
      expect(resumeResult.ok).toBe(true);

      await waitForEvent(
        events,
        "agent.resumed",
        (event) => event.agentRunId === agentRunId,
        15000,
      );
    }

    await waitForEvent(
      events,
      "agent.completed",
      (event) => event.agentRunId === agentRunId,
      120000,
    );
    await waitForEvent(events, "task.completed", (event) => event.taskId === task.id, 120000);

    const { agentStatus, taskStatus } = await waitForCompletedStatus(token, task.id, agentRunId);

    expect(agentStatus.status).toBe("completed");
    expect(taskStatus.status).toBe("completed");
    expect(taskStatus.finishedAt).toBeTruthy();

    if (options.expectResultSync) {
      const { taskStatus: finalTaskStatus, assistantText } = await waitForAssistantResult(
        token,
        task.id,
        agentRunId,
      );
      expect(assistantText.length).toBeGreaterThan(0);
      expect(finalTaskStatus.result).toBe(assistantText);
    }

    if (!options.intervene) {
      expect(events.some((event) => event.type === "agent.paused")).toBe(false);
      expect(events.some((event) => event.type === "agent.resumed")).toBe(false);
      expect(events.some((event) => event.type === "guidance.injected")).toBe(false);
    }

    completed = true;
  } finally {
    ws.close();

    if (agentRunId && !completed) {
      try {
        await request(`/api/agents/${agentRunId}/terminate`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
        });
      } catch {
        // best effort cleanup
      }
    }

    await deleteTask(task.id);
  }
}

executionIntegrationTest("OpenCode completion sync closes pause/guidance/resume flow", async () => {
  await runCompletionSyncScenario({
    titlePrefix: "completion-sync-test",
    prompt:
      "Inspect the repository briefly and then produce a concise 3-bullet status summary with one explicit BFF/runtime integration risk.",
    intervene: true,
    expectResultSync: true,
  });
});

executionIntegrationTest(
  "OpenCode direct execution completes without pause or resume",
  async () => {
    await runCompletionSyncScenario({
      titlePrefix: "direct-completion-test",
      prompt:
        "Inspect the repository briefly and produce a concise final status summary with one explicit BFF/runtime integration risk, without waiting for any further guidance.",
      intervene: false,
      expectResultSync: false,
    });
  },
);
