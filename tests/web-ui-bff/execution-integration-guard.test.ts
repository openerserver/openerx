import { afterEach, describe, expect, test } from "bun:test";

const originalRunExecutionIntegration = process.env.RUN_EXECUTION_INTEGRATION;
const originalLowCostExecutionModel = process.env.LOW_COST_EXECUTION_MODEL;

afterEach(() => {
  if (originalRunExecutionIntegration === undefined) {
    process.env.RUN_EXECUTION_INTEGRATION = undefined;
  } else {
    process.env.RUN_EXECUTION_INTEGRATION = originalRunExecutionIntegration;
  }

  if (originalLowCostExecutionModel === undefined) {
    process.env.LOW_COST_EXECUTION_MODEL = undefined;
  } else {
    process.env.LOW_COST_EXECUTION_MODEL = originalLowCostExecutionModel;
  }
});

async function loadGuardModule() {
  return import(`../../tests/web-ui-bff/execution-integration-guard.ts?ts=${Date.now()}`);
}

describe("execution integration guard", () => {
  test("real execution tests only depend on the execution gate", async () => {
    process.env.RUN_EXECUTION_INTEGRATION = "1";

    const guard = await loadGuardModule();
    expect(guard.isExecutionIntegrationEnabled()).toBe(true);
    expect(guard.getExecutionIntegrationGuardSummary()).toMatchObject({
      executionEnabled: true,
      safeModel: "github-copilot:gpt-5-mini",
    });
    expect(guard.getExecutionIntegrationGuardSummary()).not.toHaveProperty("paidExecutionAllowed");
  });

  test("rejects unsupported fallback models and coerces to GPT-5 mini", async () => {
    process.env.RUN_EXECUTION_INTEGRATION = "1";
    process.env.LOW_COST_EXECUTION_MODEL = "github-copilot:gpt-4.1";

    const guard = await loadGuardModule();
    expect(
      guard.resolveExecutionIntegrationModel(
        [{ provider: "github-copilot", id: "claude-opus-4.6" }],
        "github-copilot:claude-opus-4.6",
      ),
    ).toBe("github-copilot:gpt-5-mini");
  });

  test("accepts configured GPT-4o as the enforced execution test model", async () => {
    process.env.RUN_EXECUTION_INTEGRATION = "1";

    const guard = await loadGuardModule();
    expect(
      guard.resolveExecutionIntegrationModel(
        [{ provider: "github-copilot", id: "gpt-4o" }],
        "github-copilot:gpt-4o",
      ),
    ).toBe("github-copilot:gpt-4o");
  });
});
