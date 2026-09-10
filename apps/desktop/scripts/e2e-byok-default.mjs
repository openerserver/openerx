import assert from "node:assert/strict";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { _electron as electron } from "playwright";

const desktopDirectory = path.resolve(import.meta.dirname, "..");
const mainEntry = path.join(desktopDirectory, ".vite", "build", "main.js");
const temporaryRoot = realpathSync(tmpdir());
const profileDirectory = mkdtempSync(path.join(temporaryRoot, "openerx-e2e-byok-default-"));

let application;
try {
  application = await electron.launch({
    args: [mainEntry],
    cwd: desktopDirectory,
    env: {
      ...process.env,
      OPENERX_E2E: "1",
      OPENERX_E2E_PROFILE_DIR: profileDirectory,
    },
  });
  const page = await application.firstWindow();
  await page.waitForLoadState("domcontentloaded");

  const state = await page.evaluate(async () => ({
    modelService: await window.openerx.getModelServiceSettings(),
    models: await window.openerx.listModels(),
    localSearch: await window.openerx.getLocalWebSearchSettings(),
  }));
  assert.equal(state.modelService.mode, "byok");
  assert.equal(state.modelService.credentialConfigured, false);
  assert.equal(Object.values(state.modelService.providerCredentials).some(Boolean), false);
  assert.equal(state.modelService.byok?.baseUrl, "https://api.deepseek.com");
  assert.equal(state.modelService.byok?.modelId, "deepseek-v4-flash");
  assert.equal(state.models.length, 13);
  assert.equal(
    state.models.every(({ status }) => status === "unavailable"),
    true,
  );
  assert.equal(
    state.models.some(({ modelRef }) => modelRef === "platform/byok.deepseek.flash"),
    true,
  );
  assert.equal(
    state.models.some(({ modelRef }) => modelRef === "platform/byok.qwen.plus"),
    true,
  );
  assert.equal(state.localSearch.featureEnabled, true);
  assert.equal(state.localSearch.providerId, "direct:baidu-json");

  await page.getByRole("link", { name: "前往设置 → 模型" }).waitFor();
  await page.getByLabel("发送消息").fill("未配置 API 时不能发送");
  assert.equal(await page.getByRole("button", { name: "发送", exact: true }).isDisabled(), true);

  await page.getByRole("link", { name: "前往设置 → 模型" }).click();
  await page.getByLabel("运行模式").waitFor();
  assert.equal(await page.getByLabel("运行模式").inputValue(), "byok");
  await page.getByLabel("DeepSeek API Key").waitFor();
  assert.equal(await page.getByLabel("Base URL").inputValue(), "https://api.deepseek.com");
  assert.equal(await page.getByLabel("模型 ID").inputValue(), "deepseek-v4-flash");
  console.log("E2E_BYOK_DEFAULT_OK mode=byok local_search=direct:baidu-json server_required=false");
} finally {
  await application?.close();
  const resolvedProfile = path.resolve(profileDirectory);
  if (resolvedProfile.startsWith(`${temporaryRoot}${path.sep}`)) {
    rmSync(resolvedProfile, { recursive: true, force: true });
  } else {
    console.error("E2E_TEMP_PROFILE_BOUNDARY_VIOLATION");
    process.exitCode = 1;
  }
}
