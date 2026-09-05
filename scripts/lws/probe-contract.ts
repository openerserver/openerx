import { createHash } from "node:crypto";
import type { LocalWebSearchErrorCode } from "@openerx/contracts";

export const LWS_DAILY_PROBE_SCHEMA_VERSION = "lws-daily-probe-v1" as const;
export const LWS_HISTORY_GATE_SCHEMA_VERSION = "lws-history-gate-v1" as const;
export const LWS_PROBE_TIMEZONE = "Asia/Shanghai" as const;

export const LWS_PROBE_PROVIDERS = ["direct:baidu-json", "direct:bing-html"] as const;
export type LwsProbeProviderId = (typeof LWS_PROBE_PROVIDERS)[number];

export type LwsProbeQueryClass = "navigational" | "reference" | "current";

export interface LwsProbeQueryDefinition {
  id: string;
  queryClass: LwsProbeQueryClass;
  query: string;
  relevanceTerms: readonly string[];
  recencyDays?: number;
}

export const LWS_PROBE_QUERY_CATALOG: readonly LwsProbeQueryDefinition[] = Object.freeze([
  Object.freeze({
    id: "navigational-openai-codex",
    queryClass: "navigational" as const,
    query: "OpenAI Codex",
    relevanceTerms: Object.freeze(["openai", "codex"]),
  }),
  Object.freeze({
    id: "reference-typescript-docs",
    queryClass: "reference" as const,
    query: "TypeScript documentation",
    relevanceTerms: Object.freeze(["typescript"]),
  }),
  Object.freeze({
    id: "current-openai-news",
    queryClass: "current" as const,
    query: "OpenAI 最新新闻",
    relevanceTerms: Object.freeze(["openai"]),
    recencyDays: 7,
  }),
]);

export const LWS_LOCAL_ALPHA_THRESHOLDS = Object.freeze({
  minimumUniqueDays: 7,
  queriesPerProviderPerDay: LWS_PROBE_QUERY_CATALOG.length,
  minimumSuccessRate: 0.95,
  maximumP95DurationMs: 3_000,
  maximumParserP95Ms: 50,
});

export interface LwsProbeRun {
  providerId: LwsProbeProviderId;
  queryId: string;
  queryClass: LwsProbeQueryClass;
  queryDigest: string;
  attemptedAt: string;
  status: "success" | "failed";
  errorCode: LocalWebSearchErrorCode | null;
  totalDurationMs: number;
  providerDurationMs: number | null;
  responseBytes: number;
  resultCount: number;
  topFiveRelevantCount: number | null;
  duplicateRate: number | null;
  sourceUrlValidityRate: number | null;
  sourceOpenability: "not_verified";
  recencyApplied: boolean | null;
}

export interface LwsProbePlatform {
  os: NodeJS.Platform;
  arch: string;
  release: string;
  nodeVersion: string;
  openerxVersion: string;
}

export interface LwsDailyProviderSummary {
  providerId: LwsProbeProviderId;
  plannedRuns: number;
  observedRuns: number;
  successes: number;
  failures: number;
  successRate: number;
  p50DurationMs: number | null;
  p95DurationMs: number | null;
  errorCounts: Partial<Record<LocalWebSearchErrorCode, number>>;
}

export interface LwsDailyProbeReport {
  schemaVersion: typeof LWS_DAILY_PROBE_SCHEMA_VERSION;
  kind: "openerx-local-web-search-daily-probe";
  probeDate: string;
  timezone: typeof LWS_PROBE_TIMEZONE;
  generatedAt: string;
  platform: LwsProbePlatform;
  network: {
    egressClass: "direct_system_network";
    proxyDetailsRecorded: false;
  };
  guardrails: {
    browserUsed: false;
    automaticFallback: false;
    retriesPerQuery: 0;
    resultPagesOpened: false;
    rawQueriesRecorded: false;
    rawSourcesRecorded: false;
  };
  userAgentDigest: string;
  queryCatalog: Array<{
    id: string;
    queryClass: LwsProbeQueryClass;
    queryDigest: string;
    recencyDays: number | null;
  }>;
  runs: LwsProbeRun[];
  providers: LwsDailyProviderSummary[];
}

