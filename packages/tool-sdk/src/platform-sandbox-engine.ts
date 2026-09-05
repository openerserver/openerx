import type {
  BrokeredBashExecutionProfile,
  BrokeredBashWorkspaceWriteMode,
  WorkspaceGrant,
} from "@openerx/contracts";
import type { BrokeredBashNetworkPolicy } from "./brokered-bash-egress";
import type { BrokeredBashEnvironmentPolicy } from "./brokered-bash-environment";

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
  workspaceWriteMode: BrokeredBashWorkspaceWriteMode;
  environmentPolicyId: string;
  environmentPolicyDigest?: string;
  environmentPolicy?: BrokeredBashEnvironmentPolicy;
  networkPolicyId: string;
  networkPolicyDigest?: string;
  networkPolicy?: BrokeredBashNetworkPolicy;
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
  environmentDigest: string;
  networkPolicyId: string;
  networkPolicyDigest: string;
  controlledEgress: boolean;
  filesystemBoundary: true;
  hardlinkBoundary: true;
  environmentSanitized: true;
  networkDenied: true;
  processGroupOwned: true;
}

export type PlatformSandboxWorkspaceChangeKind = "created" | "modified" | "deleted" | "renamed";

export interface PlatformSandboxWorkspaceChangeEntry {
  workspaceGrantId: WorkspaceGrant["id"];
  workspaceLogicalName: string;
  relativePath: string;
  previousRelativePath: string | null;
  kind: PlatformSandboxWorkspaceChangeKind;
  entryType: "file" | "directory" | "symlink" | "other";
  beforeBytes: number | null;
  afterBytes: number | null;
  diffStatus: "available" | "binary" | "too_large" | "not_applicable";
}

export interface PlatformSandboxWorkspaceDiff {
  workspaceChangeId: string;
  workspaceGrantId: WorkspaceGrant["id"];
  relativePath: string;
  patch: string;
}

export interface PlatformSandboxWorkspaceMaterializationEntry {
  workspaceGrantId: WorkspaceGrant["id"];
  workspaceLogicalName: string;
  relativePath: string;
  previousRelativePath: string | null;
  kind: PlatformSandboxWorkspaceChangeKind;
  entryType: PlatformSandboxWorkspaceChangeEntry["entryType"];
  beforeSha256: string | null;
  afterSha256: string | null;
  beforeText: string | null;
  afterText: string | null;
  applySupported: boolean;
}

export interface PlatformSandboxWorkspaceChanges {
  mode: "DIRECT_WORKSPACE_WRITE" | "ISOLATED_CHANGE_SET";
  hostWorkspaceMutated: boolean;
  baselineRevision: string;
  finalRevision: string;
  baselineGitStatus: "clean" | "dirty" | "not_repository" | "unavailable";
  finalGitStatus: "clean" | "dirty" | "not_repository" | "unavailable";
  conflictStatus: "none" | "preexisting_dirty_overlap" | "git_status_unavailable";
  attribution: "workspace_delta_during_execution";
  undo: "NOT_AVAILABLE_FOR_DIRECT_WRITE" | "REVIEW_REQUIRED_BEFORE_APPLY";
  manifest: PlatformSandboxWorkspaceChangeEntry[];
  diffs: PlatformSandboxWorkspaceDiff[];
  materialization: PlatformSandboxWorkspaceMaterializationEntry[];
  excludedPathCount: number;
  manifestTruncated: boolean;
  diffTruncated: boolean;
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
  changedPathManifestStatus: "not_collected" | "not_applicable" | "collected";
  workspaceChanges: PlatformSandboxWorkspaceChanges | null;
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
