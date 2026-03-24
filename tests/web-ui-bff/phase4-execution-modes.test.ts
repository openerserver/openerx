import { describe, expect, test } from "bun:test";
import {
  type ChainStepInput,
  type ExecutionStep,
  type OrchestrationStrategy,
  type RuntimePlan,
  type WorkflowTemplate,
  buildRuntimePlan,
} from "../../control-plane/web-ui-bff/src/lib/orchestration-strategy";

// ── Helpers ────────────────────────────────────────────────────────

function makeTemplate(overrides?: Partial<WorkflowTemplate>): WorkflowTemplate {
  return {
    id: "test-template",
    name: "Test Template",
    mode: "single",
    agents: ["coder"],
    enabled: true,
    ...overrides,
  };
}

function makeStrategy(overrides?: Partial<OrchestrationStrategy>): OrchestrationStrategy {
  return {
    categoryAgentMap: { general: ["coder", "reviewer"] },
    judge: {
      enabled: false,
      agent: "judge",
      model: "github-copilot:claude-sonnet-4",
      promptTemplate: "",
      timeoutMs: 60000,
      selectionStrategy: "highest-score",
    },
    hooks: [],
    ...overrides,
  } as OrchestrationStrategy;
}

// ── buildRuntimePlan: single mode ──────────────────────────────────

describe("buildRuntimePlan — single mode", () => {
  test("produces a single-mode plan with one candidate", () => {
    const plan = buildRuntimePlan(makeTemplate(), makeStrategy(), "general");
    expect(plan.mode).toBe("single");
    expect(plan.candidates).toHaveLength(1);
    expect(plan.steps).toHaveLength(1);
    expect(plan.steps[0]?.type).toBe("execution");
  });
});

// ── buildRuntimePlan: parallel mode ────────────────────────────────

describe("buildRuntimePlan — parallel mode", () => {
  test("produces a parallel plan from template agents", () => {
    const template = makeTemplate({ mode: "parallel", agents: ["a1", "a2"] });
    const plan = buildRuntimePlan(template, makeStrategy(), "general");
    expect(plan.mode).toBe("parallel");
    expect(plan.candidates).toHaveLength(2);
    expect(plan.candidates[0]?.agent).toBe("a1");
    expect(plan.candidates[1]?.agent).toBe("a2");
  });

  test("overrides candidates with user-provided models", () => {
    const template = makeTemplate({ mode: "parallel", agents: ["a1", "a2", "a3"] });
    const plan = buildRuntimePlan(template, makeStrategy(), "general", {
      candidates: [
        { model: "openai:gpt-4o", label: "GPT-4o" },
        { model: "anthropic:claude-sonnet-4", label: "Claude" },
      ],
    });
    expect(plan.candidates).toHaveLength(2);
    expect(plan.candidates[0]?.model).toBe("openai:gpt-4o");
    expect(plan.candidates[0]?.label).toBe("GPT-4o");
    expect(plan.candidates[0]?.agent).toBe("coder");
    expect(plan.candidates[1]?.model).toBe("anthropic:claude-sonnet-4");
    expect(plan.candidates[1]?.agent).toBe("reviewer");
  });

  test("user-provided candidates prefer category agents over unrelated template agents", () => {
    const template = makeTemplate({ mode: "parallel", agents: ["ops-agent-a", "ops-agent-b"] });
    const plan = buildRuntimePlan(template, makeStrategy(), "general", {
      candidates: [
        { model: "github-copilot:gpt-5-mini", label: "候选 A" },
        { model: "github-copilot:gpt-4o", label: "候选 B" },
      ],
    });

    expect(plan.candidates[0]?.agent).toBe("coder");
    expect(plan.candidates[1]?.agent).toBe("reviewer");
  });

  test("mode override from single to parallel", () => {
    const template = makeTemplate({ mode: "single", agents: ["a1", "a2"] });
    const plan = buildRuntimePlan(template, makeStrategy(), "general", { mode: "parallel" });
    expect(plan.mode).toBe("parallel");
    expect(plan.candidates.length).toBeGreaterThanOrEqual(2);
  });
});

// ── buildRuntimePlan: sequential-chain mode ────────────────────────

