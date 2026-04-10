import { zValidator } from "@hono/zod-validator";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { db } from "../../db";
import { projectRoles, projects, users } from "../../db/schema";
import { type AppEnv, authMiddleware } from "../../middleware/auth";
import { requireRole } from "../../middleware/rbac";
import { recordAuditEvent } from "../audit/routes";
import { normalizeApiTimestampFields } from "../shared/api-timestamp";
import { validatePasswordPolicy } from "../shared/password-policy";

export const userRoutes = new Hono<AppEnv>();

userRoutes.use("*", authMiddleware);

const createUserSchema = z
  .object({
    username: z
      .string()
      .min(3)
      .max(50)
      .regex(/^[a-zA-Z0-9_-]+$/),
    password: z.string().min(8),
    displayName: z.string().min(1).max(100),
    email: z.string().email().max(200).nullable().optional(),
    mustChangePassword: z.boolean().default(false),
    role: z
      .enum(["platform_admin", "org_admin", "project_admin", "developer", "viewer"])
      .default("developer"),
  })
  .refine((body) => validatePasswordPolicy(body.password).valid, {
    path: ["password"],
    message: "密码需包含大小写字母、数字和特殊字符",
  });

const updateUserSchema = z.object({
  displayName: z.string().min(1).max(100).optional(),
  password: z.string().min(8).optional(),
  email: z.string().email().max(200).nullable().optional(),
});

const setRoleSchema = z.object({
  role: z.enum(["platform_admin", "org_admin", "project_admin", "developer", "viewer"]),
});

const setStatusSchema = z.object({
  status: z.enum(["active", "disabled"]),
});

const resetPasswordSchema = z
  .object({
    password: z.string().min(8),
    mustChangePassword: z.boolean().default(true),
  })
  .refine((body) => validatePasswordPolicy(body.password).valid, {
    path: ["password"],
    message: "密码需包含大小写字母、数字和特殊字符",
  });

function isPlatformAdminRole(role: string | null | undefined) {
  return role === "platform_admin";
}

// GET /api/users
userRoutes.get("/", requireRole("org_admin"), async (c) => {
  const allUsers = await db.query.users.findMany({
    columns: { passwordHash: false },
  });

  const memberships = await db
    .select({
      userId: projectRoles.userId,
      projectId: projectRoles.projectId,
      projectName: projects.name,
      projectRole: projectRoles.role,
    })
    .from(projectRoles)
    .innerJoin(projects, eq(projectRoles.projectId, projects.id));

  const membershipsByUser = new Map<
    string,
    Array<{ projectId: string; projectName: string; role: string }>
  >();
  for (const m of memberships) {
    const list = membershipsByUser.get(m.userId) ?? [];
    list.push({ projectId: m.projectId, projectName: m.projectName, role: m.projectRole });
    membershipsByUser.set(m.userId, list);
  }

  const result = allUsers.map((u) => ({
    ...normalizeApiTimestampFields(u, ["lockedUntil", "lastLoginAt", "createdAt"] as const),
    projects: membershipsByUser.get(u.id) ?? [],
  }));

  return c.json(result);
});

// POST /api/users
userRoutes.post("/", requireRole("org_admin"), zValidator("json", createUserSchema), async (c) => {
  const body = c.req.valid("json");
  const actor = c.get("user");
  const id = crypto.randomUUID();

  if (!isPlatformAdminRole(actor.role) && isPlatformAdminRole(body.role)) {
    return c.json({ error: "Only platform admins can create platform admin accounts" }, 403);
  }

  // Check for existing username
  const existing = await db.query.users.findFirst({
    where: eq(users.username, body.username),
  });
  if (existing) return c.json({ error: "Username already exists" }, 409);

  const passwordHash = await Bun.password.hash(body.password, { algorithm: "bcrypt", cost: 12 });

  await db.insert(users).values({
    id,
    username: body.username,
    passwordHash,
    displayName: body.displayName,
    email: body.email ?? null,
    role: body.role,
    accountStatus: "active",
    mustChangePassword: body.mustChangePassword,
  });

  await recordAuditEvent({
    userId: actor.sub,
    eventType: "user.created",
    action: "create_user",
    target: body.username,
    detail: { createdUserId: id, role: body.role, mustChangePassword: body.mustChangePassword },
    riskLevel: "medium",
  });

  return c.json(
    {
      id,
      username: body.username,
      displayName: body.displayName,
      email: body.email ?? null,
      role: body.role,
      accountStatus: "active",
      mustChangePassword: body.mustChangePassword,
    },
    201,
  );
});

