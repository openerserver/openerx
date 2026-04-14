/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test";
import {
  normalizePersistedConfiguredModelValue,
  sanitizeProjectSettingsDefaultModel,
} from "../../control-plane/service/src/db/migration/configured-model-route-cleanup";

const allowKnownRoutes = (raw: string | null | undefined) =>
  raw === "github-copilot:gpt-5.4" || raw === "qwen-local:qwen/qwen3.5-35b-a3b";

describe("configured model route cleanup", () => {
  test("clears persisted invalid configured model selections", () => {
    expect(
      normalizePersistedConfiguredModelValue(
        "anthropic/claude-sonnet-4-20250514",
        allowKnownRoutes,
      ),
    ).toEqual({
      previousValue: "anthropic/claude-sonnet-4-20250514",
      nextValue: null,
      changed: true,
      changeKind: "cleared",
    });
  });

  test("normalizes valid configured model selections by trimming whitespace", () => {
    expect(
      normalizePersistedConfiguredModelValue(" github-copilot:gpt-5.4 ", allowKnownRoutes),
    ).toEqual({
      previousValue: " github-copilot:gpt-5.4 ",
      nextValue: "github-copilot:gpt-5.4",
      changed: true,
      changeKind: "normalized",
    });
  });

  test("removes invalid project defaultModel while preserving unrelated settings", () => {
    const result = sanitizeProjectSettingsDefaultModel(
      {
        defaultModel: "anthropic/claude-sonnet-4-20250514",
        projectGroupKey: "core-platform",
        maxConcurrency: 6,
      },
      allowKnownRoutes,
    );

    expect(result.modelCleanup).toEqual({
      previousValue: "anthropic/claude-sonnet-4-20250514",
      nextValue: null,
      changed: true,
      changeKind: "cleared",
    });
    expect(result.nextSettings).toEqual({
      projectGroupKey: "core-platform",
      maxConcurrency: 6,
    });
  });

  test("keeps project settings unchanged when defaultModel is already valid", () => {
    const settings = {
      defaultModel: "qwen-local:qwen/qwen3.5-35b-a3b",
      projectGroupLabel: "核心平台",
    };

    const result = sanitizeProjectSettingsDefaultModel(settings, allowKnownRoutes);

    expect(result.modelCleanup).toEqual({
      previousValue: "qwen-local:qwen/qwen3.5-35b-a3b",
      nextValue: "qwen-local:qwen/qwen3.5-35b-a3b",
      changed: false,
      changeKind: "unchanged",
    });
    expect(result.nextSettings).toEqual(settings);
  });
});