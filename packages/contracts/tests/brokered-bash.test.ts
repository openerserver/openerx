import { describe, expect, it } from "vitest";
import {
  BROKERED_BASH_CONTRACT_VERSION,
  BROKERED_BASH_CORE_ENVIRONMENT_POLICY_ID,
  BROKERED_BASH_DENY_NETWORK_POLICY_ID,
  BROKERED_BASH_FAKE_SANDBOX_POLICY_VERSION,
  brokeredBashErrorCodeSchema,
  brokeredBashOperationSchema,
  brokeredBashRunnerMode,
  brokeredBashV1Enabled,
  piHostContractVersion,
  piPromptFrameSchema,
  piToolCancelFrameSchema,
  piToolProgressFrameSchema,
} from "../src";

const activeGrantId = "11111111-1111-4111-8111-111111111111";
const additionalGrantId = "22222222-2222-4222-8222-222222222222";

const execution = {
  contractVersion: BROKERED_BASH_CONTRACT_VERSION,
  activeExecutionGrantId: activeGrantId,
  additionalExecutionGrantIds: [additionalGrantId],
  executionProfile: "workspace_write" as const,
  executionOrigin: "local_interactive" as const,
  workspaceWriteMode: "direct_workspace" as const,
  environmentPolicyId: BROKERED_BASH_CORE_ENVIRONMENT_POLICY_ID,
  networkPolicyId: BROKERED_BASH_DENY_NETWORK_POLICY_ID,
  sandboxPolicyVersion: BROKERED_BASH_FAKE_SANDBOX_POLICY_VERSION,
};

const operation = {
  operation: "shell_command_execute" as const,
  idempotencyKey: "brokered-bash-contract-0001",
  ...execution,
  shell: "bash" as const,
  command: "npm test -- --run",
  timeoutMs: 120_000,
};

