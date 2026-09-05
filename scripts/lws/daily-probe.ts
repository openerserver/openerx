import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  defaultLocalWebSearchPolicy,
  type LocalWebSearchCandidate,
  type LocalWebSearchErrorCode,
} from "@openerx/contracts";
import {
  BaiduJsonSearchProvider,
  BingHtmlSearchProvider,
  type LocalSearchProvider,
  LocalWebSearchError,
} from "@openerx/tool-sdk";
import {
  buildDailyProbeReport,
  currentProbeDate,
  evaluateProbeHistory,
  LWS_PROBE_PROVIDERS,
  LWS_PROBE_QUERY_CATALOG,
  type LwsProbeProviderId,
  type LwsProbeQueryDefinition,
  type LwsProbeRun,
  lwsProbeDigest,
  parseDailyProbeReport,
  renderDailyProbeMarkdown,
  validateCurrentProbeDate,
} from "./probe-contract";

interface CliOptions {
  probeDate: string;
}

function usage(): string {
  return [
    "Usage: npm run probe:lws:v2 -- [options]",
    "",
    "Options:",
    "  --date=YYYY-MM-DD       Asia/Shanghai date; must match today",
    "  --help                  Print this help",
    "",
    "Required environment:",
    "  OPENERX_LWS_PROBE_UA    Stable UA from the packaged Electron/OpenERX runtime",
  ].join("\n");
}

function parseArguments(argv: readonly string[]): CliOptions | null {
  let probeDate = currentProbeDate();
  for (const argument of argv) {
    if (argument === "--help") return null;
    if (argument.startsWith("--date=")) {
      probeDate = argument.slice("--date=".length);
      continue;
    }
    throw new Error(`LWS_PROBE_UNKNOWN_ARGUMENT:${argument}`);
  }
  return { probeDate };
}

function roundedRate(value: number): number {
  return Number(value.toFixed(4));
}

function validSourceUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (
      (url.protocol !== "https:" && url.protocol !== "http:") ||
      url.hostname === "" ||
      url.username !== "" ||
      url.password !== ""
    ) {
      return null;
    }
    url.hash = "";
    return url.href;
  } catch {
    return null;
  }
}

function qualityMetrics(
  candidates: readonly LocalWebSearchCandidate[],
  query: LwsProbeQueryDefinition,
): Pick<LwsProbeRun, "topFiveRelevantCount" | "duplicateRate" | "sourceUrlValidityRate"> {
  const validUrls = candidates.flatMap((candidate) => {
    const url = validSourceUrl(candidate.url);
    return url ? [url] : [];
  });
  const relevantTerms = query.relevanceTerms.map((term) => term.toLocaleLowerCase());
  const topFiveRelevantCount = candidates.slice(0, 5).filter((candidate) => {
    const text = `${candidate.title} ${candidate.excerpt} ${candidate.url}`
      .replace(/<[^>]*>/gu, " ")
      .toLocaleLowerCase();
    return relevantTerms.some((term) => text.includes(term));
  }).length;
  return {
    topFiveRelevantCount,
    duplicateRate:
      validUrls.length === 0 ? null : roundedRate(1 - new Set(validUrls).size / validUrls.length),
    sourceUrlValidityRate:
      candidates.length === 0 ? null : roundedRate(validUrls.length / candidates.length),
  };
}

function stableErrorCode(error: unknown): LocalWebSearchErrorCode {
  return error instanceof LocalWebSearchError ? error.code : "LOCAL_SEARCH_PROVIDER_UNAVAILABLE";
}

async function runProbe(input: {
  providerId: LwsProbeProviderId;
  provider: LocalSearchProvider;
  query: LwsProbeQueryDefinition;
}): Promise<LwsProbeRun> {
  const attemptedAt = new Date().toISOString();
  const startedAt = performance.now();
  const controller = new AbortController();
  const policy = {
    ...defaultLocalWebSearchPolicy(),
    providerOrder: [input.providerId],
    allowProviderFallback: false,
    cacheMode: "off" as const,
  };
  const timeout = setTimeout(() => controller.abort(), policy.toolTimeoutMs);
  try {
    const result = await input.provider.search(
      {
        query: input.query.query,
        domains: [],
        ...(input.query.recencyDays === undefined ? {} : { recencyDays: input.query.recencyDays }),
      },
      { signal: controller.signal, policy },
    );
    const totalDurationMs = Math.max(0, Math.round(performance.now() - startedAt));
    const quality = qualityMetrics(result.candidates, input.query);
    if (result.candidates.length === 0) {
      return {
        providerId: input.providerId,
        queryId: input.query.id,
        queryClass: input.query.queryClass,
        queryDigest: lwsProbeDigest(input.query.query),
        attemptedAt,
        status: "failed",
        errorCode: "LOCAL_SEARCH_NO_RESULTS",
        totalDurationMs,
        providerDurationMs: result.durationMs,
        responseBytes: result.responseBytes,
        resultCount: 0,
        ...quality,
        sourceOpenability: "not_verified",
        recencyApplied: result.recencyApplied,
      };
    }
    return {
      providerId: input.providerId,
      queryId: input.query.id,
      queryClass: input.query.queryClass,
      queryDigest: lwsProbeDigest(input.query.query),
      attemptedAt,
      status: "success",
      errorCode: null,
      totalDurationMs,
      providerDurationMs: result.durationMs,
      responseBytes: result.responseBytes,
      resultCount: result.candidates.length,
      ...quality,
      sourceOpenability: "not_verified",
      recencyApplied: result.recencyApplied,
    };
  } catch (error) {
    return {
      providerId: input.providerId,
      queryId: input.query.id,
      queryClass: input.query.queryClass,
      queryDigest: lwsProbeDigest(input.query.query),
      attemptedAt,
      status: "failed",
      errorCode: stableErrorCode(error),
      totalDurationMs: Math.max(0, Math.round(performance.now() - startedAt)),
      providerDurationMs: null,
      responseBytes: 0,
      resultCount: 0,
      topFiveRelevantCount: null,
      duplicateRate: null,
      sourceUrlValidityRate: null,
      sourceOpenability: "not_verified",
      recencyApplied: null,
    };
  } finally {
    clearTimeout(timeout);
  }
}

