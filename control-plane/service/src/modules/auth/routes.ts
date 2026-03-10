import { zValidator } from "@hono/zod-validator";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { db } from "../../db";
import { organizations, projectRoles, projects, users } from "../../db/schema";
import { type AppEnv, authMiddleware, signJWT } from "../../middleware/auth";
import { validatePasswordPolicy } from "../shared/password-policy";

export const authRoutes = new Hono<AppEnv>();

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

const updateMeSchema = z
  .object({
    displayName: z.string().min(1).max(100).optional(),
    email: z.string().email().max(200).nullable().optional(),
    currentPassword: z.string().min(1).optional(),
    newPassword: z.string().min(8).optional(),
  })
  .refine((body) => !body.newPassword || !!body.currentPassword, {
    path: ["currentPassword"],
    message: "Current password is required when setting a new password",
  })
  .refine(
    (body) => {
      if (!body.newPassword) return true;
      return validatePasswordPolicy(body.newPassword).valid;
    },
    {
      path: ["newPassword"],
      message: "密码需包含大小写字母、数字和特殊字符",
    },
  );

async function buildUserProfile(userId: string) {
  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
  });

  if (!user) return null;

  const roles = await db.query.projectRoles.findMany({
    where: eq(projectRoles.userId, user.id),
  });

  const projectMemberships = await Promise.all(
    roles.map(async (membership) => {
      const project = await db.query.projects.findFirst({
        where: eq(projects.id, membership.projectId),
      });
      const organization = project
        ? await db.query.organizations.findFirst({
            where: eq(organizations.id, project.orgId),
          })
        : null;

      return {
        id: membership.projectId,
        role: membership.role,
        name: project?.name ?? membership.projectId,
        slug: project?.slug ?? membership.projectId,
        orgId: project?.orgId ?? null,
        orgName: organization?.name ?? null,
      };
    }),
  );

  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    email: user.email,
    role: user.role,
    accountStatus: user.accountStatus,
    mustChangePassword: user.mustChangePassword,
    lastLoginAt: user.lastLoginAt,
    createdAt: user.createdAt,
    projects: projectMemberships,
  };
}

const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000; // 15 minutes

// POST /api/auth/login
authRoutes.post("/login", zValidator("json", loginSchema), async (c) => {
  const { username, password } = c.req.valid("json");

  const user = await db.query.users.findFirst({
    where: eq(users.username, username),
  });

  if (!user) {
    return c.json({ error: "Invalid credentials" }, 401);
  }

  if (user.accountStatus !== "active") {
    return c.json({ error: "Account is disabled" }, 403);
  }

  // Check lockout
  if (user.lockedUntil) {
    const lockExpiry = new Date(user.lockedUntil).getTime();
    if (Date.now() < lockExpiry) {
      const remainMin = Math.ceil((lockExpiry - Date.now()) / 60000);
      return c.json({ error: `账户已被临时锁定，请 ${remainMin} 分钟后重试` }, 429);
    }
    // Lockout expired — clear it
    await db
      .update(users)
      .set({ failedLoginAttempts: 0, lockedUntil: null })
      .where(eq(users.id, user.id));
  }

  // Verify password using Bun's built-in bcrypt-compatible hasher
  const isValid = await Bun.password.verify(password, user.passwordHash);
  if (!isValid) {
    const attempts = (user.failedLoginAttempts ?? 0) + 1;
    const lockUpdate: Record<string, unknown> = { failedLoginAttempts: attempts };
    if (attempts >= MAX_FAILED_ATTEMPTS) {
      lockUpdate.lockedUntil = new Date(Date.now() + LOCKOUT_DURATION_MS).toISOString();
    }
    await db.update(users).set(lockUpdate).where(eq(users.id, user.id));
    return c.json({ error: "Invalid credentials" }, 401);
  }

  // Fetch project roles
  const roles = await db.query.projectRoles.findMany({
    where: eq(projectRoles.userId, user.id),
  });

  const lastLoginAt = new Date().toISOString();
  await db
    .update(users)
    .set({ lastLoginAt, failedLoginAttempts: 0, lockedUntil: null })
    .where(eq(users.id, user.id));

  const token = await signJWT({
    sub: user.id,
    org: "", // populated when multi-org is enabled
    projects: roles.map((r) => ({ id: r.projectId, role: r.role })),
    role: user.role,
    tv: user.tokenVersion ?? 0,
  });

  return c.json({
    token,
    user: {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      email: user.email,
      role: user.role,
      accountStatus: user.accountStatus,
      mustChangePassword: user.mustChangePassword,
      lastLoginAt,
      createdAt: user.createdAt,
      projects: roles.map((r) => ({ id: r.projectId, role: r.role })),
    },
  });
});

// POST /api/auth/refresh
authRoutes.post("/refresh", authMiddleware, async (c) => {
  const user = c.get("user");
  const token = await signJWT(user);
  return c.json({ token });
});

// GET /api/auth/me
authRoutes.get("/me", authMiddleware, async (c) => {
  const payload = c.get("user");
  const user = await buildUserProfile(payload.sub);

  if (!user) {
    return c.json({ error: "User not found" }, 404);
  }

  return c.json(user);
});

// PATCH /api/auth/me
authRoutes.patch("/me", authMiddleware, zValidator("json", updateMeSchema), async (c) => {
  const payload = c.get("user");
  const body = c.req.valid("json");

  const existing = await db.query.users.findFirst({
    where: eq(users.id, payload.sub),
  });

  if (!existing) {
    return c.json({ error: "User not found" }, 404);
  }

  const updates: Record<string, unknown> = {};
  if (body.displayName !== undefined) updates.displayName = body.displayName;
  if (body.email !== undefined) updates.email = body.email;

  if (body.newPassword) {
    if (!body.currentPassword) {
      return c.json({ error: "Current password is required" }, 400);
    }

    const valid = await Bun.password.verify(body.currentPassword, existing.passwordHash);
    if (!valid) {
      return c.json({ error: "Current password is incorrect" }, 400);
    }

    updates.passwordHash = await Bun.password.hash(body.newPassword, {
      algorithm: "bcrypt",
      cost: 12,
    });
    updates.mustChangePassword = false;
    // Bump tokenVersion so all other sessions become invalid
    updates.tokenVersion = (existing.tokenVersion ?? 0) + 1;
  }

  if (Object.keys(updates).length > 0) {
    await db.update(users).set(updates).where(eq(users.id, payload.sub));
  }

  const user = await buildUserProfile(payload.sub);
  return c.json(user);
});
