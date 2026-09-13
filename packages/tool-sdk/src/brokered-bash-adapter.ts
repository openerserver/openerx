import {
  BROKERED_BASH_CONTROLLED_EGRESS_NETWORK_POLICY_ID,
  BROKERED_BASH_DENY_NETWORK_POLICY_ID,
  type BrokeredBashExecutionContext,
  type NormalizedToolResult,
  type ToolOperation,
  type WorkspaceGrant,
} from "@openerx/contracts";
import {
  type BrokeredBashNetworkPolicy,
  brokeredBashNetworkPolicyDigest,
} from "./brokered-bash-egress";
import {
  BROKERED_BASH_CORE_ENVIRONMENT_POLICY,
  type BrokeredBashEnvironmentPolicy,
  brokeredBashEnvironmentPolicyDigest,
  brokeredBashEnvironmentPolicyId,
} from "./brokered-bash-environment";
import {
  defaultPlatformSandboxResourceLimits,
  type PlatformSandboxEngine,
  type PlatformSandboxExecutionResult,
} from "./platform-sandbox-engine";
import { type ToolAdapter, ToolAdapterError, type ToolExecutionContext } from "./types";

const MODEL_OUTPUT_LIMIT_BYTES = 50 * 1_024;
const MODEL_OUTPUT_LIMIT_LINES = 2_000;

type BrokeredBashOperation = Extract<ToolOperation, { operation: "shell_command_execute" }>;

function sameExecutionContext(
  operation: BrokeredBashOperation,
  expected: BrokeredBashExecutionContext,
): boolean {
  return (
    operation.contractVersion === expected.contractVersion &&
    operation.activeExecutionGrantId === expected.activeExecutionGrantId &&
    operation.additionalExecutionGrantIds.length === expected.additionalExecutionGrantIds.length &&
    operation.additionalExecutionGrantIds.every(
      (grantId, index) => grantId === expected.additionalExecutionGrantIds[index],
    ) &&
    operation.executionProfile === expected.executionProfile &&
    operation.executionOrigin === expected.executionOrigin &&
    operation.workspaceWriteMode === expected.workspaceWriteMode &&
    operation.environmentPolicyId === expected.environmentPolicyId &&
    operation.environmentPolicyDigest === expected.environmentPolicyDigest &&
    operation.networkPolicyId === expected.networkPolicyId &&
    operation.networkPolicyDigest === expected.networkPolicyDigest &&
    operation.sandboxPolicyVersion === expected.sandboxPolicyVersion
  );
}

function modelOutput(result: PlatformSandboxExecutionResult): {
  text: string;
  contextTruncated: boolean;
} {
  const withoutNul = result.output.replaceAll(String.fromCharCode(0), "�");
  const lines = withoutNul.split("\n");
  const lineBounded =
    lines.length > MODEL_OUTPUT_LIMIT_LINES
      ? lines.slice(-MODEL_OUTPUT_LIMIT_LINES).join("\n")
      : withoutNul;
  let byteCount = 0;
  const characters: string[] = [];
  for (const character of [...lineBounded].reverse()) {
    const characterBytes = Buffer.byteLength(character, "utf8");
    if (byteCount + characterBytes > MODEL_OUTPUT_LIMIT_BYTES) break;
    characters.push(character);
    byteCount += characterBytes;
  }
  const text = characters.reverse().join("");
  return {
    text,
    contextTruncated: text !== withoutNul,
  };
}

export interface BrokeredBashLogArtifactInput {
  displayName: string;
  content: string;
  truncated: boolean;
  generationId: string;
  toolCallId: string;
}

export type BrokeredBashLogArtifactWriter = (
  input: BrokeredBashLogArtifactInput,
) => Promise<string> | string;

export interface BrokeredBashWorkspaceChangeSetInput {
  directWrite?: boolean;
  workspaceGrantId: string;
  runId: string;
  toolCallId: string;
  baselineRevision: string;
  finalRevision: string;
  manifest: NonNullable<PlatformSandboxExecutionResult["workspaceChanges"]>["manifest"];
  diffs: NonNullable<PlatformSandboxExecutionResult["workspaceChanges"]>["diffs"];
  entries: NonNullable<PlatformSandboxExecutionResult["workspaceChanges"]>["materialization"];
  blocked: boolean;
}

export type BrokeredBashWorkspaceChangeSetWriter = (input: BrokeredBashWorkspaceChangeSetInput) => {
  id: string;
  status: string;
};

