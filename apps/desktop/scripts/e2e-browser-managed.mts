import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import {
  type BrowserObservation,
  BROWSER_COMPUTER_USE_CONTRACT_VERSION as contractVersion,
  type NormalizedToolResult,
} from "@openerx/contracts";
import { app, BrowserWindow, nativeImage } from "electron";
import { ManagedChromiumDriver } from "../src/main/browser-computer-use/managed-chromium-driver";
import { SystemDefaultBrowserAdapter } from "../src/main/browser-computer-use/system-default-browser-adapter";

const observe = (result: NormalizedToolResult) =>
  (result.data as { observation: BrowserObservation }).observation;

void app
  .whenReady()
  .then(async () => {
    app.on("window-all-closed", () => {});
    const signal = AbortSignal.timeout(45000);
    console.log("MANAGED_BROWSER_E2E_READY");
    const server = createServer((request, response) => {
      response.setHeader("Content-Type", "text/html; charset=utf-8");
      response.end(
        `<html><body><h1>Browser fixture</h1><form action="/done"><label>Search<input name="q"></label><button>Search now</button></form><label>Password<input type="password" value="private-secret"></label><a href="http://localhost:1/denied">Cross origin</a><button onclick="document.querySelector('h1').textContent='Clicked successfully'">Change title</button><p>${request.url}</p></body></html>`,
      );
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    assert(address && typeof address !== "string");
    const url = `http://127.0.0.1:${address.port}/`;
    const driver = new ManagedChromiumDriver(false);
    const adapter = new SystemDefaultBrowserAdapter(driver, undefined, undefined, null, driver);
    try {
      const openedResult = await adapter.execute(
        { contractVersion, action: "open", url, requestedBackend: "managed_chromium" },
        signal,
      );
      let current = observe(openedResult);
      assert.equal(current.backend, "managed_chromium");
      assert.equal(current.profilePersistence, "ephemeral");
      assert.equal(current.elements.find((el) => el.sensitiveKind === "password")?.value, null);
      assert(!JSON.stringify(openedResult).includes("private-secret"));
      const image = openedResult.content.find((item) => item.type === "image");
      assert(image?.type === "image");
      mkdirSync(".vite/browser-managed/evidence", { recursive: true });
      writeFileSync(".vite/browser-managed/evidence/open.png", Buffer.from(image.data, "base64"));
      const password = current.elements.find((el) => el.sensitiveKind === "password")!;
      const screenshot = nativeImage.createFromBuffer(Buffer.from(image.data, "base64"));
      const size = screenshot.getSize();
      const x = Math.floor(((password.bounds.x + 5) * size.width) / current.viewport.width),
        y = Math.floor(((password.bounds.y + 5) * size.height) / current.viewport.height);
      assert.equal(screenshot.toBitmap().readUInt32LE((y * size.width + x) * 4), 0xff303030);
      const old = current;
      const search = current.elements.find(
        (el) => el.name === "Search" && el.actions.includes("setValue"),
      );
      assert(search);
      current = observe(
        await adapter.execute(
          {
            contractVersion,
            action: "setValue",
            sessionId: current.sessionId,
            observationId: current.observationId,
            target: { elementRef: search.elementRef },
            text: "openerx",
          },
          signal,
        ),
      );
      assert.equal(
        current.elements.find((el) => el.name === "Search" && el.actions.includes("setValue"))
          ?.value,
        "openerx",
      );
      await assert.rejects(
        adapter.execute(
          {
            contractVersion,
            action: "setValue",
            sessionId: old.sessionId,
            observationId: old.observationId,
            target: { elementRef: search.elementRef },
            text: "stale",
          },
          signal,
        ),
        /BROWSER_OBSERVATION_/,
      );
      const change = current.elements.find((el) => el.name === "Change title");
      assert(change);
      current = observe(
        await adapter.execute(
          {
            contractVersion,
            action: "invoke",
            sessionId: current.sessionId,
            observationId: current.observationId,
            target: { elementRef: change.elementRef },
          },
          signal,
        ),
      );
      assert(current.elements.some((el) => el.name === "Clicked successfully"));
      const cross = current.elements.find((el) => el.name === "Cross origin");
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
      current = observe(
        await adapter.execute(
          { contractVersion, action: "observe", sessionId: current.sessionId },
          signal,
        ),
      );
      const button = current.elements.find((el) => el.name === "Search now");
      assert(button);
      current = observe(
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
      assert(current.url.includes("/done?q=openerx"));
      const window = BrowserWindow.getAllWindows()[0]!;
      await window.webContents.session.cookies.set({ url, name: "isolated", value: "first" });
      const second = observe(
        await adapter.execute(
          { contractVersion, action: "open", url, requestedBackend: "managed_chromium" },
          signal,
        ),
      );
      const other = BrowserWindow.getAllWindows().find((w) => w !== window)!;
      assert.equal((await other.webContents.session.cookies.get({ url })).length, 0);
      window.webContents.sendInputEvent({
        type: "mouseDown",
        x: 25,
        y: 25,
        button: "left",
        clickCount: 1,
      });
      window.webContents.sendInputEvent({
        type: "mouseUp",
        x: 25,
        y: 25,
        button: "left",
        clickCount: 1,
      });
      await new Promise((resolve) => setTimeout(resolve, 300));
      await assert.rejects(
        adapter.execute(
          { contractVersion, action: "observe", sessionId: current.sessionId },
          signal,
        ),
        /BROWSER_USER_TAKEOVER_REQUIRED/,
      );
      current = observe(await adapter.resumeAfterUser(current.sessionId, signal));
      await adapter.execute(
        {
          contractVersion,
          action: "close",
          sessionId: current.sessionId,
          observationId: current.observationId,
        },
        signal,
      );
      await adapter.execute(
        {
          contractVersion,
          action: "close",
          sessionId: second.sessionId,
          observationId: second.observationId,
        },
        signal,
      );
      console.log(
        "MANAGED_BROWSER_E2E_OK: open, fill, invoke, navigation, stale refs, cross-origin denial, screenshot redaction, profile isolation, user takeover, resume, close",
      );
    } catch (error) {
      console.error(error);
      process.exitCode = 1;
    } finally {
      adapter.close();
      driver.close();
      server.close();
      app.exit(process.exitCode ?? 0);
    }
  })
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
