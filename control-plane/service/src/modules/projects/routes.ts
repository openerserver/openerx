import { zValidator } from "@hono/zod-validator";
import { and, eq, inArray } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { db } from "../../db";
import {
  type ProjectSettings,
  approvalTickets,
  auditEvents,
  budgetConfigs,
  costRecords,
  environments,
  organizations,
  projectRoles,
  projects,
  repositories,
  repositoryCredentials,
  tasks,
  users,
  workflowTemplates,
} from "../../db/schema";
import { type AppEnv, type JWTPayload, authMiddleware } from "../../middleware/auth";
import { requireProjectRole, requireRole } from "../../middleware/rbac";

export const projectRoutes = new Hono<AppEnv>();

projectRoutes.use("*", authMiddleware);

const approvalPolicyModeSchema = z.enum(["balanced", "strict", "manual"]);

const environmentApprovalPolicyBindingSchema = z.object({
  approvalPolicy: approvalPolicyModeSchema.optional(),
  policyTemplateId: z.string().min(1).optional(),
});

const projectSettingsSchema = z.object({
  defaultModel: z.string().min(1).optional(),
  defaultEnvironmentId: z.string().min(1).optional(),
  workflowTemplateId: z.string().min(1).optional(),
  approvalPolicyTemplateId: z.string().min(1).optional(),
  approvalPolicy: approvalPolicyModeSchema.optional(),
  environmentApprovalPolicies: z.record(environmentApprovalPolicyBindingSchema).optional(),
  maxConcurrency: z.number().int().min(1).max(100).optional(),
  budgetMonthly: z.number().min(0).optional(),
  budgetConfigId: z.string().min(1).optional(),
  warnThreshold: z.number().min(0).max(1).optional(),
  throttleThreshold: z.number().min(0).max(1).optional(),
});

type Role = "platform_admin" | "org_admin" | "project_admin" | "developer" | "viewer";

const ROLE_HIERARCHY: Record<Role, number> = {
  platform_admin: 5,
  org_admin: 4,
  project_admin: 3,
  developer: 2,
  viewer: 1,
};

const createProjectSchema = z.object({
  orgId: z.string().min(1),
  name: z.string().min(1).max(100),
  slug: z
    .string()
    .min(1)
    .max(50)
    .regex(/^[a-z0-9-]+$/),
  description: z.string().max(500).optional(),
  settings: projectSettingsSchema.optional(),
});

const updateProjectSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
  settings: projectSettingsSchema.optional(),
});

const projectMemberRoleSchema = z.enum(["project_admin", "developer", "viewer"]);

const addProjectMemberSchema = z.object({
  userId: z.string().min(1),
  role: projectMemberRoleSchema.default("developer"),
});

const updateProjectMemberSchema = z.object({
  role: projectMemberRoleSchema,
});

const workflowTemplateBindingSchema = z.object({
  workflowTemplateId: z.string().min(1).nullable(),
});

function normalizeProjectSettings(settings: unknown): ProjectSettings | null | undefined {
  if (settings == null) {
    return settings as null | undefined;
  }

  if (typeof settings === "string") {
    try {
      return JSON.parse(settings) as ProjectSettings;
    } catch {
      return undefined;
    }
  }

  return settings as ProjectSettings;
}

function normalizeProjectRecord<T extends { settings?: unknown }>(
  project: T,
): Omit<T, "settings"> & {
  settings?: ProjectSettings | null;
} {
  return {
    ...project,
    settings: normalizeProjectSettings(project.settings),
  };
}

async function getProjectOrNull(projectId: string) {
  return db.query.projects.findFirst({
    where: eq(projects.id, projectId),
  });
}

async function getWorkflowTemplateBinding(projectId: string, settings: ProjectSettings | null | undefined) {
  const workflowTemplateId = settings?.workflowTemplateId || null;
  if (!workflowTemplateId) {
    return {
      workflowTemplateId: null,
      template: null,
    };
  }

  const template = await db.query.workflowTemplates.findFirst({
    where: eq(workflowTemplates.id, workflowTemplateId),
  });

  if (!template) {
    return {
      workflowTemplateId,
      template: null,
    };
  }

  if (template.projectId && template.projectId !== projectId) {
    return {
      workflowTemplateId,
      template: null,
    };
  }

  return {
    workflowTemplateId,
    template,
  };
}

async function listProjectAdmins(projectId: string) {
  return db.query.projectRoles.findMany({
    where: eq(projectRoles.projectId, projectId),
  });
}

