import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { existsSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";
import { desktopArtifactIdentity } from "./desktop-artifact-identity.mjs";

const desktop = path.resolve(import.meta.dirname, "..");
const product = desktopArtifactIdentity(desktop);
const output = process.env.OPENERX_PACKAGE_OUT_DIR
  ? path.resolve(process.env.OPENERX_PACKAGE_OUT_DIR)
  : path.join(desktop, "out");
const target = `${process.platform}-${process.arch}`;
const packageDirectory = path.join(output, `${product.productName}-${target}`);
const executable =
  process.platform === "win32"
    ? path.join(packageDirectory, `${product.executableName}.exe`)
    : path.join(
        packageDirectory,
        `${product.productName}.app`,
        "Contents",
        "MacOS",
        product.executableName,
      );
if (!["win32", "darwin"].includes(process.platform))
  throw new Error("PACKAGED_SMOKE_HOST_UNSUPPORTED");
if (process.env.OPENERX_BRAND_MANIFEST?.trim())
  throw new Error("PACKAGED_SMOKE_REQUIRES_OPENERX_BRAND");
if (!existsSync(executable)) throw new Error(`PACKAGED_SMOKE_EXECUTABLE_MISSING:${executable}`);
const temporaryRoot = realpathSync(tmpdir());
const profile = mkdtempSync(path.join(temporaryRoot, "openerx-packaged-smoke-"));
const environment = Object.fromEntries(
  Object.entries(process.env).filter(
    ([key]) =>
      !/(?:API.?KEY|TOKEN|SECRET|PASSWORD|^OPENERX_|^ELECTRON_|^NODE_OPTIONS$|^PI_|^CODEX_)/iu.test(
        key,
      ),
  ),
);
Object.assign(environment, {
  OPENERX_E2E: "1",
  OPENERX_E2E_USE_PLATFORM: "1", // real bundled App Service/Pi Host, never test utilities
  OPENERX_E2E_PROFILE_DIR: profile,
  OPENERX_E2E_APPLICATION_NAME: path.basename(profile),
});
let running;
let browser;

async function stop() {
  if (browser?.isConnected()) {
    // Electron can close its CDP socket without acknowledging Browser.close.
    await Promise.race([
      browser
        .newBrowserCDPSession()
        .then((session) => session.send("Browser.close"))
        .catch(() => undefined),
      delay(2_000),
    ]);
    await Promise.race([browser.close().catch(() => undefined), delay(2_000)]);
  }
  browser = undefined;
  if (running && running.exitCode === null && running.signalCode === null) {
    await Promise.race([once(running, "exit"), delay(2_000)]);
    if (running.exitCode === null && running.signalCode === null) {
      if (process.platform === "win32")
        spawnSync("taskkill.exe", ["/PID", String(running.pid), "/T", "/F"], {
          windowsHide: true,
          stdio: "ignore",
        });
      else running.kill("SIGTERM");
      await Promise.race([once(running, "exit"), delay(5_000)]);
    }
  }
  running = undefined;
}

async function start() {
  running = spawn(
    executable,
    ["--remote-debugging-address=127.0.0.1", "--remote-debugging-port=0"],
    {
      cwd: packageDirectory,
      env: environment,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let stderr = "";
  let launchError;
  running.on("error", (error) => {
    launchError = error;
  });
  running.stdout.resume();
  running.stderr.on("data", (chunk) => {
    stderr = (stderr + chunk.toString()).slice(-32_000);
  });
  const deadline = Date.now() + 45_000;
  let endpoint;
  while (Date.now() < deadline) {
    if (launchError) throw launchError;
    endpoint = /DevTools listening on (ws:\/\/127\.0\.0\.1:\d+\/devtools\/browser\/[\w-]+)/u.exec(
      stderr,
    )?.[1];
    if (endpoint) break;
    if (running.exitCode !== null) throw new Error(`PACKAGED_SMOKE_EARLY_EXIT:${running.exitCode}`);
    await delay(100);
  }
  if (!endpoint) throw new Error("PACKAGED_SMOKE_DEBUG_ENDPOINT_TIMEOUT");
  browser = await chromium.connectOverCDP(endpoint, { timeout: 30_000 });
  let page;
  while (Date.now() < deadline) {
    page = browser
      .contexts()
      .flatMap((context) => context.pages())
      .find((candidate) => candidate.url().startsWith("openerx://renderer/"));
    if (page) break;
    await delay(100);
  }
  assert.ok(page, "packaged renderer window missing");
  await page.waitForFunction(() => Boolean(window.openerx), undefined, { timeout: 30_000 });
  console.log("PACKAGED_SMOKE_RENDERER_READY");
  return page;
}

try {
  let page = await start();
  const initial = await page.evaluate(async () => ({
    model: await window.openerx.getModelServiceSettings(),
    skills: await window.openerx.listSkills(),
    automations: await window.openerx.listAutomations(),
    settings: await window.openerx.getMemorySettings(),
    memories: await window.openerx.listMemories(),
    reviews: await window.openerx.listMemoryMergeReviews(),
  }));
  assert.equal(initial.model.mode, "byok");
  assert.equal(initial.model.credentialConfigured, false);
  assert.ok(initial.skills.some((skill) => skill.name === "structured-report"));
  assert.ok(initial.skills.every((skill) => skill.packageState === "installed"));
  assert.deepEqual(initial.automations, []);
  assert.deepEqual(initial.memories, []);
  assert.deepEqual(initial.reviews, []);
  const enabled = !initial.settings.memoriesEnabled;
  console.log("PACKAGED_SMOKE_SERVICES_READY");
  await page.getByRole("link", { name: "自动化", exact: true }).click();
  await page.waitForURL("**/automations");
  await page.getByRole("link", { name: "设置", exact: true }).click();
  await page.getByRole("button", { name: "skill", exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll(".skill-card").length === 5);
  await page.getByRole("button", { name: "记忆", exact: true }).click();
  // This is a server-controlled checkbox: the DOM changes only after IPC saves.
  // A click plus an eventual assertion avoids setChecked's synchronous assertion.
  await page.getByRole("checkbox", { name: /启用长期记忆/u }).click();
  await page.waitForFunction(
    async (value) => (await window.openerx.getMemorySettings()).memoriesEnabled === value,
    enabled,
  );
  console.log("PACKAGED_SMOKE_SETTINGS_UI_OK");
  const changed = await page.evaluate(
    async (memoriesEnabled) =>
      window.openerx.updateMemorySettings({ memoriesEnabled, generateMemories: false }),
    enabled,
  );
  assert.equal(changed.memoriesEnabled, enabled);
  console.log("PACKAGED_SMOKE_MEMORY_SAVED");
  await stop();
  page = await start();
  const restarted = await page.evaluate(async () => ({
    settings: await window.openerx.getMemorySettings(),
    skills: await window.openerx.listSkills(),
    automations: await window.openerx.listAutomations(),
  }));
  assert.equal(restarted.settings.memoriesEnabled, enabled);
  assert.equal(restarted.settings.generateMemories, false);
  assert.deepEqual(
    restarted.skills.map(({ name, version }) => ({ name, version })),
    initial.skills.map(({ name, version }) => ({ name, version })),
  );
  assert.deepEqual(restarted.automations, []);
  console.log(
    `PACKAGED_SMOKE_OK target=${target} real_app_service=true skills=${initial.skills.length} automation=list memory=read-write-restart user_profile=untouched`,
  );
} catch (error) {
  console.error(`PACKAGED_SMOKE_FAILED: ${error.message}`);
  process.exitCode = 1;
} finally {
  await stop();
  const relative = path.relative(temporaryRoot, profile);
  if (
    relative.startsWith("..") ||
    path.isAbsolute(relative) ||
    !path.basename(profile).startsWith("openerx-packaged-smoke-")
  ) {
    console.error("SMOKE_PROFILE_CLEANUP_BOUNDARY_VIOLATION");
    process.exitCode = 1;
  } else {
    rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
}
