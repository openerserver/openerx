import { describe, expect, it } from "vitest";
import { RUNTIME_RECOVERY_ERROR_CODES } from "./runtime-recovery-contract";
import { buildRuntimeRecoverySettingsTarget } from "./runtime-recovery-link";
import {
  SETTINGS_SECTIONS,
  SETTINGS_TAB_MODELS,
  resolveSettingsDeepLink,
} from "./settings-deep-link";

describe("buildRuntimeRecoverySettingsTarget", () => {
  it("routes copilot auth failures to the copilot provider card", () => {
    const target = buildRuntimeRecoverySettingsTarget({
      code: RUNTIME_RECOVERY_ERROR_CODES.providerAuthRequired,
      diagnostics: {
        providerId: "github-copilot",
        modelId: "gpt-5.4",
      },
    });

    expect(target).toEqual({
      path: "/settings",
      query: {
        tab: SETTINGS_TAB_MODELS,
        section: SETTINGS_SECTIONS.copilotProvider,
        provider: "github-copilot",
      },
    });
  });

  it("routes missing providers to add-provider flow", () => {
    const target = buildRuntimeRecoverySettingsTarget({
      code: RUNTIME_RECOVERY_ERROR_CODES.providerNotConfigured,
      diagnostics: {
        providerId: "qwen-local",
      },
    });

    expect(target.query.section).toBe(SETTINGS_SECTIONS.providerAdd);
    expect(target.query.provider).toBe("qwen-local");
  });

  it("routes runtime-unreachable providers to add-provider flow", () => {
    const target = buildRuntimeRecoverySettingsTarget({
      code: RUNTIME_RECOVERY_ERROR_CODES.providerUnreachable,
      diagnostics: {
        providerId: "qwen-local",
        source: "runtime",
      },
    });

    expect(target.query.section).toBe(SETTINGS_SECTIONS.providerAdd);
  });

  it("routes ui-configured unreachable providers to provider row", () => {
    const target = buildRuntimeRecoverySettingsTarget({
      code: RUNTIME_RECOVERY_ERROR_CODES.providerUnreachable,
      diagnostics: {
        providerId: "qwen-local",
        source: "ui",
      },
    });

    expect(target.query.section).toBe(SETTINGS_SECTIONS.providerRow);
  });

  it("falls back to provider list for other model errors", () => {
    const target = buildRuntimeRecoverySettingsTarget({
      code: "MODEL_SOMETHING_ELSE",
      diagnostics: {
        providerId: "qwen-local",
      },
    });

    expect(target.query.section).toBe(SETTINGS_SECTIONS.providers);
  });
});

describe("runtime recovery deep-link roundtrip", () => {
  it("closes the loop from auth error to settings parser", () => {
    const target = buildRuntimeRecoverySettingsTarget({
      code: RUNTIME_RECOVERY_ERROR_CODES.providerAuthRequired,
      diagnostics: {
        providerId: "github-copilot",
      },
    });

    const resolution = resolveSettingsDeepLink({
      ...target.query,
      authenticatedCopilotProviders: ["github-copilot"],
    });

    expect(resolution.activeTab).toBe(SETTINGS_TAB_MODELS);
    expect(resolution.ensureCopilotProvider).toBe("github-copilot");
    expect(resolution.expandCopilotProvider).toBe("github-copilot");
    expect(resolution.targetId).toBe("settings-models-copilot-github-copilot");
  });

  it("closes the loop from missing provider error to add-provider modal", () => {
    const target = buildRuntimeRecoverySettingsTarget({
      code: RUNTIME_RECOVERY_ERROR_CODES.providerNotConfigured,
      diagnostics: {
        providerId: "qwen-local",
      },
    });

    const resolution = resolveSettingsDeepLink({
      ...target.query,
      providerKeys: ["github-copilot"],
    });

    expect(resolution.activeTab).toBe(SETTINGS_TAB_MODELS);
    expect(resolution.openProviderModal).toBe(true);
    expect(resolution.providerDraft).toEqual({ key: "qwen-local" });
    expect(resolution.targetId).toBe("settings-models-provider-add");
  });

  it("closes the loop from unreachable provider error to existing provider row", () => {
    const target = buildRuntimeRecoverySettingsTarget({
      code: RUNTIME_RECOVERY_ERROR_CODES.providerUnreachable,
      diagnostics: {
        providerId: "qwen-local",
        source: "ui",
      },
    });

    const resolution = resolveSettingsDeepLink({
      ...target.query,
      providerKeys: ["qwen-local"],
    });

    expect(resolution.openProviderModal).toBe(false);
    expect(resolution.targetId).toBe("settings-models-provider-row-qwen-local");
  });
});
