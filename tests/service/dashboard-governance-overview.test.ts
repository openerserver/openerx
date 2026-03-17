import { Database } from "bun:sqlite";
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

const sqlite = new Database(DB_PATH, { create: false, strict: true });
const createdTaskIds: string[] = [];
const createdLedgerIds: string[] = [];
const createdAuditIds: string[] = [];
const createdLeaseIds: string[] = [];
let token = "";
let currentUserId = "";

interface GovernanceOverviewResponse {
  range: "24h" | "7d" | "30d" | "monthly";
  generatedAt: string;
  summary: {
    blockedCount: number;
    breakerCount: number;
    activeLeaseCount: number;
    topRiskTaskCount: number;
  };
  topRiskTasks: Array<{
    taskId: string;
    projectId: string;
    title: string;
    runtimeSessionId: string | null;
    requestCount: number;
    totalTokens: number;
    costUsd: number;
    blockedCount: number;
    breakerCount: number;
    judgeRequestCount: number;
    hookRequestCount: number;
    parallelCandidateCount: number;
    riskScore: number;
    dominantDriver: string;
    lastGuardDecision: string | null;
    lastGuardReason: string | null;
    lastBreakerReason: string | null;
    lastActivityAt: string | null;
  }>;
  recentEvents: Array<{
    id: string;
    projectId: string;
    taskId: string | null;
    title: string;
    runtimeSessionId: string | null;
    eventKind: "guard" | "breaker";
    action: string;
    guardDecision: string | null;
    reason: string | null;
    occurredAt: string;
  }>;
}

async function request<T>(
  path: string,
  opts: RequestInit = {},
): Promise<{ data: T; status: number }> {
  const response = await fetch(`${CP_URL}${path}`, opts);
  const text = await response.text();
  let data: unknown;
  try {
    data = text ? JSON.parse(text) : undefined;
  } catch {
    data = text;
  }
  return { data: data as T, status: response.status };
}

async function authedRequest<T>(path: string, opts: RequestInit = {}) {
  return request<T>(path, {
    ...opts,
    headers: {
      ...(opts.headers as Record<string, string>),
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });
}

function decodeJwtPayload(jwt: string) {
  const [, payload] = jwt.split(".");
  if (!payload) {
    throw new Error("JWT payload missing");
  }
  return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { sub: string };
}

async function login() {
  const { data, status } = await request<{ token: string }>("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: USERNAME, password: PASSWORD }),
  });
  if (status !== 200) {
    throw new Error(`Login failed: ${status} ${JSON.stringify(data)}`);
  }
  return data.token;
}

async function createTask(title: string) {
  const { data, status } = await authedRequest<{ id: string }>("/api/tasks", {
    method: "POST",
    body: JSON.stringify({
      title,
      prompt: `${title} 的治理聚合测试`,
      projectId: PROJECT_ID,
    }),
  });
  expect(status).toBe(201);
  createdTaskIds.push(data.id);
  return data.id;
}

