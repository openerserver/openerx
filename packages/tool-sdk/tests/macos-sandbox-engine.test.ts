import { spawn } from "node:child_process";
import {
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  BROKERED_BASH_CONTROLLED_EGRESS_NETWORK_POLICY_ID,
  BROKERED_BASH_DENY_NETWORK_POLICY_ID,
  type BrokeredBashExecutionProfile,
} from "@openerx/contracts";
import { afterEach, describe, expect, it } from "vitest";
import {
  BROKERED_BASH_CORE_ENVIRONMENT_POLICY,
  brokeredBashEnvironmentPolicyDigest,
  brokeredBashEnvironmentPolicyId,
  brokeredBashNetworkPolicyDigest,
  compileMacOSSandboxProfile,
  defaultPlatformSandboxResourceLimits,
  MacOSSandboxExecEngine,
  type PlatformSandboxExecutionRequest,
  type PlatformSandboxRoot,
} from "../src";

const directories: string[] = [];
const liveMacOS =
  process.platform === "darwin" && existsSync("/usr/bin/sandbox-exec") && existsSync("/bin/bash");

function temporaryDirectory(prefix: string): string {
  const directory = mkdtempSync(path.join(tmpdir(), prefix));
  directories.push(directory);
  return directory;
}

function root(
  rootPath: string,
  access: PlatformSandboxRoot["access"] = "read_write",
  suffix = "1",
): PlatformSandboxRoot {
  return {
    grantId: `${suffix.repeat(8)}-${suffix.repeat(4)}-4${suffix.repeat(3)}-8${suffix.repeat(3)}-${suffix.repeat(12)}`,
    logicalName: `workspace-${suffix}`,
    rootPath,
    access,
  };
}

function request(input: {
  activeRoot: PlatformSandboxRoot;
  command: string;
  executionProfile?: BrokeredBashExecutionProfile;
  workspaceWriteMode?: PlatformSandboxExecutionRequest["workspaceWriteMode"];
  additionalRoots?: PlatformSandboxRoot[];
  timeoutMs?: number;
  environmentPolicy?: PlatformSandboxExecutionRequest["environmentPolicy"];
  networkPolicy?: PlatformSandboxExecutionRequest["networkPolicy"];
  signal?: AbortSignal;
  onOutput?: PlatformSandboxExecutionRequest["onOutput"];
}): PlatformSandboxExecutionRequest {
  return {
    identity: {
      generationId: crypto.randomUUID(),
      toolCallId: crypto.randomUUID(),
      piToolCallId: `pi-${crypto.randomUUID()}`,
    },
    shell: "bash",
    command: input.command,
    timeoutMs: input.timeoutMs ?? 5_000,
    executionProfile: input.executionProfile ?? "read_only",
    workspaceWriteMode:
      input.workspaceWriteMode ??
      (input.executionProfile === "workspace_write" ? "direct_workspace" : "none"),
    environmentPolicyId: brokeredBashEnvironmentPolicyId(
      input.environmentPolicy ?? BROKERED_BASH_CORE_ENVIRONMENT_POLICY,
    ),
    environmentPolicyDigest: brokeredBashEnvironmentPolicyDigest(
      input.environmentPolicy ?? BROKERED_BASH_CORE_ENVIRONMENT_POLICY,
    ),
    ...(input.environmentPolicy ? { environmentPolicy: input.environmentPolicy } : {}),
    networkPolicyId:
      input.networkPolicy?.mode === "controlled_egress"
        ? BROKERED_BASH_CONTROLLED_EGRESS_NETWORK_POLICY_ID
        : BROKERED_BASH_DENY_NETWORK_POLICY_ID,
    networkPolicyDigest: brokeredBashNetworkPolicyDigest(input.networkPolicy ?? { mode: "deny" }),
    ...(input.networkPolicy ? { networkPolicy: input.networkPolicy } : {}),
    activeRoot: input.activeRoot,
    additionalRoots: input.additionalRoots ?? [],
    resourceLimits: defaultPlatformSandboxResourceLimits(),
    signal: input.signal ?? new AbortController().signal,
    ...(input.onOutput ? { onOutput: input.onOutput } : {}),
  };
}