function hasGlobalProjectAccess(user: JWTPayload) {
  const level = ROLE_HIERARCHY[user.role as Role] ?? 0;
  return level >= ROLE_HIERARCHY.org_admin;
}

async function listVisibleProjects(user: JWTPayload, orgId?: string) {
  if (hasGlobalProjectAccess(user)) {
    return db.query.projects.findMany({
      ...(orgId ? { where: eq(projects.orgId, orgId) } : {}),
    });
  }

  const memberships = await db.query.projectRoles.findMany({
    where: eq(projectRoles.userId, user.sub),
  });
  const visibleProjectIds = memberships.map((membership) => membership.projectId);

  if (visibleProjectIds.length === 0) {
    return [];
  }

  return db.query.projects.findMany({
    where: orgId
      ? and(inArray(projects.id, visibleProjectIds), eq(projects.orgId, orgId))
      : inArray(projects.id, visibleProjectIds),
  });
}

async function getVisibleProjectOrNull(user: JWTPayload, projectId: string) {
  if (hasGlobalProjectAccess(user)) {
    return getProjectOrNull(projectId);
  }

  const membership = await db.query.projectRoles.findFirst({
    where: and(eq(projectRoles.userId, user.sub), eq(projectRoles.projectId, projectId)),
  });

  if (!membership) {
    return null;
  }

  return getProjectOrNull(projectId);
}

type OverviewProjectStatus = "healthy" | "pending_config" | "archived" | "error";
type OverviewConfigStatus = "configured" | "pending" | "risk";
type OverviewSortBy = "last_activity_desc" | "created_at_desc" | "name_asc";

interface OverviewQueryParams {
  q: string;
  orgId?: string;
  statusFilter?: OverviewProjectStatus;
  configStatusFilter?: OverviewConfigStatus;
  onlyManaged: boolean;
  sortBy: OverviewSortBy;
  page: number;
  pageSize: number;
}

interface OverviewItem {
  id: string;
  orgId: string;
  orgName: string;
  name: string;
  slug: string;
  description: string | null | undefined;
  projectStatus: OverviewProjectStatus;
  completedCount: number;
  totalRequiredCount: number;
  completionPercent: number;
  risks: string[];
  runningTasks: number;
  pendingApprovals: number;
  failedTasksToday: number;
  lastActivityAt: string | null;
  memberCount: number;
  repositoryCount: number;
  environmentCount: number;
  currentUserRole: string | null;
  isCurrentUserManager: boolean;
  createdAt: string;
}

function parseOverviewParams(c: {
  req: { query: (key: string) => string | undefined };
}): OverviewQueryParams {
  const rawStatus = c.req.query("status") || "";
  const rawConfigStatus = c.req.query("configStatus") || "";
  const rawSortBy = c.req.query("sortBy") || "last_activity_desc";

  return {
    q: c.req.query("q") || "",
    orgId: c.req.query("orgId") || undefined,
    statusFilter:
      rawStatus === "healthy" ||
      rawStatus === "pending_config" ||
      rawStatus === "archived" ||
      rawStatus === "error"
        ? rawStatus
        : undefined,
    configStatusFilter:
      rawConfigStatus === "configured" ||
      rawConfigStatus === "pending" ||
      rawConfigStatus === "risk"
        ? rawConfigStatus
        : undefined,
    onlyManaged: c.req.query("onlyManaged") === "true",
    sortBy:
      rawSortBy === "created_at_desc" ||
      rawSortBy === "name_asc" ||
      rawSortBy === "last_activity_desc"
        ? rawSortBy
        : "last_activity_desc",
    page: Math.max(1, Number(c.req.query("page")) || 1),
    pageSize: Math.min(100, Math.max(1, Number(c.req.query("pageSize")) || 20)),
  };
}

async function filterManagedProjects(
  user: JWTPayload,
  visibleProjects: (typeof projects.$inferSelect)[],
) {
  if (hasGlobalProjectAccess(user)) {
    return visibleProjects;
  }

  const managedIds = new Set<string>();
  const memberships = await db.query.projectRoles.findMany({
    where: and(eq(projectRoles.userId, user.sub), eq(projectRoles.role, "project_admin")),
  });

  for (const membership of memberships) {
    managedIds.add(membership.projectId);
  }

  return visibleProjects.filter((project) => managedIds.has(project.id));
}

