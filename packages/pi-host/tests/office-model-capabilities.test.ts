import { randomUUID } from "node:crypto";
import { normalizeContext } from "@earendil-works/pi-ai";
import type { ModelCatalogEntry, ModelGatewayRequestDto } from "@openerx/contracts";
import { expect, it, vi } from "vitest";
import { createProductFileTools } from "../src/file-tools";
import { createPlatformModelProvider } from "../src/platform-provider";
import { officeArtifactToolResult } from "../src/tool-result";

const artifactId = randomUUID();
const preview = {
  artifact: { id: artifactId, currentVersion: 1, displayName: "Budget.xlsx", format: "xlsx" },
  preview: {
    validation: { status: "passed" },
    parsedText: "[Budget]\nItem\tAmount\n研发\t120\nTotal\t120",
    renderedSurfaces: [
      {
        kind: "sheet",
        index: 1,
        label: "Sheet 1",
        imageDataUrl: "data:image/svg+xml;base64,PHN2Zy8+",
        modelImageDataUrl: "data:image/png;base64,cG5n",
      },
    ],
  },
};

it.each([true, false])(
  "Office tool results respect imageInput=%s without losing artifact metadata",
  async (imageInput) => {
    const request = vi.fn(async () => preview);
    const tools = createProductFileTools({
      generationId: randomUUID(),
      conversationId: randomUUID(),
      branchId: randomUUID(),
      assistantMessageId: randomUUID(),
      imageInput,
      transport: { request },
    });
    const office = tools.find(({ name }) => name === "openerx_office_artifact")!;
    const result = await office.execute(
      "office-call",
      {
        displayName: "Capabilities regression",
        spec: {
          format: "xlsx",
          title: "Regression",
          sheets: [{ name: "Sheet 1", rows: [["Value"], [1]] }],
        },
      },
      undefined,
      undefined,
      {} as never,
    );
    expect(request).toHaveBeenCalledTimes(1);
    expect(result.content.filter((part) => part.type === "image")).toHaveLength(imageInput ? 1 : 0);
    expect(result.content[0]).toMatchObject({
      type: "text",
      text: expect.stringContaining(artifactId),
    });
    expect(result.content[0]).toMatchObject({
      text: expect.stringContaining(preview.preview.parsedText),
    });
    expect(result.content[0]).toMatchObject({ text: expect.stringContaining('"status":"passed"') });
    expect(result.content[0]).toMatchObject({
      text: expect.stringContaining("not an independent recalculation"),
    });
    expect(JSON.stringify(result.content.filter((part) => part.type === "text"))).not.toMatch(
      /imageDataUrl|modelImageDataUrl|cG5n/,
    );
    expect(result.details).toMatchObject({
      artifact: { id: artifactId },
      preview: { validation: { status: "passed" } },
    });
    expect(JSON.stringify(result.details)).not.toMatch(/imageDataUrl|modelImageDataUrl|cG5n/);
    if (!imageInput) {
      expect(result.content[0]).toMatchObject({
        text: expect.stringContaining("Visual review has not been performed"),
      });
      expect(office.promptSnippet).toContain("do not claim visual review");
    }
  },
);

it("bounds Office text by UTF-8 bytes and makes incomplete verification explicit", () => {
  const result = officeArtifactToolResult(
    {
      ...preview,
      preview: { ...preview.preview, parsedText: "预算😀".repeat(30_000) },
    },
    false,
  );
  const text = result.content.find((part) => part.type === "text")!;
  expect(Buffer.byteLength(text.text, "utf8")).toBeLessThan(64 * 1024);
  expect(text.text).toContain("Artifact text truncated");
  expect(text.text).not.toContain("\uFFFD");
  expect(text.text).toContain("Visual review has not been performed");
});

it("does not claim visual review when an image-capable model receives no preview images", () => {
  const result = officeArtifactToolResult(
    {
      ...preview,
      preview: { ...preview.preview, renderedSurfaces: [] },
    },
    true,
  );
  expect(result.content).toEqual([
    {
      type: "text",
      text: expect.stringContaining("Preview images were not supplied"),
    },
  ]);
});

