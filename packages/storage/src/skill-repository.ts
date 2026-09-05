import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import {
  type SkillInstallation,
  type SkillInstallationSync,
  type SkillInvocation,
  type SkillPackageManifest,
  skillInstallationSchema,
  skillInstallationSyncSchema,
  skillInvocationSchema,
} from "@openerx/contracts";
import { migrateDatabase } from "./migrations";

type SqlRow = Record<string, unknown>;

export interface SkillRepositoryOptions {
  ownerProfileId?: string;
  deviceId?: string | null;
  now?: () => string;
  idFactory?: () => string;
}

export interface InstallSkillVersionInput {
  installationId: string;
  name: string;
  displayName: string;
  description: string;
  publisher: string;
  scope: SkillInstallation["scope"];
  workspaceId: string | null;
  sourceKind: SkillInstallation["sourceKind"];
  sourceLabel: string;
  trust: SkillInstallation["trust"];
  version: string;
  checksumSha256: string;
  packagePath: string;
  manifest: SkillPackageManifest;
  permissionDigest: string;
  builtIn?: boolean;
}

export interface ActiveSkillPackage {
  installation: SkillInstallation;
  packagePath: string;
  scripts: string[];
}

export class SkillRepository {
  readonly #database: DatabaseSync;
  readonly #ownerProfileId: string;
  readonly #deviceId: string | null;
  readonly #now: () => string;
  readonly #idFactory: () => string;

