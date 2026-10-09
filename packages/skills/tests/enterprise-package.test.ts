import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  type EnterpriseSkillSource,
  enterpriseSkillScopeSchema,
  skillInstallationSyncSchema,
} from "@openerx/contracts";
import { migrateDatabase, SkillRepository } from "@openerx/storage";
import { strToU8, unzipSync, zipSync } from "fflate";
import { afterEach, expect, test } from "vitest";
import { SkillPackageService, SkillToolAdapter } from "../src";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
const scope = {
  authorityOrigin: "https://enterprise.example.test",
  accountId: randomUUID(),
  tenantId: randomUUID(),
  credentialId: randomUUID(),
  membershipEpisode: randomUUID(),
};

function fixture(version = "1.0.0", permission = false) {
  const bytes = zipSync({
    "SKILL.md": strToU8(
      "---\nname: company-proposal\ndescription: Use company templates.\n---\nRead assets/template.bin.",
    ),
    "agents/openai.yaml": strToU8(
      `version: ${version}\npublisher: Company\nplatforms: [darwin, win32]\n` +
        (permission
          ? "permissions:\n  - capability: shell\n    actions: [execute]\n    reason: Company helper\n"
          : "permissions: []\n"),
    ),
    "assets/template.bin": new Uint8Array([0, 255, 128, 1]),
  });
  const source: EnterpriseSkillSource = {
    ...scope,
    skillId: "00000000-0000-4000-8000-000000000918",
    version,
    catalogRevision: "1",
    archiveSha256: createHash("sha256").update(bytes).digest("hex"),
    sizeBytes: bytes.length,
  };
  return { bytes, source };
}
function context() {
  const root = mkdtempSync(path.join(tmpdir(), "enterprise-standard-skill-"));
  roots.push(root);
  const dbPath = path.join(root, "catalog.sqlite");
  const repository = new SkillRepository(dbPath, {
    enterpriseScope: scope,
    deviceId: randomUUID(),
  });
  const service = new SkillPackageService(repository, root, "darwin");
  const install = (item: ReturnType<typeof fixture>) => {
    const sourcePath = path.join(root, "download.zip");
    writeFileSync(sourcePath, item.bytes);
    return service.installEnterpriseArchive({
      installationId: item.source.skillId,
      sourcePath,
      source: item.source,
      expectedName: "company-proposal",
    });
  };
  return { root, dbPath, repository, service, install };
}

test("authenticated managed packages reuse immutable installs and stay out of personal sync", () => {
  const c = context(),
    first = fixture();
  try {
    const installed = c.install(first);
    expect(installed).toMatchObject({
      scope: "enterprise",
      sourceKind: "enterprise_catalog",
      trust: "unverified",
      enabled: true,
      autoInvoke: true,
      enterpriseSource: first.source,
    });
    expect(installed.checksumSha256).not.toBe(first.source.archiveSha256);
    const active = c.repository.activePackage(installed.id);
    expect(readFileSync(path.join(active.packagePath, "assets/template.bin"))).toEqual(
      Buffer.from([0, 255, 128, 1]),
    );
    expect(skillInstallationSyncSchema.safeParse(installed).success).toBe(false);
    const {
      enterpriseSource: _source,
      packageState: _state,
      approvedPermissionDigest: _approval,
      rollbackVersions: _versions,
      lastUsedAt: _used,
      ...sync
    } = installed;
    expect(skillInstallationSyncSchema.safeParse(sync).success).toBe(false);
    const check = new DatabaseSync(c.dbPath);
    expect(check.prepare("SELECT count(*) AS n FROM sync_outbox").get()?.n).toBe(0);
    check.close();
    c.install(fixture("2.0.0", true));
    expect(c.service.get(installed.id)).toMatchObject({
      version: "2.0.0",
      enabled: false,
      approvedPermissionDigest: null,
    });
    expect(() => c.service.rollback(installed.id, "1.0.0")).toThrow("MANAGED_BY_CATALOG");
    expect(() =>
      c.service.update({ installationId: installed.id, sourcePath: "x", sourceKind: "archive" }),
    ).toThrow("MANAGED_BY_CATALOG");
    c.install({ ...first, source: { ...first.source, catalogRevision: "3" } });
    expect(c.service.get(installed.id)).toMatchObject({
      version: "1.0.0",
      enabled: true,
      enterpriseSource: { catalogRevision: "3" },
    });
    const current = c.repository.activePackage(installed.id);
    writeFileSync(path.join(current.packagePath, "assets/template.bin"), "damaged");
    expect(() => c.service.verifyPackage(installed.id)).toThrow("SKILL_PACKAGE_DAMAGED");
    c.install(first);
    c.service.verifyPackage(installed.id);
  } finally {
    c.service.close();
  }
});

