import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import type { JWTPayload } from "../../middleware/auth";
import { ensureAgentRunForSession } from "../agent-control/opencode-adapter";
import { sseAggregator } from "./sse-aggregator";
import { wsBroadcaster } from "./ws-broadcaster";

type AppEnv = { Variables: { user: JWTPayload } };

export const realtimeRoutes = new Hono<AppEnv>();

function requireSystemAdmin(user: JWTPayload): string | null {
  if (user.role === "platform_admin" || user.role === "org_admin" || user.role === "admin") {
    return null;
  }
  return "Requires org_admin role";
}

function ensureDevOnlyRoute() {
  return process.env.NODE_ENV !== "production";
}

// GET /api/realtime/status
realtimeRoutes.get("/status", (c) => {
  return c.json({
    wsClients: wsBroadcaster.getClientCount(),
    status: "ok",
  });
});

// POST /api/realtime/subscribe-session
realtimeRoutes.post("/subscribe-session", async (c) => {
  const body = await c.req.json<{ sessionId: string }>();
  if (!body.sessionId) return c.json({ error: "sessionId required" }, 400);

  await sseAggregator.subscribeSession(body.sessionId);
  return c.json({ subscribed: body.sessionId });
});

const injectTaskGraphEventSchema = z.object({
  taskId: z.string().min(1),
  projectId: z.string().min(1),
  sessionId: z.string().min(1),
  agentRunId: z.string().min(1).optional(),
  workspaceDirectory: z.string().min(1).optional(),
  graph: z.object({
    id: z.string().min(1).optional(),
    taskId: z.string().min(1).optional(),
    title: z.string().min(1).optional(),
    status: z.string().min(1).optional(),
    nodes: z.array(
      z.object({
        id: z.string().min(1),
        subject: z.string().min(1),
        status: z.string().min(1),
        agentType: z.string().min(1),
        sessionId: z.string().nullable().optional(),
        retryCount: z.number().int().nonnegative().optional(),
        maxRetries: z.number().int().nonnegative().optional(),
        output: z.string().nullable().optional(),
        error: z.string().nullable().optional(),
        tokenUsed: z.number().int().nonnegative().optional(),
        startedAt: z.number().int().nullable().optional(),
        finishedAt: z.number().int().nullable().optional(),
      }),
    ),
    edges: z
      .array(
        z.object({
          from: z.string().min(1),
          to: z.string().min(1),
          type: z.enum(["blocks", "informs"]).optional(),
        }),
      )
      .optional(),
  }),
});

realtimeRoutes.post(
  "/dev/inject-task-graph-event",
  zValidator("json", injectTaskGraphEventSchema),
  async (c) => {
    if (!ensureDevOnlyRoute()) {
      return c.json({ error: "Not found" }, 404);
    }

    const adminErr = requireSystemAdmin(c.get("user"));
    if (adminErr) {
      return c.json({ error: adminErr }, 403);
    }

    const body = c.req.valid("json");
    const graphId = body.graph.id || `graph-${crypto.randomUUID()}`;
    const now = Date.now();
    const workspaceDirectory =
      body.workspaceDirectory || join(tmpdir(), `openerx-realtime-fixture-${graphId}`);
    const graphDir = join(workspaceDirectory, ".opencode", "state", "task-graphs");
    mkdirSync(graphDir, { recursive: true });

    writeFileSync(
      join(graphDir, `${graphId}.json`),
      JSON.stringify(
        {
          id: graphId,
          taskId: body.graph.taskId || body.taskId,
          title: body.graph.title || `Realtime graph fixture ${graphId}`,
          status: body.graph.status || "running",
          createdAt: now,
          updatedAt: now,
          nodes: body.graph.nodes.map((node) => ({
            id: node.id,
            subject: node.subject,
            status: node.status,
            agentType: node.agentType,
            sessionId: node.sessionId ?? body.sessionId,
            retryCount: node.retryCount ?? 0,
            maxRetries: node.maxRetries ?? 0,
            output: node.output ?? null,
            error: node.error ?? null,
            tokenUsed: node.tokenUsed ?? 0,
            startedAt: node.startedAt ?? now,
            finishedAt: node.finishedAt ?? null,
          })),
          edges: (body.graph.edges || []).map((edge) => ({
            from: edge.from,
            to: edge.to,
            type: edge.type || "blocks",
          })),
        },
        null,
        2,
      ),
      "utf-8",
    );

    const agentRunId = ensureAgentRunForSession(
      body.sessionId,
      body.taskId,
      body.projectId,
      undefined,
      body.agentRunId,
    );

    await sseAggregator.ingestParsedEvent("tool.execute.after", {
      directory: workspaceDirectory,
      payload: {
        type: "tool.execute.after",
        sessionId: body.sessionId,
        properties: {
          toolName: "task_graph_create",
          result: JSON.stringify({ graphId }),
        },
      },
    });

    return c.json({
      ok: true,
      graphId,
      agentRunId,
      workspaceDirectory,
      graphPath: join(graphDir, `${graphId}.json`),
    });
  },
);

const injectSessionStatusSchema = z.object({
  taskId: z.string().min(1),
  projectId: z.string().min(1),
  sessionId: z.string().min(1),
  agentRunId: z.string().min(1).optional(),
  info: z.object({
    type: z.enum(["warning", "paused-approval", "cooldown"]),
    metadata: z.record(z.unknown()).optional(),
    until: z.string().min(1).optional(),
    reset: z.string().min(1).optional(),
    requests: z.number().nonnegative().optional(),
    tokens: z.number().nonnegative().optional(),
    cost: z.number().nonnegative().optional(),
  }),
});

realtimeRoutes.post(
  "/dev/inject-session-status",
  zValidator("json", injectSessionStatusSchema),
  async (c) => {
    if (!ensureDevOnlyRoute()) {
      return c.json({ error: "Not found" }, 404);
    }

    const adminErr = requireSystemAdmin(c.get("user"));
    if (adminErr) {
      return c.json({ error: adminErr }, 403);
    }

    const body = c.req.valid("json");
    const agentRunId = ensureAgentRunForSession(
      body.sessionId,
      body.taskId,
      body.projectId,
      undefined,
      body.agentRunId,
    );

    await sseAggregator.ingestParsedEvent("session.status", {
      directory: ".",
      sessionId: body.sessionId,
      payload: {
        type: "session.status",
        sessionId: body.sessionId,
        properties: {
          info: body.info,
        },
      },
    });

    return c.json({
      ok: true,
      agentRunId,
      sessionId: body.sessionId,
      taskId: body.taskId,
      projectId: body.projectId,
      emittedType: body.info.type,
    });
  },
);