  constructor(databasePath: string, options: SkillRepositoryOptions = {}) {
    this.#database = new DatabaseSync(databasePath);
    this.#ownerProfileId = options.ownerProfileId ?? "local-default";
    this.#deviceId = options.deviceId ?? null;
    this.#now = options.now ?? (() => new Date().toISOString());
    this.#idFactory = options.idFactory ?? randomUUID;
    migrateDatabase(this.#database);
  }

  close(): void {
    this.#database.close();
  }

  installVersion(input: InstallSkillVersionInput): SkillInstallation {
    return this.#transaction(() => {
      const now = this.#now();
      const existing = this.#row(input.installationId);
      const identity = this.#database
        .prepare(
          `SELECT id FROM skill_installations
           WHERE owner_profile_id = ? AND name = ? AND scope = ?
             AND COALESCE(workspace_id, '') = COALESCE(?, '') AND deleted_at IS NULL`,
        )
        .get(this.#ownerProfileId, input.name, input.scope, input.workspaceId) as
        | { id: string }
        | undefined;
      if (identity && identity.id !== input.installationId) {
        throw new Error("SKILL_SCOPE_NAME_CONFLICT");
      }
      if (existing && String(existing.name) !== input.name) {
        throw new Error("SKILL_NAME_IMMUTABLE");
      }
      const sameVersion = this.#database
        .prepare(
          "SELECT id, checksum_sha256 FROM skill_versions WHERE installation_id = ? AND version = ?",
        )
        .get(input.installationId, input.version) as
        | { id: string; checksum_sha256: string }
        | undefined;
      if (sameVersion && sameVersion.checksum_sha256 !== input.checksumSha256) {
        throw new Error("SKILL_VERSION_IMMUTABLE");
      }
      const versionId = sameVersion?.id ?? this.#idFactory();
      if (!existing) {
        const preapproved = input.builtIn || input.manifest.permissions.length === 0;
        this.#database
          .prepare(
            `INSERT INTO skill_installations
             (id, owner_profile_id, name, display_name, description, publisher, scope,
              workspace_id, source_kind, source_label, trust, desired_enabled, enabled,
              auto_invoke, package_state, active_version_id, selected_version,
              selected_checksum_sha256, permission_digest,
              approved_permission_digest, declared_tools_json, declared_mcp_servers_json,
              permissions_json, platforms_json, installed_at, updated_at, last_used_at,
              deleted_at, revision)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'installed', ?, ?, ?, ?, ?, ?, ?, ?,
                     ?, ?, ?, NULL, NULL, 1)`,
          )
          .run(
            input.installationId,
            this.#ownerProfileId,
            input.name,
            input.displayName,
            input.description,
            input.publisher,
            input.scope,
            input.workspaceId,
            input.sourceKind,
            input.sourceLabel,
            input.trust,
            input.builtIn ? 1 : 0,
            input.builtIn ? 1 : 0,
            input.builtIn ? 1 : 0,
            versionId,
            input.version,
            input.checksumSha256,
            input.permissionDigest,
            preapproved ? input.permissionDigest : null,
            JSON.stringify(input.manifest.tools),
            JSON.stringify(input.manifest.mcp_servers),
            JSON.stringify(input.manifest.permissions),
            JSON.stringify(input.manifest.platforms),
            now,
            now,
          );
      } else {
        const permissionChanged = String(existing.permission_digest) !== input.permissionDigest;
        const approved = permissionChanged
          ? null
          : existing.approved_permission_digest === null
            ? null
            : String(existing.approved_permission_digest);
        const desired = Number(existing.desired_enabled) === 1;
        const canEnable =
          desired &&
          (input.manifest.permissions.length === 0 || approved === input.permissionDigest);
        this.#database
          .prepare(
            `UPDATE skill_installations SET
               display_name = ?, description = ?, publisher = ?, source_kind = ?, source_label = ?,
               trust = ?, enabled = ?, package_state = 'installed', active_version_id = ?,
               selected_version = ?, selected_checksum_sha256 = ?, permission_digest = ?,
               approved_permission_digest = ?, declared_tools_json = ?,
               declared_mcp_servers_json = ?, permissions_json = ?, platforms_json = ?,
               updated_at = ?, deleted_at = NULL, revision = revision + 1
             WHERE id = ? AND owner_profile_id = ?`,
          )
          .run(
            input.displayName,
            input.description,
            input.publisher,
            input.sourceKind,
            input.sourceLabel,
            input.trust,
            canEnable ? 1 : 0,
            versionId,
            input.version,
            input.checksumSha256,
            input.permissionDigest,
            approved,
            JSON.stringify(input.manifest.tools),
            JSON.stringify(input.manifest.mcp_servers),
            JSON.stringify(input.manifest.permissions),
            JSON.stringify(input.manifest.platforms),
            now,
            input.installationId,
            this.#ownerProfileId,
          );
      }
      if (!sameVersion) {
        this.#database
          .prepare(
            `INSERT INTO skill_versions
             (id, installation_id, version, checksum_sha256, package_path, scripts_json,
              metadata_json, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            versionId,
            input.installationId,
            input.version,
            input.checksumSha256,
            input.packagePath,
            JSON.stringify(input.manifest.scripts),
            JSON.stringify({
              displayName: input.displayName,
              description: input.description,
              publisher: input.publisher,
              permissionDigest: input.permissionDigest,
              manifest: input.manifest,
            }),
            now,
          );
      }
      const installed = this.get(input.installationId);
      if (!input.builtIn) this.#queueSyncUpsert(installed, now);
      return installed;
    });
  }

  list(
    input: { scope?: SkillInstallation["scope"]; workspaceId?: string } = {},
  ): SkillInstallation[] {
    const rows = input.scope
      ? (this.#database
          .prepare(
            `SELECT id FROM skill_installations WHERE owner_profile_id = ? AND deleted_at IS NULL
             AND scope = ? AND (? IS NULL OR workspace_id = ?) ORDER BY name`,
          )
          .all(
            this.#ownerProfileId,
            input.scope,
            input.workspaceId ?? null,
            input.workspaceId ?? null,
          ) as SqlRow[])
      : (this.#database
          .prepare(
            "SELECT id FROM skill_installations WHERE owner_profile_id = ? AND deleted_at IS NULL ORDER BY scope, name",
          )
          .all(this.#ownerProfileId) as SqlRow[]);
    return rows.map((row) => this.get(String(row.id)));
  }

  get(installationId: string): SkillInstallation {
    const row = this.#row(installationId);
    if (!row || row.deleted_at !== null) throw new Error("SKILL_NOT_FOUND");
    const activeVersion = this.#activeVersionRow(row);
    const version = activeVersion ?? {
      id: "missing",
      version: row.selected_version,
      checksum_sha256: row.selected_checksum_sha256,
    };
    const rollbackVersions = (
      this.#database
        .prepare(
          `SELECT version FROM skill_versions WHERE installation_id = ? AND id != ?
           ORDER BY created_at DESC`,
        )
        .all(installationId, String(version.id)) as SqlRow[]
    ).map((item) => String(item.version));
    return skillInstallationSchema.parse({
      id: row.id,
      ownerProfileId: row.owner_profile_id,
      name: row.name,
      displayName: row.display_name,
      description: row.description,
      version: version.version,
      publisher: row.publisher,
      scope: row.scope,
      workspaceId: row.workspace_id,
      sourceKind: row.source_kind,
      sourceLabel: row.source_label,
      checksumSha256: version.checksum_sha256,
      trust: row.trust,
      enabled: Number(row.enabled) === 1,
      autoInvoke: Number(row.auto_invoke) === 1,
      packageState: row.package_state,
      permissionDigest: row.permission_digest,
      approvedPermissionDigest: row.approved_permission_digest,
      declaredTools: JSON.parse(String(row.declared_tools_json)),
      declaredMcpServers: JSON.parse(String(row.declared_mcp_servers_json)),
      permissions: JSON.parse(String(row.permissions_json)),
      platforms: JSON.parse(String(row.platforms_json)),
      rollbackVersions,
      installedAt: row.installed_at,
      updatedAt: row.updated_at,
      lastUsedAt: row.last_used_at,
      revision: Number(row.revision),
    });
  }

  setEnabled(installationId: string, enabled: boolean): SkillInstallation {
    return this.#mutate(installationId, (row, now) => {
      if (enabled && row.package_state !== "installed") throw new Error("SKILL_PACKAGE_MISSING");
      if (
        enabled &&
        JSON.parse(String(row.permissions_json)).length > 0 &&
        row.approved_permission_digest !== row.permission_digest
      ) {
        throw new Error("SKILL_PERMISSIONS_NOT_APPROVED");
      }
      this.#database
        .prepare(
          `UPDATE skill_installations SET desired_enabled = ?, enabled = ?, updated_at = ?,
           revision = revision + 1 WHERE id = ? AND owner_profile_id = ?`,
        )
        .run(enabled ? 1 : 0, enabled ? 1 : 0, now, installationId, this.#ownerProfileId);
    });
  }

  setAutoInvoke(installationId: string, autoInvoke: boolean): SkillInstallation {
    return this.#mutate(installationId, (_row, now) => {
      this.#database
        .prepare(
          `UPDATE skill_installations SET auto_invoke = ?, updated_at = ?, revision = revision + 1
           WHERE id = ? AND owner_profile_id = ?`,
        )
        .run(autoInvoke ? 1 : 0, now, installationId, this.#ownerProfileId);
    });
  }

  approvePermissions(installationId: string, permissionDigest: string): SkillInstallation {
    return this.#mutate(installationId, (row, now) => {
      if (row.permission_digest !== permissionDigest) throw new Error("SKILL_PERMISSION_CHANGED");
      this.#database
        .prepare(
          `UPDATE skill_installations SET approved_permission_digest = ?,
           enabled = CASE WHEN desired_enabled = 1 AND package_state = 'installed' THEN 1 ELSE 0 END,
           updated_at = ?, revision = revision + 1 WHERE id = ? AND owner_profile_id = ?`,
        )
        .run(permissionDigest, now, installationId, this.#ownerProfileId);
    });
  }

  resetPermissions(installationId: string): SkillInstallation {
    return this.#mutate(installationId, (_row, now) => {
      this.#database
        .prepare(
          `UPDATE skill_installations SET approved_permission_digest = NULL, enabled = 0,
           updated_at = ?, revision = revision + 1 WHERE id = ? AND owner_profile_id = ?`,
        )
        .run(now, installationId, this.#ownerProfileId);
    });
  }

  markPackageState(
    installationId: string,
    packageState: SkillInstallation["packageState"],
  ): SkillInstallation {
    const row = this.#row(installationId);
    if (!row || row.deleted_at !== null) throw new Error("SKILL_NOT_FOUND");
    this.#database
      .prepare(
        `UPDATE skill_installations SET package_state = ?,
         enabled = CASE WHEN ? = 'installed' THEN enabled ELSE 0 END,
         updated_at = ?, revision = revision + 1 WHERE id = ? AND owner_profile_id = ?`,
      )
      .run(packageState, packageState, this.#now(), installationId, this.#ownerProfileId);
    return this.get(installationId);
  }

  rollback(installationId: string, version: string): SkillInstallation {
    return this.#mutate(installationId, (row, now) => {
      const target = this.#database
        .prepare(
          "SELECT id, metadata_json FROM skill_versions WHERE installation_id = ? AND version = ?",
        )
        .get(installationId, version) as { id: string; metadata_json: string } | undefined;
      if (!target) throw new Error("SKILL_ROLLBACK_VERSION_NOT_FOUND");
      const metadata = JSON.parse(target.metadata_json) as {
        displayName: string;
        description: string;
        publisher: string;
        permissionDigest: string;
        manifest: SkillPackageManifest;
      };
      const approved =
        row.approved_permission_digest === metadata.permissionDigest
          ? metadata.permissionDigest
          : null;
      const enabled =
        Number(row.desired_enabled) === 1 &&
        (metadata.manifest.permissions.length === 0 || approved === metadata.permissionDigest);
      this.#database
        .prepare(
          `UPDATE skill_installations SET active_version_id = ?, selected_version = ?,
           selected_checksum_sha256 = ?, display_name = ?, description = ?,
           publisher = ?, permission_digest = ?, approved_permission_digest = ?,
           declared_tools_json = ?, declared_mcp_servers_json = ?, permissions_json = ?,
           platforms_json = ?, package_state = 'installed', enabled = ?,
           updated_at = ?, revision = revision + 1 WHERE id = ? AND owner_profile_id = ?`,
        )
        .run(
          target.id,
          version,
          String(
            (
              this.#database
                .prepare("SELECT checksum_sha256 FROM skill_versions WHERE id = ?")
                .get(target.id) as { checksum_sha256: string }
            ).checksum_sha256,
          ),
          metadata.displayName,
          metadata.description,
          metadata.publisher,
          metadata.permissionDigest,
          approved,
          JSON.stringify(metadata.manifest.tools),
          JSON.stringify(metadata.manifest.mcp_servers),
          JSON.stringify(metadata.manifest.permissions),
          JSON.stringify(metadata.manifest.platforms),
          enabled ? 1 : 0,
          now,
          installationId,
          this.#ownerProfileId,
        );
    });
  }

  uninstall(installationId: string): { installationId: string; removed: boolean } {
    return this.#transaction(() => {
      const row = this.#row(installationId);
      if (!row || row.deleted_at !== null) return { installationId, removed: false };
      if (row.scope === "builtin") throw new Error("BUILTIN_SKILL_CANNOT_BE_UNINSTALLED");
      const now = this.#now();
      this.#database
        .prepare(
          `UPDATE skill_installations SET enabled = 0, desired_enabled = 0, deleted_at = ?,
           updated_at = ?, revision = revision + 1 WHERE id = ? AND owner_profile_id = ?`,
        )
        .run(now, now, installationId, this.#ownerProfileId);
      this.#queueSyncDelete(installationId, now);
      return { installationId, removed: true };
    });
  }

  activePackage(installationId: string): ActiveSkillPackage {
    const installation = this.get(installationId);
    const row = this.#row(installationId);
    if (!row) throw new Error("SKILL_NOT_FOUND");
    const version = this.#activeVersionRow(row);
    if (!version || installation.packageState !== "installed")
      throw new Error("SKILL_PACKAGE_MISSING");
    return {
      installation,
      packagePath: String(version.package_path),
      scripts: JSON.parse(String(version.scripts_json)) as string[],
    };
  }

  enabledPackages(workspaceId: string, preferredInstallationId?: string): ActiveSkillPackage[] {
    const candidates = this.list()
      .filter((skill) => skill.enabled && skill.packageState === "installed")
      .filter((skill) => skill.scope !== "workspace" || skill.workspaceId === workspaceId)
      .map((skill) => this.activePackage(skill.id));
    const priority = { builtin: 0, personal: 1, workspace: 2 } as const;
    const selected = new Map<string, ActiveSkillPackage>();
    for (const candidate of candidates.sort(
      (left, right) => priority[right.installation.scope] - priority[left.installation.scope],
    )) {
      const current = selected.get(candidate.installation.name);
      if (!current || candidate.installation.id === preferredInstallationId) {
        selected.set(candidate.installation.name, candidate);
      }
    }
    if (preferredInstallationId) {
      const preferred = candidates.find(
        ({ installation }) => installation.id === preferredInstallationId,
      );
      if (!preferred) throw new Error("SKILL_NOT_ENABLED");
      selected.set(preferred.installation.name, preferred);
    }
    return [...selected.values()];
  }

  beginInvocation(input: {
    installationId: string;
    generationId: string;
    conversationId: string;
    trigger: SkillInvocation["trigger"];
    reason: string;
    loaded?: boolean;
  }): SkillInvocation {
    const skill = this.get(input.installationId);
    if (!skill.enabled) throw new Error("SKILL_NOT_ENABLED");
    const existing = this.#database
      .prepare("SELECT id FROM skill_invocations WHERE generation_id = ? AND installation_id = ?")
      .get(input.generationId, input.installationId) as { id: string } | undefined;
    if (!existing) {
      this.#database
        .prepare(
          `INSERT INTO skill_invocations
           (id, installation_id, generation_id, conversation_id, trigger, status, reason,
            started_at, completed_at, error_code)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)`,
        )
        .run(
          this.#idFactory(),
          input.installationId,
          input.generationId,
          input.conversationId,
          input.trigger,
          input.loaded ? "loaded" : "selected",
          input.reason,
          this.#now(),
        );
    } else if (input.loaded) {
      this.#database
        .prepare(
          "UPDATE skill_invocations SET status = 'loaded' WHERE id = ? AND status = 'selected'",
        )
        .run(existing.id);
    }
    this.#database
      .prepare("UPDATE skill_installations SET last_used_at = ? WHERE id = ?")
      .run(this.#now(), input.installationId);
    return this.invocation(
      existing?.id ?? this.#invocationId(input.generationId, input.installationId),
    );
  }

  completeGeneration(
    generationId: string,
    status: "completed" | "failed" | "cancelled",
    errorCode?: string,
  ): void {
    this.#database
      .prepare(
        `UPDATE skill_invocations SET status = ?, completed_at = ?, error_code = ?
         WHERE generation_id = ? AND status IN ('selected', 'loaded')`,
      )
      .run(status, this.#now(), errorCode ?? null, generationId);
  }

  listInvocations(input: { conversationId?: string; limit?: number } = {}): SkillInvocation[] {
    const rows = input.conversationId
      ? (this.#database
          .prepare(
            `SELECT id FROM skill_invocations WHERE conversation_id = ?
             ORDER BY started_at DESC LIMIT ?`,
          )
          .all(input.conversationId, input.limit ?? 100) as SqlRow[])
      : (this.#database
          .prepare("SELECT id FROM skill_invocations ORDER BY started_at DESC LIMIT ?")
          .all(input.limit ?? 100) as SqlRow[]);
    return rows.map((row) => this.invocation(String(row.id)));
  }

  invocation(invocationId: string): SkillInvocation {
    const row = this.#database
      .prepare("SELECT * FROM skill_invocations WHERE id = ?")
      .get(invocationId) as SqlRow | undefined;
    if (!row) throw new Error("SKILL_INVOCATION_NOT_FOUND");
    return skillInvocationSchema.parse({
      id: row.id,
      installationId: row.installation_id,
      generationId: row.generation_id,
      conversationId: row.conversation_id,
      trigger: row.trigger,
      status: row.status,
      reason: row.reason,
      startedAt: row.started_at,
      completedAt: row.completed_at,
      errorCode: row.error_code,
    });
  }

  #mutate(
    installationId: string,
    operation: (row: SqlRow, now: string) => void,
  ): SkillInstallation {
    return this.#transaction(() => {
      const row = this.#row(installationId);
      if (!row || row.deleted_at !== null) throw new Error("SKILL_NOT_FOUND");
      const now = this.#now();
      operation(row, now);
      const skill = this.get(installationId);
      if (skill.scope !== "builtin") this.#queueSyncUpsert(skill, now);
      return skill;
    });
  }

  #row(installationId: string): SqlRow | undefined {
    return this.#database
      .prepare("SELECT * FROM skill_installations WHERE id = ? AND owner_profile_id = ?")
      .get(installationId, this.#ownerProfileId) as SqlRow | undefined;
  }

  #activeVersionRow(row: SqlRow): SqlRow | undefined {
    if (!row.active_version_id) return undefined;
    return this.#database
      .prepare("SELECT * FROM skill_versions WHERE id = ? AND installation_id = ?")
      .get(String(row.active_version_id), String(row.id)) as SqlRow | undefined;
  }

  #invocationId(generationId: string, installationId: string): string {
    const row = this.#database
      .prepare("SELECT id FROM skill_invocations WHERE generation_id = ? AND installation_id = ?")
      .get(generationId, installationId) as { id: string } | undefined;
    if (!row) throw new Error("SKILL_INVOCATION_NOT_FOUND");
    return row.id;
  }

  #syncEnabled(): boolean {
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    return uuid.test(this.#ownerProfileId) && this.#deviceId !== null && uuid.test(this.#deviceId);
  }

  #queueSyncUpsert(skill: SkillInstallation, createdAt: string): void {
    if (!this.#syncEnabled() || !this.#deviceId) return;
    const row = this.#row(skill.id);
    if (!row) return;
    const payload = skillInstallationSyncSchema.parse({
      id: skill.id,
      ownerProfileId: skill.ownerProfileId,
      name: skill.name,
      displayName: skill.displayName,
      description: skill.description,
      version: skill.version,
      publisher: skill.publisher,
      scope: skill.scope,
      workspaceId: skill.workspaceId,
      sourceKind: skill.sourceKind,
      sourceLabel: skill.sourceLabel,
      checksumSha256: skill.checksumSha256,
      trust: skill.trust,
      enabled: Number(row.desired_enabled) === 1,
      autoInvoke: skill.autoInvoke,
      permissionDigest: skill.permissionDigest,
      declaredTools: skill.declaredTools,
      declaredMcpServers: skill.declaredMcpServers,
      permissions: skill.permissions,
      platforms: skill.platforms,
      installedAt: skill.installedAt,
      updatedAt: skill.updatedAt,
      revision: skill.revision,
    });
    this.#queueSync(skill.id, "upsert", payload, createdAt);
  }

  #queueSyncDelete(installationId: string, createdAt: string): void {
    if (!this.#syncEnabled()) return;
    this.#queueSync(installationId, "delete", null, createdAt);
  }

  #queueSync(
    objectId: string,
    mutation: "upsert" | "delete",
    payload: SkillInstallationSync | null,
    createdAt: string,
  ): void {
    if (!this.#deviceId) return;
    const state = this.#database
      .prepare(
        `SELECT cloud_revision FROM sync_object_state
         WHERE account_id = ? AND object_type = 'skill_installation' AND object_id = ?`,
      )
      .get(this.#ownerProfileId, objectId) as SqlRow | undefined;
    const pending = this.#database
      .prepare(
        `SELECT COUNT(*) AS count FROM sync_outbox
         WHERE account_id = ? AND object_type = 'skill_installation' AND object_id = ?
           AND status = 'pending'`,
      )
      .get(this.#ownerProfileId, objectId) as { count: number };
    const operationId = this.#idFactory();
    this.#database
      .prepare(
        `INSERT INTO sync_outbox
         (operation_id, account_id, device_id, object_type, object_id, mutation, base_revision,
          payload_version, payload_json, idempotency_key, created_at, status)
         VALUES (?, ?, ?, 'skill_installation', ?, ?, ?, 1, ?, ?, ?, 'pending')`,
      )
      .run(
        operationId,
        this.#ownerProfileId,
        this.#deviceId,
        objectId,
        mutation,
        Number(state?.cloud_revision ?? 0) + Number(pending.count),
        payload === null ? null : JSON.stringify(payload),
        `sync:${operationId}`,
        createdAt,
      );
  }

  #transaction<T>(operation: () => T): T {
    this.#database.exec("BEGIN IMMEDIATE");
    try {
      const result = operation();
      this.#database.exec("COMMIT");
      return result;
    } catch (error) {
      this.#database.exec("ROLLBACK");
      throw error;
    }
  }
}
