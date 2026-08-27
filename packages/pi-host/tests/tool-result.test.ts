import { describe, expect, it } from "vitest";
import { genericToolResult, productToolResult } from "../src/tool-result";

describe("typed Pi tool results", () => {
  it("passes visual content as an image block instead of Base64 JSON text", () => {
    const base64 = "aW1hZ2U=";
    const result = productToolResult({
      summary: "已捕获截图",
      content: [
        { type: "text", text: "已捕获截图" },
        { type: "image", data: base64, mimeType: "image/png" },
      ],
      data: { bytesBase64: base64, width: 10, height: 10 },
      sources: [],
      artifacts: [],
      sideEffectCommitted: false,
      durationMs: 1,
    });
    expect(result.content).toContainEqual({
      type: "image",
      data: base64,
      mimeType: "image/png",
    });
    expect(
      result.content
        .filter((part) => part.type === "text")
        .map((part) => part.text)
        .join(""),
    ).not.toContain(base64);
    expect(JSON.stringify(result.details)).not.toContain(base64);
  });

  it("removes private paths and encoded media from generic file-tool details", () => {
    const result = genericToolResult({
      id: "00000000-0000-4000-8000-000000000901",
      objectRef: "/private/profile/object",
      bytesBase64: "c2VjcmV0",
      displayName: "result.txt",
    });
    expect(JSON.stringify(result)).not.toContain("/private/profile");
    expect(JSON.stringify(result)).not.toContain("c2VjcmV0");
  });

  it("keeps a typed workspace diff visible to the model as bounded text", () => {
    const result = productToolResult({
      summary: "已记录 src/app.ts 的差异",
      content: [
        {
          type: "diff",
          workspaceChangeId: "00000000-0000-4000-8000-000000000902",
          relativePath: "src/app.ts",
          patch: "--- a/src/app.ts\n+++ b/src/app.ts\n-old\n+new",
        },
      ],
      data: {},
      sources: [],
      artifacts: [],
      sideEffectCommitted: true,
      durationMs: 1,
    });
    expect(result.content).toEqual([
      expect.objectContaining({
        type: "text",
        text: expect.stringContaining("+new"),
      }),
    ]);
  });
});
