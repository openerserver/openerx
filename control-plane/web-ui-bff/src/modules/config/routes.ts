import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { basename, join, resolve } from "node:path";
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import { parseFrontmatter, serializeFrontmatter } from "../../lib/frontmatter";
import {
  readOrchestrationStrategy,
  writeOrchestrationStrategy,
} from "../../lib/orchestration-strategy";
import type { JWTPayload } from "../../middleware/auth";

// ── Types ──────────────────────────────────────────────────────────

type AppEnv = { Variables: { user: JWTPayload } };

// ── Path Resolution ────────────────────────────────────────────────

const OPENCODE_ROOT = resolve(
  process.env.OPENCODE_ROOT || join(__dirname, "../../../../../opencode-fork"),
);
const DOT_OPENCODE = join(OPENCODE_ROOT, ".opencode");
const OPENCODE_JSON = join(OPENCODE_ROOT, "opencode.json");
const OPENCODE_STATE_DIR = join(DOT_OPENCODE, "state");

/** Prevent path traversal — target must be under allowedRoot */
function safePath(allowedRoot: string, name: string): string | null {
  // Only allow simple names: alphanumeric, dash, underscore, dot — no slashes
  if (!/^[a-zA-Z0-9_.-]+$/.test(name)) return null;
  const target = resolve(allowedRoot, name);
  if (!target.startsWith(allowedRoot)) return null;
  return target;
}

// ── RBAC Helper ────────────────────────────────────────────────────

function requireSystemAdmin(user: JWTPayload): string | null {
  if (user.role === "platform_admin" || user.role === "org_admin" || user.role === "admin") {
    return null;
  }
  return "Requires org_admin role";
}

// ── Read opencode.json helper ──────────────────────────────────────

function readOpencodeJson(): Record<string, unknown> {
  return JSON.parse(readFileSync(OPENCODE_JSON, "utf-8"));
}

function writeOpencodeJson(data: Record<string, unknown>): void {
  // Validate it's valid JSON before writing
  const serialized = JSON.stringify(data, null, 2);
  JSON.parse(serialized); // will throw if malformed
  const backupPath = `${OPENCODE_JSON}.bak`;
  if (existsSync(OPENCODE_JSON)) copyFileSync(OPENCODE_JSON, backupPath);
  writeFileSync(OPENCODE_JSON, `${serialized}\n`, "utf-8");
}

// ── Routes ─────────────────────────────────────────────────────────

export const configRoutes = new Hono<AppEnv>();

// ═══════════════════════════════════════════════════════════════════
// AGENTS
// ═══════════════════════════════════════════════════════════════════

const agentsDir = join(DOT_OPENCODE, "agents");

configRoutes.get("/agents", (c) => {
  const adminErr = requireSystemAdmin(c.get("user"));
  if (adminErr) return c.json({ error: adminErr }, 403);
  if (!existsSync(agentsDir)) return c.json({ data: [] });
  const files = readdirSync(agentsDir).filter((f) => f.endsWith(".md"));
  const agents = files.map((f) => {
    const content = readFileSync(join(agentsDir, f), "utf-8");
    const { frontmatter } = parseFrontmatter(content);
    return {
      fileName: f,
      name: (frontmatter.name as string) || f.replace(".md", ""),
      description: (frontmatter.description as string) || "",
      model: (frontmatter.model as string) || "",
    };
  });
  return c.json({ data: agents });
});

configRoutes.get("/agents/:name", (c) => {
  const adminErr = requireSystemAdmin(c.get("user"));
  if (adminErr) return c.json({ error: adminErr }, 403);
  const name = c.req.param("name");
  const filePath = safePath(agentsDir, `${name}.md`);
  if (!filePath || !existsSync(filePath)) {
    return c.json({ error: "Agent not found" }, 404);
  }
  const content = readFileSync(filePath, "utf-8");
  const { frontmatter, body } = parseFrontmatter(content);
  return c.json({ data: { frontmatter, body, raw: content } });
});

configRoutes.put(
  "/agents/:name",
  zValidator(
    "json",
    z.object({
      frontmatter: z.record(z.unknown()),
      body: z.string(),
    }),
  ),
  (c) => {
    const adminErr = requireSystemAdmin(c.get("user"));
    if (adminErr) return c.json({ error: adminErr }, 403);

    const name = c.req.param("name");
    const filePath = safePath(agentsDir, `${name}.md`);
    if (!filePath) return c.json({ error: "Invalid agent name" }, 400);

    const { frontmatter, body } = c.req.valid("json");

    // Validate required fields
    if (!frontmatter.name || !frontmatter.description) {
      return c.json({ error: "frontmatter must have name and description" }, 400);
    }

    // Backup + write
    if (existsSync(filePath)) copyFileSync(filePath, `${filePath}.bak`);
    const content = serializeFrontmatter(frontmatter, body);
    writeFileSync(filePath, content, "utf-8");

    return c.json({ ok: true });
  },
);

