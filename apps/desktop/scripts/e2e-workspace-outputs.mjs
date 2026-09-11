import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

// The input must point to a disposable copy of a profile with recorded workspace writes.
const config = JSON.parse(readFileSync(process.argv[2], "utf8"));
const { executable, profile, conversationId, expectedPaths, evidenceDirectory } = config;
assert.ok(path.isAbsolute(profile));
assert.ok(expectedPaths.length > 6, "Fixture must cover the former six-output display limit");
mkdirSync(evidenceDirectory, { recursive: true });
const child = spawn(
  executable,
  ["--remote-debugging-address=127.0.0.1", "--remote-debugging-port=0"],
  {
    env: {
      ...process.env,
      OPENERX_E2E: "1",
      OPENERX_E2E_USE_PLATFORM: "1",
      OPENERX_E2E_PROFILE_DIR: profile,
      OPENERX_E2E_APPLICATION_NAME: "openerx CX110 D3 workspace-outputs",
      OPENERX_DEV_AUTO_SIGN_IN: "0",
      OPENERX_PLATFORM_URL: "",
    },
    stdio: ["ignore", "ignore", "pipe"],
  },
);
const exited = new Promise((resolve) => child.once("exit", resolve));
let browser;
try {
  const endpoint = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("OUTPUTS_FIXTURE_START_TIMEOUT")), 20_000);
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
  browser = await chromium.connectOverCDP(endpoint);
  const context = browser.contexts()[0];
  const page = context.pages()[0] ?? (await context.waitForEvent("page"));
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.waitForFunction(() => Boolean(window.openerx));
  const outputs = await page.evaluate(
    (conversationId) => window.openerx.listArtifacts({ conversationId }),
    conversationId,
  );
  assert.deepEqual(outputs.map(({ displayName }) => displayName).sort(), [...expectedPaths].sort());
  await page.evaluate((conversationId) => {
    window.location.hash = `/chat/${conversationId}`;
  }, conversationId);
  const rail = page.getByRole("complementary", { name: "成果与来源", exact: true });
  await rail.waitFor();
  const outputButtons = rail.locator('[aria-labelledby="rail-outputs-title"] button.rail-item');
  await page.waitForFunction(
    (count) =>
      document.querySelectorAll('[aria-labelledby="rail-outputs-title"] button.rail-item')
        .length === count,
    expectedPaths.length,
  );
  assert.equal(await outputButtons.count(), expectedPaths.length);
  await page.screenshot({ path: path.join(evidenceDirectory, "outputs.png") });

  const entry = outputs.find(({ displayName }) => displayName === "index.html") ?? outputs[0];
  const preview = await page.evaluate(
    (artifactId) => window.openerx.previewArtifact({ artifactId }),
    entry.id,
  );
  assert.ok(preview.source?.length > 0);
  await rail.getByRole("button", { name: `预览 ${entry.displayName}`, exact: true }).click();
  await page.getByRole("complementary", { name: "成果预览", exact: true }).waitFor();
  await page.getByRole("button", { name: "源码", exact: true }).click();
  await page.screenshot({ path: path.join(evidenceDirectory, "preview-source.png") });
  await page.getByRole("button", { name: "返回输出内容", exact: true }).click();
  const again = await page.evaluate(
    (conversationId) => window.openerx.listArtifacts({ conversationId }),
    conversationId,
  );
  assert.deepEqual(
    again.map(({ id, currentVersion }) => [id, currentVersion]),
    outputs.map(({ id, currentVersion }) => [id, currentVersion]),
  );
  assert.deepEqual(pageErrors, []);
  const report = {
    checkedAt: new Date().toISOString(),
    conversationId,
    outputCount: outputs.length,
    renderedOutputCount: await outputButtons.count(),
    outputs: outputs.map(({ displayName, currentVersion }) => ({ displayName, currentVersion })),
    preview: {
      displayName: entry.displayName,
      bytes: Buffer.byteLength(preview.source),
      sha256: createHash("sha256").update(preview.source).digest("hex"),
    },
    duplicateFree: true,
    sourcePreviewOpened: true,
    pageErrors,
  };
  writeFileSync(
    path.join(evidenceDirectory, "report.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser?.close();
  child.kill("SIGTERM");
  const timeout = setTimeout(() => child.kill("SIGKILL"), 3000);
  await exited;
  clearTimeout(timeout);
}
