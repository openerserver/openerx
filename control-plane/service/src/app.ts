import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { postgresSql } from "./db";
import { approvalRoutes } from "./modules/approvals/routes";
import { auditRoutes } from "./modules/audit/routes";
import { authRoutes } from "./modules/auth/routes";
import { codeChangeRoutes } from "./modules/code-changes/routes";
import { costRoutes } from "./modules/cost/routes";
import { credentialRoutes } from "./modules/credentials/routes";
import { dashboardRoutes } from "./modules/dashboard/routes";
import { developerChangeRequestRoutes } from "./modules/developer-change-requests/routes";
import { envRoutes } from "./modules/envs/routes";
import { governanceRoutes } from "./modules/governance/routes";
import { orgRoutes } from "./modules/orgs/routes";
import { pluginRoutes } from "./modules/plugins/routes";
import { policyRoutes } from "./modules/policies/routes";
import { projectTreeRoutes } from "./modules/project-tree/routes";
import { projectRoutes } from "./modules/projects/routes";
import { repositoryRoutes } from "./modules/repositories/routes";
import { roleAgentRoutes } from "./modules/role-agents/routes";
import { roleConclusionRoutes } from "./modules/role-conclusions/routes";
import { taskOperatingRuntimeRoutes } from "./modules/task-operating-runtime/routes";
import { taskWorkflowRoutes } from "./modules/task-workflows/routes";
import { agentRunRoutes } from "./modules/tasks/agent-run-summary-routes";
import { taskRoutes } from "./modules/tasks/routes";
import { userRoutes } from "./modules/users/routes";
import { workbenchRoutes } from "./modules/workbench/routes";
import { workflowTemplateRoutes } from "./modules/workflow-templates/routes";

type ReadinessActivityRow = {
  pid: number;
  state: string | null;
  waitEventType: string | null;
  waitEvent: string | null;
  queryPreview: string | null;
  blockerPids?: unknown;
};

type ReadinessActivitySummary = {
  pid: number;
  state: string | null;
  waitEventType: string | null;
  waitEvent: string | null;
  queryPreview: string;
};

type ReadinessBlockingChain = ReadinessActivitySummary & {
  blockers: ReadinessBlockingChain[];
};

type ReadinessLockHolderRow = {
  pid: number;
  lockMode: string;
  state: string | null;
  waitEventType: string | null;
  waitEvent: string | null;
  queryPreview: string | null;
};

type ReadinessLockWaitRow = {
  pid: number;
  lockTarget: string | null;
  mode: string;
};

type ReadinessSqlExecutor = Pick<typeof postgresSql, "unsafe">;

function normalizePidArray(value: unknown) {
  if (Array.isArray(value)) {
    return value
      .map((item) => Number(item))
      .filter((item) => Number.isInteger(item) && item > 0);
  }

  if (typeof value === "string") {
    return value
      .replace(/[{}]/g, "")
      .split(",")
      .map((item) => Number(item.trim()))
      .filter((item) => Number.isInteger(item) && item > 0);
  }

  return [];
}

function normalizeQueryPreview(queryPreview: string | null) {
  const normalized = queryPreview?.trim();
  return normalized && normalized.length > 0 ? normalized : "<empty query>";
}

function summarizeReadinessActivity(
  row: Pick<ReadinessActivityRow, "pid" | "state" | "waitEventType" | "waitEvent" | "queryPreview">,
): ReadinessActivitySummary {
  return {
    pid: row.pid,
    state: row.state,
    waitEventType: row.waitEventType,
    waitEvent: row.waitEvent,
    queryPreview: normalizeQueryPreview(row.queryPreview),
  };
}

async function loadReadinessActivityRows(transaction: ReadinessSqlExecutor, pids: number[]) {
  if (pids.length === 0) {
    return [] as ReadinessActivityRow[];
  }

  return transaction.unsafe<ReadinessActivityRow[]>(
    `
      SELECT
        activity.pid,
        activity.state,
        activity.wait_event_type AS "waitEventType",
        activity.wait_event AS "waitEvent",
        left(regexp_replace(activity.query, '[[:space:]]+', ' ', 'g'), 160) AS "queryPreview",
        pg_blocking_pids(activity.pid) AS "blockerPids"
      FROM pg_stat_activity activity
      WHERE activity.pid = ANY($1::int[])
      ORDER BY activity.query_start ASC NULLS LAST
    `,
    [pids],
  );
}

async function loadReadinessBlockingGraph(
  transaction: ReadinessSqlExecutor,
  seedPids: number[],
  maxDepth = 4,
) {
  const rowsByPid = new Map<number, ReadinessActivityRow>();
  const blockersByPid = new Map<number, number[]>();
  let frontier = Array.from(new Set(seedPids.filter((pid) => Number.isInteger(pid) && pid > 0)));
  let depth = 0;

  while (frontier.length > 0 && depth < maxDepth) {
    const rows = await loadReadinessActivityRows(transaction, frontier);
    const nextFrontier = new Set<number>();

    for (const row of rows) {
      rowsByPid.set(row.pid, row);
      const blockerPids = normalizePidArray(row.blockerPids);
      blockersByPid.set(row.pid, blockerPids);
      for (const blockerPid of blockerPids) {
        if (!rowsByPid.has(blockerPid)) {
          nextFrontier.add(blockerPid);
        }
      }
    }

    frontier = Array.from(nextFrontier);
    depth += 1;
  }

  return { rowsByPid, blockersByPid, maxDepth };
}

