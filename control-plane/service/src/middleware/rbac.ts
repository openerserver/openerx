import { createMiddleware } from "hono/factory";
import type { JWTPayload } from "./auth";

type Role = "platform_admin" | "org_admin" | "project_admin" | "developer" | "viewer";

const ROLE_HIERARCHY: Record<Role, number> = {
  platform_admin: 5,
  org_admin: 4,
  project_admin: 3,
  developer: 2,
  viewer: 1,
};

/**
 * Check if a user's role meets the minimum required role level.
 */
export function requireRole(minRole: Role) {
  return createMiddleware(async (c, next) => {
    const user = c.get("user") as JWTPayload | undefined;
    if (!user) {
      return c.json({ error: "Authentication required" }, 401);
    }

    const userLevel = ROLE_HIERARCHY[user.role as Role] ?? 0;
    const requiredLevel = ROLE_HIERARCHY[minRole];

    if (userLevel < requiredLevel) {
      return c.json(
        { error: "Insufficient permissions", required: minRole, current: user.role },
        403,
      );
    }

    await next();
  });
}

/**
 * Check if user has a specific role on a project (from JWT claims or global role).
 */
export function requireProjectRole(projectIdParam: string, minRole: Role) {
  return createMiddleware(async (c, next) => {
    const user = c.get("user") as JWTPayload | undefined;
    if (!user) {
      return c.json({ error: "Authentication required" }, 401);
    }

    // Platform/org admins bypass project-level checks
    const globalLevel = ROLE_HIERARCHY[user.role as Role] ?? 0;
    if (globalLevel >= ROLE_HIERARCHY.org_admin) {
      await next();
      return;
    }

    const projectId = c.req.param(projectIdParam);
    const projectRole = user.projects?.find((p) => p.id === projectId);

    if (!projectRole) {
      return c.json({ error: "No access to this project" }, 403);
    }

    const projectLevel = ROLE_HIERARCHY[projectRole.role as Role] ?? 0;
    const requiredLevel = ROLE_HIERARCHY[minRole];

    if (projectLevel < requiredLevel) {
      return c.json(
        { error: "Insufficient project permissions", required: minRole, current: projectRole.role },
        403,
      );
    }

    await next();
  });
}
