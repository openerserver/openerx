export interface MsixConfiguration {
  name: string;
  publisher: string;
  publisherDisplayName: string;
  displayName: string;
  version: string;
  description?: string;
  executable?: string;
  minVersion?: string;
  maxVersionTested?: string;
}
export interface MsixBuildOptions {
  configuration: MsixConfiguration;
  packageDirectory: string;
  outputDirectory: string;
  makeappx?: string;
  logoFile?: string;
}
export function validateMsixConfiguration(input: unknown): Required<MsixConfiguration>;
export function createMsixManifest(configuration: MsixConfiguration): string;
export function assertMsixPaths(
  packageDirectory: string,
  outputDirectory: string,
): { source: string; output: string };
export function sha256File(file: string): string;
export function createMsixAssets(logoFile: string, assetsDirectory: string): void;
export function findMakeAppx(explicit?: string, env?: Record<string, string | undefined>): string;
export function buildWindowsMsix(
  options: MsixBuildOptions,
  run?: (file: string, args: string[], options: object) => unknown,
): {
  artifact: string;
  bytes: number;
  sha256: string;
  runtimeValidation: "not-performed";
  payload: { path: string; sha256: string }[];
};
