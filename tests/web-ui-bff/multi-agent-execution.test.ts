import { describe, expect, test } from "bun:test";
import {
  type OrchestrationStrategy,
  buildRuntimePlan,
  mergeTaskStrategy,
  normalizeOrchestrationStrategy,
  parseHookDecision,
  parseTaskStrategy,
  resolveWorkflowTemplate,
} from "../../control-plane/web-ui-bff/src/lib/orchestration-strategy";
import { getLifecycleHooksForTrigger } from "../../control-plane/web-ui-bff/src/modules/hooks/lifecycle-hooks";

type LegacyStrategyInput = Partial<OrchestrationStrategy> & {
  preExecutionReview?: {
    enabled: boolean;
    agent: string;
    model: string;
    promptTemplate: string;
    timeoutMs: number;
  };
  postExecutionReview?: {
    enabled: boolean;
    agent: string;
    model: string;
    promptTemplate: string;
    timeoutMs: number;
  };
};

/** Build a minimal valid strategy for testing. */
function buildStrategy(overrides: Partial<OrchestrationStrategy> = {}): OrchestrationStrategy {
  return normalizeOrchestrationStrategy(overrides);
}

function buildLegacyCompatibleStrategy(overrides: LegacyStrategyInput): OrchestrationStrategy {
  return normalizeOrchestrationStrategy(overrides as Partial<OrchestrationStrategy>);
}

// ── migrateToHooks (via normalizeOrchestrationStrategy) ─────────────

describe("hook migration", () => {
  test("legacy preExecutionReview auto-migrates into hooks array", () => {
    const strategy = buildLegacyCompatibleStrategy({
      preExecutionReview: {
        enabled: true,
        agent: "reviewer",
        model: "openai:gpt-4o",
        promptTemplate: "Review: {{taskPrompt}}",
        timeoutMs: 10000,
      },
    });

    expect(strategy.hooks.length).toBeGreaterThanOrEqual(1);
    const preHook = strategy.hooks.find((h) => h.trigger === "pre-execution");
    expect(preHook).toBeTruthy();
    expect(preHook?.agent).toBe("reviewer");
    expect(preHook?.enabled).toBe(true);
  });

  test("legacy postExecutionReview auto-migrates into hooks array", () => {
    const strategy = buildLegacyCompatibleStrategy({
      postExecutionReview: {
        enabled: true,
        agent: "auditor",
        model: "",
        promptTemplate: "Audit: {{taskResult}}",
        timeoutMs: 20000,
      },
    });

    const postHook = strategy.hooks.find((h) => h.trigger === "post-execution");
    expect(postHook).toBeTruthy();
    expect(postHook?.agent).toBe("auditor");
  });

  test("explicit hooks array takes precedence over legacy fields", () => {
    const strategy = buildLegacyCompatibleStrategy({
      preExecutionReview: {
        enabled: true,
        agent: "legacy-agent",
        model: "",
        promptTemplate: "",
        timeoutMs: 15000,
      },
      hooks: [
        {
          id: "custom-1",
          trigger: "pre-execution",
          enabled: true,
          agent: "custom-agent",
          promptTemplate: "custom",
          timeoutMs: 5000,
          order: 0,
        },
      ],
    });

    // The explicit hooks array should be kept, not the legacy migration
    expect(strategy.hooks).toHaveLength(1);
    expect(strategy.hooks[0].agent).toBe("custom-agent");
  });
});

// ── Template Resolution ─────────────────────────────────────────────

describe("resolveWorkflowTemplate", () => {
  test("resolves by explicit templateId", () => {
    const strategy = buildStrategy({
      templates: [
        { id: "t1", name: "Template 1", mode: "single", agents: ["a1"], enabled: true },
        { id: "t2", name: "Template 2", mode: "parallel", agents: ["a2", "a3"], enabled: true },
      ],
    });

    const result = resolveWorkflowTemplate(strategy, "deep", "t2");
    expect(result.id).toBe("t2");
    expect(result.mode).toBe("parallel");
  });

  test("resolves by category default", () => {
    const strategy = buildStrategy({
      templates: [
        {
          id: "ops-template",
          name: "Ops",
          mode: "single",
          agents: ["ops-agent"],
          enabled: true,
          categoryDefaults: ["ops"],
        },
        {
          id: "generic",
          name: "Generic",
          mode: "single",
          agents: ["default-executor"],
          enabled: true,
        },
      ],
    });

    const result = resolveWorkflowTemplate(strategy, "ops");
    expect(result.id).toBe("ops-template");
  });

  test("falls back to synthetic single template when category has no matching default", () => {
    const strategy = buildStrategy({
      templates: [
        { id: "disabled", name: "Off", mode: "single", agents: ["x"], enabled: false },
        {
          id: "fallback",
          name: "Fallback",
          mode: "single",
          agents: ["default-executor"],
          enabled: true,
        },
      ],
    });

    const result = resolveWorkflowTemplate(strategy, "deep");
    expect(result.id).toBe("fallback-single");
    expect(result.mode).toBe("single");
  });

  test("returns synthetic fallback when no templates available", () => {
    const strategy = buildStrategy({ templates: [] });
    // normalizeOrchestrationStrategy fills defaults, but we override post-normalize
    strategy.templates = [];

    const result = resolveWorkflowTemplate(strategy, "quick");
    expect(result.id).toBe("fallback-single");
    expect(result.mode).toBe("single");
  });
});

