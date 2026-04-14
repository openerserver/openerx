import type { ProjectSettings } from "../schema";
import { isConfiguredModelRoute } from "../../lib/configured-model-routes";

type ModelRouteValidator = (raw: string | null | undefined) => boolean;

export type PersistedConfiguredModelCleanup = {
  previousValue: string | null;
  nextValue: string | null;
  changed: boolean;
  changeKind: "unchanged" | "cleared" | "normalized";
};

function asNullableTrimmedString(value: string | null | undefined) {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function normalizePersistedConfiguredModelValue(
  raw: string | null | undefined,
  validateModelRoute: ModelRouteValidator = isConfiguredModelRoute,
): PersistedConfiguredModelCleanup {
  const previousValue = typeof raw === "string" ? raw : null;
  const trimmedValue = asNullableTrimmedString(raw);

  if (!trimmedValue) {
    return {
      previousValue,
      nextValue: null,
      changed: previousValue !== null,
      changeKind: previousValue !== null ? "cleared" : "unchanged",
    };
  }

  if (!validateModelRoute(trimmedValue)) {
    return {
      previousValue,
      nextValue: null,
      changed: true,
      changeKind: "cleared",
    };
  }

  return {
    previousValue,
    nextValue: trimmedValue,
    changed: previousValue !== trimmedValue,
    changeKind: previousValue !== trimmedValue ? "normalized" : "unchanged",
  };
}

export function sanitizeProjectSettingsDefaultModel(
  settings: ProjectSettings | null | undefined,
  validateModelRoute: ModelRouteValidator = isConfiguredModelRoute,
) {
  if (!settings || typeof settings !== "object") {
    return {
      nextSettings: settings ?? null,
      modelCleanup: normalizePersistedConfiguredModelValue(null, validateModelRoute),
    };
  }

  if (!Object.prototype.hasOwnProperty.call(settings, "defaultModel")) {
    return {
      nextSettings: settings,
      modelCleanup: normalizePersistedConfiguredModelValue(null, validateModelRoute),
    };
  }

  const modelCleanup = normalizePersistedConfiguredModelValue(
    settings.defaultModel,
    validateModelRoute,
  );
  if (!modelCleanup.changed) {
    return {
      nextSettings: settings,
      modelCleanup,
    };
  }

  const nextSettings: ProjectSettings = { ...settings };
  if (modelCleanup.nextValue) {
    nextSettings.defaultModel = modelCleanup.nextValue;
  } else {
    delete nextSettings.defaultModel;
  }

  return {
    nextSettings,
    modelCleanup,
  };
}