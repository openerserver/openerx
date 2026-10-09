import { randomUUID } from "node:crypto";
import type { ModelCatalogEntry, ModelGatewayRequestDto } from "@openerx/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ModelAuthorizationClient } from "../src/model-authorization-client";
import { HttpPlatformModelTransport } from "../src/platform-provider";

const a: ModelCatalogEntry = {
  modelRef: "platform/a",
  displayName: "A",
  version: "1",
  capabilities: {
    textInput: true,
    imageInput: false,
    fileInput: false,
    functionCalling: true,
    structuredOutput: false,
  },
  contextWindow: 32768,
  maxOutputTokens: 1024,
  status: "available",
  free: true,
  priceRef: "allowance",
  priceSummary: "基础额度",
  thinkingLevels: ["off"],
};
const b = { ...a, modelRef: "platform/b", displayName: "B" };
const request: ModelGatewayRequestDto = {
  accountId: randomUUID(),
  conversationId: randomUUID(),
  messageId: randomUUID(),
  selectedModelRef: b.modelRef,
  approvedFallbackModelRef: null,
  requestDedupeKey: "transport-test-1",
  requirements: {},
  context: { messages: [{ role: "user", content: "Hello" }] },
};
afterEach(() => vi.unstubAllGlobals());
describe("v3 model transport", () => {
  it("accepts a bounded completed event containing a long replayable reasoning trace", async () => {
    const reasoning = { text: "r".repeat(1_100_000), signature: "route" };
    const response = {
      text: "OK",
      reasoning,
      effectiveModelRef: b.modelRef,
      fallbackReason: null,
      usage: {
        usageId: randomUUID(),
        accountId: request.accountId,
        conversationId: request.conversationId,
        messageId: request.messageId,
        runId: null,
        toolCallId: null,
        selectedModelRef: b.modelRef,
        effectiveModelRef: b.modelRef,
        fallbackReason: null,
        inputTokens: 1,
        outputTokens: 1,
        cachedInputTokens: 0,
        reasoningTokens: 1,
        totalTokens: 2,
        providerReported: true,
        missingReasons: {},
        dedupeKey: request.requestDedupeKey,
        recordedAt: new Date().toISOString(),
      },
    };
    vi.stubGlobal(
      "fetch",
      async () =>
        new Response(`data: ${JSON.stringify({ type: "completed", response })}\n\n`, {
          headers: { "content-type": "text/event-stream" },
        }),
    );
    const transport = new HttpPlatformModelTransport("https://models.example.test", "token", {
      apiVersion: "v3",
    });
    const events = [];
    for await (const event of transport.stream({ ...request, reasoningReplay: true }))
      events.push(event);
    expect(events).toEqual([{ type: "completed", response }]);
  });
  it("orders the server default while preserving every selectable model", async () => {
    const fetcher = vi.fn(async () =>
      Response.json({ catalogVersion: "1", defaultModelRef: b.modelRef, models: [a, b] }),
    );
    vi.stubGlobal("fetch", fetcher);
    const transport = new HttpPlatformModelTransport("https://models.example.test", "initial", {
      apiVersion: "v3",
      authorize: async () => "fresh",
    });
    const models = await transport.catalog();
    expect(models.map((m) => m.modelRef)).toEqual([b.modelRef, a.modelRef]);
    expect(models[0]).toMatchObject({ recommended: true, catalogVersion: "1" });
    expect(models[1]).toMatchObject({ recommended: false, catalogVersion: "1" });
    expect(fetcher).toHaveBeenCalledWith(
      "https://models.example.test/api/v3/models",
      expect.objectContaining({
        redirect: "error",
        headers: expect.objectContaining({ authorization: "Bearer fresh" }),
      }),
    );
  });
  it("renews once on a pre-execution 401 and never replaces the selected model", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ error: { code: "AUTH_INVALID" } }, { status: 401 }))
      .mockResolvedValueOnce(
        new Response('data: {"type":"failed","errorCode":"MODEL_QUOTA_EXCEEDED"}\n\n', {
          headers: { "content-type": "text/event-stream" },
        }),
      );
    vi.stubGlobal("fetch", fetcher);
    const authorize = vi.fn(async (rejected?: string) => (rejected ? "renewed" : "fresh"));
    const transport = new HttpPlatformModelTransport("https://models.example.test", "initial", {
      apiVersion: "v3",
      authorize,
    });
    const events = [];
    for await (const event of transport.stream(request)) events.push(event);
    expect(events).toEqual([{ type: "failed", errorCode: "MODEL_QUOTA_EXCEEDED" }]);
    expect(authorize.mock.calls).toEqual([[], ["fresh"]]);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetcher.mock.calls[1]![1].body).selectedModelRef).toBe(b.modelRef);
  });
  it("does not repeat an uncertain invocation after a 409 or after partial output", async () => {
    const fetcher = vi.fn(async () =>
      Response.json({ error: { code: "MODEL_RESULT_UNAVAILABLE" } }, { status: 409 }),
    );
    vi.stubGlobal("fetch", fetcher);
    const transport = new HttpPlatformModelTransport("https://models.example.test", "token", {
      apiVersion: "v3",
    });
    await expect(transport.execute(request)).rejects.toThrow("MODEL_RESULT_UNAVAILABLE");
    expect(fetcher).toHaveBeenCalledTimes(1);
    fetcher.mockImplementationOnce(
      async () =>
        new Response(
          'data: {"type":"delta","delta":"partial"}\n\ndata: {"type":"failed","errorCode":"AUTH_INVALID"}\n\n',
        ),
    );
    const events = [];
    for await (const event of transport.stream(request)) events.push(event);
    expect(events).toHaveLength(2);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("rejects a catalogue whose default is outside the authorized list", async () => {
    vi.stubGlobal("fetch", async () =>
      Response.json({ catalogVersion: "1", defaultModelRef: "platform/secret", models: [a] }),
    );
    await expect(
      new HttpPlatformModelTransport("https://models.example.test", "token", {
        apiVersion: "v3",
      }).catalog(),
    ).rejects.toThrow();
  });
  it("matches credential replies and releases pending calls on host disconnect", async () => {
    const postMessage = vi.fn();
    const client = new ModelAuthorizationClient({ postMessage });
    const pending = client.authorize(request.accountId);
    const frame = postMessage.mock.calls[0]![0];
    expect(frame).toMatchObject({
      kind: "model.authorization.request",
      accountId: request.accountId,
    });
    client.handle({
      kind: "model.authorization.response",
      requestId: frame.requestId,
      ok: false,
      errorCode: "AUTHENTICATION_REQUIRED",
    });
    await expect(pending).rejects.toThrow("AUTHENTICATION_REQUIRED");
    const disconnected = client.authorize(request.accountId);
    client.close();
    await expect(disconnected).rejects.toThrow("PI_HOST_DISCONNECTED");
  });
});