describe("buildRuntimePlan — sequential-chain mode", () => {
  const chainSteps: ChainStepInput[] = [
    { id: "step-1", title: "分析", instruction: "分析代码结构" },
    { id: "step-2", title: "实现", instruction: "根据分析实现功能" },
    { id: "step-3", title: "测试", instruction: "编写测试用例", model: "openai:gpt-4o" },
  ];

  test("produces a sequential-chain plan with chain-step steps", () => {
    const template = makeTemplate({ mode: "sequential-chain" });
    const plan = buildRuntimePlan(template, makeStrategy(), "general", {
      steps: chainSteps,
    });

    expect(plan.mode).toBe("sequential-chain");
    expect(plan.steps).toHaveLength(3);
    expect(plan.currentChainStepIndex).toBe(0);
    expect(plan.candidates).toHaveLength(1);
  });

  test("each step has chain-step type and correct fields", () => {
    const template = makeTemplate({ mode: "sequential-chain" });
    const plan = buildRuntimePlan(template, makeStrategy(), "general", {
      steps: chainSteps,
    });

    for (let i = 0; i < plan.steps.length; i++) {
      const step = plan.steps[i];
      expect(step).toBeDefined();
      if (!step) {
        throw new Error(`Expected plan step at index ${i}`);
      }
      expect(step.type).toBe("chain-step");
      expect(step.status).toBe("pending");
      expect(step.title).toBe(chainSteps[i]?.title);
      expect(step.instruction).toBe(chainSteps[i]?.instruction);
    }
  });

  test("steps have correct dependency chain", () => {
    const template = makeTemplate({ mode: "sequential-chain" });
    const plan = buildRuntimePlan(template, makeStrategy(), "general", {
      steps: chainSteps,
    });

    expect(plan.steps[0]?.dependsOn).toBeUndefined();
    expect(plan.steps[1]?.dependsOn).toEqual(["step-1"]);
    expect(plan.steps[2]?.dependsOn).toEqual(["step-2"]);
  });

  test("step model override is preserved", () => {
    const template = makeTemplate({ mode: "sequential-chain" });
    const plan = buildRuntimePlan(template, makeStrategy(), "general", {
      steps: chainSteps,
    });

    expect(plan.steps[0]?.model).toBeUndefined();
    expect(plan.steps[2]?.model).toBe("openai:gpt-4o");
  });

  test("mode override from single to sequential-chain", () => {
    const template = makeTemplate({ mode: "single" });
    const plan = buildRuntimePlan(template, makeStrategy(), "general", {
      mode: "sequential-chain",
      steps: chainSteps,
    });
    expect(plan.mode).toBe("sequential-chain");
    expect(plan.steps).toHaveLength(3);
  });

  test("empty steps produces an empty chain plan", () => {
    const template = makeTemplate({ mode: "sequential-chain" });
    const plan = buildRuntimePlan(template, makeStrategy(), "general", {
      steps: [],
    });
    expect(plan.mode).toBe("sequential-chain");
    expect(plan.steps).toHaveLength(0);
    expect(plan.currentChainStepIndex).toBe(0);
  });

  test("generates default step ids when not provided", () => {
    const steps: ChainStepInput[] = [
      { id: "", title: "A", instruction: "do A" },
      { id: "", title: "B", instruction: "do B" },
    ];
    const template = makeTemplate({ mode: "sequential-chain" });
    const plan = buildRuntimePlan(template, makeStrategy(), "general", { steps });
    expect(plan.steps[0]?.id).toBe("chain-step-0");
    expect(plan.steps[1]?.id).toBe("chain-step-1");
  });
});

// ── RuntimePlan type constraints ───────────────────────────────────

describe("RuntimePlan type structure", () => {
  test("chainResult field is optional on plan", () => {
    const plan: RuntimePlan = {
      templateId: "t",
      mode: "sequential-chain",
      steps: [],
      candidates: [],
      currentChainStepIndex: 0,
    };
    expect(plan.chainResult).toBeUndefined();
    plan.chainResult = "aggregated output";
    expect(plan.chainResult).toBe("aggregated output");
  });

  test("ExecutionStep supports chain-step type with title and instruction", () => {
    const step: ExecutionStep = {
      id: "cs-0",
      type: "chain-step",
      status: "pending",
      title: "分析",
      instruction: "分析代码",
      model: "openai:gpt-4o",
    };
    expect(step.type).toBe("chain-step");
    expect(step.title).toBe("分析");
    expect(step.instruction).toBe("分析代码");
  });
});
