import { randomUUID } from "node:crypto";
import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { officeArtifactWriteInputSchema, type PiFileToolRequestFrame } from "@openerx/contracts";
import { Type } from "@sinclair/typebox";
import { desktopBrand } from "../../branding/src/index";
import { genericToolResult, officeArtifactToolResult } from "./tool-result";

const officeThemeParameters = Type.Optional(
  Type.Object(
    {
      accentColor: Type.Optional(Type.String({ pattern: "^#[A-Fa-f0-9]{6}$" })),
      backgroundColor: Type.Optional(Type.String({ pattern: "^#[A-Fa-f0-9]{6}$" })),
    },
    { additionalProperties: false },
  ),
);
const officePageParameters = Type.Object(
  {
    heading: Type.Optional(Type.String({ minLength: 1, maxLength: 300 })),
    paragraphs: Type.Optional(
      Type.Array(Type.String({ minLength: 1, maxLength: 2_000 }), { maxItems: 30 }),
    ),
    bullets: Type.Optional(
      Type.Array(Type.String({ minLength: 1, maxLength: 500 }), { maxItems: 20 }),
    ),
    footer: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
  },
  { additionalProperties: false },
);
const officeCellValueParameters = Type.Union([
  Type.String({ maxLength: 2_000 }),
  Type.Number(),
  Type.Boolean(),
  Type.Null(),
]);
const officeCellParameters = Type.Union([
  officeCellValueParameters,
  Type.Object(
    {
      value: officeCellValueParameters,
      formula: Type.Optional(Type.String({ minLength: 1, maxLength: 1_000 })),
    },
    { additionalProperties: false },
  ),
]);

export interface PiFileToolTransport {
  request(frame: PiFileToolRequestFrame): Promise<unknown>;
}

