import { describe, expect, test } from "bun:test";
import type { LifecycleHook } from "../../control-plane/web-ui-bff/src/lib/orchestration-strategy";
import {
  mergeStageAndStrategyHooks,
  parseStageHooks,
} from "../../control-plane/web-ui-bff/src/modules/hooks/lifecycle-hooks";

// ── parseStageHooks ────────────────────────────────────────────────

describe("parseStageHooks", () => {
  test("returns empty array for null / undefined / empty", () => {
    expect(parseStageHooks(null)).toEqual([]);
    expect(parseStageHooks(undefined)).toEqual([]);
    expect(parseStageHooks([])).toEqual([]);
  });

  test("parses valid hooks from raw JSON records", () => {
    const raw = [
      {
        id: "stage-hook-pre",
        trigger: "pre-execution",
        enabled: true,
        agent: "review-agent",
        model: "openai:gpt-4o",
        promptTemplate: "Review: {{taskTitle}}",
        timeoutMs: 30000,
        order: 10,
      },
    ];
    const result = parseStageHooks(raw);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      id: "stage-hook-pre",
      trigger: "pre-execution",
      enabled: true,
      agent: "review-agent",
      model: "openai:gpt-4o",
      promptTemplate: "Review: {{taskTitle}}",
      timeoutMs: 30000,
      order: 10,
    });
  });

  test("skips hooks with invalid trigger", () => {
    const raw = [{ id: "bad", trigger: "unknown-trigger", agent: "a", enabled: true }];
    expect(parseStageHooks(raw)).toEqual([]);
  });

  test("skips hooks without agent", () => {
    const raw = [{ id: "no-agent", trigger: "pre-execution", enabled: true }];
    expect(parseStageHooks(raw)).toEqual([]);
  });

  test("assigns defaults for missing optional fields", () => {
    const raw = [{ trigger: "post-execution", agent: "checker" }];
    const result = parseStageHooks(raw);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("stage-hook-0");
    expect(result[0].enabled).toBe(true);
    expect(result[0].model).toBeUndefined();
    expect(result[0].promptTemplate).toBe("");
    expect(result[0].timeoutMs).toBe(60000);
    expect(result[0].order).toBe(0);
  });

  test("disabled hooks are still parsed (enabled=false)", () => {
    const raw = [{ trigger: "on-failure", agent: "alert", enabled: false }];
    const result = parseStageHooks(raw);
    expect(result).toHaveLength(1);
    expect(result[0].enabled).toBe(false);
  });
});

// ── mergeStageAndStrategyHooks ─────────────────────────────────────

describe("mergeStageAndStrategyHooks", () => {
  const stageHook: LifecycleHook = {
    id: "stage-pre",
    trigger: "pre-execution",
    enabled: true,
    agent: "stage-reviewer",
    promptTemplate: "Stage prehook",
    timeoutMs: 30000,
    order: 5,
  };

  const strategyHook: LifecycleHook = {
    id: "strategy-pre",
    trigger: "pre-execution",
    enabled: true,
    agent: "strategy-reviewer",
    promptTemplate: "Strategy prehook",
    timeoutMs: 60000,
    order: 10,
  };

  test("returns empty when both lists are empty", () => {
    expect(mergeStageAndStrategyHooks([], [])).toEqual([]);
  });

  test("returns stage hooks when strategy has none", () => {
    const result = mergeStageAndStrategyHooks([stageHook], []);
    expect(result).toEqual([stageHook]);
  });

  test("returns strategy hooks when stage has none", () => {
    const result = mergeStageAndStrategyHooks([], [strategyHook]);
    expect(result).toEqual([strategyHook]);
  });

  test("merges and sorts by order", () => {
    const result = mergeStageAndStrategyHooks([stageHook], [strategyHook]);
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe("stage-pre"); // order 5
    expect(result[1].id).toBe("strategy-pre"); // order 10
  });

  test("deduplicates by id — stage wins", () => {
    const conflicting: LifecycleHook = {
      ...strategyHook,
      id: "stage-pre", // same id as stageHook
      agent: "should-lose",
    };
    const result = mergeStageAndStrategyHooks([stageHook], [conflicting]);
    expect(result).toHaveLength(1);
    expect(result[0].agent).toBe("stage-reviewer");
  });

  test("preserves hooks from both sources when no id conflicts", () => {
    const stagePost: LifecycleHook = {
      id: "stage-post",
      trigger: "post-execution",
      enabled: true,
      agent: "post-agent",
      promptTemplate: "",
      timeoutMs: 30000,
      order: 20,
    };
    const result = mergeStageAndStrategyHooks([stageHook, stagePost], [strategyHook]);
    expect(result).toHaveLength(3);
    // order: 5, 10, 20
    expect(result.map((h) => h.id)).toEqual(["stage-pre", "strategy-pre", "stage-post"]);
  });
});
