import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { build } from "vite";

// Real renderer components/CSS, synthetic data only. No server or upstream request is permitted.
const desktop = fileURLToPath(new URL("../", import.meta.url));
const repo = path.resolve(desktop, "../..");
const fixture = path.join(desktop, "tests/fixtures/modal-layout");
const brandTheme = path.join(desktop, "src/renderer/brand-theme.css");
const brand = process.env.OPENERX_BRAND_MANIFEST
  ? JSON.parse(await readFile(path.resolve(process.env.OPENERX_BRAND_MANIFEST), "utf8"))
  : null;
const temporary = await mkdtemp(path.join(tmpdir(), "openerx-modal-layout-"));
const evidence = process.env.OPENERX_LAYOUT_OUTPUT_DIR
  ? path.resolve(process.env.OPENERX_LAYOUT_OUTPUT_DIR)
  : null;
const installedChrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const executablePath =
  process.env.OPENERX_LAYOUT_BROWSER_EXECUTABLE ??
  (process.platform === "darwin" && existsSync(installedChrome)
    ? installedChrome
    : chromium.executablePath());
const results = [];
let browser;
const origin = "http://isolated-modal.fixture";

async function pageFor(width, height, query, scheme = "dark") {
  const page = await browser.newPage({
    viewport: { width, height },
    locale: "zh-CN",
    colorScheme: scheme,
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    assert.equal(url.origin, origin, "Layout fixture must never access external services");
    const file = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
    assert(!file.includes(".."));
    await route.fulfill({
      body: await readFile(path.join(temporary, "dist", file)),
      contentType: file.endsWith("js")
        ? "application/javascript"
        : file.endsWith("css")
          ? "text/css"
          : "text/html",
    });
  });
  await page.goto(`${origin}/?${query}`);
  await page.evaluate((theme) => {
    document.documentElement.dataset.theme = theme;
  }, scheme);
  return { page, errors };
}

async function automationMetrics(page) {
  return page.evaluate(() => {
    const body = document.querySelector(".automation-detail-body");
    const last = document.querySelector(".automation-runs article:last-child");
    const row = last.getBoundingClientRect();
    const bounds = body.getBoundingClientRect();
    return {
      clientHeight: body.clientHeight,
      scrollHeight: body.scrollHeight,
      scrollTop: body.scrollTop,
      lastTop: row.top,
      lastBottom: row.bottom,
      bodyTop: bounds.top,
      bodyBottom: bounds.bottom,
      visible: row.top >= bounds.top && row.bottom <= bounds.bottom,
      fixture: window.__modalLayoutFixture,
    };
  });
}

async function screenshot(page, name) {
  if (evidence) await page.screenshot({ path: path.join(evidence, name) });
}

