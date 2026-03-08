import { type Plugin, tool } from "@opencode-ai/plugin";

// ── Types ──────────────────────────────────────────────────────────

type TaskCategory = "quick" | "deep" | "ops" | "security" | "architecture";
type Complexity = "low" | "medium" | "high";

interface IntentClassification {
  category: TaskCategory;
  complexity: Complexity;
  suggestedAgents: string[];
  requiresPlan: boolean;
  confidence: number;
}

interface ModelRoute {
  providerId: string;
  modelId: string;
}

interface SubSessionEntry {
  taskId: string;
  agentType: string;
  sessionId: string;
  status: "pending" | "running" | "paused" | "completed" | "failed" | "terminated";
  startedAt: number;
  tokenUsed: number;
}

interface RalphLoopState {
  taskId: string;
  currentRound: number;
  maxRounds: number;
  stalledRounds: number;
  active: boolean;
}

// ── Intent Classification ──────────────────────────────────────────

const CATEGORY_PATTERNS: Record<TaskCategory, RegExp[]> = {
  quick: [
    /\b(what|where|how|explain|show|find|search|look up|describe)\b/i,
    /\b(what does .+ do)\b/i,
    /\b(quick|simple|brief)\b/i,
  ],
  deep: [
    /\b(implement|create|build|develop|add|write|refactor|redesign|migrate)\b/i,
    /\b(feature|module|component|service|endpoint|api)\b/i,
    /\b(fix bug|resolve issue|patch)\b/i,
  ],
  ops: [
    /\b(deploy|release|rollback|restart|monitor|alert|incident|outage)\b/i,
    /\b(log|metric|trace|health|status|diagnos)\b/i,
    /\b(runbook|playbook|sop)\b/i,
  ],
  security: [
    /\b(security|vulnerability|cve|exploit|injection|xss|csrf|auth)\b/i,
    /\b(audit|compliance|penetration|scan|sast|dast)\b/i,
    /\b(secret|credential|permission|access control)\b/i,
  ],
  architecture: [
    /\b(architect|design|pattern|trade-?off|scalab|performance)\b/i,
    /\b(review|evaluate|assess|analyze|technical debt)\b/i,
    /\b(system design|high level|overview)\b/i,
  ],
};

function classifyIntent(message: string): IntentClassification {
  const scores: Record<TaskCategory, number> = {
    quick: 0,
    deep: 0,
    ops: 0,
    security: 0,
    architecture: 0,
  };

  for (const [category, patterns] of Object.entries(CATEGORY_PATTERNS)) {
    for (const pattern of patterns) {
      if (pattern.test(message)) {
        scores[category as TaskCategory] += 1;
      }
    }
  }

  const entries = Object.entries(scores) as [TaskCategory, number][];
  entries.sort((a, b) => b[1] - a[1]);

  const topCategory = entries[0]![0];
  const topScore = entries[0]![1];
  const totalScore = entries.reduce((sum, [, s]) => sum + s, 0);

  const complexity = estimateComplexity(message);
  const confidence = totalScore > 0 ? topScore / totalScore : 0.5;

  return {
    category: topScore > 0 ? topCategory : "quick",
    complexity,
    suggestedAgents: getAgentsForCategory(topCategory, complexity),
    requiresPlan: topCategory === "deep" || topCategory === "architecture",
    confidence,
  };
}

function estimateComplexity(message: string): Complexity {
  const wordCount = message.split(/\s+/).length;
  const hasMultipleFiles = /\b(files|modules|components|services)\b/i.test(message);
  const hasComplexKeywords = /\b(complex|large|entire|all|complete|full)\b/i.test(message);

  if (wordCount > 100 || hasMultipleFiles || hasComplexKeywords) return "high";
  if (wordCount > 30) return "medium";
  return "low";
}

