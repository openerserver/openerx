export function requiresHelperSigning(env?: Record<string, string | undefined>): boolean;
export function finalizeHelperArtifact(
  directory: string,
  architecture: string,
  sign?: (file: string) => void,
): {
  contractVersion: "desktop_control_v2";
  architecture: string;
  sha256: string;
};