describe("brokered Bash contracts", () => {
  it("keeps the feature flag default-off and bumps the private Pi IPC contract", () => {
    expect(brokeredBashV1Enabled(undefined)).toBe(false);
    expect(brokeredBashV1Enabled("0")).toBe(false);
    expect(brokeredBashV1Enabled("false")).toBe(false);
    expect(brokeredBashV1Enabled("1")).toBe(true);
    expect(brokeredBashV1Enabled("TRUE")).toBe(true);
    expect(piHostContractVersion).toBe(11);
  });

  it("validates ordered progress and request-scoped cancellation frames", () => {
    expect(
      piToolProgressFrameSchema.parse({
        kind: "pi.tool.progress",
        requestId: activeGrantId,
        sequence: 1,
        delta: "first line\n",
        truncated: false,
      }),
    ).toMatchObject({ sequence: 1, truncated: false });
    expect(
      piToolProgressFrameSchema.safeParse({
        kind: "pi.tool.progress",
        requestId: activeGrantId,
        sequence: 0,
        delta: "invalid",
        truncated: false,
      }).success,
    ).toBe(false);
    expect(
      piToolCancelFrameSchema.safeParse({
        kind: "pi.tool.cancel",
        requestId: activeGrantId,
        generationId: additionalGrantId,
      }).success,
    ).toBe(true);
  });

  it("selects runner mode explicitly and fails closed on invalid configuration", () => {
    expect(brokeredBashRunnerMode(undefined)).toBe("fake");
    expect(brokeredBashRunnerMode("  ")).toBe("fake");
    expect(brokeredBashRunnerMode("fake")).toBe("fake");
    expect(brokeredBashRunnerMode("MACOS")).toBe("macos");
    expect(brokeredBashRunnerMode("host-shell")).toBeNull();
  });

  it("keeps PBASH-002 failures on stable machine-readable codes", () => {
    for (const code of [
      "BROKERED_BASH_COMMAND_FAILED",
      "BROKERED_BASH_TIMEOUT",
      "BROKERED_BASH_CANCELLED",
      "BROKERED_BASH_DESTRUCTION_UNCERTAIN",
      "BROKERED_BASH_SANDBOX_EXEC_MISSING",
      "BROKERED_BASH_HARDLINK_BOUNDARY_UNSAFE",
      "BROKERED_BASH_CHANGE_EVIDENCE_FAILED",
      "BROKERED_BASH_ISOLATED_CHANGE_SET_UNAVAILABLE",
    ]) {
      expect(brokeredBashErrorCodeSchema.safeParse(code).success).toBe(true);
    }
    expect(brokeredBashErrorCodeSchema.safeParse("BROKERED_BASH_EXIT_7").success).toBe(false);
  });

  it("accepts the complete versioned operation and rejects unsafe or ambiguous inputs", () => {
    expect(brokeredBashOperationSchema.parse(operation)).toEqual(operation);
    expect(
      brokeredBashOperationSchema.safeParse({
        ...operation,
        command: `printf x${String.fromCharCode(0)}`,
      }).success,
    ).toBe(false);
    expect(
      brokeredBashOperationSchema.safeParse({
        ...operation,
        command: "界".repeat(21_846),
      }).success,
    ).toBe(false);
    expect(brokeredBashOperationSchema.safeParse({ ...operation, timeoutMs: 999 }).success).toBe(
      false,
    );
    expect(brokeredBashOperationSchema.safeParse({ ...operation, unexpected: true }).success).toBe(
      false,
    );
    expect(
      brokeredBashOperationSchema.safeParse({
        ...operation,
        additionalExecutionGrantIds: [additionalGrantId, additionalGrantId],
      }).success,
    ).toBe(false);
    expect(
      brokeredBashOperationSchema.safeParse({
        ...operation,
        additionalExecutionGrantIds: [activeGrantId],
      }).success,
    ).toBe(false);
    expect(
      brokeredBashOperationSchema.safeParse({
        ...operation,
        executionProfile: "read_only",
        workspaceWriteMode: "direct_workspace",
      }).success,
    ).toBe(false);
    expect(
      brokeredBashOperationSchema.safeParse({
        ...operation,
        workspaceWriteMode: "none",
      }).success,
    ).toBe(false);
    expect(
      brokeredBashOperationSchema.safeParse({
        ...operation,
        workspaceWriteMode: "isolated_change_set",
      }).success,
    ).toBe(true);
    expect(
      brokeredBashOperationSchema.safeParse({
        ...operation,
        executionOrigin: "remote_unattended",
        workspaceWriteMode: "direct_workspace",
      }).success,
    ).toBe(false);
    expect(
      brokeredBashOperationSchema.safeParse({
        ...operation,
        executionOrigin: "remote_unattended",
        workspaceWriteMode: "isolated_change_set",
      }).success,
    ).toBe(true);
    expect(
      brokeredBashOperationSchema.safeParse({
        ...operation,
        executionOrigin: "remote_attended",
        networkPolicyId: "network-allow-v1",
      }).success,
    ).toBe(false);
  });

  it("binds prompt execution context to grants present in the trusted workspace frame", () => {
    const frame = {
      kind: "pi.session.prompt" as const,
      generationId: "33333333-3333-4333-8333-333333333333",
      conversationId: "44444444-4444-4444-8444-444444444444",
      branchId: "55555555-5555-4555-8555-555555555555",
      assistantMessageId: "66666666-6666-4666-8666-666666666666",
      history: [{ role: "user" as const, text: "运行测试" }],
      workspace: {
        grants: [
          {
            id: activeGrantId,
            displayName: "active",
            access: "read_write" as const,
            allowNetwork: false,
            expiresAt: null,
          },
          {
            id: additionalGrantId,
            displayName: "additional",
            access: "read_only" as const,
            allowNetwork: false,
            expiresAt: null,
          },
        ],
        instructionSources: [],
        execution,
      },
    };
    expect(piPromptFrameSchema.parse(frame)).toEqual(frame);
    expect(
      piPromptFrameSchema.safeParse({
        ...frame,
        workspace: {
          ...frame.workspace,
          grants: frame.workspace.grants.slice(0, 1),
        },
      }).success,
    ).toBe(false);
    expect(
      piPromptFrameSchema.safeParse({
        ...frame,
        workspace: {
          ...frame.workspace,
          grants: [{ ...frame.workspace.grants[0], access: "read_only" as const }],
          execution: { ...execution, additionalExecutionGrantIds: [] },
        },
      }).success,
    ).toBe(false);
  });
});
