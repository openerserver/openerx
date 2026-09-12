import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { chromium } from "playwright";

// Only run against a disposable copy of a profile, never the user's live database.
const config = JSON.parse(readFileSync(process.argv[2], "utf8"));
const { executable, profile, conversationId, evidenceDirectory } = config;
assert.equal(config.disposableProfile, true);
assert.ok(path.isAbsolute(profile));
mkdirSync(evidenceDirectory, { recursive: true });

const fixture = {
  "pages/index.html": `<!doctype html><html><head><link rel="stylesheet" href="../css/site.css?v=1"></head><body><h1>Website preview fixture</h1><img id="pixel" src="../images/pixel.png"><div id="background">Background image</div><a href="next.html?from=preview">Next page</a><script>document.body.dataset.inline = 'ready';</script><script type="module" src="../js/app.mjs"></script></body></html>`,
  "pages/next.html": `<h1>Next page</h1><script>document.body.dataset.storage = localStorage.getItem('preview-fixture');</script>`,
  "css/site.css": `@import './theme/palette.css'; body { background: rgb(23,80,115); color: white; padding: 20px } #background { width: 100px; height: 60px; background-image: url('../images/logo%20%E4%B8%AD.svg?v=2') }`,
  "css/theme/palette.css": `h1 { color: rgb(34,170,119) }`,
  "images/logo 中.svg": `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="30"><rect width="40" height="30" fill="#fa0"/></svg>`,
  "images/pixel.png": Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1cAAAAASUVORK5CYII=",
    "base64",
  ),
  "js/helper.mjs": "export const value = 42;",
  "js/app.mjs": `import { value } from './helper.mjs'; const data = await fetch('../data.json').then(r => r.json()); localStorage.setItem('preview-fixture', 'stored'); let parentBlocked = false; try { void parent.document.body; } catch { parentBlocked = true; } window.previewProbe = { ready: true, value, data: data.label, bridge: typeof window.openerx, require: typeof require, process: typeof process, parentBlocked };`,
  "data.json": '{"label":"saved-snapshot"}',
};
const database = new DatabaseSync(path.join(profile, "openerx-v2.sqlite"));
let fixtureId;
const timestamp = new Date().toISOString();
try {
  database.exec("BEGIN");
  const oldFixtures = database
    .prepare(
      "SELECT artifact_id FROM workspace_artifact_links WHERE workspace_root_path = '/e2e-html-preview-fixture'",
    )
    .all();
  for (const { artifact_id: id } of oldFixtures) {
    database.prepare("DELETE FROM workspace_artifact_links WHERE artifact_id = ?").run(id);
    database.prepare("DELETE FROM artifact_versions WHERE artifact_id = ?").run(id);
    database.prepare("DELETE FROM artifacts WHERE id = ?").run(id);
  }
  for (const [relativePath, source] of Object.entries(fixture)) {
    const bytes = Buffer.isBuffer(source) ? source : Buffer.from(source);
    const checksum = createHash("sha256").update(bytes).digest("hex");
    const objectRef = `objects/sha256/${checksum.slice(0, 2)}/${checksum}`;
    mkdirSync(path.dirname(path.join(profile, "content", objectRef)), { recursive: true });
    writeFileSync(path.join(profile, "content", objectRef), bytes);
    const id = randomUUID();
    if (relativePath === "pages/index.html") fixtureId = id;
    const format = relativePath.endsWith(".html")
      ? "html"
      : relativePath.endsWith(".png")
        ? "png"
        : relativePath.endsWith(".json")
          ? "json"
          : "code";
    database
      .prepare(
        "INSERT INTO artifacts (id, owner_profile_id, display_name, format, media_type, current_version, created_at, updated_at, revision) VALUES (?, 'local-default', ?, ?, ?, 1, ?, ?, 1)",
      )
      .run(
        id,
        relativePath,
        format,
        format === "html" ? "text/html" : "text/plain",
        timestamp,
        timestamp,
      );
    database
      .prepare(
        "INSERT INTO artifact_versions (id, artifact_id, version, size_bytes, checksum_sha256, object_ref, source_personal_file_id, created_at) VALUES (?, ?, 1, ?, ?, ?, NULL, ?)",
      )
      .run(randomUUID(), id, bytes.byteLength, checksum, objectRef, timestamp);
    database
      .prepare(
        "INSERT INTO workspace_artifact_links (owner_profile_id, conversation_id, workspace_root_path, relative_path, artifact_id, source_revision) VALUES ('local-default', ?, '/e2e-html-preview-fixture', ?, ?, ?)",
      )
      .run(conversationId, relativePath, id, checksum);
  }
  database.exec("COMMIT");
} finally {
  database.close();
}

