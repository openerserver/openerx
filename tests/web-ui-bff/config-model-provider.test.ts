import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { probeModelProviderConnection } from "../../control-plane/web-ui-bff/src/modules/config/routes";

const originalFetch = globalThis.fetch;

describe("model provider probe", () => {
  beforeEach(() => {
    globalThis.fetch = originalFetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("probes openai-compatible providers via /models", async () => {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      expect(String(input)).toBe("http://127.0.0.1:8000/v1/models");
      return new Response(JSON.stringify({ data: [{ id: "a" }, { id: "b" }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    const result = await probeModelProviderConnection({
      api: "openai-completions",
      baseURL: "http://127.0.0.1:8000/v1",
      apiKey: "1234",
    });

    expect(result).toEqual({
      ok: true,
      status: 200,
      modelCount: 2,
      models: [
        { id: "a", name: "a", contextWindow: null, maxTokens: null },
        { id: "b", name: "b", contextWindow: null, maxTokens: null },
      ],
      message: "连接成功，返回 2 个模型",
    });
  });

  test("returns guidance for github-copilot providers", async () => {
    const result = await probeModelProviderConnection({
      api: "github-copilot",
      name: "GitHub Copilot",
    });

    expect(result.ok).toBe(true);
    expect(result.message).toContain("OAuth");
  });
});
