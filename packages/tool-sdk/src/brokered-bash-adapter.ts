import {
  BROKERED_BASH_CORE_ENVIRONMENT_POLICY_ID,
  BROKERED_BASH_DENY_NETWORK_POLICY_ID,
  type BrokeredBashExecutionContext,
  type NormalizedToolResult,
  type ToolOperation,
  type WorkspaceGrant,
} from "@openerx/contracts";
import {
  defaultPlatformSandboxResourceLimits,
  type PlatformSandboxEngine,
  type PlatformSandboxExecutionResult,
} from "./platform-sandbox-engine";
import { type ToolAdapter, ToolAdapterError, type ToolExecutionContext } from "./types";

const MODEL_OUTPUT_LIMIT_BYTES = 50 * 1_024;

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
    operation.environmentPolicyId === expected.environmentPolicyId &&
    operation.networkPolicyId === expected.networkPolicyId &&
    operation.sandboxPolicyVersion === expected.sandboxPolicyVersion
  );
}

function modelOutput(result: PlatformSandboxExecutionResult): {
  text: string;
  contextTruncated: boolean;
} {
  const withoutNul = result.output.replaceAll(String.fromCharCode(0), "�");
  const bytes = Buffer.from(withoutNul, "utf8");
  if (bytes.byteLength <= MODEL_OUTPUT_LIMIT_BYTES) {
    return { text: withoutNul, contextTruncated: false };
  }
  return {
    text: bytes.subarray(bytes.byteLength - MODEL_OUTPUT_LIMIT_BYTES).toString("utf8"),
    contextTruncated: true,
  };
}

function normalizedResult(
  operation: BrokeredBashOperation,
  result: PlatformSandboxExecutionResult,
  activeGrant: WorkspaceGrant,
  additionalGrants: WorkspaceGrant[],
): NormalizedToolResult {
  const output = modelOutput(result);
  const fallback =
    result.exitCode === 0 ? "Bash completed successfully." : "Bash did not complete.";
  const text = output.text || fallback;
  return {
    summary: text.slice(-8_000),
    content: [{ type: "text", text }],
    data: {
      contractVersion: operation.contractVersion,
      executionPerformed: true,
      runner: "platform_sandbox",
      shell: operation.shell,
      timeoutMs: operation.timeoutMs,
      activeExecutionGrantId: activeGrant.id,
      additionalExecutionGrantIds: additionalGrants.map(({ id }) => id),
      executionProfile: operation.executionProfile,
      environmentPolicyId: operation.environmentPolicyId,
      networkPolicyId: operation.networkPolicyId,
      sandboxPolicyVersion: operation.sandboxPolicyVersion,
      exitCode: result.exitCode,
      signal: result.signal,
      timedOut: result.timedOut,
      cancelled: result.cancelled,
      outputTruncated: result.outputTruncated,
      contextTruncated: output.contextTruncated,
      destructionStatus: result.destructionStatus,
      changedPathManifestStatus: result.changedPathManifestStatus,
      proof: result.proof,
    },
    sources: [],
    artifacts: [],
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
    if (
      operation.environmentPolicyId !== BROKERED_BASH_CORE_ENVIRONMENT_POLICY_ID ||
      operation.networkPolicyId !== BROKERED_BASH_DENY_NETWORK_POLICY_ID ||
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
    const result = await this.engine.execute({
      identity: {
        generationId: projection.generationId,
        toolCallId: context.toolCallId,
        piToolCallId: projection.piToolCallId,
      },
      shell: operation.shell,
      command: operation.command,
      timeoutMs: operation.timeoutMs,
      executionProfile: operation.executionProfile,
      environmentPolicyId: operation.environmentPolicyId,
      networkPolicyId: operation.networkPolicyId,
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
    });
    const normalized = normalizedResult(operation, result, activeGrant, additionalGrants);
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
