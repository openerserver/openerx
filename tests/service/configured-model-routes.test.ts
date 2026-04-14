/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test";
import {
  isConfiguredModelRoute,
  validateConfiguredModelRoute,
} from "../../control-plane/service/src/lib/configured-model-routes";

describe("configured model routes", () => {
  test("accepts configured GitHub Copilot model ids", () => {
    expect(isConfiguredModelRoute("gpt-5-mini")).toBe(true);
    expect(validateConfiguredModelRoute("github-copilot:gpt-5.4", "任务模型")).toBeNull();
  });

  test("accepts provider-scoped models declared on the provider", () => {
    expect(isConfiguredModelRoute("qwen-local:qwen/qwen3.5-35b-a3b")).toBe(true);
  });

  test("rejects hidden provider routes that are not in the configured model set", () => {
    expect(isConfiguredModelRoute("anthropic/claude-sonnet-4-20250514")).toBe(false);
    expect(validateConfiguredModelRoute("anthropic/claude-sonnet-4-20250514", "项目默认模型")).toContain(
      "项目默认模型",
    );
  });
});