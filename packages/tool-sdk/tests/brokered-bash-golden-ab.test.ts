import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  BROKERED_BASH_CORE_ENVIRONMENT_POLICY_ID,
  BROKERED_BASH_DENY_NETWORK_POLICY_ID,
} from "@openerx/contracts";
import { afterAll, describe, expect, it } from "vitest";
import {
  BROKERED_BASH_CORE_ENVIRONMENT_POLICY,
  brokeredBashEnvironmentPolicyDigest,
  brokeredBashNetworkPolicyDigest,
  defaultPlatformSandboxResourceLimits,
  MacOSSandboxExecEngine,
  ShellToolAdapter,
  ToolAdapterError,
} from "../src";

const liveMacOS = process.platform === "darwin" && existsSync("/usr/bin/sandbox-exec");
const workspace = mkdtempSync(path.join(tmpdir(), "openerx-pbash-golden-ab-"));

const tasks = [
  {
    id: "repository_exploration",
    command: "find . -maxdepth 1 -type f -print | sort",
    marker: "./fixture.js",
    exitCode: 0,
  },
  {
    id: "combined_search",
    command: "rg -n 'needle' .",
    marker: "needle",
    exitCode: 0,
  },
  {
    id: "build",
    command: "node --check fixture.js",
    marker: "",
    exitCode: 0,
  },
  {
    id: "test",
    command: "node fixture.test.js",
    marker: "test-ok",
    exitCode: 0,
  },
  {
    id: "lint",
    command: "node --check fixture.test.js",
    marker: "",
    exitCode: 0,
  },
  {
    id: "failure_diagnosis",
    command: "node -e \"process.stderr.write('diagnostic-marker'); process.exit(7)\"",
    marker: "diagnostic-marker",
    exitCode: 7,
  },
  {
    id: "pre_patch_validation",
    command: "git diff --check --no-index fixture.js fixture.js",
    marker: "",
    legacyMarker: "could not open '/dev/null'",
    legacyExitCode: 128,
    exitCode: 0,
  },
  {
    id: "long_output",
    command: "node -e \"for(let i=0;i<250;i++) console.log('line-'+i)\"",
    marker: "line-249",
    exitCode: 0,
  },
] as const;

writeFileSync(path.join(workspace, "fixture.js"), "export const needle = 42;\n");
writeFileSync(path.join(workspace, "fixture.test.js"), "console.log('test-ok');\n");

afterAll(() => rmSync(workspace, { recursive: true, force: true }));

