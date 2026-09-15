export function resolveMacSigningIdentity(
  env?: Record<string, string | undefined>,
  lookup?: () => { status: number | null; stdout?: string; error?: unknown },
): string | null;
