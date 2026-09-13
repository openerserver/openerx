import { afterEach, describe, expect, it, vi } from "vitest";
import { OAuthLoopbackController } from "../src/main/oauth-loopback-controller";

const controllers: OAuthLoopbackController[] = [];

afterEach(() => {
  for (const controller of controllers.splice(0)) controller.close();
});

describe("OAuthLoopbackController", () => {
  it("opens only a trusted authorization URL and returns the exact loopback callback", async () => {
    let callbackUrl = "";
    const openExternal = vi.fn(async (authorizationUrl: string) => {
      expect(authorizationUrl).toBe("https://identity.example/authorize?client_id=openerx");
      const response = await fetch(`${callbackUrl}?code=code-123&state=state-123`);
      expect(response.status).toBe(200);
      expect(await response.text()).toContain("授权已返回 openerx");
    });
    const controller = new OAuthLoopbackController(openExternal, 5_000);
    controllers.push(controller);
    const session = await controller.prepare("00000000-0000-4000-8000-000000000602");
    callbackUrl = session.redirectUrl;

    await expect(
      controller.authorize(
        session.sessionId,
        "https://identity.example/authorize?client_id=openerx",
      ),
    ).resolves.toBe(`${session.redirectUrl}?code=code-123&state=state-123`);
    expect(openExternal).toHaveBeenCalledTimes(1);
  });

  it("rejects non-loopback HTTP authorization and supports cancellation", async () => {
    const controller = new OAuthLoopbackController(
      vi.fn(async () => undefined),
      5_000,
    );
    controllers.push(controller);
    const denied = await controller.prepare("00000000-0000-4000-8000-000000000602");
    await expect(
      controller.authorize(denied.sessionId, "http://identity.example/authorize"),
    ).rejects.toThrow("MCP_OAUTH_AUTHORIZATION_URL_DENIED");
    await controller.cancel(denied.sessionId);

    const cancelled = await controller.prepare("00000000-0000-4000-8000-000000000602");
    const waiting = controller.authorize(cancelled.sessionId, "https://identity.example/authorize");
    await controller.cancel(cancelled.sessionId);
    await expect(waiting).rejects.toThrow("MCP_OAUTH_CANCELLED");
  });
});
