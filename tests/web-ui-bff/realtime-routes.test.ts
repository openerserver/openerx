import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "../../control-plane/web-ui-bff/node_modules/hono";

const ensureAgentRunForSessionMock = mock(() => "run-test-1");
const findAgentRunBySessionIdMock = mock(() => undefined);
const getSessionMessagesMock = mock(async () => ({
  ok: true,
  data: [] as Array<Record<string, unknown>>,
}));
const runDetachedPromptMock = mock(async () => ({ ok: true, text: "", sessionId: "ses-judge" }));
const subscribeSessionMock = mock(async () => undefined);
const ingestParsedEventMock = mock(async () => undefined);
const onEventMock = mock(() => () => undefined);
const updateAgentRunStatusMock = mock(() => undefined);

mock.module("../../control-plane/web-ui-bff/src/modules/agent-control/opencode-adapter", () => ({
  ensureAgentRunForSession: ensureAgentRunForSessionMock,
  findAgentRunBySessionId: findAgentRunBySessionIdMock,
  getSessionMessages: getSessionMessagesMock,
  runDetachedPrompt: runDetachedPromptMock,
  updateAgentRunStatus: updateAgentRunStatusMock,
}));

mock.module("../../control-plane/web-ui-bff/src/modules/realtime/sse-aggregator", () => ({
  sseAggregator: {
    onEvent: onEventMock,
    subscribeSession: subscribeSessionMock,
    ingestParsedEvent: ingestParsedEventMock,
  },
}));

mock.module("../../control-plane/web-ui-bff/src/modules/realtime/ws-broadcaster", () => ({
  wsBroadcaster: {
    getClientCount: () => 0,
  },
}));

const { authMiddleware } = await import("../../control-plane/web-ui-bff/src/middleware/auth");
const { realtimeRoutes } = await import(
  "../../control-plane/web-ui-bff/src/modules/realtime/routes"
);

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || "openerx-dev-secret-change-in-production",
);

const tempDirs: string[] = [];
const originalNodeEnv = process.env.NODE_ENV;

function encodeBase64Url(value: string | Uint8Array) {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  return Buffer.from(bytes)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function createApp() {
  const app = new Hono();
  app.use("/api/*", authMiddleware);
  app.route("/api/realtime", realtimeRoutes);
  return app;
}

async function createToken(role: string) {
  const now = Math.floor(Date.now() / 1000);
  const header = encodeBase64Url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = encodeBase64Url(
    JSON.stringify({
      sub: "user-1",
      org: "org-1",
      projects: [{ id: "proj-1", role: "owner" }],
      role,
      iat: now,
      exp: now + 600,
    }),
  );
  const signingInput = `${header}.${payload}`;
  const key = await crypto.subtle.importKey(
    "raw",
    JWT_SECRET,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(signingInput)),
  );
  return `${signingInput}.${encodeBase64Url(signature)}`;
}

async function authedRequest(role: string, init?: RequestInit) {
  const token = await createToken(role);
  const app = createApp();
  return app.request("/api/realtime/dev/inject-task-graph-event", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
    body: init?.body,
  });
}

async function authedSessionStatusRequest(role: string, init?: RequestInit) {
  const token = await createToken(role);
  const app = createApp();
  return app.request("/api/realtime/dev/inject-session-status", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
    body: init?.body,
  });
}

beforeEach(() => {
  ensureAgentRunForSessionMock.mockReset();
  findAgentRunBySessionIdMock.mockReset();
  getSessionMessagesMock.mockReset();
  runDetachedPromptMock.mockReset();
  onEventMock.mockReset();
  subscribeSessionMock.mockReset();
  ingestParsedEventMock.mockReset();
  updateAgentRunStatusMock.mockReset();

  ensureAgentRunForSessionMock.mockReturnValue("run-test-1");
  findAgentRunBySessionIdMock.mockReturnValue(undefined);
  getSessionMessagesMock.mockResolvedValue({ ok: true, data: [] });
  runDetachedPromptMock.mockResolvedValue({ ok: true, text: "", sessionId: "ses-judge" });
  onEventMock.mockReturnValue(() => undefined);
  subscribeSessionMock.mockResolvedValue(undefined);
  ingestParsedEventMock.mockResolvedValue(undefined);
  updateAgentRunStatusMock.mockImplementation(() => undefined);
  process.env.NODE_ENV = "test";
});

