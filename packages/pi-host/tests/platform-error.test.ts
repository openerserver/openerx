import { classifyModelError } from "@openerx/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HttpPlatformModelTransport } from "../src/platform-provider";

afterEach(() => vi.unstubAllGlobals());

describe("platform HTTP error context", () => {
  it.each([
    [401, "MODEL_AUTHENTICATION_FAILED"],
    [403, "MODEL_PERMISSION_DENIED"],
    [429, "MODEL_RATE_LIMITED"],
    [503, "MODEL_SERVER_ERROR"],
  ])("preserves HTTP %i after Pi serializes an error to its message", async (status, code) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(
          { error: { code: "UPSTREAM_ERROR", message: "localized detail" } },
          { status },
        ),
      ),
    );
    const error = await new HttpPlatformModelTransport("https://fixture.invalid", "fixture-key")
      .catalog()
      .catch((error: Error) => error);
    expect(error).toBeInstanceOf(Error);
    expect(classifyModelError((error as Error).message)).toMatchObject({
      code,
      httpStatus: status,
    });
    expect((error as Error).message).not.toContain("localized detail");
  });
  it("keeps platform identity errors distinct from provider credentials", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({ error: { code: "ACCESS_TOKEN_EXPIRED" } }, { status: 401 }),
      ),
    );
    await expect(
      new HttpPlatformModelTransport("https://fixture.invalid", "fixture-key").catalog(),
    ).rejects.toMatchObject({ message: "ACCESS_TOKEN_EXPIRED", status: 401 });
  });
  it("retains a non-JSON gateway failure status", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("bad gateway", { status: 502 })),
    );
    await expect(
      new HttpPlatformModelTransport("https://fixture.invalid", "fixture-key").catalog(),
    ).rejects.toThrow("HTTP 502");
  });
  it("classifies a null gateway body by status", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(null, { status: 401 })),
    );
    await expect(
      new HttpPlatformModelTransport("https://fixture.invalid", "fixture-key").catalog(),
    ).rejects.toThrow("MODEL_AUTHENTICATION_FAILED:HTTP 401");
  });
});
