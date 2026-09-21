import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import {
  type Conversation,
  type ConversationMoveToProjectInput,
  conversationMoveToProjectInputSchema,
  conversationSchema,
  type Project,
  type ProjectArchiveInput,
  type ProjectCreateInput,
  type ProjectDetail,
  type ProjectDirectory,
  type ProjectDirectoryBinding,
  type ProjectDirectoryConnectInput,
  type ProjectDirectoryCreateInput,
  type ProjectDirectoryDisconnectInput,
  type ProjectDirectoryRemoveInput,
  type ProjectDirectorySetPrimaryInput,
  type ProjectDirectoryState,
  type ProjectSummary,
  type ProjectUpdateInput,
  projectArchiveInputSchema,
  projectCreateInputSchema,
  projectDetailSchema,
  projectDirectoryBindingSchema,
  projectDirectoryConnectInputSchema,
  projectDirectoryCreateInputSchema,
  projectDirectoryDisconnectInputSchema,
  projectDirectoryRemoveInputSchema,
  projectDirectorySchema,
  projectDirectorySetPrimaryInputSchema,
  projectDirectoryStateSchema,
  projectDirectorySyncPayloadSchema,
  projectSchema,
  projectSummarySchema,
  projectSyncPayloadSchema,
  projectUpdateInputSchema,
  type RemoteProjectSnapshotPayload,
  remoteProjectSnapshotPayloadSchema,
  type SyncOperation,
} from "@openerx/contracts";
import { migrateDatabase } from "./migrations";

type SqlRow = Record<string, unknown>;

export interface ProjectRepositoryOptions {
  ownerProfileId?: string;
  deviceId?: string;
  now?: () => string;
  idFactory?: () => string;
}

export interface ProjectGenerationDirectory {
  projectDirectoryId: string;
  projectDirectoryBindingId: string;
  sourceWorkspaceGrantId: string;
  sourceRevision: number;
  displayName: string;
  role: ProjectDirectory["role"];
  desiredAccess: ProjectDirectory["desiredAccess"];
}

export interface ProjectGenerationContext {
  projectId: string;
  projectRevision: number;
  instructions: string;
  directories: ProjectGenerationDirectory[];
}

const localDeviceId = "00000000-0000-4000-8000-000000000000";

export class ProjectRepository {
  readonly #database: DatabaseSync;
  readonly #ownerProfileId: string;
  readonly #deviceId: string;
  readonly #syncDeviceId: string | null;
  readonly #now: () => string;
  readonly #idFactory: () => string;

