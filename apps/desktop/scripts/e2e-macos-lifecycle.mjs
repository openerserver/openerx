import assert from "node:assert/strict";
import { fork, spawn, spawnSync } from "node:child_process";
import { createHash, createHmac } from "node:crypto";
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium } from "playwright";
import { desktopArtifactIdentity } from "./desktop-artifact-identity.mjs";

if (process.platform !== "darwin") throw new Error("D3_MACOS_RUNNER_REQUIRED");

const desktopDirectory = path.resolve(import.meta.dirname, "..");
const product = desktopArtifactIdentity(desktopDirectory);
const sourceApp = path.join(
  desktopDirectory,
  "out",
  `${product.productName}-darwin-${process.arch}`,
  `${product.productName}.app`,
);
const platformEntry = path.join(desktopDirectory, ".vite", "build", "platform-alpha-test.mjs");
const identity = process.env.OPENERX_MAC_SIGN_IDENTITY?.trim();
if (!identity) throw new Error("D3_MAC_SIGN_IDENTITY_REQUIRED");
if (!existsSync(sourceApp)) throw new Error("D3_SIGNED_APP_NOT_FOUND");
if (!existsSync(platformEntry)) throw new Error("D3_PLATFORM_FIXTURE_NOT_BUILT");

const root = mkdtempSync(path.join(tmpdir(), "openerx-cx110-d3-"));
const keychainApplicationName = `OpenERX CX110 D3 ${path.basename(root).split("-").at(-1)}`;
const candidates = path.join(root, "candidates");
const installedApp = path.join(root, "Applications", `${product.productName}.app`);
const profileDirectory = path.join(root, "profile");
const entitlements = path.join(desktopDirectory, "resources", "entitlements.mac.plist");
const textEditToken = `cx110d3${path.basename(root).split("-").at(-1)?.toLowerCase()}`;
const textEditPath = path.join(root, `${textEditToken}.txt`);
const runtimeVersion = JSON.parse(
  readFileSync(path.join(desktopDirectory, "package.json"), "utf8"),
).version;

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: "utf8", ...options });
  if (result.status !== 0) {
    throw new Error(
      `D3_COMMAND_FAILED:${command}:${result.status}\n${result.stdout ?? ""}\n${result.stderr ?? ""}`,
    );
  }
  return `${result.stdout ?? ""}${result.stderr ?? ""}`;
}

function ditto(source, destination) {
  run("/usr/bin/ditto", [source, destination]);
}

function verifySigned(appPath) {
  run("/usr/bin/codesign", ["--verify", "--deep", "--strict", "--verbose=2", appPath]);
  const details = run("/usr/bin/codesign", ["-dv", "--verbose=4", appPath]);
  assert.match(details, /Authority=Developer ID Application:/u);
  assert.match(details, /TeamIdentifier=[A-Z0-9]{10}/u);
  assert.match(details, /flags=0x[0-9a-f]+\(runtime\)/u);
}

function requirement(appPath) {
  const output = run("/usr/bin/codesign", ["-dr", "-", appPath]);
  const match = /designated => (.+)$/mu.exec(output);
  if (!match?.[1]) throw new Error("D3_DESIGNATED_REQUIREMENT_MISSING");
  return match[1].trim();
}

function candidate(label, version) {
  const target = path.join(candidates, `${label}.app`);
  ditto(sourceApp, target);
  const plist = path.join(target, "Contents", "Info.plist");
  run("/usr/libexec/PlistBuddy", ["-c", `Set :CFBundleShortVersionString ${version}`, plist]);
  run("/usr/libexec/PlistBuddy", ["-c", `Set :CFBundleVersion ${version}`, plist]);
  const marker = spawnSync(
    "/usr/libexec/PlistBuddy",
    ["-c", `Add :OpenERXLifecycleMarker string ${label}`, plist],
    { encoding: "utf8" },
  );
  if (marker.status !== 0) {
    run("/usr/libexec/PlistBuddy", ["-c", `Set :OpenERXLifecycleMarker ${label}`, plist]);
  }
  run("/usr/bin/codesign", [
    "--force",
    "--sign",
    identity,
    "--timestamp",
    "--options",
    "runtime",
    "--entitlements",
    entitlements,
    target,
  ]);
  verifySigned(target);
  return { label, version, path: target, requirement: requirement(target) };
}

