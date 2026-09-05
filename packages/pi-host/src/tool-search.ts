import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";

export interface ToolSearchController {
  active(): string[];
  activate(toolNames: string[]): void;
}

export function createProductToolSearch(
  tools: ToolDefinition[],
  controller: ToolSearchController,
): ToolDefinition {
  const searchable = tools.map((tool) => ({
    name: tool.name,
    label: tool.label,
    description: tool.description,
    searchable: `${tool.name} ${tool.label} ${tool.description}`.toLocaleLowerCase(),
  }));
  return defineTool({
    name: "openerx_tool_search",
    label: "Find tools",
    description: "Find and activate only the additional typed tools needed for the current task.",
    promptSnippet:
      "Search for additional tools when the currently active tools cannot perform the task.",
    parameters: Type.Object(
      { query: Type.String({ minLength: 1, maxLength: 500, description: "Needed capability" }) },
      { additionalProperties: false },
    ),
    execute: async (_toolCallId, params) => {
      const terms = params.query.toLocaleLowerCase().split(/\s+/u).filter(Boolean);
      const matches = searchable
        .map((tool) => ({
          ...tool,
          score: terms.reduce((score, term) => score + (tool.searchable.includes(term) ? 1 : 0), 0),
        }))
        .filter(({ score }) => score > 0)
        .sort((left, right) => right.score - left.score || left.name.localeCompare(right.name))
        .slice(0, 12);
      const current = controller.active();
      const added = matches.map(({ name }) => name).filter((name) => !current.includes(name));
      if (added.length > 0) controller.activate([...current, ...added]);
      const text =
        matches.length === 0
          ? "No matching tools are available in this Turn."
          : `Activated ${added.length} tool(s): ${matches.map(({ name }) => name).join(", ")}`;
      return { content: [{ type: "text", text }], details: { matches, added } };
    },
  });
}
