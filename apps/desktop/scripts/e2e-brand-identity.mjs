import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { _electron as electron } from "playwright";

const desktop = path.resolve(import.meta.dirname, "..");
const temporary = mkdtempSync(path.join(realpathSync(tmpdir()), "openerx-brand-"));
const evidence = path.resolve(
  process.env.OPENERX_BRAND_EVIDENCE_DIR || path.join(desktop, "../../.codex-temp/brand-identity"),
);
mkdirSync(evidence, { recursive: true });
const namespace = `openerx CX110 D3 brand_${randomUUID()}`;
const report = { displayName: "openerx", credentialRoundTrip: "not_applicable", renderer: false };
let application;
try {
  if (process.platform === "darwin") {
    const fixture = path.join(temporary, "identity.cjs");
    writeFileSync(
      fixture,
      `const { app } = require("electron");
app.name = process.env.OPENERX_CRYPTO_NAMESPACE;
app.setPath("userData", process.env.OPENERX_CRYPTO_PROFILE);
app.whenReady().then(() => { if (process.env.OPENERX_RENAME_AFTER_READY === "1") app.name = "openerx"; });
`,
    );
    const env = {
      ...process.env,
      OPENERX_CRYPTO_NAMESPACE: namespace,
      OPENERX_CRYPTO_PROFILE: path.join(temporary, "crypto"),
    };
    application = await electron.launch({ args: [fixture], env });
    const encrypted = await application.evaluate(async ({ safeStorage }) => {
      if (!(await safeStorage.isAsyncEncryptionAvailable()))
        throw new Error("KEYCHAIN_UNAVAILABLE");
      return (await safeStorage.encryptStringAsync("synthetic-upgrade-proof")).toString("base64");
    });
    await application.close();
    application = await electron.launch({
      args: [fixture],
      env: { ...env, OPENERX_RENAME_AFTER_READY: "1" },
    });
    const decrypted = await application.evaluate(
      async ({ app, safeStorage }, value) => ({
        name: app.name,
        value: (await safeStorage.decryptStringAsync(Buffer.from(value, "base64"))).result,
      }),
      encrypted,
    );
    assert.deepEqual(decrypted, { name: "openerx", value: "synthetic-upgrade-proof" });
    report.credentialRoundTrip = "passed";
    await application.close();
    application = undefined;
  }

  application = await electron.launch({
    args: [path.join(desktop, ".vite/build/main.js")],
    cwd: desktop,
    env: { ...process.env, OPENERX_E2E: "1", OPENERX_E2E_PROFILE_DIR: path.join(temporary, "ui") },
  });
  const page = await application.firstWindow();
  await page.waitForLoadState("domcontentloaded");
  await page.getByAltText("openerx 标志").waitFor();
  assert.equal(await page.title(), "openerx");
  assert.equal(await application.evaluate(({ app }) => app.name), "openerx");
  const images = await page.locator("img").evaluateAll((items) =>
    items.map((item) => ({
      src: item.getAttribute("src"),
      loaded: item.complete && item.naturalWidth > 0,
    })),
  );
  assert.ok(images.length > 0);
  assert.ok(images.every(({ loaded }) => loaded));
  assert.ok(images.every(({ src }) => !/unicom|xiaolian/iu.test(src || "")));
  assert.doesNotMatch(await page.locator("body").innerText(), /UWA|小联|Unicom Work Assistant/u);
  await page.screenshot({ path: path.join(evidence, "openerx-desktop.png"), fullPage: true });
  report.renderer = true;
  writeFileSync(path.join(evidence, "result.json"), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report));
} finally {
  await application?.close();
  rmSync(temporary, { recursive: true, force: true });
  if (process.platform === "darwin") {
    try {
      execFileSync(
        "/usr/bin/security",
        ["delete-generic-password", "-s", `${namespace} Safe Storage`, "-a", namespace],
        { stdio: "ignore" },
      );
    } catch {}
  }
}
