export const RECOVERY_SUGGESTION_KINDS = {
  auth: "auth",
  check: "check",
  config: "config",
  command: "command",
} as const;

export type RecoverySuggestionKind =
  (typeof RECOVERY_SUGGESTION_KINDS)[keyof typeof RECOVERY_SUGGESTION_KINDS];

export type RecoverySuggestion = {
  id: string;
  kind: RecoverySuggestionKind;
  title: string;
  detail?: string;
  command?: string;
};

type RecoverySuggestionInput = RecoverySuggestion | string;

export function normalizeRecoverySuggestion(
  value: RecoverySuggestionInput,
  index = 0,
): RecoverySuggestion {
  if (typeof value === "string") {
    return {
      id: `legacy-${index}`,
      kind: RECOVERY_SUGGESTION_KINDS.check,
      title: value,
    };
  }

  return {
    id: value.id,
    kind: value.kind,
    title: value.title,
    ...(value.detail ? { detail: value.detail } : {}),
    ...(value.command ? { command: value.command } : {}),
  };
}

export function normalizeRecoverySuggestions(
  values: Array<RecoverySuggestionInput> | undefined,
): RecoverySuggestion[] {
  if (!Array.isArray(values)) {
    return [];
  }

  return values
    .filter((value) => {
      if (typeof value === "string") {
        return Boolean(value.trim());
      }
      return Boolean(value && typeof value.id === "string" && typeof value.title === "string");
    })
    .map((value, index) => normalizeRecoverySuggestion(value, index));
}