import type { ApiError } from "./api";
import { RUNTIME_RECOVERY_ERROR_CODES } from "./runtime-recovery-contract";
import {
  SETTINGS_SECTIONS,
  SETTINGS_TAB_MODELS,
  type SettingsRouteTarget,
} from "./settings-deep-link";

type RuntimeRecoveryLinkError = Pick<ApiError, "code" | "diagnostics">;

export function buildRuntimeRecoverySettingsTarget(
  error: RuntimeRecoveryLinkError,
): SettingsRouteTarget {
  const providerId =
    typeof error.diagnostics?.providerId === "string" ? error.diagnostics.providerId : undefined;
  const source =
    typeof error.diagnostics?.source === "string" ? error.diagnostics.source : undefined;
  const hasConfigMismatch = Boolean(error.diagnostics?.configMismatch);

  if (
    error.code === RUNTIME_RECOVERY_ERROR_CODES.providerAuthRequired &&
    providerId?.startsWith("github-copilot")
  ) {
    return {
      path: "/settings",
      query: {
        tab: SETTINGS_TAB_MODELS,
        section: SETTINGS_SECTIONS.copilotProvider,
        provider: providerId,
      },
    };
  }

  if (error.code === RUNTIME_RECOVERY_ERROR_CODES.providerNotConfigured) {
    return {
      path: "/settings",
      query: {
        tab: SETTINGS_TAB_MODELS,
        section: SETTINGS_SECTIONS.providerAdd,
        ...(providerId ? { provider: providerId } : {}),
      },
    };
  }

  if (error.code === RUNTIME_RECOVERY_ERROR_CODES.providerUnreachable) {
    return {
      path: "/settings",
      query: {
        tab: SETTINGS_TAB_MODELS,
        section:
          source === "runtime" && !hasConfigMismatch
            ? SETTINGS_SECTIONS.providerAdd
            : SETTINGS_SECTIONS.providerRow,
        ...(providerId ? { provider: providerId } : {}),
      },
    };
  }

  return {
    path: "/settings",
    query: {
      tab: SETTINGS_TAB_MODELS,
      section: SETTINGS_SECTIONS.providers,
      ...(providerId ? { provider: providerId } : {}),
    },
  };
}
