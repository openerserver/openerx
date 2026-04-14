import { formatModelRoute, readOpencodeJson, resolveModelRoute } from "./model-config";
import type { ProjectModelFundSnapshot } from "./project-fund";

export type GuardDecision = "allow" | "allow-with-downgrade" | "require-approval" | "deny";
export type ModelCostTier = "free" | "low" | "medium" | "high" | "premium";
export type PaidExecutionOverride = "judge-disabled" | "post-hook-disabled";

export interface ResolvedModelLike {
  providerId: string;
  modelId: string;
}

export interface ExecutionEstimateRange {
  min: number;
  max: number;
}

export interface PaidExecutionRiskDriver {
  type: "parallel" | "judge" | "hook" | "suite" | "model" | "budget";
  label: string;
  impact: "low" | "medium" | "high";
  detail: string;
}

export interface PaidExecutionEstimate {
  providerId: string;
  modelId: string;
  requestCount: ExecutionEstimateRange;
  inputTokens: ExecutionEstimateRange;
  outputTokens: ExecutionEstimateRange;
  totalTokens: ExecutionEstimateRange;
  costUsd: ExecutionEstimateRange;
  riskDrivers: PaidExecutionRiskDriver[];
  budgetHeadroom: {
    remainingUsd: number | null;
    enoughForSingleRun: boolean;
    enoughForSuiteRun: boolean;
  };
  baselineSource?: {
    source: "historical" | "heuristic";
    matchScope?: string;
    sampleSize?: number;
    lastLedgerAt?: string | null;
  };
  guardDecision: GuardDecision;
  guardReason: string;
  generatedAt: string;
}

export interface RuntimeUsageBaselineLike {
  matchScope: string;
  sampleSize: number;
  requestCount: { p50: number | null; p90: number | null };
  inputTokens: { p50: number | null; p90: number | null };
  outputTokens: { p50: number | null; p90: number | null };
  totalTokens: { p50: number | null; p90: number | null };
  costUsd: { p50: number | null; p90: number | null };
  lastLedgerAt?: string | null;
}

export interface ModelExecutionPolicy {
  providerId: string;
  modelId: string;
  modelRoute: string;
  environment: "dev" | "test" | "staging" | "prod";
  costTier: ModelCostTier;
  isPaid: boolean;
  defaultDecision: GuardDecision;
  maxRequestsPerRun: number;
  maxEstimatedCostUsdPerRun: number;
  maxParallelCandidates: number;
  allowJudge: boolean;
  allowHooks: boolean;
  suggestedModel?: string;
}

export interface PaidExecutionPreflightResult {
  allowed: boolean;
  code: string;
  policy: ModelExecutionPolicy;
  estimate: PaidExecutionEstimate;
}

export interface PaidExecutionGuardState {
  enabled: boolean;
  providerId: string;
  modelId: string;
  modelRoute: string;
  guardDecision: GuardDecision;
  guardReason: string;
  estimatedRequestUpperBound: number;
  estimatedTokenUpperBound: number;
  estimatedCostUpperBound: number;
  actualRequests: number;
  actualTokenUsage: number;
  actualCost: number;
  maxRequestsPerRun: number;
  maxEstimatedCostUsdPerRun: number;
  overridesApplied: PaidExecutionOverride[];
  postHooksDisabled: boolean;
  fundReservedTotalUsd?: number;
  fundReservedRemainingUsd?: number;
  breakerTrippedAt?: string;
  breakerReason?: string;
}

export interface PaidExecutionShape {
  candidateCount: number;
  judgeEnabled: boolean;
  enabledHookTriggers: string[];
  suiteLabel: string;
  suiteReference: string;
}

export interface PaidExecutionPreflightInput {
  projectId: string;
  resolvedModel?: ResolvedModelLike;
  shape: PaidExecutionShape;
  baseline?: RuntimeUsageBaselineLike | null;
  funding?: Pick<
    ProjectModelFundSnapshot,
    "available" | "hasFund" | "currency" | "reserved" | "consumed" | "totalGranted"
  > | null;
}

export function buildPreflightOrchestrationFingerprint(shape: PaidExecutionShape) {
  const hookSignature = [...shape.enabledHookTriggers].sort().join("+") || "none";
  return [
    `c${Math.max(1, shape.candidateCount)}`,
    `j${shape.judgeEnabled ? 1 : 0}`,
    `h:${hookSignature}`,
    shape.suiteLabel,
  ].join("|");
}