async function getOverviewProjects(user: JWTPayload, params: OverviewQueryParams) {
  let visibleProjects = await listVisibleProjects(user, params.orgId);

  if (params.q) {
    const lower = params.q.toLowerCase();
    visibleProjects = visibleProjects.filter(
      (project) =>
        project.name.toLowerCase().includes(lower) || project.slug.toLowerCase().includes(lower),
    );
  }

  if (params.onlyManaged) {
    visibleProjects = await filterManagedProjects(user, visibleProjects);
  }

  return visibleProjects;
}

function emptyOverviewResponse(page: number, pageSize: number) {
  return {
    data: [],
    page,
    pageSize,
    total: 0,
    summary: { totalProjects: 0, pendingConfigCount: 0, riskCount: 0 },
  };
}

function groupByProjectId<T extends { projectId: string }>(items: T[]) {
  const map = new Map<string, T[]>();

  for (const item of items) {
    const list = map.get(item.projectId) || [];
    list.push(item);
    map.set(item.projectId, list);
  }

  return map;
}

function mapApprovalsByProject(
  allTasks: (typeof tasks.$inferSelect)[],
  allPendingApprovals: (typeof approvalTickets.$inferSelect)[],
  projectIds: string[],
) {
  const taskProjectMap = new Map<string, string>();
  const approvalsByProject = new Map<string, typeof allPendingApprovals>();

  for (const task of allTasks) {
    taskProjectMap.set(task.id, task.projectId);
  }

  for (const approval of allPendingApprovals) {
    const projectId = taskProjectMap.get(approval.taskId);
    if (!projectId || !projectIds.includes(projectId)) {
      continue;
    }

    const list = approvalsByProject.get(projectId) || [];
    list.push(approval);
    approvalsByProject.set(projectId, list);
  }

  return approvalsByProject;
}

async function loadOverviewDependencies(projectIds: string[]) {
  const [
    allOrgs,
    allMembers,
    allEnvironments,
    allRepositories,
    allCredentials,
    allTasks,
    allPendingApprovals,
    allBudgetConfigs,
    allCostRecords,
  ] = await Promise.all([
    db.query.organizations.findMany(),
    db.query.projectRoles.findMany({ where: inArray(projectRoles.projectId, projectIds) }),
    db.query.environments.findMany({ where: inArray(environments.projectId, projectIds) }),
    db.query.repositories.findMany({ where: inArray(repositories.projectId, projectIds) }),
    db.query.repositoryCredentials.findMany({
      where: inArray(repositoryCredentials.projectId, projectIds),
    }),
    db.query.tasks.findMany({ where: inArray(tasks.projectId, projectIds) }),
    db.query.approvalTickets.findMany({ where: eq(approvalTickets.status, "pending") }),
    db.query.budgetConfigs.findMany({ where: inArray(budgetConfigs.projectId, projectIds) }),
    db.query.costRecords.findMany({ where: inArray(costRecords.projectId, projectIds) }),
  ]);

  return {
    orgMap: new Map(allOrgs.map((org) => [org.id, org])),
    membersByProject: groupByProjectId(allMembers),
    envsByProject: groupByProjectId(allEnvironments),
    reposByProject: groupByProjectId(allRepositories),
    credsByProject: groupByProjectId(allCredentials),
    tasksByProject: groupByProjectId(allTasks),
    budgetsByProject: groupByProjectId(allBudgetConfigs),
    costsByProject: groupByProjectId(allCostRecords),
    approvalsByProject: mapApprovalsByProject(allTasks, allPendingApprovals, projectIds),
    allMembers,
  };
}

function buildUserRoleMap(userId: string, members: (typeof projectRoles.$inferSelect)[]) {
  return new Map(
    members
      .filter((membership) => membership.userId === userId)
      .map((membership) => [membership.projectId, membership.role]),
  );
}

function getBudgetRiskState(
  budgets: (typeof budgetConfigs.$inferSelect)[],
  costs: (typeof costRecords.$inferSelect)[],
) {
  const risks: string[] = [];
  let budgetBlocking = false;

  for (const budget of budgets) {
    const totalSpend = costs.reduce((sum, record) => sum + record.cost, 0);
    const usage = budget.limitAmount > 0 ? totalSpend / budget.limitAmount : 0;
    if (usage < budget.throttleThreshold) {
      continue;
    }

    budgetBlocking = true;
    risks.push(usage >= 1 ? "预算限流" : "预算预警");
  }

  return { risks, budgetBlocking };
}