// ── Runtime Plan Building ───────────────────────────────────────────

describe("buildRuntimePlan", () => {
  test("single mode produces one candidate", () => {
    const strategy = buildStrategy();
    const template = resolveWorkflowTemplate(strategy, "deep");
    const plan = buildRuntimePlan(template, strategy, "deep");

    expect(plan.mode).toBe("single");
    expect(plan.candidates).toHaveLength(1);
    expect(plan.candidates[0].label).toBe("主执行");
    expect(plan.candidates[0].status).toBe("pending");
  });

  test("parallel mode produces multiple candidates", () => {
    const strategy = buildStrategy({
      templates: [
        {
          id: "parallel-t",
          name: "Parallel",
          mode: "parallel",
          agents: ["agent-a", "agent-b", "agent-c"],
          enabled: true,
        },
      ],
    });

    const template = resolveWorkflowTemplate(strategy, "deep", "parallel-t");
    const plan = buildRuntimePlan(template, strategy, "deep");

    expect(plan.mode).toBe("parallel");
    expect(plan.candidates.length).toBeGreaterThanOrEqual(2);
    expect(plan.candidates[0]?.label).toBe("候选 1");
    expect(plan.candidates.every((c) => c.status === "pending")).toBe(true);
  });

  test("parallel mode respects maxParallelCandidates", () => {
    const strategy = buildStrategy({
      templates: [
        {
          id: "limited",
          name: "Limited",
          mode: "parallel",
          agents: ["a1", "a2", "a3", "a4", "a5"],
          maxParallelCandidates: 2,
          enabled: true,
        },
      ],
    });

    const template = resolveWorkflowTemplate(strategy, "deep", "limited");
    const plan = buildRuntimePlan(template, strategy, "deep");

    expect(plan.candidates).toHaveLength(2);
  });

  test("plan includes templateId", () => {
    const strategy = buildStrategy();
    const template = resolveWorkflowTemplate(strategy, "quick");
    const plan = buildRuntimePlan(template, strategy, "quick");

    expect(plan.templateId).toBe(template.id);
  });
});

// ── Strategy Merge + Hook Execution ─────────────────────────────────

describe("mergeTaskStrategy with hookExecutions", () => {
  test("appends hookExecutions to existing array", () => {
    const existing = JSON.stringify({
      selectedAgent: "default-executor",
      hookExecutions: [
        { hookId: "h1", trigger: "pre-execution", status: "completed", agent: "reviewer" },
      ],
    });

    const merged = mergeTaskStrategy(existing, {
      hookExecutions: [
        {
          hookId: "h2",
          trigger: "post-execution",
          status: "completed",
          agent: "auditor",
          prompt: "Audit result",
          completedAt: new Date().toISOString(),
        },
      ],
    });

    const parsed = JSON.parse(merged);
    expect(parsed.hookExecutions).toHaveLength(2);
    expect(parsed.hookExecutions[0].hookId).toBe("h1");
    expect(parsed.hookExecutions[1].hookId).toBe("h2");
  });

  test("creates hookExecutions from empty", () => {
    const merged = mergeTaskStrategy(undefined, {
      selectedAgent: "default-executor",
      hookExecutions: [
        {
          hookId: "legacy-pre-execution",
          trigger: "pre-execution",
          status: "completed",
          agent: "default-executor",
          prompt: "Review task prompt",
          completedAt: new Date().toISOString(),
        },
      ],
    });

    const parsed = parseTaskStrategy(merged);
    expect(parsed.hookExecutions).toHaveLength(1);
  });

  test("preserves existing hookExecutions when patch has none", () => {
    const existing = JSON.stringify({
      hookExecutions: [{ hookId: "h1", trigger: "pre-execution", status: "completed", agent: "x" }],
    });

    const merged = mergeTaskStrategy(existing, { selectedAgent: "default-executor" });
    const parsed = JSON.parse(merged);
    expect(parsed.hookExecutions).toHaveLength(1);
  });

  test("parses persisted object strategy without forcing JSON string input", () => {
    const parsed = parseTaskStrategy({
      executionMode: "parallel",
      parallelCandidates: [
        { model: "gpt-5.4", label: "候选 A" },
        { model: "claude-opus-4.6", label: "候选 B" },
      ],
    });

    expect(parsed.parallelCandidates).toEqual([
      { model: "gpt-5.4", label: "候选 A" },
      { model: "claude-opus-4.6", label: "候选 B" },
    ]);
  });

  test("merges paid guard patches into object strategy while preserving parallel candidates", () => {
    const merged = mergeTaskStrategy(
      {
        executionMode: "parallel",
        parallelCandidates: [
          { model: "gpt-5.4", label: "候选 A" },
          { model: "claude-opus-4.6", label: "候选 B" },
        ],
      },
      {
        paidExecutionGuard: {
          enabled: true,
          modelRoute: "github-copilot:gpt-5.4",
          modelId: "gpt-5.4",
          providerId: "github-copilot",
          guardDecision: "allow",
          guardReason: "within limit",
          actualRequests: 1,
          actualTokenUsage: 123,
          actualCost: 0.01,
          overridesApplied: [],
          maxRequestsPerRun: 6,
          estimatedRequestUpperBound: 2,
          estimatedTokenUpperBound: 5000,
          estimatedCostUpperBound: 0.2,
          maxEstimatedCostUsdPerRun: 0.75,
          postHooksDisabled: false,
        },
      },
    );

    expect(parseTaskStrategy(merged).parallelCandidates).toEqual([
      { model: "gpt-5.4", label: "候选 A" },
      { model: "claude-opus-4.6", label: "候选 B" },
    ]);
  });
});