const DEFAULT_LOW_COST_EXECUTION_MODEL =
  process.env.LOW_COST_EXECUTION_MODEL || "github-copilot:gpt-5-mini";

const POLICY_BY_COST_TIER: Record<
  ModelCostTier,
  Omit<
    ModelExecutionPolicy,
    "providerId" | "modelId" | "modelRoute" | "environment" | "suggestedModel"
  >
> = {
  free: {
    costTier: "free",
    isPaid: false,
    defaultDecision: "allow",
    maxRequestsPerRun: 20,
    maxEstimatedCostUsdPerRun: 0,
    maxParallelCandidates: 4,
    allowJudge: true,
    allowHooks: true,
  },
  low: {
    costTier: "low",
    isPaid: true,
    defaultDecision: "deny",
    maxRequestsPerRun: 6,
    maxEstimatedCostUsdPerRun: 0.75,
    maxParallelCandidates: 5,
    allowJudge: false,
    allowHooks: true,
  },
  medium: {
    costTier: "medium",
    isPaid: true,
    defaultDecision: "deny",
    maxRequestsPerRun: 5,
    maxEstimatedCostUsdPerRun: 1.5,
    maxParallelCandidates: 5,
    allowJudge: false,
    allowHooks: true,
  },
  high: {
    costTier: "high",
    isPaid: true,
    defaultDecision: "require-approval",
    maxRequestsPerRun: 3,
    maxEstimatedCostUsdPerRun: 3,
    maxParallelCandidates: 5,
    allowJudge: false,
    allowHooks: false,
  },
  premium: {
    costTier: "premium",
    isPaid: true,
    defaultDecision: "require-approval",
    maxRequestsPerRun: 2,
    maxEstimatedCostUsdPerRun: 5,
    maxParallelCandidates: 5,
    allowJudge: false,
    allowHooks: false,
  },
};

const TOKEN_BASELINES: Record<ModelCostTier, { input: number; output: number }> = {
  free: { input: 1200, output: 600 },
  low: { input: 2800, output: 1200 },
  medium: { input: 3600, output: 1600 },
  high: { input: 5200, output: 2200 },
  premium: { input: 7200, output: 3200 },
};

const USD_PER_1K_TOKENS: Record<ModelCostTier, number> = {
  free: 0,
  low: 0.02,
  medium: 0.05,
  high: 0.12,
  premium: 0.2,
};

const REQUEST_SAFETY_FACTOR = 1.3;

interface ShapeMetrics {
  enabledHookCount: number;
  estimatedRequestsLower: number;
  estimatedRequestsUpper: number;
  estimatedCostLower: number;
  estimatedCostUpper: number;
  inputLower: number;
  inputUpper: number;
  outputLower: number;
  outputUpper: number;
  totalLower: number;
  totalUpper: number;
  baselineSource: {
    source: "historical" | "heuristic";
    matchScope?: string;
    sampleSize?: number;
    lastLedgerAt?: string | null;
  };
}

function resolveExecutionEnvironment(): "dev" | "test" | "staging" | "prod" {
  const raw = (
    process.env.OPENERX_EXECUTION_ENV ||
    process.env.BFF_EXECUTION_ENV ||
    process.env.NODE_ENV ||
    "dev"
  )
    .trim()
    .toLowerCase();

  if (raw.includes("prod")) {
    return "prod";
  }
  if (raw.includes("stage")) {
    return "staging";
  }
  if (raw.includes("test") || raw.includes("ci")) {
    return "test";
  }
  return "dev";
}

function roundEstimate(value: number) {
  return Number(value.toFixed(2));
}

function splitTokenUsage(totalTokens: number) {
  const safeTotal = Math.max(0, Math.round(totalTokens));
  const inputTokens = Math.round(safeTotal * 0.7);
  const outputTokens = Math.max(0, safeTotal - inputTokens);

  return {
    inputTokens,
    outputTokens,
    totalTokens: safeTotal,
  };
}

