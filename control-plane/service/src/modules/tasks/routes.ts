import { Hono } from "hono";
import { type AppEnv, authMiddleware } from "../../middleware/auth";
import { requireRole } from "../../middleware/rbac";
import { registerTaskRouteModules } from "./task-route-modules";

export const taskRoutes = new Hono<AppEnv>();

taskRoutes.use("*", authMiddleware);
taskRoutes.use("*", requireRole("developer"));

registerTaskRouteModules(taskRoutes);
