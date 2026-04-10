import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const CP_URL = process.env.TEST_CP_URL || "http://127.0.0.1:4097";
const USERNAME = process.env.TEST_USERNAME || "admin";
const PASSWORD = process.env.TEST_PASSWORD || "admin123!";
const DB_PATH =
  process.env.TEST_DB_PATH || resolve(__dirname, "../../control-plane/service/data/openerx.db");

interface LoginResult {
  token: string;
  user: {
    id: string;
    username: string;
    displayName: string;
    role: string;
    accountStatus: "active" | "disabled";
    mustChangePassword: boolean;
  };
}

interface CreatedUser {
  id: string;
  username: string;
}

const createdUsers: CreatedUser[] = [];

async function request<T>(
  path: string,
  opts: RequestInit = {},
): Promise<{ data: T; status: number }> {
  const res = await fetch(`${CP_URL}${path}`, opts);
  const text = await res.text();
  let data: unknown;
  try {
    data = text ? JSON.parse(text) : undefined;
  } catch {
    data = text;
  }
  return { data: data as T, status: res.status };
}

async function authedRequest<T>(
  token: string,
  path: string,
  opts: RequestInit = {},
): Promise<{ data: T; status: number }> {
  return request<T>(path, {
    ...opts,
    headers: {
      ...(opts.headers as Record<string, string>),
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });
}

async function login(username = USERNAME, password = PASSWORD) {
  const { data, status } = await request<LoginResult>("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });

  if (status !== 200) {
    throw new Error(`Login failed: ${status} ${JSON.stringify(data)}`);
  }

  return data;
}

let adminToken = "";
let adminUserId = "";

beforeAll(async () => {
  const admin = await login();
  adminToken = admin.token;
  adminUserId = admin.user.id;
});

afterAll(async () => {
  if (createdUsers.length === 0) {
    return;
  }

  const { execSync } = await import("node:child_process");
  const statements = createdUsers.flatMap((user) => [
    `DELETE FROM audit_events WHERE target='${user.username}' OR user_id='${user.id}';`,
    `DELETE FROM project_roles WHERE user_id='${user.id}';`,
    `DELETE FROM users WHERE id='${user.id}';`,
  ]);

  try {
    execSync(`sqlite3 "${DB_PATH}" "${statements.join(" ")}"`, { timeout: 5000 });
  } catch {
    console.warn("Cleanup failed for user-management.test.ts");
  }
});

describe("Admin user management (service)", () => {
  test("unauthenticated requests receive 401 across user management endpoints", async () => {
    const listUsers = await request<{ error: string }>("/api/users");
    expect(listUsers.status).toBe(401);
    expect(listUsers.data.error).toBe("Missing or invalid authorization header");

    const createUserResult = await request<{ error: string }>("/api/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: `svc_unauth_${Date.now()}`,
        password: "Blocked123!",
        displayName: "Unauthenticated Create",
        role: "viewer",
      }),
    });
    expect(createUserResult.status).toBe(401);
    expect(createUserResult.data.error).toBe("Missing or invalid authorization header");

    const patchUserResult = await request<{ error: string }>("/api/users/fake-user-id", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ displayName: "Blocked Patch" }),
    });
    expect(patchUserResult.status).toBe(401);
    expect(patchUserResult.data.error).toBe("Missing or invalid authorization header");

    const roleResult = await request<{ error: string }>("/api/users/fake-user-id/role", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: "developer" }),
    });
    expect(roleResult.status).toBe(401);
    expect(roleResult.data.error).toBe("Missing or invalid authorization header");

    const statusResult = await request<{ error: string }>("/api/users/fake-user-id/status", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "disabled" }),
    });
    expect(statusResult.status).toBe(401);
    expect(statusResult.data.error).toBe("Missing or invalid authorization header");
  });

  test("POST /api/users creates a user with mustChangePassword", async () => {
    const username = `svc_user_${Date.now()}`;
    const { data, status } = await authedRequest<{
      id: string;
      username: string;
      displayName: string;
      email: string | null;
      role: string;
      accountStatus: "active" | "disabled";
      mustChangePassword: boolean;
    }>(adminToken, "/api/users", {
      method: "POST",
      body: JSON.stringify({
        username,
        password: "Test1234!",
        displayName: "Service Test User",
        email: "svc-user@example.com",
        role: "developer",
        mustChangePassword: true,
      }),
    });

    expect(status).toBe(201);
    expect(data.username).toBe(username);
    expect(data.accountStatus).toBe("active");
    expect(data.mustChangePassword).toBe(true);
    createdUsers.push({ id: data.id, username });

    const { data: users, status: listStatus } = await authedRequest<Array<Record<string, unknown>>>(
      adminToken,
      "/api/users",
    );
    expect(listStatus).toBe(200);
    const created = users.find((user) => user.id === data.id);
    expect(created).toBeTruthy();
    expect(created?.mustChangePassword).toBe(true);
    expect(created?.createdAt).toEqual(expect.stringMatching(/Z$/));
  });

  test("PUT /api/users/:userId/role changes another user's role", async () => {
    const username = `svc_role_${Date.now()}`;
    const { data: created, status: createStatus } = await authedRequest<{ id: string }>(
      adminToken,
      "/api/users",
      {
        method: "POST",
        body: JSON.stringify({
          username,
          password: "Role1234!",
          displayName: "Role Change User",
          role: "developer",
        }),
      },
    );

    expect(createStatus).toBe(201);
    createdUsers.push({ id: created.id, username });

    const { data, status } = await authedRequest<{ id: string; role: string }>(
      adminToken,
      `/api/users/${created.id}/role`,
      {
        method: "PUT",
        body: JSON.stringify({ role: "project_admin" }),
      },
    );

    expect(status).toBe(200);
    expect(data.id).toBe(created.id);
    expect(data.role).toBe("project_admin");

    const { data: users, status: listStatus } = await authedRequest<Array<Record<string, unknown>>>(
      adminToken,
      "/api/users",
    );
    expect(listStatus).toBe(200);
    const updated = users.find((user) => user.id === created.id);
    expect(updated?.role).toBe("project_admin");
  });

  test("PUT /api/users/:userId/status disables a user and blocks login/refresh", async () => {
    const username = `svc_disable_${Date.now()}`;
    const password = "Disable1234!";
    const { data: created, status: createStatus } = await authedRequest<{ id: string }>(
      adminToken,
      "/api/users",
      {
        method: "POST",
        body: JSON.stringify({
          username,
          password,
          displayName: "Disable User",
          role: "developer",
        }),
      },
    );

    expect(createStatus).toBe(201);
    createdUsers.push({ id: created.id, username });

    const createdLogin = await login(username, password);

    const { data, status } = await authedRequest<{ id: string; accountStatus: string }>(
      adminToken,
      `/api/users/${created.id}/status`,
      {
        method: "PUT",
        body: JSON.stringify({ status: "disabled" }),
      },
    );

    expect(status).toBe(200);
    expect(data.accountStatus).toBe("disabled");

    const disabledLogin = await request<{ error: string }>("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    expect(disabledLogin.status).toBe(403);
    expect(disabledLogin.data.error).toBe("Account is disabled");

    const refresh = await authedRequest<{ error: string }>(
      createdLogin.token,
      "/api/auth/refresh",
      { method: "POST" },
    );
    expect(refresh.status).toBe(401);
    expect(refresh.data.error).toBe("Account is disabled or unavailable");
  });

  test("self-protection blocks self role change and self disable", async () => {
    const selfRole = await authedRequest<{ error: string }>(
      adminToken,
      `/api/users/${adminUserId}/role`,
      {
        method: "PUT",
        body: JSON.stringify({ role: "developer" }),
      },
    );
    expect(selfRole.status).toBe(400);
    expect(selfRole.data.error).toBe("You cannot change your own role");

    const selfStatus = await authedRequest<{ error: string }>(
      adminToken,
      `/api/users/${adminUserId}/status`,
      {
        method: "PUT",
        body: JSON.stringify({ status: "disabled" }),
      },
    );
    expect(selfStatus.status).toBe(400);
    expect(selfStatus.data.error).toBe("You cannot change your own account status");
  });

  test("org admins cannot create or manage platform admin accounts", async () => {
    const orgAdminUsername = `svc_org_admin_${Date.now()}`;
    const orgAdminPassword = "OrgAdmin123!";
    const { data: orgAdmin, status: createOrgAdminStatus } = await authedRequest<{ id: string }>(
      adminToken,
      "/api/users",
      {
        method: "POST",
        body: JSON.stringify({
          username: orgAdminUsername,
          password: orgAdminPassword,
          displayName: "Service Org Admin",
          role: "org_admin",
        }),
      },
    );

    expect(createOrgAdminStatus).toBe(201);
    createdUsers.push({ id: orgAdmin.id, username: orgAdminUsername });

    const orgAdminLogin = await login(orgAdminUsername, orgAdminPassword);

    const blockedCreate = await authedRequest<{ error: string }>(
      orgAdminLogin.token,
      "/api/users",
      {
        method: "POST",
        body: JSON.stringify({
          username: `svc_blocked_platform_${Date.now()}`,
          password: "Blocked123!",
          displayName: "Blocked Platform Admin",
          role: "platform_admin",
        }),
      },
    );

    expect(blockedCreate.status).toBe(403);
    expect(blockedCreate.data.error).toBe(
      "Only platform admins can create platform admin accounts",
    );

    const platformAdminUsername = `svc_platform_admin_${Date.now()}`;
    const { data: platformAdmin, status: createPlatformAdminStatus } = await authedRequest<{
      id: string;
    }>(adminToken, "/api/users", {
      method: "POST",
      body: JSON.stringify({
        username: platformAdminUsername,
        password: "Platform123!",
        displayName: "Platform Admin User",
        role: "platform_admin",
      }),
    });

    expect(createPlatformAdminStatus).toBe(201);
    createdUsers.push({ id: platformAdmin.id, username: platformAdminUsername });

    const blockedPatch = await authedRequest<{ error: string }>(
      orgAdminLogin.token,
      `/api/users/${platformAdmin.id}`,
      {
        method: "PATCH",
        body: JSON.stringify({
          displayName: "Tampered Platform Admin",
          password: "Tampered123!",
        }),
      },
    );

    expect(blockedPatch.status).toBe(403);
    expect(blockedPatch.data.error).toBe("Only platform admins can manage platform admin accounts");

    const blockedStatus = await authedRequest<{ error: string }>(
      orgAdminLogin.token,
      `/api/users/${platformAdmin.id}/status`,
      {
        method: "PUT",
        body: JSON.stringify({ status: "disabled" }),
      },
    );

    expect(blockedStatus.status).toBe(403);
    expect(blockedStatus.data.error).toBe(
      "Only platform admins can manage platform admin accounts",
    );
  });

  test("non-admin users receive 403 across user management endpoints", async () => {
    const actorUsername = `svc_dev_actor_${Date.now()}`;
    const actorPassword = "DevActor123!";
    const { data: actor, status: actorStatus } = await authedRequest<{ id: string }>(
      adminToken,
      "/api/users",
      {
        method: "POST",
        body: JSON.stringify({
          username: actorUsername,
          password: actorPassword,
          displayName: "Service Developer Actor",
          role: "developer",
        }),
      },
    );
    expect(actorStatus).toBe(201);
    createdUsers.push({ id: actor.id, username: actorUsername });

    const targetUsername = `svc_dev_target_${Date.now()}`;
    const { data: target, status: targetStatus } = await authedRequest<{ id: string }>(
      adminToken,
      "/api/users",
      {
        method: "POST",
        body: JSON.stringify({
          username: targetUsername,
          password: "DevTarget123!",
          displayName: "Service Developer Target",
          role: "viewer",
        }),
      },
    );
    expect(targetStatus).toBe(201);
    createdUsers.push({ id: target.id, username: targetUsername });

    const actorLogin = await login(actorUsername, actorPassword);

    const listUsers = await authedRequest<{ error: string; required: string; current: string }>(
      actorLogin.token,
      "/api/users",
    );
    expect(listUsers.status).toBe(403);
    expect(listUsers.data.error).toBe("Insufficient permissions");
    expect(listUsers.data.required).toBe("org_admin");
    expect(listUsers.data.current).toBe("developer");

    const createUserResult = await authedRequest<{
      error: string;
      required: string;
      current: string;
    }>(actorLogin.token, "/api/users", {
      method: "POST",
      body: JSON.stringify({
        username: `svc_blocked_dev_create_${Date.now()}`,
        password: "Blocked123!",
        displayName: "Blocked Create",
        role: "viewer",
      }),
    });
    expect(createUserResult.status).toBe(403);
    expect(createUserResult.data.error).toBe("Insufficient permissions");
    expect(createUserResult.data.required).toBe("org_admin");
    expect(createUserResult.data.current).toBe("developer");

    const patchUserResult = await authedRequest<{
      error: string;
      required: string;
      current: string;
    }>(actorLogin.token, `/api/users/${target.id}`, {
      method: "PATCH",
      body: JSON.stringify({ displayName: "Blocked Patch" }),
    });
    expect(patchUserResult.status).toBe(403);
    expect(patchUserResult.data.error).toBe("Insufficient permissions");
    expect(patchUserResult.data.required).toBe("org_admin");
    expect(patchUserResult.data.current).toBe("developer");

    const roleResult = await authedRequest<{ error: string; required: string; current: string }>(
      actorLogin.token,
      `/api/users/${target.id}/role`,
      {
        method: "PUT",
        body: JSON.stringify({ role: "developer" }),
      },
    );
    expect(roleResult.status).toBe(403);
    expect(roleResult.data.error).toBe("Insufficient permissions");
    expect(roleResult.data.required).toBe("platform_admin");
    expect(roleResult.data.current).toBe("developer");

    const statusResult = await authedRequest<{ error: string; required: string; current: string }>(
      actorLogin.token,
      `/api/users/${target.id}/status`,
      {
        method: "PUT",
        body: JSON.stringify({ status: "disabled" }),
      },
    );
    expect(statusResult.status).toBe(403);
    expect(statusResult.data.error).toBe("Insufficient permissions");
    expect(statusResult.data.required).toBe("org_admin");
    expect(statusResult.data.current).toBe("developer");
  });

  test("org admins receive 403 for all role management attempts", async () => {
    const orgAdminUsername = `svc_role_org_${Date.now()}`;
    const orgAdminPassword = "RoleOrg123!";
    const { data: orgAdmin, status: orgAdminStatus } = await authedRequest<{ id: string }>(
      adminToken,
      "/api/users",
      {
        method: "POST",
        body: JSON.stringify({
          username: orgAdminUsername,
          password: orgAdminPassword,
          displayName: "Role Matrix Org Admin",
          role: "org_admin",
        }),
      },
    );
    expect(orgAdminStatus).toBe(201);
    createdUsers.push({ id: orgAdmin.id, username: orgAdminUsername });

    const targetUsername = `svc_role_target_${Date.now()}`;
    const { data: target, status: targetStatus } = await authedRequest<{ id: string }>(
      adminToken,
      "/api/users",
      {
        method: "POST",
        body: JSON.stringify({
          username: targetUsername,
          password: "RoleTarget123!",
          displayName: "Role Matrix Target",
          role: "developer",
        }),
      },
    );
    expect(targetStatus).toBe(201);
    createdUsers.push({ id: target.id, username: targetUsername });

    const orgAdminLogin = await login(orgAdminUsername, orgAdminPassword);

    const demoteOther = await authedRequest<{ error: string; required: string; current: string }>(
      orgAdminLogin.token,
      `/api/users/${target.id}/role`,
      {
        method: "PUT",
        body: JSON.stringify({ role: "viewer" }),
      },
    );
    expect(demoteOther.status).toBe(403);
    expect(demoteOther.data.error).toBe("Insufficient permissions");
    expect(demoteOther.data.required).toBe("platform_admin");
    expect(demoteOther.data.current).toBe("org_admin");

    const selfRoleAttempt = await authedRequest<{
      error: string;
      required: string;
      current: string;
    }>(orgAdminLogin.token, `/api/users/${orgAdmin.id}/role`, {
      method: "PUT",
      body: JSON.stringify({ role: "developer" }),
    });
    expect(selfRoleAttempt.status).toBe(403);
    expect(selfRoleAttempt.data.error).toBe("Insufficient permissions");
    expect(selfRoleAttempt.data.required).toBe("platform_admin");
    expect(selfRoleAttempt.data.current).toBe("org_admin");
  });
});
