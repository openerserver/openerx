import type { NormalizedToolResult } from "@openerx/contracts";
import { describe, expect, it, vi } from "vitest";
import { HttpPlatformImageGenerationTransport, ImageGenerationAdapter } from "../src";

const result: NormalizedToolResult = {
  summary: "已生成 1 张图片",
  content: [
    { type: "text", text: "已生成 1 张图片" },
    { type: "image", data: "aW1hZ2U=", mimeType: "image/png" },
  ],
  data: { generationId: "image-generation-1" },
  sources: [],
  artifacts: ["00000000-0000-4000-8000-000000000701"],
  sideEffectCommitted: true,
  durationMs: 123,
};

describe("platform image generation", () => {
  it("uses only the authenticated first-party endpoint and returns server artifact IDs", async () => {
    const fetchImplementation = vi.fn(
      async (_input: string | URL | Request, _init?: RequestInit) =>
        new Response(JSON.stringify(result), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    const adapter = new ImageGenerationAdapter(
      new HttpPlatformImageGenerationTransport(
        "https://platform.example.test",
        "account-access-token",
        fetchImplementation as typeof fetch,
      ),
    );
    const completed = await adapter.execute(
      {
        operation: "image_generate",
        prompt: "A precise isometric tool workbench",
        aspectRatio: "16:9",
        count: 1,
        idempotencyKey: "image-generate-0001",
      },
      { signal: new AbortController().signal },
    );

    expect(completed).toEqual(result);
    expect(fetchImplementation).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImplementation.mock.calls[0] ?? [];
    expect(String(url)).toBe("https://platform.example.test/v1/tools/image-generation");
    expect(init).toBeDefined();
    if (!init) throw new Error("fetch init missing");
    expect((init.headers as Record<string, string>).authorization).toBe(
      "Bearer account-access-token",
    );
    expect(JSON.parse(String(init.body))).toEqual({
      prompt: "A precise isometric tool workbench",
      aspectRatio: "16:9",
      count: 1,
    });
  });
});