function install(appPath) {
  const stage = path.join(root, "Applications", `.${product.productName}.next.app`);
  const previous = path.join(root, "Applications", `.${product.productName}.previous.app`);
  rmSync(stage, { recursive: true, force: true });
  rmSync(previous, { recursive: true, force: true });
  ditto(appPath, stage);
  verifySigned(stage);
  if (existsSync(installedApp)) renameSync(installedApp, previous);
  renameSync(stage, installedApp);
  verifySigned(installedApp);
  rmSync(previous, { recursive: true, force: true });
}

function assertInstalledVersion(expectedVersion) {
  const plist = path.join(installedApp, "Contents", "Info.plist");
  const installedVersion = run("/usr/libexec/PlistBuddy", [
    "-c",
    "Print :CFBundleShortVersionString",
    plist,
  ]).trim();
  assert.equal(installedVersion, expectedVersion);
}

async function openTextEditTarget() {
  writeFileSync(textEditPath, "CX110_D3_INITIAL\n", { encoding: "utf8", mode: 0o600 });
  run("/usr/bin/open", ["-a", "TextEdit", textEditPath]);
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const probe = spawnSync(
      "/usr/bin/osascript",
      [
        "-e",
        'on run argv\ntell application id "com.apple.TextEdit"\nif (count of documents) > 0 and (name of front document contains item 1 of argv) then return "ready"\nend tell\nreturn "waiting"\nend run',
        "--",
        textEditToken,
      ],
      { encoding: "utf8" },
    );
    if (probe.status === 0 && probe.stdout.trim() === "ready") return;
    await delay(100);
  }
  throw new Error("D3_TEXTEDIT_TARGET_TIMEOUT");
}

function textEditContent() {
  return run("/usr/bin/osascript", [
    "-e",
    'on run argv\ntell application id "com.apple.TextEdit"\nif (count of documents) is 0 or (name of front document does not contain item 1 of argv) then error "D3_TEXTEDIT_TARGET_CHANGED"\nreturn text of front document\nend tell\nend run',
    "--",
    textEditToken,
  ]);
}

function closeTextEditTarget() {
  spawnSync(
    "/usr/bin/osascript",
    [
      "-e",
      'on run argv\ntell application id "com.apple.TextEdit"\nif (count of documents) > 0 and (name of front document contains item 1 of argv) then close front document saving no\nend tell\nend run',
      "--",
      textEditToken,
    ],
    { encoding: "utf8" },
  );
}

function sha256(filePath) {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

function assertCredentialProtected(credentialPath) {
  const bytes = readFileSync(credentialPath);
  assert.ok(bytes.length > 32);
  assert.equal(bytes.toString("utf8").includes("cx110-d3@example.com"), false);
}

function findNamed(directory, fileName) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) return findNamed(absolute, fileName);
    return entry.isFile() && entry.name === fileName ? [absolute] : [];
  });
}

function delay(durationMs) {
  return new Promise((resolve) => setTimeout(resolve, durationMs));
}

async function eventually(operation, code, child, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`${code}:APP_EXITED:${child.exitCode}`);
    try {
      const value = await operation();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await delay(100);
  }
  throw new Error(`${code}:${lastError instanceof Error ? lastError.message : "TIMEOUT"}`);
}

const platform = fork(platformEntry, [], { stdio: ["ignore", "pipe", "pipe", "ipc"] });
platform.stderr?.pipe(process.stderr);
const platformUrl = await new Promise((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error("D3_PLATFORM_READINESS_TIMEOUT")), 10_000);
  platform.once("error", reject);
  platform.on("message", (message) => {
    if (message?.kind === "platform-alpha.ready") {
      clearTimeout(timeout);
      resolve(message.baseUrl);
    }
  });
});