function detectHeuristicModelCostTier(modelRoute: string, providerId: string): ModelCostTier {
  const normalizedRoute = modelRoute.toLowerCase();
  const normalizedProvider = providerId.toLowerCase();

  if (
    normalizedProvider.includes("local") ||
    normalizedProvider === "opencode" ||
    normalizedProvider === "ollama" ||
    normalizedRoute.includes("big-pickle") ||
    normalizedRoute.includes("gpt-5-mini")
  ) {
    return "free";
  }

  if (
    normalizedRoute.includes("claude-opus") ||
    normalizedRoute.includes("gpt-5") ||
    normalizedRoute.includes("gemini-2.5-pro") ||
    normalizedRoute.includes(" o1") ||
    normalizedRoute.endsWith(":o1") ||
    normalizedRoute.includes(":o1-") ||
    normalizedRoute.includes(":o3") ||
    normalizedRoute.includes("/o3") ||
    normalizedRoute.includes("grok-4")
  ) {
    return "premium";
  }

  if (
    normalizedRoute.includes("claude-sonnet") ||
    normalizedRoute.includes("gpt-4.1") ||
    normalizedRoute.includes("gpt-4o") ||
    normalizedRoute.includes("o3-mini") ||
    normalizedRoute.includes("gemini")
  ) {
    return "low";
  }

  return "medium";
}

function resolveConfiguredBillingStatus(
  modelRoute: string,
  providerId: string,
): "free" | "paid" | undefined {
  const config = readOpencodeJson();
  const list = Array.isArray((config.models as Record<string, unknown> | undefined)?.list)
    ? ((config.models as Record<string, unknown>).list as Array<Record<string, unknown>>)
    : [];
  const normalizedRoute = modelRoute.trim();
  const fallbackPrefix = `${providerId.trim()}:`;

  const match = list.find((item) => {
    const itemProvider = typeof item.provider === "string" ? item.provider.trim() : "";
    const itemId = typeof item.id === "string" ? item.id.trim() : "";
    if (!itemProvider || !itemId) {
      return false;
    }

    const configuredRoute = formatModelRoute({ providerId: itemProvider, modelId: itemId });
    return configuredRoute === normalizedRoute || configuredRoute === `${fallbackPrefix}${itemId}`;
  });

  if (!match) {
    return undefined;
  }

  if (match.billingStatus === "paid") {
    return "paid";
  }
  if (match.billingStatus === "free") {
    return "free";
  }
  return undefined;
}

function detectModelCostTier(modelRoute: string, providerId: string): ModelCostTier {
  const configuredBillingStatus = resolveConfiguredBillingStatus(modelRoute, providerId);
  if (configuredBillingStatus === "free") {
    return "free";
  }

  const heuristicTier = detectHeuristicModelCostTier(modelRoute, providerId);
  if (configuredBillingStatus === "paid") {
    return heuristicTier === "free" ? "low" : heuristicTier;
  }

  return heuristicTier;
}

export function isFreeExecutionModelRoute(modelRoute: string, providerId: string): boolean {
  return detectModelCostTier(modelRoute, providerId) === "free";
}

function parseModelRoute(modelRoute: string | undefined): ResolvedModelLike | undefined {
  if (!modelRoute) {
    return undefined;
  }

  const value = modelRoute.trim();
  return value ? resolveModelRoute(value) : undefined;
}

function buildModelExecutionPolicy(
  resolvedModel: ResolvedModelLike | undefined,
): ModelExecutionPolicy {
  const providerId = resolvedModel?.providerId ?? "runtime-default";
  const modelId = resolvedModel?.modelId ?? "implicit-default";
  const modelRoute = formatModelRoute({ providerId, modelId });
  const environment = resolveExecutionEnvironment();
  const costTier = resolvedModel ? detectModelCostTier(modelRoute, providerId) : "free";
  const policyDefaults = POLICY_BY_COST_TIER[costTier];
  const suggestedModel =
    policyDefaults.isPaid && DEFAULT_LOW_COST_EXECUTION_MODEL !== modelRoute
      ? DEFAULT_LOW_COST_EXECUTION_MODEL
      : undefined;

  return {
    providerId,
    modelId,
    modelRoute,
    environment,
    suggestedModel,
    ...policyDefaults,
    defaultDecision: "allow",
  };
}

function buildExecutionEstimateRange(min: number, max: number): ExecutionEstimateRange {
  return {
    min: roundEstimate(min),
    max: roundEstimate(max),
  };
}

