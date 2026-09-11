import { defaultByokModelConfiguration } from "@openerx/contracts";
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

  it.each(["null", "{}", '{"choices":[]}', "invalid JSON"])(
    "rejects invalid successful bodies: %s",
    async (body) => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => new Response(body)),
      );
      await expect(store.test(input)).rejects.toThrow("MODEL_RESPONSE_INVALID");
    },
  );

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

  it("accepts a valid response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({ model: "fixture", choices: [{ message: { content: "OK" } }] }),
      ),
    );
    await expect(store.test(input)).resolves.toMatchObject({ ok: true, reportedModel: "fixture" });
  });
});
