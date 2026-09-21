import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import {
  type BrowserObservation,
  BROWSER_COMPUTER_USE_CONTRACT_VERSION as contractVersion,
  type NormalizedToolResult,
} from "@openerx/contracts";
import { chromium } from "playwright";
import { BrowserSitePermissions } from "../src/main/browser-computer-use/browser-site-permissions";
import {
  ChromeExtensionServer,
  OPENERX_EXTENSION_ID,
} from "../src/main/browser-computer-use/chrome-extension-server";
import { ConnectedChromeBrowserBridgeDriver } from "../src/main/browser-computer-use/connected-browser-bridge-driver";
import {
  SystemDefaultBrowserAdapter,
  type SystemDefaultBrowserDriver,
} from "../src/main/browser-computer-use/system-default-browser-adapter";

const profile = mkdtempSync(path.join(os.tmpdir(), "openerx-extension-e2e-"));
const permissionPrompts: string[] = [];
const permissions = new BrowserSitePermissions(path.join(profile, "bridge"), async (host) => {
  permissionPrompts.push(host);
  return "task";
});
let bridge = new ChromeExtensionServer(async () => process.pid, {
  directory: path.join(profile, "bridge"),
  permissions,
});
const code = await bridge.pairingCode();
let redirectedRequests = 0;
const fixture = createServer((req, res) => {
  const address = fixture.address();
  assert(address && typeof address !== "string");
  if (req.url === "/redirect") {
    res.writeHead(302, { Location: `http://localhost:${address.port}/redirected` });
    res.end();
    return;
  }
  if (req.url === "/redirected") redirectedRequests++;
  res.setHeader("Content-Type", "text/html");
  res.end(
    `<html><body><h1>Extension fixture</h1><label>Search<input></label><button onclick="document.querySelector('h1').textContent='Extension clicked'">Click me</button><input type="password" value="extension-secret"><a href="http://localhost:${address.port}/next" target="_blank">Cross site</a></body></html>`,
  );
});
await new Promise<void>((resolve) => fixture.listen(0, "127.0.0.1", resolve));
const address = fixture.address();
assert(address && typeof address !== "string");
const extensionDirectory = path.resolve("browser-extension");
const browser = await chromium.launchPersistentContext(profile, {
  headless: false,
  executablePath: process.env.OPENERX_TEST_CHROMIUM || chromium.executablePath(),
  args: [
    `--disable-extensions-except=${extensionDirectory}`,
    `--load-extension=${extensionDirectory}`,
  ],
});
const adapter = new SystemDefaultBrowserAdapter(
  {} as SystemDefaultBrowserDriver,
  undefined,
  undefined,
  new ConnectedChromeBrowserBridgeDriver(bridge.grants),
);
const observation = (r: NormalizedToolResult) =>
  (r.data as { observation: BrowserObservation }).observation;
