import { eq } from "drizzle-orm";
import { db } from "../../db";
import { approvalTickets, codeChanges, fileChanges } from "../../db/schema";
import { recordAuditEvent } from "../audit/routes";

// ── Risk Assessment Rules Engine ───────────────────────────────────
// Evaluates code changes against governance rules and creates
// audit events + approval tickets for high-risk changes.

export type RiskLevel = "low" | "medium" | "high" | "critical";

export interface RiskRule {
  id: string;
  name: string;
  description: string;
  check: (context: RiskContext) => RiskViolation | null;
}

export interface RiskContext {
  taskId: string;
  repoId: string | null;
  changeId: string;
  files: Array<{
    filePath: string;
    changeType: string;
    insertions: number;
    deletions: number;
  }>;
  totalInsertions: number;
  totalDeletions: number;
  totalFiles: number;
}

export interface RiskViolation {
  ruleId: string;
  ruleName: string;
  level: RiskLevel;
  detail: string;
}

export interface GovernanceResult {
  taskId: string;
  changeId: string;
  overallRisk: RiskLevel;
  violations: RiskViolation[];
  approvalRequired: boolean;
  approvalTicketId?: string;
}

// ── Built-in Risk Rules ────────────────────────────────────────────

const CRITICAL_PATH_PATTERNS = [
  /^\.env/,
  /^\.github\//,
  /docker-compose/,
  /Dockerfile/,
  /^infra\//,
  /^deploy\//,
  /nginx/,
  /\.service$/,
  /\.conf$/,
  /package\.json$/,
  /drizzle\.config/,
];

const SENSITIVE_FILE_PATTERNS = [
  /secret/i,
  /credential/i,
  /password/i,
  /\.pem$/,
  /\.key$/,
  /\.cert$/,
];

const builtinRules: RiskRule[] = [
  {
    id: "critical-path",
    name: "关键路径变更",
    description: "变更涉及部署、配置或基础设施文件",
    check: (ctx) => {
      const hits = ctx.files.filter((f) => CRITICAL_PATH_PATTERNS.some((p) => p.test(f.filePath)));
      if (hits.length === 0) return null;
      return {
        ruleId: "critical-path",
        ruleName: "关键路径变更",
        level: "high",
        detail: `涉及 ${hits.length} 个关键文件: ${hits.map((f) => f.filePath).join(", ")}`,
      };
    },
  },
  {
    id: "sensitive-file",
    name: "敏感文件变更",
    description: "变更涉及含有密钥或凭证的文件",
    check: (ctx) => {
      const hits = ctx.files.filter((f) => SENSITIVE_FILE_PATTERNS.some((p) => p.test(f.filePath)));
      if (hits.length === 0) return null;
      return {
        ruleId: "sensitive-file",
        ruleName: "敏感文件变更",
        level: "critical",
        detail: `涉及 ${hits.length} 个敏感文件: ${hits.map((f) => f.filePath).join(", ")}`,
      };
    },
  },
  {
    id: "large-change",
    name: "大规模变更",
    description: "单次变更超过 20 个文件",
    check: (ctx) => {
      if (ctx.totalFiles <= 20) return null;
      return {
        ruleId: "large-change",
        ruleName: "大规模变更",
        level: "high",
        detail: `变更了 ${ctx.totalFiles} 个文件（阈值: 20）`,
      };
    },
  },
  {
    id: "high-churn",
    name: "高代码变动量",
    description: "单次新增/删除超过 500 行",
    check: (ctx) => {
      const total = ctx.totalInsertions + ctx.totalDeletions;
      if (total <= 500) return null;
      return {
        ruleId: "high-churn",
        ruleName: "高代码变动量",
        level: "medium",
        detail: `总变动 ${total} 行（+${ctx.totalInsertions} -${ctx.totalDeletions}，阈值: 500）`,
      };
    },
  },
  {
    id: "file-deletion",
    name: "文件删除",
    description: "变更包含文件删除操作",
    check: (ctx) => {
      const deleted = ctx.files.filter((f) => f.changeType === "deleted");
      if (deleted.length === 0) return null;
      return {
        ruleId: "file-deletion",
        ruleName: "文件删除",
        level: deleted.length >= 5 ? "high" : "medium",
        detail: `删除了 ${deleted.length} 个文件: ${deleted.map((f) => f.filePath).join(", ")}`,
      };
    },
  },
];

