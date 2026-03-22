import { type UpstreamResponse, cpFetch } from "./control-plane-client";
import { formatModelRoute, resolveModelRoute } from "./opencode-config";

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
  requiresExplicitGate: boolean;
  requiresLease: boolean;
  suggestedModel?: string;
}

export interface PaidExecutionLeaseRecord {
  id: string;
  projectId: string;
  issuedByUserId?: string | null;
  revokedByUserId?: string | null;
  reason?: string | null;
  status: "active" | "revoked" | "expired";
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
  revokedAt?: string | null;
}

export interface PaidExecutionLeaseState {
  projectId: string;
  activeLease: PaidExecutionLeaseRecord | null;
  now: string;
}

export interface PaidExecutionRequirements {
  allowPaidExecution: boolean;
  leaseRequired: boolean;
  hasAllowPaidExecution: boolean;
  hasLease: boolean;
  leaseId: string | null;
}

export interface PaidExecutionPreflightResult {
  allowed: boolean;
  code: string;
  policy: ModelExecutionPolicy;
  requirements: PaidExecutionRequirements;
  estimate: PaidExecutionEstimate;
  activeLease: PaidExecutionLeaseRecord | null;
}

export interface PaidExecutionGuardState {
  enabled: boolean;
  providerId: string;
  modelId: string;
  modelRoute: string;
  leaseId: string | null;
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
  allowPaidExecution?: boolean;
  resolvedModel?: ResolvedModelLike;
  shape: PaidExecutionShape;
  baseline?: RuntimeUsageBaselineLike | null;
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
    requiresExplicitGate: false,
    requiresLease: false,
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
    requiresExplicitGate: true,
    requiresLease: false,
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
    requiresExplicitGate: true,
    requiresLease: false,
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
    requiresExplicitGate: true,
    requiresLease: true,
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
    requiresExplicitGate: true,
    requiresLease: true,
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

function detectModelCostTier(modelRoute: string, providerId: string): ModelCostTier {
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

function buildRequirements(
  policy: ModelExecutionPolicy,
  input: Pick<PaidExecutionPreflightInput, "allowPaidExecution">,
  leaseState: PaidExecutionLeaseState,
): PaidExecutionRequirements {
  return {
    allowPaidExecution: policy.requiresExplicitGate,
    leaseRequired: policy.requiresLease,
    hasAllowPaidExecution:
      process.env.ALLOW_PAID_MODEL_EXECUTION === "1" || input.allowPaidExecution === true,
    hasLease: Boolean(leaseState.activeLease?.id),
    leaseId: leaseState.activeLease?.id ?? null,
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
  policy: ModelExecutionPolicy,
  metrics: ShapeMetrics,
  guardDecision: GuardDecision,
  guardReason: string,
): PaidExecutionRiskDriver {
  return {
    type: "budget",
    label: `estimated $${metrics.estimatedCostUpper} / limit $${policy.maxEstimatedCostUsdPerRun}`,
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
  guardDecision: GuardDecision,
  guardReason: string,
): PaidExecutionRiskDriver[] {
  return [
    ...buildBaseRiskDrivers(policy, shape),
    buildParallelRiskDriver(policy, shape),
    buildJudgeRiskDriver(policy, shape),
    buildHookRiskDriver(policy, shape, metrics),
    buildBudgetRiskDriver(policy, metrics, guardDecision, guardReason),
  ].filter((driver): driver is PaidExecutionRiskDriver => Boolean(driver));
}

function exceedsShapePolicy(
  policy: ModelExecutionPolicy,
  shape: PaidExecutionShape,
  metrics: ShapeMetrics,
) {
  return (
    shape.candidateCount > policy.maxParallelCandidates ||
    (shape.judgeEnabled && !policy.allowJudge) ||
    (metrics.enabledHookCount > 0 && !policy.allowHooks)
  );
}

function exceedsBudgetPolicy(policy: ModelExecutionPolicy, metrics: ShapeMetrics) {
  const exceedsRequestLimit = metrics.estimatedRequestsUpper > policy.maxRequestsPerRun;
  const exceedsCostLimit =
    policy.maxEstimatedCostUsdPerRun > 0 &&
    metrics.estimatedCostUpper > policy.maxEstimatedCostUsdPerRun;

  return exceedsRequestLimit || exceedsCostLimit;
}

function resolveShapeViolationReasons(
  policy: ModelExecutionPolicy,
  shape: PaidExecutionShape,
  metrics: ShapeMetrics,
) {
  return [
    shape.candidateCount > policy.maxParallelCandidates
      ? `parallel candidates ${shape.candidateCount} > ${policy.maxParallelCandidates}`
      : null,
    shape.judgeEnabled && !policy.allowJudge ? "judge must be disabled" : null,
    metrics.enabledHookCount > 0 && !policy.allowHooks
      ? `hooks must be disabled (${shape.enabledHookTriggers.join(", ")})`
      : null,
  ].filter((value): value is string => Boolean(value));
}

function canSuggestedModelAllowShape(
  suggestedModel: string | undefined,
  shape: PaidExecutionShape,
  input: Pick<PaidExecutionPreflightInput, "allowPaidExecution">,
  leaseState: PaidExecutionLeaseState,
) {
  const resolved = parseModelRoute(suggestedModel);
  if (!resolved) {
    return false;
  }

  const suggestedPolicy = buildModelExecutionPolicy(resolved);
  const suggestedRequirements = buildRequirements(suggestedPolicy, input, leaseState);
  const suggestedMetrics = buildShapeMetrics(suggestedPolicy, shape);

  if (suggestedPolicy.requiresExplicitGate && !suggestedRequirements.hasAllowPaidExecution) {
    return false;
  }
  if (suggestedPolicy.requiresLease && !suggestedRequirements.hasLease) {
    return false;
  }
  if (exceedsShapePolicy(suggestedPolicy, shape, suggestedMetrics)) {
    return false;
  }
  if (exceedsBudgetPolicy(suggestedPolicy, suggestedMetrics)) {
    return false;
  }

  return true;
}

export async function fetchProjectPaidExecutionLeaseState(
  projectId: string,
  authorization: string,
): Promise<UpstreamResponse<PaidExecutionLeaseState>> {
  return cpFetch<PaidExecutionLeaseState>(
    `/api/projects/${encodeURIComponent(projectId)}/paid-execution-lease`,
    { authorization },
  );
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
    leaseId: preflight.requirements.leaseId,
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
  };
}

export function evaluatePaidExecutionPreflight(
  input: PaidExecutionPreflightInput,
  leaseState: PaidExecutionLeaseState,
): PaidExecutionPreflightResult {
  const policy = buildModelExecutionPolicy(input.resolvedModel);
  const requirements = buildRequirements(policy, input, leaseState);
  const metrics = buildShapeMetrics(policy, input.shape, input.baseline);

  let guardDecision: GuardDecision = "allow";
  let guardReason = "Execution is within the current paid-model policy window.";
  let code = "PAID_EXECUTION_ALLOWED";

  if (policy.requiresExplicitGate && !requirements.hasAllowPaidExecution) {
    guardDecision = "deny";
    guardReason =
      "Missing ALLOW_PAID_MODEL_EXECUTION=1; BFF blocks paid execution before creating the runtime session.";
    code = "PAID_EXECUTION_GATE_REQUIRED";
  } else if (policy.requiresLease && !requirements.hasLease) {
    guardDecision = "require-approval";
    guardReason =
      "The selected model requires an active paid execution lease issued by the control-plane service before execution can proceed.";
    code = "PAID_EXECUTION_LEASE_REQUIRED";
  } else if (exceedsShapePolicy(policy, input.shape, metrics)) {
    const reasons = resolveShapeViolationReasons(policy, input.shape, metrics);
    if (canSuggestedModelAllowShape(policy.suggestedModel, input.shape, input, leaseState)) {
      guardDecision = "allow-with-downgrade";
      guardReason = `Execution shape exceeds the current model policy. Retry with ${policy.suggestedModel} before creating the runtime session: ${reasons.join("; ")}.`;
      code = "PAID_EXECUTION_DOWNGRADE_REQUIRED";
    } else {
      guardDecision = "deny";
      guardReason = `Execution shape exceeds policy and cannot be auto-downgraded safely: ${reasons.join("; ")}.`;
      code = "PAID_EXECUTION_POLICY_SHAPE_EXCEEDED";
    }
  } else if (exceedsBudgetPolicy(policy, metrics)) {
    guardDecision = "deny";
    guardReason = `Estimated amplification exceeds policy: requests=${metrics.estimatedRequestsUpper}/${policy.maxRequestsPerRun}, cost=$${metrics.estimatedCostUpper}/$${policy.maxEstimatedCostUsdPerRun}.`;
    code = "PAID_EXECUTION_POLICY_LIMIT_EXCEEDED";
  }

  return {
    allowed: guardDecision === "allow",
    code,
    policy,
    requirements,
    activeLease: leaseState.activeLease,
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
      riskDrivers: buildRiskDrivers(policy, input.shape, metrics, guardDecision, guardReason),
      budgetHeadroom: {
        remainingUsd:
          policy.maxEstimatedCostUsdPerRun > 0
            ? roundEstimate(
                Math.max(0, policy.maxEstimatedCostUsdPerRun - metrics.estimatedCostUpper),
              )
            : null,
        enoughForSingleRun:
          policy.maxEstimatedCostUsdPerRun <= 0 ||
          metrics.estimatedCostUpper <= policy.maxEstimatedCostUsdPerRun,
        enoughForSuiteRun:
          policy.maxEstimatedCostUsdPerRun <= 0 ||
          metrics.estimatedCostUpper * 4 <= policy.maxEstimatedCostUsdPerRun,
      },
      baselineSource: metrics.baselineSource,
      guardDecision,
      guardReason,
      generatedAt: new Date().toISOString(),
    },
  };
}
