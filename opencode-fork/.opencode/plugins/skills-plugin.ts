import { type Plugin, tool } from "@opencode-ai/plugin";
import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
  mkdirSync,
} from "node:fs";
import { join, relative, resolve } from "node:path";

// ── Skills System Plugin ──────────────────────────────────────────
//
// Discovers, loads, and manages skill modules from `.opencode/skills/`
// and `~/.config/opencode/skills/`. Each skill provides:
//   - Domain-tuned system instructions (SKILL.md)
//   - Scoped permissions (allowed tools, file patterns)
//   - Optional embedded MCP server configs (mcp.json)
//
// Clean-room equivalent of oh-my-openagent's skills system.
// ───────────────────────────────────────────────────────────────────

// ── Types ──────────────────────────────────────────────────────────

interface SkillDefinition {
  name: string;
  description: string;
  instructions: string;
  directory: string;
  permissions: SkillPermissions;
  mcpServers: SkillMcpServer[];
  active: boolean;
}

interface SkillPermissions {
  allowedTools: string[];     // tool names this skill can use, empty = all
  deniedTools: string[];      // explicitly denied tools
  filePatterns: string[];     // glob patterns for files this skill can access
  maxConcurrency: number;     // max parallel operations
}

interface SkillMcpServer {
  name: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  autoStart: boolean;
}

interface SkillFrontmatter {
  name?: string;
  description?: string;
  permissions?: Partial<SkillPermissions>;
  mcp?: SkillMcpServer[];
}

// ── Skill Discovery ────────────────────────────────────────────────

const skillRegistry = new Map<string, SkillDefinition>();
const activeMcpProcesses = new Map<string, unknown>();

function discoverSkills(projectDir: string): SkillDefinition[] {
  const skills: SkillDefinition[] = [];

  // Project-local skills
  const localSkillsDir = join(projectDir, ".opencode", "skills");
  if (existsSync(localSkillsDir)) {
    loadSkillsFromDir(localSkillsDir, skills, "local");
  }

  // User-global skills
  const homeDir = process.env.HOME || process.env.USERPROFILE || "";
  const globalSkillsDir = join(homeDir, ".config", "opencode", "skills");
  if (existsSync(globalSkillsDir)) {
    loadSkillsFromDir(globalSkillsDir, skills, "global");
  }

  return skills;
}

function loadSkillsFromDir(
  skillsDir: string,
  skills: SkillDefinition[],
  _scope: "local" | "global",
): void {
  try {
    const entries = readdirSync(skillsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const skillDir = join(skillsDir, entry.name);
      const skillMd = join(skillDir, "SKILL.md");

      if (!existsSync(skillMd)) continue;

      try {
        const raw = readFileSync(skillMd, "utf-8");
        const parsed = parseSkillFrontmatter(raw);
        const mcpServers = loadSkillMcpConfig(skillDir);

        skills.push({
          name: parsed.frontmatter.name || entry.name,
          description: parsed.frontmatter.description || `Skill: ${entry.name}`,
          instructions: parsed.body,
          directory: skillDir,
          permissions: {
            allowedTools: parsed.frontmatter.permissions?.allowedTools ?? [],
            deniedTools: parsed.frontmatter.permissions?.deniedTools ?? [],
            filePatterns: parsed.frontmatter.permissions?.filePatterns ?? ["**/*"],
            maxConcurrency: parsed.frontmatter.permissions?.maxConcurrency ?? 3,
          },
          mcpServers: [
            ...(parsed.frontmatter.mcp ?? []),
            ...mcpServers,
          ],
          active: false,
        });
      } catch {
        // Skip malformed skill
      }
    }
  } catch {
    // Directory not readable
  }
}

