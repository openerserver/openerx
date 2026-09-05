export interface DesktopWindowCandidate {
  name: string;
}

export interface DesktopWindowIdentityCandidate extends DesktopWindowCandidate {
  id: string;
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
  const named = candidates.map((candidate) => ({
    candidate,
    name: candidate.name.trim().toLocaleLowerCase(),
  }));
  const exact = named.filter(({ name }) => name === requested);
  if (exact.length === 1) return exact[0]?.candidate ?? null;
  if (exact.length > 1) return null;
  const partial = named.filter(({ name }) => Boolean(name) && name.includes(requested));
  return partial.length === 1 ? (partial[0]?.candidate ?? null) : null;
}

export function selectDesktopWindowByNativeId<T extends DesktopWindowIdentityCandidate>(
  candidates: readonly T[],
  nativeWindowId: number,
): T | null {
  const matches = candidates.filter(({ id }) => {
    const match = /^window:(\d+):/u.exec(id);
    return match?.[1] !== undefined && Number(match[1]) === nativeWindowId;
  });
  return matches.length === 1 ? (matches[0] ?? null) : null;
}