function insertLedger(args: {
  id: string;
  taskId: string;
  runtimeSessionId: string;
  requestCount: number;
  totalTokens: number;
  costUsd: number;
  candidateCount: number;
  judgeRequestCount: number;
  hookRequestCount: number;
  createdAt: string;
  updatedAt: string;
}) {
  sqlite
    .query(
      `INSERT INTO runtime_usage_ledgers (
      id, project_id, task_id, runtime_session_id, execution_source, entrypoint_type,
      orchestration_fingerprint, default_provider_id, default_model_id, request_count, step_count,
      input_tokens, output_tokens, total_tokens, cost_usd, candidate_count, judge_request_count,
      hook_request_count, status, started_at, finished_at, synced_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      args.id,
      PROJECT_ID,
      args.taskId,
      args.runtimeSessionId,
      "task-execute",
      "parallel-candidate",
      `fp-${args.id}`,
      "github-copilot",
      "gpt-5-mini",
      args.requestCount,
      args.requestCount,
      Math.floor(args.totalTokens * 0.6),
      Math.ceil(args.totalTokens * 0.4),
      args.totalTokens,
      args.costUsd,
      args.candidateCount,
      args.judgeRequestCount,
      args.hookRequestCount,
      "completed",
      args.createdAt,
      args.updatedAt,
      args.updatedAt,
      args.createdAt,
      args.updatedAt,
    );
  createdLedgerIds.push(args.id);
}

function insertAudit(args: {
  id: string;
  taskId: string;
  sessionId: string;
  action: string;
  ts: string;
  detail?: Record<string, unknown>;
}) {
  sqlite
    .query(
      `INSERT INTO audit_events (
      id, ts, user_id, project_id, session_id, task_id, event_type, action, target, detail, risk_level
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      args.id,
      args.ts,
      currentUserId,
      PROJECT_ID,
      args.sessionId,
      args.taskId,
      "paid_execution",
      args.action,
      args.taskId,
      args.detail ? JSON.stringify(args.detail) : null,
      "high",
    );
  createdAuditIds.push(args.id);
}

function insertActiveLease(id: string, expiresAt: string, createdAt: string) {
  sqlite
    .query(
      `INSERT INTO paid_execution_leases (
      id, project_id, issued_by_user_id, reason, status, expires_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      PROJECT_ID,
      currentUserId,
      "dashboard governance overview test",
      "active",
      expiresAt,
      createdAt,
      createdAt,
    );
  createdLeaseIds.push(id);
}

beforeAll(async () => {
  token = await login();
  currentUserId = decodeJwtPayload(token).sub;
});

afterAll(() => {
  const deleteByIds = (table: string, ids: string[]) => {
    for (const id of ids) {
      sqlite.query(`DELETE FROM ${table} WHERE id = ?`).run(id);
    }
  };

  deleteByIds("audit_events", createdAuditIds);
  deleteByIds("paid_execution_leases", createdLeaseIds);
  deleteByIds("runtime_usage_ledgers", createdLedgerIds);
  deleteByIds("tasks", createdTaskIds);
  sqlite.close();
});

describe("dashboard governance overview route", () => {
  test("aggregates blocked, breaker, lease, and top-risk task metrics", async () => {
    const unique = Date.now();
    const baseline = await authedRequest<GovernanceOverviewResponse>(
      "/api/dashboard/governance-overview?range=24h",
    );
    expect(baseline.status).toBe(200);

    const primaryTaskTitle = `治理风险主任务-${unique}`;
    const primaryTaskId = await createTask(primaryTaskTitle);
    const primaryLedgerId = `ledger-governance-primary-${unique}`;
    const primarySessionId = `session-governance-primary-${unique}`;
    const leaseId = `lease-governance-${unique}`;

    const now = Date.now();
    const primaryCreatedAt = new Date(now - 8 * 60 * 1000).toISOString();
    const primaryUpdatedAt = new Date(now - 6 * 60 * 1000).toISOString();
    const blockedPrimaryAt = new Date(now - 4 * 60 * 1000).toISOString();
    const breakerPrimaryAt = new Date(now - 3 * 60 * 1000).toISOString();
    const blockedPrimaryRetryAt = new Date(now - 2 * 60 * 1000).toISOString();
    const blockedPrimaryFinalAt = new Date(now - 60 * 1000).toISOString();
    const leaseExpiresAt = new Date(now + 60 * 60 * 1000).toISOString();

    insertLedger({
      id: primaryLedgerId,
      taskId: primaryTaskId,
      runtimeSessionId: primarySessionId,
      requestCount: 12,
      totalTokens: 1800,
      costUsd: 1.8,
      candidateCount: 8,
      judgeRequestCount: 4,
      hookRequestCount: 6,
      createdAt: primaryCreatedAt,
      updatedAt: primaryUpdatedAt,
    });

    insertAudit({
      id: `audit-governance-block-primary-${unique}`,
      taskId: primaryTaskId,
      sessionId: primarySessionId,
      action: "guard_blocked_preflight",
      ts: blockedPrimaryAt,
      detail: {
        guardDecision: "deny",
        guardReason: "Estimated amplification exceeds policy.",
      },
    });
    insertAudit({
      id: `audit-governance-breaker-primary-${unique}`,
      taskId: primaryTaskId,
      sessionId: primarySessionId,
      action: "breaker_tripped",
      ts: breakerPrimaryAt,
      detail: {
        breakerReason: "Parallel candidate burst exceeded the breaker threshold.",
      },
    });
    insertAudit({
      id: `audit-governance-block-primary-retry-${unique}`,
      taskId: primaryTaskId,
      sessionId: primarySessionId,
      action: "guard_blocked_preflight",
      ts: blockedPrimaryRetryAt,
      detail: {
        guardDecision: "deny",
        guardReason: "Retry amplification still exceeds policy.",
      },
    });
    insertAudit({
      id: `audit-governance-block-primary-final-${unique}`,
      taskId: primaryTaskId,
      sessionId: primarySessionId,
      action: "guard_blocked_preflight",
      ts: blockedPrimaryFinalAt,
      detail: {
        guardDecision: "deny",
        guardReason: "Final retry still exceeds amplification threshold.",
      },
    });
    insertActiveLease(leaseId, leaseExpiresAt, primaryCreatedAt);

    const response = await authedRequest<GovernanceOverviewResponse>(
      "/api/dashboard/governance-overview?range=24h",
    );

    expect(response.status).toBe(200);
    expect(response.data.range).toBe("24h");
    expect(response.data.summary).toEqual({
      blockedCount: baseline.data.summary.blockedCount + 3,
      breakerCount: baseline.data.summary.breakerCount + 1,
      activeLeaseCount: baseline.data.summary.activeLeaseCount + 1,
      topRiskTaskCount: Math.min(5, baseline.data.summary.topRiskTaskCount + 1),
    });

    const primaryRiskTask = response.data.topRiskTasks.find(
      (item) => item.taskId === primaryTaskId,
    );
    expect(primaryRiskTask).toBeTruthy();
    expect(primaryRiskTask).toMatchObject({
      taskId: primaryTaskId,
      projectId: PROJECT_ID,
      title: primaryTaskTitle,
      runtimeSessionId: primarySessionId,
      requestCount: 12,
      totalTokens: 1800,
      costUsd: 1.8,
      blockedCount: 3,
      breakerCount: 1,
      judgeRequestCount: 4,
      hookRequestCount: 6,
      parallelCandidateCount: 7,
      dominantDriver: "breaker",
      lastGuardDecision: "deny",
      lastGuardReason: "Final retry still exceeds amplification threshold.",
      lastBreakerReason: "Parallel candidate burst exceeded the breaker threshold.",
    });
    expect(response.data.recentEvents[0]).toMatchObject({
      eventKind: "guard",
      taskId: primaryTaskId,
      guardDecision: "deny",
      reason: "Final retry still exceeds amplification threshold.",
    });
    expect(response.data.recentEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventKind: "breaker",
          taskId: primaryTaskId,
          reason: "Parallel candidate burst exceeded the breaker threshold.",
        }),
      ]),
    );
    expect(response.data.topRiskTasks[0]?.taskId).toBe(primaryTaskId);
  });
});
