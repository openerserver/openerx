import { createHash, randomUUID } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type {
  EnterpriseSkillSource,
  PiSkillMount,
  SkillInstallation,
  SkillPackageManifest,
} from "@openerx/contracts";
import {
  enterpriseSkillSourceSchema,
  skillNameSchema,
  skillPackageManifestSchema,
} from "@openerx/contracts";
import type { SkillRepository } from "@openerx/storage";
import { unzipSync } from "fflate";
import { parse as parseYaml } from "yaml";
import { builtInSkills } from "./builtins";

// Codex does not impose a per-package file cap when installing a Skill, and its
// discovery walk allows 20,000 entries per Skills root. Match that compatibility
// scale while retaining a finite archive-entry guard against pathological ZIPs.
const maxFiles = 20_000;
const maxPackageBytes = 20 * 1024 * 1024;
const maxResourceBytes = 2 * 1024 * 1024;

interface ParsedPackage {
  root: string;
  name: string;
  displayName: string;
  description: string;
  manifest: SkillPackageManifest;
  checksum: string;
  permissionDigest: string;
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function normalizeRelative(relativePath: string): string {
  if (relativePath.includes("\0")) throw new Error("SKILL_PATH_INVALID");
  const normalized = relativePath.replaceAll("\\", "/").replace(/^\.\//, "");
  if (
    normalized.length === 0 ||
    normalized.startsWith("/") ||
    /^[A-Za-z]:\//.test(normalized) ||
    normalized.split("/").some((part) => part === "" || part === "." || part === "..")
  ) {
    throw new Error("SKILL_PATH_ESCAPE");
  }
  return normalized;
}

function parseSkillFrontmatter(content: string): { name: string; description: string } {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) throw new Error("SKILL_FRONTMATTER_REQUIRED");
  const frontmatter = parseYaml(match[1] ?? "") as Record<string, unknown>;
  const name = skillNameSchema.parse(frontmatter.name);
  const description =
    typeof frontmatter.description === "string" ? frontmatter.description.trim() : "";
  if (!description || description.length > 1_024) throw new Error("SKILL_DESCRIPTION_INVALID");
  return { name, description };
}

function parseSkillPackageManifest(content: string | null): SkillPackageManifest {
  try {
    const parsed = content ? parseYaml(content) : {};
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("SKILL_MANIFEST_INVALID");
    }
    const record = parsed as Record<string, unknown>;
    const codexInterface =
      record.interface && typeof record.interface === "object" && !Array.isArray(record.interface)
        ? (record.interface as Record<string, unknown>)
        : {};
    return skillPackageManifestSchema.parse({
      version: record.version ?? "0.0.0",
      display_name: record.display_name ?? codexInterface.display_name,
      publisher: record.publisher ?? "Unknown publisher",
      tools: record.tools,
      mcp_servers: record.mcp_servers,
      permissions: record.permissions,
      platforms: record.platforms,
      scripts: record.scripts,
      signature: record.signature,
    });
  } catch {
    throw new Error("SKILL_MANIFEST_INVALID");
  }
}

function collectFiles(
  root: string,
): Array<{ relativePath: string; absolutePath: string; bytes: number }> {
  const files: Array<{ relativePath: string; absolutePath: string; bytes: number }> = [];
  let total = 0;
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.name === ".DS_Store") continue;
      const absolutePath = path.join(directory, entry.name);
      const info = lstatSync(absolutePath);
      if (info.isSymbolicLink()) throw new Error("SKILL_SYMLINK_NOT_ALLOWED");
      if (info.isDirectory()) {
        visit(absolutePath);
        continue;
      }
      if (!info.isFile()) throw new Error("SKILL_FILE_TYPE_NOT_ALLOWED");
      const relativePath = normalizeRelative(path.relative(root, absolutePath));
      total += info.size;
      files.push({ relativePath, absolutePath, bytes: info.size });
      if (files.length > maxFiles) throw new Error("SKILL_TOO_MANY_FILES");
      if (total > maxPackageBytes) throw new Error("SKILL_PACKAGE_TOO_LARGE");
    }
  };
  visit(root);
  return files.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

function treeChecksum(root: string): string {
  const digest = createHash("sha256");
  for (const file of collectFiles(root)) {
    digest.update(file.relativePath);
    digest.update("\0");
    digest.update(readFileSync(file.absolutePath));
    digest.update("\0");
  }
  return digest.digest("hex");
}

