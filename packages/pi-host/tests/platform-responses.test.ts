import { randomUUID } from "node:crypto";
import { type Message, normalizeContext } from "@earendil-works/pi-ai";
import {
  classifyModelError,
  type ModelCatalogEntry,
  type ModelGatewayRequestDto,
  type ModelGatewayResponse,
  modelGatewayRequestSchema,
  modelGatewayResponseSchema,
} from "@openerx/contracts";
import { Type } from "@sinclair/typebox";
import { describe, expect, it, vi } from "vitest";
import { decodePlatformState, projectPlatformContext } from "../src/platform-context";
import { createPlatformModelProvider } from "../src/platform-provider";

const model: ModelCatalogEntry = {
  modelRef: "platform/responses",
  displayName: "Responses",
  version: "1",
  capabilities: {
    textInput: true,
    imageInput: false,
    fileInput: false,
    functionCalling: true,
    structuredOutput: true,
  },
  contextWindow: 128000,
  maxOutputTokens: 4096,
  status: "available",
  priceRef: "test",
  priceSummary: "test",
  free: true,
  thinkingLevels: ["off", "high"],
};
const request = {
  accountId: randomUUID(),
  conversationId: randomUUID(),
  messageId: randomUUID(),
  selectedModelRef: model.modelRef,
  approvedFallbackModelRef: null,
  requestDedupeKey: "responses-contract",
};
function reply(
  r: ModelGatewayRequestDto,
  extra: Partial<ModelGatewayResponse> = {},
): ModelGatewayResponse {
  return modelGatewayResponseSchema.parse({
    text: "OK",
    effectiveModelRef: model.modelRef,
    fallbackReason: null,
    finishReason: "stop",
    usage: {
      usageId: randomUUID(),
      selectedModelRef: r.selectedModelRef,
      effectiveModelRef: model.modelRef,
      accountId: r.accountId,
      conversationId: r.conversationId,
      messageId: r.messageId,
      runId: null,
      toolCallId: null,
      inputTokens: 2,
      cachedInputTokens: 0,
      outputTokens: 1,
      reasoningTokens: 0,
      totalTokens: 3,
      providerReported: true,
      missingReasons: {},
      dedupeKey: r.requestDedupeKey,
      recordedAt: new Date().toISOString(),
    },
    ...extra,
  });
}

