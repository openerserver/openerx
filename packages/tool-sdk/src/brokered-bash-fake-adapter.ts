import {
  BROKERED_BASH_CORE_ENVIRONMENT_POLICY_ID,
  BROKERED_BASH_DENY_NETWORK_POLICY_ID,
  BROKERED_BASH_FAKE_SANDBOX_POLICY_VERSION,
  type BrokeredBashExecutionContext,
  type NormalizedToolResult,
  type ToolOperation,
  type WorkspaceGrant,
} from "@openerx/contracts";
import type { ToolAdapter, ToolExecutionContext } from "./types";

function sameExecutionContext(
  operation: Extract<ToolOperation, { operation: "shell_command_execute" }>,
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

export class BrokeredBashFakeAdapter implements ToolAdapter {
  readonly operations = ["shell_command_execute"] as const;

  constructor(
    private readonly resolveWorkspaceGrant: (
      workspaceGrantId: string,
      conversationId: string,
    ) => WorkspaceGrant,
    private readonly executionContext: (
      generationId: string,
    ) => BrokeredBashExecutionContext | undefined,
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
      operation.sandboxPolicyVersion !== BROKERED_BASH_FAKE_SANDBOX_POLICY_VERSION
    ) {
      throw new Error("BROKERED_BASH_POLICY_MISMATCH");
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
    if (operation.workspaceWriteMode === "isolated_change_set") {
      throw new Error("BROKERED_BASH_ISOLATED_CHANGE_SET_UNAVAILABLE");
    }

    context.update("PBASH-001 fake runner validated the frozen execution context");
    return {
      summary: "PBASH-001 fake runner validated the Bash request; no process was started.",
      content: [
        {
          type: "text",
          text: "PBASH-001 contract validation completed. executionPerformed=false; the command was not executed.",
        },
      ],
      data: {
        contractVersion: operation.contractVersion,
        executionPerformed: false,
        runner: "deterministic_fake",
        shell: operation.shell,
        commandLength: operation.command.length,
        timeoutMs: operation.timeoutMs,
        activeExecutionGrantId: activeGrant.id,
        additionalExecutionGrantIds: additionalGrants.map(({ id }) => id),
        executionProfile: operation.executionProfile,
        executionOrigin: operation.executionOrigin,
        workspaceWriteMode: operation.workspaceWriteMode,
        environmentPolicyId: operation.environmentPolicyId,
        networkPolicyId: operation.networkPolicyId,
        sandboxPolicyVersion: operation.sandboxPolicyVersion,
      },
      sources: [],
      artifacts: [],
      sideEffectCommitted: false,
      durationMs: 0,
    };
  }
}