// PATCH /api/users/:userId
userRoutes.patch(
  "/:userId",
  requireRole("org_admin"),
  zValidator("json", updateUserSchema),
  async (c) => {
    const userId = c.req.param("userId");
    const body = c.req.valid("json");
    const actor = c.get("user");

    const existing = await db.query.users.findFirst({
      where: eq(users.id, userId),
    });
    if (!existing) return c.json({ error: "User not found" }, 404);

    if (!isPlatformAdminRole(actor.role) && isPlatformAdminRole(existing.role)) {
      return c.json({ error: "Only platform admins can manage platform admin accounts" }, 403);
    }

    const updateData: Record<string, unknown> = {};
    if (body.displayName) updateData.displayName = body.displayName;
    if (body.email !== undefined) updateData.email = body.email;
    if (body.password) {
      updateData.passwordHash = await Bun.password.hash(body.password, {
        algorithm: "bcrypt",
        cost: 12,
      });
    }

    if (Object.keys(updateData).length > 0) {
      await db.update(users).set(updateData).where(eq(users.id, userId));
      await recordAuditEvent({
        userId: actor.sub,
        eventType: "user.updated",
        action: "update_user",
        target: existing.username,
        detail: { userId, fields: Object.keys(updateData) },
        riskLevel: "medium",
      });
    }

    return c.json({ id: userId, ...body });
  },
);

// PUT /api/users/:userId/role
userRoutes.put(
  "/:userId/role",
  requireRole("platform_admin"),
  zValidator("json", setRoleSchema),
  async (c) => {
    const userId = c.req.param("userId");
    const { role } = c.req.valid("json");
    const actor = c.get("user");

    if (actor.sub === userId) {
      return c.json({ error: "You cannot change your own role" }, 400);
    }

    const existing = await db.query.users.findFirst({
      where: eq(users.id, userId),
    });
    if (!existing) return c.json({ error: "User not found" }, 404);

    const oldRole = existing.role;
    await db.update(users).set({ role }).where(eq(users.id, userId));

    await recordAuditEvent({
      userId: actor.sub,
      eventType: "user.role_changed",
      action: "change_user_role",
      target: existing.username,
      detail: { targetUserId: userId, oldRole, newRole: role },
      riskLevel: "high",
    });

    return c.json({ id: userId, role });
  },
);

// PUT /api/users/:userId/status
userRoutes.put(
  "/:userId/status",
  requireRole("org_admin"),
  zValidator("json", setStatusSchema),
  async (c) => {
    const userId = c.req.param("userId");
    const { status } = c.req.valid("json");
    const actor = c.get("user");

    if (actor.sub === userId) {
      return c.json({ error: "You cannot change your own account status" }, 400);
    }

    const existing = await db.query.users.findFirst({
      where: eq(users.id, userId),
    });
    if (!existing) return c.json({ error: "User not found" }, 404);

    if (!isPlatformAdminRole(actor.role) && isPlatformAdminRole(existing.role)) {
      return c.json({ error: "Only platform admins can manage platform admin accounts" }, 403);
    }

    const statusUpdate: Record<string, unknown> = { accountStatus: status };
    // When disabling, bump tokenVersion to invalidate active sessions immediately
    if (status === "disabled") {
      statusUpdate.tokenVersion = (existing.tokenVersion ?? 0) + 1;
    }
    await db.update(users).set(statusUpdate).where(eq(users.id, userId));

    await recordAuditEvent({
      userId: actor.sub,
      eventType: `user.${status}`,
      action: "set_user_status",
      target: existing.username,
      detail: { userId, status },
      riskLevel: "high",
    });

    return c.json({ id: userId, accountStatus: status });
  },
);

// PUT /api/users/:userId/password
userRoutes.put(
  "/:userId/password",
  requireRole("org_admin"),
  zValidator("json", resetPasswordSchema),
  async (c) => {
    const userId = c.req.param("userId");
    const { password, mustChangePassword } = c.req.valid("json");
    const actor = c.get("user");

    const existing = await db.query.users.findFirst({
      where: eq(users.id, userId),
    });
    if (!existing) return c.json({ error: "User not found" }, 404);

    if (!isPlatformAdminRole(actor.role) && isPlatformAdminRole(existing.role)) {
      return c.json({ error: "Only platform admins can manage platform admin accounts" }, 403);
    }

    const passwordHash = await Bun.password.hash(password, {
      algorithm: "bcrypt",
      cost: 12,
    });

    await db
      .update(users)
      .set({ passwordHash, mustChangePassword, tokenVersion: (existing.tokenVersion ?? 0) + 1 })
      .where(eq(users.id, userId));

    await recordAuditEvent({
      userId: actor.sub,
      eventType: "user.password_reset",
      action: "reset_user_password",
      target: existing.username,
      detail: { targetUserId: userId, mustChangePassword },
      riskLevel: "high",
    });

    return c.json({ id: userId, mustChangePassword });
  },
);
