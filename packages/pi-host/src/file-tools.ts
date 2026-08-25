import { randomUUID } from "node:crypto";
import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { PiFileToolRequestFrame } from "@openerx/contracts";
import { Type } from "@sinclair/typebox";

export interface PiFileToolTransport {
  request(frame: PiFileToolRequestFrame): Promise<unknown>;
}

export function createProductFileTools(input: {
  generationId: string;
  conversationId: string;
  transport: PiFileToolTransport;
}): ToolDefinition[] {
  const invoke = async (
    request: PiFileToolRequestFrame["request"],
  ): Promise<{ content: Array<{ type: "text"; text: string }>; details: unknown }> => {
    const result = await input.transport.request({
      kind: "pi.file-tool.request",
      requestId: randomUUID(),
      generationId: input.generationId,
      conversationId: input.conversationId,
      request,
    });
    return {
      content: [{ type: "text", text: JSON.stringify(result) }],
      details: result,
    };
  };

  return [
    defineTool({
      name: "openerx_file_list",
      label: "List attached files",
      description: "List files explicitly attached to this OpenerX conversation.",
      promptSnippet: "List the files attached to the current conversation.",
      parameters: Type.Object({}, { additionalProperties: false }),
      execute: async () => await invoke({ operation: "list", input: {} }),
    }),
    defineTool({
      name: "openerx_file_search",
      label: "Search attached files",
      description: "Search parsed attached files and return stable source citations.",
      promptSnippet: "Search attached files and cite page, sheet/range, slide, or text range.",
      parameters: Type.Object(
        { query: Type.String({ minLength: 1, maxLength: 500 }) },
        { additionalProperties: false },
      ),
      execute: async (_toolCallId, params) =>
        await invoke({ operation: "search", input: { query: params.query } }),
    }),
    defineTool({
      name: "openerx_file_read",
      label: "Read attached file",
      description: "Read parsed content and citations for one attached personal file.",
      promptSnippet: "Read one attached file by its personalFileId.",
      parameters: Type.Object(
        { personalFileId: Type.String({ format: "uuid" }) },
        { additionalProperties: false },
      ),
      execute: async (_toolCallId, params) =>
        await invoke({ operation: "read", input: { personalFileId: params.personalFileId } }),
    }),
    defineTool({
      name: "openerx_artifact_write",
      label: "Write artifact version",
      description:
        "Create a text-like artifact or append a new immutable version through the OpenerX Broker.",
      promptSnippet: "Create or version text, Markdown, code, JSON, YAML, CSV, or HTML artifacts.",
      promptGuidelines: [
        "Never overwrite an artifact. Pass artifactId to append a new immutable version.",
      ],
      parameters: Type.Object(
        {
          artifactId: Type.Optional(Type.String({ format: "uuid" })),
          displayName: Type.String({ minLength: 1, maxLength: 240 }),
          format: Type.Union(
            ["text", "markdown", "code", "json", "yaml", "csv", "html"].map((value) =>
              Type.Literal(value),
            ),
          ),
          mediaType: Type.String({ minLength: 1, maxLength: 200 }),
          content: Type.String({ maxLength: 5_000_000 }),
        },
        { additionalProperties: false },
      ),
      execute: async (_toolCallId, params) =>
        await invoke({
          operation: "artifact.write",
          input: {
            ...(params.artifactId ? { artifactId: params.artifactId } : {}),
            displayName: params.displayName,
            format: params.format,
            mediaType: params.mediaType,
            content: params.content,
          },
        }),
    }),
  ];
}
