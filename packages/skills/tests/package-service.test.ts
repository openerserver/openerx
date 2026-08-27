import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { SkillRepository } from "@openerx/storage";
import { zipSync } from "fflate";
import { afterEach, describe, expect, it } from "vitest";
import { SkillPackageService, SkillToolAdapter } from "../src";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function profile(): { root: string; repository: SkillRepository; service: SkillPackageService } {
  const root = mkdtempSync(path.join(tmpdir(), "openerx-skills-"));
  roots.push(root);
  const repository = new SkillRepository(path.join(root, "profile.sqlite"));
  return { root, repository, service: new SkillPackageService(repository, root, "darwin") };
}

function writeSkill(
  root: string,
  input: {
    name?: string;
    version?: string;
    permissions?: string;
    scripts?: string;
    scriptContent?: string;
  } = {},
): string {
  const directory = path.join(root, `source-${input.version ?? "1.0.0"}-${Math.random()}`);
  mkdirSync(path.join(directory, "agents"), { recursive: true });
  mkdirSync(path.join(directory, "references"), { recursive: true });
  mkdirSync(path.join(directory, "scripts"), { recursive: true });
  const name = input.name ?? "fixture-skill";
  const permissions =
    input.permissions === "[]"
      ? "permissions: []"
      : `permissions:\n${
          input.permissions ??
          "  - capability: shell\n    actions: [execute]\n    targets: [scripts/run.mjs]\n    reason: Run fixture script."
        }`;
  const scripts =
    input.scripts === "[]" ? "scripts: []" : `scripts:\n${input.scripts ?? "  - scripts/run.mjs"}`;
  writeFileSync(
    path.join(directory, "SKILL.md"),
    `---\nname: ${name}\ndescription: Fixture skill for package lifecycle tests.\n---\n\nRead references/template.md.\n`,
  );
  writeFileSync(path.join(directory, "references", "template.md"), "fixture template\n");
  writeFileSync(
    path.join(directory, "agents", "openai.yaml"),
    `version: ${input.version ?? "1.0.0"}\npublisher: Fixture Publisher\n${permissions}\nplatforms: [darwin, win32]\n${scripts}\n`,
  );
  writeFileSync(
    path.join(directory, "scripts", "run.mjs"),
    input.scriptContent ?? 'process.stdout.write("fixture:" + (process.argv[2] ?? "none"));\n',
  );
  return directory;
}

