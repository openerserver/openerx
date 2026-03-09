import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import {
  pauseAgent,
  resumeAgent,
  injectGuidance,
  terminateAgent,
  getAgentMessages,
  getAgentRun,
  listAgentRuns,
} from "./opencode-adapter";
import { wsBroadcaster } from "../realtime/ws-broadcaster";

export const agentControlRoutes = new Hono();

// GET /api/agents — list all registered agent runs
agentControlRoutes.get("/", (c) => {
  const runs = listAgentRuns();
  return c.json(runs);
});

// POST /api/agents/:agentRunId/pause
agentControlRoutes.post("/:agentRunId/pause", async (c) => {
  const agentRunId = c.req.param("agentRunId");
  const result = await pauseAgent(agentRunId);

  if (result.ok) {
    const run = getAgentRun(agentRunId);
    wsBroadcaster.broadcast({
      id: crypto.randomUUID(),
      type: "agent.paused",
      ts: new Date().toISOString(),
      agentRunId,
      taskId: run?.taskId,
      projectId: run?.projectId,
      data: { agentRunId },
    });
  }

  return c.json(result, result.ok ? 200 : 400);
});

// POST /api/agents/:agentRunId/resume
agentControlRoutes.post("/:agentRunId/resume", async (c) => {
  const agentRunId = c.req.param("agentRunId");
  const result = await resumeAgent(agentRunId);

  if (result.ok) {
    const run = getAgentRun(agentRunId);
    wsBroadcaster.broadcast({
      id: crypto.randomUUID(),
      type: "agent.resumed",
      ts: new Date().toISOString(),
      agentRunId,
      taskId: run?.taskId,
      projectId: run?.projectId,
      data: { agentRunId },
    });
  }

  return c.json(result, result.ok ? 200 : 400);
});

// POST /api/agents/:agentRunId/guidance
const guidanceSchema = z.object({
  content: z.string().min(1).max(5000),
  mode: z.enum(["reply", "noReply"]).default("reply"),
});

agentControlRoutes.post(
  "/:agentRunId/guidance",
  zValidator("json", guidanceSchema),
  async (c) => {
    const agentRunId = c.req.param("agentRunId");
    const { content, mode } = c.req.valid("json");
    const result = await injectGuidance(agentRunId, content, mode);

    if (result.ok) {
      const run = getAgentRun(agentRunId);
      wsBroadcaster.broadcast({
        id: crypto.randomUUID(),
        type: "guidance.injected",
        ts: new Date().toISOString(),
        agentRunId,
        taskId: run?.taskId,
        projectId: run?.projectId,
        data: { agentRunId, content, mode },
      });
    }

    return c.json(result, result.ok ? 200 : 400);
  },
);

// POST /api/agents/:agentRunId/terminate
agentControlRoutes.post("/:agentRunId/terminate", async (c) => {
  const agentRunId = c.req.param("agentRunId");
  const result = await terminateAgent(agentRunId);

  if (result.ok) {
    const run = getAgentRun(agentRunId);
    wsBroadcaster.broadcast({
      id: crypto.randomUUID(),
      type: "agent.failed",
      ts: new Date().toISOString(),
      agentRunId,
      taskId: run?.taskId,
      projectId: run?.projectId,
      data: { agentRunId, reason: "terminated" },
    });
  }

  return c.json(result, result.ok ? 200 : 400);
});

// GET /api/agents/:agentRunId/messages
agentControlRoutes.get("/:agentRunId/messages", async (c) => {
  const agentRunId = c.req.param("agentRunId");
  const result = await getAgentMessages(agentRunId);
  return c.json(result, result.ok ? 200 : 400);
});

// GET /api/agents/:agentRunId/status
agentControlRoutes.get("/:agentRunId/status", async (c) => {
  const agentRunId = c.req.param("agentRunId");
  const run = getAgentRun(agentRunId);
  if (!run) return c.json({ error: "Agent run not found" }, 404);
  return c.json(run);
});