function normalizedResult(
  operation: BrokeredBashOperation,
  result: PlatformSandboxExecutionResult,
  activeGrant: WorkspaceGrant,
  additionalGrants: WorkspaceGrant[],
  logArtifactId: string | null,
  workspaceChangeSet: { id: string; status: string } | null,
): NormalizedToolResult {
  const output = modelOutput(result);
  const fallback =
    result.exitCode === 0 ? "Bash completed successfully." : "Bash did not complete.";
  const text = `${output.text || fallback}${
    workspaceChangeSet
      ? `\n\nWorkspace change set ${workspaceChangeSet.id} is ${workspaceChangeSet.status}; review it before applying.`
      : ""
  }`;
  const publicWorkspaceChanges = result.workspaceChanges
    ? Object.fromEntries(
        Object.entries(result.workspaceChanges).filter(([key]) => key !== "materialization"),
      )
    : null;
  return {
    summary: text.slice(-8_000),
    content: [
      { type: "text", text },
      ...(result.workspaceChanges?.diffs ?? []).map((diff) => ({
        type: "diff" as const,
        workspaceChangeId: diff.workspaceChangeId,
        relativePath: diff.relativePath,
        patch: diff.patch,
      })),
      ...(logArtifactId ? [{ type: "artifact" as const, artifactId: logArtifactId }] : []),
    ],
    data: {
      contractVersion: operation.contractVersion,
      executionPerformed: true,
      runner: "platform_sandbox",
      shell: operation.shell,
      timeoutMs: operation.timeoutMs,
      activeExecutionGrantId: activeGrant.id,
      additionalExecutionGrantIds: additionalGrants.map(({ id }) => id),
      executionProfile: operation.executionProfile,
      executionOrigin: operation.executionOrigin,
      workspaceWriteMode: operation.workspaceWriteMode,
      environmentPolicyId: operation.environmentPolicyId,
      networkPolicyId: operation.networkPolicyId,
      sandboxPolicyVersion: operation.sandboxPolicyVersion,
      exitCode: result.exitCode,
      signal: result.signal,
      timedOut: result.timedOut,
      cancelled: result.cancelled,
      outputTruncated: result.outputTruncated,
      contextTruncated: output.contextTruncated,
      logArtifactId,
      destructionStatus: result.destructionStatus,
      changedPathManifestStatus: result.changedPathManifestStatus,
      workspaceChanges: publicWorkspaceChanges,
      workspaceChangeSet,
      proof: result.proof,
    },
    sources: [],
    artifacts: logArtifactId ? [logArtifactId] : [],
    sideEffectCommitted: operation.executionProfile === "workspace_write",
    durationMs: result.durationMs,
  };
}

export class BrokeredBashAdapter implements ToolAdapter {
  readonly operations = ["shell_command_execute"] as const;

  constructor(
    private readonly resolveWorkspaceGrant: (
      workspaceGrantId: string,
      conversationId: string,
    ) => WorkspaceGrant,
    private readonly executionContext: (
      generationId: string,
    ) => BrokeredBashExecutionContext | undefined,
    private readonly engine: PlatformSandboxEngine,
    private readonly writeLogArtifact?: BrokeredBashLogArtifactWriter,
    private readonly writeWorkspaceChangeSet?: BrokeredBashWorkspaceChangeSetWriter,
    private readonly environmentPolicy: (
      generationId: string,
    ) => BrokeredBashEnvironmentPolicy | undefined = () => BROKERED_BASH_CORE_ENVIRONMENT_POLICY,
    private readonly networkPolicy: (
      generationId: string,
    ) => BrokeredBashNetworkPolicy | undefined = () => ({ mode: "deny" }),
  ) {}