export function createProductFileTools(input: {
  generationId: string;
  conversationId: string;
  branchId: string;
  assistantMessageId: string;
  transport: PiFileToolTransport;
}): ToolDefinition[] {
  const request = async (
    piToolCallId: string,
    toolName: string,
    operation: PiFileToolRequestFrame["request"],
  ) =>
    await input.transport.request({
      kind: "pi.file-tool.request",
      requestId: randomUUID(),
      generationId: input.generationId,
      conversationId: input.conversationId,
      branchId: input.branchId,
      assistantMessageId: input.assistantMessageId,
      piToolCallId,
      toolName,
      request: operation,
    });
  const invoke = async (
    piToolCallId: string,
    toolName: string,
    operation: PiFileToolRequestFrame["request"],
  ) => genericToolResult(await request(piToolCallId, toolName, operation));

  return [
    defineTool({
      name: "openerx_file_list",
      label: "List attached files",
      description: `List files explicitly attached to this ${desktopBrand.productName} conversation.`,
      promptSnippet: "List the files attached to the current conversation.",
      parameters: Type.Object({}, { additionalProperties: false }),
      execute: async (toolCallId) =>
        await invoke(toolCallId, "openerx_file_list", { operation: "list", input: {} }),
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
        await invoke(_toolCallId, "openerx_file_search", {
          operation: "search",
          input: { query: params.query },
        }),
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
        await invoke(_toolCallId, "openerx_file_read", {
          operation: "read",
          input: { personalFileId: params.personalFileId },
        }),
    }),
    defineTool({
      name: "openerx_artifact_write",
      label: "Write artifact version",
      description: `Create a text-like artifact or append a new immutable version through the ${desktopBrand.productName} Broker.`,
      promptSnippet: "Create or version text, Markdown, code, JSON, YAML, CSV, or HTML artifacts.",
      promptGuidelines: [
        "Never overwrite an artifact. Pass artifactId to append a new immutable version.",
        "Set purpose to deliverable only for files the user should keep. Set it to intermediate for probes, scratch files, validation fixtures, drafts, and temporary fallbacks.",
        "Do not create ping or test artifacts to check tool availability. If an intermediate artifact is unavoidable, mark it intermediate.",
      ],
      parameters: Type.Object(
        {
          artifactId: Type.Optional(Type.String({ format: "uuid" })),
          displayName: Type.String({ minLength: 1, maxLength: 240 }),
          purpose: Type.Optional(
            Type.Union([Type.Literal("deliverable"), Type.Literal("intermediate")]),
          ),
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
        await invoke(_toolCallId, "openerx_artifact_write", {
          operation: "artifact.write",
          input: {
            ...(params.artifactId ? { artifactId: params.artifactId } : {}),
            displayName: params.displayName,
            purpose: params.purpose ?? "deliverable",
            format: params.format,
            mediaType: params.mediaType,
            content: params.content,
          },
        }),
    }),
    defineTool({
      name: "openerx_office_artifact",
      label: "Create or edit Office artifact",
      description:
        "Compile a bounded document, workbook, presentation, or PDF specification into a real binary ArtifactVersion with rendered visual-review surfaces.",
      promptSnippet:
        "Create DOCX, XLSX, PPTX, or PDF deliverables and inspect every returned page, sheet, or slide before reporting completion.",
      promptGuidelines: [
        "Use an existing artifactId to edit by appending a complete immutable version; never claim an in-place overwrite.",
        "Keep each requested page or slide within its bounded layout. If visual validation reports overflow, shorten or split the content and retry.",
        "Set purpose to deliverable only for the final files the user should keep. Mark probes, layout tests, scratch workbooks, and temporary fallbacks as intermediate.",
        "Do not create ping or test artifacts to check tool availability.",
      ],
      parameters: Type.Object(
        {
          artifactId: Type.Optional(Type.String({ format: "uuid" })),
          displayName: Type.String({ minLength: 1, maxLength: 240 }),
          purpose: Type.Optional(
            Type.Union([Type.Literal("deliverable"), Type.Literal("intermediate")]),
          ),
          spec: Type.Union([
            Type.Object(
              {
                format: Type.Literal("docx"),
                title: Type.String({ minLength: 1, maxLength: 300 }),
                pages: Type.Array(officePageParameters, { minItems: 1, maxItems: 100 }),
                theme: officeThemeParameters,
              },
              { additionalProperties: false },
            ),
            Type.Object(
              {
                format: Type.Literal("pdf"),
                title: Type.String({ minLength: 1, maxLength: 300 }),
                pages: Type.Array(officePageParameters, { minItems: 1, maxItems: 100 }),
                theme: officeThemeParameters,
              },
              { additionalProperties: false },
            ),
            Type.Object(
              {
                format: Type.Literal("xlsx"),
                title: Type.String({ minLength: 1, maxLength: 300 }),
                sheets: Type.Array(
                  Type.Object(
                    {
                      name: Type.String({ minLength: 1, maxLength: 31 }),
                      rows: Type.Array(Type.Array(officeCellParameters, { maxItems: 20 }), {
                        minItems: 1,
                        maxItems: 60,
                      }),
                      headerRows: Type.Optional(Type.Integer({ minimum: 0, maximum: 10 })),
                    },
                    { additionalProperties: false },
                  ),
                  { minItems: 1, maxItems: 50 },
                ),
                theme: officeThemeParameters,
              },
              { additionalProperties: false },
            ),
            Type.Object(
              {
                format: Type.Literal("pptx"),
                title: Type.String({ minLength: 1, maxLength: 300 }),
                slides: Type.Array(
                  Type.Object(
                    {
                      title: Type.String({ minLength: 1, maxLength: 300 }),
                      subtitle: Type.Optional(Type.String({ minLength: 1, maxLength: 500 })),
                      body: Type.Optional(Type.String({ minLength: 1, maxLength: 2_000 })),
                      bullets: Type.Optional(
                        Type.Array(Type.String({ minLength: 1, maxLength: 500 }), {
                          maxItems: 12,
                        }),
                      ),
                    },
                    { additionalProperties: false },
                  ),
                  { minItems: 1, maxItems: 100 },
                ),
                theme: officeThemeParameters,
              },
              { additionalProperties: false },
            ),
          ]),
        },
        { additionalProperties: false },
      ),
      execute: async (_toolCallId, params) => {
        const officeInput = officeArtifactWriteInputSchema.parse({
          ...(params.artifactId ? { artifactId: params.artifactId } : {}),
          displayName: params.displayName,
          purpose: params.purpose ?? "deliverable",
          spec: params.spec,
        });
        const result = await request(_toolCallId, "openerx_office_artifact", {
          operation: "artifact.office.write",
          input: officeInput,
        });
        return officeArtifactToolResult(result);
      },
    }),
  ];
}