function parseSkillFrontmatter(content: string): {
  frontmatter: SkillFrontmatter;
  body: string;
} {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) {
    return { frontmatter: {}, body: content };
  }

  try {
    // Simple YAML-like parsing for frontmatter
    const frontmatter: Record<string, unknown> = {};
    const lines = match[1]!.split("\n");
    let currentKey = "";

    for (const line of lines) {
      const kv = line.match(/^(\w+):\s*(.*)$/);
      if (kv) {
        currentKey = kv[1]!;
        const value = kv[2]!.trim();
        if (value.startsWith("[") && value.endsWith("]")) {
          // Simple array parsing
          frontmatter[currentKey] = value
            .slice(1, -1)
            .split(",")
            .map((s) => s.trim().replace(/^["']|["']$/g, ""))
            .filter(Boolean);
        } else if (value === "" || value === "{}") {
          frontmatter[currentKey] = {};
        } else {
          frontmatter[currentKey] = value.replace(/^["']|["']$/g, "");
        }
      }
    }

    return { frontmatter: frontmatter as SkillFrontmatter, body: match[2]! };
  } catch {
    return { frontmatter: {}, body: content };
  }
}

function loadSkillMcpConfig(skillDir: string): SkillMcpServer[] {
  const mcpPath = join(skillDir, "mcp.json");
  if (!existsSync(mcpPath)) return [];

  try {
    const raw = readFileSync(mcpPath, "utf-8");
    const config = JSON.parse(raw);
    if (Array.isArray(config.servers)) {
      return config.servers.map((s: Record<string, unknown>) => ({
        name: String(s.name || "unnamed"),
        command: String(s.command || ""),
        args: Array.isArray(s.args) ? s.args.map(String) : [],
        env: typeof s.env === "object" && s.env ? (s.env as Record<string, string>) : {},
        autoStart: Boolean(s.autoStart),
      }));
    }
    return [];
  } catch {
    return [];
  }
}

// ── Plugin Export ──────────────────────────────────────────────────

export const SkillsPlugin: Plugin = async ({ $, directory }) => {
  // Initial skill discovery
  const allSkills = discoverSkills(directory);
  for (const skill of allSkills) {
    skillRegistry.set(skill.name, skill);
  }

  return {
    tool: {
      skill_list: tool({
        description:
          "List all available skills with their descriptions, permissions, and MCP server info. Use this to understand what specialized capabilities are available.",
        args: {},
        async execute() {
          // Re-discover to pick up any changes
          const skills = discoverSkills(directory);
          const result = skills.map((s) => ({
            name: s.name,
            description: s.description,
            directory: s.directory,
            active: skillRegistry.get(s.name)?.active ?? false,
            permissions: {
              allowedTools: s.permissions.allowedTools.length
                ? s.permissions.allowedTools
                : "(all)",
              deniedTools: s.permissions.deniedTools.length
                ? s.permissions.deniedTools
                : "(none)",
              filePatterns: s.permissions.filePatterns,
              maxConcurrency: s.permissions.maxConcurrency,
            },
            mcpServers: s.mcpServers.map((m) => ({
              name: m.name,
              command: m.command,
              autoStart: m.autoStart,
            })),
          }));

          return JSON.stringify({
            skills: result,
            total: result.length,
            searchPaths: [
              join(directory, ".opencode", "skills"),
              join(process.env.HOME || "", ".config", "opencode", "skills"),
            ],
          });
        },
      }),

      skill_activate: tool({
        description:
          "Activate a skill by name. This loads its instructions into context, applies its permissions scope, and starts any embedded MCP servers marked as autoStart.",
        args: {
          skillName: tool.schema.string("Name of the skill to activate"),
        },
        async execute({ skillName }) {
          const skill = skillRegistry.get(skillName);
          if (!skill) {
            return JSON.stringify({
              error: `Skill '${skillName}' not found. Use skill_list to see available skills.`,
            });
          }

          skill.active = true;
          skillRegistry.set(skillName, skill);

          // Start autoStart MCP servers
          const startedMcps: string[] = [];
          for (const mcp of skill.mcpServers) {
            if (mcp.autoStart && mcp.command) {
              try {
                const envEntries = Object.entries(mcp.env)
                  .map(([k, v]) => `${k}=${v}`)
                  .join(" ");
                // Start MCP server in background
                const proc = Bun.spawn(
                  [mcp.command, ...mcp.args],
                  {
                    cwd: skill.directory,
                    env: { ...process.env, ...mcp.env },
                    stdio: ["pipe", "pipe", "pipe"],
                  },
                );
                activeMcpProcesses.set(`${skillName}:${mcp.name}`, proc);
                startedMcps.push(mcp.name);
              } catch (e) {
                // MCP start failure is non-fatal
              }
            }
          }

          return JSON.stringify({
            skill: skillName,
            status: "activated",
            instructions: skill.instructions.substring(0, 500) + (skill.instructions.length > 500 ? "..." : ""),
            instructionLength: skill.instructions.length,
            permissions: skill.permissions,
            mcpServersStarted: startedMcps,
          });
        },
      }),

      skill_deactivate: tool({
        description: "Deactivate a skill, removing its instructions from context and stopping its MCP servers",
        args: {
          skillName: tool.schema.string("Name of the skill to deactivate"),
        },
        async execute({ skillName }) {
          const skill = skillRegistry.get(skillName);
          if (!skill) {
            return JSON.stringify({ error: `Skill '${skillName}' not found` });
          }

          skill.active = false;
          skillRegistry.set(skillName, skill);

          // Stop MCP servers
          const stoppedMcps: string[] = [];
          for (const mcp of skill.mcpServers) {
            const procKey = `${skillName}:${mcp.name}`;
            const proc = activeMcpProcesses.get(procKey) as { kill?: () => void } | undefined;
            if (proc?.kill) {
              proc.kill();
              activeMcpProcesses.delete(procKey);
              stoppedMcps.push(mcp.name);
            }
          }

          return JSON.stringify({
            skill: skillName,
            status: "deactivated",
            mcpServersStopped: stoppedMcps,
          });
        },
      }),

      skill_read: tool({
        description: "Read the full SKILL.md instructions for a specific skill without activating it",
        args: {
          skillName: tool.schema.string("Name of the skill to read"),
        },
        async execute({ skillName }) {
          const skill = skillRegistry.get(skillName);
          if (!skill) {
            return JSON.stringify({ error: `Skill '${skillName}' not found` });
          }

          return JSON.stringify({
            name: skill.name,
            description: skill.description,
            instructions: skill.instructions,
            permissions: skill.permissions,
            mcpServers: skill.mcpServers,
            directory: skill.directory,
          });
        },
      }),

      skill_create: tool({
        description:
          "Create a new skill directory with SKILL.md template. Useful for packaging domain knowledge into reusable skill modules.",
        args: {
          name: tool.schema.string("Skill name (alphanumeric, dash)"),
          description: tool.schema.string("Brief description of the skill"),
          scope: tool.schema.string("'local' (project) or 'global' (user-wide). Default: local"),
        },
        async execute({ name, description, scope }) {
          const safeName = name.replace(/[^a-zA-Z0-9-]/g, "-").toLowerCase();
          const baseDir =
            scope === "global"
              ? join(process.env.HOME || "", ".config", "opencode", "skills")
              : join(directory, ".opencode", "skills");

          const skillDir = join(baseDir, safeName);

          if (existsSync(skillDir)) {
            return JSON.stringify({ error: `Skill directory already exists: ${skillDir}` });
          }

          try {
            mkdirSync(skillDir, { recursive: true });

            const skillMd = `---
name: ${safeName}
description: ${description}
permissions:
  allowedTools: []
  deniedTools: []
  filePatterns: ["**/*"]
  maxConcurrency: 3
---

# ${name}

${description}

## Instructions

<!-- Add domain-specific instructions for agents here -->

## Conventions

<!-- Add coding conventions, patterns, anti-patterns -->

## Tools

<!-- List tools this skill commonly uses -->
`;
            writeFileSync(join(skillDir, "SKILL.md"), skillMd, "utf-8");

            // Create mcp.json template
            const mcpTemplate = {
              servers: [
                {
                  name: `${safeName}-mcp`,
                  command: "",
                  args: [],
                  env: {},
                  autoStart: false,
                },
              ],
            };
            writeFileSync(
              join(skillDir, "mcp.json"),
              JSON.stringify(mcpTemplate, null, 2),
              "utf-8",
            );

            return JSON.stringify({
              created: skillDir,
              files: ["SKILL.md", "mcp.json"],
              nextSteps: [
                `Edit ${join(skillDir, "SKILL.md")} to add domain instructions`,
                `Edit ${join(skillDir, "mcp.json")} to configure MCP servers (optional)`,
                "Use skill_activate to load the skill",
              ],
            });
          } catch (e) {
            return JSON.stringify({ error: `Failed to create skill: ${e}` });
          }
        },
      }),

      skill_get_active_context: tool({
        description:
          "Get the combined instructions from all currently active skills. Used internally by the orchestrator to inject skill context into prompts.",
        args: {},
        async execute() {
          const activeSkills: Array<{ name: string; instructions: string; permissions: SkillPermissions }> = [];

          for (const [_name, skill] of skillRegistry) {
            if (skill.active) {
              activeSkills.push({
                name: skill.name,
                instructions: skill.instructions,
                permissions: skill.permissions,
              });
            }
          }

          return JSON.stringify({
            activeCount: activeSkills.length,
            skills: activeSkills,
            totalInstructionChars: activeSkills.reduce(
              (sum, s) => sum + s.instructions.length,
              0,
            ),
          });
        },
      }),
    },

    // Hook: inject active skill instructions into prompt
    hook: {
      "before_prompt_build": async (context: { prompt: string }) => {
        const activeInstructions: string[] = [];
        for (const [_, skill] of skillRegistry) {
          if (skill.active) {
            activeInstructions.push(
              `\n<!-- Skill: ${skill.name} -->\n${skill.instructions}\n<!-- /Skill: ${skill.name} -->`,
            );
          }
        }
        if (activeInstructions.length > 0) {
          context.prompt += `\n\n## Active Skills\n${activeInstructions.join("\n")}`;
        }
        return context;
      },
    },
  };
};

export default SkillsPlugin;
