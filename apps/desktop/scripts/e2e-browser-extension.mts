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
import {
  ChromeExtensionServer,
  OPENERX_EXTENSION_ID,
} from "../src/main/browser-computer-use/chrome-extension-server";
import { ConnectedChromeBrowserBridgeDriver } from "../src/main/browser-computer-use/connected-browser-bridge-driver";
import {
  SystemDefaultBrowserAdapter,
  type SystemDefaultBrowserDriver,
} from "../src/main/browser-computer-use/system-default-browser-adapter";

const bridge = new ChromeExtensionServer(async () => process.pid);
const code = await bridge.pairingCode();
const fixture = createServer((_req, res) => {
  res.setHeader("Content-Type", "text/html");
  res.end(
    '<html><body><h1>Extension fixture</h1><label>Search<input></label><button onclick="document.querySelector(\'h1\').textContent=\'Extension clicked\'">Click me</button><input type="password" value="extension-secret"><a href="http://localhost:1/">Cross site</a></body></html>',
  );
});
await new Promise<void>((resolve) => fixture.listen(0, "127.0.0.1", resolve));
const address = fixture.address();
assert(address && typeof address !== "string");
const profile = mkdtempSync(path.join(os.tmpdir(), "openerx-extension-e2e-"));
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
const signal = AbortSignal.timeout(45000);
try {
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${address.port}/`);
  const popup = await browser.newPage();
  await popup.goto(`chrome-extension://${OPENERX_EXTENSION_ID}/popup.html`);
  await popup.locator("#code").fill(code);
  await popup.locator("#pair").click();
  await popup.waitForFunction(
    () => document.querySelector("#status")?.textContent?.includes("已配对"),
    {},
    { timeout: 10000 },
  );
  await page.bringToFront();
  const authorized = await popup.evaluate(
    async () =>
      await (
        globalThis as unknown as {
          chrome: {
            runtime: { sendMessage(input: { action: string }): Promise<{ error?: string }> };
          };
        }
      ).chrome.runtime.sendMessage({ action: "authorize" }),
  );
  assert(!authorized.error, authorized.error);
  await new Promise((resolve) => setTimeout(resolve, 200));
  const [tab] = bridge.grants.availableAuthorizations();
  assert(tab);
  console.log("EXTENSION_PAIRED_AND_AUTHORIZED");
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
  console.log(
    "EXTENSION_BROWSER_E2E_OK: real unpacked extension, authenticated pairing, exact tab grant, observe, redaction, fill, click, stale observation retry, cross-origin denial, user takeover, resume, detach preserves user tab",
  );
} finally {
  adapter.close();
  bridge.close();
  fixture.close();
  await browser.close();
  rmSync(profile, { recursive: true, force: true });
}