async function launch() {
  const devToolsActivePort = path.join(profileDirectory, "DevToolsActivePort");
  rmSync(devToolsActivePort, { force: true });
  const child = spawn(
    path.join(installedApp, "Contents", "MacOS", product.executableName),
    ["--remote-debugging-port=0"],
    {
      cwd: path.dirname(installedApp),
      env: {
        ...process.env,
        OPENERX_E2E: "1",
        OPENERX_E2E_USE_PLATFORM: "1",
        OPENERX_E2E_PROFILE_DIR: profileDirectory,
        OPENERX_E2E_APPLICATION_NAME: keychainApplicationName,
        OPENERX_PLATFORM_URL: platformUrl,
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  child.stdout?.pipe(process.stdout);
  child.stderr?.pipe(process.stderr);

  const port = await eventually(
    () => {
      if (!existsSync(devToolsActivePort)) return null;
      const parsed = Number.parseInt(
        readFileSync(devToolsActivePort, "utf8").split(/\r?\n/u)[0],
        10,
      );
      return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
    },
    "D3_DEVTOOLS_PORT_TIMEOUT",
    child,
  );
  const browser = await eventually(
    () => chromium.connectOverCDP(`http://127.0.0.1:${port}`),
    "D3_CDP_CONNECTION_TIMEOUT",
    child,
  );
  const context = browser.contexts()[0];
  if (!context) throw new Error("D3_CDP_CONTEXT_MISSING");
  const page = await eventually(
    () => context.pages().find((candidatePage) => candidatePage.url().startsWith("openerx://")),
    "D3_RENDERER_WINDOW_TIMEOUT",
    child,
  );
  page.setDefaultTimeout(20_000);
  page.setDefaultNavigationTimeout(20_000);
  await page.locator("body").waitFor();
  page.on("pageerror", (error) => console.error("D3_PAGE_ERROR", error));
  return {
    child,
    page,
    async close() {
      const exited =
        child.exitCode === null
          ? new Promise((resolve) => child.once("exit", resolve))
          : Promise.resolve();
      await browser.close().catch(() => undefined);
      if (child.exitCode === null) child.kill("SIGTERM");
      await Promise.race([
        exited,
        delay(10_000).then(() => {
          if (child.exitCode === null) throw new Error("D3_APP_SHUTDOWN_TIMEOUT");
        }),
      ]);
    },
  };
}

async function signInAndFund(page) {
  const email = "cx110-d3@example.com";
  await page.getByRole("link", { name: "设置" }).click();
  await page.getByLabel("邮箱").fill(email);
  await page.getByRole("button", { name: "发送验证码" }).click();
  await page.getByLabel("六位验证码").fill("123456");
  await page.getByRole("button", { name: "验证并登录" }).click();
  await page.getByLabel("账户状态").getByText("已登录", { exact: true }).waitFor();

  const challenge = await fetch(`${platformUrl}/api/v2/account/challenges`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email }),
  }).then((response) => response.json());
  const session = await fetch(`${platformUrl}/api/v2/account/sessions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      challengeId: challenge.challengeId,
      code: "123456",
      device: {
        deviceId: crypto.randomUUID(),
        name: "CX-110-D3 billing setup",
        platform: "darwin",
        arch: process.arch,
      },
    }),
  }).then((response) => response.json());
  const authorization = {
    authorization: `Bearer ${session.accessToken}`,
    "content-type": "application/json",
  };
  const termsState = await fetch(`${platformUrl}/api/v2/billing/terms`, {
    headers: authorization,
  }).then((response) => response.json());
  await fetch(`${platformUrl}/api/v2/billing/terms/accept`, {
    method: "POST",
    headers: authorization,
    body: JSON.stringify({ version: termsState.terms.version }),
  });
  const order = await fetch(`${platformUrl}/api/v2/billing/recharge-orders`, {
    method: "POST",
    headers: authorization,
    body: JSON.stringify({
      amountMinor: 5_000,
      provider: "alipay",
      idempotencyKey: "cx110-d3-lifecycle-funding",
    }),
  }).then((response) => response.json());
  const unsigned = {
    eventId: crypto.randomUUID(),
    orderId: order.orderId,
    providerReference: `cx110-d3-${order.orderId}`,
    amountMinor: order.amountMinor,
    currency: "CNY",
    status: "succeeded",
    occurredAt: new Date().toISOString(),
  };
  const canonical = [
    unsigned.eventId,
    unsigned.orderId,
    unsigned.providerReference,
    unsigned.amountMinor,
    unsigned.currency,
    unsigned.status,
    unsigned.occurredAt,
  ].join("|");
  const signature = createHmac("sha256", "openerx-m3-e2e-alipay")
    .update(canonical, "utf8")
    .digest("hex");
  const funded = await fetch(`${platformUrl}/api/v2/payment/callback`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...unsigned, signature }),
  });
  assert.equal(funded.status, 200);
}

async function approveDesktopPermission(page, action, bundleId) {
  await page
    .getByText(`控制桌面应用 TextEdit (${bundleId})：${action}`, { exact: true })
    .locator("..")
    .getByRole("button", { name: "仅本次允许" })
    .click();
}

async function startD3Conversation(page, text) {
  const receipt = await page.evaluate(
    async (prompt) =>
      await window.openerx.sendMessage({
        conversationId: null,
        text: prompt,
        thinkingLevel: "off",
        idempotencyKey: `cx110-d3-${crypto.randomUUID()}`,
      }),
    text,
  );
  await page.evaluate((conversationId) => {
    window.location.hash = `#/chat/${conversationId}`;
  }, receipt.conversationId);
  await page.waitForURL(new RegExp(`#/chat/${receipt.conversationId}$`, "u"));
}

