import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
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