function getCredentialRiskState(credentials: (typeof repositoryCredentials.$inferSelect)[]) {
  const hasExpiredDefault = credentials.some(
    (credential) => credential.isDefault && credential.status === "expired",
  );
  const hasActiveDefault = credentials.some(
    (credential) => credential.isDefault && credential.status === "active",
  );

  return {
    risks: hasExpiredDefault && !hasActiveDefault ? ["凭证已过期"] : [],
    hasExpiredDefault,
    hasActiveDefault,
  };
}

function getMissingConfigRisks(params: {
  hasRepo: boolean;
  hasCred: boolean;
  hasDefaultEnv: boolean;
  hasApprovalPolicy: boolean;
  hasEnv: boolean;
  hasMember: boolean;
  budgets: (typeof budgetConfigs.$inferSelect)[];
  budgetMonthly?: number;
}) {
  const risks: string[] = [];

  if (!params.hasRepo) risks.push("无仓库");
  if (!params.hasCred) risks.push("无凭证");
  if (!params.hasDefaultEnv) risks.push("无默认环境");
  if (!params.hasApprovalPolicy) risks.push("审批未绑定");
  if (!params.hasEnv) risks.push("无环境");
  if (!params.hasMember) risks.push("无成员");
  if (params.budgets.length === 0 && (params.budgetMonthly ?? 0) <= 0) {
    risks.push("预算未配置");
  }

  return risks;
}

function buildProjectRisks(params: {
  hasRepo: boolean;
  hasCred: boolean;
  hasDefaultEnv: boolean;
  hasApprovalPolicy: boolean;
  hasEnv: boolean;
  hasMember: boolean;
  budgets: (typeof budgetConfigs.$inferSelect)[];
  costs: (typeof costRecords.$inferSelect)[];
  credentials: (typeof repositoryCredentials.$inferSelect)[];
  budgetMonthly?: number;
}) {
  const budgetState = getBudgetRiskState(params.budgets, params.costs);
  const credentialState = getCredentialRiskState(params.credentials);
  const missingConfigRisks = getMissingConfigRisks({
    hasRepo: params.hasRepo,
    hasCred: params.hasCred,
    hasDefaultEnv: params.hasDefaultEnv,
    hasApprovalPolicy: params.hasApprovalPolicy,
    hasEnv: params.hasEnv,
    hasMember: params.hasMember,
    budgets: params.budgets,
    budgetMonthly: params.budgetMonthly,
  });

  return {
    risks: [...budgetState.risks, ...credentialState.risks, ...missingConfigRisks],
    budgetBlocking: budgetState.budgetBlocking,
    hasExpiredDefault: credentialState.hasExpiredDefault,
    hasActiveDefault: credentialState.hasActiveDefault,
  };
}

function deriveOverviewStatus(
  project: typeof projects.$inferSelect,
  completed: number,
  totalRequired: number,
  budgetBlocking: boolean,
  hasExpiredDefault: boolean,
  hasActiveDefault: boolean,
): OverviewProjectStatus {
  const dbStatus = (project as { status?: string }).status || "active";
  if (dbStatus === "archived") {
    return "archived";
  }

  if (budgetBlocking || (hasExpiredDefault && !hasActiveDefault)) {
    return "error";
  }

  if (completed < totalRequired) {
    return "pending_config";
  }

  return "healthy";
}

function getProjectLastActivity(
  project: typeof projects.$inferSelect,
  projectTasks: (typeof tasks.$inferSelect)[],
) {
  let lastActivityAt: string | null = null;

  for (const task of projectTasks) {
    const timestamp = task.finishedAt || task.startedAt || task.createdAt;
    if (timestamp && (!lastActivityAt || timestamp > lastActivityAt)) {
      lastActivityAt = timestamp;
    }
  }

  const projectUpdatedAt = (project as { updatedAt?: string }).updatedAt;
  if (projectUpdatedAt && (!lastActivityAt || projectUpdatedAt > lastActivityAt)) {
    lastActivityAt = projectUpdatedAt;
  }

  return lastActivityAt || project.createdAt;
}

