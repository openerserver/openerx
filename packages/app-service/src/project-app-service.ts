import type {
  Conversation,
  Project,
  ProjectCommandEnvelope,
  ProjectDetail,
  ProjectDirectoryState,
  ProjectSummary,
  WorkspaceGrant,
} from "@openerx/contracts";
import type { ProjectRepository } from "@openerx/storage";

export type ProjectCommandResult =
  | Project
  | ProjectSummary[]
  | ProjectDetail
  | ProjectDirectoryState
  | Conversation;

export interface ProjectWorkspaceAuthorizer {
  grantWorkspace(input: {
    rootPath: string;
    conversationId: null;
    access: WorkspaceGrant["access"];
    allowNetwork: false;
    expiresAt: null;
    projectOperationId?: string;
  }): WorkspaceGrant;
  revokeWorkspace(workspaceGrantId: string): WorkspaceGrant;
}

export class ProjectAppService {
  readonly #repository: ProjectRepository;
  readonly #workspaces: ProjectWorkspaceAuthorizer | null;

  constructor(repository: ProjectRepository, workspaces: ProjectWorkspaceAuthorizer | null = null) {
    this.#repository = repository;
    this.#workspaces = workspaces;
  }

  handle(request: ProjectCommandEnvelope): ProjectCommandResult {
    switch (request.command) {
      case "project.list":
        return this.#repository.listProjects(request.input.includeArchived ?? false);
      case "project.get":
        return this.#repository.getProject(request.input.projectId);
      case "project.create":
        return this.#repository.createProject(request.input);
      case "project.update":
        return this.#repository.updateProject(request.input);
      case "project.archive":
        return this.#repository.setProjectArchived({ ...request.input, archived: true });
      case "project.restore":
        return this.#repository.setProjectArchived({ ...request.input, archived: false });
      case "project.directory.choose":
        return this.#chooseDirectory(request.input);
      case "project.directory.create":
        return this.#repository.addDirectory(request.input);
      case "project.directory.connect":
        return this.#repository.connectDirectory(request.input);
      case "project.directory.setPrimary":
        return this.#repository.setPrimaryDirectory(request.input);
      case "project.directory.disconnect":
        return this.#repository.disconnectDirectory(request.input);
      case "project.directory.remove":
        return this.#repository.removeDirectory(request.input);
      case "conversation.moveToProject":
        return this.#repository.moveConversationToProject(request.input);
    }
  }

  #chooseDirectory(
    input: Extract<ProjectCommandEnvelope, { command: "project.directory.choose" }>["input"],
  ): ProjectDirectoryState {
    const mode = input.projectDirectoryId === null ? "create" : "connect";
    const replay = this.#repository.directoryAuthorizationReplay(input.operationId, mode);
    if (replay) return replay;

    const detail = this.#repository.getProject(input.projectId);
    if (detail.project.archivedAt) throw new Error("PROJECT_ARCHIVED");
    if (detail.project.revision !== input.expectedProjectRevision) {
      throw new Error("PROJECT_REVISION_CONFLICT");
    }
    const existing = input.projectDirectoryId
      ? detail.directories.find(({ directory }) => directory.id === input.projectDirectoryId)
      : undefined;
    if (input.projectDirectoryId && !existing) throw new Error("PROJECT_DIRECTORY_UNAVAILABLE");
    if (existing?.binding) throw new Error("PROJECT_DIRECTORY_ALREADY_CONNECTED");
    const desiredAccess = existing?.directory.desiredAccess ?? input.desiredAccess;
    const workspaces = this.#requiredWorkspaceAuthorizer();
    let grant: WorkspaceGrant;
    try {
      grant = workspaces.grantWorkspace({
        rootPath: input.rootPath,
        conversationId: null,
        access: desiredAccess,
        allowNetwork: false,
        expiresAt: null,
        projectOperationId: input.operationId,
      });
    } catch {
      throw new Error("PROJECT_DIRECTORY_UNAVAILABLE");
    }

    try {
      const state = existing
        ? this.#repository.connectDirectory({
            operationId: input.operationId,
            projectDirectoryId: existing.directory.id,
            expectedProjectRevision: input.expectedProjectRevision,
            workspaceGrantId: grant.id,
          })
        : this.#repository.addDirectory({
            operationId: input.operationId,
            projectId: input.projectId,
            expectedProjectRevision: input.expectedProjectRevision,
            workspaceGrantId: grant.id,
            displayName: grant.displayName,
            desiredAccess,
          });
      if (state.binding?.workspaceGrantId !== grant.id) {
        workspaces.revokeWorkspace(grant.id);
      }
      return state;
    } catch (error) {
      try {
        workspaces.revokeWorkspace(grant.id);
      } catch {
        // Preserve the project error; an unbound grant cannot be projected into a generation.
      }
      throw error;
    }
  }

  #requiredWorkspaceAuthorizer(): ProjectWorkspaceAuthorizer {
    if (!this.#workspaces) throw new Error("PROJECT_DIRECTORY_AUTHORIZATION_UNAVAILABLE");
    return this.#workspaces;
  }
}