  constructor(databasePath: string, options: ProjectRepositoryOptions = {}) {
    this.#database = new DatabaseSync(databasePath);
    this.#ownerProfileId = options.ownerProfileId ?? "local-default";
    this.#deviceId = options.deviceId ?? localDeviceId;
    this.#syncDeviceId = options.deviceId ?? null;
    this.#now = options.now ?? (() => new Date().toISOString());
    this.#idFactory = options.idFactory ?? randomUUID;
    try {
      migrateDatabase(this.#database);
    } catch (error) {
      this.#database.close();
      throw error;
    }
  }

  close(): void {
    this.#database.close();
  }

  listProjects(includeArchived = false): ProjectSummary[] {
    const rows = this.#database
      .prepare(
        `SELECT * FROM projects
         WHERE owner_profile_id = ? AND (? = 1 OR archived_at IS NULL)
         ORDER BY CASE WHEN pinned_rank IS NULL THEN 1 ELSE 0 END,
                  pinned_rank, updated_at DESC, id`,
      )
      .all(this.#ownerProfileId, includeArchived ? 1 : 0) as SqlRow[];
    return rows.map((row) => {
      const project = this.#project(row);
      const directoryStates = this.#directoryStates(project.id);
      const conversationCount = this.#database
        .prepare(
          `SELECT COUNT(*) AS count FROM conversations
           WHERE owner_profile_id = ? AND project_id = ? AND deleted_at IS NULL`,
        )
        .get(this.#ownerProfileId, project.id) as { count: number };
      const connectedDirectoryCount = directoryStates.filter(
        ({ connectionState }) => connectionState === "connected",
      ).length;
      return projectSummarySchema.parse({
        ...project,
        conversationCount: Number(conversationCount.count),
        directoryCount: directoryStates.length,
        connectedDirectoryCount,
        reconnectRequiredCount: directoryStates.length - connectedDirectoryCount,
      });
    });
  }

  getProject(projectId: string): ProjectDetail {
    const project = this.#getProjectEntity(projectId);
    return projectDetailSchema.parse({
      project,
      directories: this.#directoryStates(project.id),
    });
  }

  remoteSnapshot(includeArchived = false): RemoteProjectSnapshotPayload {
    return remoteProjectSnapshotPayloadSchema.parse({
      kind: "project.snapshot",
      generatedAt: this.#now(),
      projects: this.listProjects(includeArchived).map((summary) => ({
        projectId: summary.id,
        name: summary.name,
        instructions: summary.instructions,
        pinnedRank: summary.pinnedRank,
        archivedAt: summary.archivedAt,
        revision: summary.revision,
        conversationCount: summary.conversationCount,
        directories: this.getProject(summary.id).directories.map((state) => ({
          projectDirectoryId: state.directory.id,
          displayName: state.directory.displayName,
          role: state.directory.role,
          desiredAccess: state.directory.desiredAccess,
          connectionState: state.connectionState,
        })),
      })),
    });
  }

  generationContext(conversationId: string): ProjectGenerationContext | null {
    const conversation = this.#getConversationEntity(conversationId);
    if (!conversation.projectId) return null;
    const project = this.#getActiveProject(conversation.projectId);
    const directories = this.#directoryStates(project.id).flatMap((state) => {
      if (!state.binding) return [];
      return [
        {
          projectDirectoryId: state.directory.id,
          projectDirectoryBindingId: state.binding.id,
          sourceWorkspaceGrantId: state.binding.workspaceGrantId,
          sourceRevision: Math.max(state.directory.revision, state.binding.revision),
          displayName: state.directory.displayName,
          role: state.directory.role,
          desiredAccess: state.directory.desiredAccess,
        },
      ];
    });
    return {
      projectId: project.id,
      projectRevision: project.revision,
      instructions: project.instructions,
      directories,
    };
  }

  directoryAuthorizationReplay(
    operationId: string,
    mode: "create" | "connect",
  ): ProjectDirectoryState | null {
    return this.#operationResult(
      operationId,
      mode === "create" ? "project.directory.create" : "project.directory.connect",
      projectDirectoryStateSchema,
    );
  }