async function verifySignedDesktopInteraction(page) {
  const nativePermissions = await page.evaluate(async () => [
    await window.openerx.requestDesktopNativePermission({ permission: "screen_capture" }),
    await window.openerx.requestDesktopNativePermission({ permission: "accessibility" }),
  ]);
  if (nativePermissions.some(({ status }) => status !== "granted")) {
    throw new Error(
      `D3_NATIVE_PERMISSION_REQUIRED:${nativePermissions
        .map(({ permission, status, reason }) => `${permission}=${status}:${reason ?? "none"}`)
        .join(",")}`,
    );
  }
  console.log("[cx110-d3] signed identity has Screen Recording and Accessibility access");

  await openTextEditTarget();
  await page.bringToFront();
  const positiveMarker = `${textEditToken}positive`;
  await startD3Conversation(
    page,
    `验证签名桌面交互 [CX110_D3_DESKTOP_TEXTEDIT] MARKER=${positiveMarker}`,
  );
  await approveDesktopPermission(page, "screenshot", "com.apple.TextEdit");
  await approveDesktopPermission(page, "click", "com.apple.TextEdit");
  await approveDesktopPermission(page, "type", "com.apple.TextEdit");
  await page.locator(".message-assistant[data-message-status='completed']").waitFor();
  const positiveReply = await page
    .locator(".message-assistant[data-message-status='completed']")
    .last()
    .innerText();
  assert.match(positiveReply, /桌面操作已执行：type/u);
  console.log(`[cx110-d3] TextEdit content after type: ${JSON.stringify(textEditContent())}`);
  await eventually(
    () => (textEditContent().includes(positiveMarker) ? true : null),
    "D3_TEXTEDIT_CONTENT_MISSING",
    running.child,
  );
  console.log("[cx110-d3] bundle-bound TextEdit capture and approved type succeeded");

  const negativeMarker = `${textEditToken}mustnotappear`;
  await page.bringToFront();
  await startD3Conversation(
    page,
    `验证身份错配 [CX110_D3_DESKTOP_MISMATCH] MARKER=${negativeMarker}`,
  );
  await approveDesktopPermission(page, "screenshot", "com.apple.TextEdit");
  await approveDesktopPermission(page, "type", "com.apple.finder");
  await page.locator(".message-assistant[data-message-status='completed']").waitFor();
  const negativeReply = await page
    .locator(".message-assistant[data-message-status='completed']")
    .last()
    .innerText();
  assert.match(negativeReply, /DESKTOP_CAPTURE_IDENTITY_MISMATCH/u);
  assert.doesNotMatch(textEditContent(), new RegExp(negativeMarker, "u"));
  console.log("[cx110-d3] mismatched bundle identity failed closed without typing");
  closeTextEditTarget();
}

async function assertState(page, conversationId, expectedAccountId) {
  const state = await page.evaluate(async () => ({
    environment: await window.openerx.getEnvironment(),
    account: await window.openerx.getAccountState(),
    conversations: await window.openerx.listConversations(),
  }));
  assert.equal(state.environment.appVersion, runtimeVersion);
  assert.equal(state.account.status, "signed_in");
  assert.equal(state.account.account?.email, "cx110-d3@example.com");
  if (expectedAccountId) assert.equal(state.account.account?.accountId, expectedAccountId);
  assert.ok(state.conversations.some(({ id }) => id === conversationId));
  return state;
}