function buildReadinessBlockingChain(args: {
  pid: number;
  rowsByPid: Map<number, ReadinessActivityRow>;
  blockersByPid: Map<number, number[]>;
  visited?: Set<number>;
}): ReadinessBlockingChain | null {
  const row = args.rowsByPid.get(args.pid);
  if (!row) {
    return null;
  }

  const visited = args.visited ?? new Set<number>();
  if (visited.has(args.pid)) {
    return {
      ...summarizeReadinessActivity(row),
      blockers: [],
    };
  }

  const nextVisited = new Set(visited);
  nextVisited.add(args.pid);

  const blockers = (args.blockersByPid.get(args.pid) ?? [])
    .map((blockerPid) =>
      buildReadinessBlockingChain({
        pid: blockerPid,
        rowsByPid: args.rowsByPid,
        blockersByPid: args.blockersByPid,
        visited: nextVisited,
      }),
    )
    .filter((chain): chain is ReadinessBlockingChain => Boolean(chain));

  return {
    ...summarizeReadinessActivity(row),
    blockers,
  };
}

async function runReadinessProbe() {
  await postgresSql.begin(async (transaction) => {
    await transaction.unsafe("SET LOCAL statement_timeout = '2000ms'");
    await transaction.unsafe('SELECT id FROM users ORDER BY id LIMIT 1');
  });
}

async function loadReadinessDiagnostics() {
  return postgresSql.begin(async (transaction) => {
    await transaction.unsafe("SET LOCAL statement_timeout = '1000ms'");

    const lockHolderRows = await transaction.unsafe<ReadinessLockHolderRow[]>(`
      SELECT
        activity.pid,
        lock.mode AS "lockMode",
        activity.state,
        activity.wait_event_type AS "waitEventType",
        activity.wait_event AS "waitEvent",
        left(regexp_replace(activity.query, '[[:space:]]+', ' ', 'g'), 160) AS "queryPreview"
      FROM pg_locks lock
      INNER JOIN pg_stat_activity activity ON activity.pid = lock.pid
      INNER JOIN pg_class relation ON relation.oid = lock.relation
      WHERE activity.datname = current_database()
        AND activity.pid <> pg_backend_pid()
        AND relation.relname = 'users'
        AND lock.granted
        AND lock.mode <> 'AccessShareLock'
      ORDER BY activity.query_start ASC NULLS LAST
      LIMIT 5
    `);

    const blockedRows = await transaction.unsafe<ReadinessActivityRow[]>(`
      SELECT
        activity.pid,
        activity.state,
        activity.wait_event_type AS "waitEventType",
        activity.wait_event AS "waitEvent",
        left(regexp_replace(activity.query, '[[:space:]]+', ' ', 'g'), 160) AS "queryPreview",
        pg_blocking_pids(activity.pid) AS "blockerPids"
      FROM pg_stat_activity activity
      WHERE activity.datname = current_database()
        AND activity.pid <> pg_backend_pid()
        AND (
          cardinality(pg_blocking_pids(activity.pid)) > 0
          OR activity.wait_event_type = 'Lock'
        )
      ORDER BY activity.query_start ASC NULLS LAST
      LIMIT 5
    `);

    const blockedPids = blockedRows.map((row) => row.pid);
    const blockerPids = Array.from(
      new Set(blockedRows.flatMap((row) => normalizePidArray(row.blockerPids))),
    );
    const graphSeedPids = Array.from(
      new Set([...blockedPids, ...blockerPids, ...lockHolderRows.map((row) => row.pid)]),
    );

    const waitingLockRows =
      blockedPids.length > 0
        ? await transaction.unsafe<ReadinessLockWaitRow[]>(
            `
              SELECT
                lock.pid,
                COALESCE(relation.relname, lock.locktype) AS "lockTarget",
                lock.mode
              FROM pg_locks lock
              LEFT JOIN pg_class relation ON relation.oid = lock.relation
              WHERE lock.pid = ANY($1::int[])
                AND NOT lock.granted
              ORDER BY lock.pid, "lockTarget", lock.mode
            `,
            [blockedPids],
          )
        : [];

    const { rowsByPid, blockersByPid, maxDepth } = await loadReadinessBlockingGraph(
      transaction,
      graphSeedPids,
    );

    const activeRows =
      lockHolderRows.length === 0 && blockedRows.length === 0
        ? await transaction.unsafe<ReadinessActivityRow[]>(`
            SELECT
              activity.pid,
              activity.state,
              activity.wait_event_type AS "waitEventType",
              activity.wait_event AS "waitEvent",
              left(regexp_replace(activity.query, '[[:space:]]+', ' ', 'g'), 160) AS "queryPreview"
            FROM pg_stat_activity activity
            WHERE activity.datname = current_database()
              AND activity.pid <> pg_backend_pid()
              AND activity.state <> 'idle'
            ORDER BY activity.query_start ASC NULLS LAST
            LIMIT 5
          `)
        : [];

    const blockerByPid = new Map(rowsByPid);
    const waitingLocksByPid = new Map<number, string[]>();
    for (const row of waitingLockRows) {
      const entries = waitingLocksByPid.get(row.pid) ?? [];
      const lockSummary = [row.lockTarget ?? "unknown", row.mode].join(":");
      if (!entries.includes(lockSummary)) {
        entries.push(lockSummary);
      }
      waitingLocksByPid.set(row.pid, entries);
    }

    return {
      targetTable: "users",
      blockingGraphDepthLimit: maxDepth,
      lockHolders: lockHolderRows.map((row) => ({
        ...summarizeReadinessActivity(row),
        lockMode: row.lockMode,
        blockingChain: buildReadinessBlockingChain({
          pid: row.pid,
          rowsByPid,
          blockersByPid,
        }),
      })),
      blockedSessions: blockedRows.map((row) => ({
        ...summarizeReadinessActivity(row),
        waitingOn: waitingLocksByPid.get(row.pid) ?? [],
        blockingChain: buildReadinessBlockingChain({
          pid: row.pid,
          rowsByPid,
          blockersByPid,
        }),
        blockers: normalizePidArray(row.blockerPids)
          .map((pid) => blockerByPid.get(pid))
          .filter((blocker): blocker is ReadinessActivityRow => Boolean(blocker))
          .map((blocker) => summarizeReadinessActivity(blocker)),
      })),
      activeSessions: activeRows.map((row) => summarizeReadinessActivity(row)),
    };
  });
}

