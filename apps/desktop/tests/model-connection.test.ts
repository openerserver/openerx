import { defaultByokModelConfiguration, resolveByokModelPreset } from "@openerx/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ToolCredentialVault } from "../src/main/credential-vault";
import { ModelServiceSettingsStore } from "../src/main/model-service-settings";

afterEach(() => vi.unstubAllGlobals());

const input = {
  mode: "byok" as const,
  apiKey: "synthetic-connection-fixture-key",
  byok: {
    ...defaultByokModelConfiguration(),
    baseUrl: "http://127.0.0.1:12345/v1",
    modelId: "fixture",
  },
};
// test() uses the supplied key and does not read or write either file.
const store = new ModelServiceSettingsStore(
  "/unused-model-connection-fixture.json",
  new ToolCredentialVault("/unused-model-connection-fixture.bin"),
);

describe("model connection failure classification", () => {
  it.each([
    ["zhipu.glm-5-3", "glm-5.3"],
    ["zhipu.glm-5-3-flash", "glm-5.3-flash"],
    ["kimi.k3", "kimi-k3"],
    ["kimi.k2-7-code", "kimi-k2.7-code"],
    ["hunyuan.hy4-preview", "hy4-preview"],
    ["hunyuan.hy3", "hy3"],
  ])("probes the new %s preset with supported parameters", async (ref, modelId) => {
    const configuration = resolveByokModelPreset(`platform/byok.${ref}`)?.model.configuration;
    if (!configuration) throw new Error(`Missing model preset ${ref}`);
    const probeStore = new ModelServiceSettingsStore(
      "/unused-model-connection-fixture.json",
      new ToolCredentialVault("/unused-model-connection-fixture.bin"),
      async () => ["8.8.8.8"],
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          model: modelId,
          choices: [{ message: { reasoning_content: "Connected." } }],
        }),
      ),
    );
    await expect(
      probeStore.test({
        ...input,
        byok: configuration,
        providerApiKeys: { hunyuan: "synthetic-hunyuan-key" },
      }),
    ).resolves.toMatchObject({
      ok: true,
      reportedModel: modelId,
    });
    const request = JSON.parse(String(vi.mocked(fetch).mock.calls[0]?.[1]?.body));
    expect(request.model).toBe(modelId);
    if (modelId.startsWith("hy")) {
      expect(request.thinking).toEqual({ type: "disabled" });
      expect(vi.mocked(fetch).mock.calls[0]?.[1]?.headers).toMatchObject({
        authorization: "Bearer synthetic-hunyuan-key",
      });
    }
    if (modelId === "kimi-k3") {
      expect(request.max_completion_tokens).toBe(1_024);
      expect(request.max_tokens).toBeUndefined();
    } else expect(request.max_tokens).toBe(1_024);
    if (modelId.startsWith("glm-")) expect(request.thinking.type).toBe("enabled");
    if (modelId.startsWith("glm-") || modelId === "kimi-k3")
      expect(request.reasoning_effort).toBe("low");
  });

  it.each([
    [401, "localized provider error", "MODEL_AUTHENTICATION_FAILED"],
    [403, "localized provider error", "MODEL_PERMISSION_DENIED"],
    [429, "insufficient_quota", "MODEL_QUOTA_EXCEEDED"],
    [429, "rate_limit_exceeded", "MODEL_RATE_LIMITED"],
    [503, "localized provider error", "MODEL_SERVER_ERROR"],
    [400, "context_length_exceeded", "MODEL_CONTEXT_LIMIT_REACHED"],
  ])("returns a safe code for HTTP %i and %s", async (status, message, code) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({ error: { message: `${message} ${input.apiKey}` } }, { status }),
      ),
    );
    await expect(store.test(input)).rejects.toThrow(new Error(code));
  });

  it.each([
    "null",
    "{}",
    '{"choices":[]}',
    '{"choices":[{"message":{"content":null}}]}',
    "invalid JSON",
  ])("rejects invalid successful bodies: %s", async (body) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(body)),
    );
    await expect(store.test(input)).rejects.toThrow("MODEL_RESPONSE_INVALID");
  });

  it("classifies non-JSON failures and network exceptions without exposing provider text", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("upstream unavailable", { status: 502 })),
    );
    await expect(store.test(input)).rejects.toThrow("MODEL_SERVER_ERROR");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new TypeError(`fetch failed ${input.apiKey}`)),
    );
    await expect(store.test(input)).rejects.toThrow(new Error("MODEL_NETWORK_ERROR"));
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new DOMException("request timed out", "TimeoutError")),
    );
    await expect(store.test(input)).rejects.toThrow("MODEL_REQUEST_TIMEOUT");
  });

  it.each([
    ["content", { content: "OK" }],
    ["reasoning_content", { content: null, reasoning_content: "The connection is valid." }],
    ["tool_calls", { content: null, tool_calls: [{ id: "call_fixture", type: "function" }] }],
  ])("accepts a valid response with %s", async (_field, message) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ model: "fixture", choices: [{ message }] })),
    );
    await expect(store.test(input)).resolves.toMatchObject({ ok: true, reportedModel: "fixture" });
  });

  it("uses the DeepSeek compatibility probe settings", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({ model: "deepseek-flash", choices: [{ message: { content: "OK" } }] }),
      ),
    );
    await expect(
      store.test({ ...input, byok: { ...input.byok, modelId: "deepseek-flash" } }),
    ).resolves.toMatchObject({ ok: true });
    const request = JSON.parse(String(vi.mocked(fetch).mock.calls[0]?.[1]?.body));
    expect(request).toMatchObject({
      model: "deepseek-flash",
      max_tokens: 32,
      stream: false,
      thinking: { type: "disabled" },
    });
  });
});
