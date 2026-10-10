export const runtimeLock: {
  schemaVersion: number;
  nodeVersion: string;
  npmVersion: string;
  source: string;
  artifacts: Record<string, { file: string; sha256: string }>;
};
export function runtimeDevelopmentDirectory(platform?: string, architecture?: string): string;
export function verifyPreparedNodeRuntime(
  directory: string,
  platform?: string,
  architecture?: string,
  suppliedManifest?: unknown,
): {
  nodeVersion: string;
  npmVersion: string;
  files: Array<{ path: string; size: number; sha256: string }>;
};
export function prepareNodeRuntime(options?: {
  platform?: string;
  architecture?: string;
  offline?: boolean;
}): Promise<string>;
export function copyNodeRuntime(
  buildPath: string,
  platform: string,
  architecture: string,
  signExecutable?: (file: string) => void,
): Promise<string>;
