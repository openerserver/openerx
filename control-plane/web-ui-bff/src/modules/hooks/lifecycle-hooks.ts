import { resolveModelRoute } from "../../lib/opencode-config";
import {
  type HookExecutionRecord,
  type HookTrigger,
  type LifecycleHook,
  type OrchestrationStrategy,
  parseHookDecision,
  renderPromptTemplate,
} from "../../lib/orchestration-strategy";
import { runDetachedPrompt } from "../agent-control/opencode-adapter";

const VALID_TRIGGERS = new Set<HookTrigger>([
  "pre-execution",
  "post-execution",
  "on-failure",
  "pre-resume",
]);

type RepoContext = {
  repoName?: string;
  remoteUrl?: string;
  workingBranch?: string;
  gitAuthorName?: string;
  gitAuthorEmail?: string;
  gitCommitterName?: string;
  gitCommitterEmail?: string;
};

export interface ExecuteLifecycleHooksOptions {
  strategy: OrchestrationStrategy;
  trigger: HookTrigger;
  taskId: string;
  projectId: string;
  taskTitle: string;
  taskPrompt: string;
  context: Record<string, string | undefined | null>;
  titlePrefix: string;
  repoContext?: RepoContext;
  onHookExecuted?: (
    execution: HookExecutionRecord,
  ) =>
    | Promise<{ stop?: boolean; reason?: string } | undefined>
    | { stop?: boolean; reason?: string }
    | undefined;
}

export interface ExecuteLifecycleHooksResult {
  hookExecutions: HookExecutionRecord[];
  combinedResultText?: string;
  rewrittenPrompt?: string;
}

export function getLifecycleHooksForTrigger(strategy: OrchestrationStrategy, trigger: HookTrigger) {
  return strategy.hooks
    .filter((hook) => hook.trigger === trigger && hook.enabled && hook.agent)
    .sort((a, b) => a.order - b.order);
}

function buildHookPrompt(
  options: ExecuteLifecycleHooksOptions,
  hook: OrchestrationStrategy["hooks"][number],
) {
  return renderPromptTemplate(hook.promptTemplate, {
    taskId: options.taskId,
    projectId: options.projectId,
    taskTitle: options.taskTitle,
    taskPrompt: options.taskPrompt,
    ...options.context,
  });
}

function buildHookExecution(
  options: ExecuteLifecycleHooksOptions,
  hook: OrchestrationStrategy["hooks"][number],
  prompt: string,
  result: Awaited<ReturnType<typeof runDetachedPrompt>>,
): { execution: HookExecutionRecord; rewrittenPrompt?: string } {
  const decision = result.ok && result.text ? parseHookDecision(result.text) : undefined;
  return {
    execution: {
      hookId: hook.id,
      trigger: options.trigger,
      status: result.ok && result.completed ? "completed" : "failed",
      agent: hook.agent,
      model: result.model ? `${result.model.providerId}:${result.model.modelId}` : hook.model,
      prompt,
      result: result.text,
      error: result.ok ? (result.completed ? undefined : "Hook timed out") : result.error,
      sessionId: result.sessionId,
      tokenUsed: result.tokenUsed,
      decision,
      completedAt: new Date().toISOString(),
    },
    rewrittenPrompt: decision?.action === "rewrite-prompt" ? decision.rewrittenPrompt : undefined,
  };
}

function buildSkippedHookExecution(
  options: ExecuteLifecycleHooksOptions,
  hook: OrchestrationStrategy["hooks"][number],
  reason: string,
): HookExecutionRecord {
  return {
    hookId: hook.id,
    trigger: options.trigger,
    status: "skipped",
    agent: hook.agent,
    model: hook.model,
    prompt: buildHookPrompt(options, hook),
    error: reason,
    tokenUsed: 0,
    completedAt: new Date().toISOString(),
  };
}