// ═══════════════════════════════════════════════════════════════════
// SKILLS
// ═══════════════════════════════════════════════════════════════════

const skillsDir = join(DOT_OPENCODE, "skills");

configRoutes.get("/skills", (c) => {
  const adminErr = requireSystemAdmin(c.get("user"));
  if (adminErr) return c.json({ error: adminErr }, 403);
  if (!existsSync(skillsDir)) return c.json({ data: [] });
  const dirs = readdirSync(skillsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);

  const skills = dirs
    .map((dir) => {
      const mdPath = join(skillsDir, dir, "SKILL.md");
      if (!existsSync(mdPath)) return null;
      const content = readFileSync(mdPath, "utf-8");
      const { frontmatter } = parseFrontmatter(content);
      return {
        dirName: dir,
        name: (frontmatter.name as string) || dir,
        description: (frontmatter.description as string) || "",
        permissions: frontmatter.permissions || {},
      };
    })
    .filter(Boolean);

  return c.json({ data: skills });
});

configRoutes.get("/skills/:name", (c) => {
  const adminErr = requireSystemAdmin(c.get("user"));
  if (adminErr) return c.json({ error: adminErr }, 403);
  const name = c.req.param("name");
  const safe = safePath(skillsDir, name);
  if (!safe) return c.json({ error: "Invalid skill name" }, 400);
  const mdPath = join(safe, "SKILL.md");
  if (!existsSync(mdPath)) return c.json({ error: "Skill not found" }, 404);
  const content = readFileSync(mdPath, "utf-8");
  const { frontmatter, body } = parseFrontmatter(content);
  return c.json({ data: { frontmatter, body, raw: content } });
});

configRoutes.put(
  "/skills/:name",
  zValidator(
    "json",
    z.object({
      frontmatter: z.record(z.unknown()),
      body: z.string(),
    }),
  ),
  (c) => {
    const adminErr = requireSystemAdmin(c.get("user"));
    if (adminErr) return c.json({ error: adminErr }, 403);

    const name = c.req.param("name");
    const safe = safePath(skillsDir, name);
    if (!safe) return c.json({ error: "Invalid skill name" }, 400);
    const mdPath = join(safe, "SKILL.md");
    if (!existsSync(mdPath)) return c.json({ error: "Skill not found" }, 404);

    const { frontmatter, body } = c.req.valid("json");

    copyFileSync(mdPath, `${mdPath}.bak`);
    const content = serializeFrontmatter(frontmatter, body);
    writeFileSync(mdPath, content, "utf-8");

    return c.json({ ok: true });
  },
);

// ═══════════════════════════════════════════════════════════════════
// COMMANDS
// ═══════════════════════════════════════════════════════════════════

const commandsDir = join(DOT_OPENCODE, "commands");

configRoutes.get("/commands", (c) => {
  const adminErr = requireSystemAdmin(c.get("user"));
  if (adminErr) return c.json({ error: adminErr }, 403);
  if (!existsSync(commandsDir)) return c.json({ data: [] });
  const files = readdirSync(commandsDir).filter((f) => f.endsWith(".md"));
  const commands = files.map((f) => {
    const content = readFileSync(join(commandsDir, f), "utf-8");
    const { frontmatter } = parseFrontmatter(content);
    return {
      fileName: f,
      name: f.replace(".md", ""),
      description: (frontmatter.description as string) || "",
    };
  });
  return c.json({ data: commands });
});

configRoutes.get("/commands/:name", (c) => {
  const adminErr = requireSystemAdmin(c.get("user"));
  if (adminErr) return c.json({ error: adminErr }, 403);
  const name = c.req.param("name");
  const filePath = safePath(commandsDir, `${name}.md`);
  if (!filePath || !existsSync(filePath)) {
    return c.json({ error: "Command not found" }, 404);
  }
  const content = readFileSync(filePath, "utf-8");
  const { frontmatter, body } = parseFrontmatter(content);
  return c.json({ data: { frontmatter, body, raw: content } });
});

