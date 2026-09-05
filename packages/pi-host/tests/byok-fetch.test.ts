import { afterEach, describe, expect, it, vi } from "vitest";
import { createRestrictedByokFetch } from "../src/host";

afterEach(() => vi.unstubAllGlobals());

describe("restricted BYOK fetch", () => {
  it("allows only the configured origin and path prefix", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const restricted = createRestrictedByokFetch("https://api.example.com/v1");

    await expect(restricted("https://api.example.com/v1/chat/completions")).resolves.toMatchObject({
      status: 200,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.example.com/v1/chat/completions",
      expect.objectContaining({ redirect: "manual" }),
    );
    await expect(restricted("https://api.example.com/admin")).rejects.toThrow(
      "BYOK_REQUEST_TARGET_FORBIDDEN",
    );
    await expect(restricted("https://metadata.example/admin")).rejects.toThrow(
      "BYOK_REQUEST_TARGET_FORBIDDEN",
    );
  });

  it("refuses redirects so credentials cannot be forwarded to another endpoint", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(null, { status: 307, headers: { location: "https://other.example/" } }),
        ),
    );
    const restricted = createRestrictedByokFetch("https://api.example.com/v1");
    await expect(restricted("https://api.example.com/v1/chat/completions")).rejects.toThrow(
      "BYOK_REDIRECT_FORBIDDEN",
    );
  });
});