describe("PBASH-007 deterministic Golden A/B", () => {
  it("keeps core argv-shell and brokered Bash task outcomes aligned", async () => {
    if (!liveMacOS) return;
    const legacy = new ShellToolAdapter([workspace]);
    const brokered = new MacOSSandboxExecEngine();
    try {
      for (const [index, task] of tasks.entries()) {
        let legacyExitCode = 0;
        let legacyOutput = "";
        try {
          const result = await legacy.execute(
            {
              operation: "shell_execute",
              cwd: workspace,
              command: "/bin/bash",
              args: ["--noprofile", "--norc", "-c", task.command],
              timeoutMs: 15_000,
              background: false,
              allowNetwork: false,
              idempotencyKey: `pbash-golden-legacy-${index}`,
            },
            {
              signal: new AbortController().signal,
              toolCallId: `legacy-${index}`,
              update: () => undefined,
            },
          );
          legacyOutput = result.content
            .filter((entry) => entry.type === "text")
            .map((entry) => entry.text)
            .join("\n");
        } catch (error) {
          if (!(error instanceof ToolAdapterError)) throw error;
          legacyExitCode = Number((error.result.data as { exitCode?: number })?.exitCode ?? -1);
          legacyOutput = error.result.content
            .filter((entry) => entry.type === "text")
            .map((entry) => entry.text)
            .join("\n");
        }

        const networkPolicy = { mode: "deny" } as const;
        const result = await brokered.execute({
          identity: {
            generationId: crypto.randomUUID(),
            toolCallId: crypto.randomUUID(),
            piToolCallId: `golden-${index}`,
          },
          shell: "bash",
          command: task.command,
          timeoutMs: 15_000,
          executionProfile: "read_only",
          workspaceWriteMode: "none",
          environmentPolicyId: BROKERED_BASH_CORE_ENVIRONMENT_POLICY_ID,
          environmentPolicyDigest: brokeredBashEnvironmentPolicyDigest(
            BROKERED_BASH_CORE_ENVIRONMENT_POLICY,
          ),
          environmentPolicy: BROKERED_BASH_CORE_ENVIRONMENT_POLICY,
          networkPolicyId: BROKERED_BASH_DENY_NETWORK_POLICY_ID,
          networkPolicyDigest: brokeredBashNetworkPolicyDigest(networkPolicy),
          networkPolicy,
          activeRoot: {
            grantId: "11111111-1111-4111-8111-111111111111",
            logicalName: "workspace",
            rootPath: workspace,
            access: "read_write",
          },
          additionalRoots: [],
          resourceLimits: defaultPlatformSandboxResourceLimits(),
          signal: new AbortController().signal,
        });

        expect(legacyExitCode, `${task.id}: legacy exit\n${legacyOutput}`).toBe(
          "legacyExitCode" in task ? task.legacyExitCode : task.exitCode,
        );
        expect(result.exitCode, `${task.id}: brokered exit\n${result.output}`).toBe(task.exitCode);
        if ("legacyMarker" in task) {
          expect(legacyOutput, `${task.id}: explained legacy gap`).toContain(task.legacyMarker);
        }
        if (task.marker) {
          expect(legacyOutput, `${task.id}: legacy marker`).toContain(task.marker);
          expect(result.output, `${task.id}: brokered marker`).toContain(task.marker);
        }
        expect(result.proof).toMatchObject({
          filesystemBoundary: true,
          environmentSanitized: true,
          networkDenied: true,
          controlledEgress: false,
        });
      }
    } finally {
      await legacy.stopAll();
      await brokered.stopAll();
    }
  }, 60_000);

  it("stops active work through both execution paths", async () => {
    if (!liveMacOS) return;
    const legacy = new ShellToolAdapter([workspace]);
    const brokered = new MacOSSandboxExecEngine();
    try {
      const started = await legacy.execute(
        {
          operation: "shell_execute",
          cwd: workspace,
          command: "/bin/bash",
          args: ["--noprofile", "--norc", "-c", "sleep 60"],
          timeoutMs: 15_000,
          background: true,
          allowNetwork: false,
          idempotencyKey: "pbash-golden-legacy-stop-start",
        },
        {
          signal: new AbortController().signal,
          toolCallId: "legacy-stop-start",
          update: () => undefined,
        },
      );
      const processId = (started.data as { processId: string }).processId;
      await legacy.execute(
        {
          operation: "shell_stop",
          processId,
          idempotencyKey: "pbash-golden-legacy-stop-finish",
        },
        {
          signal: new AbortController().signal,
          toolCallId: "legacy-stop-finish",
          update: () => undefined,
        },
      );
      await expect(
        legacy.execute(
          {
            operation: "shell_status",
            processId,
            idempotencyKey: "pbash-golden-legacy-stop-status",
          },
          {
            signal: new AbortController().signal,
            toolCallId: "legacy-stop-status",
            update: () => undefined,
          },
        ),
      ).resolves.toMatchObject({ data: { state: "stopped" } });

      const networkPolicy = { mode: "deny" } as const;
      const running = brokered.execute({
        identity: {
          generationId: crypto.randomUUID(),
          toolCallId: crypto.randomUUID(),
          piToolCallId: "golden-stop",
        },
        shell: "bash",
        command: "sleep 60",
        timeoutMs: 15_000,
        executionProfile: "read_only",
        workspaceWriteMode: "none",
        environmentPolicyId: BROKERED_BASH_CORE_ENVIRONMENT_POLICY_ID,
        environmentPolicyDigest: brokeredBashEnvironmentPolicyDigest(
          BROKERED_BASH_CORE_ENVIRONMENT_POLICY,
        ),
        environmentPolicy: BROKERED_BASH_CORE_ENVIRONMENT_POLICY,
        networkPolicyId: BROKERED_BASH_DENY_NETWORK_POLICY_ID,
        networkPolicyDigest: brokeredBashNetworkPolicyDigest(networkPolicy),
        networkPolicy,
        activeRoot: {
          grantId: "22222222-2222-4222-8222-222222222222",
          logicalName: "workspace",
          rootPath: workspace,
          access: "read_write",
        },
        additionalRoots: [],
        resourceLimits: defaultPlatformSandboxResourceLimits(),
        signal: new AbortController().signal,
      });
      await new Promise((resolve) => setTimeout(resolve, 100));
      await brokered.stopAll();
      await expect(running).resolves.toMatchObject({
        cancelled: true,
        timedOut: false,
      });
      expect((await running).destructionStatus).not.toBe("uncertain");
    } finally {
      await legacy.stopAll();
      await brokered.stopAll();
    }
  }, 20_000);
});
