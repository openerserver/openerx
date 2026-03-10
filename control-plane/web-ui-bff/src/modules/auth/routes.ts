import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import { cpFetch } from "../../lib/control-plane-client";

// ── Auth Routes (BFF) ──────────────────────────────────────────────
// Proxies authentication operations to the Control Plane service.
// These routes are NOT behind the authMiddleware (login is public).

export const authRoutes = new Hono();

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
  });

// POST /api/auth/login
authRoutes.post("/login", zValidator("json", loginSchema), async (c) => {
  const body = c.req.valid("json");
  const result = await cpFetch("/api/auth/login", {
    method: "POST",
    body,
  });
  return c.json(result.data, result.ok ? 200 : (result.status as 400 | 401 | 500));
});

// POST /api/auth/refresh  (requires existing token)
authRoutes.post("/refresh", async (c) => {
  const result = await cpFetch("/api/auth/refresh", {
    method: "POST",
    authorization: c.req.header("Authorization") || "",
  });
  return c.json(result.data, result.ok ? 200 : (result.status as 401 | 500));
});

// GET /api/auth/me  (requires existing token)
authRoutes.get("/me", async (c) => {
  const result = await cpFetch("/api/auth/me", {
    authorization: c.req.header("Authorization") || "",
  });
  return c.json(result.data, result.ok ? 200 : (result.status as 401 | 404 | 500));
});

// PATCH /api/auth/me
authRoutes.patch("/me", zValidator("json", updateMeSchema), async (c) => {
  const body = c.req.valid("json");
  const result = await cpFetch("/api/auth/me", {
    method: "PATCH",
    body,
    authorization: c.req.header("Authorization") || "",
  });
  return c.json(result.data, result.ok ? 200 : (result.status as 400 | 401 | 404 | 500));
});
