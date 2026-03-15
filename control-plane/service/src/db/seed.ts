import { Database } from "bun:sqlite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/bun-sqlite";
import * as schema from "./schema";
import { ensureRuntimeTables } from "./runtime-schema";
import { bootstrapDefaultRoleAgents } from "../modules/role-agents/bootstrap";

const DATABASE_URL = process.env.DATABASE_URL || "./data/openerx.db";

const sqlite = new Database(DATABASE_URL, { create: true });
sqlite.exec("PRAGMA journal_mode = WAL");
sqlite.exec("PRAGMA foreign_keys = ON");
ensureRuntimeTables(sqlite);

const db = drizzle(sqlite, { schema });
const BAD_TIMESTAMP_LITERAL = "(datetime('now'))";

function nowIso() {
  return new Date().toISOString();
}

function normalizeLegacyCreatedAt(tableName: string, columnName = "created_at") {
  sqlite
    .query(
      `UPDATE ${tableName} SET ${columnName} = ?1 WHERE ${columnName} = '${BAD_TIMESTAMP_LITERAL.replace(/'/g, "''")}'`,
    )
    .run(nowIso());
}

function defaultWorkflowTemplateDefinition() {
  const templateId = "workflow-template-default-delivery";
  return {
    template: {
      id: templateId,
      name: "默认研发交付模板",
      description: "覆盖澄清、设计、实现、验证和发布的标准研发阶段模板。",
      category: "delivery",
      enabled: true,
      selectableByProjects: true,
      stageOrderJson: ["clarify", "design", "implement", "verify", "release"],
      defaultRolesJson: [
        "role.product",
        "role.architect",
        "role.developer",
        "role.qa",
        "role.release",
        "role.security",
      ],
      version: 1,
    },
    stages: [
      {
        id: `${templateId}.clarify`,
        stageKey: "clarify",
        name: "需求澄清",
        enabled: true,
        mode: "single" as const,
        primaryRoleAgentId: "role.product",
        participantRoleAgentIdsJson: ["role.architect", "role.security"],
        orderIndex: 0,
      },
      {
        id: `${templateId}.design`,
        stageKey: "design",
        name: "方案设计",
        enabled: true,
        mode: "parallel" as const,
        primaryRoleAgentId: "role.architect",
        participantRoleAgentIdsJson: ["role.product", "role.security", "role.visual"],
        orderIndex: 1,
      },
      {
        id: `${templateId}.implement`,
        stageKey: "implement",
        name: "实现开发",
        enabled: true,
        mode: "single" as const,
        primaryRoleAgentId: "role.developer",
        participantRoleAgentIdsJson: ["role.security"],
        orderIndex: 2,
      },
      {
        id: `${templateId}.verify`,
        stageKey: "verify",
        name: "集成验证",
        enabled: true,
        mode: "parallel" as const,
        primaryRoleAgentId: "role.qa",
        participantRoleAgentIdsJson: ["role.developer", "role.security", "role.operations"],
        orderIndex: 3,
      },
      {
        id: `${templateId}.release`,
        stageKey: "release",
        name: "发布执行",
        enabled: true,
        mode: "single" as const,
        primaryRoleAgentId: "role.release",
        participantRoleAgentIdsJson: ["role.qa", "role.operations", "role.security"],
        orderIndex: 4,
      },
    ],
  };
}

function bootstrapDefaultWorkflowTemplate(projectId: string) {
  const now = nowIso();
  const definition = defaultWorkflowTemplateDefinition();

  const existingTemplate = db
    .select()
    .from(schema.workflowTemplates)
    .where(eq(schema.workflowTemplates.id, definition.template.id))
    .get();

  if (!existingTemplate) {
    db.insert(schema.workflowTemplates)
      .values({
        ...definition.template,
        projectId: null,
        createdBy: "system:seed",
        updatedBy: "system:seed",
        createdAt: now,
        updatedAt: now,
      })
      .run();
    console.log("  ✓ Created default workflow template");
  } else {
    console.log("  ○ Default workflow template already exists");
  }

  for (const stage of definition.stages) {
    const existingStage = db
      .select()
      .from(schema.workflowTemplateStages)
      .where(eq(schema.workflowTemplateStages.id, stage.id))
      .get();
    if (existingStage) {
      continue;
    }

    db.insert(schema.workflowTemplateStages)
      .values({
        ...stage,
        templateId: definition.template.id,
        roleExecutionPoliciesJson: null,
        entryCriteriaJson: null,
        exitCriteriaJson: null,
        hooksJson: null,
        gatesJson: null,
        approvalsJson: null,
        failurePolicyJson: null,
      })
      .run();
  }

  const existingProject = db
    .select()
    .from(schema.projects)
    .where(eq(schema.projects.id, projectId))
    .get();
  const projectSettings = (existingProject?.settings || {}) as schema.ProjectSettings;
  if (existingProject && !projectSettings.workflowTemplateId) {
    db.update(schema.projects)
      .set({
        settings: {
          ...projectSettings,
          workflowTemplateId: definition.template.id,
        },
        updatedAt: now,
      })
      .where(eq(schema.projects.id, projectId))
      .run();
    console.log("  ✓ Bound default workflow template to default project");
  }
}

