import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  BROKERED_BASH_CONTRACT_VERSION,
  BROKERED_BASH_CORE_ENVIRONMENT_POLICY_ID,
  BROKERED_BASH_DENY_NETWORK_POLICY_ID,
  BROKERED_BASH_MACOS_SANDBOX_POLICY_VERSION,
  type BrokeredBashExecutionContext,
  type BrokeredBashOperation,
  type WorkspaceGrant,
} from "@openerx/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BrokeredBashAdapter,
  PLATFORM_SANDBOX_ENGINE_VERSION,
  type PlatformSandboxCapability,
  type PlatformSandboxEngine,
  type PlatformSandboxExecutionRequest,
  type PlatformSandboxExecutionResult,
  ToolAdapterError,
} from "../src";

const directories: string[] = [];
const conversationId = "11111111-1111-4111-8111-111111111111";
const generationId = "22222222-2222-4222-8222-222222222222";
const activeGrantId = "33333333-3333-4333-8333-333333333333";

class FakePlatformSandboxEngine implements PlatformSandboxEngine {
  readonly engineVersion = PLATFORM_SANDBOX_ENGINE_VERSION;
  readonly backendId = "fake_platform_sandbox";
  readonly policyVersion = BROKERED_BASH_MACOS_SANDBOX_POLICY_VERSION;
  capability: PlatformSandboxCapability = {
    available: true,
    reason: null,
    engineVersion: this.engineVersion,
    backendId: this.backendId,
    backendVersion: "test",
    policyVersion: this.policyVersion,
    platform: "darwin",
    platformRelease: "test-build",
    supportedProfiles: ["read_only", "workspace_write"],
    environmentPolicyIds: [BROKERED_BASH_CORE_ENVIRONMENT_POLICY_ID],
    networkPolicyIds: [BROKERED_BASH_DENY_NETWORK_POLICY_ID],
    capabilities: {
      filesystemBoundary: true,
      hardlinkBoundary: true,
      readOnlyRoots: true,
      writableRoots: true,
      networkDeny: true,
      sanitizedEnvironment: true,
      processGroupCleanup: true,
      descendantSandboxInheritance: true,
      pty: false,
    },
  };
  result: PlatformSandboxExecutionResult = {
    exitCode: 0,
    signal: null,
    stdout: "platform-ok",
    stderr: "",
    output: "platform-ok",
    outputTruncated: false,
    timedOut: false,
    cancelled: false,
    durationMs: 3,
    destructionStatus: "clean",
    changedPathManifestStatus: "not_collected",
    proof: {
      engineVersion: this.engineVersion,
      backendId: this.backendId,
      backendVersion: "test",
      policyVersion: this.policyVersion,
      platform: "darwin",
      platformRelease: "test-build",
      executionProfile: "workspace_write",
      environmentPolicyId: BROKERED_BASH_CORE_ENVIRONMENT_POLICY_ID,
      networkPolicyId: BROKERED_BASH_DENY_NETWORK_POLICY_ID,
      filesystemBoundary: true,
      hardlinkBoundary: true,
      environmentSanitized: true,
      networkDenied: true,
      processGroupOwned: true,
    },
  };
  readonly requests: PlatformSandboxExecutionRequest[] = [];
  readonly stop = vi.fn(async () => undefined);

  async probe(): Promise<PlatformSandboxCapability> {
    return this.capability;
  }

  async execute(request: PlatformSandboxExecutionRequest): Promise<PlatformSandboxExecutionResult> {
    this.requests.push(request);
    return {
      ...this.result,
      proof: { ...this.result.proof, executionProfile: request.executionProfile },
    };
  }

  async stopAll(): Promise<void> {
    await this.stop();
  }
}