export type LwsHistoryStatus = "insufficient_history" | "local_alpha_pass" | "local_alpha_fail";

export interface LwsHistoryProviderSummary extends LwsDailyProviderSummary {
  expectedRuns: number;
  missingRuns: number;
  uniqueDays: number;
  relevanceTopFiveRate: number | null;
  duplicateRate: number | null;
  sourceUrlValidityRate: number | null;
  status: LwsHistoryStatus;
}

export interface LwsHistoryGate {
  schemaVersion: typeof LWS_HISTORY_GATE_SCHEMA_VERSION;
  checkpoint: "LWS-006-local-web-search-readiness";
  updatedAt: string;
  history: {
    firstDate: string | null;
    lastDate: string | null;
    uniqueDays: number;
    requiredUniqueDays: number;
    reportDates: string[];
  };
  localAlpha: {
    status: LwsHistoryStatus;
    successRateThreshold: number;
    p95DurationMsThreshold: number;
    expectedRunsPerProvider: number;
    providers: LwsHistoryProviderSummary[];
  };
  platformMatrix: {
    required: string[];
    observed: Array<{
      platform: string;
      dates: string[];
      evidence: "live_probe";
    }>;
    missing: string[];
  };
  release: {
    status: "pending_external";
    releaseReady: false;
    completedEvidence: string[];
    requiredEvidence: Array<{
      id: string;
      status:
        | "satisfied"
        | "pending_external"
        | "pending_manual"
        | "insufficient_history"
        | "failed";
    }>;
  };
}

function rounded(value: number, digits = 4): number {
  return Number(value.toFixed(digits));
}

function average(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  return rounded(values.reduce((total, value) => total + value, 0) / values.length);
}

function percentile(values: readonly number[], percentileValue: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.max(0, Math.ceil(percentileValue * sorted.length) - 1);
  return sorted[index] ?? null;
}

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function validateProbeDate(value: string): string {
  if (!isIsoDate(value)) throw new Error("LWS_PROBE_DATE_INVALID");
  return value;
}

function assertFiniteNonnegative(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0) throw new Error(`LWS_PROBE_INVALID_${label}`);
}

