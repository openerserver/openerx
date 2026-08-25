import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { _electron as electron } from "playwright";

const desktopDirectory = path.resolve(import.meta.dirname, "..");
const mainEntry = path.join(desktopDirectory, ".vite", "build", "main.js");
const platformEntry = path.join(desktopDirectory, ".vite", "build", "platform-alpha-test.mjs");
const profileDirectory = mkdtempSync(path.join(tmpdir(), "openerx-account-e2e-"));

const platform = fork(platformEntry, [], { stdio: ["ignore", "pipe", "pipe", "ipc"] });
platform.stderr?.pipe(process.stderr);
const platformUrl = await new Promise((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error("Platform Alpha readiness timed out")), 10_000);
  platform.once("error", reject);
  platform.on("message", (message) => {
    if (message?.kind === "platform-alpha.ready") {
      clearTimeout(timeout);
      resolve(message.baseUrl);
    }
  });
});

async function launch() {
  const application = await electron.launch({
    args: [mainEntry],
    cwd: desktopDirectory,
    env: {
      ...process.env,
      OPENERX_E2E: "1",
      OPENERX_E2E_USE_PLATFORM: "1",
      OPENERX_E2E_PROFILE_DIR: profileDirectory,
      OPENERX_PLATFORM_URL: platformUrl,
    },
  });
  const page = await application.firstWindow();
  await page.waitForLoadState("domcontentloaded");
  page.on("pageerror", (error) => console.error("E2E_ACCOUNT_PAGE_ERROR", error));
  return { application, page };
}

async function signInDevice(email, name) {
  const challenge = await fetch(`${platformUrl}/api/v2/account/challenges`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email }),
  }).then((response) => response.json());
  return await fetch(`${platformUrl}/api/v2/account/sessions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      challengeId: challenge.challengeId,
      code: "123456",
      device: {
        deviceId: crypto.randomUUID(),
        name,
        platform: "win32",
        arch: "x64",
      },
    }),
  }).then((response) => response.json());
}

let running;
try {
  running = await launch();
  let { application, page } = running;
  await page.getByRole("link", { name: "设置" }).click();
  await page.getByLabel("邮箱").fill("account-e2e@example.com");
  await page.getByRole("button", { name: "发送验证码" }).click();
  await page.getByLabel("六位验证码").fill("123456");
  await page.getByRole("button", { name: "验证并登录" }).click();
  try {
    await page.getByLabel("账户状态").getByText("signed_in", { exact: true }).waitFor();
  } catch (error) {
    console.error("E2E_ACCOUNT_SIGN_IN_STATE\n", await page.locator("body").innerText());
    throw error;
  }

  const credentialPath = path.join(profileDirectory, "account", "device-session.bin");
  assert.equal(existsSync(credentialPath), true);
  assert.equal(readFileSync(credentialPath).toString().includes("account-e2e@example.com"), false);

  await page.getByRole("link", { name: "＋ 新对话" }).click();
  await page.getByLabel("发送消息").fill("账户模型测试");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  try {
    await page.locator(".message-assistant[data-message-status='completed']").waitFor();
  } catch (error) {
    console.error("E2E_ACCOUNT_FIRST_MODEL_STATE\n", await page.locator("body").innerText());
    throw error;
  }
  await page
    .getByLabel("对话消息")
    .getByText(/平台 platform\/standard 已回答：账户模型测试/)
    .waitFor();
  await page.getByLabel("消息 Token 用量").waitFor();
  await page.getByText(/总计 35/).waitFor();
  await page.getByLabel("消息模型执行详情").getByText("选择 platform/auto").waitFor();
  await page.getByLabel("消息模型执行详情").getByText("实际 platform/standard").waitFor();
  await page.getByLabel("后续消息模型").selectOption("platform/tools");
  await page.getByLabel("发送消息").fill("切换后的消息");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await page
    .getByLabel("对话消息")
    .getByText(/平台 platform\/tools 已回答：切换后的消息/)
    .waitFor();
  const conversationUrl = page.url();

  await application.close();
  running = await launch();
  ({ application, page } = running);
  await page.locator(".sidebar-account").getByText("signed_in", { exact: true }).waitFor();
  const accountConversation = page.getByRole("link", { name: /账户模型测试/ });
  await accountConversation.waitFor();
  await accountConversation.click();
  assert.equal(page.url(), conversationUrl);
  await page
    .getByLabel("对话消息")
    .getByText(/平台 platform\/tools 已回答：切换后的消息/)
    .waitFor();

  const otherDevice = await signInDevice("account-e2e@example.com", "E2E Windows");

  await page.getByRole("link", { name: "设置" }).click();
  await page.getByRole("button", { name: "刷新设备" }).click();
  const otherDeviceCard = page.getByLabel("设备会话").locator(".device-card", {
    hasText: "E2E Windows",
  });
  await otherDeviceCard.waitFor();
  await otherDeviceCard.getByRole("button", { name: "撤销设备" }).click();
  await otherDeviceCard.getByText(/已撤销/).waitFor();
  const revokedResponse = await fetch(`${platformUrl}/api/v2/models`, {
    headers: { authorization: `Bearer ${otherDevice.accessToken}` },
  });
  assert.equal(revokedResponse.status, 401);
  await page
    .getByLabel("账户 Token 用量")
    .getByText(/总计 70/)
    .waitFor();
  await page
    .getByLabel("同步状态")
    .getByText(/待上传 0 · 冲突 0/)
    .waitFor();

  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "清理本机缓存" }).click();
  await page.getByText("本机缓存已清理。", { exact: true }).waitFor();
  await page.getByRole("button", { name: "立即同步" }).click();
  await page.getByRole("link", { name: /账户模型测试/ }).waitFor();

  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "删除云端对话数据" }).click();
  await page.getByText(/墓碑保留至/).waitFor();
  await page.getByRole("button", { name: "立即同步" }).click();
  await page.getByRole("link", { name: /账户模型测试/ }).waitFor({ state: "detached" });

  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "退出全部设备" }).click();
  await page.getByLabel("账户状态").getByText("signed_out", { exact: true }).waitFor();
  assert.equal(existsSync(credentialPath), false);

  console.log(
    "E2E_ACCOUNT_OK login-keychain-auto-model-effective-usage-device-revoke-cache-cloud-delete-signout-all",
  );
  await application.close();
  running = undefined;
} finally {
  if (running) await running.application.close().catch(() => undefined);
  platform.send("shutdown");
  await new Promise((resolve) => platform.once("exit", resolve));
  rmSync(profileDirectory, { recursive: true, force: true });
}