test("running tasks read their retained immutable version across publication and pruning", () => {
  const c = context(),
    first = fixture();
  try {
    c.install(first);
    const mount = c.service.versionMount(first.source.skillId, "1.0.0");
    c.install(fixture("2.0.0", true));
    c.service.pruneUnusedVersions(first.source.skillId, ["1.0.0"]);
    expect(c.service.versionMount(first.source.skillId, "1.0.0")).toEqual(mount);
    expect(
      c.service.readResource(first.source.skillId, "agents/openai.yaml", "1.0.0").content,
    ).toContain("version: 1.0.0");
    expect(c.service.readResource(first.source.skillId, "agents/openai.yaml").content).toContain(
      "version: 2.0.0",
    );
    writeFileSync(path.join(mount.baseDir, "SKILL.md"), "damaged old run");
    expect(() => c.service.readResource(first.source.skillId, "SKILL.md", "1.0.0")).toThrow(
      "SKILL_PACKAGE_DAMAGED",
    );
    c.service.verifyPackage(first.source.skillId);
    c.service.pruneUnusedVersions(first.source.skillId);
    expect(() => c.service.versionMount(first.source.skillId, "1.0.0")).toThrow(
      "SKILL_VERSION_NOT_FOUND",
    );
  } finally {
    c.service.close();
  }
});

test("pinned adapters retain script descriptors and reject resources outside their mounted versions", async () => {
  const c = context();
  const scripted = (version: string) => {
    const item = fixture(version),
      entries = unzipSync(item.bytes);
    entries["agents/openai.yaml"] = strToU8(
      Buffer.from(entries["agents/openai.yaml"]!).toString("utf8") +
        "scripts: [scripts/helper.mjs]\n",
    );
    entries["scripts/helper.mjs"] = strToU8(`console.log('version ${version}');`);
    const bytes = zipSync(entries);
    return {
      bytes,
      source: {
        ...item.source,
        sizeBytes: bytes.length,
        archiveSha256: createHash("sha256").update(bytes).digest("hex"),
      },
    };
  };
  try {
    const first = scripted("1.0.0");
    c.install(first);
    const original = c.service.scriptDescriptor(first.source.skillId, "scripts/helper.mjs", false);
    c.install(scripted("2.0.0"));
    const pinned = c.service.scriptDescriptor(
      first.source.skillId,
      "scripts/helper.mjs",
      false,
      "1.0.0",
    );
    expect(pinned).toEqual(original);
    expect(readFileSync(pinned.absolutePath, "utf8")).toContain("version 1.0.0");
    const adapter = new SkillToolAdapter(c.service, new Map([[first.source.skillId, "1.0.0"]]));
    const operation = {
      operation: "skill_read" as const,
      installationId: first.source.skillId,
      relativePath: "agents/openai.yaml",
      idempotencyKey: "pinned-version-read",
    };
    const context = { toolCallId: randomUUID(), signal: new AbortController().signal, update() {} };
    expect((await adapter.execute(operation, context)).content[0]).toMatchObject({
      text: expect.stringContaining("version: 1.0.0"),
    });
    await expect(
      adapter.execute({ ...operation, installationId: randomUUID() }, context),
    ).rejects.toThrow("SKILL_NOT_MOUNTED");
    const external = path.join(c.root, "employee-not-a-skill");
    const db = new DatabaseSync(c.dbPath);
    db.prepare(
      "UPDATE skill_versions SET package_path=? WHERE installation_id=? AND version='1.0.0'",
    ).run(external, first.source.skillId);
    db.close();
    expect(() => c.service.versionMount(first.source.skillId, "1.0.0")).toThrow(
      "SKILL_PATH_ESCAPE",
    );
    c.service.verifyPackage(first.source.skillId);
  } finally {
    c.service.close();
  }
});