configRoutes.put(
  "/commands/:name",
  zValidator(
    "json",
    z.object({
      frontmatter: z.record(z.unknown()),
      body: z.string(),
    }),
  ),
  (c) => {
    const adminErr = requireSystemAdmin(c.get("user"));
    if (adminErr) return c.json({ error: adminErr }, 403);

    const name = c.req.param("name");
    const filePath = safePath(commandsDir, `${name}.md`);
    if (!filePath) return c.json({ error: "Invalid command name" }, 400);

    const { frontmatter, body } = c.req.valid("json");
    if (existsSync(filePath)) copyFileSync(filePath, `${filePath}.bak`);
    const content = serializeFrontmatter(frontmatter, body);
    writeFileSync(filePath, content, "utf-8");

    return c.json({ ok: true });
  },
);

// ═══════════════════════════════════════════════════════════════════
// MODELS (opencode.json → models + agents.defaults)
// ═══════════════════════════════════════════════════════════════════

configRoutes.get("/models", (c) => {
  const adminErr = requireSystemAdmin(c.get("user"));
  if (adminErr) return c.json({ error: adminErr }, 403);
  const config = readOpencodeJson();
  return c.json({
    data: {
      defaults: (config.agents as Record<string, unknown>)?.defaults || {},
      providers: (config.models as Record<string, unknown>)?.providers || {},
      list: (config.models as Record<string, unknown>)?.list || [],
    },
  });
});

// GET /config/models/list — model list only (available to all authenticated users)
configRoutes.get("/models/list", (c) => {
  const config = readOpencodeJson();
  return c.json({
    data: (config.models as Record<string, unknown>)?.list || [],
  });
});

// GET /config/models/available — list configured model IDs from opencode.json provider + model config
// Used for pre-flight validation before task execution
configRoutes.get("/models/available", (c) => {
  const config = readOpencodeJson();
  const providers = Object.keys((config.provider as Record<string, unknown>) || {});
  const modelList = ((config.models as Record<string, unknown>)?.list || []) as Array<
    Record<string, unknown>
  >;
  const modelIds = modelList.map((m) => (typeof m.id === "string" ? m.id : "")).filter(Boolean);
  const defaultModel = typeof config.model === "string" ? config.model : null;
  return c.json({ data: { providers, modelIds, defaultModel } });
});

configRoutes.put(
  "/models",
  zValidator(
    "json",
    z.object({
      defaults: z.record(z.unknown()),
      providers: z.record(z.unknown()),
      list: z.array(z.record(z.unknown())),
    }),
  ),
  (c) => {
    const adminErr = requireSystemAdmin(c.get("user"));
    if (adminErr) return c.json({ error: adminErr }, 403);

    const { defaults, providers, list } = c.req.valid("json");
    const config = readOpencodeJson();

    config.agents = { ...(config.agents as object), defaults };
    config.models = { providers, list };

    writeOpencodeJson(config);
    return c.json({ ok: true, restartRequired: true });
  },
);

// ═══════════════════════════════════════════════════════════════════
// MCP SERVERS (opencode.json → mcp)
// ═══════════════════════════════════════════════════════════════════

const MCP_COMMAND_ALLOWLIST = ["npx", "node", "bun", "deno", "python", "python3"];

configRoutes.get("/mcp", (c) => {
  const adminErr = requireSystemAdmin(c.get("user"));
  if (adminErr) return c.json({ error: adminErr }, 403);
  const config = readOpencodeJson();
  const mcp = (config.mcp as Record<string, unknown>) || {};
  return c.json({ data: mcp });
});

configRoutes.put(
  "/mcp",
  zValidator(
    "json",
    z.record(
      z.object({
        command: z.string(),
        args: z.array(z.string()).optional(),
        env: z.record(z.string()).optional(),
        description: z.string().optional(),
      }),
    ),
  ),
  (c) => {
    const adminErr = requireSystemAdmin(c.get("user"));
    if (adminErr) return c.json({ error: adminErr }, 403);

    const mcpData = c.req.valid("json");

    // Validate commands against allowlist
    for (const [name, server] of Object.entries(mcpData)) {
      if (!MCP_COMMAND_ALLOWLIST.includes(server.command)) {
        return c.json(
          {
            error: `MCP "${name}": command "${server.command}" not allowed. Allowed: ${MCP_COMMAND_ALLOWLIST.join(", ")}`,
          },
          400,
        );
      }
    }

    const config = readOpencodeJson();
    config.mcp = mcpData;
    writeOpencodeJson(config);

    return c.json({ ok: true, restartRequired: true });
  },
);