let running;
let textEditOpened = false;
try {
  const baseline = candidate("baseline", "2.0.0-alpha.0");
  const upgrade = candidate("upgrade", "2.0.0-alpha.1");
  assert.equal(upgrade.requirement, baseline.requirement);
  console.log("[cx110-d3] signed candidates share one designated requirement");

  install(baseline.path);
  assertInstalledVersion(baseline.version);
  running = await launch();
  console.log("[cx110-d3] baseline installed and renderer connected");
  await signInAndFund(running.page);
  await running.page.getByRole("link", { name: "新对话", exact: true }).click();
  await running.page.getByLabel("发送消息").fill("CX-110-D3 安装生命周期标记");
  await running.page.getByRole("button", { name: "发送", exact: true }).click();
  await running.page.locator(".message-assistant[data-message-status='completed']").waitFor();
  const conversationUrl = running.page.url();
  const conversationId = /#\/chat\/([0-9a-f-]+)$/u.exec(conversationUrl)?.[1];
  if (!conversationId) throw new Error("D3_CONVERSATION_ID_MISSING");
  const baselineState = await assertState(running.page, conversationId);
  const accountId = baselineState.account.account?.accountId;
  if (!accountId) throw new Error("D3_ACCOUNT_ID_MISSING");
  textEditOpened = true;
  await verifySignedDesktopInteraction(running.page);
  textEditOpened = false;
  console.log("[cx110-d3] baseline state persisted");
  await running.close();
  running = undefined;

  const credentialPath = path.join(profileDirectory, "account", "device-session.bin");
  assert.equal(existsSync(credentialPath), true);
  assertCredentialProtected(credentialPath);
  run("/usr/bin/security", [
    "find-generic-password",
    "-a",
    `${keychainApplicationName} Key`,
    "-s",
    `${keychainApplicationName} Safe Storage`,
  ]);
  const deviceDigest = sha256(path.join(profileDirectory, "account", "device.json"));
  assert.ok(findNamed(profileDirectory, "openerx-v2.sqlite").length > 0);

  install(upgrade.path);
  assertInstalledVersion(upgrade.version);
  running = await launch();
  await assertState(running.page, conversationId, accountId);
  assertCredentialProtected(credentialPath);
  assert.equal(sha256(path.join(profileDirectory, "account", "device.json")), deviceDigest);
  console.log("[cx110-d3] upgrade preserved account, conversation, database, and credential");
  await running.close();
  running = undefined;

  install(baseline.path);
  assertInstalledVersion(baseline.version);
  running = await launch();
  await assertState(running.page, conversationId, accountId);
  assertCredentialProtected(credentialPath);
  assert.equal(sha256(path.join(profileDirectory, "account", "device.json")), deviceDigest);
  console.log("[cx110-d3] rollback preserved account, conversation, database, and credential");
  await running.close();
  running = undefined;

  console.log(
    `CX110_D3_MACOS_LIFECYCLE_OK install=${baseline.version} upgrade=${upgrade.version} rollback=${baseline.version} identity=stable profile=preserved`,
  );
} catch (error) {
  for (const filePath of findNamed(path.join(profileDirectory, "logs"), "app-service.stderr.log")) {
    console.error("D3_APP_SERVICE_STDERR\n", readFileSync(filePath, "utf8"));
  }
  for (const filePath of findNamed(path.join(profileDirectory, "logs"), "pi-host.stderr.log")) {
    console.error("D3_PI_HOST_STDERR\n", readFileSync(filePath, "utf8"));
  }
  throw error;
} finally {
  if (textEditOpened) closeTextEditTarget();
  if (running) await running.close().catch(() => undefined);
  if (platform.connected) platform.send("shutdown");
  await new Promise((resolve) => {
    if (platform.exitCode !== null) resolve();
    else platform.once("exit", resolve);
  });
  spawnSync("/usr/bin/security", [
    "delete-generic-password",
    "-a",
    `${keychainApplicationName} Key`,
    "-s",
    `${keychainApplicationName} Safe Storage`,
  ]);
  rmSync(root, { recursive: true, force: true });
}