function getAgentsForCategory(category: TaskCategory, complexity: Complexity): string[] {
  switch (category) {
    case "quick":
      return ["explore-enterprise"];
    case "deep":
      return complexity === "high"
        ? ["sisyphus-enterprise", "prometheus-enterprise", "hephaestus-enterprise"]
        : ["hephaestus-enterprise"];
    case "ops":
      return ["oracle-enterprise"];
    case "security":
      return ["oracle-enterprise", "hephaestus-enterprise"];
    case "architecture":
      return ["prometheus-enterprise", "oracle-enterprise"];
  }
}

// ── Model Routing ──────────────────────────────────────────────────

const MODEL_ROUTES: Record<string, ModelRoute[]> = {
  primary: [
    { providerId: "anthropic", modelId: "anthropic/claude-sonnet-4-20250514" },
    { providerId: "openai", modelId: "openai/gpt-4.1-mini" },
  ],
  fast: [
    { providerId: "openai", modelId: "openai/gpt-4.1-mini" },
    { providerId: "anthropic", modelId: "anthropic/claude-sonnet-4-20250514" },
  ],
};

function selectModel(category: TaskCategory, complexity: Complexity): ModelRoute {
  if (category === "quick" && complexity === "low") {
    return MODEL_ROUTES.fast![0]!;
  }
  return MODEL_ROUTES.primary![0]!;
}

// ── Sub-Session Registry ───────────────────────────────────────────

const sessionRegistry = new Map<string, SubSessionEntry[]>();

function registerSubSession(taskId: string, entry: Omit<SubSessionEntry, "taskId">): void {
  const entries = sessionRegistry.get(taskId) ?? [];
  entries.push({ ...entry, taskId });
  sessionRegistry.set(taskId, entries);
}

function getSubSessions(taskId: string): SubSessionEntry[] {
  return sessionRegistry.get(taskId) ?? [];
}

function findSubSession(
  taskId: string,
  agentType: string,
): SubSessionEntry | undefined {
  return getSubSessions(taskId).find((s) => s.agentType === agentType);
}

// ── Ralph Loop ─────────────────────────────────────────────────────

const ralphLoops = new Map<string, RalphLoopState>();

function startRalphLoop(taskId: string, maxRounds = 20): RalphLoopState {
  const state: RalphLoopState = {
    taskId,
    currentRound: 0,
    maxRounds,
    stalledRounds: 0,
    active: true,
  };
  ralphLoops.set(taskId, state);
  return state;
}

function advanceRalphLoop(taskId: string, madeProgress: boolean): RalphLoopState | null {
  const state = ralphLoops.get(taskId);
  if (!state || !state.active) return null;

  state.currentRound++;
  if (madeProgress) {
    state.stalledRounds = 0;
  } else {
    state.stalledRounds++;
  }

  if (state.currentRound >= state.maxRounds || state.stalledRounds >= 3) {
    state.active = false;
  }

  return state;
}

// ── Context Pruning ────────────────────────────────────────────────

interface PruningStats {
  duplicateReadsRemoved: number;
  staleEditsRemoved: number;
  errorOutputsCompressed: number;
  totalTokensSaved: number;
}

function computePruningStrategy(
  messages: Array<{ role: string; content: string; toolName?: string }>,
): { indicesToRemove: number[]; stats: PruningStats } {
  const stats: PruningStats = {
    duplicateReadsRemoved: 0,
    staleEditsRemoved: 0,
    errorOutputsCompressed: 0,
    totalTokensSaved: 0,
  };
  const indicesToRemove: number[] = [];
  const lastReadIndex = new Map<string, number>();

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]!;

    // Deduplicate file reads: keep only the latest read of each file
    if (msg.toolName === "read_file") {
      const pathMatch = msg.content.match(/path[:\s]+["']?([^\s"']+)/);
      if (pathMatch?.[1]) {
        const prev = lastReadIndex.get(pathMatch[1]);
        if (prev !== undefined) {
          indicesToRemove.push(prev);
          stats.duplicateReadsRemoved++;
          stats.totalTokensSaved += Math.ceil(msg.content.length / 4);
        }
        lastReadIndex.set(pathMatch[1], i);
      }
    }

    // Compress error outputs (keep first 500 chars)
    if (msg.role === "tool" && msg.content.includes("Error")) {
      if (msg.content.length > 500) {
        stats.errorOutputsCompressed++;
        stats.totalTokensSaved += Math.ceil((msg.content.length - 500) / 4);
      }
    }
  }

  return { indicesToRemove, stats };
}