try {
  assert(
    existsSync(executablePath),
    "Install Playwright Chromium or set OPENERX_LAYOUT_BROWSER_EXECUTABLE",
  );
  if (evidence) await mkdir(evidence, { recursive: true });
  await build({
    root: fixture,
    configFile: false,
    base: "/",
    logLevel: "error",
    define: brand ? { __OPENERX_BRAND__: JSON.stringify(brand) } : {},
    plugins: [
      {
        name: "modal-layout-edition-brand",
        transform(code, id) {
          if (id === path.join(fixture, "main.tsx") && existsSync(brandTheme)) {
            return `${code}\nimport ${JSON.stringify(brandTheme)};`;
          }
        },
        transformIndexHtml(html) {
          if (brand)
            return html.replace(
              '<html lang="zh-CN"',
              `<html data-brand="${brand.id}" lang="zh-CN"`,
            );
        },
      },
    ],
    esbuild: { jsx: "automatic" },
    resolve: {
      alias: [
        {
          find: "@openerx/desktop-ui/workspace-bridge",
          replacement: path.join(repo, "packages/desktop-ui/src/workspace-bridge.ts"),
        },
      ],
    },
    build: { outDir: path.join(temporary, "dist"), emptyOutDir: true },
  });
  browser = await chromium.launch({ headless: true, executablePath });
  for (const [width, height, long] of [
    [920, 640, false],
    [1240, 769, false],
    [920, 640, true],
  ]) {
    const { page, errors } = await pageFor(
      width,
      height,
      `automation=fixture-automation${long ? "&long=1" : ""}`,
    );
    await page.locator(".automation-runs article").last().waitFor();
    await page.waitForTimeout(250);
    const before = await automationMetrics(page);
    assert(before.scrollHeight > before.clientHeight);
    const body = page.locator(".automation-detail-body");
    await body.hover();
    await page.mouse.wheel(0, 10_000);
    await page.waitForTimeout(500);
    const afterWheel = await automationMetrics(page);
    assert(afterWheel.visible && afterWheel.scrollTop > 0, "Wheel must reach the last run");
    await body.focus();
    await page.keyboard.press("Home");
    await page.waitForTimeout(500);
    const afterHome = await automationMetrics(page);
    assert.equal(
      afterHome.scrollTop,
      0,
      "Home must reach the beginning of the focused scroll region",
    );
    await page.keyboard.press("End");
    await page.waitForTimeout(500);
    const afterEnd = await automationMetrics(page);
    assert(afterEnd.visible, "Keyboard End must reach the last run");
    assert.deepEqual(afterEnd.fixture.calls, []);
    assert.deepEqual(errors, []);
    await screenshot(page, `automation-${width}-${height}-${long ? "long" : "short"}-end.png`);
    results.push({
      case: "automation",
      width,
      height,
      long,
      before,
      afterWheel,
      afterHome,
      afterEnd,
    });
    await page.close();
  }
  for (const [width, height, scheme] of [
    [920, 640, "dark"],
    [613, 427, "light"],
  ]) {
    const { page, errors } = await pageFor(width, height, "project=1", scheme);
    const trigger = page.getByRole("button", { name: "新建项目", exact: true });
    await trigger.click();
    const dialog = page.getByRole("dialog", { name: "新建项目", exact: true });
    await dialog.waitFor();
    const box = await page.getByLabel("项目说明（可选）").boundingBox();
    await page.mouse.move(box.x + box.width - 4, box.y + box.height - 4);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width - 4, box.y + box.height + 600, { steps: 16 });
    await page.mouse.up();
    const metrics = await dialog.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      const body = element.querySelector(".project-create-body");
      const footer = element.querySelector("footer").getBoundingClientRect();
      const button = element.querySelector("footer button");
      const target = button.getBoundingClientRect();
      return {
        top: bounds.top,
        bottom: bounds.bottom,
        height: bounds.height,
        bodyHeight: body.clientHeight,
        bodyScrollHeight: body.scrollHeight,
        footerTop: footer.top,
        footerBottom: footer.bottom,
        portal: element.parentElement.parentElement === document.body,
        foreground: button.contains(
          document.elementFromPoint(target.x + target.width / 2, target.y + target.height / 2),
        ),
        inputHeight: element.querySelector("textarea").getBoundingClientRect().height,
        fixture: window.__modalLayoutFixture,
      };
    });
    assert(
      metrics.portal && metrics.foreground,
      "Project dialog must escape the sidebar and cover the composer",
    );
    assert(metrics.top >= 0 && metrics.bottom <= height && metrics.footerBottom <= height);
    assert(metrics.bodyScrollHeight > metrics.bodyHeight && metrics.inputHeight > 200);
    await screenshot(page, `project-${width}-${height}-${scheme}-resized.png`);
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "detached" });
    assert(await trigger.evaluate((element) => element === document.activeElement));
    assert.deepEqual(metrics.fixture.calls, []);
    assert.deepEqual(errors, []);
    results.push({ case: "project", width, height, scheme, metrics });
    await page.close();
  }
  for (const [width, height, scheme, shell] of [
    [1240, 769, "light", false],
    [920, 640, "dark", true],
    [613, 427, "light", false],
  ]) {
    const { page, errors } = await pageFor(
      width,
      height,
      `empty=1${shell ? "&shell=1" : ""}`,
      scheme,
    );
    await page.getByText("还没有自动化").waitFor();
    const metrics = await page.evaluate(() => {
      const button = document.querySelector(".automation-create-button").getBoundingClientRect();
      return {
        rootWidth: document.documentElement.scrollWidth,
        buttonLeft: button.left,
        buttonRight: button.right,
      };
    });
    assert(metrics.rootWidth <= width && metrics.buttonLeft >= 0 && metrics.buttonRight <= width);
    await screenshot(page, `list-empty-${width}-${height}-${scheme}${shell ? "-shell" : ""}.png`);
    assert.deepEqual(errors, []);
    results.push({ case: "list", width, height, scheme, shell, metrics, errors });
    await page.close();
  }
  if (evidence)
    await writeFile(
      path.join(evidence, "modal-layout-metrics.json"),
      JSON.stringify(results, null, 2),
    );
  console.log(JSON.stringify({ status: "passed", cases: results.length, evidence }));
} finally {
  await browser?.close();
  await rm(temporary, { recursive: true, force: true });
}