test("the enterprise cache rejects a different tenant, ordinary storage, false signatures and bad ZIP digest", () => {
  const c = context(),
    item = fixture();
  try {
    expect(() =>
      c.install({ ...item, source: { ...item.source, tenantId: randomUUID() } }),
    ).toThrow("SCOPE_MISMATCH");
    expect(() =>
      c.install({ ...item, source: { ...item.source, archiveSha256: "0".repeat(64) } }),
    ).toThrow("INTEGRITY_FAILED");
    expect(() => c.install({ ...item, source: { ...item.source, version: "9.0.0" } })).toThrow(
      "VERSION_MISMATCH",
    );
    c.install(item);
    const wrong = new SkillRepository(c.dbPath, {
      enterpriseScope: { ...scope, tenantId: randomUUID() },
    });
    expect(() => wrong.get(item.source.skillId)).toThrow("SCOPE_MISMATCH");
    wrong.close();
    const ordinary = new SkillRepository(c.dbPath, {
      ownerProfileId: scope.accountId,
      deviceId: randomUUID(),
    });
    expect(ordinary.list()).toEqual([]);
    expect(() => ordinary.get(item.source.skillId)).toThrow("SCOPE_MISMATCH");
    ordinary.close();
    expect(
      enterpriseSkillScopeSchema.safeParse({ ...scope, membershipEpisode: "unknown" }).success,
    ).toBe(false);
  } finally {
    c.service.close();
  }
});

test("archive expansion is bounded before decompression allocation", () => {
  const c = context(),
    item = fixture();
  try {
    const bytes = zipSync({ "SKILL.md": new Uint8Array(20 * 1024 * 1024 + 1) });
    const source = {
      ...item.source,
      sizeBytes: bytes.length,
      archiveSha256: createHash("sha256").update(bytes).digest("hex"),
    };
    expect(() => c.install({ bytes, source })).toThrow("SKILL_PACKAGE_TOO_LARGE");
    expect(c.service.list()).toEqual([]);
  } finally {
    c.service.close();
  }
});

test("the enterprise scope migration preserves existing personal versions, invocations and foreign keys", () => {
  const root = mkdtempSync(path.join(tmpdir(), "skill-existing-migration-"));
  roots.push(root);
  const db = new DatabaseSync(path.join(root, "old.sqlite"));
  try {
    migrateDatabase(db, { throughVersion: 8 });
    const versionId = randomUUID(),
      invocationId = randomUUID(),
      now = new Date().toISOString();
    const row = {
      id: randomUUID(),
      owner_profile_id: randomUUID(),
      name: "existing-personal",
      display_name: "Existing personal",
      description: "Preserve this installation",
      publisher: "User",
      scope: "personal",
      workspace_id: null,
      source_kind: "archive",
      source_label: "personal.zip",
      trust: "unverified",
      desired_enabled: 1,
      enabled: 1,
      auto_invoke: 1,
      package_state: "installed",
      active_version_id: versionId,
      selected_version: "1.0.0",
      selected_checksum_sha256: "a".repeat(64),
      permission_digest: "b".repeat(64),
      approved_permission_digest: "b".repeat(64),
      declared_tools_json: "[]",
      declared_mcp_servers_json: "[]",
      permissions_json: "[]",
      platforms_json: '["darwin"]',
      installed_at: now,
      updated_at: now,
      last_used_at: now,
      deleted_at: null,
      revision: 4,
    };
    db.prepare(
      `INSERT INTO skill_installations (${Object.keys(row).join(",")}) VALUES (${Object.keys(row)
        .map(() => "?")
        .join(",")})`,
    ).run(...Object.values(row));
    db.prepare("INSERT INTO skill_versions VALUES (?,?,?,?,?,?,?,?)").run(
      versionId,
      row.id,
      "1.0.0",
      row.selected_checksum_sha256,
      "/existing/personal/version",
      "[]",
      "{}",
      now,
    );
    db.prepare("INSERT INTO skill_invocations VALUES (?,?,?,?,?,?,?,?,?,?)").run(
      invocationId,
      row.id,
      randomUUID(),
      randomUUID(),
      "explicit",
      "completed",
      "Preserve history",
      now,
      now,
      null,
    );
    const beforeVersion = db.prepare("SELECT * FROM skill_versions").get();
    const beforeInvocation = db.prepare("SELECT * FROM skill_invocations").get();
    migrateDatabase(db);
    expect(db.prepare("SELECT * FROM skill_installations").get()).toEqual({
      ...row,
      enterprise_source_json: null,
    });
    expect(db.prepare("SELECT * FROM skill_versions").get()).toEqual(beforeVersion);
    expect(db.prepare("SELECT * FROM skill_invocations").get()).toEqual(beforeInvocation);
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(() => migrateDatabase(db)).not.toThrow();
  } finally {
    db.close();
  }
});
