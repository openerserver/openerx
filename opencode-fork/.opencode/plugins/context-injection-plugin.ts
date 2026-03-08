import { type Plugin, tool } from "@opencode-ai/plugin";
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, relative, dirname } from "node:path";
import { parse as parseYaml } from "yaml";

// ── Types ──────────────────────────────────────────────────────────

interface ContextRule {
  filePath: string;
  applyTo: string; // glob pattern
  agents: string[]; // agent names this applies to, empty = all
  priority: number;
  content: string;
  directory: string; // the directory this AGENTS.md lives in
}

interface InjectionResult {
  injectedRules: number;
  totalChars: number;
  sources: string[];
}

// ── AGENTS.md Discovery ────────────────────────────────────────────

function discoverAgentsMd(projectDir: string): ContextRule[] {
  const rules: ContextRule[] = [];
  walkDirectory(projectDir, rules, projectDir);
  return rules.sort((a, b) => b.priority - a.priority);
}

function walkDirectory(
  dir: string,
  rules: ContextRule[],
  projectRoot: string,
  depth = 0,
): void {
  if (depth > 10) return; // prevent infinite recursion

  const agentsMdPath = join(dir, "AGENTS.md");
  if (existsSync(agentsMdPath)) {
    try {
      const raw = readFileSync(agentsMdPath, "utf-8");
      const parsed = parseFrontmatter(raw);
      rules.push({
        filePath: agentsMdPath,
        applyTo: parsed.frontmatter.applyTo ?? "**/*",
        agents: parsed.frontmatter.agents ?? [],
        priority: parsed.frontmatter.priority ?? (depth === 0 ? 100 : 50 - depth),
        content: parsed.body,
        directory: relative(projectRoot, dir) || ".",
      });
    } catch {
      // Skip malformed files
    }
  }

  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (
        entry.isDirectory() &&
        !entry.name.startsWith(".") &&
        !entry.name.startsWith("node_modules") &&
        entry.name !== "dist" &&
        entry.name !== ".git"
      ) {
        walkDirectory(join(dir, entry.name), rules, projectRoot, depth + 1);
      }
    }
  } catch {
    // Permission denied or other FS errors
  }
}

function parseFrontmatter(content: string): {
  frontmatter: Record<string, unknown>;
  body: string;
} {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) {
    return { frontmatter: {}, body: content };
  }
  try {
    const frontmatter = parseYaml(match[1]!) as Record<string, unknown>;
    return { frontmatter, body: match[2]! };
  } catch {
    return { frontmatter: {}, body: content };
  }
}

// ── Glob Matching (simplified) ─────────────────────────────────────

function matchGlob(pattern: string, filePath: string): boolean {
  if (pattern === "**/*" || pattern === "**") return true;

  // Convert glob to regex (simplified)
  const regexStr = pattern
    .replace(/\./g, "\\.")
    .replace(/\*\*/g, "<<GLOBSTAR>>")
    .replace(/\*/g, "[^/]*")
    .replace(/<<GLOBSTAR>>/g, ".*")
    .replace(/\?/g, ".");

  return new RegExp(`^${regexStr}$`).test(filePath);
}

// ── Context Builder ────────────────────────────────────────────────

function buildContextForAgent(
  rules: ContextRule[],
  agentName: string,
  currentFile?: string,
): { context: string; result: InjectionResult } {
  const applicableRules = rules.filter((rule) => {
    // Agent filter: empty means applies to all
    if (rule.agents.length > 0 && !rule.agents.includes(agentName)) {
      return false;
    }
    // File filter
    if (currentFile && !matchGlob(rule.applyTo, currentFile)) {
      return false;
    }
    return true;
  });

  const contextParts: string[] = [];
  const sources: string[] = [];

  for (const rule of applicableRules) {
    contextParts.push(
      `<!-- Context from ${rule.directory}/AGENTS.md (priority: ${rule.priority}) -->\n${rule.content}`,
    );
    sources.push(rule.filePath);
  }

  const context = contextParts.join("\n\n---\n\n");
  return {
    context,
    result: {
      injectedRules: applicableRules.length,
      totalChars: context.length,
      sources,
    },
  };
}

// ── Plugin Export ──────────────────────────────────────────────────

export const ContextInjectionPlugin: Plugin = async ({ directory }) => {
  // Cache rules, refresh on file changes
  let cachedRules: ContextRule[] | null = null;
  let lastRefresh = 0;
  const CACHE_TTL = 30_000; // 30 seconds

  function getRules(): ContextRule[] {
    const now = Date.now();
    if (!cachedRules || now - lastRefresh > CACHE_TTL) {
      cachedRules = discoverAgentsMd(directory);
      lastRefresh = now;
    }
    return cachedRules;
  }

  return {
    tool: {
      context_get_rules: tool({
        description: "List all discovered AGENTS.md context rules in the project",
        args: {},
        async execute() {
          const rules = getRules();
          return JSON.stringify(
            rules.map((r) => ({
              directory: r.directory,
              applyTo: r.applyTo,
              agents: r.agents,
              priority: r.priority,
              contentLength: r.content.length,
            })),
            null,
            2,
          );
        },
      }),

      context_for_agent: tool({
        description:
          "Get the assembled context for a specific agent, optionally filtered by current file",
        args: {
          agentName: tool.schema.string("Agent name to get context for"),
          currentFile: tool.schema.string(
            "Current file path being worked on (optional, for glob filtering)",
          ),
        },
        async execute({ agentName, currentFile }) {
          const rules = getRules();
          const { context, result } = buildContextForAgent(
            rules,
            agentName,
            currentFile,
          );
          return JSON.stringify(
            { ...result, context: context.substring(0, 10000) },
            null,
            2,
          );
        },
      }),

      context_refresh: tool({
        description: "Force refresh the AGENTS.md context rule cache",
        args: {},
        async execute() {
          cachedRules = null;
          const rules = getRules();
          return JSON.stringify({
            refreshed: true,
            rulesFound: rules.length,
          });
        },
      }),
    },

    // Inject context into system prompt for each agent session
    "before_prompt_build": async (input) => {
      const agentName = input.properties?.agentId;
      if (!agentName || typeof agentName !== "string") return;

      const rules = getRules();
      const { context, result } = buildContextForAgent(rules, agentName);

      if (result.injectedRules > 0) {
        console.log(
          `[context-injection] Injected ${result.injectedRules} rules (${result.totalChars} chars) for agent ${agentName}`,
        );
        // Context is available via tool call; system prompt injection would need
        // a return value mechanism specific to OpenCode's hook API
      }
    },

    // Invalidate cache when files change
    "file.edited": async () => {
      cachedRules = null;
    },

    "file.watcher.updated": async () => {
      cachedRules = null;
    },
  };
};

export default ContextInjectionPlugin;