// ═══════════════════════════════════════════════════════════════════
// SECURITY BASELINE
// ═══════════════════════════════════════════════════════════════════

const SECURITY_MD = join(OPENCODE_ROOT, "SECURITY-BASELINE.md");

configRoutes.get("/security", (c) => {
  const adminErr = requireSystemAdmin(c.get("user"));
  if (adminErr) return c.json({ error: adminErr }, 403);
  if (!existsSync(SECURITY_MD)) return c.json({ data: { raw: "" } });
  const raw = readFileSync(SECURITY_MD, "utf-8");
  return c.json({ data: { raw } });
});

configRoutes.put("/security", zValidator("json", z.object({ raw: z.string() })), (c) => {
  const user = c.get("user");
  if (user.role !== "platform_admin" && user.role !== "org_admin" && user.role !== "admin") {
    return c.json({ error: "Requires org_admin role" }, 403);
  }

  const { raw } = c.req.valid("json");
  if (existsSync(SECURITY_MD)) copyFileSync(SECURITY_MD, `${SECURITY_MD}.bak`);
  writeFileSync(SECURITY_MD, raw, "utf-8");

  return c.json({ ok: true });
});

// ═══════════════════════════════════════════════════════════════════
// PLUGINS
// ═══════════════════════════════════════════════════════════════════

configRoutes.get("/plugins", (c) => {
  const adminErr = requireSystemAdmin(c.get("user"));
  if (adminErr) return c.json({ error: adminErr }, 403);
  const config = readOpencodeJson();
  const pluginPaths = (config.plugins as string[]) || [];
  const disabledPlugins = (config._disabledPlugins as string[]) || [];
  const plugins = pluginPaths.map((p) => {
    const fullPath = resolve(OPENCODE_ROOT, p);
    return {
      path: p,
      name: basename(p, ".ts"),
      exists: existsSync(fullPath),
      enabled: true,
    };
  });
  // Include disabled plugins
  for (const p of disabledPlugins) {
    const fullPath = resolve(OPENCODE_ROOT, p);
    plugins.push({
      path: p,
      name: basename(p, ".ts"),
      exists: existsSync(fullPath),
      enabled: false,
    });
  }
  return c.json({ data: plugins });
});

// POST /config/plugins/:name/disable — Move plugin from active to disabled
configRoutes.post("/plugins/:name/disable", (c) => {
  const adminErr = requireSystemAdmin(c.get("user"));
  if (adminErr) return c.json({ error: adminErr }, 403);
  const name = c.req.param("name") as string;

  const config = readOpencodeJson();
  const pluginPaths = (config.plugins as string[]) || [];
  const disabledPlugins = (config._disabledPlugins as string[]) || [];

  const idx = pluginPaths.findIndex((p) => basename(p, ".ts") === name);
  if (idx === -1) return c.json({ error: "Plugin not found in active list" }, 404);

  const removed = pluginPaths.splice(idx, 1)[0] as string;
  if (!disabledPlugins.includes(removed)) disabledPlugins.push(removed);

  config.plugins = pluginPaths;
  config._disabledPlugins = disabledPlugins;
  writeOpencodeJson(config);

  return c.json({ ok: true, name, enabled: false });
});

// POST /config/plugins/:name/enable — Move plugin from disabled to active
configRoutes.post("/plugins/:name/enable", (c) => {
  const adminErr = requireSystemAdmin(c.get("user"));
  if (adminErr) return c.json({ error: adminErr }, 403);
  const name = c.req.param("name") as string;

  const config = readOpencodeJson();
  const pluginPaths = (config.plugins as string[]) || [];
  const disabledPlugins = (config._disabledPlugins as string[]) || [];

  const idx = disabledPlugins.findIndex((p) => basename(p, ".ts") === name);
  if (idx === -1) return c.json({ error: "Plugin not found in disabled list" }, 404);

  const removed = disabledPlugins.splice(idx, 1)[0] as string;
  if (!pluginPaths.includes(removed)) pluginPaths.push(removed);

  config.plugins = pluginPaths;
  config._disabledPlugins = disabledPlugins;
  writeOpencodeJson(config);

  return c.json({ ok: true, name, enabled: true });
});

// ═══════════════════════════════════════════════════════════════════
// OVERVIEW — single call to get everything
// ═══════════════════════════════════════════════════════════════════