export function createControlPlaneApp() {
  const app = new Hono();

  app.use("*", logger());
  app.use(
    "*",
    cors({
      origin: process.env.CORS_ORIGIN || "http://localhost:5173",
      credentials: true,
    }),
  );

  app.onError((error, c) => {
    console.error("[control-plane] uncaught error", error);
    return c.json({ error: error instanceof Error ? error.message : "Internal Server Error" }, 500);
  });

  app.get("/health", (c) => c.json({ status: "ok", service: "opener-x-control-plane" }));
  app.get("/health/live", (c) => c.json({ status: "ok", service: "opener-x-control-plane" }));
  app.get("/health/ready", async (c) => {
    try {
      await runReadinessProbe();
      return c.json({ status: "ok", service: "opener-x-control-plane" });
    } catch (error) {
      let diagnostics: Awaited<ReturnType<typeof loadReadinessDiagnostics>> | null = null;
      try {
        diagnostics = await loadReadinessDiagnostics();
      } catch (diagnosticsError) {
        console.error("[control-plane] readiness diagnostics unavailable", diagnosticsError);
      }
      console.error("[control-plane] readiness probe failed", error);
      if (diagnostics) {
        console.error("[control-plane] readiness diagnostics", diagnostics);
      }
      return c.json(
        {
          status: "error",
          service: "opener-x-control-plane",
          error: error instanceof Error ? error.message : "Database not ready",
          diagnostics,
        },
        503,
      );
    }
  });

  app.route("/api/auth", authRoutes);
  app.route("/api/orgs", orgRoutes);
  app.route("/api/projects", projectRoutes);
  app.route("/api/envs", envRoutes);
  app.route("/api/users", userRoutes);
  app.route("/api/policies", policyRoutes);
  app.route("/api/audit", auditRoutes);
  app.route("/api/cost", costRoutes);
  app.route("/api/dashboard", dashboardRoutes);
  app.route("/api/agent-runs", agentRunRoutes);
  app.route("/api/approvals", approvalRoutes);
  app.route("/api/project-tree", projectTreeRoutes);
  app.route("/api/tasks", taskRoutes);
  app.route("/api/tasks/:taskId/operating-runtime", taskOperatingRuntimeRoutes);
  app.route("/api/plugins", pluginRoutes);
  app.route("/api/role-agents", roleAgentRoutes);
  app.route("/api/workflow-templates", workflowTemplateRoutes);
  app.route("/api/tasks/:taskId/workflow", taskWorkflowRoutes);
  app.route("/api/tasks/:taskId/role-conclusions", roleConclusionRoutes);
  app.route("/api/tasks/:taskId/developer-change-requests", developerChangeRequestRoutes);
  app.route("/api/projects/:projectId/repositories", repositoryRoutes);
  app.route("/api/projects/:projectId/credentials", credentialRoutes);
  app.route("/api", codeChangeRoutes);
  app.route("/api/governance", governanceRoutes);
  app.route("/api/workbench", workbenchRoutes);

  return app;
}