async function seed() {
  console.log("Seeding database...");

  normalizeLegacyCreatedAt("organizations");
  normalizeLegacyCreatedAt("projects");
  normalizeLegacyCreatedAt("environments");
  normalizeLegacyCreatedAt("users");
  normalizeLegacyCreatedAt("policy_templates");
  normalizeLegacyCreatedAt("approval_tickets");
  normalizeLegacyCreatedAt("budget_configs");
  normalizeLegacyCreatedAt("tasks");
  normalizeLegacyCreatedAt("sessions", "started_at");
  normalizeLegacyCreatedAt("role_agents");
  normalizeLegacyCreatedAt("role_agent_bindings");
  normalizeLegacyCreatedAt("workflow_templates");
  normalizeLegacyCreatedAt("workflow_template_stages");

  // ── 1. Default Organization ───────────────────────────────────
  const orgId = "org-default";
  const existingOrg = db
    .select()
    .from(schema.organizations)
    .where(eq(schema.organizations.id, orgId))
    .get();
  if (!existingOrg) {
    db.insert(schema.organizations)
      .values({
        id: orgId,
        name: "OpenerX",
        slug: "openerx",
        createdAt: nowIso(),
      })
      .run();
    console.log("  ✓ Created default organization: OpenerX");
  } else {
    console.log("  ○ Default organization already exists");
  }

  // ── 2. Default Project ────────────────────────────────────────
  const projectId = "proj-default";
  const existingProject = db
    .select()
    .from(schema.projects)
    .where(eq(schema.projects.id, projectId))
    .get();
  if (!existingProject) {
    db.insert(schema.projects)
      .values({
        id: projectId,
        orgId,
        name: "Default Project",
        slug: "default",
        description: "Default OpenerX project",
        settings: {
          defaultModel: "anthropic/claude-sonnet-4-20250514",
          maxConcurrency: 5,
          budgetMonthly: 500,
        },
        createdAt: nowIso(),
      })
      .run();
    console.log("  ✓ Created default project");
  } else {
    console.log("  ○ Default project already exists");
  }

  // ── 3. Environments ───────────────────────────────────────────
  const envs = [
    {
      id: "env-dev",
      projectId,
      name: "dev",
      riskLevel: "low" as const,
      requiresApproval: false,
      createdAt: nowIso(),
    },
    {
      id: "env-staging",
      projectId,
      name: "staging",
      riskLevel: "medium" as const,
      requiresApproval: false,
      createdAt: nowIso(),
    },
    {
      id: "env-production",
      projectId,
      name: "production",
      riskLevel: "critical" as const,
      requiresApproval: true,
      createdAt: nowIso(),
    },
  ];
  for (const env of envs) {
    const existing = db
      .select()
      .from(schema.environments)
      .where(eq(schema.environments.id, env.id))
      .get();
    if (!existing) {
      db.insert(schema.environments).values(env).run();
      console.log(`  ✓ Created environment: ${env.name}`);
    }
  }

  // ── 4. Admin User ─────────────────────────────────────────────
  const adminUsername = process.env.ADMIN_USERNAME || "admin";
  const adminPassword = process.env.ADMIN_PASSWORD || "admin123!";
  const adminId = "user-admin";

  const existingAdmin = db.select().from(schema.users).where(eq(schema.users.id, adminId)).get();
  if (!existingAdmin) {
    const passwordHash = await Bun.password.hash(adminPassword, { algorithm: "bcrypt", cost: 12 });
    db.insert(schema.users)
      .values({
        id: adminId,
        username: adminUsername,
        passwordHash,
        displayName: "Admin",
        role: "platform_admin",
        createdAt: nowIso(),
      })
      .run();
    console.log(`  ✓ Created admin user: ${adminUsername} / ${adminPassword}`);
  } else {
    console.log("  ○ Admin user already exists");
  }

  // ── 5. Admin Project Role ─────────────────────────────────────
  const roleId = "role-admin-default";
  const existingRole = db
    .select()
    .from(schema.projectRoles)
    .where(eq(schema.projectRoles.id, roleId))
    .get();
  if (!existingRole) {
    db.insert(schema.projectRoles)
      .values({
        id: roleId,
        userId: adminId,
        projectId,
        role: "project_admin",
      })
      .run();
    console.log("  ✓ Assigned admin to default project");
  }

  // ── 6. Default Budget Config ──────────────────────────────────
  const budgetId = "budget-default";
  const existingBudget = db
    .select()
    .from(schema.budgetConfigs)
    .where(eq(schema.budgetConfigs.id, budgetId))
    .get();
  if (!existingBudget) {
    db.insert(schema.budgetConfigs)
      .values({
        id: budgetId,
        projectId,
        period: "monthly",
        limitAmount: 500,
        warnThreshold: 0.8,
        throttleThreshold: 0.95,
        createdAt: nowIso(),
      })
      .run();
    console.log("  ✓ Created default budget config ($500/month)");
  }

  // ── 7. Default Role Agents ───────────────────────────────────
  const roleBootstrap = await bootstrapDefaultRoleAgents(db, {
    applyBindings: true,
    overwriteUnmodifiedRecords: false,
  });
  console.log(
    `  ✓ Bootstrapped role agents (created: ${roleBootstrap.createdRoles.length}, updated: ${roleBootstrap.updatedRoles.length}, skipped: ${roleBootstrap.skippedRoles.length})`,
  );
  console.log(
    `  ✓ Bootstrapped role bindings (created: ${roleBootstrap.createdBindings.length}, updated: ${roleBootstrap.updatedBindings.length}, skipped: ${roleBootstrap.skippedBindings.length})`,
  );

  // ── 8. Default Workflow Template ─────────────────────────────
  bootstrapDefaultWorkflowTemplate(projectId);

  console.log("\nSeed complete! Login with:");
  console.log(`  Username: ${adminUsername}`);
  console.log(`  Password: ${adminPassword}`);
  console.log("\n⚠️  Change the admin password after first login!");

  sqlite.close();
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