function copyDirectory(source: string, destination: string): void {
  if (!statSync(source).isDirectory()) throw new Error("SKILL_DIRECTORY_REQUIRED");
  mkdirSync(destination, { recursive: true, mode: 0o700 });
  for (const file of collectFiles(source)) {
    const target = path.join(destination, ...file.relativePath.split("/"));
    mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
    writeFileSync(target, readFileSync(file.absolutePath), { mode: 0o600 });
  }
}

function extractArchive(source: string, destination: string): void {
  const archive = readFileSync(source);
  if (archive.byteLength > maxPackageBytes) throw new Error("SKILL_ARCHIVE_TOO_LARGE");
  // Check advertised expansion before fflate allocates decompressed buffers.
  let advertisedBytes = 0,
    advertisedFiles = 0;
  const entries = unzipSync(archive, {
    filter: (file) => {
      advertisedBytes += file.originalSize;
      if (++advertisedFiles > maxFiles) throw new Error("SKILL_TOO_MANY_FILES");
      if (!Number.isSafeInteger(advertisedBytes) || advertisedBytes > maxPackageBytes)
        throw new Error("SKILL_PACKAGE_TOO_LARGE");
      normalizeRelative(file.name.endsWith("/") ? file.name.slice(0, -1) : file.name);
      return true;
    },
  });
  const names = Object.keys(entries);
  if (names.length > maxFiles) throw new Error("SKILL_TOO_MANY_FILES");
  let total = 0;
  for (const [entryName, bytes] of Object.entries(entries)) {
    const isDirectory = entryName.endsWith("/");
    const normalized = normalizeRelative(isDirectory ? entryName.slice(0, -1) : entryName);
    if (isDirectory) continue;
    total += bytes.byteLength;
    if (total > maxPackageBytes) throw new Error("SKILL_PACKAGE_TOO_LARGE");
    const target = path.join(destination, ...normalized.split("/"));
    mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
    writeFileSync(target, bytes, { mode: 0o600 });
  }
}

function findPackageRoot(staging: string): string {
  if (existsSync(path.join(staging, "SKILL.md"))) return staging;
  const candidates = readdirSync(staging, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(staging, entry.name))
    .filter((directory) => existsSync(path.join(directory, "SKILL.md")));
  if (candidates.length !== 1) throw new Error("SKILL_ROOT_AMBIGUOUS");
  return candidates[0] ?? staging;
}

export class SkillPackageService {
  readonly #repository: SkillRepository;
  readonly #root: string;
  readonly #platform: "darwin" | "win32";

  constructor(
    repository: SkillRepository,
    profileDirectory: string,
    platform: "darwin" | "win32" = process.platform === "win32" ? "win32" : "darwin",
  ) {
    this.#repository = repository;
    this.#root = path.join(profileDirectory, "skill-packages");
    this.#platform = platform;
    mkdirSync(this.#root, { recursive: true, mode: 0o700 });
    mkdirSync(path.join(this.#root, ".trash"), { recursive: true, mode: 0o700 });
  }

  packagesDirectory(): string {
    return this.#root;
  }

  close(): void {
    this.#repository.close();
  }

  seedBuiltIns(): SkillInstallation[] {
    const installed: SkillInstallation[] = [];
    for (const builtIn of builtInSkills) {
      const source = path.join(this.#root, `.builtin-${builtIn.installationId}`);
      rmSync(source, { recursive: true, force: true });
      for (const [relativePath, content] of Object.entries(builtIn.files)) {
        const target = path.join(source, ...relativePath.split("/"));
        mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
        writeFileSync(target, content, { encoding: "utf8", mode: 0o600 });
      }
      try {
        installed.push(
          this.#installPrepared({
            sourceRoot: source,
            installationId: builtIn.installationId,
            scope: "builtin",
            workspaceId: null,
            sourceKind: "built_in",
            sourceLabel: "openerx bundled skills",
            trust: "bundled",
            builtIn: true,
          }),
        );
      } finally {
        rmSync(source, { recursive: true, force: true });
      }
    }
    return installed;
  }

  install(input: {
    sourcePath: string;
    sourceKind: "local_directory" | "archive";
    scope: "personal" | "workspace";
    workspaceId: string | null;
  }): SkillInstallation {
    return this.#stageAndInstall({ ...input, installationId: randomUUID() });
  }

  // Main-process integration only. This is not part of the user import IPC.
  installEnterpriseArchive(input: {
    installationId: string;
    sourcePath: string;
    source: EnterpriseSkillSource;
    expectedName: string;
  }): SkillInstallation {
    if (
      builtInSkills.some(
        (skill) => parseSkillFrontmatter(skill.files["SKILL.md"]).name === input.expectedName,
      )
    )
      throw new Error("SKILL_SCOPE_NAME_CONFLICT");
    const source = enterpriseSkillSourceSchema.parse(input.source);
    if (input.installationId !== source.skillId) throw new Error("SKILL_ENTERPRISE_SCOPE_MISMATCH");
    const archive = readFileSync(input.sourcePath);
    if (
      archive.byteLength !== source.sizeBytes ||
      createHash("sha256").update(archive).digest("hex") !== source.archiveSha256
    )
      throw new Error("SKILL_ARCHIVE_INTEGRITY_FAILED");
    return this.#stageAndInstall({
      installationId: input.installationId,
      sourcePath: input.sourcePath,
      sourceKind: "archive",
      scope: "enterprise",
      workspaceId: null,
      expectedName: input.expectedName,
      enterpriseSource: source,
    });
  }

