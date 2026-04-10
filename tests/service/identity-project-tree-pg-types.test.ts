import { afterAll, expect, test } from "bun:test";
import postgres from "../../control-plane/service/node_modules/postgres";
import { runDeleteByIds } from "./service-teardown-helpers";

const rawDatabaseUrl = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL || "";
const DATABASE_URL = /^(postgres|postgresql):\/\//i.test(rawDatabaseUrl)
  ? rawDatabaseUrl
  : "postgres://127.0.0.1:5432/openerx";
const sql = postgres(DATABASE_URL, { max: 1, prepare: false });

function toPostgresPlaceholders(query: string) {
  let index = 0;
  return query.replace(/\?(\d+)?/g, (_match, explicitIndex) => {
    if (explicitIndex) {
      return `$${Number(explicitIndex)}`;
    }

    index += 1;
    return `$${index}`;
  });
}

async function writeDb(query: string, params: unknown[]) {
  await sql.unsafe(toPostgresPlaceholders(query), params as never[]);
}

async function safeWriteDb(query: string, params: unknown[]) {
  try {
    await writeDb(query, params);
  } catch {
    // Best-effort cleanup only.
  }
}

const createdUserIds: string[] = [];
const createdRepoIds: string[] = [];
const createdCredentialIds: string[] = [];
const createdNodeIds: string[] = [];
const createdBranchIds: string[] = [];
const createdLinkIds: string[] = [];
const createdEventIds: string[] = [];

afterAll(async () => {
  try {
    await runDeleteByIds(safeWriteDb, "task_domain_events", createdEventIds);
    await runDeleteByIds(safeWriteDb, "project_tree_links", createdLinkIds);
    await runDeleteByIds(safeWriteDb, "project_tree_branches", createdBranchIds);
    await runDeleteByIds(safeWriteDb, "project_tree_nodes", createdNodeIds);
    await runDeleteByIds(safeWriteDb, "repository_credentials", createdCredentialIds);
    await runDeleteByIds(safeWriteDb, "repositories", createdRepoIds);
    await runDeleteByIds(safeWriteDb, "users", createdUserIds);
  } finally {
    await sql.end();
  }
});