configRoutes.get("/overview", (c) => {
  const adminErr = requireSystemAdmin(c.get("user"));
  if (adminErr) return c.json({ error: adminErr }, 403);
  const config = readOpencodeJson();

  // Agents
  const agentFiles = existsSync(agentsDir)
    ? readdirSync(agentsDir).filter((f) => f.endsWith(".md"))
    : [];
  const agents = agentFiles.map((f) => {
    const { frontmatter } = parseFrontmatter(readFileSync(join(agentsDir, f), "utf-8"));
    return {
      fileName: f,
      name: (frontmatter.name as string) || f.replace(".md", ""),
      description: (frontmatter.description as string) || "",
      model: (frontmatter.model as string) || "",
    };
  });

  // Skills
  const skillDirs = existsSync(skillsDir)
    ? readdirSync(skillsDir, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name)
    : [];
  const skills = skillDirs
    .map((dir) => {
      const mdPath = join(skillsDir, dir, "SKILL.md");
      if (!existsSync(mdPath)) return null;
      const { frontmatter } = parseFrontmatter(readFileSync(mdPath, "utf-8"));
      return {
        dirName: dir,
        name: (frontmatter.name as string) || dir,
        description: (frontmatter.description as string) || "",
      };
    })
    .filter(Boolean);

  return c.json({
    data: {
      agents,
      skills,
      models: {
        defaults: (config.agents as Record<string, unknown>)?.defaults || {},
        list: (config.models as Record<string, unknown>)?.list || [],
      },
      mcp: config.mcp || {},
      plugins: [
        ...((config.plugins as string[]) || []).map((p) => ({
          path: p,
          name: basename(p, ".ts"),
          enabled: true,
        })),
        ...((config._disabledPlugins as string[]) || []).map((p) => ({
          path: p,
          name: basename(p, ".ts"),
          enabled: false,
        })),
      ],
    },
  });
});

// ═══════════════════════════════════════════════════════════════════
// ORCHESTRATION STRATEGY CONFIG
// ═══════════════════════════════════════════════════════════════════

configRoutes.get("/orchestration-strategy", (c) => {
  const adminErr = requireSystemAdmin(c.get("user"));
  if (adminErr) return c.json({ error: adminErr }, 403);
  return c.json({ data: readOrchestrationStrategy() });
});

const lifecycleHookSchema = z.object({
  id: z.string().min(1),
  trigger: z.enum(["pre-execution", "post-execution", "on-failure", "pre-resume"]),
  enabled: z.boolean(),
  agent: z.string(),
  model: z.string().optional(),
  promptTemplate: z.string().min(1),
  timeoutMs: z.number().int().positive(),
  order: z.number().int().min(0),
});

const workflowTemplateSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  mode: z.enum(["single", "parallel"]),
  agents: z.array(z.string()),
  maxParallelCandidates: z.number().int().min(1).max(5).optional(),
  enabled: z.boolean(),
  categoryDefaults: z.array(z.string()).optional(),
});

const judgeConfigSchema = z.object({
  enabled: z.boolean(),
  agent: z.string(),
  model: z.string(),
  promptTemplate: z.string().min(1),
  timeoutMs: z.number().int().positive(),
  selectionStrategy: z.enum(["judge-pick", "highest-score"]),
});

const strategySchema = z.object({
  categoryAgentMap: z.record(z.string(), z.array(z.string())),
  categoryModelMap: z.record(z.string(), z.string()),
  enablePipeline: z.boolean(),
  hooks: z.array(lifecycleHookSchema).optional(),
  templates: z.array(workflowTemplateSchema).optional(),
  judge: judgeConfigSchema.optional(),
});

configRoutes.put("/orchestration-strategy", zValidator("json", strategySchema), (c) => {
  const adminErr = requireSystemAdmin(c.get("user"));
  if (adminErr) return c.json({ error: adminErr }, 403);
  const body = c.req.valid("json");
  writeOrchestrationStrategy({
    ...body,
    hooks: body.hooks ?? [],
    templates: body.templates ?? [],
    judge: body.judge ?? {
      enabled: false,
      agent: "",
      model: "",
      promptTemplate: "",
      timeoutMs: 30000,
      selectionStrategy: "judge-pick" as const,
    },
  });
  return c.json({ ok: true });
});

// ═══════════════════════════════════════════════════════════════════
// PLUGIN LIFECYCLE — Install / Uninstall / Compatibility
// ═══════════════════════════════════════════════════════════════════

