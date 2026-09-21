export interface BuildInfo {
  version: string;
  builtAt: string;
  revision: string;
  dirty: boolean;
  buildId: string;
  nativeBuildNumber: string;
  androidVersionCode: number;
}
export function createBuildInfo(root: string, now?: Date): BuildInfo;
export function getBuildInfo(root: string): Readonly<BuildInfo>;
