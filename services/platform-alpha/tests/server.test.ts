import type { PlatformAlphaServices } from "@openerx/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { createPlatformAlphaServer, listenOnEphemeralPort } from "../src/server";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

describe("Platform Alpha HTTP boundary", () => {
  it("maps protected-route authentication failures to a no-store 401 response", async () => {
    const services = {
      identity: {
        authenticate() {
          throw new Error("ACCESS_TOKEN_INVALID");
        },
      },
    } as unknown as PlatformAlphaServices;
    const listener = await listenOnEphemeralPort(createPlatformAlphaServer(services));
    cleanups.push(listener.close);

    const response = await fetch(`${listener.baseUrl}/api/v2/models`, {
      headers: { authorization: `Bearer ${"x".repeat(32)}` },
    });

    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      error: { code: "ACCESS_TOKEN_INVALID", message: "ACCESS_TOKEN_INVALID" },
    });
  });
});
