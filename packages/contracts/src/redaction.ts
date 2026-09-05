const sensitivePatterns: readonly RegExp[] = [
  /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi,
  /\bsk-[A-Za-z0-9_-]{12,}\b/g,
  /\b(?:access[_ -]?token|refresh[_ -]?credential|api[_ -]?key|password|authorization)\s*[:=]\s*["']?[^\s,"']+/gi,
];

export function redactSensitiveText(value: string): string {
  const redacted = sensitivePatterns.reduce((current, pattern) => {
    pattern.lastIndex = 0;
    return current.replace(pattern, "[REDACTED]");
  }, value);
  return redacted.replace(
    /([?&](?:access_token|refresh_token|api_key|key)=)[^&#\s]+/gi,
    "$1[REDACTED]",
  );
}

export function safeErrorMessage(error: unknown, fallback: string): string {
  return redactSensitiveText(error instanceof Error ? error.message : fallback);
}