  createProject(input: ProjectCreateInput): Project {
    const parsed = projectCreateInputSchema.parse(input);
    const duplicate = this.#operationResult(parsed.operationId, "project.create", projectSchema);
    if (duplicate) return duplicate;
    return this.#transaction(() => {
      const replay = this.#operationResult(parsed.operationId, "project.create", projectSchema);
      if (replay) return replay;
      const now = this.#now();
      const id = this.#idFactory();
      this.#database
        .prepare(
          `INSERT INTO projects
           (id, owner_profile_id, name, instructions, pinned_rank, created_at, updated_at,
            archived_at, revision)
           VALUES (?, ?, ?, ?, NULL, ?, ?, NULL, 1)`,
        )
        .run(id, this.#ownerProfileId, parsed.name, parsed.instructions, now, now);
      const project = this.#getProjectEntity(id);
      this.#queueProjectUpsert(project, now);
      this.#storeOperation(parsed.operationId, "project.create", project, now);
      return project;
    });
  }

  updateProject(input: ProjectUpdateInput): Project {
    const parsed = projectUpdateInputSchema.parse(input);
    const duplicate = this.#operationResult(parsed.operationId, "project.update", projectSchema);
    if (duplicate) return duplicate;
    return this.#transaction(() => {
      const replay = this.#operationResult(parsed.operationId, "project.update", projectSchema);
      if (replay) return replay;
      const current = this.#getProjectEntity(parsed.projectId);
      this.#assertProjectRevision(current, parsed.expectedRevision);
      const now = this.#now();
      this.#database
        .prepare(
          `UPDATE projects
           SET name = ?, instructions = ?, pinned_rank = ?, updated_at = ?, revision = revision + 1
           WHERE id = ? AND owner_profile_id = ?`,
        )
        .run(
          parsed.name ?? current.name,
          parsed.instructions ?? current.instructions,
          parsed.pinnedRank === undefined ? current.pinnedRank : parsed.pinnedRank,
          now,
          current.id,
          this.#ownerProfileId,
        );
      const project = this.#getProjectEntity(current.id);
      this.#queueProjectUpsert(project, now);
      this.#storeOperation(parsed.operationId, "project.update", project, now);
      return project;
    });
  }

  setProjectArchived(input: ProjectArchiveInput): Project {
    const parsed = projectArchiveInputSchema.parse(input);
    const duplicate = this.#operationResult(parsed.operationId, "project.archive", projectSchema);
    if (duplicate) return duplicate;
    return this.#transaction(() => {
      const replay = this.#operationResult(parsed.operationId, "project.archive", projectSchema);
      if (replay) return replay;
      const current = this.#getProjectEntity(parsed.projectId);
      this.#assertProjectRevision(current, parsed.expectedRevision);
      const now = this.#now();
      this.#database
        .prepare(
          `UPDATE projects
           SET archived_at = ?, updated_at = ?, revision = revision + 1
           WHERE id = ? AND owner_profile_id = ?`,
        )
        .run(parsed.archived ? now : null, now, current.id, this.#ownerProfileId);
      const project = this.#getProjectEntity(current.id);
      this.#queueProjectUpsert(project, now);
      this.#storeOperation(parsed.operationId, "project.archive", project, now);
      return project;
    });
  }

  addDirectory(input: ProjectDirectoryCreateInput): ProjectDirectoryState {
    const parsed = projectDirectoryCreateInputSchema.parse(input);
    const duplicate = this.#operationResult(
      parsed.operationId,
      "project.directory.create",
      projectDirectoryStateSchema,
    );
    if (duplicate) return duplicate;
    return this.#transaction(() => {
      const replay = this.#operationResult(
        parsed.operationId,
        "project.directory.create",
        projectDirectoryStateSchema,
      );
      if (replay) return replay;
      const project = this.#getActiveProject(parsed.projectId);
      this.#assertProjectRevision(project, parsed.expectedProjectRevision);
      this.#assertWorkspaceGrant(parsed.workspaceGrantId, parsed.desiredAccess);
      const existingCount = this.#database
        .prepare(
          `SELECT COUNT(*) AS count FROM project_directories
           WHERE project_id = ? AND owner_profile_id = ? AND deleted_at IS NULL`,
        )
        .get(project.id, this.#ownerProfileId) as { count: number };
      const now = this.#now();
      const directoryId = this.#idFactory();
      const bindingId = this.#idFactory();
      this.#database
        .prepare(
          `INSERT INTO project_directories
           (id, owner_profile_id, project_id, display_name, role, desired_access,
            created_at, updated_at, deleted_at, revision)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, 1)`,
        )
        .run(
          directoryId,
          this.#ownerProfileId,
          project.id,
          parsed.displayName,
          Number(existingCount.count) === 0 ? "primary" : "additional",
          parsed.desiredAccess,
          now,
          now,
        );
      this.#database
        .prepare(
          `INSERT INTO project_directory_bindings
           (id, owner_profile_id, project_directory_id, device_id, workspace_grant_id,
            last_validated_at, created_at, updated_at, revoked_at, revision)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, 1)`,
        )
        .run(
          bindingId,
          this.#ownerProfileId,
          directoryId,
          this.#deviceId,
          parsed.workspaceGrantId,
          now,
          now,
          now,
        );
      this.#touchProject(project.id, now);
      const state = this.#directoryState(this.#getDirectoryEntity(directoryId));
      this.#queueProjectUpsert(this.#getProjectEntity(project.id), now);
      this.#queueDirectoryUpsert(state.directory, now);
      this.#storeOperation(parsed.operationId, "project.directory.create", state, now);
      return state;
    });
  }

  connectDirectory(input: ProjectDirectoryConnectInput): ProjectDirectoryState {
    const parsed = projectDirectoryConnectInputSchema.parse(input);
    const duplicate = this.#operationResult(
      parsed.operationId,
      "project.directory.connect",
      projectDirectoryStateSchema,
    );
    if (duplicate) return duplicate;
    return this.#transaction(() => {
      const replay = this.#operationResult(
        parsed.operationId,
        "project.directory.connect",
        projectDirectoryStateSchema,
      );
      if (replay) return replay;
      const directory = this.#getDirectoryEntity(parsed.projectDirectoryId);
      const project = this.#getActiveProject(directory.projectId);
      this.#assertProjectRevision(project, parsed.expectedProjectRevision);
      this.#assertWorkspaceGrant(parsed.workspaceGrantId, directory.desiredAccess);
      const now = this.#now();
      const existing = this.#activeBindingRow(directory.id);
      if (existing) {
        if (this.#activeBindingRow(directory.id, true)) {
          throw new Error("PROJECT_DIRECTORY_ALREADY_CONNECTED");
        }
        this.#revokeBinding(existing, now);
      }
      this.#database
        .prepare(
          `INSERT INTO project_directory_bindings
           (id, owner_profile_id, project_directory_id, device_id, workspace_grant_id,
            last_validated_at, created_at, updated_at, revoked_at, revision)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, 1)`,
        )
        .run(
          this.#idFactory(),
          this.#ownerProfileId,
          directory.id,
          this.#deviceId,
          parsed.workspaceGrantId,
          now,
          now,
          now,
        );
      const state = this.#directoryState(directory);
      this.#storeOperation(parsed.operationId, "project.directory.connect", state, now);
      return state;
    });
  }

  setPrimaryDirectory(input: ProjectDirectorySetPrimaryInput): ProjectDetail {
    const parsed = projectDirectorySetPrimaryInputSchema.parse(input);
    const duplicate = this.#operationResult(
      parsed.operationId,
      "project.directory.setPrimary",
      projectDetailSchema,
    );
    if (duplicate) return duplicate;
    return this.#transaction(() => {
      const replay = this.#operationResult(
        parsed.operationId,
        "project.directory.setPrimary",
        projectDetailSchema,
      );
      if (replay) return replay;
      const project = this.#getActiveProject(parsed.projectId);
      this.#assertProjectRevision(project, parsed.expectedProjectRevision);
      const target = this.#getDirectoryEntity(parsed.projectDirectoryId);
      if (target.projectId !== project.id) throw new Error("PROJECT_SCOPE_MISMATCH");
      const previousPrimary =
        target.role === "primary"
          ? null
          : this.#directory(
              this.#database
                .prepare(
                  `SELECT * FROM project_directories
                   WHERE project_id = ? AND owner_profile_id = ? AND role = 'primary'
                     AND deleted_at IS NULL`,
                )
                .get(project.id, this.#ownerProfileId) as SqlRow,
            );
      if (target.role !== "primary") {
        const now = this.#now();
        this.#database
          .prepare(
            `UPDATE project_directories
             SET role = 'additional', updated_at = ?, revision = revision + 1
             WHERE project_id = ? AND owner_profile_id = ? AND role = 'primary'
               AND deleted_at IS NULL`,
          )
          .run(now, project.id, this.#ownerProfileId);
        this.#database
          .prepare(
            `UPDATE project_directories
             SET role = 'primary', updated_at = ?, revision = revision + 1
             WHERE id = ? AND owner_profile_id = ? AND deleted_at IS NULL`,
          )
          .run(now, target.id, this.#ownerProfileId);
        this.#touchProject(project.id, now);
      }
      const detail = this.getProject(project.id);
      const now = this.#now();
      if (previousPrimary) {
        const updatedPrevious = detail.directories.find(
          ({ directory }) => directory.id === previousPrimary.id,
        )?.directory;
        const updatedTarget = detail.directories.find(
          ({ directory }) => directory.id === target.id,
        )?.directory;
        if (!updatedPrevious || !updatedTarget) throw new Error("PROJECT_DIRECTORY_UNAVAILABLE");
        this.#queueDirectoryUpsert(updatedPrevious, now);
        this.#queueDirectoryUpsert(updatedTarget, now);
        this.#queueProjectUpsert(detail.project, now);
      }
      this.#storeOperation(parsed.operationId, "project.directory.setPrimary", detail, now);
      return detail;
    });
  }

  disconnectDirectory(input: ProjectDirectoryDisconnectInput): ProjectDirectoryState {
    const parsed = projectDirectoryDisconnectInputSchema.parse(input);
    const duplicate = this.#operationResult(
      parsed.operationId,
      "project.directory.disconnect",
      projectDirectoryStateSchema,
    );
    if (duplicate) return duplicate;
    return this.#transaction(() => {
      const replay = this.#operationResult(
        parsed.operationId,
        "project.directory.disconnect",
        projectDirectoryStateSchema,
      );
      if (replay) return replay;
      const directory = this.#getDirectoryEntity(parsed.projectDirectoryId);
      const project = this.#getProjectEntity(directory.projectId);
      this.#assertProjectRevision(project, parsed.expectedProjectRevision);
      const bindingRow = this.#activeBindingRow(directory.id);
      if (!bindingRow) throw new Error("PROJECT_DIRECTORY_UNAVAILABLE");
      const now = this.#now();
      this.#revokeBinding(bindingRow, now);
      const state = this.#directoryState(directory);
      this.#storeOperation(parsed.operationId, "project.directory.disconnect", state, now);
      return state;
    });
  }

  removeDirectory(input: ProjectDirectoryRemoveInput): ProjectDetail {
    const parsed = projectDirectoryRemoveInputSchema.parse(input);
    const duplicate = this.#operationResult(
      parsed.operationId,
      "project.directory.remove",
      projectDetailSchema,
    );
    if (duplicate) return duplicate;
    return this.#transaction(() => {
      const replay = this.#operationResult(
        parsed.operationId,
        "project.directory.remove",
        projectDetailSchema,
      );
      if (replay) return replay;
      const project = this.#getProjectEntity(parsed.projectId);
      this.#assertProjectRevision(project, parsed.expectedProjectRevision);
      const directory = this.#getDirectoryEntity(parsed.projectDirectoryId);
      if (directory.projectId !== project.id) throw new Error("PROJECT_SCOPE_MISMATCH");
      const remaining = (
        this.#database
          .prepare(
            `SELECT * FROM project_directories
             WHERE project_id = ? AND owner_profile_id = ? AND deleted_at IS NULL AND id != ?
             ORDER BY created_at, id`,
          )
          .all(project.id, this.#ownerProfileId, directory.id) as SqlRow[]
      ).map((row) => this.#directory(row));
      const now = this.#now();
      if (directory.role === "primary" && remaining.length > 0) {
        const replacement = remaining.find(({ id }) => id === parsed.replacementPrimaryDirectoryId);
        if (!replacement) throw new Error("PROJECT_PRIMARY_DIRECTORY_REQUIRED");
        this.#database
          .prepare(
            `UPDATE project_directories
             SET role = 'additional', updated_at = ?, revision = revision + 1
             WHERE id = ? AND owner_profile_id = ?`,
          )
          .run(now, directory.id, this.#ownerProfileId);
        this.#database
          .prepare(
            `UPDATE project_directories
             SET role = 'primary', updated_at = ?, revision = revision + 1
             WHERE id = ? AND owner_profile_id = ? AND deleted_at IS NULL`,
          )
          .run(now, replacement.id, this.#ownerProfileId);
      } else if (parsed.replacementPrimaryDirectoryId !== null) {
        throw new Error("PROJECT_PRIMARY_DIRECTORY_REPLACEMENT_INVALID");
      }
      const bindingRows = this.#database
        .prepare(
          `SELECT * FROM project_directory_bindings
           WHERE project_directory_id = ? AND owner_profile_id = ? AND revoked_at IS NULL`,
        )
        .all(directory.id, this.#ownerProfileId) as SqlRow[];
      for (const bindingRow of bindingRows) this.#revokeBinding(bindingRow, now);
      this.#database
        .prepare(
          `UPDATE project_directories
           SET deleted_at = ?, updated_at = ?, revision = revision + 1
           WHERE id = ? AND owner_profile_id = ?`,
        )
        .run(now, now, directory.id, this.#ownerProfileId);
      this.#touchProject(project.id, now);
      const detail = this.getProject(project.id);
      this.#queueDirectoryDelete(directory.id, now);
      if (parsed.replacementPrimaryDirectoryId) {
        const replacement = detail.directories.find(
          ({ directory: candidate }) => candidate.id === parsed.replacementPrimaryDirectoryId,
        )?.directory;
        if (!replacement) throw new Error("PROJECT_PRIMARY_DIRECTORY_REQUIRED");
        this.#queueDirectoryUpsert(replacement, now);
      }
      this.#queueProjectUpsert(detail.project, now);
      this.#storeOperation(parsed.operationId, "project.directory.remove", detail, now);
      return detail;
    });
  }

  moveConversationToProject(input: ConversationMoveToProjectInput): Conversation {
    const parsed = conversationMoveToProjectInputSchema.parse(input);
    const duplicate = this.#operationResult(
      parsed.operationId,
      "conversation.moveToProject",
      conversationSchema,
    );
    if (duplicate) return duplicate;
    return this.#transaction(() => {
      const replay = this.#operationResult(
        parsed.operationId,
        "conversation.moveToProject",
        conversationSchema,
      );
      if (replay) return replay;
      const conversation = this.#getConversationEntity(parsed.conversationId);
      if (conversation.revision !== parsed.expectedConversationRevision) {
        throw new Error("CONVERSATION_REVISION_CONFLICT");
      }
      if (this.#hasActiveGeneration(conversation.id)) {
        throw new Error("PROJECT_MOVE_BLOCKED_BY_ACTIVE_RUN");
      }
      if (parsed.projectId !== null) this.#getActiveProject(parsed.projectId);
      const now = this.#now();
      if (conversation.projectId !== parsed.projectId) {
        this.#database
          .prepare(
            `UPDATE conversations
             SET project_id = ?, updated_at = ?, revision = revision + 1
             WHERE id = ? AND owner_profile_id = ?`,
          )
          .run(parsed.projectId, now, conversation.id, this.#ownerProfileId);
      }
      const moved = this.#getConversationEntity(conversation.id);
      if (conversation.projectId !== parsed.projectId) {
        this.#queueSync(
          "conversation",
          moved.id,
          "upsert",
          JSON.parse(JSON.stringify(moved)) as Record<string, unknown>,
          now,
        );
      }
      this.#storeOperation(parsed.operationId, "conversation.moveToProject", moved, now);
      return moved;
    });
  }

  #getProjectEntity(id: string): Project {
    const row = this.#database
      .prepare("SELECT * FROM projects WHERE id = ? AND owner_profile_id = ?")
      .get(id, this.#ownerProfileId) as SqlRow | undefined;
    if (!row) throw new Error("PROJECT_NOT_FOUND");
    return this.#project(row);
  }

  #getActiveProject(id: string): Project {
    const project = this.#getProjectEntity(id);
    if (project.archivedAt) throw new Error("PROJECT_ARCHIVED");
    return project;
  }

  #project(row: SqlRow): Project {
    return projectSchema.parse({
      id: row.id,
      ownerProfileId: row.owner_profile_id,
      name: row.name,
      instructions: row.instructions,
      pinnedRank: row.pinned_rank === null ? null : Number(row.pinned_rank),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      archivedAt: row.archived_at,
      revision: Number(row.revision),
    });
  }

  #getDirectoryEntity(id: string): ProjectDirectory {
    const row = this.#database
      .prepare(
        `SELECT * FROM project_directories
         WHERE id = ? AND owner_profile_id = ? AND deleted_at IS NULL`,
      )
      .get(id, this.#ownerProfileId) as SqlRow | undefined;
    if (!row) throw new Error("PROJECT_DIRECTORY_UNAVAILABLE");
    return this.#directory(row);
  }

  #directory(row: SqlRow): ProjectDirectory {
    return projectDirectorySchema.parse({
      id: row.id,
      ownerProfileId: row.owner_profile_id,
      projectId: row.project_id,
      displayName: row.display_name,
      role: row.role,
      desiredAccess: row.desired_access,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      deletedAt: row.deleted_at,
      revision: Number(row.revision),
    });
  }

  #binding(row: SqlRow): ProjectDirectoryBinding {
    return projectDirectoryBindingSchema.parse({
      id: row.id,
      ownerProfileId: row.owner_profile_id,
      projectDirectoryId: row.project_directory_id,
      deviceId: row.device_id,
      workspaceGrantId: row.workspace_grant_id,
      lastValidatedAt: row.last_validated_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      revokedAt: row.revoked_at,
      revision: Number(row.revision),
    });
  }

  #directoryStates(projectId: string): ProjectDirectoryState[] {
    return (
      this.#database
        .prepare(
          `SELECT * FROM project_directories
           WHERE project_id = ? AND owner_profile_id = ? AND deleted_at IS NULL
           ORDER BY CASE role WHEN 'primary' THEN 0 ELSE 1 END, created_at, id`,
        )
        .all(projectId, this.#ownerProfileId) as SqlRow[]
    ).map((row) => this.#directoryState(this.#directory(row)));
  }

  #directoryState(directory: ProjectDirectory): ProjectDirectoryState {
    const bindingRow = this.#activeBindingRow(directory.id, true);
    return projectDirectoryStateSchema.parse({
      directory,
      binding: bindingRow ? this.#binding(bindingRow) : null,
      connectionState: bindingRow ? "connected" : "reconnect_required",
    });
  }

  #activeBindingRow(projectDirectoryId: string, requireValidGrant = false): SqlRow | undefined {
    const now = this.#now();
    const grantClause = requireValidGrant
      ? "AND grant.revoked_at IS NULL AND (grant.expires_at IS NULL OR grant.expires_at > ?)"
      : "";
    const values: Array<string | number | null> = [
      projectDirectoryId,
      this.#ownerProfileId,
      this.#deviceId,
    ];
    if (requireValidGrant) values.push(now);
    return this.#database
      .prepare(
        `SELECT binding.* FROM project_directory_bindings AS binding
         JOIN workspace_grants AS grant ON grant.id = binding.workspace_grant_id
         WHERE binding.project_directory_id = ? AND binding.owner_profile_id = ?
           AND binding.device_id = ? AND binding.revoked_at IS NULL
           ${grantClause}
         ORDER BY binding.updated_at DESC, binding.id DESC LIMIT 1`,
      )
      .get(...values) as SqlRow | undefined;
  }

  #assertWorkspaceGrant(
    workspaceGrantId: string,
    desiredAccess: ProjectDirectory["desiredAccess"],
  ): void {
    const row = this.#database
      .prepare(
        `SELECT owner_profile_id, conversation_id, access, expires_at, revoked_at
         FROM workspace_grants WHERE id = ?`,
      )
      .get(workspaceGrantId) as SqlRow | undefined;
    if (!row) throw new Error("PROJECT_DIRECTORY_UNAVAILABLE");
    if (row.owner_profile_id !== this.#ownerProfileId || row.conversation_id !== null) {
      throw new Error("PROJECT_SCOPE_MISMATCH");
    }
    if (
      row.revoked_at !== null ||
      (row.expires_at !== null && String(row.expires_at) <= this.#now())
    ) {
      throw new Error("PROJECT_DIRECTORY_UNAVAILABLE");
    }
    if (row.access !== desiredAccess) throw new Error("PROJECT_SCOPE_MISMATCH");
  }

  #assertProjectRevision(project: Project, expectedRevision: number): void {
    if (project.revision !== expectedRevision) throw new Error("PROJECT_REVISION_CONFLICT");
  }

  #touchProject(projectId: string, now: string): void {
    this.#database
      .prepare(
        `UPDATE projects SET updated_at = ?, revision = revision + 1
         WHERE id = ? AND owner_profile_id = ?`,
      )
      .run(now, projectId, this.#ownerProfileId);
  }

  #revokeBinding(bindingRow: SqlRow, now: string): void {
    const binding = this.#binding(bindingRow);
    this.#database
      .prepare(
        `UPDATE workspace_grants
         SET revoked_at = COALESCE(revoked_at, ?)
         WHERE id = ? OR id IN (
           SELECT workspace_grant_id FROM workspace_bindings
           WHERE project_directory_binding_id = ?
      )`,
      )
      .run(now, binding.workspaceGrantId, binding.id);
    this.#database
      .prepare(
        `UPDATE capability_scopes
         SET revoked_at = COALESCE(revoked_at, ?)
         WHERE owner_profile_id = ? AND resource_type = 'workspace'
           AND (
             resource = ? OR resource IN (
               SELECT workspace_grant_id FROM workspace_bindings
               WHERE project_directory_binding_id = ?
             )
           )`,
      )
      .run(now, this.#ownerProfileId, binding.workspaceGrantId, binding.id);
    this.#database
      .prepare("DELETE FROM workspace_bindings WHERE project_directory_binding_id = ?")
      .run(binding.id);
    this.#database
      .prepare(
        `UPDATE project_directory_bindings
         SET revoked_at = COALESCE(revoked_at, ?), updated_at = ?, revision = revision + 1
         WHERE id = ? AND owner_profile_id = ?`,
      )
      .run(now, now, binding.id, this.#ownerProfileId);
  }

  #getConversationEntity(id: string): Conversation {
    const row = this.#database
      .prepare(
        `SELECT * FROM conversations
         WHERE id = ? AND owner_profile_id = ? AND deleted_at IS NULL`,
      )
      .get(id, this.#ownerProfileId) as SqlRow | undefined;
    if (!row) throw new Error("Conversation not found");
    return conversationSchema.parse({
      id: row.id,
      ownerProfileId: row.owner_profile_id,
      projectId: row.project_id,
      title: row.title,
      activeBranchId: row.active_branch_id,
      selectedModelRef: row.selected_model_ref,
      thinkingLevel: row.thinking_level,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      archivedAt: row.archived_at,
      deletedAt: row.deleted_at,
      revision: Number(row.revision),
    });
  }

  #hasActiveGeneration(conversationId: string): boolean {
    return (
      this.#database
        .prepare(
          `SELECT 1 FROM messages
           WHERE conversation_id = ? AND status IN ('pending', 'streaming') LIMIT 1`,
        )
        .get(conversationId) !== undefined
    );
  }

  #syncEnabled(): boolean {
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    return (
      uuid.test(this.#ownerProfileId) &&
      this.#syncDeviceId !== null &&
      uuid.test(this.#syncDeviceId)
    );
  }

  #queueProjectUpsert(project: Project, createdAt: string): void {
    const payload = projectSyncPayloadSchema.parse(project);
    this.#queueSync(
      "project",
      project.id,
      "upsert",
      JSON.parse(JSON.stringify(payload)) as Record<string, unknown>,
      createdAt,
    );
  }

  #queueDirectoryUpsert(directory: ProjectDirectory, createdAt: string): void {
    const payload = projectDirectorySyncPayloadSchema.parse(directory);
    this.#queueSync(
      "project_directory",
      directory.id,
      "upsert",
      JSON.parse(JSON.stringify(payload)) as Record<string, unknown>,
      createdAt,
    );
  }

  #queueDirectoryDelete(projectDirectoryId: string, createdAt: string): void {
    this.#queueSync("project_directory", projectDirectoryId, "delete", null, createdAt);
  }

  #queueSync(
    objectType: SyncOperation["objectType"],
    objectId: string,
    mutation: "upsert" | "delete",
    payload: Record<string, unknown> | null,
    createdAt: string,
  ): void {
    if (!this.#syncEnabled() || !this.#syncDeviceId) return;
    const state = this.#database
      .prepare(
        `SELECT cloud_revision FROM sync_object_state
         WHERE account_id = ? AND object_type = ? AND object_id = ?`,
      )
      .get(this.#ownerProfileId, objectType, objectId) as SqlRow | undefined;
    const pending = this.#database
      .prepare(
        `SELECT COUNT(*) AS count FROM sync_outbox
         WHERE account_id = ? AND object_type = ? AND object_id = ? AND status = 'pending'`,
      )
      .get(this.#ownerProfileId, objectType, objectId) as { count: number };
    const operationId = this.#idFactory();
    this.#database
      .prepare(
        `INSERT INTO sync_outbox
         (operation_id, account_id, device_id, object_type, object_id, mutation,
          base_revision, payload_version, payload_json, idempotency_key, created_at, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, 'pending')`,
      )
      .run(
        operationId,
        this.#ownerProfileId,
        this.#syncDeviceId,
        objectType,
        objectId,
        mutation,
        Number(state?.cloud_revision ?? 0) + Number(pending.count),
        payload === null ? null : JSON.stringify(payload),
        `sync:${operationId}`,
        createdAt,
      );
  }

  #operationResult<T>(
    operationId: string,
    command: string,
    schema: { parse(value: unknown): T },
  ): T | null {
    const row = this.#database
      .prepare("SELECT command, result_json FROM idempotency WHERE key = ?")
      .get(operationId) as { command: string; result_json: string } | undefined;
    if (!row) return null;
    if (row.command !== command) throw new Error("IDEMPOTENCY_KEY_REUSED");
    return schema.parse(JSON.parse(row.result_json) as unknown);
  }

  #storeOperation(operationId: string, command: string, result: unknown, createdAt: string): void {
    this.#database
      .prepare("INSERT INTO idempotency(key, command, result_json, created_at) VALUES (?, ?, ?, ?)")
      .run(operationId, command, JSON.stringify(result), createdAt);
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
