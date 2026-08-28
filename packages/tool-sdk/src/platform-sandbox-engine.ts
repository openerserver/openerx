import type { BrokeredBashExecutionProfile, WorkspaceGrant } from "@openerx/contracts";

export const PLATFORM_SANDBOX_ENGINE_VERSION = "platform-sandbox-v1" as const;
export const PLATFORM_SANDBOX_DEFAULT_MAX_OUTPUT_BYTES = 2_000_000;
export const PLATFORM_SANDBOX_DEFAULT_MAX_PROCESSES = 256;
export const PLATFORM_SANDBOX_DEFAULT_MAX_OPEN_FILES = 1_024;
export const PLATFORM_SANDBOX_DEFAULT_MAX_FILE_BLOCKS = 2_097_152;

export type PlatformSandboxDestructionStatus = "clean" | "terminated" | "killed" | "uncertain";

export interface PlatformSandboxCapabilities {
  filesystemBoundary: boolean;
  hardlinkBoundary: boolean;
  readOnlyRoots: boolean;
  writableRoots: boolean;
  networkDeny: boolean;
  sanitizedEnvironment: boolean;
  processGroupCleanup: boolean;
  descendantSandboxInheritance: boolean;
  pty: boolean;
}

export interface PlatformSandboxCapability {
  available: boolean;
  reason: string | null;
  engineVersion: typeof PLATFORM_SANDBOX_ENGINE_VERSION;
  backendId: string;
  backendVersion: string;
  policyVersion: string;
  platform: NodeJS.Platform;
  platformRelease: string;
  supportedProfiles: BrokeredBashExecutionProfile[];
  environmentPolicyIds: string[];
  networkPolicyIds: string[];
  capabilities: PlatformSandboxCapabilities;
}

export interface PlatformSandboxRoot {
  grantId: WorkspaceGrant["id"];
  logicalName: string;
  rootPath: string;
  access: WorkspaceGrant["access"];
}

export interface PlatformSandboxResourceLimits {
  maxOutputBytes: number;
  maxProcesses: number;
  maxOpenFiles: number;
  maxFileBlocks: number;
}

export interface PlatformSandboxExecutionRequest {
  identity: {
    generationId: string;
    toolCallId: string;
    piToolCallId: string;
  };
  shell: "bash";
  command: string;
  timeoutMs: number;
  executionProfile: BrokeredBashExecutionProfile;
  environmentPolicyId: string;
  networkPolicyId: string;
  activeRoot: PlatformSandboxRoot;
  additionalRoots: PlatformSandboxRoot[];
  resourceLimits: PlatformSandboxResourceLimits;
  signal: AbortSignal;
  onOutput?(frame: PlatformSandboxOutputFrame): void;
}

export interface PlatformSandboxOutputFrame {
  sequence: number;
  delta: string;
  truncated: boolean;
}

export interface PlatformSandboxProof {
  engineVersion: typeof PLATFORM_SANDBOX_ENGINE_VERSION;
  backendId: string;
  backendVersion: string;
  policyVersion: string;
  platform: NodeJS.Platform;
  platformRelease: string;
  executionProfile: BrokeredBashExecutionProfile;
  environmentPolicyId: string;
  networkPolicyId: string;
  filesystemBoundary: true;
  hardlinkBoundary: true;
  environmentSanitized: true;
  networkDenied: true;
  processGroupOwned: true;
}

export interface PlatformSandboxExecutionResult {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  output: string;
  outputTruncated: boolean;
  timedOut: boolean;
  cancelled: boolean;
  durationMs: number;
  destructionStatus: PlatformSandboxDestructionStatus;
  changedPathManifestStatus: "not_collected";
  proof: PlatformSandboxProof;
}

export interface PlatformSandboxEngine {
  readonly engineVersion: typeof PLATFORM_SANDBOX_ENGINE_VERSION;
  readonly backendId: string;
  readonly policyVersion: string;
  probe(): Promise<PlatformSandboxCapability>;
  execute(request: PlatformSandboxExecutionRequest): Promise<PlatformSandboxExecutionResult>;
  stopAll(): Promise<void>;
}

export function defaultPlatformSandboxResourceLimits(): PlatformSandboxResourceLimits {
  return {
    maxOutputBytes: PLATFORM_SANDBOX_DEFAULT_MAX_OUTPUT_BYTES,
    maxProcesses: PLATFORM_SANDBOX_DEFAULT_MAX_PROCESSES,
    maxOpenFiles: PLATFORM_SANDBOX_DEFAULT_MAX_OPEN_FILES,
    maxFileBlocks: PLATFORM_SANDBOX_DEFAULT_MAX_FILE_BLOCKS,
  };
}
