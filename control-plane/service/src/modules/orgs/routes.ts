import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "../../db";
import { organizations } from "../../db/schema";
import { authMiddleware } from "../../middleware/auth";
import { requireRole } from "../../middleware/rbac";

export const orgRoutes = new Hono();

orgRoutes.use("*", authMiddleware);

const createOrgSchema = z.object({
  name: z.string().min(1).max(100),
  slug: z.string().min(1).max(50).regex(/^[a-z0-9-]+$/),
});

// GET /api/orgs
orgRoutes.get("/", async (c) => {
  const orgs = await db.query.organizations.findMany();
  return c.json(orgs);
});

// POST /api/orgs
orgRoutes.post("/", requireRole("org_admin"), zValidator("json", createOrgSchema), async (c) => {
  const { name, slug } = c.req.valid("json");
  const id = crypto.randomUUID();

  await db.insert(organizations).values({ id, name, slug });

  return c.json({ id, name, slug }, 201);
});

// GET /api/orgs/:orgId
orgRoutes.get("/:orgId", async (c) => {
  const orgId = c.req.param("orgId");
  const org = await db.query.organizations.findFirst({
    where: eq(organizations.id, orgId),
  });

  if (!org) return c.json({ error: "Organization not found" }, 404);
  return c.json(org);
});