function buildOverviewItem(
  user: JWTPayload,
  project: typeof projects.$inferSelect,
  dependencies: {
    orgMap: Map<string, typeof organizations.$inferSelect>;
    membersByProject: Map<string, (typeof projectRoles.$inferSelect)[]>;
    envsByProject: Map<string, (typeof environments.$inferSelect)[]>;
    reposByProject: Map<string, (typeof repositories.$inferSelect)[]>;
    credsByProject: Map<string, (typeof repositoryCredentials.$inferSelect)[]>;
    tasksByProject: Map<string, (typeof tasks.$inferSelect)[]>;
    budgetsByProject: Map<string, (typeof budgetConfigs.$inferSelect)[]>;
    costsByProject: Map<string, (typeof costRecords.$inferSelect)[]>;
    approvalsByProject: Map<string, (typeof approvalTickets.$inferSelect)[]>;
    userRoleMap: Map<string, string>;
  },
  todayIso: string,
): OverviewItem {
  const settings = normalizeProjectSettings(project.settings) ?? {};
  const members = dependencies.membersByProject.get(project.id) || [];
  const environmentsForProject = dependencies.envsByProject.get(project.id) || [];
  const repositoriesForProject = dependencies.reposByProject.get(project.id) || [];
  const credentialsForProject = dependencies.credsByProject.get(project.id) || [];
  const tasksForProject = dependencies.tasksByProject.get(project.id) || [];
  const budgetsForProject = dependencies.budgetsByProject.get(project.id) || [];
  const costsForProject = dependencies.costsByProject.get(project.id) || [];
  const approvalsForProject = dependencies.approvalsByProject.get(project.id) || [];

  const hasEnv = environmentsForProject.length > 0;
  const hasRepo = repositoriesForProject.some((repository) => repository.status === "active");
  const hasCred = credentialsForProject.some((credential) => credential.status === "active");
  const hasMember = members.length > 0;
  const hasDefaultEnv = Boolean(settings.defaultEnvironmentId);
  const hasApprovalPolicy = Boolean(settings.approvalPolicy);
  const totalRequiredCount = 6;
  const completedCount = [
    hasEnv,
    hasRepo,
    hasCred,
    hasMember,
    hasDefaultEnv,
    hasApprovalPolicy,
  ].filter(Boolean).length;

  const { risks, budgetBlocking, hasExpiredDefault, hasActiveDefault } = buildProjectRisks({
    hasRepo,
    hasCred,
    hasDefaultEnv,
    hasApprovalPolicy,
    hasEnv,
    hasMember,
    budgets: budgetsForProject,
    costs: costsForProject,
    credentials: credentialsForProject,
    budgetMonthly: settings.budgetMonthly,
  });

  const projectStatus = deriveOverviewStatus(
    project,
    completedCount,
    totalRequiredCount,
    budgetBlocking,
    hasExpiredDefault,
    hasActiveDefault,
  );

  const currentUserRole = hasGlobalProjectAccess(user)
    ? dependencies.userRoleMap.get(project.id) || "org_admin"
    : dependencies.userRoleMap.get(project.id) || null;

  return {
    id: project.id,
    orgId: project.orgId,
    orgName: dependencies.orgMap.get(project.orgId)?.name || "",
    name: project.name,
    slug: project.slug,
    description: project.description,
    projectStatus,
    completedCount,
    totalRequiredCount,
    completionPercent: Math.round((completedCount / totalRequiredCount) * 100),
    risks,
    runningTasks: tasksForProject.filter((task) => task.status === "running").length,
    pendingApprovals: approvalsForProject.length,
    failedTasksToday: tasksForProject.filter(
      (task) => task.status === "failed" && task.finishedAt && task.finishedAt >= todayIso,
    ).length,
    lastActivityAt: getProjectLastActivity(project, tasksForProject),
    memberCount: members.length,
    repositoryCount: repositoriesForProject.filter((repository) => repository.status === "active")
      .length,
    environmentCount: environmentsForProject.length,
    currentUserRole,
    isCurrentUserManager:
      hasGlobalProjectAccess(user) || dependencies.userRoleMap.get(project.id) === "project_admin",
    createdAt: project.createdAt,
  };
}

function filterAndSortOverviewItems(items: OverviewItem[], params: OverviewQueryParams) {
  let filtered = items;

  if (params.statusFilter) {
    filtered = filtered.filter((item) => item.projectStatus === params.statusFilter);
  }

  if (params.configStatusFilter === "configured") {
    filtered = filtered.filter(
      (item) => item.completedCount >= item.totalRequiredCount && item.risks.length === 0,
    );
  }

  if (params.configStatusFilter === "pending") {
    filtered = filtered.filter((item) => item.completedCount < item.totalRequiredCount);
  }

  if (params.configStatusFilter === "risk") {
    filtered = filtered.filter((item) => item.risks.length > 0);
  }

  if (params.sortBy === "created_at_desc") {
    filtered.sort((left, right) => (right.createdAt || "").localeCompare(left.createdAt || ""));
  } else if (params.sortBy === "name_asc") {
    filtered.sort((left, right) => left.name.localeCompare(right.name));
  } else {
    filtered.sort((left, right) =>
      (right.lastActivityAt || "").localeCompare(left.lastActivityAt || ""),
    );
  }

  return filtered;
}

