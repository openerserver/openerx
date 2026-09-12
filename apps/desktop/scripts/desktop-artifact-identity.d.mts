export type ArtifactIdentity = {
  productName: string;
  executableName: string;
  appBundleId: string;
  version: string;
  manifest: string | null;
  brand: Record<string, unknown>;
};
export function desktopArtifactIdentity(desktop: string, env?: NodeJS.ProcessEnv): ArtifactIdentity;
export function desktopStoreInputs(
  desktop: string,
  env?: NodeJS.ProcessEnv,
): ArtifactIdentity & {
  configurationFile: string;
  configuration: Record<string, unknown>;
  logoFile: string;
};
