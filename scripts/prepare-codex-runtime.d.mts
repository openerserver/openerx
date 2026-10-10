export const managedCodexRuntimeCacheKey: string;
export function codexRuntimeDevelopmentDirectory(platform?: string, architecture?: string): string;
export function verifyPreparedCodexRuntime(
  directory: string,
  platform?: string,
  architecture?: string,
  suppliedManifest?: unknown,
): {
  schemaVersion: number;
  codexVersion: string;
  platform: string;
  architecture: string;
  archive: string;
  archiveIntegrity: string;
  archiveSha256: string;
  executable: string;
  files: Array<{ path: string; size: number; sha256: string }>;
};
export function prepareCodexRuntime(options?: {
  platform?: string;
  architecture?: string;
  offline?: boolean;
}): Promise<string>;
export function copyCodexRuntime(
  buildPath: string,
  platform: string,
  architecture: string,
): Promise<string | undefined>;