function paginateOverviewItems(items: OverviewItem[], page: number, pageSize: number) {
  const start = (page - 1) * pageSize;
  return items.slice(start, start + pageSize);
}

// GET /api/projects/overview
projectRoutes.get("/overview", async (c) => {
  const user = c.get("user");
  const params = parseOverviewParams(c);
  const visibleProjects = await getOverviewProjects(user, params);
  if (visibleProjects.length === 0) {
    return c.json(emptyOverviewResponse(params.page, params.pageSize));
  }

  const projectIds = visibleProjects.map((p) => p.id);
  const dependencies = await loadOverviewDependencies(projectIds);
  const userRoleMap = buildUserRoleMap(user.sub, dependencies.allMembers);

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayIso = todayStart.toISOString();
  const overviewItems = visibleProjects.map((project) =>
    buildOverviewItem(
      user,
      project,
      {
        orgMap: dependencies.orgMap,
        membersByProject: dependencies.membersByProject,
        envsByProject: dependencies.envsByProject,
        reposByProject: dependencies.reposByProject,
        credsByProject: dependencies.credsByProject,
        tasksByProject: dependencies.tasksByProject,
        budgetsByProject: dependencies.budgetsByProject,
        costsByProject: dependencies.costsByProject,
        approvalsByProject: dependencies.approvalsByProject,
        userRoleMap,
      },
      todayIso,
    ),
  );
  const filtered = filterAndSortOverviewItems(overviewItems, params);
  const summary = {
    totalProjects: filtered.length,
    pendingConfigCount: filtered.filter((i) => i.projectStatus === "pending_config").length,
    riskCount: filtered.filter((i) => i.risks.length > 0).length,
  };
  const total = filtered.length;
  const data = paginateOverviewItems(filtered, params.page, params.pageSize);

  return c.json({ data, page: params.page, pageSize: params.pageSize, total, summary });
});

// GET /api/projects?orgId=
projectRoutes.get("/", async (c) => {
  const user = c.get("user");
  const orgId = c.req.query("orgId");
  const result = await listVisibleProjects(user, orgId || undefined);
  return c.json(result.map((project) => normalizeProjectRecord(project)));
});

// POST /api/projects
projectRoutes.post(
  "/",
  requireRole("org_admin"),
  zValidator("json", createProjectSchema),
  async (c) => {
    const body = c.req.valid("json");
    const user = c.get("user");
    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString();

    // Verify org exists
    const org = await db.query.organizations.findFirst({
      where: eq(organizations.id, body.orgId),
    });
    if (!org) return c.json({ error: "Organization not found" }, 404);

    await db.insert(projects).values({
      id,
      orgId: body.orgId,
      name: body.name,
      slug: body.slug,
      description: body.description,
      settings: body.settings,
      createdAt,
    });

    await db.insert(projectRoles).values({
      id: crypto.randomUUID(),
      projectId: id,
      userId: user.sub,
      role: "project_admin",
    });

    return c.json({ id, ...body, createdAt }, 201);
  },
);

// GET /api/projects/:projectId/members
projectRoutes.get("/:projectId/members", requireProjectRole("projectId", "viewer"), async (c) => {
  const projectId = c.req.param("projectId");
  const project = await getProjectOrNull(projectId);
  if (!project) return c.json({ error: "Project not found" }, 404);

  const members = await db
    .select({
      userId: projectRoles.userId,
      projectId: projectRoles.projectId,
      role: projectRoles.role,
      username: users.username,
      displayName: users.displayName,
      globalRole: users.role,
      createdAt: users.createdAt,
    })
    .from(projectRoles)
    .innerJoin(users, eq(projectRoles.userId, users.id))
    .where(eq(projectRoles.projectId, projectId));

  return c.json(members);
});

