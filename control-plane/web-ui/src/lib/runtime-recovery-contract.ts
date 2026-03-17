export const RUNTIME_RECOVERY_ERROR_CODES = {
  providerAuthRequired: "MODEL_PROVIDER_AUTH_REQUIRED",
  providerUnreachable: "MODEL_PROVIDER_UNREACHABLE",
  providerNotConfigured: "MODEL_PROVIDER_NOT_CONFIGURED",
} as const;

export const RUNTIME_RECOVERY_ERROR_PREFIX = "MODEL_";

export type RuntimeRecoveryErrorCode =
  (typeof RUNTIME_RECOVERY_ERROR_CODES)[keyof typeof RUNTIME_RECOVERY_ERROR_CODES];

export const RUNTIME_RECOVERY_SUGGESTION_IDS = {
  copilotLoginSettings: "copilot-login-settings",
  copilotLoginRuntime: "copilot-login-runtime",
  verifyProviderService: "verify-provider-service",
  verifyProviderConfig: "verify-provider-config",
  addMissingProvider: "add-missing-provider",
  switchToConfiguredModel: "switch-to-configured-model",
} as const;

export type RuntimeRecoverySuggestionId =
  (typeof RUNTIME_RECOVERY_SUGGESTION_IDS)[keyof typeof RUNTIME_RECOVERY_SUGGESTION_IDS];
