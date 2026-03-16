const ALLOWED_MODEL_MARKERS = ["claude-sonnet-4", "claude-opus-4", "gpt-4o", "o3-mini", "gemini-2.5-pro"];

export function isAllowedChatSettingsModel(route: string | undefined | null): boolean {
  if (!route) {
    return false;
  }

  const normalized = route.trim().toLowerCase();
  return ALLOWED_MODEL_MARKERS.some((marker) => normalized.includes(marker));
}

export function assertAllowedChatSettingsModel(route: string | undefined | null): string | null {
  if (isAllowedChatSettingsModel(route)) {
    return null;
  }

  return "Chat Settings 仅允许使用 Claude Sonnet 4 / Claude Opus 4 / GPT-4o / o3-mini / Gemini 2.5 Pro 级别模型。";
}