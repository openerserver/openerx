import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";

export const productPlanToolName = "openerx_update_plan";

export function createProductPlanTool(): ToolDefinition {
  return defineTool({
    name: productPlanToolName,
    label: "Update plan",
    description:
      "Publish or replace the current execution plan so the user can follow progress in the Run timeline.",
    promptSnippet:
      "For multi-step work, publish a short plan and keep each item status current as work progresses.",
    parameters: Type.Object(
      {
        explanation: Type.Optional(Type.String({ maxLength: 4_000 })),
        items: Type.Array(
          Type.Object(
            {
              text: Type.String({ minLength: 1, maxLength: 2_000 }),
              status: Type.Union([
                Type.Literal("pending"),
                Type.Literal("in_progress"),
                Type.Literal("completed"),
              ]),
            },
            { additionalProperties: false },
          ),
          { minItems: 1, maxItems: 100 },
        ),
      },
      { additionalProperties: false },
    ),
    execute: async (_toolCallId, params) => ({
      content: [
        {
          type: "text",
          text: `Plan updated: ${params.items.filter(({ status }) => status === "completed").length}/${params.items.length} completed.`,
        },
      ],
      details: params,
    }),
  });
}