// ── Risk Assessment ────────────────────────────────────────────────

function computeOverallRisk(violations: RiskViolation[]): RiskLevel {
  if (violations.some((v) => v.level === "critical")) return "critical";
  if (violations.some((v) => v.level === "high")) return "high";
  if (violations.some((v) => v.level === "medium")) return "medium";
  return "low";
}

/**
 * Evaluate a code change against all governance rules.
 * Creates audit events and approval tickets as needed.
 */
export async function evaluateCodeChange(
  changeId: string,
  userId: string,
): Promise<GovernanceResult> {
  // Load the change and its files
  const change = await db.query.codeChanges.findFirst({
    where: eq(codeChanges.id, changeId),
  });
  if (!change) throw new Error(`Code change ${changeId} not found`);

  const files = await db.select().from(fileChanges).where(eq(fileChanges.changeId, changeId));

  const totalInsertions = files.reduce((s, f) => s + f.insertions, 0);
  const totalDeletions = files.reduce((s, f) => s + f.deletions, 0);

  const context: RiskContext = {
    taskId: change.taskId,
    repoId: change.repoId,
    changeId,
    files,
    totalInsertions,
    totalDeletions,
    totalFiles: files.length,
  };

  // Run rules
  const violations: RiskViolation[] = [];
  for (const rule of builtinRules) {
    const violation = rule.check(context);
    if (violation) violations.push(violation);
  }

  const overallRisk = computeOverallRisk(violations);
  const approvalRequired = overallRisk === "high" || overallRisk === "critical";

  // Record audit event
  await recordAuditEvent({
    eventType: "governance",
    action: "code_change.evaluated",
    userId,
    taskId: change.taskId,
    riskLevel: overallRisk === "low" ? undefined : overallRisk,
    detail: {
      changeId,
      overallRisk,
      violationCount: violations.length,
      violations: violations.map((v) => ({ ruleId: v.ruleId, level: v.level })),
    },
  });

  // Create approval ticket if needed
  let approvalTicketId: string | undefined;
  if (approvalRequired) {
    approvalTicketId = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    await db.insert(approvalTickets).values({
      id: approvalTicketId,
      taskId: change.taskId,
      actionType: "batch_edit",
      riskLevel: overallRisk === "critical" ? "critical" : "high",
      status: "pending",
      requestDetail: {
        trigger: "code_change_governance",
        changeId,
        violations: violations.map((v) => v.ruleName),
      },
      expiresAt,
    });

    await recordAuditEvent({
      eventType: "governance",
      action: "approval.created_from_risk",
      userId,
      taskId: change.taskId,
      detail: {
        approvalTicketId,
        trigger: "code_change_governance",
        changeId,
        overallRisk,
      },
    });
  }

  return {
    taskId: change.taskId,
    changeId,
    overallRisk,
    violations,
    approvalRequired,
    approvalTicketId,
  };
}

/**
 * Get cached/computed governance result for a task's code changes.
 * Evaluates all changes for the task and returns the worst risk.
 */
export async function getTaskGovernanceSummary(
  taskId: string,
): Promise<{ overallRisk: RiskLevel; violations: RiskViolation[]; approvalRequired: boolean }> {
  const changes = await db.select().from(codeChanges).where(eq(codeChanges.taskId, taskId));

  const allViolations: RiskViolation[] = [];

  for (const change of changes) {
    const files = await db.select().from(fileChanges).where(eq(fileChanges.changeId, change.id));

    const totalInsertions = files.reduce((s, f) => s + f.insertions, 0);
    const totalDeletions = files.reduce((s, f) => s + f.deletions, 0);

    const context: RiskContext = {
      taskId,
      repoId: change.repoId,
      changeId: change.id,
      files,
      totalInsertions,
      totalDeletions,
      totalFiles: files.length,
    };

    for (const rule of builtinRules) {
      const violation = rule.check(context);
      if (violation) allViolations.push(violation);
    }
  }

  const overallRisk = computeOverallRisk(allViolations);
  return {
    overallRisk,
    violations: allViolations,
    approvalRequired: overallRisk === "high" || overallRisk === "critical",
  };
}