function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitForFile(filePath: string, timeoutMs = 5_000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (existsSync(filePath)) return readFileSync(filePath, "utf8");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`timed out waiting for ${path.basename(filePath)}`);
}

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("MacOSSandboxExecEngine contract", () => {
  it("compiles a default-deny profile without broad Mach or network access", () => {
    const profile = compileMacOSSandboxProfile({
      roots: [
        { rootPath: "/tmp/workspace-write", writable: true },
        { rootPath: "/tmp/workspace-read", writable: false },
      ],
      runnerTempRoot: "/tmp/runner-private",
      systemReadRoots: ["/usr", "/bin"],
    });
    expect(profile).toContain("(deny default)");
    expect(profile).toContain("(allow process-fork)");
    expect(profile).toContain("(allow process-exec)");
    expect(profile).toContain("(allow signal (target self) (target children))");
    expect(profile).toContain("(deny network*)");
    expect(profile).toContain('(regex-quote "/tmp/workspace-write")');
    expect(profile).toContain("\\.git(/|$)");
    expect(profile).toContain('(deny file-write* (literal "/tmp/workspace-read")');
    expect(profile).toContain("(deny file-link file-clone)");
    expect(profile).not.toContain("mach-lookup");
    expect(profile).not.toContain("(allow process*)");
    expect(profile).not.toContain("(allow network");

    const controlled = compileMacOSSandboxProfile({
      roots: [{ rootPath: "/tmp/workspace-read", writable: false }],
      runnerTempRoot: "/tmp/runner-private",
      systemReadRoots: ["/usr", "/bin"],
      egressProxyPort: 41_337,
    });
    expect(controlled).toContain('(allow network-outbound (remote tcp "localhost:41337"))');
    expect(controlled).not.toContain("(allow network*)");
  });

  it("fails capability discovery closed on unsupported or missing backends", async () => {
    for (const platform of ["linux", "win32"] as const) {
      await expect(new MacOSSandboxExecEngine({ platform }).probe()).resolves.toMatchObject({
        available: false,
        platform,
        reason: "BROKERED_BASH_PLATFORM_UNSUPPORTED",
        supportedProfiles: [],
      });
    }
    await expect(
      new MacOSSandboxExecEngine({
        platform: "darwin",
        sandboxExecutable: "/missing/openerx-sandbox-exec",
      }).probe(),
    ).resolves.toMatchObject({
      available: false,
      reason: "BROKERED_BASH_SANDBOX_EXEC_MISSING",
    });
    await expect(
      new MacOSSandboxExecEngine({
        platform: "darwin",
        sandboxExecutable: process.execPath,
        bashExecutable: "/missing/openerx-bash",
      }).probe(),
    ).resolves.toMatchObject({
      available: false,
      reason: "BROKERED_BASH_BASH_MISSING",
    });
    await expect(
      new MacOSSandboxExecEngine({
        platform: "darwin",
        sandboxExecutable: process.execPath,
        bashExecutable: process.execPath,
      }).probe(),
    ).resolves.toMatchObject({
      available: false,
      reason: "BROKERED_BASH_CAPABILITY_PROBE_FAILED",
    });
  });

  it("passes the live enforcement probe on a supported macOS host", async () => {
    if (!liveMacOS) return;
    await expect(new MacOSSandboxExecEngine().probe()).resolves.toMatchObject({
      available: true,
      reason: null,
      backendId: "macos_sandbox_exec",
      policyVersion: "macos-seatbelt-v1",
      supportedProfiles: ["read_only", "workspace_write"],
      capabilities: {
        filesystemBoundary: true,
        hardlinkBoundary: true,
        networkDeny: true,
        sanitizedEnvironment: true,
        processGroupCleanup: true,
        pty: false,
      },
    });
  });

  it("runs an opt-in workspace_write smoke against the current repository", async () => {
    if (!liveMacOS || process.env.OPENERX_PBASH_REPO_SMOKE !== "1") return;
    const repositoryRoot = path.resolve(import.meta.dirname, "../../..");
    const engine = new MacOSSandboxExecEngine();
    const result = await engine.execute(
      request({
        activeRoot: root(repositoryRoot, "read_write", "a"),
        executionProfile: "workspace_write",
        command: `node -p ${JSON.stringify('"pbash-repo-smoke"')}`,
        timeoutMs: 30_000,
      }),
    );
    expect(result.exitCode, result.output).toBe(0);
    expect(result.output).toContain("pbash-repo-smoke");
    await engine.stopAll();
  });

  it("allows authorized reads but denies workspace writes, outside reads and symlink escapes", async () => {
    if (!liveMacOS) return;
    const workspace = temporaryDirectory("openerx-pbash-readonly-");
    const outside = temporaryDirectory("openerx-pbash-outside-");
    writeFileSync(path.join(workspace, "input.txt"), "authorized-read");
    const outsideFile = path.join(outside, "secret.txt");
    writeFileSync(outsideFile, "outside-secret");
    symlinkSync(outsideFile, path.join(workspace, "outside-link"));
    const engine = new MacOSSandboxExecEngine();
    const activeRoot = root(workspace, "read_write");

    const read = await engine.execute(
      request({
        activeRoot,
        command: 'cat input.txt; printf \'\\nPWD=%s\\nHOME=%s\\n\' "$PWD" "$HOME"; env',
      }),
    );
    expect(read, read.output).toMatchObject({
      exitCode: 0,
      timedOut: false,
      cancelled: false,
      outputTruncated: false,
      changedPathManifestStatus: "not_applicable",
      workspaceChanges: null,
      proof: {
        filesystemBoundary: true,
        hardlinkBoundary: true,
        environmentSanitized: true,
        networkDenied: true,
      },
    });
    expect(read.output).toContain("authorized-read");
    expect(read.output).toContain("PWD=<workspace>");
    expect(read.output).toContain("HOME=<runner-temp>/home");
    expect(read.output).toContain("OPENSSL_CONF=/dev/null");
    expect(read.output).not.toContain(workspace);
    expect(read.output).not.toContain(process.env.HOME ?? "__missing_home__");
    expect(read.output).not.toMatch(/SSH_AUTH_SOCK=|CODEX_|OPENAI_|PI_/u);

    const deniedWrite = await engine.execute(
      request({ activeRoot, command: "touch read-only-must-not-exist" }),
    );
    expect(deniedWrite.exitCode).not.toBe(0);
    expect(existsSync(path.join(workspace, "read-only-must-not-exist"))).toBe(false);

    const deniedOutside = await engine.execute(
      request({ activeRoot, command: `cat ${JSON.stringify(outsideFile)}` }),
    );
    expect(deniedOutside.exitCode).not.toBe(0);
    expect(deniedOutside.output).not.toContain("outside-secret");

    const deniedSymlink = await engine.execute(
      request({ activeRoot, command: "cat outside-link" }),
    );
    expect(deniedSymlink.exitCode).not.toBe(0);
    expect(deniedSymlink.output).not.toContain("outside-secret");

    for (const restrictedSystemConfig of ["/opt/homebrew/etc/smartd.conf", "/private/etc/hosts"]) {
      if (!existsSync(restrictedSystemConfig)) continue;
      const deniedSystemConfig = await engine.execute(
        request({
          activeRoot,
          command: `head -c 1 ${JSON.stringify(restrictedSystemConfig)}`,
        }),
      );
      expect(deniedSystemConfig.exitCode).not.toBe(0);
    }
    await engine.stopAll();
  });

  it("enforces none/include/exclude/set and strips live host credential canaries", async () => {
    if (!liveMacOS) return;
    const workspace = temporaryDirectory("openerx-pbash-environment-");
    const canaries = {
      SAFE_BUILD_FLAG: "safe-visible",
      SSH_AUTH_SOCK: "/tmp/ssh-agent-canary.sock",
      GIT_ASKPASS: "/tmp/git-askpass-canary",
      NPM_TOKEN: "npm-token-canary",
      PIP_INDEX_URL: "https://user:pass@pip.invalid/simple",
      AWS_ACCESS_KEY_ID: "aws-access-canary",
      GOOGLE_APPLICATION_CREDENTIALS: "/tmp/gcp-canary.json",
      AZURE_CLIENT_SECRET: "azure-secret-canary",
      GITHUB_TOKEN: "github-token-canary",
      PI_SESSION_TOKEN: "pi-token-canary",
      HTTPS_PROXY: "http://user:pass@proxy.invalid",
      SAFE_LOOKING_VALUE: "token=disguised-canary",
    };
    const previous = Object.fromEntries(
      Object.keys(canaries).map((name) => [name, process.env[name]]),
    );
    Object.assign(process.env, canaries);
    const engine = new MacOSSandboxExecEngine();
    try {
      const result = await engine.execute(
        request({
          activeRoot: root(workspace),
          environmentPolicy: {
            mode: "none",
            include: Object.keys(canaries),
            exclude: [],
            set: { SAFE_SET_VALUE: "set-visible" },
          },
          command: "/usr/bin/env",
        }),
      );
      expect(result.exitCode, result.output).toBe(0);
      expect(result.output).toContain("SAFE_BUILD_FLAG=safe-visible");
      expect(result.output).toContain("SAFE_SET_VALUE=set-visible");
      expect(result.output).not.toContain("HOME=");
      for (const value of Object.values(canaries).slice(1)) {
        expect(result.output).not.toContain(value);
      }

      await expect(
        engine.execute(
          request({
            activeRoot: root(workspace),
            environmentPolicy: {
              mode: "all",
              include: [],
              exclude: [],
              set: {},
            },
            command: "/usr/bin/true",
          }),
        ),
      ).rejects.toThrow("BROKERED_BASH_ENVIRONMENT_ALL_DENIED");
    } finally {
      for (const [name, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
      await engine.stopAll();
    }
  });

  it("writes only read-write roots while preserving .git and read-only additional roots", async () => {
    if (!liveMacOS) return;
    const workspace = temporaryDirectory("openerx-pbash-write-");
    const additional = temporaryDirectory("openerx-pbash-additional-");
    const outside = temporaryDirectory("openerx-pbash-hardlink-outside-");
    mkdirSync(path.join(workspace, ".git"));
    mkdirSync(path.join(workspace, "nested", ".git"), { recursive: true });
    writeFileSync(path.join(workspace, ".git", "config"), "original-git-metadata");
    writeFileSync(path.join(workspace, "nested", ".git", "config"), "original-nested-git-metadata");
    writeFileSync(path.join(additional, "shared.txt"), "additional-read");
    const outsideFile = path.join(outside, "hardlink-canary.txt");
    writeFileSync(outsideFile, "outside-hardlink-original");
    const engine = new MacOSSandboxExecEngine();
    const activeRoot = root(workspace, "read_write", "3");
    const additionalRoot = root(additional, "read_only", "4");

    const write = await engine.execute(
      request({
        activeRoot,
        additionalRoots: [additionalRoot],
        executionProfile: "workspace_write",
        command:
          'printf workspace-write > created.txt; cat "$OPENERX_WORKSPACE_1/shared.txt"; cd "$OPENERX_WORKSPACE_1"; pwd',
      }),
    );
    expect(write.exitCode, write.output).toBe(0);
    expect(readFileSync(path.join(workspace, "created.txt"), "utf8")).toBe("workspace-write");
    expect(write.changedPathManifestStatus).toBe("collected");
    expect(write.workspaceChanges).toMatchObject({
      mode: "DIRECT_WORKSPACE_WRITE",
      undo: "NOT_AVAILABLE_FOR_DIRECT_WRITE",
      manifest: [
        expect.objectContaining({
          relativePath: "created.txt",
          kind: "created",
          diffStatus: "available",
        }),
      ],
    });
    expect(write.workspaceChanges?.diffs[0]?.patch).toContain("+workspace-write");
    expect(write.output).toContain("additional-read");
    expect(write.output).not.toContain(additional);

    const deniedAdditional = await engine.execute(
      request({
        activeRoot,
        additionalRoots: [additionalRoot],
        executionProfile: "workspace_write",
        command: 'printf blocked > "$OPENERX_WORKSPACE_1/blocked.txt"',
      }),
    );
    expect(deniedAdditional.exitCode).not.toBe(0);
    expect(existsSync(path.join(additional, "blocked.txt"))).toBe(false);

    const deniedGit = await engine.execute(
      request({
        activeRoot,
        executionProfile: "workspace_write",
        command: "printf changed > .git/config",
      }),
    );
    expect(deniedGit.exitCode).not.toBe(0);
    expect(readFileSync(path.join(workspace, ".git", "config"), "utf8")).toBe(
      "original-git-metadata",
    );

    const deniedNestedGit = await engine.execute(
      request({
        activeRoot,
        executionProfile: "workspace_write",
        command: "printf changed > nested/.git/config",
      }),
    );
    expect(deniedNestedGit.exitCode).not.toBe(0);
    expect(readFileSync(path.join(workspace, "nested", ".git", "config"), "utf8")).toBe(
      "original-nested-git-metadata",
    );

    const deniedHardlinkCreation = await engine.execute(
      request({
        activeRoot,
        additionalRoots: [additionalRoot],
        executionProfile: "workspace_write",
        command: 'ln "$OPENERX_WORKSPACE_1/shared.txt" linked-read-only.txt',
      }),
    );
    expect(deniedHardlinkCreation.exitCode).not.toBe(0);
    expect(existsSync(path.join(workspace, "linked-read-only.txt"))).toBe(false);
    expect(readFileSync(path.join(additional, "shared.txt"), "utf8")).toBe("additional-read");

    writeFileSync(path.join(workspace, "internal-hardlink-source.txt"), "internal-original");
    linkSync(
      path.join(workspace, "internal-hardlink-source.txt"),
      path.join(workspace, "internal-hardlink-alias.txt"),
    );
    const allowedInternalHardlink = await engine.execute(
      request({
        activeRoot,
        executionProfile: "workspace_write",
        command: "printf internal-changed > internal-hardlink-alias.txt",
      }),
    );
    expect(allowedInternalHardlink.exitCode).toBe(0);
    expect(readFileSync(path.join(workspace, "internal-hardlink-source.txt"), "utf8")).toBe(
      "internal-changed",
    );

    linkSync(outsideFile, path.join(workspace, "hardlink-canary.txt"));
    await expect(
      engine.execute(
        request({
          activeRoot,
          command: "cat hardlink-canary.txt",
        }),
      ),
    ).rejects.toThrow("BROKERED_BASH_HARDLINK_BOUNDARY_UNSAFE");
    await expect(
      engine.execute(
        request({
          activeRoot,
          executionProfile: "workspace_write",
          command: "printf changed > hardlink-canary.txt",
        }),
      ),
    ).rejects.toThrow("BROKERED_BASH_HARDLINK_BOUNDARY_UNSAFE");
    expect(readFileSync(outsideFile, "utf8")).toBe("outside-hardlink-original");
    await engine.stopAll();
  });

  it("runs isolated_change_set in a CoW working copy without mutating the host workspace", async () => {
    if (!liveMacOS) return;
    const workspace = temporaryDirectory("openerx-pbash-isolated-");
    writeFileSync(path.join(workspace, "existing.txt"), "host-original");
    const engine = new MacOSSandboxExecEngine();
    const result = await engine.execute(
      request({
        activeRoot: root(workspace, "read_write", "b"),
        executionProfile: "workspace_write",
        workspaceWriteMode: "isolated_change_set",
        command:
          "printf isolated > existing.txt; printf created > created.txt; mkdir -p node_modules/pkg; printf cache > node_modules/pkg/cache.txt",
      }),
    );
    expect(result.exitCode, result.output).toBe(0);
    expect(readFileSync(path.join(workspace, "existing.txt"), "utf8")).toBe("host-original");
    expect(existsSync(path.join(workspace, "created.txt"))).toBe(false);
    expect(result.workspaceChanges).toMatchObject({
      mode: "ISOLATED_CHANGE_SET",
      hostWorkspaceMutated: false,
      undo: "REVIEW_REQUIRED_BEFORE_APPLY",
      manifest: expect.arrayContaining([
        expect.objectContaining({
          relativePath: "created.txt",
          kind: "created",
        }),
        expect.objectContaining({
          relativePath: "existing.txt",
          kind: "modified",
        }),
      ]),
      excludedPathCount: 3,
    });
    expect(
      result.workspaceChanges?.manifest.some(({ relativePath }) =>
        relativePath.includes("node_modules"),
      ),
    ).toBe(false);
    await engine.stopAll();
  });

  it("rejects broad, missing, duplicate and nested workspace roots before spawning", async () => {
    if (!liveMacOS) return;
    const workspace = temporaryDirectory("openerx-pbash-root-validation-");
    const nested = path.join(workspace, "nested");
    const protectedGit = path.join(workspace, ".git");
    mkdirSync(nested);
    mkdirSync(protectedGit);
    const engine = new MacOSSandboxExecEngine();

    await expect(
      engine.execute(request({ activeRoot: root("/", "read_write", "8"), command: "true" })),
    ).rejects.toThrow("BROKERED_BASH_BROAD_WORKSPACE_DENIED");
    await expect(
      engine.execute(
        request({
          activeRoot: root(path.join(workspace, "missing"), "read_write", "8"),
          command: "true",
        }),
      ),
    ).rejects.toThrow("BROKERED_BASH_WORKSPACE_ROOT_INVALID");
    await expect(
      engine.execute(
        request({
          activeRoot: root(protectedGit, "read_write", "7"),
          command: "true",
        }),
      ),
    ).rejects.toThrow("BROKERED_BASH_PROTECTED_WORKSPACE_DENIED");
    await expect(
      engine.execute(
        request({
          activeRoot: root(workspace, "read_write", "8"),
          additionalRoots: [root(workspace, "read_only", "9")],
          command: "true",
        }),
      ),
    ).rejects.toThrow("BROKERED_BASH_WORKSPACE_ROOT_OVERLAP");
    await expect(
      engine.execute(
        request({
          activeRoot: root(workspace, "read_write", "8"),
          additionalRoots: [root(nested, "read_only", "9")],
          command: "true",
        }),
      ),
    ).rejects.toThrow("BROKERED_BASH_WORKSPACE_ROOT_OVERLAP");
    await engine.stopAll();
  });

  it("bounds captured output before returning it to the Broker", async () => {
    if (!liveMacOS) return;
    const workspace = temporaryDirectory("openerx-pbash-output-limit-");
    const engine = new MacOSSandboxExecEngine();
    const limited = request({
      activeRoot: root(workspace, "read_write", "2"),
      command: "printf '%080d' 0",
    });
    limited.resourceLimits = { ...limited.resourceLimits, maxOutputBytes: 32 };
    const result = await engine.execute(limited);
    expect(result.exitCode, result.output).toBe(0);
    expect(result.outputTruncated).toBe(true);
    expect(Buffer.byteLength(result.stdout, "utf8")).toBeLessThanOrEqual(32);
    expect(Buffer.byteLength(result.output, "utf8")).toBeLessThanOrEqual(32);
    await engine.stopAll();
  });

  it("streams ordered output only after cross-chunk sanitization", async () => {
    if (!liveMacOS) return;
    const workspace = temporaryDirectory("openerx-pbash-progress-");
    const engine = new MacOSSandboxExecEngine();
    const progress: Array<{
      sequence: number;
      delta: string;
      truncated: boolean;
    }> = [];
    const result = await engine.execute(
      request({
        activeRoot: root(workspace),
        command:
          "printf '\\033[31m%s token=super' \"$PWD\"; sleep 0.05; printf '%s\\033[0m\\n' '-secret-value'",
        onOutput: (frame) => progress.push(frame),
      }),
    );
    expect(progress.map(({ sequence }) => sequence)).toEqual([1]);
    expect(progress.map(({ delta }) => delta).join("")).toBe("<workspace> token=<redacted>\n");
    expect(result.output).toBe("<workspace> token=<redacted>\n");
    expect(JSON.stringify({ progress, result })).not.toContain(workspace);
    expect(JSON.stringify({ progress, result })).not.toContain("super-secret-value");
  });

  it("denies loopback network access independently of command text", async () => {
    if (!liveMacOS) return;
    const workspace = temporaryDirectory("openerx-pbash-network-");
    const server = createServer((_request, response) => response.end("must-not-reach"));
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("server address missing");
      const engine = new MacOSSandboxExecEngine();
      const result = await engine.execute(
        request({
          activeRoot: root(workspace),
          command: `node -e "require('node:http').get('http://127.0.0.1:${address.port}',r=>r.pipe(process.stdout)).on('error',()=>process.exit(23))"`,
        }),
      );
      expect(result.exitCode).toBe(23);
      expect(result.output).not.toContain("must-not-reach");
      await engine.stopAll();
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });

  it("allows an explicit public domain only through the controlled proxy", async () => {
    if (!liveMacOS) return;
    const workspace = temporaryDirectory("openerx-pbash-egress-");
    const engine = new MacOSSandboxExecEngine();
    const result = await engine.execute(
      request({
        activeRoot: root(workspace),
        networkPolicy: {
          mode: "controlled_egress",
          allowedDomains: ["example.com"],
        },
        command:
          "/usr/bin/curl -fsS --max-time 15 https://example.com/ | /usr/bin/grep -q Example && ! /usr/bin/curl --noproxy '*' -fsS --max-time 3 https://example.com/ >/dev/null 2>&1",
        timeoutMs: 25_000,
      }),
    );
    expect(result.exitCode, result.output).toBe(0);
    expect(result.proof).toMatchObject({
      networkDenied: true,
      controlledEgress: true,
      networkPolicyId: "network-controlled-egress-v1",
      networkPolicyDigest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u),
    });
    await engine.stopAll();
  });

  it("cannot signal a process outside the owned sandbox process tree", async () => {
    if (!liveMacOS) return;
    const workspace = temporaryDirectory("openerx-pbash-signal-escape-");
    const processCanary = "pbash-host-process-secret-must-not-leak";
    const outside = spawn("/bin/sleep", ["60"], {
      stdio: "ignore",
      env: {
        PATH: "/usr/bin:/bin",
        OPENERX_HOST_PROCESS_CANARY: processCanary,
      },
    });
    await new Promise<void>((resolve, reject) => {
      outside.once("spawn", resolve);
      outside.once("error", reject);
    });
    const outsidePid = outside.pid;
    if (!outsidePid) throw new Error("outside process missing pid");
    try {
      const engine = new MacOSSandboxExecEngine();
      const result = await engine.execute(
        request({
          activeRoot: root(workspace, "read_write", "7"),
          command: `/bin/ps eww -p ${outsidePid}; kill -TERM ${outsidePid}`,
        }),
      );
      expect(result.exitCode).not.toBe(0);
      expect(result.output).not.toContain(processCanary);
      expect(processExists(outsidePid)).toBe(true);
      await engine.stopAll();
    } finally {
      outside.kill("SIGKILL");
    }
  });

  it("terminates the owned process group on timeout and stopAll", async () => {
    if (!liveMacOS) return;
    const workspace = temporaryDirectory("openerx-pbash-process-");
    const engine = new MacOSSandboxExecEngine();
    const timedOut = await engine.execute(
      request({
        activeRoot: root(workspace),
        command: "sleep 60 & child=$!; echo $child; wait $child",
        timeoutMs: 300,
      }),
    );
    const timedOutPid = Number(timedOut.stdout.trim().split(/\s+/u)[0]);
    expect(timedOut, timedOut.output).toMatchObject({
      timedOut: true,
      cancelled: false,
    });
    expect(timedOut.destructionStatus).not.toBe("uncertain");
    expect(Number.isInteger(timedOutPid) && timedOutPid > 0).toBe(true);
    expect(processExists(timedOutPid)).toBe(false);

    const stopPidPath = path.join(workspace, "stop.pid");
    const running = engine.execute(
      request({
        activeRoot: root(workspace, "read_write", "5"),
        executionProfile: "workspace_write",
        command: "echo $$ > stop.pid; sleep 60",
        timeoutMs: 10_000,
      }),
    );
    const stoppedPid = Number((await waitForFile(stopPidPath)).trim());
    await engine.stopAll();
    const stopped = await running;
    expect(stopped.cancelled).toBe(true);
    expect(stopped.destructionStatus).not.toBe("uncertain");
    expect(processExists(stoppedPid)).toBe(false);
  });

  it("removes residual descendants after the shell exits naturally", async () => {
    if (!liveMacOS) return;
    const workspace = temporaryDirectory("openerx-pbash-natural-exit-");
    const engine = new MacOSSandboxExecEngine();
    const result = await engine.execute(
      request({
        activeRoot: root(workspace, "read_write", "3"),
        command: "sleep 60 & echo $!",
      }),
    );
    const residualPid = Number(result.stdout.trim().split(/\s+/u)[0]);
    expect(result.exitCode).toBe(0);
    expect(result.timedOut).toBe(false);
    expect(result.cancelled).toBe(false);
    expect(result.destructionStatus).not.toBe("uncertain");
    expect(Number.isInteger(residualPid) && residualPid > 0).toBe(true);
    expect(processExists(residualPid)).toBe(false);
  });

  it("terminates the owned process group when its AbortSignal is cancelled", async () => {
    if (!liveMacOS) return;
    const workspace = temporaryDirectory("openerx-pbash-abort-");
    const engine = new MacOSSandboxExecEngine();
    const controller = new AbortController();
    const abortPidPath = path.join(workspace, "abort.pid");
    const running = engine.execute(
      request({
        activeRoot: root(workspace, "read_write", "6"),
        executionProfile: "workspace_write",
        command: "echo $$ > abort.pid; sleep 60",
        timeoutMs: 10_000,
        signal: controller.signal,
      }),
    );
    const cancelledPid = Number((await waitForFile(abortPidPath)).trim());
    controller.abort();
    const cancelled = await running;
    expect(cancelled.cancelled).toBe(true);
    expect(cancelled.timedOut).toBe(false);
    expect(cancelled.destructionStatus).not.toBe("uncertain");
    expect(processExists(cancelledPid)).toBe(false);
  });
});
