import { zValidator } from "@hono/zod-validator";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { db } from "../../db";
import { users } from "../../db/schema";
import { authMiddleware } from "../../middleware/auth";
import { requireRole } from "../../middleware/rbac";

export const userRoutes = new Hono();

userRoutes.use("*", authMiddleware);

const createUserSchema = z.object({
  username: z
    .string()
    .min(3)
    .max(50)
    .regex(/^[a-zA-Z0-9_-]+$/),
  password: z.string().min(8),
  displayName: z.string().min(1).max(100),
  role: z
    .enum(["platform_admin", "org_admin", "project_admin", "developer", "viewer"])
    .default("developer"),
});

const updateUserSchema = z.object({
  displayName: z.string().min(1).max(100).optional(),
  password: z.string().min(8).optional(),
});

const setRoleSchema = z.object({
  role: z.enum(["platform_admin", "org_admin", "project_admin", "developer", "viewer"]),
});

// GET /api/users
userRoutes.get("/", requireRole("org_admin"), async (c) => {
  const result = await db.query.users.findMany({
    columns: { passwordHash: false },
  });
  return c.json(result);
});

// POST /api/users
userRoutes.post("/", requireRole("org_admin"), zValidator("json", createUserSchema), async (c) => {
  const body = c.req.valid("json");
  const id = crypto.randomUUID();

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
    role: body.role,
  });

  return c.json(
    { id, username: body.username, displayName: body.displayName, role: body.role },
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

    const existing = await db.query.users.findFirst({
      where: eq(users.id, userId),
    });
    if (!existing) return c.json({ error: "User not found" }, 404);

    const updateData: Record<string, unknown> = {};
    if (body.displayName) updateData.displayName = body.displayName;
    if (body.password) {
      updateData.passwordHash = await Bun.password.hash(body.password, {
        algorithm: "bcrypt",
        cost: 12,
      });
    }

    if (Object.keys(updateData).length > 0) {
      await db.update(users).set(updateData).where(eq(users.id, userId));
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

    const existing = await db.query.users.findFirst({
      where: eq(users.id, userId),
    });
    if (!existing) return c.json({ error: "User not found" }, 404);

    await db.update(users).set({ role }).where(eq(users.id, userId));

    return c.json({ id: userId, role });
  },
);