async function executeSingleLifecycleHook(
  options: ExecuteLifecycleHooksOptions,
  hook: OrchestrationStrategy["hooks"][number],
) {
  const prompt = buildHookPrompt(options, hook);
  const hookModel = hook.model ? resolveModelRoute(hook.model) : undefined;
  const result = await runDetachedPrompt(
    `[${options.titlePrefix} ${hook.id}] ${options.taskTitle}`,
    prompt,
    {
      agent: hook.agent,
      model: hookModel,
      taskId: options.taskId,
      projectId: options.projectId,
      repoContext: options.repoContext,
      timeoutMs: hook.timeoutMs,
    },
  );

  return buildHookExecution(options, hook, prompt, result);
}

function combineHookResultText(hookExecutions: HookExecutionRecord[]) {
  const combinedResultText = hookExecutions
    .map((hook) => hook.result?.trim())
    .filter((text): text is string => Boolean(text))
    .join("\n\n");

  return combinedResultText || undefined;
}

export async function executeLifecycleHooks(
  options: ExecuteLifecycleHooksOptions,
): Promise<ExecuteLifecycleHooksResult> {
  const hooks = getLifecycleHooksForTrigger(options.strategy, options.trigger);
  if (hooks.length === 0) {
    return { hookExecutions: [] };
  }

  const hookExecutions: HookExecutionRecord[] = [];
  let rewrittenPrompt: string | undefined;

  for (const hook of hooks) {
    const executionResult = await executeSingleLifecycleHook(options, hook);
    rewrittenPrompt = executionResult.rewrittenPrompt ?? rewrittenPrompt;
    hookExecutions.push(executionResult.execution);

    const continuation = await options.onHookExecuted?.(executionResult.execution);
    if (continuation?.stop) {
      const remainingHooks = hooks.slice(hookExecutions.length);
      for (const remainingHook of remainingHooks) {
        hookExecutions.push(
          buildSkippedHookExecution(
            options,
            remainingHook,
            continuation.reason ||
              "Stopped after the previous hook exceeded the paid execution limit.",
          ),
        );
      }
      break;
    }
  }

  return {
    hookExecutions,
    combinedResultText: combineHookResultText(hookExecutions),
    rewrittenPrompt,
  };
}

// ── Stage-level Hook Parsing & Merging ─────────────────────────────

/**
 * Parse raw stage hooksJson (persisted as `Array<Record<string, unknown>>`)
 * into validated `LifecycleHook[]`.
 */
export function parseStageHooks(raw: Array<Record<string, unknown>> | null | undefined): LifecycleHook[] {
  if (!Array.isArray(raw)) return [];
  return raw.reduce<LifecycleHook[]>((hooks, item, index) => {
      const trigger = typeof item.trigger === "string" ? item.trigger : "";
      if (!VALID_TRIGGERS.has(trigger as HookTrigger)) return hooks;
      const id = typeof item.id === "string" && item.id ? item.id : `stage-hook-${index}`;
      const agent = typeof item.agent === "string" && item.agent ? item.agent : "";
      if (!agent) return hooks;
      hooks.push({
        id,
        trigger: trigger as HookTrigger,
        enabled: item.enabled !== false,
        agent,
        model: typeof item.model === "string" && item.model ? item.model : undefined,
        promptTemplate: typeof item.promptTemplate === "string" ? item.promptTemplate : "",
        timeoutMs: typeof item.timeoutMs === "number" && item.timeoutMs > 0 ? item.timeoutMs : 60_000,
        order: typeof item.order === "number" ? item.order : 0,
      } satisfies LifecycleHook);
      return hooks;
    }, []);
}

/**
 * Merge stage-level hooks (higher priority) with strategy-level hooks.
 * Stage hooks come first when order values are equal.
 * Deduplicates by hook id — stage-level wins on conflict.
 */
export function mergeStageAndStrategyHooks(
  stageHooks: LifecycleHook[],
  strategyHooks: LifecycleHook[],
): LifecycleHook[] {
  const seenIds = new Set<string>();
  const merged: LifecycleHook[] = [];

  // Stage hooks take priority
  for (const hook of stageHooks) {
    if (!seenIds.has(hook.id)) {
      seenIds.add(hook.id);
      merged.push(hook);
    }
  }
  for (const hook of strategyHooks) {
    if (!seenIds.has(hook.id)) {
      seenIds.add(hook.id);
      merged.push(hook);
    }
  }

  return merged.sort((a, b) => a.order - b.order);
}