function hasHistoricalBaseline(baseline?: RuntimeUsageBaselineLike | null) {
  return Boolean(
    baseline &&
      baseline.sampleSize > 0 &&
      (baseline.requestCount.p50 != null ||
        baseline.totalTokens.p50 != null ||
        baseline.costUsd.p50 != null),
  );
}

function resolveBaselineSource(baseline?: RuntimeUsageBaselineLike | null) {
  return hasHistoricalBaseline(baseline)
    ? {
        source: "historical" as const,
        matchScope: baseline?.matchScope,
        sampleSize: baseline?.sampleSize,
        lastLedgerAt: baseline?.lastLedgerAt ?? null,
      }
    : {
        source: "heuristic" as const,
      };
}

function buildEstimatedMetric(heuristicValue: number, baselineValue?: number | null) {
  return Math.max(heuristicValue, Math.ceil(baselineValue ?? 0));
}

function buildEstimatedCost(totalTokens: number, costRate: number, baselineCost?: number | null) {
  return Math.max(roundEstimate((totalTokens / 1000) * costRate), roundEstimate(baselineCost ?? 0));
}

function buildShapeMetrics(
  policy: ModelExecutionPolicy,
  shape: PaidExecutionShape,
  baseline?: RuntimeUsageBaselineLike | null,
): ShapeMetrics {
  const enabledHookCount = shape.enabledHookTriggers.length;
  const candidateCount = Math.max(1, shape.candidateCount);
  const hookMultiplier = Math.max(1, 1 + enabledHookCount);
  const heuristicRequestsUpper = Math.max(
    1,
    Math.ceil(candidateCount * hookMultiplier + (shape.judgeEnabled ? 1 : 0)),
  );
  const heuristicRequestsLower = Math.max(1, candidateCount + (shape.judgeEnabled ? 1 : 0));
  const tokenBaseline = TOKEN_BASELINES[policy.costTier];
  const heuristicInputUpper = Math.ceil(
    heuristicRequestsUpper * tokenBaseline.input * REQUEST_SAFETY_FACTOR,
  );
  const heuristicInputLower = Math.ceil(heuristicRequestsLower * tokenBaseline.input * 0.75);
  const heuristicOutputUpper = Math.ceil(
    heuristicRequestsUpper * tokenBaseline.output * REQUEST_SAFETY_FACTOR,
  );
  const heuristicOutputLower = Math.ceil(heuristicRequestsLower * tokenBaseline.output * 0.6);
  const heuristicTotalUpper = heuristicInputUpper + heuristicOutputUpper;
  const heuristicTotalLower = heuristicInputLower + heuristicOutputLower;
  const costRate = USD_PER_1K_TOKENS[policy.costTier];
  const estimatedRequestsLower = buildEstimatedMetric(
    heuristicRequestsLower,
    baseline?.requestCount.p50,
  );
  const estimatedRequestsUpper = buildEstimatedMetric(
    heuristicRequestsUpper,
    baseline?.requestCount.p90,
  );
  const inputLower = buildEstimatedMetric(heuristicInputLower, baseline?.inputTokens.p50);
  const inputUpper = buildEstimatedMetric(heuristicInputUpper, baseline?.inputTokens.p90);
  const outputLower = buildEstimatedMetric(heuristicOutputLower, baseline?.outputTokens.p50);
  const outputUpper = buildEstimatedMetric(heuristicOutputUpper, baseline?.outputTokens.p90);
  const totalLower = buildEstimatedMetric(heuristicTotalLower, baseline?.totalTokens.p50);
  const totalUpper = buildEstimatedMetric(heuristicTotalUpper, baseline?.totalTokens.p90);
  const estimatedCostLower = buildEstimatedCost(totalLower, costRate, baseline?.costUsd.p50);
  const estimatedCostUpper = buildEstimatedCost(totalUpper, costRate, baseline?.costUsd.p90);

  return {
    enabledHookCount,
    estimatedRequestsLower,
    estimatedRequestsUpper,
    estimatedCostLower,
    estimatedCostUpper,
    inputLower,
    inputUpper,
    outputLower,
    outputUpper,
    totalLower,
    totalUpper,
    baselineSource: resolveBaselineSource(baseline),
  };
}

function resolveModelRiskImpact(policy: ModelExecutionPolicy): PaidExecutionRiskDriver["impact"] {
  if (!policy.isPaid) {
    return "low";
  }

  return policy.costTier === "premium" || policy.costTier === "high" ? "high" : "medium";
}

