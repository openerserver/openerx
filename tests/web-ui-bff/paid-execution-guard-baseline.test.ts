/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test";
import { evaluatePaidExecutionPreflight } from "../../control-plane/web-ui-bff/src/lib/paid-execution-guard";

describe("paid execution guard baseline estimation", () => {
  test("prefers historical runtime baseline over heuristic-only estimate when available", () => {
    process.env.ALLOW_PAID_MODEL_EXECUTION = undefined;

    const preflight = evaluatePaidExecutionPreflight(
      {
        projectId: "proj-default",
        resolvedModel: {
          providerId: "github-copilot",
          modelId: "gpt-5-mini",
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
      {
        projectId: "proj-default",
        activeLease: null,
        now: "2026-03-17T00:00:00.000Z",
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
  });

  test("uses project-level paid execution permission before falling back to deny", () => {
    process.env.ALLOW_PAID_MODEL_EXECUTION = undefined;

    const preflight = evaluatePaidExecutionPreflight(
      {
        projectId: "proj-default",
        allowPaidExecution: true,
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
      },
      {
        projectId: "proj-default",
        activeLease: null,
        now: "2026-03-17T00:00:00.000Z",
      },
    );

    expect(preflight.requirements.hasAllowPaidExecution).toBe(true);
    expect(preflight.estimate.guardDecision).toBe("require-approval");
  });

  test("preserves direct provider routes in policy metadata", () => {
    process.env.ALLOW_PAID_MODEL_EXECUTION = undefined;

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
      {
        projectId: "proj-default",
        activeLease: null,
        now: "2026-03-17T00:00:00.000Z",
      },
    );

    expect(preflight.policy.modelRoute).toBe("anthropic/claude-sonnet-4-20250514");
  });
});