describe("Responses platform bridge", () => {
  it("persists native output items through Pi history and redacts their visible content consistently", async () => {
    const secret = 'C:\\private\\"draft".xlsx';
    const state = {
      signature: "route-signature",
      items: [
        { type: "reasoning", id: "rs_1", summary: [], encrypted_content: "opaque" },
        {
          type: "message",
          id: "msg_1",
          role: "assistant",
          status: "completed",
          content: [{ type: "output_text", text: secret, annotations: [] }],
        },
        {
          type: "function_call",
          id: "fc_1",
          call_id: "call_1",
          name: "inspect",
          arguments: JSON.stringify({ path: secret }),
          status: "completed",
        },
      ],
    };
    const execute = vi.fn(async (r: ModelGatewayRequestDto) =>
      reply(r, {
        text: secret,
        finishReason: "tool_calls",
        toolCalls: [{ id: "call_1", name: "inspect", arguments: { path: secret } }],
        providerState: state,
      }),
    );
    const platform = createPlatformModelProvider({
      catalog: [model],
      transport: { execute },
      request,
      contextRedactions: [{ value: secret, replacement: "workspace/report.xlsx" }],
    });
    const tools = [
      { name: "inspect", description: "Inspect", parameters: Type.Object({ path: Type.String() }) },
    ];
    const messages: Message[] = [{ role: "user", content: "Inspect", timestamp: 1 }];
    const first = await platform.provider
      .streamSimple(platform.model, normalizeContext({ messages, tools }), { reasoning: "high" })
      .result();
    expect(first.stopReason).toBe("toolUse");
    const stored = JSON.parse(JSON.stringify(first));
    const marker = stored.content.find((part: { type: string }) => part.type === "thinking");
    expect(marker).toMatchObject({ thinking: "", redacted: true });
    expect(decodePlatformState(marker.thinkingSignature)).toEqual(state);
    messages.push(stored, {
      role: "toolResult",
      toolCallId: "call_1",
      toolName: "inspect",
      content: [{ type: "text", text: "OK" }],
      isError: false,
      timestamp: 2,
    });
    await platform.provider
      .streamSimple(platform.model, normalizeContext({ messages, tools }), {
        reasoning: "high",
        toolChoice: "none",
      })
      .result();
    const wire = modelGatewayRequestSchema.parse(execute.mock.calls[1]![0]);
    expect(wire.responsesReplay).toBe(true);
    expect(wire.context).toMatchObject({
      messages: [
        { role: "user" },
        {
          role: "assistant",
          content: [
            { type: "text", text: "workspace/report.xlsx" },
            { type: "toolCall", arguments: { path: "workspace/report.xlsx" } },
          ],
          providerState: {
            signature: "route-signature",
            items: [
              { encrypted_content: "opaque" },
              { content: [{ text: "workspace/report.xlsx" }] },
              { arguments: JSON.stringify({ path: "workspace/report.xlsx" }) },
            ],
          },
        },
        { role: "toolResult", toolCallId: "call_1" },
      ],
    });
    expect(JSON.stringify(wire.context)).not.toContain("private");
    expect(JSON.stringify(wire.context)).not.toContain("thinkingSignature");
  });

  it("sends named tools and strict schema without dropping Pi's required constraint", async () => {
    const responseFormat = {
      type: "json_schema" as const,
      name: "answer",
      schema: { type: "object", properties: {}, additionalProperties: false, required: [] },
      strict: true,
    };
    const execute = vi.fn(async (r: ModelGatewayRequestDto) => reply(r));
    const platform = createPlatformModelProvider({
      catalog: [model],
      transport: { execute },
      request,
      responseFormat,
      toolChoice: { type: "function", name: "inspect" },
    });
    const context = {
      messages: [{ role: "user" as const, content: "Inspect", timestamp: 1 }],
      tools: [
        {
          name: "inspect",
          description: "Inspect",
          parameters: Type.Object({}, { additionalProperties: false }),
          constrainedSampling: { type: "json_schema" as const, strict: "require" as const },
        },
      ],
    };
    const first = await platform.provider
      .streamSimple(platform.model, normalizeContext(context))
      .result();
    expect(first.errorMessage).toBeUndefined();
    expect(execute.mock.calls[0]![0]).toMatchObject({
      responseFormat,
      toolChoice: { type: "function", name: "inspect" },
      requirements: { structuredOutput: true },
      context: { tools: [{ constrainedSampling: { type: "json_schema", strict: "require" } }] },
    });
    const plain = createPlatformModelProvider({
      catalog: [model],
      transport: { execute },
      request,
    });
    await plain.provider.streamSimple(plain.model, normalizeContext(context)).result();
    expect(execute.mock.calls[0]![0].requestDedupeKey).not.toBe(
      execute.mock.calls[1]![0].requestDedupeKey,
    );
    expect(() => projectPlatformContext(context, false)).toThrow("MODEL_CAPABILITY_UNSUPPORTED");
    expect(() =>
      createPlatformModelProvider({
        catalog: [{ ...model, capabilities: { ...model.capabilities, structuredOutput: false } }],
        transport: { execute },
        request,
        responseFormat,
      }),
    ).toThrow("MODEL_CAPABILITY_UNSUPPORTED");
  });

  it("keeps schema violations distinct and non-retryable", () => {
    expect(classifyModelError("MODEL_STRUCTURED_OUTPUT_INVALID")).toMatchObject({
      code: "MODEL_STRUCTURED_OUTPUT_INVALID",
      category: "response",
      retryable: false,
    });
  });
});
