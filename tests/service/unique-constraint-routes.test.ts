/// <reference types="bun-types" />

import { afterEach, describe, expect, mock, test } from "bun:test";
import { Hono } from "../../control-plane/service/node_modules/hono";
let importCounter = 0;

const mockState: {
  insertError: unknown;
  transactionInsertError: unknown;
} = {
  insertError: null,
  transactionInsertError: null,
};
function createNoopUpdateChain() {
  return {
    set() {
      return {
        where: mock(async () => undefined),
      };
    },
  };
}
function createUniqueConflictError(constraint: string) {
  return {
    code: "23505",
    constraint,
    message: `duplicate key value violates unique constraint "${constraint}"`,
  };
}
mock.module("../../control-plane/service/src/middleware/auth", () => ({
  authMiddleware: async (
    c: { set: (key: string, value: unknown) => void },
    next: () => Promise<void>,
  ) => {
    c.set("user", {
      sub: "user-1",
      role: "project_admin",
      projects: [{ id: "proj-1", role: "project_admin" }],
    });
    await next();
  },
}));
mock.module("../../control-plane/service/src/middleware/rbac", () => ({
  requireProjectRole:
    () => async (_c: unknown, next: () => Promise<void>) => {
      await next();
    },
}));
mock.module("../../control-plane/service/src/modules/audit/routes", () => ({
  recordAuditEvent: mock(async () => undefined),
}));
mock.module("../../control-plane/service/src/db/schema", () => ({
  environments: {
    id: "id",
    projectId: "projectId",
    name: "name",
  },
  projects: {
    id: "id",
  },
  repositories: {
    id: "id",
    projectId: "projectId",
    name: "name",
    remoteUrl: "remoteUrl",
    status: "status",
  },
  repositoryCredentials: {
    id: "id",
    projectId: "projectId",
    repoId: "repoId",
    label: "label",
    provider: "provider",
    credentialType: "credentialType",
    secretRef: "secretRef",
    gitAuthorName: "gitAuthorName",
    gitAuthorEmail: "gitAuthorEmail",
    scope: "scope",
    isDefault: "isDefault",
    status: "status",
    createdAt: "createdAt",
    updatedAt: "updatedAt",
  },
}));
mock.module("../../control-plane/service/src/db", () => ({
  db: {
    query: {
      projects: {
        findFirst: mock(async () => ({ id: "proj-1" })),
      },
      environments: {
        findFirst: mock(async () => null),
        findMany: mock(async () => []),
      },
      repositories: {
        findFirst: mock(async () => null),
      },
      repositoryCredentials: {
        findFirst: mock(async () => null),
      },
    },
    select: mock(() => ({
      from: mock(() => ({
        where: mock(async () => []),
      })),
    })),
    insert: mock(() => ({
      values: mock(async () => {
        if (mockState.insertError) {
          throw mockState.insertError;
        }
        return undefined;
      }),
    })),
    update: mock(() => createNoopUpdateChain()),
    delete: mock(() => ({ where: mock(async () => undefined) })),
    transaction: mock(async (callback: (tx: Record<string, unknown>) => Promise<void>) => {
      const tx = {
        update: mock(() => ({
          set: mock(() => ({
            where: mock(async () => undefined),
          })),
        })),
        insert: mock(() => ({
          values: mock(async () => {
            if (mockState.transactionInsertError) {
              throw mockState.transactionInsertError;
            }
            return undefined;
          }),
        })),
      };

      await callback(tx);
    }),
  },
}));
async function loadEnvRoutesModule() {
  importCounter += 1;
  return import(
    `../../control-plane/service/src/modules/envs/routes.ts?unique-constraint-routes-env-test=${importCounter}`
  );
}
async function loadRepositoryRoutesModule() {
  importCounter += 1;
  return import(
    `../../control-plane/service/src/modules/repositories/routes.ts?unique-constraint-routes-repo-test=${importCounter}`
  );
}
async function loadCredentialRoutesModule() {
  importCounter += 1;
  return import(
    `../../control-plane/service/src/modules/credentials/routes.ts?unique-constraint-routes-credential-test=${importCounter}`
  );
}
afterEach(() => {
  mockState.insertError = null;
  mockState.transactionInsertError = null;
  mock.restore();
});
describe("database unique constraint route translation", () => {
  test("env create returns 409 when insert loses a uniqueness race", async () => {
    mockState.insertError = createUniqueConflictError("idx_environments_project_name");
    const { envRoutes } = await loadEnvRoutesModule();
    const app = new Hono();
    app.route("/api/envs", envRoutes);

    const response = await app.request("http://localhost/api/envs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId: "proj-1",
        name: "production",
        riskLevel: "high",
        requiresApproval: true,
      }),
    });

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: "An environment with this name already exists in the project",
    });
  });

  test("repository create returns 409 when insert loses a repository URL uniqueness race", async () => {
    mockState.insertError = createUniqueConflictError("idx_repositories_project_remote_url");
    const { repositoryRoutes } = await loadRepositoryRoutesModule();
    const app = new Hono();
    app.route("/api/projects/:projectId/repositories", repositoryRoutes);

    const response = await app.request("http://localhost/api/projects/proj-1/repositories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "control-plane",
        provider: "github",
        remoteUrl: "https://github.com/example/control-plane.git",
        defaultBranch: "main",
      }),
    });

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: "A repository with this URL already exists in the project",
    });
  });

  test("credential create returns 409 when default-scope uniqueness is violated concurrently", async () => {
    mockState.transactionInsertError = createUniqueConflictError(
      "idx_repository_credentials_project_default_active",
    );
    const { credentialRoutes } = await loadCredentialRoutesModule();
    const app = new Hono();
    app.route("/api/projects/:projectId/credentials", credentialRoutes);

    const response = await app.request("http://localhost/api/projects/proj-1/credentials", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        label: "default-credential",
        provider: "github",
        credentialType: "pat",
        secretRef: "vault://test/default-credential",
        scope: "project",
        isDefault: true,
      }),
    });

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: "Another active default credential already exists in this scope",
    });
  });
});
