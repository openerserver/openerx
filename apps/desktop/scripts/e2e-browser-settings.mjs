import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { _electron as electron } from "playwright";

const desktopDirectory = path.resolve(import.meta.dirname, "..");
const profile = mkdtempSync(path.join(tmpdir(), "openerx-browser-settings-"));
let application;
try {
  application = await electron.launch({
    args: [desktopDirectory],
    cwd: desktopDirectory,
    env: {
      ...process.env,
      OPENERX_E2E: "1",
      OPENERX_E2E_USE_PLATFORM: "1",
      OPENERX_PLATFORM_URL: "",
      OPENERX_DEV_AUTO_SIGN_IN: "0",
      OPENERX_E2E_PROFILE_DIR: profile,
    },
  });
  const page = await application.firstWindow();
  await page.getByRole("link", { name: "设置", exact: true }).click();
  await page.getByRole("button", { name: "工具", exact: true }).click();
  const row = page.locator(".tool-library-row").filter({ hasText: "浏览器操作" });
  await row.getByRole("button", { name: "设置", exact: true }).click();
  const panel = page.getByRole("region", { name: "浏览器连接设置" });
  await panel.getByRole("heading", { name: "网站访问权限", exact: true }).waitFor();
  assert((await panel.textContent()).includes("Chrome 和独立浏览器共用以下规则"));
  await panel.getByLabel("默认浏览器模式").selectOption("managed_chromium");
  await page.waitForFunction(
    async () => (await window.openerx.getBrowserConnectionState()).mode === "managed_chromium",
  );
  await panel.getByRole("checkbox").click();
  await page.waitForFunction(
    () =>
      document.querySelector('section[aria-label="浏览器连接设置"] input[type="checkbox"]')
        ?.checked,
  );
  await panel.getByLabel("网站域名").fill("example.com");
  await panel.getByRole("button", { name: "阻止此网站", exact: true }).click();
  await panel.getByRole("button", { name: "移除 example.com" }).waitFor();
  let state = await page.evaluate(() => window.openerx.getBrowserConnectionState());
  assert.equal(state.sitePolicy.allowAllSites, true);
  assert.deepEqual(state.sitePolicy.blockedHosts, ["example.com"]);
  await panel.getByRole("button", { name: "准备 Chrome 扩展" }).click();
  await panel.getByLabel("Chrome 配对码").waitFor();
  const code = await panel.getByLabel("Chrome 配对码").inputValue();
  assert.match(code, /^http:\/\/127\.0\.0\.1:\d+#[\w-]{43}$/u);
  // Keep pairing credentials out of screenshots and logs.
  await panel.getByLabel("Chrome 配对码").evaluate((element) => {
    element.value = "";
  });
  const evidence = path.join(desktopDirectory, ".vite/browser-extension-e2e");
  mkdirSync(evidence, { recursive: true });
  await page.screenshot({ path: path.join(evidence, "settings.png"), fullPage: true });
  await panel.getByRole("checkbox").scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(evidence, "site-permissions.png"), fullPage: true });
  await panel.getByRole("button", { name: "移除 example.com" }).click();
  await panel.getByRole("checkbox").click();
  await page.waitForFunction(
    () =>
      document.querySelector('section[aria-label="浏览器连接设置"] input[type="checkbox"]')
        ?.checked === false,
  );
  await panel.getByRole("button", { name: "断开浏览器并清除配对" }).click();
  state = await page.evaluate(() => window.openerx.getBrowserConnectionState());
  assert.equal(state.sitePolicy.allowAllSites, false);
  assert.deepEqual(state.sitePolicy.blockedHosts, []);
  const refreshed = await page.evaluate(() => window.openerx.prepareBrowserExtension());
  assert.notEqual(refreshed.pairingCode, code);
  await page.reload();
  const persisted = await page.evaluate(() => window.openerx.getBrowserConnectionState());
  assert.deepEqual(persisted.sitePolicy, state.sitePolicy);
  console.log(
    "BROWSER_SETTINGS_E2E_OK: rendered controls, trusted IPC, persistent site rules, pairing revocation",
  );
} catch (error) {
  if (application) {
    const page = await application.firstWindow();
    console.error(await page.getByRole("alert").allTextContents());
  }
  throw error;
} finally {
  await application?.close();
  rmSync(profile, { recursive: true, force: true });
}
