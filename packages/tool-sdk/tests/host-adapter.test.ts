import { describe, expect, it, vi } from "vitest";
import { HostCapabilityAdapter } from "../src";

describe("HostCapabilityAdapter", () => {
  it("resolves browser uploads from a stable file ID and ignores caller paths", async () => {
    const execute = vi.fn(async () => ({
      summary: "uploaded",
      content: [{ type: "text" as const, text: "uploaded" }],
      data: {},
      sources: [],
      artifacts: [],
      sideEffectCommitted: true,
      durationMs: 1,
    }));
    const fileId = "00000000-0000-4000-8000-000000000801";
    const adapter = new HostCapabilityAdapter(
      { execute },
      (requestedFileId) => `/profile/content/objects/${requestedFileId}`,
    );

    await adapter.execute(
      {
        operation: "browser",
        action: "upload",
        sessionId: "00000000-0000-4000-8000-000000000802",
        selector: "#upload",
        fileId,
        path: "/Users/example/.ssh/id_ed25519",
        idempotencyKey: "browser-upload-0001",
      },
      { signal: new AbortController().signal },
    );

    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        fileId,
        path: `/profile/content/objects/${fileId}`,
      }),
      expect.any(AbortSignal),
    );
  });

  it("imports browser downloads and removes the private Main path from the Pi result", async () => {
    const execute = vi.fn(async () => ({
      summary: "downloaded",
      content: [{ type: "text" as const, text: "downloaded" }],
      data: {
        path: "/profile/tool-downloads/private/result.csv",
        filename: "result.csv",
      },
      sources: [],
      artifacts: [],
      sideEffectCommitted: true,
      durationMs: 1,
    }));
    const adapter = new HostCapabilityAdapter({ execute }, undefined, async () => ({
      fileId: "00000000-0000-4000-8000-000000000803",
      displayName: "result.csv",
    }));

    const result = await adapter.execute(
      {
        operation: "browser",
        action: "download",
        sessionId: "00000000-0000-4000-8000-000000000804",
        selector: "#download",
        idempotencyKey: "browser-download-0001",
      },
      { signal: new AbortController().signal },
    );

    expect(result.data).toEqual({
      filename: "result.csv",
      fileId: "00000000-0000-4000-8000-000000000803",
      displayName: "result.csv",
    });
    expect(JSON.stringify(result)).not.toContain("/profile/tool-downloads");
    expect(result.content).toContainEqual(
      expect.objectContaining({
        type: "file",
        personalFileId: "00000000-0000-4000-8000-000000000803",
      }),
    );
  });
});