const pluginsDir = join(DOT_OPENCODE, "plugins");

// POST /config/plugins/install — Install plugin from local path or built-in template
const installPluginSchema = z.object({
  source: z.string().min(1).max(500),
  name: z.string().optional(),
});

configRoutes.post("/plugins/install", zValidator("json", installPluginSchema), (c) => {
  const adminErr = requireSystemAdmin(c.get("user"));
  if (adminErr) return c.json({ error: adminErr }, 403);
  const { source, name } = c.req.valid("json");

  // Resolve source path
  const sourcePath = resolve(OPENCODE_ROOT, source);
  if (!existsSync(sourcePath)) {
    return c.json({ error: `Source file not found: ${source}` }, 400);
  }

  // Ensure plugins directory exists
  if (!existsSync(pluginsDir)) mkdirSync(pluginsDir, { recursive: true });

  const fileName = name ? `${name}.ts` : basename(sourcePath);
  const targetKey = safePath(pluginsDir, fileName);
  if (!targetKey) return c.json({ error: "Invalid plugin name" }, 400);

  // Copy plugin file
  copyFileSync(sourcePath, targetKey);

  // Register in opencode.json
  const config = readOpencodeJson();
  const pluginPaths = (config.plugins as string[]) || [];
  const relativePath = `.opencode/plugins/${fileName}`;
  if (!pluginPaths.includes(relativePath)) {
    pluginPaths.push(relativePath);
    config.plugins = pluginPaths;
    writeOpencodeJson(config);
  }

  return c.json({ ok: true, name: basename(fileName, ".ts"), path: relativePath });
});

// POST /config/plugins/:name/uninstall — Remove plugin
configRoutes.post("/plugins/:name/uninstall", (c) => {
  const adminErr = requireSystemAdmin(c.get("user"));
  if (adminErr) return c.json({ error: adminErr }, 403);
  const name = c.req.param("name") as string;

  const config = readOpencodeJson();
  const pluginPaths = (config.plugins as string[]) || [];
  const disabledPlugins = (config._disabledPlugins as string[]) || [];

  // Find in active or disabled
  const activeIdx = pluginPaths.findIndex((p) => basename(p, ".ts") === name);
  const disabledIdx = disabledPlugins.findIndex((p) => basename(p, ".ts") === name);

  if (activeIdx === -1 && disabledIdx === -1) {
    return c.json({ error: "Plugin not found" }, 404);
  }

  if (activeIdx !== -1) pluginPaths.splice(activeIdx, 1);
  if (disabledIdx !== -1) disabledPlugins.splice(disabledIdx, 1);

  config.plugins = pluginPaths;
  config._disabledPlugins = disabledPlugins;
  writeOpencodeJson(config);

  return c.json({ ok: true, name });
});

// GET /config/plugins/compatibility — Check all plugins for basic compatibility
configRoutes.get("/plugins/compatibility", (c) => {
  const adminErr = requireSystemAdmin(c.get("user"));
  if (adminErr) return c.json({ error: adminErr }, 403);

  const config = readOpencodeJson();
  const allPaths = [
    ...((config.plugins as string[]) || []),
    ...((config._disabledPlugins as string[]) || []),
  ];

  const results = allPaths.map((p) => {
    const fullPath = resolve(OPENCODE_ROOT, p);
    const errors: string[] = [];

    if (!existsSync(fullPath)) {
      errors.push("File not found");
      return { name: basename(p, ".ts"), path: p, compatible: false, errors };
    }

    try {
      const content = readFileSync(fullPath, "utf-8");
      // Basic checks
      if (!content.includes("export default") && !content.includes("export function")) {
        errors.push("Missing export default or export function");
      }
      if (!content.includes("plugin") && !content.includes("Plugin")) {
        errors.push("No plugin-related exports found");
      }
    } catch (e) {
      errors.push(`Read error: ${e}`);
    }

    return {
      name: basename(p, ".ts"),
      path: p,
      compatible: errors.length === 0,
      errors,
    };
  });

  return c.json({ data: results });
});

// ═══════════════════════════════════════════════════════════════════
// CONTINUATION POLICY
// ═══════════════════════════════════════════════════════════════════

const POLICY_FILE = join(OPENCODE_STATE_DIR, "continuation-policy.json");

interface ContinuationPolicy {
  autoRetryOnFailure: boolean;
  maxRetries: number;
  retryableErrors: string[];
  requireApprovalOnRetry: boolean;
  fallbackModel: string;
  enableFallback: boolean;
}