function readRepositoryVersion(repositoryRoot: string): string {
  const value = JSON.parse(readFileSync(path.join(repositoryRoot, "package.json"), "utf8")) as {
    version?: unknown;
  };
  if (typeof value.version !== "string" || value.version === "") {
    throw new Error("LWS_PROBE_APP_VERSION_INVALID");
  }
  return value.version;
}

function readHistory(outputDirectory: string) {
  return readdirSync(outputDirectory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /^\d{4}-\d{2}-\d{2}\.json$/u.test(entry.name))
    .map((entry) => {
      const report = parseDailyProbeReport(
        JSON.parse(readFileSync(path.join(outputDirectory, entry.name), "utf8")) as unknown,
      );
      if (entry.name !== `${report.probeDate}.json`) {
        throw new Error(`LWS_PROBE_FILENAME_DATE_MISMATCH:${entry.name}`);
      }
      return report;
    });
}

function writeArtifact(target: string, contents: string, mode: "new" | "derived"): void {
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, contents, { encoding: "utf8", flag: mode === "new" ? "wx" : "w" });
}

async function main(): Promise<void> {
  const repositoryRoot = process.cwd();
  const options = parseArguments(process.argv.slice(2));
  if (!options) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  validateCurrentProbeDate(options.probeDate);
  const userAgent = process.env.OPENERX_LWS_PROBE_UA?.trim();
  if (!userAgent) throw new Error("OPENERX_LWS_PROBE_UA_REQUIRED");
  const outputDirectory = path.join(repositoryRoot, "docs", "v2", "evidence", "lws-probes");
  const gateOutput = path.join(repositoryRoot, "tests", "v2", "golden", "lws-006-gate-status.json");
  const jsonOutput = path.join(outputDirectory, `${options.probeDate}.json`);
  const markdownOutput = path.join(outputDirectory, `${options.probeDate}.md`);
  if (existsSync(jsonOutput) || existsSync(markdownOutput)) {
    throw new Error(`LWS_PROBE_REPORT_EXISTS:${options.probeDate}`);
  }

  const providers = new Map<LwsProbeProviderId, LocalSearchProvider>([
    ["direct:baidu-json", new BaiduJsonSearchProvider({ userAgent })],
    ["direct:bing-html", new BingHtmlSearchProvider({ userAgent })],
  ]);
  const runs: LwsProbeRun[] = [];
  for (const providerId of LWS_PROBE_PROVIDERS) {
    const provider = providers.get(providerId);
    if (!provider) throw new Error(`LWS_PROBE_PROVIDER_MISSING:${providerId}`);
    for (const query of LWS_PROBE_QUERY_CATALOG) {
      runs.push(await runProbe({ providerId, provider, query }));
    }
  }

  const report = buildDailyProbeReport({
    probeDate: options.probeDate,
    generatedAt: new Date().toISOString(),
    platform: {
      os: process.platform,
      arch: process.arch,
      release: os.release(),
      nodeVersion: process.version,
      openerxVersion: readRepositoryVersion(repositoryRoot),
    },
    userAgent,
    runs,
  });
  writeArtifact(jsonOutput, `${JSON.stringify(report, null, 2)}\n`, "new");
  writeArtifact(markdownOutput, renderDailyProbeMarkdown(report), "new");
  const gate = evaluateProbeHistory(readHistory(outputDirectory));
  writeArtifact(gateOutput, `${JSON.stringify(gate, null, 2)}\n`, "derived");
  process.stdout.write(
    `${JSON.stringify({
      report: path.relative(repositoryRoot, jsonOutput),
      markdown: path.relative(repositoryRoot, markdownOutput),
      gate: path.relative(repositoryRoot, gateOutput),
      probeDate: report.probeDate,
      localAlphaStatus: gate.localAlpha.status,
      successfulRuns: report.runs.filter((run) => run.status === "success").length,
      plannedRuns: report.runs.length,
    })}\n`,
  );
}

await main();