// ── Hook Decision Parsing ───────────────────────────────────────────

describe("parseHookDecision", () => {
  test("parses structured rewrite-prompt decision", () => {
    const decision = parseHookDecision(
      'Result\n{"action":"rewrite-prompt","reason":"Need safer scope","rewrittenPrompt":"Only update the API client."}',
    );

    expect(decision?.action).toBe("rewrite-prompt");
    expect(decision?.reason).toBe("Need safer scope");
    expect(decision?.rewrittenPrompt).toBe("Only update the API client.");
  });

  test("parses structured spawn-followup decision", () => {
    const decision = parseHookDecision(
      [
        "Result",
        JSON.stringify({
          action: "spawn-followup",
          reason: "Need final verification",
          followupTemplateId: "post-review-followup",
          followupGoal: "Summarize remaining risks",
          targetAgent: "oracle-enterprise",
          targetModel: "github-copilot:gpt-5.4",
        }),
      ].join("\n"),
    );

    expect(decision?.action).toBe("spawn-followup");
    expect(decision?.followupTemplateId).toBe("post-review-followup");
    expect(decision?.followupGoal).toBe("Summarize remaining risks");
    expect(decision?.targetAgent).toBe("oracle-enterprise");
    expect(decision?.targetModel).toBe("github-copilot:gpt-5.4");
  });

  test("returns undefined for unstructured text", () => {
    expect(parseHookDecision("plain text without decision json")).toBeUndefined();
  });
});

// ── Lifecycle Hook Selection ────────────────────────────────────────

describe("getLifecycleHooksForTrigger", () => {
  test("selects enabled hooks for trigger in order", () => {
    const strategy = buildStrategy({
      hooks: [
        {
          id: "post-2",
          trigger: "post-execution",
          enabled: true,
          agent: "auditor-b",
          promptTemplate: "b",
          timeoutMs: 1000,
          order: 2,
        },
        {
          id: "post-1",
          trigger: "post-execution",
          enabled: true,
          agent: "auditor-a",
          promptTemplate: "a",
          timeoutMs: 1000,
          order: 1,
        },
        {
          id: "post-disabled",
          trigger: "post-execution",
          enabled: false,
          agent: "auditor-x",
          promptTemplate: "x",
          timeoutMs: 1000,
          order: 0,
        },
        {
          id: "pre-1",
          trigger: "pre-execution",
          enabled: true,
          agent: "reviewer",
          promptTemplate: "pre",
          timeoutMs: 1000,
          order: 0,
        },
      ],
    });

    const hooks = getLifecycleHooksForTrigger(strategy, "post-execution");
    expect(hooks).toHaveLength(2);
    expect(hooks[0]?.id).toBe("post-1");
    expect(hooks[1]?.id).toBe("post-2");
  });
});

// ── Judge Config Normalization ──────────────────────────────────────

describe("judge config normalization", () => {
  test("defaults judge to disabled", () => {
    const strategy = buildStrategy();
    expect(strategy.judge.enabled).toBe(false);
    expect(strategy.judge.selectionStrategy).toBe("judge-pick");
  });

  test("preserves valid judge config", () => {
    const strategy = buildStrategy({
      judge: {
        enabled: true,
        agent: "judge-agent",
        model: "anthropic:claude-sonnet-4-20250514",
        promptTemplate: "Judge this: {{candidateResults}}",
        timeoutMs: 60000,
        selectionStrategy: "highest-score",
      },
    });

    expect(strategy.judge.enabled).toBe(true);
    expect(strategy.judge.agent).toBe("judge-agent");
    expect(strategy.judge.selectionStrategy).toBe("highest-score");
  });

  test("invalid selectionStrategy falls back to default", () => {
    const strategy = normalizeOrchestrationStrategy({
      judge: {
        enabled: true,
        agent: "j",
        model: "",
        promptTemplate: "",
        timeoutMs: 30000,
        selectionStrategy: "invalid" as "judge-pick",
      },
    } as Partial<OrchestrationStrategy>);

    expect(strategy.judge.selectionStrategy).toBe("judge-pick");
  });
});
