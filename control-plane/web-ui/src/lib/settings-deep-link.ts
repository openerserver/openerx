export const SETTINGS_TABS = [
  "account",
  "models",
  "agents",
  "skills",
  "mcp",
  "commands",
  "security",
  "plugins",
  "strategy",
  "policy",
  "maintenance",
] as const;

export type SettingsTab = (typeof SETTINGS_TABS)[number];

export const SETTINGS_TAB_MODELS: SettingsTab = "models";

export type SettingsSection =
  | "copilot-accounts"
  | "copilot-provider"
  | "provider-add"
  | "provider-row"
  | "providers"
  | "models"
  | "default-model";

export const SETTINGS_SECTIONS = {
  copilotAccounts: "copilot-accounts",
  copilotProvider: "copilot-provider",
  providerAdd: "provider-add",
  providerRow: "provider-row",
  providers: "providers",
  models: "models",
  defaultModel: "default-model",
} as const satisfies Record<string, SettingsSection>;

export type SettingsRouteTarget = {
  path: "/settings";
  query: {
    tab: SettingsTab;
    section: SettingsSection;
    provider?: string;
  };
};

export type SettingsDeepLinkInput = {
  tab?: unknown;
  section?: unknown;
  provider?: unknown;
  providerKeys?: string[];
  authenticatedCopilotProviders?: string[];
};

export type SettingsDeepLinkResolution = {
  activeTab?: SettingsTab;
  section?: SettingsSection;
  provider?: string;
  ensureCopilotProvider?: string;
  expandCopilotProvider?: string;
  openProviderModal: boolean;
  providerDraft?: {
    key: string;
    api?: "github-copilot";
  };
  targetId: string;
};

function toStringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value : undefined;
}

export function isSettingsTab(value: unknown): value is SettingsTab {
  return typeof value === "string" && SETTINGS_TABS.includes(value as SettingsTab);
}

function isSettingsSection(value: unknown): value is SettingsSection {
  return (
    value === "copilot-accounts" ||
    value === "copilot-provider" ||
    value === "provider-add" ||
    value === "provider-row" ||
    value === "providers" ||
    value === "models" ||
    value === "default-model"
  );
}

export function getSettingsSectionElementId(
  section: SettingsSection | undefined,
  options?: { provider?: string; providerKeys?: string[] },
) {
  const provider = options?.provider;
  const providerKeys = options?.providerKeys || [];

  if (!section) return "";
  if (section === "copilot-accounts") return "settings-models-copilot-accounts";
  if (section === "copilot-provider" && provider) return `settings-models-copilot-${provider}`;
  if (section === "provider-add") return "settings-models-provider-add";
  if (section === "provider-row" && provider) {
    return providerKeys.includes(provider)
      ? `settings-models-provider-row-${provider}`
      : "settings-models-provider-add";
  }
  if (section === "providers") return "settings-models-providers";
  if (section === "models") return "settings-models-list";
  if (section === "default-model") return "settings-models-default";
  return "";
}

function shouldOpenSettingsProviderModal(
  section: SettingsSection | undefined,
  provider: string | undefined,
  providerKeys: string[],
) {
  if (section === "provider-add") {
    return true;
  }

  if (section !== "provider-row" || !provider) {
    return false;
  }

  return !providerKeys.includes(provider);
}

function resolveProviderDraft(shouldOpenProviderModal: boolean, provider: string | undefined) {
  if (!shouldOpenProviderModal || !provider) {
    return undefined;
  }

  return {
    key: provider,
    ...(provider.startsWith("github-copilot") ? { api: "github-copilot" as const } : {}),
  };
}

function resolveCopilotExpansion(
  section: SettingsSection | undefined,
  provider: string | undefined,
  authenticatedCopilotProviders: string[],
) {
  if (section !== "copilot-provider" || !provider) {
    return undefined;
  }

  return authenticatedCopilotProviders.includes(provider) ? provider : undefined;
}

export function resolveSettingsDeepLink(input: SettingsDeepLinkInput): SettingsDeepLinkResolution {
  const activeTab = isSettingsTab(input.tab) ? input.tab : undefined;
  const section = isSettingsSection(input.section) ? input.section : undefined;
  const provider = toStringValue(input.provider);
  const providerKeys = input.providerKeys || [];
  const authenticatedCopilotProviders = input.authenticatedCopilotProviders || [];
  const shouldOpenProviderModal = shouldOpenSettingsProviderModal(section, provider, providerKeys);

  return {
    activeTab,
    section,
    provider,
    ensureCopilotProvider: section === "copilot-provider" && provider ? provider : undefined,
    expandCopilotProvider: resolveCopilotExpansion(
      section,
      provider,
      authenticatedCopilotProviders,
    ),
    openProviderModal: shouldOpenProviderModal,
    providerDraft: resolveProviderDraft(shouldOpenProviderModal, provider),
    targetId: getSettingsSectionElementId(section, { provider, providerKeys }),
  };
}
