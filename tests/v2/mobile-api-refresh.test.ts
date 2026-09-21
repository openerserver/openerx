import { afterEach, describe, expect, it, vi } from "vitest";
import { MobileApi } from "../../apps/mobile/src/mobile-api";

afterEach(() => vi.unstubAllGlobals());
describe("mobile authenticated requests", () => {
  it("preserves binary attachment bytes when authorization rotates during upload", async () => {
    const objectId = crypto.randomUUID();
    const input = {
      objectId,
      sizeBytes: 3,
      mediaType: "text/plain",
      checksumSha256: "a".repeat(64),
    };
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          token: "b".repeat(64),
          operation: "upload",
          objectId,
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
        }),
      )
      .mockResolvedValueOnce(
        Response.json({ error: { message: "ACCESS_TOKEN_EXPIRED" } }, { status: 401 }),
      )
      .mockResolvedValueOnce(
        Response.json({
          ...input,
          accountId: crypto.randomUUID(),
          createdAt: new Date().toISOString(),
        }),
      );
    vi.stubGlobal("fetch", fetcher);
    const authorize = vi.fn(async (_token: string, rejected: boolean) =>
      rejected ? "rotated" : "initial",
    );
    const api = new MobileApi("https://platform.example", authorize);
    await api.uploadObject("initial", input, new Uint8Array([0, 128, 255]));
    const first = fetcher.mock.calls[1]?.[1];
    const retried = fetcher.mock.calls[2]?.[1];
    expect(first.headers["content-type"]).toBe("application/octet-stream");
    expect(Array.from(new Uint8Array(first.body))).toEqual([0, 128, 255]);
    expect(Array.from(new Uint8Array(retried.body))).toEqual([0, 128, 255]);
    expect(retried.headers.authorization).toBe("Bearer rotated");
  });
  it("uses the current session even when a controller still supplies the old token", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json([]));
    vi.stubGlobal("fetch", fetcher);
    const authorize = vi.fn().mockResolvedValue("renewed-token");
    const api = new MobileApi("https://platform.example", authorize);
    await api.listHosts("old-token");
    expect(authorize).toHaveBeenCalledWith("old-token", false);
    expect(fetcher.mock.calls[0]?.[1].headers.authorization).toBe("Bearer renewed-token");
  });

  it("retries an invalidated token once and never retries a revoked session", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({ error: { message: "ACCESS_TOKEN_INVALID" } }, { status: 401 }),
      )
      .mockResolvedValueOnce(Response.json([]));
    vi.stubGlobal("fetch", fetcher);
    const authorize = vi.fn().mockResolvedValueOnce("old-token").mockResolvedValueOnce("new-token");
    const api = new MobileApi("https://platform.example", authorize);
    await expect(api.listHosts("old-token")).resolves.toEqual([]);
    expect(authorize).toHaveBeenLastCalledWith("old-token", true);
    expect(fetcher.mock.calls[1]?.[1].headers.authorization).toBe("Bearer new-token");
    fetcher
      .mockReset()
      .mockResolvedValue(
        Response.json({ error: { message: "DEVICE_SESSION_REVOKED" } }, { status: 401 }),
      );
    await expect(api.listHosts("new-token")).rejects.toThrow("DEVICE_SESSION_REVOKED");
    expect(fetcher).toHaveBeenCalledOnce();
  });
});
