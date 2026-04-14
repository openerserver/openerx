/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { evaluatePaidExecutionPreflight } from "../../control-plane/web-ui-bff/src/lib/paid-execution-guard";

describe("paid execution guard baseline estimation", () => {
  test("prefers historical runtime baseline over heuristic-only estimate when available", () => {
    const preflight = evaluatePaidExecutionPreflight(
      {
        projectId: "proj-default",
        resolvedModel: {
          providerId: "local",
          modelId: "test-model",
        },
        shape: {
          candidateCount: 1,
          judgeEnabled: false,
          enabledHookTriggers: [],
          suiteLabel: "single-task execute",
          suiteReference: "task=task-1",
        },
        baseline: {
          matchScope: "project+provider+model+entrypoint",
          sampleSize: 6,
          requestCount: { p50: 3, p90: 5 },
          inputTokens: { p50: 2400, p90: 4200 },
          outputTokens: { p50: 1000, p90: 1800 },
          totalTokens: { p50: 3400, p90: 6000 },
          costUsd: { p50: 0.08, p90: 0.12 },
          lastLedgerAt: "2026-03-17T00:00:00.000Z",
        },
      },
    );

    expect(preflight.estimate.baselineSource).toEqual({
      source: "historical",
      matchScope: "project+provider+model+entrypoint",
      sampleSize: 6,
      lastLedgerAt: "2026-03-17T00:00:00.000Z",
    });
    expect(preflight.estimate.requestCount.max).toBe(5);
    expect(preflight.estimate.totalTokens.max).toBe(6000);
    expect(preflight.estimate.costUsd.max).toBe(0.12);
    expect(preflight.estimate.guardDecision).toBe("allow");
    expect(preflight.estimate.budgetHeadroom).toEqual({
      remainingUsd: null,
      enoughForSingleRun: true,
      enoughForSuiteRun: true,
    });
  });

  test("uses project fund affordability to allow paid execution", () => {
    const preflight = evaluatePaidExecutionPreflight(
      {
        projectId: "proj-default",
        resolvedModel: {
          providerId: "github-copilot",
          modelId: "gpt-5.4",
        },
        shape: {
          candidateCount: 1,
          judgeEnabled: false,
          enabledHookTriggers: [],
          suiteLabel: "single-task execute",
          suiteReference: "task=task-1",
        },
        baseline: null,
        funding: {
          totalGranted: 10,
          reserved: 0,
          consumed: 0,
          available: 10,
          hasFund: true,
          currency: "USD",
        },
      },
    );

    expect(Object.prototype.hasOwnProperty.call(preflight, "requirements")).toBe(false);
    expect(preflight.estimate.guardDecision).toBe("allow");
    expect(preflight.estimate.budgetHeadroom.remainingUsd).toBe(10);
  });

  test("preserves direct provider routes in policy metadata", () => {
    const preflight = evaluatePaidExecutionPreflight(
      {
        projectId: "proj-default",
        resolvedModel: {
          providerId: "anthropic",
          modelId: "anthropic/claude-sonnet-4-20250514",
        },
        shape: {
          candidateCount: 1,
          judgeEnabled: false,
          enabledHookTriggers: [],
          suiteLabel: "single-task execute",
          suiteReference: "task=task-1",
        },
        baseline: null,
      },
    );

    expect(preflight.policy.modelRoute).toBe("anthropic/claude-sonnet-4-20250514");
  });

  test("prefers explicit paid billing config over heuristic free classification", async () => {
    const previousOpencodeRoot = process.env.OPENCODE_ROOT;
    const tempRoot = mkdtempSync(join(tmpdir(), "openerx-paid-guard-"));

    try {
      writeFileSync(
        join(tempRoot, "opencode.json"),
        `${JSON.stringify(
          {
            models: {
              list: [
                {
                  id: "gpt-5-mini",
                  provider: "github-copilot",
                  name: "GPT-5 mini",
                  billingStatus: "paid",
                  billingMethod: "request_metered",
                  price: {
                    currency: "USD",
                    perRequestUsd: 0.01,
                  },
                },
              ],
            },
          },
          null,
          2,
        )}\n`,
        "utf-8",
      );
      process.env.OPENCODE_ROOT = tempRoot;

      const { isFreeExecutionModelRoute } = await import(
        `../../control-plane/web-ui-bff/src/lib/paid-execution-guard?paid-billing-override=${Date.now()}`
      );

      expect(isFreeExecutionModelRoute("github-copilot:gpt-5-mini", "github-copilot")).toBe(
        false,
      );
    } finally {
      if (previousOpencodeRoot === undefined) {
        delete process.env.OPENCODE_ROOT;
      } else {
        process.env.OPENCODE_ROOT = previousOpencodeRoot;
      }
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});