  async execute(
    operation: ToolOperation,
    context: ToolExecutionContext,
  ): Promise<NormalizedToolResult> {
    if (operation.operation !== "shell_command_execute") {
      throw new Error("BROKERED_BASH_RUNNER_UNAVAILABLE");
    }
    const projection = context.projection;
    if (!projection) throw new Error("BROKERED_BASH_EXECUTION_CONTEXT_REQUIRED");
    const expected = this.executionContext(projection.generationId);
    if (!expected) throw new Error("BROKERED_BASH_EXECUTION_CONTEXT_REQUIRED");
    if (!sameExecutionContext(operation, expected)) {
      throw new Error("BROKERED_BASH_EXECUTION_CONTEXT_MISMATCH");
    }
    const environmentPolicy = this.environmentPolicy(projection.generationId);
    if (!environmentPolicy) throw new Error("BROKERED_BASH_EXECUTION_CONTEXT_REQUIRED");
    const environmentPolicyDigest = brokeredBashEnvironmentPolicyDigest(environmentPolicy);
    const networkPolicy = this.networkPolicy(projection.generationId);
    if (!networkPolicy) throw new Error("BROKERED_BASH_EXECUTION_CONTEXT_REQUIRED");
    const networkPolicyDigest = brokeredBashNetworkPolicyDigest(networkPolicy);
    const networkPolicyId =
      networkPolicy.mode === "deny"
        ? BROKERED_BASH_DENY_NETWORK_POLICY_ID
        : BROKERED_BASH_CONTROLLED_EGRESS_NETWORK_POLICY_ID;
    if (
      operation.environmentPolicyId !== brokeredBashEnvironmentPolicyId(environmentPolicy) ||
      operation.environmentPolicyDigest !== environmentPolicyDigest ||
      operation.networkPolicyId !== networkPolicyId ||
      operation.networkPolicyDigest !== networkPolicyDigest ||
      operation.sandboxPolicyVersion !== this.engine.policyVersion
    ) {
      throw new Error("BROKERED_BASH_POLICY_MISMATCH");
    }
    const capability = await this.engine.probe();
    if (
      !capability.available ||
      capability.policyVersion !== operation.sandboxPolicyVersion ||
      !capability.supportedProfiles.includes(operation.executionProfile) ||
      !capability.environmentPolicyIds.includes(operation.environmentPolicyId) ||
      !capability.networkPolicyIds.includes(operation.networkPolicyId)
    ) {
      throw new Error(capability.reason ?? "BROKERED_BASH_RUNNER_UNAVAILABLE");
    }
    let activeGrant: WorkspaceGrant;
    let additionalGrants: WorkspaceGrant[];
    try {
      activeGrant = this.resolveWorkspaceGrant(
        operation.activeExecutionGrantId,
        projection.conversationId,
      );
      additionalGrants = operation.additionalExecutionGrantIds.map((grantId) =>
        this.resolveWorkspaceGrant(grantId, projection.conversationId),
      );
    } catch {
      throw new Error("BROKERED_BASH_WORKSPACE_GRANT_INVALID");
    }
    if (operation.executionProfile === "workspace_write" && activeGrant.access !== "read_write") {
      throw new Error("BROKERED_BASH_EXECUTION_PROFILE_MISMATCH");
    }
    let acceptingProgress = true;
    let result: PlatformSandboxExecutionResult;
    try {
      result = await this.engine.execute({
        identity: {
          generationId: projection.generationId,
          toolCallId: context.toolCallId,
          piToolCallId: projection.piToolCallId,
        },
        shell: operation.shell,
        command: operation.command,
        timeoutMs: operation.timeoutMs,
        executionProfile: operation.executionProfile,
        workspaceWriteMode: operation.workspaceWriteMode,
        environmentPolicyId: operation.environmentPolicyId,
        environmentPolicyDigest,
        environmentPolicy,
        networkPolicyId: operation.networkPolicyId,
        networkPolicyDigest,
        networkPolicy,
        activeRoot: {
          grantId: activeGrant.id,
          logicalName: "workspace",
          rootPath: activeGrant.rootPath,
          access: activeGrant.access,
        },
        additionalRoots: additionalGrants.map((grant, index) => ({
          grantId: grant.id,
          logicalName: `workspace-${index + 1}`,
          rootPath: grant.rootPath,
          access: grant.access,
        })),
        resourceLimits: defaultPlatformSandboxResourceLimits(),
        signal: context.signal,
        onOutput: ({ delta, truncated }) => {
          if (acceptingProgress && !context.signal.aborted) context.update(delta, truncated);
        },
      });
    } finally {
      acceptingProgress = false;
    }
    const logArtifactId = this.writeLogArtifact
      ? await this.writeLogArtifact({
          displayName: `bash-${context.toolCallId}.log.txt`,
          content: result.output,
          truncated: result.outputTruncated,
          generationId: projection.generationId,
          toolCallId: context.toolCallId,
        })
      : null;
    let workspaceChangeSet: { id: string; status: string } | null = null;
    if (
      result.workspaceChanges &&
      (result.workspaceChanges.mode === "ISOLATED_CHANGE_SET" || this.writeWorkspaceChangeSet) &&
      result.workspaceChanges.manifest.length > 0
    ) {
      if (!this.writeWorkspaceChangeSet) {
        throw new Error("BROKERED_BASH_ISOLATED_CHANGE_SET_UNAVAILABLE");
      }
      const changes = result.workspaceChanges;
      workspaceChangeSet = this.writeWorkspaceChangeSet({
        ...(changes.mode === "DIRECT_WORKSPACE_WRITE" ? { directWrite: true } : {}),
        workspaceGrantId: activeGrant.id,
        runId: projection.runId,
        toolCallId: context.toolCallId,
        baselineRevision: changes.baselineRevision,
        finalRevision: changes.finalRevision,
        manifest: changes.manifest,
        diffs: changes.diffs,
        entries: changes.materialization,
        blocked:
          changes.manifestTruncated ||
          changes.materialization.length !== changes.manifest.length ||
          changes.materialization.some(({ applySupported }) => !applySupported),
      });
    }
    const normalized = normalizedResult(
      operation,
      result,
      activeGrant,
      additionalGrants,
      logArtifactId,
      workspaceChangeSet,
    );
    if (result.destructionStatus === "uncertain") {
      throw new ToolAdapterError("BROKERED_BASH_DESTRUCTION_UNCERTAIN", normalized);
    }
    if (result.cancelled) throw new ToolAdapterError("BROKERED_BASH_CANCELLED", normalized);
    if (result.timedOut) throw new ToolAdapterError("BROKERED_BASH_TIMEOUT", normalized);
    if (result.exitCode !== 0) {
      throw new ToolAdapterError("BROKERED_BASH_COMMAND_FAILED", normalized);
    }
    return normalized;
  }

  async stopAll(): Promise<void> {
    await this.engine.stopAll();
  }
}
