import { describe, test } from "bun:test";

interface ConfigModelRecord {
  id?: string;
  provider?: string;
}

const ALLOWED_EXECUTION_TEST_MODELS = [
  "github-copilot:gpt-5-mini",
  "github-copilot:gpt-4o",
] as const;

function normalizeExecutionTestModel(raw?: string | null) {
  if (!raw) {
    return undefined;
  }

  const value = raw.trim();
  if (!value) {
    return undefined;
  }

  const normalized = value.includes(":") ? value : `github-copilot:${value}`;
  return ALLOWED_EXECUTION_TEST_MODELS.includes(
    normalized as (typeof ALLOWED_EXECUTION_TEST_MODELS)[number],
  )
    ? normalized
    : undefined;
}

function getDefaultLowCostExecutionModel() {
  return (
    normalizeExecutionTestModel(process.env.TEST_EXECUTION_MODEL) ||
    normalizeExecutionTestModel(process.env.LOW_COST_EXECUTION_MODEL) ||
    ALLOWED_EXECUTION_TEST_MODELS[0]
  );
}

export function isExecutionIntegrationEnabled() {
  return process.env.RUN_EXECUTION_INTEGRATION === "1";
}

export function isPaidExecutionAllowed() {
  return process.env.ALLOW_PAID_MODEL_EXECUTION === "1";
}

export function getExecutionIntegrationGuardSummary() {
  return {
    executionEnabled: isExecutionIntegrationEnabled(),
    paidExecutionAllowed: isPaidExecutionAllowed(),
    safeModel: getDefaultLowCostExecutionModel(),
    allowedModels: [...ALLOWED_EXECUTION_TEST_MODELS],
  };
}

export const paidExecutionIntegrationTest = isExecutionIntegrationEnabled() ? test : test.skip;

export const paidExecutionIntegrationDescribe = isExecutionIntegrationEnabled()
  ? describe
  : describe.skip;

export function resolveExecutionIntegrationModel(
  configuredModels: ConfigModelRecord[],
  configuredTestModel?: string | null,
) {
  const normalizedConfiguredTestModel = normalizeExecutionTestModel(configuredTestModel);
  if (normalizedConfiguredTestModel) {
    return normalizedConfiguredTestModel;
  }

  for (const route of ALLOWED_EXECUTION_TEST_MODELS) {
    const [provider, ...modelParts] = route.split(":");
    const modelId = modelParts.join(":");
    const configuredCopilotModel = configuredModels.find(
      (model) => model.provider === provider && model.id === modelId,
    );
    if (configuredCopilotModel?.provider && configuredCopilotModel.id) {
      return `${configuredCopilotModel.provider}:${configuredCopilotModel.id}`;
    }
  }

  return getDefaultLowCostExecutionModel();
}