afterEach(() => {
  process.env.NODE_ENV = originalNodeEnv;
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("realtime dev injection route", () => {
  test("rejects non-admin callers", async () => {
    const response = await authedRequest("developer", {
      body: JSON.stringify({
        taskId: "task-1",
        projectId: "proj-1",
        sessionId: "ses-1",
        graph: {
          nodes: [
            { id: "node-1", subject: "Node", status: "running", agentType: "default-executor" },
          ],
        },
      }),
    });

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "Requires org_admin role" });
    expect(ingestParsedEventMock).not.toHaveBeenCalled();
  });

  test("is disabled in production", async () => {
    process.env.NODE_ENV = "production";

    const response = await authedRequest("platform_admin", {
      body: JSON.stringify({
        taskId: "task-1",
        projectId: "proj-1",
        sessionId: "ses-1",
        graph: {
          nodes: [
            { id: "node-1", subject: "Node", status: "running", agentType: "default-executor" },
          ],
        },
      }),
    });

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Not found" });
    expect(ingestParsedEventMock).not.toHaveBeenCalled();
  });

  test("writes the graph fixture and injects a synthetic task graph event", async () => {
    const workspaceDirectory = mkdtempSync(join(tmpdir(), "openerx-realtime-route-"));
    tempDirs.push(workspaceDirectory);

    const response = await authedRequest("platform_admin", {
      body: JSON.stringify({
        taskId: "task-1",
        projectId: "proj-1",
        sessionId: "ses-main-1",
        workspaceDirectory,
        graph: {
          id: "graph-fixed-1",
          status: "running",
          nodes: [
            {
              id: "node-1",
              subject: "Synthetic graph node",
              status: "running",
              agentType: "default-executor",
            },
          ],
          edges: [{ from: "node-1", to: "node-2" }],
        },
      }),
    });

    expect(response.status).toBe(200);
    const payload = await response.json();

    const expectedGraphPath = join(
      workspaceDirectory,
      ".opencode",
      "state",
      "task-graphs",
      "graph-fixed-1.json",
    );

    expect(payload).toMatchObject({
      ok: true,
      graphId: "graph-fixed-1",
      agentRunId: "run-test-1",
      workspaceDirectory,
      graphPath: expectedGraphPath,
    });
    expect(existsSync(expectedGraphPath)).toBe(true);

    const writtenGraph = JSON.parse(readFileSync(expectedGraphPath, "utf-8")) as {
      taskId: string;
      nodes: Array<{ sessionId: string; retryCount: number; maxRetries: number }>;
      edges: Array<{ from: string; to: string; type: string }>;
    };

    expect(writtenGraph.taskId).toBe("task-1");
    expect(writtenGraph.nodes).toEqual([
      expect.objectContaining({
        sessionId: "ses-main-1",
        retryCount: 0,
        maxRetries: 0,
      }),
    ]);
    expect(writtenGraph.edges).toEqual([{ from: "node-1", to: "node-2", type: "blocks" }]);

    expect(ensureAgentRunForSessionMock).toHaveBeenCalledWith(
      "ses-main-1",
      "task-1",
      "proj-1",
      undefined,
      undefined,
    );
    expect(ingestParsedEventMock).toHaveBeenCalledWith("tool.execute.after", {
      directory: workspaceDirectory,
      payload: {
        type: "tool.execute.after",
        sessionId: "ses-main-1",
        properties: {
          toolName: "task_graph_create",
          result: JSON.stringify({ graphId: "graph-fixed-1" }),
        },
      },
    });
  });

  test("injects a synthetic session.status event for runtime burst state", async () => {
    const response = await authedSessionStatusRequest("platform_admin", {
      body: JSON.stringify({
        taskId: "task-1",
        projectId: "proj-1",
        sessionId: "ses-main-1",
        info: {
          type: "paused-approval",
          metadata: {
            source: "runtime_burst_guard",
            permission: "model_burst_resume",
            decision: "paused-approval",
          },
          requests: 4,
          tokens: 128,
          cost: 0.32,
        },
      }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      ok: true,
      agentRunId: "run-test-1",
      sessionId: "ses-main-1",
      taskId: "task-1",
      projectId: "proj-1",
      emittedType: "paused-approval",
    });
    expect(ensureAgentRunForSessionMock).toHaveBeenCalledWith(
      "ses-main-1",
      "task-1",
      "proj-1",
      undefined,
      undefined,
    );
    expect(ingestParsedEventMock).toHaveBeenCalledWith("session.status", {
      directory: ".",
      sessionId: "ses-main-1",
      payload: {
        type: "session.status",
        sessionId: "ses-main-1",
        properties: {
          info: {
            type: "paused-approval",
            metadata: {
              source: "runtime_burst_guard",
              permission: "model_burst_resume",
              decision: "paused-approval",
            },
            requests: 4,
            tokens: 128,
            cost: 0.32,
          },
        },
      },
    });
  });
});
