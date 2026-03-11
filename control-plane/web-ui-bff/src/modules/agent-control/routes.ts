import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import { cpFetch, createInternalAuthorization } from "../../lib/control-plane-client";
import { mergeTaskStrategy, readOrchestrationStrategy } from "../../lib/orchestration-strategy";
import { executeLifecycleHooks } from "../hooks/lifecycle-hooks";
import { wsBroadcaster } from "../realtime/ws-broadcaster";
import {
  getAgentMessages,
  getAgentRun,
  injectGuidance,
  listAgentRuns,
  pauseAgent,
  resumeAgent,
  terminateAgent,
} from "./opencode-adapter";

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

  // Run pre-resume hooks before the actual resume
  const run = getAgentRun(agentRunId);
  if (run?.taskId) {
    const preResume = await runPreResumeHooks(run.taskId, run.projectId, agentRunId);
    if (!preResume.ok) {
      return c.json({ ok: false, error: preResume.error }, 400);
    }
  }

  const result = await resumeAgent(agentRunId);

  if (result.ok) {
    const currentRun = getAgentRun(agentRunId);
    wsBroadcaster.broadcast({
      id: crypto.randomUUID(),
      type: "agent.resumed",
      ts: new Date().toISOString(),
      agentRunId,
      taskId: currentRun?.taskId,
      projectId: currentRun?.projectId,
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

agentControlRoutes.post("/:agentRunId/guidance", zValidator("json", guidanceSchema), async (c) => {
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
});

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

// ── Pre-resume Hook Runner ─────────────────────────────────────────

async function runPreResumeHooks(
  taskId: string,
  _projectId: string,
  agentRunId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const strategyConfig = readOrchestrationStrategy();

  const authorization = await createInternalAuthorization();
  const taskResult = await cpFetch<{
    id: string;
    title: string;
    prompt: string;
    projectId: string;
    strategy?: string | null;
  }>(`/api/tasks/${encodeURIComponent(taskId)}`, { authorization });
  if (!taskResult.ok) {
    return { ok: false, error: `Failed to load task ${taskId} before resume` };
  }

  const task = taskResult.data;
  const hookResult = await executeLifecycleHooks({
    strategy: strategyConfig,
    trigger: "pre-resume",
    taskId: task.id,
    projectId: task.projectId,
    taskTitle: task.title,
    taskPrompt: task.prompt,
    titlePrefix: "pre-resume",
    context: {
      taskId: task.id,
      projectId: task.projectId,
      taskTitle: task.title,
      taskPrompt: task.prompt,
      agentRunId,
    },
  });

  if (hookResult.rewrittenPrompt) {
    const guidanceResult = await injectGuidance(
      agentRunId,
      [
        "Pre-resume hook updated the execution instructions.",
        "Apply the following revised guidance when continuing the task:",
        hookResult.rewrittenPrompt,
      ].join("\n\n"),
      "noReply",
    );
    if (!guidanceResult.ok) {
      return {
        ok: false,
        error: guidanceResult.error || "Failed to inject pre-resume guidance",
      };
    }
  }

  if (hookResult.hookExecutions.length > 0) {
    await cpFetch(`/api/tasks/${encodeURIComponent(taskId)}`, {
      method: "PATCH",
      authorization,
      body: {
        strategy: mergeTaskStrategy(task.strategy, {
          hookExecutions: hookResult.hookExecutions,
        }),
      },
    });
  }

  return { ok: true };
}
