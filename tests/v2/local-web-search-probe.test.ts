import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  buildDailyProbeReport,
  evaluateProbeHistory,
  LWS_PROBE_PROVIDERS,
  LWS_PROBE_QUERY_CATALOG,
  type LwsDailyProbeReport,
  type LwsProbeRun,
  lwsProbeDigest,
  parseDailyProbeReport,
  renderDailyProbeMarkdown,
  validateCurrentProbeDate,
  validateProbeDate,
} from "../../scripts/lws/probe-contract";

function reportForDate(
  probeDate: string,
  failedKeys: ReadonlySet<string> = new Set(),
  slowKeys: ReadonlySet<string> = new Set(),
): LwsDailyProbeReport {
  const attemptedAt = `${probeDate}T01:00:00.000Z`;
  const runs: LwsProbeRun[] = LWS_PROBE_PROVIDERS.flatMap((providerId) =>
    LWS_PROBE_QUERY_CATALOG.map((query, index) => {
      const key = `${providerId}:${query.id}`;
      const failed = failedKeys.has(key);
      return {
        providerId,
        queryId: query.id,
        queryClass: query.queryClass,
        queryDigest: lwsProbeDigest(query.query),
        attemptedAt,
        status: failed ? ("failed" as const) : ("success" as const),
        errorCode: failed ? ("LOCAL_SEARCH_PROVIDER_CHALLENGE" as const) : null,
        totalDurationMs: slowKeys.has(key) ? 3_500 : 400 + index * 100,
        providerDurationMs: failed ? null : 350 + index * 100,
        responseBytes: failed ? 0 : 4_096,
        resultCount: failed ? 0 : 8,
        topFiveRelevantCount: failed ? null : 4,
        duplicateRate: failed ? null : 0,
        sourceUrlValidityRate: failed ? null : 1,
        sourceOpenability: "not_verified" as const,
        recencyApplied: failed ? null : query.recencyDays !== undefined,
      };
    }),
  );
  return buildDailyProbeReport({
    probeDate,
    generatedAt: `${probeDate}T03:00:00.000Z`,
    platform: {
      os: "darwin",
      arch: "arm64",
      release: "fixture",
      nodeVersion: "v24.2.0",
      openerxVersion: "2.0.0-alpha.0",
    },
    userAgent: "OpenERX-LWS-Test/2.0",
    runs,
  });
}

describe("LWS-006 daily probe and history gate", () => {
  it("rejects an invalid calendar date before live execution", () => {
    expect(() => validateProbeDate("2026-02-30")).toThrow("LWS_PROBE_DATE_INVALID");
    expect(() => validateProbeDate("2026-99-99")).toThrow("LWS_PROBE_DATE_INVALID");
    expect(validateProbeDate("2026-08-29")).toBe("2026-08-29");
    const now = new Date("2026-08-29T03:00:00.000Z");
    expect(validateCurrentProbeDate("2026-08-29", now)).toBe("2026-08-29");
    expect(() => validateCurrentProbeDate("2026-08-28", now)).toThrow(
      "LWS_PROBE_DATE_MUST_MATCH_TODAY:2026-08-29",
    );
  });

  it("records a fixed six-run matrix without raw queries or sources", () => {
    const report = reportForDate("2026-08-29");
    const serialized = JSON.stringify(report);

    expect(report.runs).toHaveLength(6);
    expect(report.guardrails).toEqual({
      browserUsed: false,
      automaticFallback: false,
      retriesPerQuery: 0,
      resultPagesOpened: false,
      rawQueriesRecorded: false,
      rawSourcesRecorded: false,
    });
    for (const query of LWS_PROBE_QUERY_CATALOG) {
      expect(serialized).not.toContain(query.query);
      expect(serialized).toContain(lwsProbeDigest(query.query));
    }
    expect(serialized).not.toContain("https://example.com/source");
    expect(renderDailyProbeMarkdown(report)).toContain("单日样本不能证明 Local Alpha 稳定性");
  });

  it("keeps the gate at insufficient_history for a single real date", () => {
    const gate = evaluateProbeHistory([reportForDate("2026-08-29")]);

    expect(gate.history).toMatchObject({
      uniqueDays: 1,
      requiredUniqueDays: 7,
      reportDates: ["2026-08-29"],
    });
    expect(gate.localAlpha.status).toBe("insufficient_history");
    expect(gate.localAlpha.providers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          expectedRuns: 3,
          successes: 3,
          status: "insufficient_history",
        }),
      ]),
    );
    expect(gate.release).toMatchObject({
      status: "pending_external",
      releaseReady: false,
    });
    expect(gate.platformMatrix).toMatchObject({
      observed: [expect.objectContaining({ platform: "darwin-arm64" })],
      missing: ["darwin-x64", "win32-x64"],
    });
  });

  it("passes Local Alpha only after seven unique complete days meet both thresholds", () => {
    const reports = [23, 24, 25, 26, 27, 28, 29].map((day) => reportForDate(`2026-08-${day}`));
    const gate = evaluateProbeHistory(reports);

    expect(gate.history.uniqueDays).toBe(7);
    expect(gate.localAlpha.status).toBe("local_alpha_pass");
    expect(gate.localAlpha.providers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          expectedRuns: 21,
          observedRuns: 21,
          successRate: 1,
          p95DurationMs: 600,
          status: "local_alpha_pass",
        }),
      ]),
    );
    expect(gate.release.releaseReady).toBe(false);
  });

  it("fails the mature gate when provider success or latency misses the budget", () => {
    const failedBaidu = new Set([
      "direct:baidu-json:navigational-openai-codex",
      "direct:baidu-json:reference-typescript-docs",
    ]);
    const slowBing = new Set([
      "direct:bing-html:navigational-openai-codex",
      "direct:bing-html:reference-typescript-docs",
    ]);
    const reports = [23, 24, 25, 26, 27, 28, 29].map((day, index) =>
      reportForDate(
        `2026-08-${day}`,
        index === 0 ? failedBaidu : new Set(),
        index === 0 ? slowBing : new Set(),
      ),
    );
    const gate = evaluateProbeHistory(reports);

    expect(gate.localAlpha.status).toBe("local_alpha_fail");
    expect(
      gate.localAlpha.providers.find(({ providerId }) => providerId === "direct:baidu-json"),
    ).toMatchObject({ successRate: 0.9048, status: "local_alpha_fail" });
    expect(
      gate.localAlpha.providers.find(({ providerId }) => providerId === "direct:bing-html"),
    ).toMatchObject({ p95DurationMs: 3_500, status: "local_alpha_fail" });
  });

  it("rejects duplicate dates instead of inflating history", () => {
    const report = reportForDate("2026-08-29");
    expect(() => evaluateProbeHistory([report, structuredClone(report)])).toThrow(
      "LWS_PROBE_DUPLICATE_DATE",
    );
  });

  it("keeps the committed gate derived from every dated probe report", () => {
    const evidenceDirectory = new URL("../../docs/v2/evidence/lws-probes/", import.meta.url);
    const reports = readdirSync(evidenceDirectory)
      .filter((name) => /^\d{4}-\d{2}-\d{2}\.json$/u.test(name))
      .map((name) =>
        parseDailyProbeReport(
          JSON.parse(readFileSync(new URL(name, evidenceDirectory), "utf8")) as unknown,
        ),
      );
    const committedGate = JSON.parse(
      readFileSync(new URL("./golden/lws-006-gate-status.json", import.meta.url), "utf8"),
    ) as unknown;

    expect(reports.length).toBeGreaterThan(0);
    expect(committedGate).toEqual(evaluateProbeHistory(reports));
  });
});