// GET /api/projects/:projectId/members/candidates
projectRoutes.get(
  "/:projectId/members/candidates",
  requireProjectRole("projectId", "project_admin"),
  async (c) => {
    const projectId = c.req.param("projectId");
    const project = await getProjectOrNull(projectId);
    if (!project) return c.json({ error: "Project not found" }, 404);

    const existingMembers = await db.query.projectRoles.findMany({
      where: eq(projectRoles.projectId, projectId),
    });
    const existingUserIds = new Set(existingMembers.map((item) => item.userId));

    const allUsers = await db.query.users.findMany({
      columns: {
        id: true,
        username: true,
        displayName: true,
        role: true,
        createdAt: true,
        passwordHash: false,
      },
    });

    return c.json(allUsers.filter((user) => !existingUserIds.has(user.id)));
  },
);

// POST /api/projects/:projectId/members
projectRoutes.post(
  "/:projectId/members",
  requireProjectRole("projectId", "project_admin"),
  zValidator("json", addProjectMemberSchema),
  async (c) => {
    const projectId = c.req.param("projectId");
    const body = c.req.valid("json");

    const project = await getProjectOrNull(projectId);
    if (!project) return c.json({ error: "Project not found" }, 404);

    const user = await db.query.users.findFirst({
      where: eq(users.id, body.userId),
      columns: { passwordHash: false },
    });
    if (!user) return c.json({ error: "User not found" }, 404);

    const existing = await db.query.projectRoles.findFirst({
      where: and(eq(projectRoles.projectId, projectId), eq(projectRoles.userId, body.userId)),
    });
    if (existing) return c.json({ error: "User is already a project member" }, 409);

    await db.insert(projectRoles).values({
      id: crypto.randomUUID(),
      projectId,
      userId: body.userId,
      role: body.role,
    });

    return c.json(
      {
        userId: user.id,
        projectId,
        role: body.role,
        username: user.username,
        displayName: user.displayName,
        globalRole: user.role,
        createdAt: user.createdAt,
      },
      201,
    );
  },
);

// PATCH /api/projects/:projectId/members/:userId
projectRoutes.patch(
  "/:projectId/members/:userId",
  requireProjectRole("projectId", "project_admin"),
  zValidator("json", updateProjectMemberSchema),
  async (c) => {
    const projectId = c.req.param("projectId");
    const userId = c.req.param("userId");
    const body = c.req.valid("json");

    const existing = await db.query.projectRoles.findFirst({
      where: and(eq(projectRoles.projectId, projectId), eq(projectRoles.userId, userId)),
    });
    if (!existing) return c.json({ error: "Project member not found" }, 404);

    if (existing.role === "project_admin" && body.role !== "project_admin") {
      const admins = await listProjectAdmins(projectId);
      const adminCount = admins.filter((item) => item.role === "project_admin").length;
      if (adminCount <= 1) {
        return c.json({ error: "Project must retain at least one project_admin" }, 400);
      }
    }

    await db
      .update(projectRoles)
      .set({ role: body.role })
      .where(and(eq(projectRoles.projectId, projectId), eq(projectRoles.userId, userId)));

    return c.json({ userId, projectId, role: body.role });
  },
);

// DELETE /api/projects/:projectId/members/:userId
projectRoutes.delete(
  "/:projectId/members/:userId",
  requireProjectRole("projectId", "project_admin"),
  async (c) => {
    const projectId = c.req.param("projectId");
    const userId = c.req.param("userId");

    const existing = await db.query.projectRoles.findFirst({
      where: and(eq(projectRoles.projectId, projectId), eq(projectRoles.userId, userId)),
    });
    if (!existing) return c.json({ error: "Project member not found" }, 404);

    if (existing.role === "project_admin") {
      const admins = await listProjectAdmins(projectId);
      const adminCount = admins.filter((item) => item.role === "project_admin").length;
      if (adminCount <= 1) {
        return c.json({ error: "Project must retain at least one project_admin" }, 400);
      }
    }

    await db
      .delete(projectRoles)
      .where(and(eq(projectRoles.projectId, projectId), eq(projectRoles.userId, userId)));

    return c.json({ ok: true });
  },
);

// PATCH /api/projects/:projectId/archive
projectRoutes.patch(
  "/:projectId/archive",
  requireProjectRole("projectId", "project_admin"),
  async (c) => {
    const projectId = c.req.param("projectId");
    const user = c.get("user");

    const existing = await db.query.projects.findFirst({
      where: eq(projects.id, projectId),
    });
    if (!existing) return c.json({ error: "Project not found" }, 404);

    const now = new Date().toISOString();
    await db
      .update(projects)
      .set({ status: "archived", updatedAt: now })
      .where(eq(projects.id, projectId));

    await db.insert(auditEvents).values({
      id: crypto.randomUUID(),
      ts: now,
      userId: user.sub,
      projectId,
      eventType: "project.archived",
      action: "archive_project",
      target: projectId,
      detail: { previousStatus: (existing as { status?: string }).status || "active" },
    });

    return c.json({ ok: true, id: projectId, status: "archived" });
  },
);