export function lwsProbeDigest(value: string): string {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

export function currentProbeDate(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: LWS_PROBE_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

export function validateCurrentProbeDate(value: string, now = new Date()): string {
  validateProbeDate(value);
  const currentDate = currentProbeDate(now);
  if (value !== currentDate) {
    throw new Error(`LWS_PROBE_DATE_MUST_MATCH_TODAY:${currentDate}`);
  }
  return value;
}

function errorCounts(
  runs: readonly LwsProbeRun[],
): Partial<Record<LocalWebSearchErrorCode, number>> {
  const counts: Partial<Record<LocalWebSearchErrorCode, number>> = {};
  for (const run of runs) {
    if (!run.errorCode) continue;
    counts[run.errorCode] = (counts[run.errorCode] ?? 0) + 1;
  }
  return counts;
}

function providerSummary(
  providerId: LwsProbeProviderId,
  runs: readonly LwsProbeRun[],
): LwsDailyProviderSummary {
  const providerRuns = runs.filter((run) => run.providerId === providerId);
  const successes = providerRuns.filter((run) => run.status === "success").length;
  const durations = providerRuns.map((run) => run.totalDurationMs);
  return {
    providerId,
    plannedRuns: LWS_LOCAL_ALPHA_THRESHOLDS.queriesPerProviderPerDay,
    observedRuns: providerRuns.length,
    successes,
    failures: providerRuns.length - successes,
    successRate: providerRuns.length === 0 ? 0 : rounded(successes / providerRuns.length),
    p50DurationMs: percentile(durations, 0.5),
    p95DurationMs: percentile(durations, 0.95),
    errorCounts: errorCounts(providerRuns),
  };
}

function validateRunMatrix(runs: readonly LwsProbeRun[]): void {
  const expected = new Map(
    LWS_PROBE_PROVIDERS.flatMap((providerId) =>
      LWS_PROBE_QUERY_CATALOG.map(
        (query) => [`${providerId}\u0000${query.id}`, { providerId, query }] as const,
      ),
    ),
  );
  const observed = new Set<string>();
  for (const run of runs) {
    const key = `${run.providerId}\u0000${run.queryId}`;
    const definition = expected.get(key);
    if (!definition || observed.has(key)) throw new Error("LWS_PROBE_RUN_MATRIX_INVALID");
    observed.add(key);
    if (
      run.queryClass !== definition.query.queryClass ||
      run.queryDigest !== lwsProbeDigest(definition.query.query) ||
      (run.status === "success") !== (run.errorCode === null) ||
      (run.status === "failed" && run.errorCode === null)
    ) {
      throw new Error("LWS_PROBE_RUN_CONTRACT_INVALID");
    }
    assertFiniteNonnegative(run.totalDurationMs, "TOTAL_DURATION");
    assertFiniteNonnegative(run.responseBytes, "RESPONSE_BYTES");
    assertFiniteNonnegative(run.resultCount, "RESULT_COUNT");
    if (run.providerDurationMs !== null) {
      assertFiniteNonnegative(run.providerDurationMs, "PROVIDER_DURATION");
    }
    for (const rate of [run.duplicateRate, run.sourceUrlValidityRate]) {
      if (rate !== null && (!Number.isFinite(rate) || rate < 0 || rate > 1)) {
        throw new Error("LWS_PROBE_RATE_INVALID");
      }
    }
  }
  if (observed.size !== expected.size) throw new Error("LWS_PROBE_RUN_MATRIX_INCOMPLETE");
}

export function buildDailyProbeReport(input: {
  probeDate: string;
  generatedAt: string;
  platform: LwsProbePlatform;
  userAgent: string;
  runs: LwsProbeRun[];
}): LwsDailyProbeReport {
  validateProbeDate(input.probeDate);
  if (Number.isNaN(Date.parse(input.generatedAt))) throw new Error("LWS_PROBE_TIMESTAMP_INVALID");
  if (input.userAgent.trim() === "") throw new Error("LWS_PROBE_USER_AGENT_REQUIRED");
  validateRunMatrix(input.runs);
  const runs = structuredClone(input.runs);
  return {
    schemaVersion: LWS_DAILY_PROBE_SCHEMA_VERSION,
    kind: "openerx-local-web-search-daily-probe",
    probeDate: input.probeDate,
    timezone: LWS_PROBE_TIMEZONE,
    generatedAt: input.generatedAt,
    platform: { ...input.platform },
    network: { egressClass: "direct_system_network", proxyDetailsRecorded: false },
    guardrails: {
      browserUsed: false,
      automaticFallback: false,
      retriesPerQuery: 0,
      resultPagesOpened: false,
      rawQueriesRecorded: false,
      rawSourcesRecorded: false,
    },
    userAgentDigest: lwsProbeDigest(input.userAgent),
    queryCatalog: LWS_PROBE_QUERY_CATALOG.map((query) => ({
      id: query.id,
      queryClass: query.queryClass,
      queryDigest: lwsProbeDigest(query.query),
      recencyDays: query.recencyDays ?? null,
    })),
    runs,
    providers: LWS_PROBE_PROVIDERS.map((providerId) => providerSummary(providerId, runs)),
  };
}

export function parseDailyProbeReport(value: unknown): LwsDailyProbeReport {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("LWS_PROBE_REPORT_INVALID");
  }
  const report = value as LwsDailyProbeReport;
  if (
    report.schemaVersion !== LWS_DAILY_PROBE_SCHEMA_VERSION ||
    report.kind !== "openerx-local-web-search-daily-probe" ||
    report.timezone !== LWS_PROBE_TIMEZONE ||
    !isIsoDate(report.probeDate) ||
    !Array.isArray(report.runs) ||
    !report.platform ||
    typeof report.platform.os !== "string" ||
    typeof report.platform.arch !== "string" ||
    typeof report.generatedAt !== "string" ||
    Number.isNaN(Date.parse(report.generatedAt))
  ) {
    throw new Error("LWS_PROBE_REPORT_INVALID");
  }
  validateRunMatrix(report.runs);
  return report;
}

function providerHistorySummary(
  providerId: LwsProbeProviderId,
  reports: readonly LwsDailyProbeReport[],
): LwsHistoryProviderSummary {
  const runs = reports.flatMap((report) =>
    report.runs.filter((run) => run.providerId === providerId),
  );
  const uniqueDays = reports.length;
  const expectedRuns = uniqueDays * LWS_LOCAL_ALPHA_THRESHOLDS.queriesPerProviderPerDay;
  const successes = runs.filter((run) => run.status === "success");
  const successRate = expectedRuns === 0 ? 0 : rounded(successes.length / expectedRuns);
  const p95DurationMs = percentile(
    runs.map((run) => run.totalDurationMs),
    0.95,
  );
  const metric = (selector: (run: LwsProbeRun) => number | null) =>
    average(
      successes.flatMap((run) => {
        const selected = selector(run);
        return selected === null ? [] : [selected];
      }),
    );
  let status: LwsHistoryStatus = "insufficient_history";
  if (uniqueDays >= LWS_LOCAL_ALPHA_THRESHOLDS.minimumUniqueDays) {
    status =
      successRate >= LWS_LOCAL_ALPHA_THRESHOLDS.minimumSuccessRate &&
      p95DurationMs !== null &&
      p95DurationMs < LWS_LOCAL_ALPHA_THRESHOLDS.maximumP95DurationMs &&
      runs.length === expectedRuns
        ? "local_alpha_pass"
        : "local_alpha_fail";
  }
  return {
    ...providerSummary(providerId, runs),
    plannedRuns: expectedRuns,
    expectedRuns,
    missingRuns: Math.max(0, expectedRuns - runs.length),
    uniqueDays,
    successRate,
    p95DurationMs,
    relevanceTopFiveRate: metric((run) => {
      if (run.topFiveRelevantCount === null) return null;
      const denominator = Math.min(5, run.resultCount);
      return denominator === 0 ? 0 : run.topFiveRelevantCount / denominator;
    }),
    duplicateRate: metric((run) => run.duplicateRate),
    sourceUrlValidityRate: metric((run) => run.sourceUrlValidityRate),
    status,
  };
}

export function evaluateProbeHistory(inputReports: readonly LwsDailyProbeReport[]): LwsHistoryGate {
  const reports = [...inputReports].sort((left, right) =>
    left.probeDate.localeCompare(right.probeDate),
  );
  const dates = reports.map((report) => report.probeDate);
  if (new Set(dates).size !== dates.length) throw new Error("LWS_PROBE_DUPLICATE_DATE");
  for (const report of reports) parseDailyProbeReport(report);
  const providers = LWS_PROBE_PROVIDERS.map((providerId) =>
    providerHistorySummary(providerId, reports),
  );
  let status: LwsHistoryStatus = "insufficient_history";
  if (reports.length >= LWS_LOCAL_ALPHA_THRESHOLDS.minimumUniqueDays) {
    status = providers.every((provider) => provider.status === "local_alpha_pass")
      ? "local_alpha_pass"
      : "local_alpha_fail";
  }
  const platformDates = new Map<string, string[]>();
  for (const report of reports) {
    const platform = `${report.platform.os}-${report.platform.arch}`;
    platformDates.set(platform, [...(platformDates.get(platform) ?? []), report.probeDate]);
  }
  const requiredPlatforms = ["darwin-arm64", "darwin-x64", "win32-x64"];
  const observedPlatforms = [...platformDates.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([platform, observedDates]) => ({
      platform,
      dates: observedDates,
      evidence: "live_probe" as const,
    }));
  const historyEvidenceStatus =
    status === "insufficient_history"
      ? "insufficient_history"
      : status === "local_alpha_fail"
        ? "failed"
        : "satisfied";
  return {
    schemaVersion: LWS_HISTORY_GATE_SCHEMA_VERSION,
    checkpoint: "LWS-006-local-web-search-readiness",
    updatedAt: reports.at(-1)?.generatedAt ?? new Date(0).toISOString(),
    history: {
      firstDate: dates[0] ?? null,
      lastDate: dates.at(-1) ?? null,
      uniqueDays: reports.length,
      requiredUniqueDays: LWS_LOCAL_ALPHA_THRESHOLDS.minimumUniqueDays,
      reportDates: dates,
    },
    localAlpha: {
      status,
      successRateThreshold: LWS_LOCAL_ALPHA_THRESHOLDS.minimumSuccessRate,
      p95DurationMsThreshold: LWS_LOCAL_ALPHA_THRESHOLDS.maximumP95DurationMs,
      expectedRunsPerProvider: reports.length * LWS_LOCAL_ALPHA_THRESHOLDS.queriesPerProviderPerDay,
      providers,
    },
    platformMatrix: {
      required: requiredPlatforms,
      observed: observedPlatforms,
      missing: requiredPlatforms.filter((platform) => !platformDates.has(platform)),
    },
    release: {
      status: "pending_external",
      releaseReady: false,
      completedEvidence: [],
      requiredEvidence: [
        { id: "seven-unique-day-local-alpha-gate", status: historyEvidenceStatus },
        { id: "provider-terms-approved", status: "pending_external" },
        { id: "source-openability-and-manual-quality", status: "pending_manual" },
        { id: "macos-arm64-x64-and-windows-x64-live", status: "pending_external" },
        { id: "signed-install-upgrade-rollback", status: "pending_external" },
        { id: "signed-package-full-e2e", status: "pending_external" },
      ],
    },
  };
}

function displayRate(value: number | null): string {
  return value === null ? "—" : `${(value * 100).toFixed(1)}%`;
}

export function renderDailyProbeMarkdown(report: LwsDailyProbeReport): string {
  const rows = report.runs.map((run) =>
    [
      run.providerId,
      run.queryId,
      run.status,
      run.errorCode ?? "—",
      String(run.totalDurationMs),
      String(run.responseBytes),
      String(run.resultCount),
      run.topFiveRelevantCount === null ? "—" : String(run.topFiveRelevantCount),
      displayRate(run.sourceUrlValidityRate),
      displayRate(run.duplicateRate),
    ].join(" | "),
  );
  return `${[
    `# LWS 每日真实探测：${report.probeDate}`,
    "",
    `- 时区：\`${report.timezone}\``,
    `- 平台：\`${report.platform.os}-${report.platform.arch}\` / Node \`${report.platform.nodeVersion}\``,
    `- 网络出口：\`${report.network.egressClass}\`（未记录代理详情）`,
    `- User-Agent：仅记录摘要 \`${report.userAgentDigest}\``,
    "- 边界：无 Browser、无 fallback、无重试、不打开结果页、不保存原始查询或 Source。",
    "- Source 可打开性：`not_verified`；本报告只验证搜索入口与返回结构。",
    "",
    "Provider | Query ID | Status | Error | Total ms | Bytes | Results | Relevant top 5 | Valid URL | Duplicate",
    "--- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---:",
    ...rows,
    "",
    "## 当日汇总",
    "",
    "Provider | Success | P50 ms | P95 ms",
    "--- | ---: | ---: | ---:",
    ...report.providers.map(
      (provider) =>
        `${provider.providerId} | ${provider.successes}/${provider.plannedRuns} | ${provider.p50DurationMs ?? "—"} | ${provider.p95DurationMs ?? "—"}`,
    ),
    "",
    "> 单日样本不能证明 Local Alpha 稳定性；机器门禁要求至少 7 个不同日期。",
    "",
  ].join("\n")}`;
}