describe("SkillPackageService", () => {
  it("seeds a bundled Skill, exposes resources, and executes its declared script adapter", async () => {
    const { repository, service } = profile();
    const builtIns = service.seedBuiltIns();
    const [builtIn] = builtIns;
    expect(builtIn).toMatchObject({
      name: "structured-report",
      scope: "builtin",
      trust: "bundled",
      enabled: true,
      packageState: "installed",
    });
    expect(builtIns.map(({ name }) => name)).toEqual([
      "structured-report",
      "documents",
      "spreadsheets",
      "presentations",
      "pdf",
    ]);
    expect(service.mounts("default")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ installationId: builtIn?.id, name: "structured-report" }),
        expect.objectContaining({ name: "documents" }),
        expect.objectContaining({ name: "spreadsheets" }),
        expect.objectContaining({ name: "presentations" }),
        expect.objectContaining({ name: "pdf" }),
      ]),
    );
    expect(service.readResource(builtIn?.id ?? "", "references/template.md").content).toContain(
      "Executive summary",
    );

    const adapter = new SkillToolAdapter(service);
    const result = await adapter.execute(
      {
        operation: "skill_script_execute",
        idempotencyKey: "skill-script-test-0001",
        installationId: builtIn?.id ?? "",
        relativePath: "scripts/render.mjs",
        args: ["Quarterly review"],
        timeoutMs: 5_000,
        allowNetwork: false,
      },
      {
        signal: new AbortController().signal,
        toolCallId: "tool-call",
        update() {},
      },
    );
    expect(result.summary).toContain("Quarterly review");
    expect(result.data).toMatchObject({ state: "completed", exitCode: 0 });
    await adapter.stopAll();
    repository.close();
  });

  it("separates install from permission approval and resets approval on an expanded update", () => {
    const { root, repository, service } = profile();
    const version1 = writeSkill(root);
    let skill = service.install({
      sourcePath: version1,
      sourceKind: "local_directory",
      scope: "personal",
      workspaceId: null,
    });
    expect(skill.enabled).toBe(false);
    expect(() => service.setEnabled(skill.id, true)).toThrow("SKILL_PERMISSIONS_NOT_APPROVED");
    skill = service.approvePermissions(skill.id, skill.permissionDigest);
    skill = service.setEnabled(skill.id, true);
    expect(skill.enabled).toBe(true);

    const version2 = writeSkill(root, {
      version: "2.0.0",
      permissions:
        "  - capability: shell\n    actions: [execute]\n    targets: [scripts/run.mjs]\n    reason: Run fixture script.\n  - capability: network\n    actions: [connect]\n    targets: [api.example.test]\n    reason: Fetch fixture data.",
    });
    skill = service.update({
      installationId: skill.id,
      sourcePath: version2,
      sourceKind: "local_directory",
    });
    expect(skill).toMatchObject({
      version: "2.0.0",
      enabled: false,
      approvedPermissionDigest: null,
    });
    expect(skill.rollbackVersions).toContain("1.0.0");
    skill = service.rollback(skill.id, "1.0.0");
    expect(skill.version).toBe("1.0.0");
    expect(skill.rollbackVersions).toContain("2.0.0");
    repository.close();
  });

  it("supports ZIP packages and blocks archive traversal", () => {
    const { root, repository, service } = profile();
    const source = writeSkill(root, { permissions: "[]", scripts: "[]" });
    const archive = path.join(root, "fixture.zip");
    const files = Object.fromEntries(
      ["SKILL.md", "agents/openai.yaml", "references/template.md", "scripts/run.mjs"].map(
        (relativePath) => [
          relativePath,
          new Uint8Array(readFileSync(path.join(source, relativePath))),
        ],
      ),
    );
    writeFileSync(archive, zipSync(files));
    const skill = service.install({
      sourcePath: archive,
      sourceKind: "archive",
      scope: "workspace",
      workspaceId: "workspace-a",
    });
    expect(skill).toMatchObject({ sourceKind: "archive", scope: "workspace" });

    const malicious = path.join(root, "traversal.zip");
    writeFileSync(malicious, zipSync({ "../escape.txt": new TextEncoder().encode("escape") }));
    expect(() =>
      service.install({
        sourcePath: malicious,
        sourceKind: "archive",
        scope: "personal",
        workspaceId: null,
      }),
    ).toThrow("SKILL_PATH_ESCAPE");
    repository.close();
  });

  it("applies workspace over personal over builtin priority and isolates package corruption", () => {
    const { root, repository, service } = profile();
    service.seedBuiltIns();
    const personalSource = writeSkill(root, {
      name: "priority-skill",
      permissions: "[]",
      scripts: "[]",
    });
    const workspaceSource = writeSkill(root, {
      name: "priority-skill",
      version: "2.0.0",
      permissions: "[]",
      scripts: "[]",
    });
    const personal = service.install({
      sourcePath: personalSource,
      sourceKind: "local_directory",
      scope: "personal",
      workspaceId: null,
    });
    const workspace = service.install({
      sourcePath: workspaceSource,
      sourceKind: "local_directory",
      scope: "workspace",
      workspaceId: "workspace-a",
    });
    service.setEnabled(personal.id, true);
    service.setEnabled(workspace.id, true);
    expect(
      service.mounts("workspace-a").find(({ name }) => name === "priority-skill")?.installationId,
    ).toBe(workspace.id);
    expect(
      service.mounts("workspace-b").find(({ name }) => name === "priority-skill")?.installationId,
    ).toBe(personal.id);

    const active = repository.activePackage(workspace.id);
    writeFileSync(path.join(active.packagePath, "references", "template.md"), "tampered\n");
    expect(
      service.mounts("workspace-a").find(({ name }) => name === "priority-skill")?.installationId,
    ).toBe(personal.id);
    expect(service.get(workspace.id).packageState).toBe("damaged");
    expect(service.get(personal.id).packageState).toBe("installed");
    expect(service.uninstall(workspace.id)).toEqual({
      installationId: workspace.id,
      removed: true,
    });
    expect(() => service.get(workspace.id)).toThrow("SKILL_NOT_FOUND");
    repository.close();
  });
});
