// ── Frontmatter Parser / Serializer ────────────────────────────────
// Handles YAML frontmatter in Markdown files (.agent.md, SKILL.md, commands)

import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

export interface ParsedFrontmatter {
  frontmatter: Record<string, unknown>;
  body: string;
}

export function parseFrontmatter(content: string): ParsedFrontmatter {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) {
    return { frontmatter: {}, body: content };
  }
  try {
    const rawFrontmatter = match[1] ?? "";
    const body = match[2] ?? "";
    const frontmatter = parseYaml(rawFrontmatter) as Record<string, unknown>;
    return { frontmatter, body };
  } catch {
    return { frontmatter: {}, body: content };
  }
}

export function serializeFrontmatter(frontmatter: Record<string, unknown>, body: string): string {
  const yamlStr = stringifyYaml(frontmatter).trimEnd();
  return `---\n${yamlStr}\n---\n${body}`;
}
