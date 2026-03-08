import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { eq } from "drizzle-orm";
import * as schema from "./schema";

const DATABASE_URL = process.env.DATABASE_URL || "./data/openerx.db";

const sqlite = new Database(DATABASE_URL, { create: true });
sqlite.exec("PRAGMA journal_mode = WAL");
sqlite.exec("PRAGMA foreign_keys = ON");

const db = drizzle(sqlite, { schema });

async function seed() {
  console.log("Seeding database...");

  // ── 1. Default Organization ───────────────────────────────────
  const orgId = "org-default";
  const existingOrg = db.select().from(schema.organizations).where(eq(schema.organizations.id, orgId)).get();
  if (!existingOrg) {
    db.insert(schema.organizations).values({
      id: orgId,
      name: "OpenerX",
      slug: "openerx",
    }).run();
    console.log("  ✓ Created default organization: OpenerX");
  } else {
    console.log("  ○ Default organization already exists");
  }

  // ── 2. Default Project ────────────────────────────────────────
  const projectId = "proj-default";
  const existingProject = db.select().from(schema.projects).where(eq(schema.projects.id, projectId)).get();
  if (!existingProject) {
    db.insert(schema.projects).values({
      id: projectId,
      orgId,
      name: "Default Project",
      slug: "default",
      description: "Default OpenerX project",
      settings: { defaultModel: "anthropic/claude-sonnet-4-20250514", maxConcurrency: 5, budgetMonthly: 500 },
    }).run();
    console.log("  ✓ Created default project");
  } else {
    console.log("  ○ Default project already exists");
  }

  // ── 3. Environments ───────────────────────────────────────────
  const envs = [
    { id: "env-dev", projectId, name: "dev", riskLevel: "low" as const, requiresApproval: false },
    { id: "env-staging", projectId, name: "staging", riskLevel: "medium" as const, requiresApproval: false },
    { id: "env-production", projectId, name: "production", riskLevel: "critical" as const, requiresApproval: true },
  ];
  for (const env of envs) {
    const existing = db.select().from(schema.environments).where(eq(schema.environments.id, env.id)).get();
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
    db.insert(schema.users).values({
      id: adminId,
      username: adminUsername,
      passwordHash,
      displayName: "Admin",
      role: "platform_admin",
    }).run();
    console.log(`  ✓ Created admin user: ${adminUsername} / ${adminPassword}`);
  } else {
    console.log("  ○ Admin user already exists");
  }

  // ── 5. Admin Project Role ─────────────────────────────────────
  const roleId = "role-admin-default";
  const existingRole = db.select().from(schema.projectRoles).where(eq(schema.projectRoles.id, roleId)).get();
  if (!existingRole) {
    db.insert(schema.projectRoles).values({
      id: roleId,
      userId: adminId,
      projectId,
      role: "project_admin",
    }).run();
    console.log("  ✓ Assigned admin to default project");
  }

  // ── 6. Default Budget Config ──────────────────────────────────
  const budgetId = "budget-default";
  const existingBudget = db.select().from(schema.budgetConfigs).where(eq(schema.budgetConfigs.id, budgetId)).get();
  if (!existingBudget) {
    db.insert(schema.budgetConfigs).values({
      id: budgetId,
      projectId,
      period: "monthly",
      limitAmount: 500,
      warnThreshold: 0.8,
      throttleThreshold: 0.95,
    }).run();
    console.log("  ✓ Created default budget config ($500/month)");
  }

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
