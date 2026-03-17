import { describe, expect, it } from "vitest";
import { getSettingsSectionElementId, resolveSettingsDeepLink } from "./settings-deep-link";

describe("resolveSettingsDeepLink", () => {
  it("resolves copilot provider auth target", () => {
    const result = resolveSettingsDeepLink({
      tab: "models",
      section: "copilot-provider",
      provider: "github-copilot",
      authenticatedCopilotProviders: ["github-copilot"],
    });

    expect(result.activeTab).toBe("models");
    expect(result.ensureCopilotProvider).toBe("github-copilot");
    expect(result.expandCopilotProvider).toBe("github-copilot");
    expect(result.openProviderModal).toBe(false);
    expect(result.targetId).toBe("settings-models-copilot-github-copilot");
  });

  it("opens add-provider flow for provider-add section", () => {
    const result = resolveSettingsDeepLink({
      tab: "models",
      section: "provider-add",
      provider: "qwen-local",
    });

    expect(result.openProviderModal).toBe(true);
    expect(result.providerDraft).toEqual({ key: "qwen-local" });
    expect(result.targetId).toBe("settings-models-provider-add");
  });

  it("falls back to add-provider when provider row is absent", () => {
    const result = resolveSettingsDeepLink({
      tab: "models",
      section: "provider-row",
      provider: "qwen-local",
      providerKeys: ["github-copilot"],
    });

    expect(result.openProviderModal).toBe(true);
    expect(result.providerDraft).toEqual({ key: "qwen-local" });
    expect(result.targetId).toBe("settings-models-provider-add");
  });

  it("targets concrete provider row when provider exists", () => {
    const result = resolveSettingsDeepLink({
      tab: "models",
      section: "provider-row",
      provider: "qwen-local",
      providerKeys: ["qwen-local", "github-copilot"],
    });

    expect(result.openProviderModal).toBe(false);
    expect(result.providerDraft).toBeUndefined();
    expect(result.targetId).toBe("settings-models-provider-row-qwen-local");
  });

  it("prefills github-copilot api for copilot providers", () => {
    const result = resolveSettingsDeepLink({
      tab: "models",
      section: "provider-add",
      provider: "github-copilot-2",
    });

    expect(result.providerDraft).toEqual({ key: "github-copilot-2", api: "github-copilot" });
  });

  it("ignores invalid query values", () => {
    const result = resolveSettingsDeepLink({
      tab: "orchestration",
      section: "unknown",
      provider: "qwen-local",
    });

    expect(result.activeTab).toBeUndefined();
    expect(result.section).toBeUndefined();
    expect(result.openProviderModal).toBe(false);
    expect(result.targetId).toBe("");
  });
});

describe("getSettingsSectionElementId", () => {
  it("falls back to add button when provider row is missing", () => {
    expect(
      getSettingsSectionElementId("provider-row", {
        provider: "qwen-local",
        providerKeys: ["github-copilot"],
      }),
    ).toBe("settings-models-provider-add");
  });
});