// ── Plugin Export ──────────────────────────────────────────────────

export const OrchestratorPlugin: Plugin = async ({ client, project, directory }) => {
  return {
    // ── Intent classification tool ──
    tool: {
      classify_intent: tool({
        description:
          "Classify user intent into a task category (quick/deep/ops/security/architecture) with complexity and suggested agents",
        args: {
          message: tool.schema.string("The user message to classify"),
        },
        async execute({ message }) {
          const result = classifyIntent(message);
          return JSON.stringify(result, null, 2);
        },
      }),

      select_model: tool({
        description: "Select the optimal model for a given task category and complexity",
        args: {
          category: tool.schema.string("Task category: quick|deep|ops|security|architecture"),
          complexity: tool.schema.string("Task complexity: low|medium|high"),
        },
        async execute({ category, complexity }) {
          const route = selectModel(
            category as TaskCategory,
            complexity as Complexity,
          );
          return JSON.stringify(route);
        },
      }),

      create_sub_session: tool({
        description: "Create a child session for a specialist agent under a task",
        args: {
          taskId: tool.schema.string("Parent task ID"),
          agentType: tool.schema.string("Agent type to activate"),
          title: tool.schema.string("Session title"),
        },
        async execute({ taskId, agentType, title }) {
          const session = await client.session.create({
            body: { title: `[${taskId}] ${agentType}: ${title}` },
          });
          const sessionId = session.data?.id;
          if (!sessionId) {
            return JSON.stringify({ error: "Failed to create sub-session" });
          }
          registerSubSession(taskId, {
            agentType,
            sessionId,
            status: "pending",
            startedAt: Date.now(),
            tokenUsed: 0,
          });
          return JSON.stringify({ sessionId, taskId, agentType });
        },
      }),

      dispatch_to_agent: tool({
        description: "Send a prompt to a specialist agent's sub-session",
        args: {
          taskId: tool.schema.string("Task ID"),
          agentType: tool.schema.string("Target agent type"),
          prompt: tool.schema.string("The prompt/instruction to send"),
        },
        async execute({ taskId, agentType, prompt }) {
          const sub = findSubSession(taskId, agentType);
          if (!sub) {
            return JSON.stringify({ error: `No sub-session found for ${agentType} in task ${taskId}` });
          }
          sub.status = "running";
          const result = await client.session.prompt({
            path: { id: sub.sessionId },
            body: {
              parts: [{ type: "text", text: prompt }],
              agent: agentType,
            },
          });
          return JSON.stringify({
            sessionId: sub.sessionId,
            agentType,
            dispatched: true,
            messageId: result.data?.info?.id,
          });
        },
      }),

      abort_sub_session: tool({
        description: "Abort a running sub-session for a specific agent",
        args: {
          taskId: tool.schema.string("Task ID"),
          agentType: tool.schema.string("Agent type to abort"),
        },
        async execute({ taskId, agentType }) {
          const sub = findSubSession(taskId, agentType);
          if (!sub) {
            return JSON.stringify({ error: `No sub-session found for ${agentType}` });
          }
          await client.session.abort({ path: { id: sub.sessionId } });
          sub.status = "paused";
          return JSON.stringify({ sessionId: sub.sessionId, status: "paused" });
        },
      }),

      inject_guidance: tool({
        description: "Inject guidance into a paused agent's sub-session",
        args: {
          taskId: tool.schema.string("Task ID"),
          agentType: tool.schema.string("Target agent type"),
          guidance: tool.schema.string("Guidance content to inject"),
          noReply: tool.schema.boolean("If true, inject without triggering response"),
        },
        async execute({ taskId, agentType, guidance, noReply }) {
          const sub = findSubSession(taskId, agentType);
          if (!sub) {
            return JSON.stringify({ error: `No sub-session found for ${agentType}` });
          }
          await client.session.prompt({
            path: { id: sub.sessionId },
            body: {
              parts: [{ type: "text", text: guidance }],
              noReply: noReply ?? true,
            },
          });
          return JSON.stringify({ injected: true, noReply });
        },
      }),

      resume_agent: tool({
        description: "Resume a paused agent with optional guidance",
        args: {
          taskId: tool.schema.string("Task ID"),
          agentType: tool.schema.string("Agent type to resume"),
        },
        async execute({ taskId, agentType }) {
          const sub = findSubSession(taskId, agentType);
          if (!sub || sub.status !== "paused") {
            return JSON.stringify({ error: `Agent ${agentType} is not paused` });
          }
          const result = await client.session.prompt({
            path: { id: sub.sessionId },
            body: {
              parts: [{
                type: "text",
                text: "Resume execution. Apply any guidance provided above and continue your current task.",
              }],
            },
          });
          sub.status = "running";
          return JSON.stringify({ resumed: true, messageId: result.data?.info?.id });
        },
      }),

      list_sub_sessions: tool({
        description: "List all sub-sessions for a task",
        args: {
          taskId: tool.schema.string("Task ID"),
        },
        async execute({ taskId }) {
          return JSON.stringify(getSubSessions(taskId), null, 2);
        },
      }),

      // ── Ralph Loop tools ──

      ralph_loop_start: tool({
        description: "Start a Ralph continuous execution loop for a task",
        args: {
          taskId: tool.schema.string("Task ID"),
          maxRounds: tool.schema.number("Maximum iteration rounds (default: 20)"),
        },
        async execute({ taskId, maxRounds }) {
          const state = startRalphLoop(taskId, maxRounds || 20);
          return JSON.stringify(state);
        },
      }),

      ralph_loop_advance: tool({
        description: "Advance the Ralph loop by one round, reporting whether progress was made",
        args: {
          taskId: tool.schema.string("Task ID"),
          madeProgress: tool.schema.boolean("Whether the current round made progress"),
        },
        async execute({ taskId, madeProgress }) {
          const state = advanceRalphLoop(taskId, madeProgress);
          if (!state) {
            return JSON.stringify({ error: "No active Ralph loop for this task" });
          }
          return JSON.stringify({
            ...state,
            shouldContinue: state.active,
            reason: !state.active
              ? state.stalledRounds >= 3
                ? "Stalled for 3 consecutive rounds — needs human intervention"
                : "Maximum rounds reached"
              : "Continue execution",
          });
        },
      }),
    },

    // ── Lifecycle hooks ──

    "session.idle": async (input) => {
      // Todo Enforcer: when a session goes idle, check for pending todos
      const sessionId = input.properties?.sessionID;
      if (!sessionId) return;

      try {
        const todos = await client.session.get({ path: { id: sessionId } });
        const sessionData = todos.data;
        if (sessionData && sessionData.title?.includes("[")) {
          // This is a sub-session managed by us — check if task has pending nodes
          console.log(`[orchestrator] Session ${sessionId} idle — checking for pending work`);
        }
      } catch {
        // Session may have been cleaned up
      }
    },

    "session.error": async (input) => {
      const sessionId = input.properties?.sessionID;
      if (!sessionId) return;
      console.error(
        `[orchestrator] Session ${sessionId} error:`,
        input.properties?.data,
      );
    },
  };
};

export default OrchestratorPlugin;