function buildBaseRiskDrivers(
  policy: ModelExecutionPolicy,
  shape: PaidExecutionShape,
): PaidExecutionRiskDriver[] {
  return [
    {
      type: "model",
      label: formatModelRoute({ providerId: policy.providerId, modelId: policy.modelId }),
      impact: resolveModelRiskImpact(policy),
      detail: `costTier=${policy.costTier}, environment=${policy.environment}`,
    },
    {
      type: "suite",
      label: shape.suiteLabel,
      impact: "low",
      detail: shape.suiteReference,
    },
  ];
}

function buildParallelRiskDriver(
  policy: ModelExecutionPolicy,
  shape: PaidExecutionShape,
): PaidExecutionRiskDriver | null {
  if (shape.candidateCount <= 1) {
    return null;
  }

  return {
    type: "parallel",
    label: `parallel candidates x${shape.candidateCount}`,
    impact: shape.candidateCount > policy.maxParallelCandidates ? "high" : "medium",
    detail: `policy maxParallelCandidates=${policy.maxParallelCandidates}`,
  };
}

function buildJudgeRiskDriver(policy: ModelExecutionPolicy, shape: PaidExecutionShape) {
  if (!shape.judgeEnabled) {
    return null;
  }

  return {
    type: "judge" as const,
    label: "judge enabled",
    impact: policy.allowJudge ? "medium" : "high",
    detail: `policy allowJudge=${String(policy.allowJudge)}`,
  };
}

function buildHookRiskDriver(
  policy: ModelExecutionPolicy,
  shape: PaidExecutionShape,
  metrics: ShapeMetrics,
) {
  if (metrics.enabledHookCount <= 0) {
    return null;
  }

  return {
    type: "hook" as const,
    label: `${metrics.enabledHookCount} lifecycle hook(s) enabled`,
    impact: policy.allowHooks ? "medium" : "high",
    detail: shape.enabledHookTriggers.join(", "),
  };
}

function buildBudgetRiskDriver(
  _policy: ModelExecutionPolicy,
  metrics: ShapeMetrics,
  remainingUsd: number | null,
  guardDecision: GuardDecision,
  guardReason: string,
): PaidExecutionRiskDriver {
  const remainingLabel = remainingUsd == null ? "n/a" : `$${remainingUsd}`;

  return {
    type: "budget",
    label: `estimated $${metrics.estimatedCostUpper} / available ${remainingLabel}`,
    impact:
      guardDecision === "allow"
        ? "low"
        : guardDecision === "allow-with-downgrade"
          ? "medium"
          : "high",
    detail: `${guardDecision}: ${guardReason}`,
  };
}

function buildRiskDrivers(
  policy: ModelExecutionPolicy,
  shape: PaidExecutionShape,
  metrics: ShapeMetrics,
  remainingUsd: number | null,
  guardDecision: GuardDecision,
  guardReason: string,
): PaidExecutionRiskDriver[] {
  return [
    ...buildBaseRiskDrivers(policy, shape),
    buildParallelRiskDriver(policy, shape),
    buildJudgeRiskDriver(policy, shape),
    buildHookRiskDriver(policy, shape, metrics),
    buildBudgetRiskDriver(policy, metrics, remainingUsd, guardDecision, guardReason),
  ].filter((driver): driver is PaidExecutionRiskDriver => Boolean(driver));
}

function canSuggestedModelAllowShape(
  suggestedModel: string | undefined,
  shape: PaidExecutionShape,
  availableFundUsd: number,
) {
  const resolved = parseModelRoute(suggestedModel);
  if (!resolved) {
    return false;
  }

  const suggestedPolicy = buildModelExecutionPolicy(resolved);
  const suggestedMetrics = buildShapeMetrics(suggestedPolicy, shape);

  return !suggestedPolicy.isPaid || availableFundUsd >= suggestedMetrics.estimatedCostUpper;
}

export function estimatePaidExecutionUsage(
  resolvedModel: ResolvedModelLike | undefined,
  totalTokens: number,
) {
  const policy = buildModelExecutionPolicy(resolvedModel);
  const tokenBreakdown = splitTokenUsage(totalTokens);
  const costUsd = roundEstimate(
    (tokenBreakdown.totalTokens / 1000) * USD_PER_1K_TOKENS[policy.costTier],
  );

  return {
    ...tokenBreakdown,
    costUsd,
  };
}