const child = spawn(
  executable,
  ["--remote-debugging-address=127.0.0.1", "--remote-debugging-port=0"],
  {
    env: {
      ...process.env,
      OPENERX_E2E: "1",
      OPENERX_E2E_USE_PLATFORM: "1",
      OPENERX_E2E_PROFILE_DIR: profile,
      OPENERX_E2E_APPLICATION_NAME: "openerx CX110 D3 html-preview",
      OPENERX_DEV_AUTO_SIGN_IN: "0",
      OPENERX_PLATFORM_URL: "",
    },
    stdio: ["ignore", "ignore", "pipe"],
  },
);
const exited = new Promise((resolve) => child.once("exit", resolve));
let browser;
let page;
try {
  const endpoint = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("HTML_PREVIEW_START_TIMEOUT")), 30_000);
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("exit", (code) => {
      clearTimeout(timeout);
      reject(new Error(`HTML_PREVIEW_PROCESS_EXITED: ${code}`));
    });
    child.stderr.on("data", (chunk) => {
      writeFileSync(path.join(evidenceDirectory, "startup.log"), chunk, { flag: "a" });
      const match = chunk.toString().match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (match) {
        clearTimeout(timeout);
        resolve(match[1]);
      }
    });
  });
  browser = await chromium.connectOverCDP(endpoint);
  const context = browser.contexts()[0];
  page = context.pages()[0] ?? (await context.waitForEvent("page"));
  const pageErrors = [];
  const resources = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("response", (response) => {
    if (response.url().startsWith("openerx-preview:"))
      resources.push({
        path: new URL(response.url()).pathname,
        status: response.status(),
        mediaType: response.headers()["content-type"],
      });
  });
  await page.waitForFunction(() => Boolean(window.openerx));
  await page.evaluate((id) => {
    window.location.hash = `/chat/${id}`;
  }, conversationId);
  const rail = page.getByRole("complementary", { name: "成果与来源", exact: true });
  await rail.waitFor();
  const outputs = await page.evaluate(
    (id) => window.openerx.listArtifacts({ conversationId: id }),
    conversationId,
  );
  const directoryList = rail.getByRole("list", { name: "输出文件目录", exact: true });
  const rootDirectory = directoryList.getByRole("button", { name: "目录 输出文件", exact: true });
  await rootDirectory.waitFor();
  assert.equal(await rootDirectory.getAttribute("aria-expanded"), "true");
  assert.ok((await rootDirectory.textContent()).includes(`${outputs.length} 个文件`));
  assert.equal(await directoryList.locator("button.rail-item").count(), outputs.length);
  assert.equal(await directoryList.locator(":scope > li").count(), 1);
  await rootDirectory.click();
  assert.equal(await rail.getByRole("button", { name: "预览 index.html", exact: true }).count(), 0);
  await rootDirectory.focus();
  await page.keyboard.press("Enter");
  assert.equal(await rootDirectory.getAttribute("aria-expanded"), "true");
  async function openPreview(displayName) {
    const parts = displayName.split("/").slice(0, -1);
    for (let index = 0; index < parts.length; index += 1) {
      const directory = rail.getByRole("button", {
        name: `目录 ${parts.slice(0, index + 1).join("/")}`,
        exact: true,
      });
      if ((await directory.getAttribute("aria-expanded")) === "false") await directory.click();
    }
    await rail.getByRole("button", { name: `预览 ${displayName}`, exact: true }).click();
    await page.getByRole("button", { name: "预览", exact: true }).click();
    const iframe = page.locator('iframe[title="HTML 隔离预览"]');
    await iframe.waitFor();
    const frame = await (await iframe.elementHandle()).contentFrame();
    await frame.waitForURL(/^openerx-preview:\/\//);
    return frame;
  }
  const website = await openPreview("index.html");
  await website.waitForFunction(() => document.querySelector("#featuredGrid")?.children.length > 0);
  const websiteState = await website.evaluate(() => ({
    background: getComputedStyle(document.body).backgroundColor,
    productCount: document.querySelector("#featuredGrid").children.length,
    svgCount: document.querySelectorAll("#featuredGrid svg").length,
    bridge: typeof window.openerx,
  }));
  assert.equal(websiteState.background, "rgb(251, 247, 243)");
  assert.ok(websiteState.productCount > 0 && websiteState.svgCount > 0);
  assert.equal(websiteState.bridge, "undefined");
  await website.locator("#currencySelect").selectOption("EUR");
  assert.equal(await website.evaluate(() => localStorage.getItem("elanora.currency")), "EUR");
  await page.screenshot({ path: path.join(evidenceDirectory, "website-preview.png") });
  await website.locator("#featuredGrid a").first().click();
  await website.waitForURL(/product\.html\?sku=/);
  assert.equal(await website.evaluate(() => localStorage.getItem("elanora.currency")), "EUR");
  await page.getByRole("button", { name: "源码", exact: true }).click();
  await page.getByRole("complementary", { name: "成果预览", exact: true }).locator("pre").waitFor();
  await page.getByRole("button", { name: "返回输出内容", exact: true }).click();

  const testFrame = await openPreview("pages/index.html");
  const repeated = await page.evaluate(
    (artifactId) => window.openerx.previewArtifact({ artifactId }),
    fixtureId,
  );
  assert.equal(
    repeated.htmlPreviewUrl,
    testFrame.url(),
    "An unchanged preview must survive focus refreshes without reloading",
  );
  await testFrame.waitForFunction(() => window.previewProbe?.ready);
  await testFrame.waitForFunction(() => document.querySelector("#pixel")?.naturalWidth === 1);
  const fixtureState = await testFrame.evaluate(() => ({
    ...window.previewProbe,
    background: getComputedStyle(document.body).backgroundColor,
    heading: getComputedStyle(document.querySelector("h1")).color,
    inline: document.body.dataset.inline,
    imageWidth: document.querySelector("#pixel").naturalWidth,
  }));
  assert.deepEqual(fixtureState, {
    ready: true,
    value: 42,
    data: "saved-snapshot",
    bridge: "undefined",
    require: "undefined",
    process: "undefined",
    parentBlocked: true,
    background: "rgb(23, 80, 115)",
    heading: "rgb(34, 170, 119)",
    inline: "ready",
    imageWidth: 1,
  });
  await page.screenshot({ path: path.join(evidenceDirectory, "resource-fixture.png") });
  await testFrame.getByRole("link", { name: "Next page" }).click();
  await testFrame.waitForFunction(() => document.body.dataset.storage === "stored");
  await page.getByRole("button", { name: "返回输出内容", exact: true }).click();
  assert.equal(
    await rail
      .getByRole("button", { name: "目录 pages", exact: true })
      .getAttribute("aria-expanded"),
    "true",
  );
  await rail.getByRole("button", { name: "目录 css", exact: true }).click();
  await rail.getByRole("button", { name: "目录 css/theme", exact: true }).click();
  assert.equal(
    await rail.getByRole("button", { name: "预览 css/theme/palette.css", exact: true }).isVisible(),
    true,
  );
  assert.equal(
    await rail
      .getByRole("button", { name: "预览 pages/index.html", exact: true })
      .locator("strong")
      .textContent(),
    "index.html",
  );
  await page.screenshot({ path: path.join(evidenceDirectory, "output-directories.png") });
  assert.ok(
    resources.some(
      (resource) => resource.path.includes("logo%20%E4%B8%AD.svg") && resource.status === 200,
    ),
  );
  assert.deepEqual(
    resources.filter((resource) => resource.status >= 400),
    [],
  );
  assert.deepEqual(pageErrors, []);
  const report = {
    checkedAt: new Date().toISOString(),
    conversationId,
    fixtureId,
    websiteState,
    fixtureState,
    pageNavigation: true,
    stablePreviewUrl: true,
    sourcePreview: true,
    directoryGrouping: {
      defaultDirectory: "输出文件",
      outputCount: outputs.length,
      singleRoot: true,
      nestedDirectories: ["css", "css/theme", "images", "js", "pages"],
      keyboardToggle: true,
      expandedAfterPreview: true,
      relativePathsPreserved: true,
    },
    resources,
    pageErrors,
  };
  writeFileSync(
    path.join(evidenceDirectory, "report.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  if (page) await page.screenshot({ path: path.join(evidenceDirectory, "failure.png") });
  throw error;
} finally {
  await browser?.close();
  child.kill("SIGTERM");
  const timeout = setTimeout(() => child.kill("SIGKILL"), 3000);
  await exited;
  clearTimeout(timeout);
}
