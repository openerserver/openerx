/**
 * Identity Binding — Phase 9 Integration Tests
 *
 * Tests credential CRUD, task identity fields, code-change recording,
 * and audit trail for the Git identity binding feature.
 *
 * Requires: CP service running on TEST_CP_URL (default http://127.0.0.1:4097)
 *           with seed data already applied (admin/admin123!, proj-default).
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const CP_URL = process.env.TEST_CP_URL || "http://127.0.0.1:4097";
const PROJECT_ID = process.env.TEST_PROJECT_ID || "proj-default";
const USERNAME = process.env.TEST_USERNAME || "admin";
const PASSWORD = process.env.TEST_PASSWORD || "admin123!";
const DB_PATH =
  process.env.TEST_DB_PATH || resolve(__dirname, "../../control-plane/service/data/openerx.db");

// ── Helpers ────────────────────────────────────────────────────────

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

async function login(): Promise<string> {
  const { data, status } = await request<{ token: string }>("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: USERNAME, password: PASSWORD }),
  });
  if (status !== 200) throw new Error(`Login failed: ${status} ${JSON.stringify(data)}`);
  return data.token;
}

// ── Cleanup Helpers ────────────────────────────────────────────────

const createdCredentialIds: string[] = [];
const createdTaskIds: string[] = [];
const createdChangeIds: string[] = [];

afterAll(async () => {
  // Clean up test data via sqlite3 to avoid cascading issues
  const ids = [
    ...createdCredentialIds.map((id) => `DELETE FROM repository_credentials WHERE id='${id}';`),
    ...createdChangeIds.map(
      (id) =>
        `DELETE FROM file_changes WHERE change_id='${id}'; DELETE FROM code_changes WHERE id='${id}';`,
    ),
    ...createdTaskIds.map((id) => `DELETE FROM tasks WHERE id='${id}';`),
  ];
  if (ids.length > 0) {
    const { execSync } = await import("node:child_process");
    try {
      execSync(`sqlite3 "${DB_PATH}" "${ids.join(" ")}"`, { timeout: 5000 });
    } catch {
      console.warn("Cleanup via sqlite3 failed — test data may remain in DB");
    }
  }
});

// ── State ──────────────────────────────────────────────────────────

let token = "";

beforeAll(async () => {
  token = await login();
});

// ════════════════════════════════════════════════════════════════════
// 1. Credential CRUD
// ════════════════════════════════════════════════════════════════════

describe("Credential CRUD", () => {
  let credId = "";

  test("POST create credential", async () => {
    const { data, status } = await authedRequest<{ id: string; label: string; status: string }>(
      token,
      `/api/projects/${PROJECT_ID}/credentials`,
      {
        method: "POST",
        body: JSON.stringify({
          label: "test-pat-cred",
          provider: "github",
          credentialType: "pat",
          secretRef: "vault://test/github-pat-ref",
          gitAuthorName: "Test Bot",
          gitAuthorEmail: "bot@test.openerx.dev",
          scope: "project",
          isDefault: true,
        }),
      },
    );

    expect(status).toBe(201);
    expect(data.id).toBeTruthy();
    expect(data.label).toBe("test-pat-cred");
    expect(data.status).toBe("active");
    credId = data.id;
    createdCredentialIds.push(credId);
  });

  test("GET list credentials for project", async () => {
    const { data, status } = await authedRequest<{ data: Array<Record<string, unknown>> }>(
      token,
      `/api/projects/${PROJECT_ID}/credentials`,
    );

    expect(status).toBe(200);
    expect(Array.isArray(data.data)).toBe(true);
    const found = data.data.find((c) => c.id === credId);
    expect(found).toBeTruthy();
    expect(found?.label).toBe("test-pat-cred");
    expect(found?.gitAuthorName).toBe("Test Bot");
    expect(found?.gitAuthorEmail).toBe("bot@test.openerx.dev");
    expect(found?.scope).toBe("project");
    expect(found?.isDefault).toBe(true);
    // secretRef should NOT be in list response fields
    // (list uses explicit select, which excludes secretRef)
  });

  test("GET single credential masks secretRef", async () => {
    const { data, status } = await authedRequest<Record<string, unknown>>(
      token,
      `/api/projects/${PROJECT_ID}/credentials/${credId}`,
    );

    expect(status).toBe(200);
    expect(data.id).toBe(credId);
    expect(data.secretRefMasked).toBe("***");
    // Raw secretRef must NOT appear
    expect(data.secretRef).toBeUndefined();
  });

  test("PATCH update credential label and gitAuthorEmail", async () => {
    const { data, status } = await authedRequest<Record<string, unknown>>(
      token,
      `/api/projects/${PROJECT_ID}/credentials/${credId}`,
      {
        method: "PATCH",
        body: JSON.stringify({
          label: "updated-cred-label",
          gitAuthorEmail: "updated@test.openerx.dev",
        }),
      },
    );

    expect(status).toBe(200);
    expect(data.label).toBe("updated-cred-label");

    // Verify the update persisted
    const { data: updated } = await authedRequest<Record<string, unknown>>(
      token,
      `/api/projects/${PROJECT_ID}/credentials/${credId}`,
    );
    expect(updated.label).toBe("updated-cred-label");
    expect(updated.gitAuthorEmail).toBe("updated@test.openerx.dev");
  });

  test("DELETE (revoke) credential sets status to revoked", async () => {
    const { data, status } = await authedRequest<{ ok: boolean }>(
      token,
      `/api/projects/${PROJECT_ID}/credentials/${credId}`,
      { method: "DELETE" },
    );

    expect(status).toBe(200);
    expect(data.ok).toBe(true);

    // Verify status is now revoked
    const { data: revoked } = await authedRequest<Record<string, unknown>>(
      token,
      `/api/projects/${PROJECT_ID}/credentials/${credId}`,
    );
    expect(revoked.status).toBe("revoked");
  });

  test("GET credential for non-existent returns 404", async () => {
    const { status } = await authedRequest(
      token,
      `/api/projects/${PROJECT_ID}/credentials/non-existent-id`,
    );
    expect(status).toBe(404);
  });

  test("POST credential with invalid project returns 404", async () => {
    const { status } = await authedRequest(
      token,
      "/api/projects/non-existent-project/credentials",
      {
        method: "POST",
        body: JSON.stringify({
          label: "should-fail",
          provider: "github",
          credentialType: "pat",
          secretRef: "vault://fail",
        }),
      },
    );
    // requireProjectRole will reject since the project doesn't exist in user's projects
    expect(status === 403 || status === 404).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════════
// 2. Task Identity Fields
// ════════════════════════════════════════════════════════════════════

describe("Task Identity Fields", () => {
  let activeCred = "";
  let taskId = "";

  beforeAll(async () => {
    // Create an active credential for task tests
    const { data } = await authedRequest<{ id: string }>(
      token,
      `/api/projects/${PROJECT_ID}/credentials`,
      {
        method: "POST",
        body: JSON.stringify({
          label: "task-test-cred",
          provider: "github",
          credentialType: "pat",
          secretRef: "vault://test/task-cred",
          gitAuthorName: "Task Author",
          gitAuthorEmail: "author@test.openerx.dev",
          scope: "project",
          isDefault: false,
        }),
      },
    );
    activeCred = data.id;
    createdCredentialIds.push(activeCred);
  });

  test("POST create task with identity fields", async () => {
    const { data, status } = await authedRequest<{ id: string; status: string }>(
      token,
      "/api/tasks",
      {
        method: "POST",
        body: JSON.stringify({
          title: "Identity Test Task",
          prompt: "Test task for identity binding verification",
          projectId: PROJECT_ID,
          credentialId: activeCred,
          gitAuthorName: "Explicit Author",
          gitAuthorEmail: "explicit@test.openerx.dev",
          gitCommitterName: "CI Bot",
          gitCommitterEmail: "ci@test.openerx.dev",
        }),
      },
    );

    expect(status).toBe(201);
    expect(data.id).toBeTruthy();
    taskId = data.id;
    createdTaskIds.push(taskId);
  });

  test("GET task detail returns identity snapshot", async () => {
    const { data, status } = await authedRequest<Record<string, unknown>>(
      token,
      `/api/tasks/${taskId}`,
    );

    expect(status).toBe(200);
    expect(data.credentialId).toBe(activeCred);
    expect(data.gitAuthorName).toBe("Explicit Author");
    expect(data.gitAuthorEmail).toBe("explicit@test.openerx.dev");
    expect(data.gitCommitterName).toBe("CI Bot");
    expect(data.gitCommitterEmail).toBe("ci@test.openerx.dev");
    expect(data.credentialLabel).toBe("task-test-cred");
  });

  test("PATCH task with post-execution facts", async () => {
    const changesSummary = {
      filesAdded: 3,
      filesModified: 5,
      filesDeleted: 1,
      totalInsertions: 120,
      totalDeletions: 45,
    };

    const { data, status } = await authedRequest<Record<string, unknown>>(
      token,
      `/api/tasks/${taskId}`,
      {
        method: "PATCH",
        body: JSON.stringify({
          status: "completed",
          finalCommitSha: "abc123def456",
          finalBranchName: "feature/identity-test",
          changesSummary,
        }),
      },
    );

    expect(status).toBe(200);
    expect(data.finalCommitSha).toBe("abc123def456");
    expect(data.finalBranchName).toBe("feature/identity-test");
    expect(data.changesSummary).toEqual(changesSummary);
  });

  test("GET task detail includes post-execution facts", async () => {
    const { data, status } = await authedRequest<Record<string, unknown>>(
      token,
      `/api/tasks/${taskId}`,
    );

    expect(status).toBe(200);
    expect(data.finalCommitSha).toBe("abc123def456");
    expect(data.finalBranchName).toBe("feature/identity-test");
    expect(data.finishedAt).toBeTruthy();
    const summary = data.changesSummary as Record<string, number>;
    expect(summary.filesAdded).toBe(3);
    expect(summary.totalInsertions).toBe(120);
  });

  test("POST task rejects invalid credentialId", async () => {
    const { status } = await authedRequest(token, "/api/tasks", {
      method: "POST",
      body: JSON.stringify({
        title: "Bad Cred Task",
        prompt: "Should fail",
        projectId: PROJECT_ID,
        credentialId: "non-existent-cred",
      }),
    });
    expect(status).toBe(400);
  });

  test("POST create task without identity fields (backwards compat)", async () => {
    const { data, status } = await authedRequest<{ id: string }>(token, "/api/tasks", {
      method: "POST",
      body: JSON.stringify({
        title: "Legacy Task No Identity",
        prompt: "Task without identity fields should work",
        projectId: PROJECT_ID,
      }),
    });

    expect(status).toBe(201);
    createdTaskIds.push(data.id);

    // Detail should have null identity fields
    const { data: detail } = await authedRequest<Record<string, unknown>>(
      token,
      `/api/tasks/${data.id}`,
    );
    expect(detail.credentialId).toBeNull();
    expect(detail.gitAuthorName).toBeNull();
    expect(detail.credentialLabel).toBeNull();
  });

  test("GET task list includes credentialLabel", async () => {
    const { data, status } = await authedRequest<{ data: Array<Record<string, unknown>> }>(
      token,
      `/api/tasks?projectId=${PROJECT_ID}`,
    );

    expect(status).toBe(200);
    const found = data.data.find((t) => t.id === taskId);
    expect(found).toBeTruthy();
    expect(found?.credentialLabel).toBe("task-test-cred");
  });
});

// ════════════════════════════════════════════════════════════════════
// 3. Code Changes & File Changes
// ════════════════════════════════════════════════════════════════════

describe("Code Changes Recording", () => {
  let taskId = "";
  let changeId = "";

  beforeAll(async () => {
    // Create a task for code change tests
    const { data } = await authedRequest<{ id: string }>(token, "/api/tasks", {
      method: "POST",
      body: JSON.stringify({
        title: "Code Change Test Task",
        prompt: "Test task for code change recording",
        projectId: PROJECT_ID,
      }),
    });
    taskId = data.id;
    createdTaskIds.push(taskId);
  });

  test("POST create code change with commit facts", async () => {
    const { data, status } = await authedRequest<{ id: string; fileCount: number }>(
      token,
      "/api/code-changes",
      {
        method: "POST",
        body: JSON.stringify({
          taskId,
          changeSource: "runtime_diff",
          commitSha: "deadbeef0123",
          commitAuthorName: "Dev Author",
          commitAuthorEmail: "dev@test.openerx.dev",
          commitMessage: "feat: add identity binding support",
          branchName: "feature/identity",
          summary: "Added identity binding to tasks module",
          files: [
            { filePath: "src/db/schema.ts", changeType: "modified", insertions: 50, deletions: 5 },
            {
              filePath: "src/modules/credentials/routes.ts",
              changeType: "added",
              insertions: 200,
              deletions: 0,
            },
            { filePath: "src/old-file.ts", changeType: "deleted", insertions: 0, deletions: 80 },
          ],
        }),
      },
    );

    expect(status).toBe(201);
    expect(data.id).toBeTruthy();
    expect(data.fileCount).toBe(3);
    changeId = data.id;
    createdChangeIds.push(changeId);
  });

  test("GET list code changes for task", async () => {
    const { data, status } = await authedRequest<{ data: Array<Record<string, unknown>> }>(
      token,
      `/api/tasks/${taskId}/changes`,
    );

    expect(status).toBe(200);
    expect(data.data.length).toBeGreaterThanOrEqual(1);

    const change = data.data.find((c) => c.id === changeId);
    expect(change).toBeTruthy();
    expect(change?.commitSha).toBe("deadbeef0123");
    expect(change?.commitAuthorName).toBe("Dev Author");
    expect(change?.commitAuthorEmail).toBe("dev@test.openerx.dev");
    expect(change?.commitMessage).toBe("feat: add identity binding support");
    expect(change?.branchName).toBe("feature/identity");
    expect(change?.changeSource).toBe("runtime_diff");
  });

  test("GET file changes for a specific change", async () => {
    const { data, status } = await authedRequest<{ data: Array<Record<string, unknown>> }>(
      token,
      `/api/tasks/${taskId}/changes/${changeId}/files`,
    );

    expect(status).toBe(200);
    expect(data.data.length).toBe(3);

    const added = data.data.find((f) => f.changeType === "added");
    expect(added).toBeTruthy();
    expect(added?.filePath).toBe("src/modules/credentials/routes.ts");
    expect(added?.insertions).toBe(200);
    expect(added?.deletions).toBe(0);

    const deleted = data.data.find((f) => f.changeType === "deleted");
    expect(deleted).toBeTruthy();
    expect(deleted?.filePath).toBe("src/old-file.ts");
  });

  test("POST code change without commit (file-only diff)", async () => {
    const { data, status } = await authedRequest<{ id: string; fileCount: number }>(
      token,
      "/api/code-changes",
      {
        method: "POST",
        body: JSON.stringify({
          taskId,
          changeSource: "runtime_diff",
          summary: "Runtime file changes without git commit",
          files: [
            {
              filePath: "src/utils/helpers.ts",
              changeType: "modified",
              insertions: 10,
              deletions: 2,
            },
          ],
        }),
      },
    );

    expect(status).toBe(201);
    expect(data.fileCount).toBe(1);
    createdChangeIds.push(data.id);
  });

  test("GET files returns 404 for non-existent change", async () => {
    const { status } = await authedRequest(
      token,
      `/api/tasks/${taskId}/changes/non-existent/files`,
    );
    expect(status).toBe(404);
  });
});

// ════════════════════════════════════════════════════════════════════
// 4. Audit Trail for Identity Events
// ════════════════════════════════════════════════════════════════════

describe("Audit Trail", () => {
  test("credential.created event exists in audit log", async () => {
    const { data, status } = await authedRequest<{ data: Array<Record<string, unknown>> }>(
      token,
      `/api/audit?projectId=${PROJECT_ID}&limit=50`,
    );

    expect(status).toBe(200);
    const credEvents = data.data.filter(
      (ev: Record<string, unknown>) => ev.eventType === "credential.created",
    );
    expect(credEvents.length).toBeGreaterThanOrEqual(1);
  });

  test("credential.updated event exists", async () => {
    const { data, status } = await authedRequest<{ data: Array<Record<string, unknown>> }>(
      token,
      `/api/audit?projectId=${PROJECT_ID}&limit=50`,
    );

    expect(status).toBe(200);
    const updateEvents = data.data.filter(
      (ev: Record<string, unknown>) => ev.eventType === "credential.updated",
    );
    expect(updateEvents.length).toBeGreaterThanOrEqual(1);
  });

  test("credential.revoked event exists with medium risk", async () => {
    const { data, status } = await authedRequest<{ data: Array<Record<string, unknown>> }>(
      token,
      `/api/audit?projectId=${PROJECT_ID}&limit=50`,
    );

    expect(status).toBe(200);
    const revokeEvents = data.data.filter(
      (ev: Record<string, unknown>) => ev.eventType === "credential.revoked",
    );
    expect(revokeEvents.length).toBeGreaterThanOrEqual(1);
    expect(revokeEvents[0]?.riskLevel).toBe("medium");
  });
});

// ════════════════════════════════════════════════════════════════════
// 5. RBAC — Unauthenticated / Wrong token
// ════════════════════════════════════════════════════════════════════

describe("RBAC Boundaries", () => {
  test("credential API rejects missing token", async () => {
    const { status } = await request(`/api/projects/${PROJECT_ID}/credentials`);
    expect(status).toBe(401);
  });

  test("credential API rejects invalid token", async () => {
    const { status } = await authedRequest(
      "invalid-jwt-token",
      `/api/projects/${PROJECT_ID}/credentials`,
    );
    expect(status).toBe(401);
  });

  test("code-changes API rejects missing token", async () => {
    const { status } = await request("/api/code-changes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        taskId: "fake",
        changeSource: "runtime_diff",
        files: [],
      }),
    });
    expect(status).toBe(401);
  });
});
