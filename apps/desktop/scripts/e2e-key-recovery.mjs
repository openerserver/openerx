import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium } from "playwright";

const desktopDirectory = path.resolve(import.meta.dirname, "..");
const executable =
  process.env.OPENERX_KEY_E2E_EXECUTABLE ||
  path.join(
    desktopDirectory,
    `out/openerx-darwin-${process.arch}/openerx.app/Contents/MacOS/openerx`,
  );
const profile = mkdtempSync(path.join(tmpdir(), "openerx-key-recovery-e2e-"));
const directory = path.join(profile, "credentials");
const file = path.join(directory, "model-service.bin");
mkdirSync(directory);
const original = Buffer.concat([Buffer.from("v10"), randomBytes(64)]);
writeFileSync(file, original, { mode: 0o600 });
let close;

async function launch() {
  const child = spawn(
    executable,
    ["--remote-debugging-address=127.0.0.1", "--remote-debugging-port=0"],
    {
      cwd: desktopDirectory,
      env: {
        ...process.env,
        OPENERX_E2E: "1",
        OPENERX_E2E_USE_PLATFORM: "1",
        OPENERX_E2E_PROFILE_DIR: profile,
        OPENERX_E2E_APPLICATION_NAME: `openerx CX110 D3 ${path.basename(profile)}`,
        OPENERX_PLATFORM_URL: "",
        OPENERX_DEV_AUTO_SIGN_IN: "0",
      },
      stdio: ["ignore", "ignore", "pipe"],
    },
  );
  const exited = new Promise((resolve) => child.once("exit", resolve));
  const stop = async () => {
    child.kill();
    const timeout = setTimeout(() => child.kill("SIGKILL"), 2_000);
    await exited;
    clearTimeout(timeout);
  };
  close = stop;
  const endpoint = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("KEY_FIXTURE_START_TIMEOUT")), 10_000);
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.stderr.on("data", (chunk) => {
      const match = chunk.toString().match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (match) {
        clearTimeout(timeout);
        resolve(match[1]);
      }
    });
  });
  const browser = await chromium.connectOverCDP(endpoint);
  close = async () => {
    await browser.close();
    await stop();
  };
  const context = browser.contexts()[0];
  const page = context.pages()[0] ?? (await context.waitForEvent("page"));
  await page.waitForFunction(() => Boolean(window.openerx));
  return page;
}

try {
  let page = await launch();
  const result = await page.evaluate(async () => {
    const before = await window.openerx.getModelServiceSettings();
    const input = {
      mode: "byok",
      byok: before.byok,
      providerApiKeys: { deepseek: "synthetic-recovery-deepseek", qwen: "synthetic-recovery-qwen" },
    };
    let normalSaveRejected = false;
    try {
      await window.openerx.updateModelServiceSettings(input);
    } catch (error) {
      normalSaveRejected = /OS_CREDENTIAL_DECRYPT_FAILED|OS_CREDENTIAL_DATA_INVALID/.test(
        String(error.message),
      );
    }
    return { issue: before.credentialIssue, normalSaveRejected };
  });
  assert.deepEqual(result, { issue: "unreadable", normalSaveRejected: true });
  assert.deepEqual(readFileSync(file), original);
  assert.equal(readdirSync(directory).filter((name) => name.endsWith(".bak")).length, 0);
  const recovered = await page.evaluate(async () => {
    const current = await window.openerx.getModelServiceSettings();
    return await window.openerx.updateModelServiceSettings({
      mode: "byok",
      byok: current.byok,
      providerApiKeys: { deepseek: "synthetic-recovery-deepseek", qwen: "synthetic-recovery-qwen" },
      recoverUnreadableCredentials: true,
    });
  });
  assert.equal(recovered.credentialIssue, null);
  assert.equal(recovered.providerCredentials.deepseek, true);
  assert.equal(recovered.providerCredentials.qwen, true);
  const backups = readdirSync(directory).filter((name) => name.endsWith(".bak"));
  assert.equal(backups.length, 1);
  assert.deepEqual(readFileSync(path.join(directory, backups[0])), original);
  assert.equal(statSync(path.join(directory, backups[0])).mode & 0o777, 0o600);
  assert.equal(readFileSync(file).includes("synthetic-recovery"), false);
  await close();
  close = undefined;
  page = await launch();
  const restored = await page.evaluate(() => window.openerx.getModelServiceSettings());
  assert.equal(restored.credentialIssue, null);
  assert.equal(restored.providerCredentials.deepseek, true);
  assert.equal(restored.providerCredentials.qwen, true);
  assert.equal(readdirSync(directory).filter((name) => name.endsWith(".bak")).length, 1);
  console.log(
    "KEY_RECOVERY_OK explicit-recovery original-preserved encrypted-backup multi-provider-save restart-restore",
  );
} finally {
  await close?.();
  rmSync(profile, { recursive: true, force: true });
}