it.each<{
  imageInput: boolean;
  toolName: string;
  imageRequired: boolean;
  browserFallback?: boolean;
}>([
  { imageInput: false, toolName: "openerx_office_artifact", imageRequired: false },
  { imageInput: true, toolName: "openerx_office_artifact", imageRequired: true },
  { imageInput: false, toolName: "openerx_desktop", imageRequired: true },
  { imageInput: false, toolName: "openerx_browser", imageRequired: false },
  { imageInput: true, toolName: "openerx_browser", imageRequired: true },
  {
    imageInput: false,
    toolName: "openerx_web_search",
    imageRequired: false,
    browserFallback: true,
  },
  { imageInput: false, toolName: "openerx_web_search", imageRequired: true },
])(
  "resumed $toolName previews respect imageInput=$imageInput without stripping other visual inputs",
  async ({ imageInput, toolName, imageRequired, browserFallback }) => {
    const model: ModelCatalogEntry = {
      modelRef: "platform/office",
      displayName: "Office",
      version: "test",
      capabilities: {
        textInput: true,
        imageInput,
        fileInput: false,
        functionCalling: true,
        structuredOutput: false,
      },
      contextWindow: 128000,
      maxOutputTokens: 4096,
      status: "available",
      priceRef: "test",
      priceSummary: "Test",
      free: true,
      thinkingLevels: ["off"],
    };
    const binding = {
      accountId: randomUUID(),
      conversationId: randomUUID(),
      messageId: randomUUID(),
      selectedModelRef: model.modelRef,
      approvedFallbackModelRef: null,
      requestDedupeKey: randomUUID(),
    };
    const execute = vi.fn(async (request: ModelGatewayRequestDto) => ({
      text: "Artifact created",
      toolCalls: [],
      effectiveModelRef: model.modelRef,
      fallbackReason: null,
      finishReason: "stop" as const,
      usage: {
        usageId: randomUUID(),
        accountId: binding.accountId,
        conversationId: binding.conversationId,
        messageId: binding.messageId,
        runId: null,
        toolCallId: null,
        selectedModelRef: model.modelRef,
        effectiveModelRef: model.modelRef,
        fallbackReason: null,
        inputTokens: 5,
        cachedInputTokens: 0,
        outputTokens: 2,
        reasoningTokens: null,
        totalTokens: 7,
        providerReported: true,
        missingReasons: { reasoningTokens: "provider_not_reported" },
        dedupeKey: request.requestDedupeKey,
        recordedAt: "2026-09-30T09:00:00.000Z",
      },
    }));
    const platform = createPlatformModelProvider({
      catalog: [model],
      transport: { execute },
      request: binding,
    });
    const context = normalizeContext({
      messages: [
        { role: "user", content: "Create a workbook", timestamp: 1 },
        {
          role: "toolResult",
          toolCallId: "office-call",
          toolName,
          isError: false,
          timestamp: 2,
          content:
            toolName === "openerx_office_artifact"
              ? officeArtifactToolResult(preview, true).content
              : [
                  { type: "text", text: `Artifact ${artifactId} v1 created` },
                  { type: "image", mimeType: "image/png", data: "cG5n" },
                ],
          details: {
            ...preview,
            ...(browserFallback ? { webSearchFallback: { mode: "system_browser" } } : {}),
          },
        },
      ],
    });
    const original = structuredClone(context);
    const stream = platform.provider.streamSimple(platform.model, context, {});
    await stream.result();
    const sent = execute.mock.calls[0]![0];
    expect(sent.requirements.imageInput === true).toBe(imageRequired);
    const gatewayContext = sent.context as { messages: Array<{ role: string }> };
    const toolResult = gatewayContext.messages.find((message) => message.role === "toolResult")!;
    expect(JSON.stringify(toolResult)).toContain(artifactId);
    expect(JSON.stringify(toolResult).includes('"type":"image"')).toBe(imageRequired);
    if (toolName === "openerx_office_artifact") {
      expect(JSON.stringify(toolResult)).toContain("研发");
      expect(JSON.stringify(toolResult)).toContain("Budget.xlsx");
      expect(JSON.stringify(toolResult)).not.toContain("modelImageDataUrl");
    }
    if (!imageRequired)
      expect(JSON.stringify(toolResult)).toMatch(/visual review has not been performed/i);
    expect(context).toEqual(original);
  },
);