const DEFAULT_POLICY: ContinuationPolicy = {
  autoRetryOnFailure: false,
  maxRetries: 2,
  retryableErrors: ["timeout", "rate_limit", "context_length"],
  requireApprovalOnRetry: true,
  fallbackModel: "",
  enableFallback: false,
};

function readPolicy(): ContinuationPolicy {
  if (!existsSync(POLICY_FILE)) return DEFAULT_POLICY;
  try {
    return JSON.parse(readFileSync(POLICY_FILE, "utf-8"));
  } catch {
    return DEFAULT_POLICY;
  }
}

function writePolicy(data: ContinuationPolicy): void {
  if (!existsSync(OPENCODE_STATE_DIR)) mkdirSync(OPENCODE_STATE_DIR, { recursive: true });
  writeFileSync(POLICY_FILE, JSON.stringify(data, null, 2), "utf-8");
}

configRoutes.get("/continuation-policy", (c) => {
  const adminErr = requireSystemAdmin(c.get("user"));
  if (adminErr) return c.json({ error: adminErr }, 403);
  return c.json({ data: readPolicy() });
});

const policySchema = z.object({
  autoRetryOnFailure: z.boolean(),
  maxRetries: z.number().int().min(0).max(10),
  retryableErrors: z.array(z.string()),
  requireApprovalOnRetry: z.boolean(),
  fallbackModel: z.string(),
  enableFallback: z.boolean(),
});

configRoutes.put("/continuation-policy", zValidator("json", policySchema), (c) => {
  const adminErr = requireSystemAdmin(c.get("user"));
  if (adminErr) return c.json({ error: adminErr }, 403);
  const body = c.req.valid("json");
  writePolicy(body);
  return c.json({ ok: true });
});

// ═══════════════════════════════════════════════════════════════════
// GITHUB COPILOT — OAuth Device Flow
// ═══════════════════════════════════════════════════════════════════

const COPILOT_CLIENT_ID = "Ov23li8tweQw6odWQebz";
const COPILOT_SCOPES = "read:user";
const GITHUB_DEVICE_CODE_URL = "https://github.com/login/device/code";
const GITHUB_ACCESS_TOKEN_URL = "https://github.com/login/oauth/access_token";
const COPILOT_MODELS_URL = "https://api.githubcopilot.com/models";
const COPILOT_TOKEN_FILE = join(OPENCODE_STATE_DIR, "copilot-token.json");

/** Sanitize provider suffix for use in filenames (alphanumeric and dashes only) */
function sanitizeCopilotSuffix(provider: string): string {
  return provider.replace(/[^a-zA-Z0-9-]/g, "");
}

function copilotTokenFile(provider = "github-copilot"): string {
  if (provider === "github-copilot") return COPILOT_TOKEN_FILE;
  return join(OPENCODE_STATE_DIR, `copilot-token-${sanitizeCopilotSuffix(provider)}.json`);
}

/** Read stored Copilot token (if any) */
function readCopilotToken(provider = "github-copilot"): { access_token?: string; login_at?: string } | null {
  const file = copilotTokenFile(provider);
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, "utf-8"));
  } catch {
    return null;
  }
}

function writeCopilotToken(data: Record<string, unknown>, provider = "github-copilot"): void {
  mkdirSync(OPENCODE_STATE_DIR, { recursive: true });
  writeFileSync(copilotTokenFile(provider), JSON.stringify(data, null, 2), { mode: 0o600 });
}

// Step 0: Check if we already have a token
configRoutes.get("/copilot/status", (c) => {
  const adminErr = requireSystemAdmin(c.get("user"));
  if (adminErr) return c.json({ error: adminErr }, 403);
  const provider = (c.req.query("provider") || "github-copilot");
  const token = readCopilotToken(provider);
  if (token?.access_token) {
    return c.json({ data: { authenticated: true, login_at: token.login_at || null } });
  }
  return c.json({ data: { authenticated: false } });
});