test("identity, repository, project-tree, and domain-event PG columns accept ISO timestamps", async () => {
  const [project] = await sql.unsafe<Array<{ id: string; name: string }>>(
    "SELECT id, name FROM projects ORDER BY created_at ASC LIMIT 1",
  );
  expect(project?.id).toBeTruthy();

  const [rootNode] = await sql.unsafe<Array<{ id: string; path: string; depth: number }>>(
    `SELECT id, path, depth
     FROM project_tree_nodes
     WHERE project_id = $1 AND node_type = 'project_root'
     ORDER BY created_at ASC
     LIMIT 1`,
    [project?.id],
  );
  expect(rootNode?.id).toBeTruthy();

  const suffix = Date.now().toString(36);
  const createdAt = "2025-04-12T08:00:00.000Z";
  const updatedAt = "2025-04-12T08:05:00.000Z";
  const archivedAt = "2025-04-12T08:10:00.000Z";
  const userId = `user-pg-${suffix}`;
  const repoId = `repo-pg-${suffix}`;
  const credentialId = `credential-pg-${suffix}`;
  const nodeId = `node-pg-${suffix}`;
  const branchId = `branch-pg-${suffix}`;
  const linkId = `link-pg-${suffix}`;
  const eventId = `event-pg-${suffix}`;

  createdUserIds.push(userId);
  createdRepoIds.push(repoId);
  createdCredentialIds.push(credentialId);
  createdNodeIds.push(nodeId);
  createdBranchIds.push(branchId);
  createdLinkIds.push(linkId);
  createdEventIds.push(eventId);

  await writeDb(
    `INSERT INTO users (
      id,
      username,
      password_hash,
      display_name,
      locked_until,
      last_login_at,
      created_at
    ) VALUES (
      ?1,
      ?2,
      ?3,
      ?4,
      ?5,
      ?6,
      ?7
    )`,
    [
      userId,
      `user_pg_${suffix}`,
      "bcrypt:test-hash",
      "PG Type Test User",
      archivedAt,
      updatedAt,
      createdAt,
    ],
  );

  await writeDb(
    `INSERT INTO repositories (
      id,
      project_id,
      name,
      provider,
      remote_url,
      default_branch,
      description,
      status,
      created_at,
      updated_at
    ) VALUES (
      ?1,
      ?2,
      ?3,
      ?4,
      ?5,
      ?6,
      ?7,
      ?8,
      ?9,
      ?10
    )`,
    [
      repoId,
      project?.id,
      `repo-${suffix}`,
      "github",
      `https://github.com/example/repo-${suffix}.git`,
      "main",
      "pg type smoke",
      "active",
      createdAt,
      updatedAt,
    ],
  );

  await writeDb(
    `INSERT INTO repository_credentials (
      id,
      project_id,
      repo_id,
      label,
      provider,
      credential_type,
      secret_ref,
      git_author_name,
      git_author_email,
      scope,
      is_default,
      status,
      created_at,
      updated_at
    ) VALUES (
      ?1,
      ?2,
      ?3,
      ?4,
      ?5,
      ?6,
      ?7,
      ?8,
      ?9,
      ?10,
      ?11,
      ?12,
      ?13,
      ?14
    )`,
    [
      credentialId,
      project?.id,
      repoId,
      `credential-${suffix}`,
      "github",
      "pat",
      `vault://pg/${suffix}`,
      "PG Bot",
      "pg-bot@example.com",
      "project",
      false,
      "active",
      createdAt,
      updatedAt,
    ],
  );

  await writeDb(
    `INSERT INTO project_tree_nodes (
      id,
      project_id,
      parent_id,
      path,
      depth,
      node_type,
      content_text,
      is_active,
      created_at,
      updated_at,
      archived_at
    ) VALUES (
      ?1,
      ?2,
      ?3,
      ?4,
      ?5,
      ?6,
      ?7,
      ?8,
      ?9,
      ?10,
      ?11
    )`,
    [
      nodeId,
      project?.id,
      rootNode?.id,
      `${rootNode?.path}.context_pg_${suffix}`,
      (rootNode?.depth ?? 0) + 1,
      "context",
      "pg type context",
      false,
      createdAt,
      updatedAt,
      archivedAt,
    ],
  );

  await writeDb(
    `INSERT INTO project_tree_branches (
      id,
      project_id,
      task_node_id,
      branch_name,
      head_node_id,
      is_default,
      created_at,
      updated_at
    ) VALUES (
      ?1,
      ?2,
      NULL,
      ?3,
      ?4,
      ?5,
      ?6,
      ?7
    )`,
    [branchId, project?.id, `pg-branch-${suffix}`, nodeId, false, createdAt, updatedAt],
  );

  await writeDb(
    `INSERT INTO project_tree_links (
      id,
      source_node_id,
      source_project_id,
      target_node_id,
      target_project_id,
      link_type,
      metadata,
      bidirectional,
      created_by,
      created_at
    ) VALUES (
      ?1,
      ?2,
      ?3,
      ?4,
      ?5,
      ?6,
      ?7::jsonb,
      ?8,
      ?9,
      ?10
    )`,
    [
      linkId,
      rootNode?.id,
      project?.id,
      nodeId,
      project?.id,
      "related",
      JSON.stringify({ source: "pg-smoke" }),
      false,
      userId,
      createdAt,
    ],
  );

  await writeDb(
    `INSERT INTO task_domain_events (
      id,
      project_id,
      task_id,
      session_id,
      run_id,
      run_node_id,
      event_type,
      payload_json,
      created_at,
      seq
    ) VALUES (
      ?1,
      ?2,
      NULL,
      NULL,
      NULL,
      NULL,
      ?3,
      ?4::jsonb,
      ?5,
      ?6
    )`,
    [eventId, project?.id, "pg.smoke", JSON.stringify({ source: "pg-smoke" }), createdAt, 0],
  );

  const [userRow] = await sql.unsafe<
    Array<{
      lockedUntilType: string;
      lastLoginAtType: string;
      createdAtType: string;
      lockedUntilText: string;
    }>
  >(
    `SELECT
      pg_typeof(locked_until)::text AS "lockedUntilType",
      pg_typeof(last_login_at)::text AS "lastLoginAtType",
      pg_typeof(created_at)::text AS "createdAtType",
      (locked_until AT TIME ZONE 'UTC')::text AS "lockedUntilText"
    FROM users
    WHERE id = $1`,
    [userId],
  );
  expect(userRow).toMatchObject({
    lockedUntilType: "timestamp with time zone",
    lastLoginAtType: "timestamp with time zone",
    createdAtType: "timestamp with time zone",
  });
  expect(userRow.lockedUntilText).toContain("2025-04-12 08:10:00");

  const [repoRow] = await sql.unsafe<
    Array<{
      createdAtType: string;
      updatedAtType: string;
      updatedAtText: string;
    }>
  >(
    `SELECT
      pg_typeof(created_at)::text AS "createdAtType",
      pg_typeof(updated_at)::text AS "updatedAtType",
      (updated_at AT TIME ZONE 'UTC')::text AS "updatedAtText"
    FROM repositories
    WHERE id = $1`,
    [repoId],
  );
  expect(repoRow).toMatchObject({
    createdAtType: "timestamp with time zone",
    updatedAtType: "timestamp with time zone",
  });
  expect(repoRow.updatedAtText).toContain("2025-04-12 08:05:00");

  const [credentialRow] = await sql.unsafe<
    Array<{
      createdAtType: string;
      updatedAtType: string;
    }>
  >(
    `SELECT
      pg_typeof(created_at)::text AS "createdAtType",
      pg_typeof(updated_at)::text AS "updatedAtType"
    FROM repository_credentials
    WHERE id = $1`,
    [credentialId],
  );
  expect(credentialRow).toMatchObject({
    createdAtType: "timestamp with time zone",
    updatedAtType: "timestamp with time zone",
  });

  const [nodeRow] = await sql.unsafe<
    Array<{
      createdAtType: string;
      updatedAtType: string;
      archivedAtType: string;
      archivedAtText: string;
    }>
  >(
    `SELECT
      pg_typeof(created_at)::text AS "createdAtType",
      pg_typeof(updated_at)::text AS "updatedAtType",
      pg_typeof(archived_at)::text AS "archivedAtType",
      (archived_at AT TIME ZONE 'UTC')::text AS "archivedAtText"
    FROM project_tree_nodes
    WHERE id = $1`,
    [nodeId],
  );
  expect(nodeRow).toMatchObject({
    createdAtType: "timestamp with time zone",
    updatedAtType: "timestamp with time zone",
    archivedAtType: "timestamp with time zone",
  });
  expect(nodeRow.archivedAtText).toContain("2025-04-12 08:10:00");

  const [branchRow] = await sql.unsafe<
    Array<{
      createdAtType: string;
      updatedAtType: string;
    }>
  >(
    `SELECT
      pg_typeof(created_at)::text AS "createdAtType",
      pg_typeof(updated_at)::text AS "updatedAtType"
    FROM project_tree_branches
    WHERE id = $1`,
    [branchId],
  );
  expect(branchRow).toMatchObject({
    createdAtType: "timestamp with time zone",
    updatedAtType: "timestamp with time zone",
  });

  const [linkRow] = await sql.unsafe<Array<{ createdAtType: string }>>(
    `SELECT pg_typeof(created_at)::text AS "createdAtType"
     FROM project_tree_links
     WHERE id = $1`,
    [linkId],
  );
  expect(linkRow).toMatchObject({
    createdAtType: "timestamp with time zone",
  });

  const [eventRow] = await sql.unsafe<
    Array<{
      createdAtType: string;
      createdAtText: string;
    }>
  >(
    `SELECT
      pg_typeof(created_at)::text AS "createdAtType",
      (created_at AT TIME ZONE 'UTC')::text AS "createdAtText"
    FROM task_domain_events
    WHERE id = $1`,
    [eventId],
  );
  expect(eventRow).toMatchObject({
    createdAtType: "timestamp with time zone",
  });
  expect(eventRow.createdAtText).toContain("2025-04-12 08:00:00");

  const taskColumns = await sql.unsafe<Array<{ columnName: string; dataType: string }>>(
    `SELECT
      column_name AS "columnName",
      data_type AS "dataType"
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'tasks'
      AND column_name IN ('created_at', 'updated_at')
    ORDER BY column_name ASC`,
  );
  expect(taskColumns).toEqual([
    { columnName: "created_at", dataType: "timestamp with time zone" },
    { columnName: "updated_at", dataType: "timestamp with time zone" },
  ]);
});