// GET /api/projects/:projectId
projectRoutes.get("/:projectId", async (c) => {
  const projectId = c.req.param("projectId");
  const project = await getVisibleProjectOrNull(c.get("user"), projectId);
  if (!project) {
    return c.json({ error: "Project not found or access denied" }, 404);
  }
  return c.json(normalizeProjectRecord(project));
});

// GET /api/projects/:projectId/workflow-template
projectRoutes.get(
  "/:projectId/workflow-template",
  requireProjectRole("projectId", "viewer"),
  async (c) => {
    const projectId = c.req.param("projectId");
    const project = await getProjectOrNull(projectId);
    if (!project) {
      return c.json({ error: "Project not found" }, 404);
    }

    const settings = normalizeProjectSettings(project.settings) ?? {};
    const binding = await getWorkflowTemplateBinding(projectId, settings);

    return c.json({
      projectId,
      workflowTemplateId: binding.workflowTemplateId,
      template: binding.template,
    });
  },
);

// PUT /api/projects/:projectId/workflow-template
projectRoutes.put(
  "/:projectId/workflow-template",
  requireProjectRole("projectId", "project_admin"),
  zValidator("json", workflowTemplateBindingSchema),
  async (c) => {
    const projectId = c.req.param("projectId");
    const user = c.get("user");
    const body = c.req.valid("json");

    const project = await getProjectOrNull(projectId);
    if (!project) {
      return c.json({ error: "Project not found" }, 404);
    }

    let template = null;
    if (body.workflowTemplateId) {
      template = await db.query.workflowTemplates.findFirst({
        where: eq(workflowTemplates.id, body.workflowTemplateId),
      });

      if (!template) {
        return c.json({ error: "Workflow template not found" }, 404);
      }

      if (!template.enabled) {
        return c.json({ error: "Workflow template is disabled" }, 400);
      }

      const selectableForProject = template.selectableByProjects || template.projectId === projectId;
      if (!selectableForProject) {
        return c.json({ error: "Workflow template is not selectable for this project" }, 400);
      }
    }

    const existingSettings = normalizeProjectSettings(project.settings) ?? {};
    const nextSettings: ProjectSettings = { ...existingSettings };

    if (body.workflowTemplateId) {
      nextSettings.workflowTemplateId = body.workflowTemplateId;
    } else {
      delete nextSettings.workflowTemplateId;
    }

    const now = new Date().toISOString();
    await db
      .update(projects)
      .set({
        settings: nextSettings,
        updatedAt: now,
      })
      .where(eq(projects.id, projectId));

    await db.insert(auditEvents).values({
      id: crypto.randomUUID(),
      ts: now,
      userId: user.sub,
      projectId,
      eventType: "project.workflow_template.updated",
      action: "bind_workflow_template",
      target: projectId,
      detail: {
        workflowTemplateId: body.workflowTemplateId,
      },
    });

    return c.json({
      projectId,
      workflowTemplateId: body.workflowTemplateId,
      template,
    });
  },
);

// PATCH /api/projects/:projectId
projectRoutes.patch(
  "/:projectId",
  requireProjectRole("projectId", "project_admin"),
  zValidator("json", updateProjectSchema),
  async (c) => {
    const projectId = c.req.param("projectId");
    const body = c.req.valid("json");

    const existing = await db.query.projects.findFirst({
      where: eq(projects.id, projectId),
    });
    if (!existing) return c.json({ error: "Project not found" }, 404);

    const existingSettings = normalizeProjectSettings(existing.settings) ?? {};
    const nextSettings = body.settings
      ? { ...existingSettings, ...body.settings }
      : existingSettings;

    await db
      .update(projects)
      .set({
        ...(body.name && { name: body.name }),
        ...(body.description !== undefined && { description: body.description }),
        ...(body.settings && { settings: nextSettings }),
        updatedAt: new Date().toISOString(),
      })
      .where(eq(projects.id, projectId));

    return c.json(
      normalizeProjectRecord({
        ...existing,
        ...body,
        id: projectId,
        settings: body.settings ? nextSettings : existingSettings,
      }),
    );
  },
);
