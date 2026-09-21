import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  type BrowserObservation,
  BROWSER_COMPUTER_USE_CONTRACT_VERSION as contractVersion,
  type NormalizedToolResult,
} from "@openerx/contracts";
import { app, BrowserWindow, nativeImage } from "electron";
import { BrowserSitePermissions } from "../src/main/browser-computer-use/browser-site-permissions";
import { ManagedChromiumDriver } from "../src/main/browser-computer-use/managed-chromium-driver";
import { SystemDefaultBrowserAdapter } from "../src/main/browser-computer-use/system-default-browser-adapter";
import { escapeHtmlText } from "./escape-html-text";

const observe = (result: NormalizedToolResult) =>
  (result.data as { observation: BrowserObservation }).observation;
const profile = mkdtempSync(path.join(tmpdir(), "openerx-managed-permissions-"));
app.setPath("userData", profile);

void app
  .whenReady()
  .then(async () => {
    app.on("window-all-closed", () => {});
    const signal = AbortSignal.timeout(120000);
    const prompts: string[] = [];
    let pendingDecision: (() => void) | undefined;
    let showCancelPrompt: (() => void) | undefined;
    const permissions = new BrowserSitePermissions(profile, async (host) => {
      prompts.push(host);
      if (host === "127.0.0.2")
        return await new Promise<"task">((resolve) => {
          pendingDecision = () => resolve("task");
          showCancelPrompt?.();
        });
      return "task";
    });
    let redirectsReached = 0;
    let hangRequest: (() => void) | undefined;
    console.log("MANAGED_BROWSER_E2E_READY");
    const server = createServer((request, response) => {
      const local = server.address();
      assert(local && typeof local !== "string");
      if (request.url === "/hang") {
        hangRequest?.();
        return;
      }
      if (request.url === "/redirect") {
        response.writeHead(302, { Location: `http://localhost:${local.port}/redirected` });
        response.end();
        return;
      }
      if (request.url === "/cancel-redirect") {
        response.writeHead(302, { Location: `http://127.0.0.2:${local.port}/cancelled` });
        response.end();
        return;
      }
      if (request.url === "/redirected") redirectsReached++;
      response.setHeader("Content-Type", "text/html; charset=utf-8");
      response.end(
        `<html><body><h1>Browser fixture</h1><form action="/done"><label>Search<input name="q"></label><button>Search now</button></form><label>Password<input type="password" value="private-secret"></label><a href="http://localhost:${local.port}/cross" target="_blank">Cross origin</a><button onclick="document.querySelector('h1').textContent='Clicked successfully'">Change title</button><p>${escapeHtmlText(request.url ?? "/")}</p></body></html>`,
      );
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    assert(address && typeof address !== "string");
    const url = `http://127.0.0.1:${address.port}/`;
    const driver = new ManagedChromiumDriver(permissions, false);
    const adapter = new SystemDefaultBrowserAdapter(driver, undefined, undefined, null, driver);
    try {
      const openedResult = await adapter.execute(
        { contractVersion, action: "open", url, requestedBackend: "managed_chromium" },
        signal,
        "e2e-generation",
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
          "e2e-generation",
        ),
      );
      const other = BrowserWindow.getAllWindows().find((w) => w !== window)!;
      assert.equal((await other.webContents.session.cookies.get({ url })).length, 0);
      assert.deepEqual(prompts, ["127.0.0.1"], "task permission is shared across managed windows");
      assert.equal(driver.contexts("e2e-generation").length, 2);
      assert.equal(driver.contexts("another-generation").length, 0);
      await assert.rejects(
        adapter.execute(
          {
            contractVersion,
            action: "open",
            url: `${url}redirect`,
            requestedBackend: "managed_chromium",
          },
          signal,
          "e2e-generation",
        ),
        /BROWSER_NAVIGATION_DENIED/,
      );
      assert.equal(redirectsReached, 0, "blocked redirect must not reach its destination server");
      assert.equal(BrowserWindow.getAllWindows().length, 2, "failed open must clean up its window");
      permissions.update({ action: "site", host: "localhost", decision: "allow" });
      const beforeCross = current;
      current = observe(
        await adapter.execute(
          {
            contractVersion,
            action: "invoke",
            sessionId: current.sessionId,
            observationId: current.observationId,
            target: {
              elementRef: current.elements.find((el) => el.name === "Cross origin")!.elementRef,
            },
          },
          signal,
        ),
      );
      assert.equal(new URL(current.url).hostname, "localhost");
      assert.equal(
        BrowserWindow.getAllWindows().length,
        2,
        "target blank stays in the controlled window",
      );
      await assert.rejects(
        adapter.execute(
          {
            contractVersion,
            action: "reload",
            sessionId: current.sessionId,
            observationId: beforeCross.observationId,
          },
          signal,
        ),
        /BROWSER_OBSERVATION_/,
      );
      for (const action of ["back", "forward", "reload"] as const) {
        current = observe(
          await adapter.execute(
            {
              contractVersion,
              action,
              sessionId: current.sessionId,
              observationId: current.observationId,
            },
            signal,
          ),
        );
        assert.equal(new URL(current.url).hostname, action === "back" ? "127.0.0.1" : "localhost");
      }
      current = observe(
        await adapter.execute(
          {
            contractVersion,
            action: "navigate",
            sessionId: current.sessionId,
            observationId: current.observationId,
            url: `${url}redirect`,
          },
          signal,
        ),
      );
      assert.equal(new URL(current.url).pathname, "/redirected");
      assert.equal(redirectsReached, 1);
      permissions.update({ action: "all_sites", allowed: true });
      permissions.update({ action: "site", host: "localhost", decision: "block" });
      await assert.rejects(
        adapter.execute(
          { contractVersion, action: "observe", sessionId: current.sessionId },
          signal,
        ),
        /BROWSER_NAVIGATION_DENIED/,
      );
      assert(
        !driver
          .contexts("e2e-generation")
          .some((item) => new URL(item.url).hostname === "localhost"),
      );
      permissions.update({ action: "site", host: "localhost", decision: "allow" });
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
      permissions.update({ action: "all_sites", allowed: false });
      const cancel = new AbortController();
      const promptShown = new Promise<void>((resolve) => {
        showCancelPrompt = resolve;
      });
      const opening = adapter.execute(
        {
          contractVersion,
          action: "open",
          url: `${url}cancel-redirect`,
          requestedBackend: "managed_chromium",
        },
        cancel.signal,
        "e2e-generation",
      );
      const rejected = assert.rejects(opening, /BROWSER_CANCELLED/);
      await promptShown;
      cancel.abort();
      pendingDecision?.();
      await rejected;
      assert.equal(
        permissions.allows(`http://127.0.0.2:${address.port}/`, "e2e-generation"),
        false,
      );
      assert.equal(BrowserWindow.getAllWindows().length, 0);

      const cancellable = observe(
        await adapter.execute(
          { contractVersion, action: "open", url, requestedBackend: "managed_chromium" },
          signal,
          "cancel-navigation",
        ),
      );
      const navigating = new AbortController();
      const requested = new Promise<void>((resolve) => {
        hangRequest = resolve;
      });
      const navigationRejected = assert.rejects(
        adapter.execute(
          {
            contractVersion,
            action: "navigate",
            sessionId: cancellable.sessionId,
            observationId: cancellable.observationId,
            url: `${url}hang`,
          },
          navigating.signal,
        ),
        /BROWSER_CANCELLED/,
      );
      await requested;
      navigating.abort();
      await Promise.race([
        navigationRejected,
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("cancelled navigation did not stop")), 3000),
        ),
      ]);
      await adapter.releaseGeneration("cancel-navigation");
      assert.equal(BrowserWindow.getAllWindows().length, 0);

      const detached = observe(
        await adapter.execute(
          { contractVersion, action: "open", url, requestedBackend: "managed_chromium" },
          signal,
          "e2e-generation",
        ),
      );
      const detachedWindow = BrowserWindow.getAllWindows()[0]!;
      const detachedBinding = { descriptor: adapter.descriptor(detached.sessionId) };
      await adapter.execute(
        { contractVersion, action: "detach", sessionId: detached.sessionId },
        signal,
      );
      permissions.release("e2e-generation");
      const previousPrompts = prompts.length;
      await detachedWindow.loadURL(`${url}user-owned`);
      assert.equal(
        prompts.length,
        previousPrompts,
        "detached user window no longer prompts on behalf of a task",
      );
      await driver.closeOwnedWindow(detachedBinding, signal);
      console.log(
        "MANAGED_BROWSER_E2E_OK: shared task/site/all-site permissions, cross-site links, navigation/history/reload, allowed and blocked redirects, cancellation, revocation, stale refs, redaction, profile isolation, user takeover, detach and close",
      );
    } catch (error) {
      console.error(error);
      process.exitCode = 1;
    } finally {
      adapter.close();
      driver.close();
      server.close();
      rmSync(profile, { recursive: true, force: true });
      app.exit(process.exitCode ?? 0);
    }
  })
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