export function createPaidExecutionGuardState(
  preflight: PaidExecutionPreflightResult,
  overridesApplied: PaidExecutionOverride[] = [],
): PaidExecutionGuardState {
  return {
    enabled: preflight.policy.isPaid,
    providerId: preflight.policy.providerId,
    modelId: preflight.policy.modelId,
    modelRoute: preflight.policy.modelRoute,
    guardDecision: preflight.estimate.guardDecision,
    guardReason: preflight.estimate.guardReason,
    estimatedRequestUpperBound: preflight.estimate.requestCount.max,
    estimatedTokenUpperBound: preflight.estimate.totalTokens.max,
    estimatedCostUpperBound: preflight.estimate.costUsd.max,
    actualRequests: 0,
    actualTokenUsage: 0,
    actualCost: 0,
    maxRequestsPerRun: preflight.policy.maxRequestsPerRun,
    maxEstimatedCostUsdPerRun: preflight.policy.maxEstimatedCostUsdPerRun,
    overridesApplied,
    postHooksDisabled: overridesApplied.includes("post-hook-disabled"),
    fundReservedTotalUsd: 0,
    fundReservedRemainingUsd: 0,
  };
}

export function evaluatePaidExecutionPreflight(
  input: PaidExecutionPreflightInput,
): PaidExecutionPreflightResult {
  const policy = buildModelExecutionPolicy(input.resolvedModel);
  const metrics = buildShapeMetrics(policy, input.shape, input.baseline);
  const availableFundUsd = roundEstimate(Math.max(0, input.funding?.available ?? 0));
  const hasEnoughFund = !policy.isPaid || availableFundUsd >= metrics.estimatedCostUpper;

  let guardDecision: GuardDecision = "allow";
  let guardReason =
    !policy.isPaid
      ? "Execution uses a free model and does not require project fund reservation."
      : `Project fund can cover the estimated upper bound of $${metrics.estimatedCostUpper}.`;
  let code = "PAID_EXECUTION_ALLOWED";

  if (policy.isPaid && !hasEnoughFund) {
    if (canSuggestedModelAllowShape(policy.suggestedModel, input.shape, availableFundUsd)) {
      guardDecision = "allow-with-downgrade";
      guardReason = `Current model is estimated at $${metrics.estimatedCostUpper}, but project fund available is $${availableFundUsd}. Retry with ${policy.suggestedModel}.`;
      code = "PAID_EXECUTION_FUND_DOWNGRADE_SUGGESTED";
    } else {
      guardDecision = "deny";
      guardReason = `Current model is estimated at $${metrics.estimatedCostUpper}, but project fund available is only $${availableFundUsd}. Grant more fund or switch to a cheaper model.`;
      code = "PAID_EXECUTION_FUND_REQUIRED";
    }
  }

  return {
    allowed: guardDecision === "allow",
    code,
    policy,
    estimate: {
      providerId: policy.providerId,
      modelId: policy.modelId,
      requestCount: buildExecutionEstimateRange(
        metrics.estimatedRequestsLower,
        metrics.estimatedRequestsUpper,
      ),
      inputTokens: buildExecutionEstimateRange(metrics.inputLower, metrics.inputUpper),
      outputTokens: buildExecutionEstimateRange(metrics.outputLower, metrics.outputUpper),
      totalTokens: buildExecutionEstimateRange(metrics.totalLower, metrics.totalUpper),
      costUsd: buildExecutionEstimateRange(metrics.estimatedCostLower, metrics.estimatedCostUpper),
      riskDrivers: buildRiskDrivers(
        policy,
        input.shape,
        metrics,
        policy.isPaid ? availableFundUsd : null,
        guardDecision,
        guardReason,
      ),
      budgetHeadroom: {
        remainingUsd: policy.isPaid ? availableFundUsd : null,
        enoughForSingleRun: hasEnoughFund,
        enoughForSuiteRun:
          !policy.isPaid || availableFundUsd >= roundEstimate(metrics.estimatedCostUpper * 4),
      },
      baselineSource: metrics.baselineSource,
      guardDecision,
      guardReason,
      generatedAt: new Date().toISOString(),
    },
  };
}
