import { resolveModelRoute } from "../../lib/opencode-config";
import {
  type HookExecutionRecord,
  type HookTrigger,
  type OrchestrationStrategy,
  parseHookDecision,
  renderPromptTemplate,
} from "../../lib/orchestration-strategy";
import { runDetachedPrompt } from "../agent-control/opencode-adapter";

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
      model: hook.model,
      prompt,
      result: result.text,
      error: result.ok ? (result.completed ? undefined : "Hook timed out") : result.error,
      sessionId: result.sessionId,
      decision,
      completedAt: new Date().toISOString(),
    },
    rewrittenPrompt: decision?.action === "rewrite-prompt" ? decision.rewrittenPrompt : undefined,
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
  }

  return {
    hookExecutions,
    combinedResultText: combineHookResultText(hookExecutions),
    rewrittenPrompt,
  };
}