configRoutes.get("/copilot/models", async (c) => {
  const adminErr = requireSystemAdmin(c.get("user"));
  if (adminErr) return c.json({ error: adminErr }, 403);

  const provider = (c.req.query("provider") || "github-copilot");
  const token = readCopilotToken(provider);
  if (!token?.access_token) {
    return c.json({ error: "GitHub Copilot 未认证" }, 401);
  }

  const resp = await fetch(COPILOT_MODELS_URL, {
    headers: {
      Authorization: `Bearer ${token.access_token}`,
      Accept: "application/json",
    },
  });

  if (!resp.ok) {
    if (resp.status === 401) {
      return c.json({ error: "GitHub Copilot 认证已失效，请重新登录" }, 401);
    }
    const text = await resp.text();
    return c.json({ error: `Copilot models API error: ${resp.status} ${text}` }, 502);
  }

  const payload = (await resp.json()) as
    | {
        data?: Array<Record<string, unknown>>;
      }
    | Array<Record<string, unknown>>;

  const rawList = Array.isArray(payload) ? payload : payload.data || [];
  const models = rawList
    .map((item) => ({
      id: typeof item.id === "string" ? item.id : "",
      name: typeof item.name === "string" ? item.name : typeof item.id === "string" ? item.id : "",
      vendor: typeof item.vendor === "string" ? item.vendor : "",
      version: typeof item.version === "string" ? item.version : "",
      preview: Boolean(item.preview),
      contextWindow:
        typeof (
          item.capabilities as { limits?: { max_context_window_tokens?: unknown } } | undefined
        )?.limits?.max_context_window_tokens === "number"
          ? ((item.capabilities as { limits?: { max_context_window_tokens?: number } }).limits
              ?.max_context_window_tokens ?? null)
          : null,
      maxTokens:
        typeof (item.capabilities as { limits?: { max_output_tokens?: unknown } } | undefined)
          ?.limits?.max_output_tokens === "number"
          ? ((item.capabilities as { limits?: { max_output_tokens?: number } }).limits
              ?.max_output_tokens ?? null)
          : null,
    }))
    .filter((item) => item.id);

  return c.json({ data: models });
});

// Step 1: Request device code from GitHub
configRoutes.post("/copilot/device-code", async (c) => {
  const adminErr = requireSystemAdmin(c.get("user"));
  if (adminErr) return c.json({ error: adminErr }, 403);

  const resp = await fetch(GITHUB_DEVICE_CODE_URL, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      client_id: COPILOT_CLIENT_ID,
      scope: COPILOT_SCOPES,
    }),
  });

  if (!resp.ok) {
    const text = await resp.text();
    return c.json({ error: `GitHub API error: ${resp.status} ${text}` }, 502);
  }

  const data = (await resp.json()) as {
    device_code: string;
    user_code: string;
    verification_uri: string;
    expires_in: number;
    interval: number;
  };

  return c.json({
    data: {
      device_code: data.device_code,
      user_code: data.user_code,
      verification_uri: data.verification_uri,
      expires_in: data.expires_in,
      interval: data.interval,
    },
  });
});

// Step 2: Poll for access token
configRoutes.post(
  "/copilot/poll-token",
  zValidator("json", z.object({ device_code: z.string() })),
  async (c) => {
    const adminErr = requireSystemAdmin(c.get("user"));
    if (adminErr) return c.json({ error: adminErr }, 403);

    const { device_code } = c.req.valid("json");

    const resp = await fetch(GITHUB_ACCESS_TOKEN_URL, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        client_id: COPILOT_CLIENT_ID,
        device_code,
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      }),
    });

    if (!resp.ok) {
      return c.json({ error: `GitHub API error: ${resp.status}` }, 502);
    }

    const data = (await resp.json()) as {
      access_token?: string;
      token_type?: string;
      scope?: string;
      error?: string;
      error_description?: string;
      interval?: number;
    };

    if (data.error) {
      // "authorization_pending" or "slow_down" are expected during polling
      return c.json({
        data: {
          status: data.error as string,
          error_description: data.error_description,
          interval: data.interval,
        },
      });
    }

    if (data.access_token) {
      // Store token securely
      const provider = (c.req.query("provider") || "github-copilot");
      writeCopilotToken({
        access_token: data.access_token,
        token_type: data.token_type,
        scope: data.scope,
        login_at: new Date().toISOString(),
      }, provider);

      return c.json({
        data: { status: "success" },
      });
    }

    return c.json({ error: "Unexpected response from GitHub" }, 502);
  },
);

// Logout — remove stored token
configRoutes.post("/copilot/logout", (c) => {
  const adminErr = requireSystemAdmin(c.get("user"));
  if (adminErr) return c.json({ error: adminErr }, 403);

  const provider = (c.req.query("provider") || "github-copilot");
  const file = copilotTokenFile(provider);
  if (existsSync(file)) {
    writeFileSync(file, "{}", { mode: 0o600 });
  }
  return c.json({ ok: true });
});
