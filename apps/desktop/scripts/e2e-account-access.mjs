import assert from "node:assert/strict";
import { fork, spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium, _electron as electron } from "playwright";

const desktopDirectory = path.resolve(import.meta.dirname, "..");
const fixture = path.join(desktopDirectory, ".vite/build/platform-alpha-test.mjs");
const temporary = mkdtempSync(path.join(tmpdir(), "openerx-account-access-"));
const evidence =
  process.env.OPENERX_ACCOUNT_E2E_EVIDENCE ||
  path.join(tmpdir(), "openerx-account-access-evidence");
mkdirSync(evidence, { recursive: true });
let application;
let platform;
const errors = [];

async function launch(profile, platformUrl = "") {
  const env = {
    ...process.env,
    OPENERX_E2E: "1",
    OPENERX_E2E_APPLICATION_NAME: `openerx CX110 D3 ${path.basename(temporary)}`,
    OPENERX_E2E_USE_PLATFORM: "1",
    OPENERX_E2E_PROFILE_DIR: path.join(temporary, profile),
    OPENERX_PLATFORM_URL: platformUrl,
    OPENERX_DEV_AUTO_SIGN_IN: "0",
  };
  let page;
  if (process.env.OPENERX_ACCOUNT_E2E_EXECUTABLE) {
    // Packaged apps disable Node's inspector. Use Chromium's loopback-only test connection.
    const child = spawn(
      process.env.OPENERX_ACCOUNT_E2E_EXECUTABLE,
      ["--remote-debugging-address=127.0.0.1", "--remote-debugging-port=0"],
      { cwd: desktopDirectory, env, stdio: ["ignore", "ignore", "pipe"] },
    );
    const exited = new Promise((resolve) => child.once("exit", resolve));
    application = {
      close: async () => {
        child.kill();
        await exited;
      },
    };
    const endpoint = await new Promise((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("Packaged browser connection timed out")),
        15_000,
      );
      let output = "";
      child.once("error", (error) => {
        clearTimeout(timeout);
        reject(error);
      });
      child.stderr.on("data", (chunk) => {
        output += chunk.toString();
        const match = output.match(/DevTools listening on (ws:\/\/[^\s]+)/);
        if (match) {
          clearTimeout(timeout);
          resolve(match[1]);
        }
      });
    });
    const browser = await chromium.connectOverCDP(endpoint);
    const context = browser.contexts()[0];
    page = context.pages()[0] ?? (await context.waitForEvent("page"));
    application = {
      close: async () => {
        await browser.close();
        child.kill();
        const timeout = setTimeout(() => child.kill("SIGKILL"), 3_000);
        await exited;
        clearTimeout(timeout);
      },
    };
  } else {
    application = await electron.launch({
      args: [path.join(desktopDirectory, ".vite/build/main.js")],
      cwd: desktopDirectory,
      env,
    });
    page = await application.firstWindow();
  }
  page.on("pageerror", (error) => errors.push(error.message));
  page.setDefaultTimeout(15_000);
  await page.waitForLoadState("domcontentloaded");
  return page;
}

async function screenshot(page, name) {
  await page.screenshot({ path: path.join(evidence, `${name}.png`) });
}

async function assertAccessible(page, buttonName) {
  const button = page.getByRole("button", { name: buttonName, exact: true });
  await button.scrollIntoViewIfNeeded();
  assert.equal(
    await button.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return (
        rect.left >= 0 &&
        rect.right <= innerWidth &&
        rect.top >= 0 &&
        rect.bottom <= innerHeight &&
        element.contains(
          document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2),
        )
      );
    }),
    true,
    `${buttonName} must remain visible and clickable`,
  );
  assert.equal(
    await page
      .locator(".settings-section-content")
      .evaluate((element) => element.scrollWidth <= element.clientWidth + 1),
    true,
    "account page must not overflow horizontally",
  );
}