const signal = AbortSignal.timeout(120000);
try {
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${address.port}/`);
  const popup = await browser.newPage();
  await popup.goto(`chrome-extension://${OPENERX_EXTENSION_ID}/popup.html`);
  await popup.locator("#code").fill(code);
  await popup.locator("#pair").click();
  await popup.waitForFunction(
    () => document.querySelector("#status")?.textContent?.includes("已连接"),
    {},
    { timeout: 10000 },
  );
  await page.bringToFront();
  const discovered = await bridge.contexts(signal);
  const context = discovered.find((tab) => tab.url === page.url());
  assert(context);
  const tab = await bridge.prepareTab(context.url, context.browserContextRef, "e2e-task", signal);
  console.log("EXTENSION_CONNECTED_AND_CLAIMED");
  let current = observation(
    await adapter.execute(
      { contractVersion, action: "open", url: tab.url, browserContextRef: tab.browserContextRef },
      signal,
    ),
  );
  assert.equal(current.controlPath, "connected_browser_bridge");
  assert.equal(current.ownership, "external_user");
  assert(!JSON.stringify(current).includes("extension-secret"));
  assert.equal(bridge.grants.availableAuthorizations().length, 0);
  assert.deepEqual(permissionPrompts, ["127.0.0.1"]);
  const second = await bridge.prepareTab(
    `http://127.0.0.1:${address.port}/second`,
    undefined,
    "e2e-task",
    signal,
  );
  const secondObservation = observation(
    await adapter.execute({ contractVersion, action: "open", ...second }, signal),
  );
  await popup.bringToFront();
  current = observation(
    await adapter.execute(
      { contractVersion, action: "observe", sessionId: current.sessionId },
      signal,
    ),
  );
  assert.equal(adapter.descriptor(secondObservation.sessionId).state, "active");
  assert.deepEqual(permissionPrompts, ["127.0.0.1"]);
  const search = current.elements.find(
    (el) => el.name === "Search" && el.actions.includes("setValue"),
  );
  assert(search);
  current = observation(
    await adapter.execute(
      {
        contractVersion,
        action: "setValue",
        sessionId: current.sessionId,
        observationId: current.observationId,
        target: { elementRef: search.elementRef },
        text: "openerx bridge",
      },
      signal,
    ),
  );
  assert.equal(
    current.elements.find((el) => el.name === "Search" && el.actions.includes("setValue"))?.value,
    "openerx bridge",
  );
  const button = current.elements.find((el) => el.name === "Click me");
  assert(button);
  current = observation(
    await adapter.execute(
      {
        contractVersion,
        action: "invoke",
        sessionId: current.sessionId,
        observationId: current.observationId,
        target: { elementRef: button.elementRef },
      },
      signal,
    ),
  );
  assert(current.elements.some((el) => el.name === "Extension clicked"));
  await page.evaluate(() => document.querySelector("h1")?.setAttribute("data-revision", "changed"));
  const staleButton = current.elements.find((el) => el.name === "Click me");
  assert(staleButton);
  await assert.rejects(
    adapter.execute(
      {
        contractVersion,
        action: "invoke",
        sessionId: current.sessionId,
        observationId: current.observationId,
        target: { elementRef: staleButton.elementRef },
      },
      signal,
    ),
    /BROWSER_OBSERVATION_MISMATCH/,
  );
  current = observation(
    await adapter.execute(
      { contractVersion, action: "observe", sessionId: current.sessionId },
      signal,
    ),
  );
  const cross = current.elements.find((el) => el.name === "Cross site");
  assert(cross);
  permissions.update({ action: "site", host: "localhost", decision: "block" });
  await assert.rejects(
    adapter.execute(
      {
        contractVersion,
        action: "invoke",
        sessionId: current.sessionId,
        observationId: current.observationId,
        target: { elementRef: cross.elementRef },
      },
      signal,
    ),
    /BROWSER_NAVIGATION_DENIED/,
  );
  assert.equal(new URL(page.url()).hostname, "127.0.0.1");
  await assert.rejects(
    adapter.execute(
      {
        contractVersion,
        action: "navigate",
        sessionId: secondObservation.sessionId,
        observationId: secondObservation.observationId,
        url: `http://127.0.0.1:${address.port}/redirect`,
      },
      signal,
    ),
    /BROWSER_NAVIGATION_DENIED/,
  );
  assert.equal(redirectedRequests, 0, "a blocked redirect must not reach its destination server");
  permissions.update({ action: "site", host: "localhost", decision: "allow" });
  current = observation(
    await adapter.execute(
      { contractVersion, action: "observe", sessionId: current.sessionId },
      signal,
    ),
  );
  current = observation(
    await adapter.execute(
      {
        contractVersion,
        action: "invoke",
        sessionId: current.sessionId,
        observationId: current.observationId,
        target: { elementRef: current.elements.find((el) => el.name === "Cross site")!.elementRef },
      },
      signal,
    ),
  );
  assert.equal(new URL(current.url).hostname, "localhost");
  current = observation(
    await adapter.execute(
      {
        contractVersion,
        action: "navigate",
        sessionId: current.sessionId,
        observationId: current.observationId,
        url: `http://127.0.0.1:${address.port}/redirect`,
      },
      signal,
    ),
  );
  assert.equal(new URL(current.url).hostname, "localhost");
  assert.equal(new URL(current.url).pathname, "/redirected");
  assert.equal(redirectedRequests, 1);
  permissions.update({ action: "all_sites", allowed: true });
  permissions.update({ action: "site", host: "localhost", decision: "block" });
  assert(!(await bridge.contexts(signal)).some((tab) => new URL(tab.url).hostname === "localhost"));
  await assert.rejects(
    adapter.execute({ contractVersion, action: "observe", sessionId: current.sessionId }, signal),
    /BROWSER_NAVIGATION_DENIED/,
  );
  permissions.update({ action: "site", host: "localhost", decision: "allow" });
  await page.bringToFront();
  await page.mouse.click(700, 500);
  for (
    let count = 0;
    count < 20 && adapter.descriptor(current.sessionId).state !== "paused_for_user";
    count++
  )
    await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(adapter.descriptor(current.sessionId).state, "paused_for_user");
  current = observation(await adapter.resumeAfterUser(current.sessionId, signal));
  await adapter.execute(
    { contractVersion, action: "detach", sessionId: current.sessionId },
    signal,
  );
  assert(!page.isClosed());
  assert.equal(await page.title(), "");
  adapter.close();
  bridge.close();
  bridge = new ChromeExtensionServer(async () => process.pid, {
    directory: path.join(profile, "bridge"),
    permissions,
  });
  assert.equal(await bridge.pairingCode(), code);
  for (let attempt = 0; attempt < 60 && !bridge.grants.connected; attempt++)
    await new Promise((resolve) => setTimeout(resolve, 100));
  assert(
    bridge.grants.connected,
    "extension must reconnect after application restart without pairing again",
  );
  assert((await bridge.contexts(signal)).some((tab) => tab.url === page.url()));
  bridge.unpair();
  assert.notEqual(await bridge.pairingCode(), code);
  console.log(
    "EXTENSION_BROWSER_E2E_OK: discover/claim/create tabs, multi-tab switching, task/site/all-site permissions, block precedence, cross-site links and redirects, stale observations, redaction, user takeover, reconnect, unpair",
  );
} finally {
  adapter.close();
  bridge.close();
  fixture.close();
  await browser.close();
  rmSync(profile, { recursive: true, force: true });
}
