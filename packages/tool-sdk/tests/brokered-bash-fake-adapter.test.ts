import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  BROKERED_BASH_CONTRACT_VERSION,
  BROKERED_BASH_CORE_ENVIRONMENT_POLICY_ID,
  BROKERED_BASH_DENY_NETWORK_POLICY_ID,
  BROKERED_BASH_FAKE_SANDBOX_POLICY_VERSION,
  type BrokeredBashExecutionContext,
  type BrokeredBashOperation,
  type WorkspaceGrant,
} from "@openerx/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BROKERED_BASH_CORE_ENVIRONMENT_POLICY,
  BrokeredBashFakeAdapter,
  brokeredBashEnvironmentPolicyDigest,
  brokeredBashNetworkPolicyDigest,
  capabilityRequirement,
  hasUncertainExternalSideEffect,
  operationDigest,
  summarizeOperation,
} from "../src";

const directories: string[] = [];
const conversationId = "11111111-1111-4111-8111-111111111111";
const generationId = "22222222-2222-4222-8222-222222222222";
const activeGrantId = "33333333-3333-4333-8333-333333333333";

function fixture(access: WorkspaceGrant["access"] = "read_write") {
  const root = mkdtempSync(path.join(tmpdir(), "openerx-pbash-fake-"));
  directories.push(root);
  const execution: BrokeredBashExecutionContext = {
    contractVersion: BROKERED_BASH_CONTRACT_VERSION,
    activeExecutionGrantId: activeGrantId,
    additionalExecutionGrantIds: [],
    executionProfile: access === "read_write" ? "workspace_write" : "read_only",
    executionOrigin: "local_interactive",
    workspaceWriteMode: access === "read_write" ? "direct_workspace" : "none",
    environmentPolicyId: BROKERED_BASH_CORE_ENVIRONMENT_POLICY_ID,
    environmentPolicyDigest: brokeredBashEnvironmentPolicyDigest(
      BROKERED_BASH_CORE_ENVIRONMENT_POLICY,
    ),
    networkPolicyId: BROKERED_BASH_DENY_NETWORK_POLICY_ID,
    networkPolicyDigest: brokeredBashNetworkPolicyDigest({ mode: "deny" }),
    sandboxPolicyVersion: BROKERED_BASH_FAKE_SANDBOX_POLICY_VERSION,
  };
  const grant: WorkspaceGrant = {
    id: activeGrantId,
    ownerProfileId: "profile-a",
    conversationId,
    displayName: "fixture",
    rootPath: root,
    access,
    allowNetwork: false,
    expiresAt: null,
    revokedAt: null,
    createdAt: "2026-08-28T00:00:00.000Z",
  };
  const resolve = vi.fn((grantId: string, requestedConversationId: string) => {
    if (grantId !== grant.id || requestedConversationId !== conversationId) {
      throw new Error("BROKERED_BASH_WORKSPACE_GRANT_INVALID");
    }
    return grant;
  });
  const adapter = new BrokeredBashFakeAdapter(resolve, (requestedGenerationId) =>
    requestedGenerationId === generationId ? execution : undefined,
  );
  const operation: BrokeredBashOperation = {
    operation: "shell_command_execute",
    idempotencyKey: "pbash-fake-adapter-0001",
    ...execution,
    shell: "bash",
    command: `touch ${path.join(root, "must-not-exist")}`,
    timeoutMs: 120_000,
  };
  const update = vi.fn();
  const context = {
    signal: new AbortController().signal,
    toolCallId: "tool-call-1",
    projection: {
      generationId,
      workItemId: "44444444-4444-4444-8444-444444444444",
      runId: "55555555-5555-4555-8555-555555555555",
      conversationId,
      assistantMessageId: "66666666-6666-4666-8666-666666666666",
      piToolCallId: "pi-call-1",
      toolName: "bash",
    },
    update,
  };
  return { adapter, context, execution, operation, resolve, root, update };
}

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("PBASH-001 fake adapter and policy", () => {
  it("validates the frozen context without starting the command", async () => {
    const { adapter, context, operation, resolve, root, update } = fixture();
    const result = await adapter.execute(operation, context);
    expect(result).toMatchObject({
      sideEffectCommitted: false,
      data: { executionPerformed: false, runner: "deterministic_fake" },
    });
    expect(existsSync(path.join(root, "must-not-exist"))).toBe(false);
    expect(resolve).toHaveBeenCalledWith(activeGrantId, conversationId);
    expect(update).toHaveBeenCalledOnce();
  });

  it("rejects a Pi-side policy change before the fake runner accepts it", async () => {
    const { adapter, context, operation } = fixture();
    await expect(
      adapter.execute({ ...operation, sandboxPolicyVersion: "pbash-fake-v2" }, context),
    ).rejects.toThrow("BROKERED_BASH_EXECUTION_CONTEXT_MISMATCH");
  });

  it("maps revoked, expired or conversation-mismatched grants to one broker error", async () => {
    const { context, execution, operation } = fixture();
    const adapter = new BrokeredBashFakeAdapter(
      () => {
        throw new Error("WORKSPACE_GRANT_INACTIVE");
      },
      () => execution,
    );
    await expect(adapter.execute(operation, context)).rejects.toThrow(
      "BROKERED_BASH_WORKSPACE_GRANT_INVALID",
    );
  });

  it("derives risk from profile/network and binds every policy field into the digest", () => {
    const { operation } = fixture("read_only");
    expect(capabilityRequirement(operation)).toMatchObject({
      capability: "shell",
      risk: "L2",
      resource: activeGrantId,
      approval: "automatic",
    });
    expect(hasUncertainExternalSideEffect(operation)).toBe(false);
    expect(summarizeOperation(operation).target).toContain("read_only");
    const digest = operationDigest(operation);
    for (const changed of [
      { ...operation, command: "pwd" },
      { ...operation, timeoutMs: 121_000 },
      {
        ...operation,
        activeExecutionGrantId: "77777777-7777-4777-8777-777777777777",
      },
      {
        ...operation,
        additionalExecutionGrantIds: ["88888888-8888-4888-8888-888888888888"],
      },
      { ...operation, executionProfile: "workspace_write" as const },
      { ...operation, executionOrigin: "remote_attended" as const },
      { ...operation, workspaceWriteMode: "isolated_change_set" as const },
      { ...operation, environmentPolicyId: "environment-core-v2" },
      { ...operation, environmentPolicyDigest: `sha256:${"1".repeat(64)}` },
      { ...operation, networkPolicyId: "network-allow-v1" },
      { ...operation, networkPolicyDigest: `sha256:${"2".repeat(64)}` },
      { ...operation, sandboxPolicyVersion: "pbash-fake-v2" },
    ]) {
      expect(operationDigest(changed)).not.toBe(digest);
    }
  });

  it("requires per-call approval for attended Remote writes", () => {
    const { operation } = fixture("read_write");
    expect(
      capabilityRequirement({
        ...operation,
        executionOrigin: "remote_attended",
      }),
    ).toMatchObject({ risk: "L3", approval: "per_call" });
    expect(
      capabilityRequirement({
        ...operation,
        executionOrigin: "remote_unattended",
        workspaceWriteMode: "isolated_change_set",
      }),
    ).toMatchObject({ risk: "L3", approval: "automatic" });
  });
});
