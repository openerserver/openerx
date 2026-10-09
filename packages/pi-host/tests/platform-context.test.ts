import { randomUUID } from "node:crypto";
import { type AssistantMessage, type Context, normalizeContext } from "@earendil-works/pi-ai";
import type {
  ModelCatalogEntry,
  ModelGatewayRequestDto,
  ModelGatewayResponse,
} from "@openerx/contracts";
import { Type } from "@sinclair/typebox";
import { describe, expect, it, vi } from "vitest";
import { projectPlatformContext } from "../src/platform-context";
import { createPlatformModelProvider } from "../src/platform-provider";

const usage = {
  input: 1,
  output: 1,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 2,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};
const assistant: AssistantMessage = {
  role: "assistant",
  api: "openerx-platform",
  provider: "openerx-platform",
  model: "platform/test",
  content: [
    {
      type: "thinking",
      thinking: "Inspect first.",
      thinkingSignature: "same-route",
      redacted: false,
    },
    { type: "text", text: "Loading.", textSignature: "provider-private" },
    {
      type: "toolCall",
      id: "c1",
      name: "inspect",
      arguments: {},
      thoughtSignature: "private",
      namespace: "tools",
    },
  ],
  usage,
  stopReason: "toolUse",
  rawStopReason: "tool_calls",
  timestamp: 1,
  responseId: "response-1",
  providerThinkingLevel: "high",
  diagnostics: [],
  endTurn: false,
};
const context: Context = {
  systemPrompt: "System",
  tools: [{ name: "inspect", description: "Inspect", parameters: Type.Object({}) }],
  messages: [
    { role: "user", content: "Inspect", timestamp: 0 },
    assistant,
    {
      role: "toolResult",
      toolCallId: "c1",
      toolName: "inspect",
      content: [{ type: "text", text: "OK" }],
      details: { privateUIState: "secret" },
      usage,
      isError: false,
      timestamp: 2,
    },
  ],
};

