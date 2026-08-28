import {
  BROKERED_BASH_CONTRACT_VERSION,
  BROKERED_BASH_CORE_ENVIRONMENT_POLICY_ID,
  BROKERED_BASH_DENY_NETWORK_POLICY_ID,
  BROKERED_BASH_FAKE_SANDBOX_POLICY_VERSION,
  BROKERED_BASH_MACOS_SANDBOX_POLICY_VERSION,
  type BrokeredBashExecutionContext,
  type PiToolRequestFrame,
} from "@openerx/contracts";
import { describe, expect, it } from "vitest";
import { createProductCapabilityTools } from "../src/capability-tools";

const execution: BrokeredBashExecutionContext = {
  contractVersion: BROKERED_BASH_CONTRACT_VERSION,
  activeExecutionGrantId: "11111111-1111-4111-8111-111111111111",
  additionalExecutionGrantIds: ["22222222-2222-4222-8222-222222222222"],
  executionProfile: "workspace_write",
  executionOrigin: "local_interactive",
  workspaceWriteMode: "direct_workspace",
  environmentPolicyId: BROKERED_BASH_CORE_ENVIRONMENT_POLICY_ID,
  networkPolicyId: BROKERED_BASH_DENY_NETWORK_POLICY_ID,
  sandboxPolicyVersion: BROKERED_BASH_FAKE_SANDBOX_POLICY_VERSION,
};

function fixture(withExecution = true, executionContext: BrokeredBashExecutionContext = execution) {
  const frames: PiToolRequestFrame[] = [];
  const tools = createProductCapabilityTools({
    generationId: "33333333-3333-4333-8333-333333333333",
    conversationId: "44444444-4444-4444-8444-444444444444",
    branchId: "55555555-5555-4555-8555-555555555555",
    assistantMessageId: "66666666-6666-4666-8666-666666666666",
    ...(withExecution ? { brokeredBashExecution: executionContext } : {}),
    browserComputerUseV2: true,
    transport: {
      async request(frame) {
        frames.push(frame);
        return {
          summary: "fake accepted",
          content: [{ type: "text", text: "executionPerformed=false" }],
          data: { executionPerformed: false },
          sources: [],
          artifacts: [],
          sideEffectCommitted: false,
          durationMs: 1,
        };
      },
    },
  });
  return { bash: tools.find(({ name }) => name === "bash"), frames };
}

describe("PBASH-001 Pi bash projection", () => {
  it("keeps grant, profile and policy fields outside the model-visible schema", async () => {
    const { bash, frames } = fixture();
    if (!bash) throw new Error("brokered bash tool missing");
    const schema = JSON.stringify(bash.parameters);
    expect(schema).toContain("command");
    expect(schema).toContain("timeout");
    expect(schema).not.toMatch(/grant|profile|policy|sandbox|network|cwd|path/iu);

    await bash.execute(
      "pi-bash-call-1",
      { command: "npm test -- --run", timeout: 30 },
      undefined,
      undefined,
      {} as never,
    );
    expect(frames[0]).toMatchObject({
      piToolCallId: "pi-bash-call-1",
      toolName: "bash",
      operation: {
        operation: "shell_command_execute",
        idempotencyKey: "tool:33333333-3333-4333-8333-333333333333:pi-bash-call-1:bash",
        ...execution,
        shell: "bash",
        command: "npm test -- --run",
        timeoutMs: 30_000,
      },
    });
  });

  it("does not register bash without a trusted execution context", () => {
    expect(fixture(false).bash).toBeUndefined();
  });

  it("describes real sandbox execution without exposing trusted path or grant fields", () => {
    const realExecution: BrokeredBashExecutionContext = {
      ...execution,
      sandboxPolicyVersion: BROKERED_BASH_MACOS_SANDBOX_POLICY_VERSION,
    };
    const { bash } = fixture(true, realExecution);
    if (!bash) throw new Error("brokered bash tool missing");
    expect(bash.label).toBe("Run Bash in workspace sandbox");
    expect(bash.description).toContain("platform-enforced sandbox");
    expect(bash.description).toContain("Every command starts at that workspace root");
    expect(bash.description).toContain("Ignore Pi's Current working directory metadata");
    expect(bash.description).toContain("Network access is disabled");
    expect(bash.description).toContain("$OPENERX_WORKSPACE_1");
    expect(bash.description).not.toContain(realExecution.activeExecutionGrantId);
  });

  it("tells unattended Remote sessions that writes remain isolated until review", () => {
    const { bash } = fixture(true, {
      ...execution,
      executionOrigin: "remote_unattended",
      workspaceWriteMode: "isolated_change_set",
      sandboxPolicyVersion: BROKERED_BASH_MACOS_SANDBOX_POLICY_VERSION,
    });
    if (!bash) throw new Error("brokered bash tool missing");
    expect(bash.description).toContain("isolated working copy");
    expect(bash.description).toContain("host workspace is not changed");
  });

  it("maps ordered transport progress into Pi onUpdate results", async () => {
    const updates: unknown[] = [];
    const { bash } = fixture();
    if (!bash) throw new Error("brokered bash tool missing");
    const transport = createProductCapabilityTools({
      generationId: "33333333-3333-4333-8333-333333333333",
      conversationId: "44444444-4444-4444-8444-444444444444",
      branchId: "55555555-5555-4555-8555-555555555555",
      assistantMessageId: "66666666-6666-4666-8666-666666666666",
      brokeredBashExecution: execution,
      transport: {
        async request(_frame, options) {
          options?.onProgress?.({
            kind: "pi.tool.progress",
            requestId: "77777777-7777-4777-8777-777777777777",
            sequence: 1,
            delta: "building\n",
            truncated: false,
          });
          return {
            summary: "done",
            content: [{ type: "text", text: "done" }],
            data: {},
            sources: [],
            artifacts: [],
            sideEffectCommitted: false,
            durationMs: 1,
          };
        },
      },
    }).find(({ name }) => name === "bash");
    if (!transport) throw new Error("progress bash tool missing");
    await transport.execute(
      "pi-bash-progress",
      { command: "printf building" },
      undefined,
      (update) => updates.push(update),
      {} as never,
    );
    expect(updates).toEqual([
      {
        content: [{ type: "text", text: "building\n" }],
        details: { sequence: 1, truncated: false },
      },
    ]);
  });
});
