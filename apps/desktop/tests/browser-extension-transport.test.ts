import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BrowserSitePermissions } from "../src/main/browser-computer-use/browser-site-permissions";
import {
  ChromeExtensionServer,
  OPENERX_EXTENSION_ID,
} from "../src/main/browser-computer-use/chrome-extension-server";

const servers: ChromeExtensionServer[] = [];
const directories: string[] = [];
afterEach(() => {
  for (const server of servers.splice(0)) server.close();
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});
describe("authenticated extension loopback transport", () => {
  it("restores pairing securely and invalidates the old secret when unpaired", async () => {
    const directory = mkdtempSync(path.join(tmpdir(), "browser-pairing-test-"));
    directories.push(directory);
    const first = new ChromeExtensionServer(async () => 1234, { directory });
    servers.push(first);
    const code = await first.pairingCode();
    const connectionFile = statSync(path.join(directory, "browser-bridge-connection.json"));
    expect(connectionFile.isFile()).toBe(true);
    // Windows reports DOS attributes through stat.mode, not POSIX access bits.
    if (process.platform !== "win32") expect(connectionFile.mode & 0o777).toBe(0o600);
    first.close();
    const second = new ChromeExtensionServer(async () => 1234, { directory });
    servers.push(second);
    await second.restore();
    expect(await second.pairingCode()).toBe(code);
    second.unpair();
    const previous = new URL(code);
    expect(
      (
        await fetch(previous.origin + "/connect", {
          method: "POST",
          headers: {
            Origin: `chrome-extension://${OPENERX_EXTENSION_ID}`,
            Authorization: `Bearer ${previous.hash.slice(1)}`,
          },
        })
      ).status,
    ).toBe(403);
  });
  it("requires a task-owned claim intent even when the extension is paired and all websites are allowed", async () => {
    const directory = mkdtempSync(path.join(tmpdir(), "browser-claim-test-"));
    directories.push(directory);
    const permissions = new BrowserSitePermissions(
      directory,
      vi.fn(async () => "block" as const),
    );
    permissions.update({ action: "all_sites", allowed: true });
    const server = new ChromeExtensionServer(async () => 1234, { permissions });
    servers.push(server);
    const code = new URL(await server.pairingCode());
    const headers = {
      Origin: `chrome-extension://${OPENERX_EXTENSION_ID}`,
      Authorization: `Bearer ${code.hash.slice(1)}`,
      "Content-Type": "application/json",
    };
    const connected = await (
      await fetch(code.origin + "/connect", {
        method: "POST",
        headers: { ...headers, "X-Openerx-Bridge-Version": "2" },
      })
    ).json();
    expect((await fetch(code.origin + "/connect", { method: "POST", headers })).status).toBe(426);
    const scoped = { ...headers, "X-Openerx-Connection": connected.connectionId };
    const forged = {
      protocolVersion: "openerx_browser_bridge_v1",
      kind: "authorize_tab",
      messageId: "forged_authorization",
      sequence: 1,
      binding: {
        browserWindowId: 1,
        tabId: 2,
        documentId: "document_fixture",
        url: "https://fixture.test/",
        origin: "https://fixture.test",
      },
    };
    expect(
      (
        await fetch(code.origin + "/authorize", {
          method: "POST",
          headers: scoped,
          body: JSON.stringify(forged),
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await fetch(code.origin + "/site-check", {
          method: "POST",
          headers: scoped,
          body: JSON.stringify({ intentId: "forged_authorization", url: "https://fixture.test/" }),
        })
      ).status,
    ).toBe(403);
    expect(server.grants.availableAuthorizations()).toEqual([]);
    await expect(
      server.prepareTab(
        "https://fixture.test/",
        "btab_forged_reference",
        "task",
        new AbortController().signal,
      ),
    ).rejects.toThrow("BROWSER_SURFACE_MISMATCH");
  });
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
