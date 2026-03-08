import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "../../db";
import { users } from "../../db/schema";
import { signJWT, authMiddleware, verifyJWT } from "../../middleware/auth";

export const authRoutes = new Hono();

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

// POST /api/auth/login
authRoutes.post("/login", zValidator("json", loginSchema), async (c) => {
  const { username, password } = c.req.valid("json");

  const user = await db.query.users.findFirst({
    where: eq(users.username, username),
  });

  if (!user) {
    return c.json({ error: "Invalid credentials" }, 401);
  }

  // Verify password using Bun's built-in bcrypt-compatible hasher
  const isValid = await Bun.password.verify(password, user.passwordHash);
  if (!isValid) {
    return c.json({ error: "Invalid credentials" }, 401);
  }

  // Fetch project roles
  const roles = await db.query.projectRoles.findMany({
    where: eq(users.id, user.id),
  });

  const token = await signJWT({
    sub: user.id,
    org: "", // populated when multi-org is enabled
    projects: roles.map((r) => ({ id: r.projectId, role: r.role })),
    role: user.role,
  });

  return c.json({ token, user: { id: user.id, username: user.username, displayName: user.displayName, role: user.role } });
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
  const user = await db.query.users.findFirst({
    where: eq(users.id, payload.sub),
  });

  if (!user) {
    return c.json({ error: "User not found" }, 404);
  }

  return c.json({
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    role: user.role,
    createdAt: user.createdAt,
  });
});
