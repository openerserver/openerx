import { afterEach, describe, expect, it } from "vitest";
import {
  ChromeExtensionServer,
  OPENERX_EXTENSION_ID,
} from "../src/main/browser-computer-use/chrome-extension-server";

const servers: ChromeExtensionServer[] = [];
afterEach(() => {
  for (const server of servers.splice(0)) server.close();
});
describe("authenticated extension loopback transport", () => {
  it("requires both the pinned extension origin and the pairing secret", async () => {
    const server = new ChromeExtensionServer(async () => 1234);
    servers.push(server);
    const code = new URL(await server.pairingCode());
    const headers = {
      Origin: `chrome-extension://${OPENERX_EXTENSION_ID}`,
      Authorization: `Bearer ${code.hash.slice(1)}`,
      "Content-Type": "application/json",
    };
    for (const changed of [
      { ...headers, Origin: "https://attacker.test" },
      { ...headers, Authorization: "Bearer invalid" },
      { Authorization: headers.Authorization },
    ]) {
      expect(
        (await fetch(code.origin + "/connect", { method: "POST", headers: changed })).status,
      ).toBe(403);
    }
    expect(server.grants.connected).toBe(false);
    const connected = await fetch(code.origin + "/connect", { method: "POST", headers });
    expect(connected.status).toBe(200);
    const { connectionId } = await connected.json();
    expect(server.grants.connected).toBe(true);
    expect(
      (await fetch(code.origin + "/authorize", { method: "POST", headers, body: "{}" })).status,
    ).toBe(409);
    const scoped = { ...headers, "X-Openerx-Connection": connectionId };
    const binding = {
      browserWindowId: 1,
      tabId: 2,
      documentId: "document_fixture",
      url: "https://fixture.test/page",
      origin: "https://fixture.test",
    };
    const auth = {
      protocolVersion: "openerx_browser_bridge_v1",
      kind: "authorize_tab",
      messageId: "authorize_fixture",
      sequence: 1,
      binding,
    };
    const result = await fetch(code.origin + "/authorize", {
      method: "POST",
      headers: scoped,
      body: JSON.stringify(auth),
    });
    expect(result.status).toBe(200);
    const authorization = await result.json();
    expect(server.grants.availableAuthorizations()[0]?.browserContextRef).toBe(
      authorization.browserContextRef,
    );
    const polled = await fetch(code.origin + "/poll", {
      method: "POST",
      headers: scoped,
      body: "{}",
    });
    expect(polled.status).toBe(200);
    expect((await polled.json()).deliveries[0].message.kind).toBe("grant_accepted");
    expect(
      (
        await fetch(code.origin + "/authorize", {
          method: "POST",
          headers: scoped,
          body: JSON.stringify(auth),
        })
      ).status,
    ).toBe(400);
    await fetch(code.origin + "/disconnect", { method: "POST", headers: scoped, body: "{}" });
    expect(server.grants.connected).toBe(false);
    expect(server.grants.availableAuthorizations()).toEqual([]);
    expect(() => server.grants.claim(authorization.browserContextRef, binding.url)).toThrow(
      "BROWSER_BRIDGE_AUTHORIZATION_REQUIRED",
    );
  });
});