  verifyPackage(installationId: string): void {
    const active = this.#repository.activePackage(installationId);
    this.#assertIntegrity(installationId, active.packagePath);
  }

  versionMount(installationId: string, version: string, autoInvoke = true): PiSkillMount {
    const pinned = this.#repository.packageVersion(installationId, version);
    this.#assertIntegrity(installationId, pinned.packagePath, pinned.installation.checksumSha256);
    return {
      installationId,
      name: pinned.installation.name,
      baseDir: pinned.packagePath,
      autoInvoke,
    };
  }

  removeEnterprisePackage(installationId: string): void {
    this.#repository.removeManagedInstallation(installationId);
    rmSync(path.join(this.#root, installationId), { recursive: true, force: true });
  }

  pruneUnusedVersions(installationId: string, retainedVersions: string[] = []): void {
    const root = path.join(this.#root, installationId, "versions");
    for (const directory of this.#repository.pruneManagedVersions(
      installationId,
      retainedVersions,
    )) {
      const relative = path.relative(root, directory);
      if (!relative || relative.startsWith("..") || path.isAbsolute(relative))
        throw new Error("SKILL_PATH_ESCAPE");
      rmSync(directory, { recursive: true, force: true });
    }
  }

  cleanStaging(): void {
    for (const name of readdirSync(this.#root))
      if (/^\.staging-[0-9a-f-]{36}$/.test(name))
        rmSync(path.join(this.#root, name), { recursive: true, force: true });
    rmSync(path.join(this.#root, ".trash"), { recursive: true, force: true });
    mkdirSync(path.join(this.#root, ".trash"), { mode: 0o700 });
  }

  update(input: {
    installationId: string;
    sourcePath: string;
    sourceKind: "local_directory" | "archive";
  }): SkillInstallation {
    const current = this.#repository.get(input.installationId);
    if (current.scope === "builtin") throw new Error("BUILTIN_SKILL_UPDATE_MANAGED_BY_RELEASE");
    if (current.scope === "enterprise") throw new Error("ENTERPRISE_SKILL_MANAGED_BY_CATALOG");
    return this.#stageAndInstall({
      ...input,
      scope: current.scope,
      workspaceId: current.workspaceId,
      expectedName: current.name,
    });
  }

  list(
    input: { scope?: SkillInstallation["scope"]; workspaceId?: string } = {},
  ): SkillInstallation[] {
    return this.#repository.list(input);
  }

  get(installationId: string): SkillInstallation {
    return this.#repository.get(installationId);
  }

  setEnabled(installationId: string, enabled: boolean): SkillInstallation {
    const skill = this.#repository.get(installationId);
    if (enabled && !skill.platforms.includes(this.#platform))
      throw new Error("SKILL_PLATFORM_UNSUPPORTED");
    return this.#repository.setEnabled(installationId, enabled);
  }

  setAutoInvoke(installationId: string, autoInvoke: boolean): SkillInstallation {
    return this.#repository.setAutoInvoke(installationId, autoInvoke);
  }

  approvePermissions(installationId: string, digest: string): SkillInstallation {
    return this.#repository.approvePermissions(installationId, digest);
  }

  resetPermissions(installationId: string): SkillInstallation {
    return this.#repository.resetPermissions(installationId);
  }

  rollback(installationId: string, version: string): SkillInstallation {
    if (this.#repository.get(installationId).scope === "enterprise")
      throw new Error("ENTERPRISE_SKILL_MANAGED_BY_CATALOG");
    return this.#repository.rollback(installationId, version);
  }

  uninstall(installationId: string): { installationId: string; removed: boolean } {
    this.#repository.get(installationId);
    const installationRoot = path.join(this.#root, installationId);
    const result = this.#repository.uninstall(installationId);
    if (result.removed) {
      const trash = path.join(this.#root, ".trash", `${installationId}-${Date.now()}`);
      if (existsSync(installationRoot)) renameSync(installationRoot, trash);
    }
    return result;
  }

  mounts(workspaceId: string, preferredInstallationId?: string): PiSkillMount[] {
    const mounts: PiSkillMount[] = [];
    let retryAfterIsolation = false;
    for (const active of this.#repository.enabledPackages(workspaceId, preferredInstallationId)) {
      try {
        this.#assertIntegrity(active.installation.id, active.packagePath);
        mounts.push({
          installationId: active.installation.id,
          name: active.installation.name,
          baseDir: active.packagePath,
          autoInvoke:
            active.installation.autoInvoke || active.installation.id === preferredInstallationId,
        });
      } catch (error) {
        if (active.installation.id === preferredInstallationId) throw error;
        retryAfterIsolation = true;
      }
    }
    return retryAfterIsolation ? this.mounts(workspaceId, preferredInstallationId) : mounts;
  }

  readResource(
    installationId: string,
    relativePath: string,
    version?: string,
  ): {
    name: string;
    relativePath: string;
    content: string;
  } {
    const { bytes, ...resource } = this.readResourceBytes(installationId, relativePath, version);
    if (bytes.byteLength > maxResourceBytes) throw new Error("SKILL_RESOURCE_TOO_LARGE");
    return { ...resource, content: bytes.toString("utf8") };
  }

  /** Verified pinned bytes for host-side file parsers; never send these bytes to the model. */
  readResourceBytes(
    installationId: string,
    relativePath: string,
    version?: string,
  ): { name: string; relativePath: string; bytes: Buffer } {
    const active = version
      ? this.#repository.packageVersion(installationId, version)
      : this.#repository.activePackage(installationId);
    const normalized = normalizeRelative(relativePath);
    this.#assertIntegrity(installationId, active.packagePath, active.installation.checksumSha256);
    const target = path.join(active.packagePath, ...normalized.split("/"));
    const relative = path.relative(active.packagePath, target);
    if (relative.startsWith("..") || path.isAbsolute(relative))
      throw new Error("SKILL_PATH_ESCAPE");
    const info = lstatSync(target);
    if (!info.isFile() || info.isSymbolicLink()) throw new Error("SKILL_RESOURCE_NOT_FOUND");
    if (info.size > maxPackageBytes) throw new Error("SKILL_RESOURCE_TOO_LARGE");
    return {
      name: active.installation.name,
      relativePath: normalized,
      bytes: readFileSync(target),
    };
  }

  scriptDescriptor(
    installationId: string,
    relativePath: string,
    allowNetwork: boolean,
    version?: string,
  ): { absolutePath: string; packagePath: string; name: string } {
    const active = version
      ? this.#repository.packageVersion(installationId, version)
      : this.#repository.activePackage(installationId);
    const normalized = normalizeRelative(relativePath);
    if (!active.scripts.includes(normalized)) throw new Error("SKILL_SCRIPT_NOT_DECLARED");
    if (!active.installation.platforms.includes(this.#platform))
      throw new Error("SKILL_PLATFORM_UNSUPPORTED");
    if (
      active.installation.permissions.length > 0 &&
      active.installation.approvedPermissionDigest !== active.installation.permissionDigest
    ) {
      throw new Error("SKILL_PERMISSIONS_NOT_APPROVED");
    }
    const declaredNetwork = active.installation.permissions.some(
      (permission) => permission.capability === "network",
    );
    if (allowNetwork && !declaredNetwork) throw new Error("SKILL_NETWORK_NOT_DECLARED");
    this.#assertIntegrity(installationId, active.packagePath, active.installation.checksumSha256);
    const absolutePath = path.join(active.packagePath, ...normalized.split("/"));
    if (!lstatSync(absolutePath).isFile()) throw new Error("SKILL_SCRIPT_NOT_FOUND");
    return { absolutePath, packagePath: active.packagePath, name: active.installation.name };
  }

  /** Execute a verified version in a disposable copy, never in managed package storage. */
  scriptExecutionCopy(
    installationId: string,
    relativePath: string,
    allowNetwork: boolean,
    version?: string,
  ): ReturnType<SkillPackageService["scriptDescriptor"]> & { dispose(): void } {
    const script = this.scriptDescriptor(installationId, relativePath, allowNetwork, version);
    const active = version
      ? this.#repository.packageVersion(installationId, version)
      : this.#repository.activePackage(installationId);
    const directory = mkdtempSync(path.join(tmpdir(), "openerx-skill-script-"));
    const dispose = () => rmSync(directory, { recursive: true, force: true });
    try {
      copyDirectory(script.packagePath, directory);
      if (treeChecksum(directory) !== active.installation.checksumSha256)
        throw new Error("SKILL_PACKAGE_DAMAGED");
      return {
        name: script.name,
        packagePath: directory,
        absolutePath: path.join(directory, path.relative(script.packagePath, script.absolutePath)),
        dispose,
      };
    } catch (error) {
      dispose();
      throw error;
    }
  }

  beginInvocation(input: {
    installationId: string;
    generationId: string;
    conversationId: string;
    trigger: "explicit" | "automatic";
    reason: string;
    loaded?: boolean;
  }) {
    return this.#repository.beginInvocation(input);
  }

  completeGeneration(
    generationId: string,
    status: "completed" | "failed" | "cancelled",
    errorCode?: string,
  ): void {
    this.#repository.completeGeneration(generationId, status, errorCode);
  }

  listInvocations(input: { conversationId?: string; limit?: number } = {}) {
    return this.#repository.listInvocations(input);
  }

  #stageAndInstall(input: {
    installationId: string;
    sourcePath: string;
    sourceKind: "local_directory" | "archive";
    scope: "personal" | "workspace" | "enterprise";
    workspaceId: string | null;
    expectedName?: string;
    enterpriseSource?: EnterpriseSkillSource;
  }): SkillInstallation {
    const staging = path.join(this.#root, `.staging-${randomUUID()}`);
    mkdirSync(staging, { recursive: true, mode: 0o700 });
    try {
      if (input.sourceKind === "archive") extractArchive(input.sourcePath, staging);
      else copyDirectory(input.sourcePath, staging);
      const root = findPackageRoot(staging);
      const parsed = this.#parse(root);
      if (input.expectedName && parsed.name !== input.expectedName) {
        throw new Error("SKILL_NAME_IMMUTABLE");
      }
      if (
        input.enterpriseSource &&
        (parsed.manifest.version !== input.enterpriseSource.version ||
          !parsed.manifest.platforms.includes(this.#platform))
      )
        throw new Error(
          parsed.manifest.version !== input.enterpriseSource.version
            ? "SKILL_VERSION_MISMATCH"
            : "SKILL_PLATFORM_UNSUPPORTED",
        );
      return this.#installParsed({
        parsed,
        installationId: input.installationId,
        scope: input.scope,
        workspaceId: input.workspaceId,
        sourceKind: input.enterpriseSource ? "enterprise_catalog" : input.sourceKind,
        sourceLabel: input.enterpriseSource
          ? input.enterpriseSource.authorityOrigin
          : path.basename(input.sourcePath),
        trust: "unverified",
        builtIn: false,
        enterpriseSource: input.enterpriseSource,
      });
    } finally {
      rmSync(staging, { recursive: true, force: true });
    }
  }

  #installPrepared(input: {
    sourceRoot: string;
    installationId: string;
    scope: "builtin";
    workspaceId: null;
    sourceKind: "built_in";
    sourceLabel: string;
    trust: "bundled";
    builtIn: true;
  }): SkillInstallation {
    return this.#installParsed({ ...input, parsed: this.#parse(input.sourceRoot) });
  }

  #installParsed(input: {
    parsed: ParsedPackage;
    installationId: string;
    scope: SkillInstallation["scope"];
    workspaceId: string | null;
    sourceKind: SkillInstallation["sourceKind"];
    sourceLabel: string;
    trust: SkillInstallation["trust"];
    builtIn: boolean;
    enterpriseSource?: EnterpriseSkillSource;
  }): SkillInstallation {
    const versionDirectory = path.join(
      this.#root,
      input.installationId,
      "versions",
      `${input.parsed.manifest.version}-${input.parsed.checksum.slice(0, 12)}`,
    );
    if (
      input.enterpriseSource &&
      existsSync(versionDirectory) &&
      treeChecksum(versionDirectory) !== input.parsed.checksum
    )
      rmSync(versionDirectory, { recursive: true, force: true });
    const packageCreated = !existsSync(versionDirectory);
    if (packageCreated) copyDirectory(input.parsed.root, versionDirectory);
    try {
      return this.#repository.installVersion({
        installationId: input.installationId,
        name: input.parsed.name,
        displayName: input.parsed.displayName,
        description: input.parsed.description,
        publisher: input.parsed.manifest.publisher,
        scope: input.scope,
        workspaceId: input.workspaceId,
        sourceKind: input.sourceKind,
        sourceLabel: input.sourceLabel,
        trust: input.trust,
        version: input.parsed.manifest.version,
        checksumSha256: input.parsed.checksum,
        packagePath: versionDirectory,
        manifest: input.parsed.manifest,
        permissionDigest: input.parsed.permissionDigest,
        builtIn: input.builtIn,
        enterpriseSource: input.enterpriseSource,
      });
    } catch (error) {
      if (packageCreated) rmSync(versionDirectory, { recursive: true, force: true });
      throw error;
    }
  }

  #parse(root: string): ParsedPackage {
    collectFiles(root);
    const skillFile = path.join(root, "SKILL.md");
    if (!existsSync(skillFile)) throw new Error("SKILL_MD_REQUIRED");
    const frontmatter = parseSkillFrontmatter(readFileSync(skillFile, "utf8"));
    const manifestPath = path.join(root, "agents", "openai.yaml");
    const manifest = parseSkillPackageManifest(
      existsSync(manifestPath) ? readFileSync(manifestPath, "utf8") : null,
    );
    for (const script of manifest.scripts) {
      const normalized = normalizeRelative(script);
      if (!normalized.startsWith("scripts/")) throw new Error("SKILL_SCRIPT_PATH_INVALID");
      const scriptPath = path.join(root, ...normalized.split("/"));
      if (!existsSync(scriptPath) || !lstatSync(scriptPath).isFile()) {
        throw new Error("SKILL_SCRIPT_NOT_FOUND");
      }
    }
    const checksum = treeChecksum(root);
    const permissionDigest = createHash("sha256")
      .update(
        canonical({
          permissions: manifest.permissions,
          tools: manifest.tools,
          mcpServers: manifest.mcp_servers,
          scripts: manifest.scripts,
        }),
      )
      .digest("hex");
    return {
      root,
      name: frontmatter.name,
      displayName: manifest.display_name ?? frontmatter.name,
      description: frontmatter.description,
      manifest,
      checksum,
      permissionDigest,
    };
  }

  #assertIntegrity(installationId: string, packagePath: string, expectedChecksum?: string): void {
    const skill = this.#repository.get(installationId);
    const versionRoot = path.join(this.#root, installationId, "versions");
    const relative = path.relative(versionRoot, path.resolve(packagePath));
    if (
      !relative ||
      relative.startsWith("..") ||
      path.isAbsolute(relative) ||
      relative.split(path.sep).length !== 1
    )
      throw new Error("SKILL_PATH_ESCAPE");
    for (const directory of [
      this.#root,
      path.join(this.#root, installationId),
      versionRoot,
      packagePath,
    ])
      if (existsSync(directory) && lstatSync(directory).isSymbolicLink())
        throw new Error("SKILL_PATH_ESCAPE");
    if (
      !existsSync(packagePath) ||
      treeChecksum(packagePath) !== (expectedChecksum ?? skill.checksumSha256)
    ) {
      // Damage to an archived run version must not quarantine the new catalog version.
      if (!expectedChecksum || expectedChecksum === skill.checksumSha256)
        this.#repository.markPackageState(
          installationId,
          existsSync(packagePath) ? "damaged" : "missing",
        );
      throw new Error(existsSync(packagePath) ? "SKILL_PACKAGE_DAMAGED" : "SKILL_PACKAGE_MISSING");
    }
  }
}

export { normalizeRelative, treeChecksum };
