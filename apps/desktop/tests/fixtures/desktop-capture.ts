export function desktopFixtureTitle(prompt: string): string | null {
  try {
    const title: unknown = JSON.parse(prompt.split("WINDOW_TITLE=")[1] ?? "null");
    return typeof title === "string" && /^openerx E2E [A-Za-z0-9_-]+$/u.test(title) ? title : null;
  } catch {
    return null;
  }
}

export function matchesDesktopFixtureCapture(message: unknown, expectedTitle: string): boolean {
  if (!message || typeof message !== "object") return false;
  const result = message as Record<string, unknown>;
  const details = result.details as { data?: Record<string, unknown> } | undefined;
  const data = details?.data;
  return (
    result.isError !== true &&
    data?.capturedWindow === expectedTitle &&
    typeof data.width === "number" &&
    Number.isFinite(data.width) &&
    data.width > 0 &&
    typeof data.height === "number" &&
    Number.isFinite(data.height) &&
    data.height > 0 &&
    Array.isArray(result.content) &&
    result.content.some(
      (part) => part?.type === "image" && typeof part.data === "string" && part.data.length > 0,
    )
  );
}