function fixture() {
  const rootPath = mkdtempSync(path.join(tmpdir(), "openerx-pbash-adapter-"));
  directories.push(rootPath);
  const execution: BrokeredBashExecutionContext = {
    contractVersion: BROKERED_BASH_CONTRACT_VERSION,
    activeExecutionGrantId: activeGrantId,
    additionalExecutionGrantIds: [],
    executionProfile: "workspace_write",
    environmentPolicyId: BROKERED_BASH_CORE_ENVIRONMENT_POLICY_ID,
    networkPolicyId: BROKERED_BASH_DENY_NETWORK_POLICY_ID,
    sandboxPolicyVersion: BROKERED_BASH_MACOS_SANDBOX_POLICY_VERSION,
  };
  const grant: WorkspaceGrant = {
    id: activeGrantId,
    ownerProfileId: "profile-a",
    conversationId,
    displayName: "workspace",
    rootPath,
    access: "read_write",
    allowNetwork: false,
    expiresAt: null,
    revokedAt: null,
    createdAt: "2026-08-28T00:00:00.000Z",
  };
  const engine = new FakePlatformSandboxEngine();
  const resolve = vi.fn((grantId: string, requestedConversationId: string) => {
    if (grantId !== grant.id || requestedConversationId !== conversationId) {
      throw new Error("WORKSPACE_GRANT_INACTIVE");
    }
    return grant;
  });
  const adapter = new BrokeredBashAdapter(
    resolve,
    (requestedGenerationId) => (requestedGenerationId === generationId ? execution : undefined),
    engine,
  );
  const operation: BrokeredBashOperation = {
    operation: "shell_command_execute",
    idempotencyKey: "pbash-platform-adapter-0001",
    ...execution,
    shell: "bash",
    command: "npm test",
    timeoutMs: 120_000,
  };
  const update = vi.fn();
  const context = {
    signal: new AbortController().signal,
    toolCallId: "44444444-4444-4444-8444-444444444444",
    projection: {
      generationId,
      workItemId: "55555555-5555-4555-8555-555555555555",
      runId: "66666666-6666-4666-8666-666666666666",
      conversationId,
      assistantMessageId: "77777777-7777-4777-8777-777777777777",
      piToolCallId: "pi-platform-bash-call",
      toolName: "bash",
    },
    update,
  };
  return { adapter, context, engine, execution, grant, operation, resolve, rootPath, update };
}

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("BrokeredBashAdapter", () => {
  it("dispatches only the frozen request and returns proof without private paths", async () => {
    const { adapter, context, engine, grant, operation, rootPath, update } = fixture();
    const result = await adapter.execute(operation, context);
    expect(result).toMatchObject({
      sideEffectCommitted: true,
      data: {
        executionPerformed: true,
        runner: "platform_sandbox",
        exitCode: 0,
        destructionStatus: "clean",
        proof: {
          backendId: "fake_platform_sandbox",
          platformRelease: "test-build",
          networkDenied: true,
        },
      },
    });
    expect(engine.requests[0]).toMatchObject({
      identity: {
        generationId,
        toolCallId: context.toolCallId,
        piToolCallId: context.projection.piToolCallId,
      },
      activeRoot: { grantId: grant.id, rootPath, access: "read_write" },
      command: operation.command,
    });
    expect(JSON.stringify(result)).not.toContain(rootPath);
    expect(update).not.toHaveBeenCalled();
  });

  it("rejects context tampering, unavailable backends and inactive grants before dispatch", async () => {
    const { adapter, context, engine, operation, resolve } = fixture();
    await expect(
      adapter.execute({ ...operation, sandboxPolicyVersion: "macos-seatbelt-v2" }, context),
    ).rejects.toThrow("BROKERED_BASH_EXECUTION_CONTEXT_MISMATCH");
    expect(engine.requests).toHaveLength(0);

    engine.capability = {
      ...engine.capability,
      available: false,
      reason: "BROKERED_BASH_CAPABILITY_PROBE_FAILED",
      supportedProfiles: [],
    };
    await expect(adapter.execute(operation, context)).rejects.toThrow(
      "BROKERED_BASH_CAPABILITY_PROBE_FAILED",
    );
    engine.capability = {
      ...engine.capability,
      available: true,
      reason: null,
      supportedProfiles: ["workspace_write"],
    };
    resolve.mockImplementationOnce(() => {
      throw new Error("WORKSPACE_GRANT_INACTIVE");
    });
    await expect(adapter.execute(operation, context)).rejects.toThrow(
      "BROKERED_BASH_WORKSPACE_GRANT_INVALID",
    );
    expect(engine.requests).toHaveLength(0);
  });

  it("turns cancellation, timeout, non-zero exit and uncertain destruction into typed failures", async () => {
    const { adapter, context, engine, operation } = fixture();
    engine.result = {
      ...engine.result,
      exitCode: null,
      signal: "SIGTERM",
      cancelled: true,
      destructionStatus: "terminated",
    };
    await expect(adapter.execute(operation, context)).rejects.toMatchObject({
      code: "BROKERED_BASH_CANCELLED",
    });

    engine.result = {
      ...engine.result,
      exitCode: null,
      signal: "SIGTERM",
      cancelled: false,
      timedOut: true,
      destructionStatus: "terminated",
    };
    await expect(adapter.execute(operation, context)).rejects.toMatchObject({
      code: "BROKERED_BASH_TIMEOUT",
    });

    engine.result = {
      ...engine.result,
      exitCode: 7,
      signal: null,
      timedOut: false,
      destructionStatus: "clean",
    };
    try {
      await adapter.execute(
        { ...operation, idempotencyKey: "pbash-platform-adapter-failure-0002" },
        context,
      );
      throw new Error("expected adapter failure");
    } catch (error) {
      expect(error).toBeInstanceOf(ToolAdapterError);
      expect((error as ToolAdapterError).code).toBe("BROKERED_BASH_COMMAND_FAILED");
    }

    engine.result = { ...engine.result, exitCode: 0, destructionStatus: "uncertain" };
    await expect(
      adapter.execute(
        { ...operation, idempotencyKey: "pbash-platform-adapter-uncertain-0003" },
        context,
      ),
    ).rejects.toMatchObject({ code: "BROKERED_BASH_DESTRUCTION_UNCERTAIN" });
  });

  it("keeps model-visible output bounded independently of the engine log limit", async () => {
    const { adapter, context, engine, operation } = fixture();
    engine.result = {
      ...engine.result,
      stdout: "x".repeat(80_000),
      output: "x".repeat(80_000),
    };
    const result = await adapter.execute(operation, context);
    const text = result.content[0]?.type === "text" ? result.content[0].text : "";
    expect(Buffer.byteLength(text, "utf8")).toBe(50 * 1_024);
    expect(result.summary).toHaveLength(8_000);
    expect(result.data).toMatchObject({ contextTruncated: true, outputTruncated: false });
  });

  it("forwards shutdown to the platform engine", async () => {
    const { adapter, engine } = fixture();
    await adapter.stopAll();
    expect(engine.stop).toHaveBeenCalledOnce();
  });
});
