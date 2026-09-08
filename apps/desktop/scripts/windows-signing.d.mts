export type SigningRunner = (
  command: string,
  args: string[],
  options: import("node:child_process").SpawnSyncOptionsWithStringEncoding,
) => { status: number | null; error?: Error };
export function signToolPath(env?: Record<string, string | undefined>): string;
export function verifyWindowsFile(
  file: string,
  env?: Record<string, string | undefined>,
  runner?: SigningRunner,
  requireTimestamp?: boolean,
): void;
export function signWindowsFile(
  file: string,
  env?: Record<string, string | undefined>,
  runner?: SigningRunner,
): void;
