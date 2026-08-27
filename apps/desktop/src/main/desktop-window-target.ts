export interface DesktopWindowCandidate {
  name: string;
}

export function desktopWindowCaptureOptions(): {
  types: Array<"window">;
  thumbnailSize: { width: number; height: number };
  fetchWindowIcons: boolean;
} {
  return {
    types: ["window"],
    thumbnailSize: { width: 2_048, height: 2_048 },
    fetchWindowIcons: false,
  };
}

export function selectDesktopWindow<T extends DesktopWindowCandidate>(
  candidates: readonly T[],
  application: string,
): T | null {
  const requested = application.trim().toLocaleLowerCase();
  if (!requested) return null;
  return (
    candidates.find((candidate) => {
      const name = candidate.name.trim().toLocaleLowerCase();
      return Boolean(name) && (name === requested || name.includes(requested));
    }) ?? null
  );
}
