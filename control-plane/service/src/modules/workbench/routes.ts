import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { db } from "../../db";
import { workbenchLayouts } from "../../db/schema";
import { type AppEnv, authMiddleware } from "../../middleware/auth";

export const workbenchRoutes = new Hono<AppEnv>();

workbenchRoutes.use("*", authMiddleware);

// GET /api/workbench/layout — 获取当前用户的工作台布局
workbenchRoutes.get("/layout", async (c) => {
  const userId = c.get("user").sub;
  const row = await db.query.workbenchLayouts.findFirst({
    where: eq(workbenchLayouts.userId, userId),
  });
  const layout = row ? JSON.parse(row.layoutJson) : {};
  return c.json({ data: layout });
});

// PUT /api/workbench/layout — 保存当前用户的工作台布局
workbenchRoutes.put("/layout", async (c) => {
  const userId = c.get("user").sub;
  const body = await c.req.json();
  const layoutJson = JSON.stringify(body);
  const now = new Date().toISOString();

  await db
    .insert(workbenchLayouts)
    .values({ userId, layoutJson, updatedAt: now })
    .onConflictDoUpdate({
      target: workbenchLayouts.userId,
      set: { layoutJson, updatedAt: now },
    });

  return c.json({ ok: true });
});