try {
  let page = await launch("local");
  await page.locator(".sidebar-account").getByText("本机模式", { exact: true }).waitFor();
  await page.locator(".sidebar-account").click();
  await page.getByRole("heading", { name: "欢迎使用 openerx" }).waitFor();
  assert.equal(await page.getByLabel("邮箱", { exact: true }).count(), 0);
  await assertAccessible(page, "直接使用");
  await screenshot(page, "account-local");
  await page.getByRole("button", { name: "配置自有 API Key 或本地模型" }).click();
  await page.locator("#model-section").waitFor();
  await page.getByRole("button", { name: "账户", exact: true }).click();
  await page.getByRole("button", { name: "直接使用", exact: true }).click();
  await page.getByLabel("发送消息", { exact: true }).waitFor();
  assert.equal((await page.evaluate(() => window.openerx.getAccountState())).status, "unavailable");
  await application.close();
  application = undefined;

  platform = fork(fixture, [], { stdio: ["ignore", "pipe", "pipe", "ipc"] });
  platform.stderr?.pipe(process.stderr);
  const platformUrl = await new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("Account fixture readiness timed out")),
      10_000,
    );
    platform.once("error", reject);
    platform.on("message", (message) => {
      if (message?.kind === "platform-alpha.ready") {
        clearTimeout(timeout);
        resolve(message.baseUrl);
      }
    });
  });

  page = await launch("cloud", platformUrl);
  await page.locator(".sidebar-account").click();
  await page.getByRole("heading", { name: "登录或注册" }).waitFor();
  await screenshot(page, "account-email");
  await page.getByLabel("邮箱", { exact: true }).fill("account-access-e2e@example.com");
  await page.getByRole("button", { name: "发送验证码", exact: true }).click();
  await page.getByRole("heading", { name: "输入验证码" }).waitFor();
  assert.equal(await page.getByLabel("邮箱", { exact: true }).count(), 0);
  await page.getByLabel("六位验证码").fill("000000");
  await page.getByRole("button", { name: "验证并登录" }).click();
  await page.getByRole("alert").filter({ hasText: "验证码不正确" }).waitFor();
  await screenshot(page, "account-code-retry");
  await page.setViewportSize({ width: 640, height: 620 });
  await page.waitForFunction(() => innerWidth === 640);
  await assertAccessible(page, "验证并登录");
  await assertAccessible(page, "直接使用");
  await screenshot(page, "account-code-small");
  await page.setViewportSize({ width: 1200, height: 800 });
  await page.getByLabel("六位验证码").fill("123456");
  await page.getByRole("button", { name: "验证并登录" }).click();
  try {
    await page
      .getByLabel("账户状态", { exact: true })
      .getByText("已登录", { exact: true })
      .waitFor();
  } catch (error) {
    console.error("ACCOUNT_SIGN_IN_FAILURE", await page.locator("body").innerText());
    throw error;
  }
  await screenshot(page, "account-signed-in");
  await page.evaluate(() => localStorage.setItem("openerx.theme", "dark"));
  await application.close();
  application = undefined;

  page = await launch("cloud", platformUrl);
  await page
    .locator(".sidebar-account")
    .getByText("account-access-e2e@example.com", { exact: true })
    .waitFor();
  await page.locator(".sidebar-account").click();
  await page.getByRole("heading", { name: "你的账号" }).waitFor();
  await screenshot(page, "account-signed-in-dark");
  await page.getByRole("button", { name: "退出此设备", exact: true }).click();
  await page.getByRole("heading", { name: "登录或注册" }).waitFor();
  await assertAccessible(page, "直接使用");
  await screenshot(page, "account-email-dark");
  await page.getByRole("button", { name: "直接使用", exact: true }).click();
  await page.getByLabel("发送消息", { exact: true }).waitFor();
  assert.deepEqual(errors, []);
  console.log(
    `ACCOUNT_ACCESS_OK local-use model-setup email-code retry small-window sign-in restart-restore sign-out dark-theme evidence=${evidence}`,
  );
} finally {
  await application?.close();
  platform?.kill();
  rmSync(temporary, { recursive: true, force: true });
}
