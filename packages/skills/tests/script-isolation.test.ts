import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { SkillRepository } from "@openerx/storage";
import { ShellToolAdapter } from "@openerx/tool-sdk";
import { strToU8, zipSync } from "fflate";
import { afterEach, expect, test, vi } from "vitest";
import { SkillPackageService, SkillToolAdapter } from "../src";

const roots: string[] = [];
test.each(["MANAGED_NODE_RUNTIME_MISSING", "MANAGED_NODE_RUNTIME_INTEGRITY_FAILED"] as const)(
  "Skill text remains readable while script dispatch fails closed for %s",
  async (nodeRuntimeError) => {
    const f = fixture();
    const execute = vi.spyOn(ShellToolAdapter.prototype, "execute");
    const adapter = new SkillToolAdapter(f.service, new Map([[f.skillId, "1.0.0"]]), {
      nodeRuntimeError,
      isolatedScripts: true,
    });
    const context = { toolCallId: randomUUID(), signal: new AbortController().signal, update() {} };
    try {
      const text = await adapter.execute(
        {
          operation: "skill_read",
          installationId: f.skillId,
          relativePath: "SKILL.md",
          idempotencyKey: "runtime-text",
        },
        context,
      );
      expect(text.summary).toContain("Loaded company-script/SKILL.md");
      await expect(
        adapter.execute(
          {
            operation: "skill_script_execute",
            installationId: f.skillId,
            relativePath: "scripts/helper.mjs",
            args: [],
            timeoutMs: 1000,
            allowNetwork: false,
            idempotencyKey: "runtime-refused",
          },
          context,
        ),
      ).rejects.toThrow(nodeRuntimeError);
      expect(execute).not.toHaveBeenCalled();
    } finally {
      await adapter.stopAll();
      f.service.close();
    }
  },
);
test.each([false, true])(
  "managed Node is explicit for normal and isolated Skill scripts (isolated=%s)",
  async (isolatedScripts) => {
    const f = fixture();
    const nodeRuntime = {
      nodeVersion: "24.21.0",
      npmVersion: "11.19.0",
      platform: "win32" as const,
      architecture: "x64" as const,
      rootDirectory: f.root,
      binDirectory: f.root,
      nodeExecutable: path.join(f.root, "trusted-node.exe"),
      npmCli: path.join(f.root, "npm-cli.js"),
      npxCli: path.join(f.root, "npx-cli.js"),
      manifestPath: path.join(f.root, "manifest.json"),
      manifestSha256: "a".repeat(64),
    };
    const execute = vi
      .spyOn(ShellToolAdapter.prototype, "execute")
      .mockImplementation(async (operation) => {
        if (operation.operation !== "shell_execute") throw new Error("unexpected operation");
        expect(operation.command).toBe(nodeRuntime.nodeExecutable);
        expect(operation.args).toEqual([
          path.join(operation.cwd!, "scripts/helper.mjs"),
          "argument with spaces",
          "& literal",
        ]);
        expect(operation.allowNetwork).toBe(false);
        return {
          summary: "trusted runtime",
          content: [],
          sources: [],
          artifacts: [],
          sideEffectCommitted: true,
          durationMs: 1,
        };
      });
    const adapter = new SkillToolAdapter(f.service, new Map([[f.skillId, "1.0.0"]]), {
      isolatedScripts,
      nodeRuntime,
    });
    try {
      await adapter.execute(
        {
          operation: "skill_script_execute",
          installationId: f.skillId,
          relativePath: "scripts/helper.mjs",
          args: ["argument with spaces", "& literal"],
          timeoutMs: 1000,
          allowNetwork: false,
          idempotencyKey: "managed-runtime-script",
        },
        { toolCallId: randomUUID(), signal: new AbortController().signal, update() {} },
      );
      expect(execute).toHaveBeenCalledTimes(1);
    } finally {
      await adapter.stopAll();
      f.service.close();
    }
  },
);
afterEach(() => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), "skill-copy-test-"));
  roots.push(root);
  const scope = {
    authorityOrigin: "https://enterprise.example.test",
    accountId: randomUUID(),
    tenantId: randomUUID(),
    credentialId: randomUUID(),
    membershipEpisode: randomUUID(),
  };
  const skillId = randomUUID();
  const service = new SkillPackageService(
    new SkillRepository(path.join(root, "skills.sqlite"), { enterpriseScope: scope }),
    root,
    "darwin",
  );
  const install = (version: string) => {
    const bytes = zipSync({
      "SKILL.md": strToU8(
        "---\nname: company-script\ndescription: Run a company script.\n---\nRun scripts/helper.mjs.",
      ),
      "agents/openai.yaml": strToU8(
        `version: ${version}\nplatforms: [darwin, win32]\nscripts: [scripts/helper.mjs]\npermissions: []\n`,
      ),
      "scripts/helper.mjs": strToU8(`console.log('version ${version}');`),
      "assets/input.txt": strToU8(`reference ${version}`),
    });
    const sourcePath = path.join(root, "skill.zip");
    writeFileSync(sourcePath, bytes);
    return service.installEnterpriseArchive({
      installationId: skillId,
      sourcePath,
      expectedName: "company-script",
      source: {
        ...scope,
        skillId,
        version,
        archiveSha256: createHash("sha256").update(bytes).digest("hex"),
        catalogRevision: "1",
        sizeBytes: bytes.length,
      },
    });
  };
  install("1.0.0");
  return { root, skillId, service, install };
}
test("script copies contain the pinned version and do not modify the managed package", () => {
  const f = fixture();
  try {
    f.install("2.0.0");
    const original = f.service.versionMount(f.skillId, "1.0.0");
    const copy = f.service.scriptExecutionCopy(f.skillId, "scripts/helper.mjs", false, "1.0.0");
    try {
      expect(copy.packagePath.startsWith(f.service.packagesDirectory())).toBe(false);
      expect(readFileSync(copy.absolutePath, "utf8")).toContain("version 1.0.0");
      expect(readFileSync(path.join(copy.packagePath, "assets/input.txt"), "utf8")).toBe(
        "reference 1.0.0",
      );
      writeFileSync(copy.absolutePath, "changed only in scratch");
      expect(readFileSync(path.join(original.baseDir, "scripts/helper.mjs"), "utf8")).toContain(
        "version 1.0.0",
      );
      f.service.versionMount(f.skillId, "1.0.0");
    } finally {
      copy.dispose();
    }
    expect(existsSync(copy.packagePath)).toBe(false);
  } finally {
    f.service.close();
  }
});
test("isolated adapters remove their scratch directory after execution and reject cancelled dispatch", async () => {
  const f = fixture();
  let scratch = "";
  const execute = vi
    .spyOn(ShellToolAdapter.prototype, "execute")
    .mockImplementation(async (operation) => {
      if (operation.operation !== "shell_execute") throw new Error("unexpected operation");
      if (!operation.cwd || !operation.args[0]) throw new Error("missing script scope");
      scratch = operation.cwd;
      expect(operation.args[0]).toBe(path.join(scratch, "scripts/helper.mjs"));
      expect(operation.allowNetwork).toBe(false);
      expect(readFileSync(operation.args[0], "utf8")).toContain("version 1.0.0");
      return {
        summary: "script fixture",
        content: [],
        sources: [],
        artifacts: [],
        sideEffectCommitted: true,
        durationMs: 1,
      };
    });
  const adapter = new SkillToolAdapter(f.service, new Map([[f.skillId, "1.0.0"]]), {
    isolatedScripts: true,
  });
  const operation = {
    operation: "skill_script_execute" as const,
    installationId: f.skillId,
    relativePath: "scripts/helper.mjs",
    args: [],
    timeoutMs: 1000,
    allowNetwork: false,
    idempotencyKey: "script-copy",
  };
  try {
    await adapter.execute(operation, {
      toolCallId: randomUUID(),
      signal: new AbortController().signal,
      update() {},
    });
    expect(existsSync(scratch)).toBe(false);
    const stop = new AbortController();
    stop.abort(new Error("cancelled before dispatch"));
    await expect(
      adapter.execute(operation, { toolCallId: randomUUID(), signal: stop.signal, update() {} }),
    ).rejects.toThrow("cancelled before dispatch");
    expect(execute).toHaveBeenCalledTimes(1);
    await expect(
      adapter.execute(
        { ...operation, allowNetwork: true },
        { toolCallId: randomUUID(), signal: new AbortController().signal, update() {} },
      ),
    ).rejects.toThrow("SKILL_NETWORK_NOT_DECLARED");
  } finally {
    await adapter.stopAll();
    f.service.close();
  }
});
test("damaged pinned sources and undeclared scripts fail before making a copy", () => {
  const f = fixture();
  try {
    expect(() =>
      f.service.scriptExecutionCopy(f.skillId, "scripts/other.mjs", false, "1.0.0"),
    ).toThrow("SKILL_SCRIPT_NOT_DECLARED");
    const mount = f.service.versionMount(f.skillId, "1.0.0");
    writeFileSync(path.join(mount.baseDir, "assets/input.txt"), "modified content");
    expect(() =>
      f.service.scriptExecutionCopy(f.skillId, "scripts/helper.mjs", false, "1.0.0"),
    ).toThrow("SKILL_PACKAGE_DAMAGED");
  } finally {
    f.service.close();
  }
});

test("scratch cleanup also runs when the execution host cannot initialize", async () => {
  const f = fixture();
  const dispose = vi.fn();
  vi.spyOn(f.service, "scriptExecutionCopy").mockReturnValue({
    name: "company-script",
    packagePath: path.join(f.root, "missing-host-root"),
    absolutePath: path.join(f.root, "missing-host-root", "scripts/helper.mjs"),
    dispose,
  });
  const adapter = new SkillToolAdapter(f.service, new Map([[f.skillId, "1.0.0"]]), {
    isolatedScripts: true,
  });
  try {
    await expect(
      adapter.execute(
        {
          operation: "skill_script_execute",
          installationId: f.skillId,
          relativePath: "scripts/helper.mjs",
          args: [],
          timeoutMs: 1000,
          allowNetwork: false,
          idempotencyKey: "host-init-failure",
        },
        { toolCallId: randomUUID(), signal: new AbortController().signal, update() {} },
      ),
    ).rejects.toThrow();
    expect(dispose).toHaveBeenCalledOnce();
  } finally {
    await adapter.stopAll();
    f.service.close();
  }
});
