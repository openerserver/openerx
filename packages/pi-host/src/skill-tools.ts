import { randomUUID } from "node:crypto";
import path from "node:path";
import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import {
  type PiSkillMount,
  type PiToolRequestFrame,
  skillScriptOutputSchema,
  type ToolOperation,
} from "@openerx/contracts";
import { Type } from "@sinclair/typebox";
import type { PiCapabilityToolTransport } from "./capability-tools";
import { productToolResult } from "./tool-result";

type SkillOperation = Extract<ToolOperation, { operation: "skill_read" | "skill_script_execute" }>;
type SkillOperationWithoutIdempotency = SkillOperation extends infer Operation
  ? Operation extends SkillOperation
    ? Omit<Operation, "idempotencyKey">
    : never
  : never;

function idempotencyKey(generationId: string, toolCallId: string, toolName: string): string {
  return `skill:${generationId}:${toolCallId}:${toolName}`;
}

function mountedResource(
  mounts: PiSkillMount[],
  requestedPath: string,
): { mount: PiSkillMount; relativePath: string } {
  const target = path.resolve(requestedPath);
  for (const mount of mounts) {
    const base = path.resolve(mount.baseDir);
    const relative = path.relative(base, target);
    if (relative && !relative.startsWith("..") && !path.isAbsolute(relative)) {
      return { mount, relativePath: relative.split(path.sep).join("/") };
    }
  }
  throw new Error("SKILL_RESOURCE_NOT_MOUNTED");
}

export function validateSkillMounts(
  profileDirectory: string,
  mounts: PiSkillMount[],
): PiSkillMount[] {
  const root = path.resolve(profileDirectory, "skill-packages");
  const names = new Set<string>();
  return mounts.map((mount) => {
    const baseDir = path.resolve(mount.baseDir);
    const relative = path.relative(root, baseDir);
    const segments = relative.split(path.sep);
    if (
      !relative ||
      relative.startsWith("..") ||
      path.isAbsolute(relative) ||
      segments[0] !== mount.installationId ||
      segments[1] !== "versions" ||
      segments.length !== 3
    ) {
      throw new Error("SKILL_MOUNT_SCOPE_VIOLATION");
    }
    if (names.has(mount.name)) throw new Error("SKILL_NAME_COLLISION");
    names.add(mount.name);
    return { ...mount, baseDir };
  });
}

export function createProductSkillTools(input: {
  generationId: string;
  conversationId: string;
  branchId: string;
  assistantMessageId: string;
  mounts: PiSkillMount[];
  transport: PiCapabilityToolTransport;
  binaryResourcesAvailable?: boolean;
  scriptOutputsAvailable?: boolean;
}): ToolDefinition[] {
  const invoke = async (
    toolCallId: string,
    toolName: string,
    operation: SkillOperationWithoutIdempotency,
  ) => {
    const frame: PiToolRequestFrame = {
      kind: "pi.tool.request",
      requestId: randomUUID(),
      generationId: input.generationId,
      conversationId: input.conversationId,
      branchId: input.branchId,
      assistantMessageId: input.assistantMessageId,
      piToolCallId: toolCallId,
      toolName,
      operation: {
        ...operation,
        idempotencyKey: idempotencyKey(input.generationId, toolCallId, toolName),
      } as SkillOperation,
    };
    const result = await input.transport.request(frame);
    return productToolResult(result);
  };

  return [
    defineTool({
      name: "read",
      label: "Read Skill resource",
      description: input.binaryResourcesAvailable
        ? "Read a mounted Skill instruction, reference, or Office/PDF/image template using its absolute path. Binary resources return a task file reference and parsed text; this does not establish image recognition or visual review."
        : "Read a mounted Skill instruction, reference, or text asset using the absolute path shown in the Skill metadata.",
      parameters: Type.Object(
        { path: Type.String({ minLength: 1, maxLength: 4_096 }) },
        { additionalProperties: false },
      ),
      execute: async (toolCallId, params) => {
        const resource = mountedResource(input.mounts, params.path);
        return await invoke(toolCallId, "read", {
          operation: "skill_read",
          installationId: resource.mount.installationId,
          relativePath: resource.relativePath,
        });
      },
    }),
    defineTool({
      name: "openerx_skill_script",
      label: "Run Skill script",
      description:
        "Execute a script declared by an enabled Skill through the openerx Capability Broker." +
        (input.scriptOutputsAvailable
          ? " Scripts can use package assets in their isolated copy. List generated files under outputs/ to save immutable artifacts; do not pass bytes/base64 through arguments or stdout. Existing Office content specs create new documents and do not preserve an external template's format."
          : ""),
      parameters: Type.Object(
        {
          skill: Type.String({ minLength: 1, maxLength: 64 }),
          script: Type.String({ minLength: 1, maxLength: 500 }),
          args: Type.Array(Type.String({ maxLength: 8_000 }), { maxItems: 200 }),
          timeoutMs: Type.Optional(Type.Integer({ minimum: 100, maximum: 1_800_000 })),
          allowNetwork: Type.Optional(Type.Boolean()),
          ...(input.scriptOutputsAvailable
            ? {
                outputs: Type.Optional(
                  Type.Array(
                    Type.Object(
                      {
                        relativePath: Type.String({
                          minLength: 1,
                          maxLength: 500,
                          description: "Relative generated file path beginning with outputs/.",
                        }),
                        displayName: Type.String({ minLength: 1, maxLength: 240 }),
                        purpose: Type.Optional(
                          Type.Union([Type.Literal("deliverable"), Type.Literal("intermediate")]),
                        ),
                        artifactId: Type.Optional(Type.String({ format: "uuid" })),
                      },
                      { additionalProperties: false },
                    ),
                    { minItems: 1, maxItems: 10 },
                  ),
                ),
              }
            : {}),
        },
        { additionalProperties: false },
      ),
      execute: async (toolCallId, params) => {
        if (params.outputs && !input.scriptOutputsAvailable)
          throw new Error("SKILL_OUTPUTS_NOT_AVAILABLE");
        const mount = input.mounts.find(({ name }) => name === params.skill);
        if (!mount) throw new Error("SKILL_NOT_MOUNTED");
        return await invoke(toolCallId, "openerx_skill_script", {
          operation: "skill_script_execute",
          installationId: mount.installationId,
          relativePath: params.script,
          args: params.args,
          timeoutMs: params.timeoutMs ?? 120_000,
          allowNetwork: params.allowNetwork ?? false,
          ...(params.outputs
            ? { outputs: skillScriptOutputSchema.array().min(1).max(10).parse(params.outputs) }
            : {}),
        });
      },
    }),
  ];
}