describe("stable platform context", () => {
  it("strips session metadata without losing reasoning state, empty arguments or tool results", () => {
    const before = JSON.stringify(context);
    const wire = projectPlatformContext(context);
    expect(wire.messages[1]).toEqual({
      role: "assistant",
      content: [
        {
          type: "thinking",
          thinking: "Inspect first.",
          thinkingSignature: "same-route",
          redacted: false,
        },
        { type: "text", text: "Loading." },
        { type: "toolCall", id: "c1", name: "inspect", arguments: {} },
      ],
    });
    expect(wire.messages[2]).toEqual({
      role: "toolResult",
      toolCallId: "c1",
      toolName: "inspect",
      isError: false,
      content: [{ type: "text", text: "OK" }],
    });
    expect(JSON.stringify(wire)).not.toMatch(
      /responseId|diagnostics|usage|timestamp|privateUIState|textSignature|namespace|thoughtSignature/,
    );
    expect(JSON.stringify(context)).toEqual(before);
  });

  it("refuses unsupported required constraints rather than weakening their meaning", () => {
    const tool = context.tools![0]!;
    expect(() =>
      projectPlatformContext({
        ...context,
        tools: [{ ...tool, constrainedSampling: { type: "json_schema", strict: "require" } }],
      }),
    ).toThrow("MODEL_CAPABILITY_UNSUPPORTED");
    expect(
      projectPlatformContext({
        ...context,
        tools: [{ ...tool, constrainedSampling: { type: "json_schema", strict: "prefer" } }],
      }).tools,
    ).toEqual(projectPlatformContext(context).tools);
  });

  it.each(["error", "aborted"] as const)(
    "resumes after a %s turn without replaying invalid tool content",
    (stopReason) => {
      const failed: AssistantMessage = {
        ...assistant,
        stopReason,
        errorMessage: "MODEL_RESPONSE_INVALID",
        content: [
          { type: "text", text: "<｜DSML｜tool_calls>unfinished".repeat(400) },
          { type: "toolCall", id: "incomplete", name: "inspect", arguments: {} },
          {
            type: "thinking",
            thinking: "partial",
            thinkingSignature: "openerx-responses-state-v1:invalid",
          },
        ],
      };
      const resumed: Context = {
        ...context,
        messages: [
          ...context.messages,
          failed,
          { role: "user", content: "Continue", timestamp: 3 },
        ],
      };
      const before = JSON.stringify(resumed);
      const wire = projectPlatformContext(resumed);
      expect(wire.messages).toEqual([
        ...projectPlatformContext(context).messages,
        { role: "user", content: "Continue" },
      ]);
      expect(JSON.stringify(wire)).not.toMatch(/DSML|incomplete|partial/);
      expect(JSON.stringify(resumed)).toEqual(before);
      // Length-limited text remains usable when the user asks to continue it.
      expect(
        projectPlatformContext({
          messages: [
            {
              ...failed,
              stopReason: "length",
              content: [{ type: "text", text: "Valid partial paragraph" }],
            },
          ],
        }).messages,
      ).toEqual([
        { role: "assistant", content: [{ type: "text", text: "Valid partial paragraph" }] },
      ]);
    },
  );

  it("preserves reasoning in the Pi result and next request; option changes use different dedupe keys", async () => {
    const model: ModelCatalogEntry = {
      modelRef: "platform/test",
      displayName: "Test",
      version: "1",
      capabilities: {
        textInput: true,
        imageInput: false,
        fileInput: false,
        functionCalling: true,
        structuredOutput: false,
      },
      contextWindow: 32768,
      maxOutputTokens: 4096,
      status: "available",
      priceRef: "test",
      priceSummary: "test",
      free: true,
      thinkingLevels: ["off", "high"],
    };
    const execute = vi.fn(
      async (request: ModelGatewayRequestDto): Promise<ModelGatewayResponse> => ({
        text: "OK",
        reasoning: { text: "Preserve this trace.", signature: "current-route" },
        effectiveModelRef: model.modelRef,
        fallbackReason: null,
        finishReason: "stop",
        usage: {
          usageId: randomUUID(),
          accountId: request.accountId,
          conversationId: request.conversationId,
          messageId: request.messageId,
          runId: null,
          toolCallId: null,
          selectedModelRef: request.selectedModelRef,
          effectiveModelRef: model.modelRef,
          fallbackReason: null,
          inputTokens: 1,
          cachedInputTokens: 0,
          outputTokens: 1,
          reasoningTokens: 1,
          totalTokens: 2,
          providerReported: true,
          missingReasons: {},
          dedupeKey: request.requestDedupeKey,
          recordedAt: new Date().toISOString(),
        },
      }),
    );
    const platform = createPlatformModelProvider({
      catalog: [model],
      transport: { execute },
      request: {
        accountId: randomUUID(),
        conversationId: randomUUID(),
        messageId: randomUUID(),
        selectedModelRef: model.modelRef,
        approvedFallbackModelRef: null,
        requestDedupeKey: "reasoning-contract",
      },
    });
    const first = await platform.provider
      .streamSimple(platform.model, normalizeContext(context), {
        reasoning: "high",
        toolChoice: "auto",
      })
      .result();
    expect(first.stopReason).toBe("stop");
    expect(first.content).toContainEqual({
      type: "thinking",
      thinking: "Preserve this trace.",
      thinkingSignature: "current-route",
    });
    const next = {
      ...context,
      messages: [
        ...context.messages,
        first,
        { role: "user" as const, content: "Continue", timestamp: 3 },
      ],
    };
    await platform.provider
      .streamSimple(platform.model, normalizeContext(next), {
        reasoning: "high",
        toolChoice: "none",
      })
      .result();
    expect(execute.mock.calls[1]![0]).toMatchObject({
      reasoningReplay: true,
      toolChoice: "none",
      context: {
        messages: expect.arrayContaining([
          expect.objectContaining({ role: "assistant", content: first.content }),
        ]),
      },
    });
    await platform.provider
      .streamSimple(platform.model, normalizeContext(context), { toolChoice: "auto" })
      .result();
    expect(execute.mock.calls[2]![0].requestDedupeKey).not.toBe(
      execute.mock.calls[0]![0].requestDedupeKey,
    );
    await platform.provider
      .streamSimple(platform.model, normalizeContext(context), {
        reasoning: "high",
        toolChoice: "none",
      })
      .result();
    expect(execute.mock.calls[3]![0].requestDedupeKey).not.toBe(
      execute.mock.calls[0]![0].requestDedupeKey,
    );
  });
});
