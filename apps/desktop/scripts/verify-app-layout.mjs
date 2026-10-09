import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { build } from "vite";
import { verifySettingsLayout } from "./settings-layout-regression.mjs";

const desktop = fileURLToPath(new URL("../", import.meta.url));
const repo = path.resolve(desktop, "../..");
const fixtureRoot = path.join(desktop, "tests/fixtures/app-layout");
const brandTheme = path.join(desktop, "src/renderer/brand-theme.css");
const brand = process.env.OPENERX_BRAND_MANIFEST
  ? JSON.parse(await readFile(path.resolve(process.env.OPENERX_BRAND_MANIFEST), "utf8"))
  : null;
const temporary = await mkdtemp(path.join(tmpdir(), "openerx-app-layout-"));
const evidence = process.env.OPENERX_LAYOUT_OUTPUT_DIR
  ? path.resolve(process.env.OPENERX_LAYOUT_OUTPUT_DIR)
  : null;
const macChrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const executablePath =
  process.env.OPENERX_LAYOUT_BROWSER_EXECUTABLE ??
  (process.platform === "darwin" && existsSync(macChrome) ? macChrome : chromium.executablePath());
const origin = "http://isolated-app-layout.fixture";
const results = [];
const requestedGroups = new Set(
  (process.env.OPENERX_LAYOUT_CASES ?? "settings,files,tools").split(","),
);
for (const group of requestedGroups)
  assert(["settings", "files", "tools"].includes(group), `Unknown layout group: ${group}`);
let browser;

async function openPage(width, height, theme, route, query = "") {
  const page = await browser.newPage({
    viewport: { width, height },
    locale: "zh-CN",
    colorScheme: theme,
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript((value) => {
    localStorage.setItem("openerx.theme", value);
  }, theme);
  await page.route("**/*", async (intercepted) => {
    const url = new URL(intercepted.request().url());
    assert.equal(url.origin, origin, "Full App fixture must never access external services");
    const file = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
    assert(!file.includes(".."));
    const diskFile = path.join(temporary, "dist", file);
    if (!existsSync(diskFile))
      return intercepted.fulfill({ status: 404, body: "Missing fixture asset" });
    return intercepted.fulfill({
      body: await readFile(diskFile),
      contentType: file.endsWith("js")
        ? "application/javascript"
        : file.endsWith("css")
          ? "text/css"
          : file.endsWith("svg")
            ? "image/svg+xml"
            : "text/html",
    });
  });
  await page.goto(`${origin}/?${query}#${route}`);
  await page.locator(".desktop-workspace").waitFor();
  return { page, errors };
}

async function capture(page, name) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  if (evidence) await page.screenshot({ path: path.join(evidence, `${name}.png`) });
}

async function assertFixture(page, errors) {
  assert.deepEqual(errors, [], "Full App must mount without renderer exceptions");
  const state = await page.evaluate(() => ({
    reads: window.__appLayoutFixture.reads,
    blockedCalls: window.__appLayoutFixture.blockedCalls,
  }));
  assert.deepEqual(state.blockedCalls, [], "No unlisted or mutating desktop APIs may run");
  return state;
}

async function headingMetric(page) {
  return page.locator(".settings-section-heading h1").evaluate((element) => {
    const r = element.getBoundingClientRect();
    return {
      title: element.textContent.trim(),
      left: r.left,
      top: r.top,
      width: r.width,
      height: r.height,
    };
  });
}

async function assertActiveCategoryVisible(page, trigger) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  const metric = await page
    .locator('.settings-nav-scroll button[aria-current="page"]')
    .evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const nav = element.closest(".settings-nav-scroll").getBoundingClientRect();
      const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
      return {
        name: element.textContent.trim(),
        rect: { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom },
        navigation: { left: nav.left, right: nav.right, top: nav.top, bottom: nav.bottom },
        visible:
          rect.left >= nav.left - 1 &&
          rect.right <= nav.right + 1 &&
          rect.top >= nav.top - 1 &&
          rect.bottom <= nav.bottom + 1 &&
          rect.left >= 0 &&
          rect.right <= innerWidth &&
          rect.top >= 0 &&
          rect.bottom <= innerHeight,
        clickable: element === hit || element.contains(hit),
        navigationFocused: element.closest(".settings-nav-scroll").contains(document.activeElement),
      };
    });
  assert.equal(metric.name, "工具");
  assert.equal(
    metric.visible,
    true,
    `Active category must be fully visible after ${trigger}: ${JSON.stringify(metric)}`,
  );
  assert.equal(metric.clickable, true, `Active category must remain clickable after ${trigger}`);
  assert.equal(
    metric.navigationFocused,
    false,
    `Automatic category scrolling must not steal focus`,
  );
  return { trigger, ...metric };
}

try {
  assert(existsSync(executablePath), "Install Chromium or set OPENERX_LAYOUT_BROWSER_EXECUTABLE");
  if (evidence) await mkdir(evidence, { recursive: true });
  // Preserve actual edition branches; the synthetic host does not connect to a central account.
  // Central settings and the verification gate have their own real-component fixtures.
  const extension = path.join(desktop, "tests/fixtures/composer-layout/extension.tsx");
  await build({
    root: fixtureRoot,
    configFile: false,
    base: "/",
    publicDir: path.join(desktop, "public"),
    logLevel: "error",
    esbuild: { jsx: "automatic" },
    define: brand ? { __OPENERX_BRAND__: JSON.stringify(brand) } : {},
    plugins: [
      {
        name: "full-app-layout-edition-brand",
        transform(code, id) {
          if (id === path.join(fixtureRoot, "main.tsx") && existsSync(brandTheme))
            return `${code}\nimport ${JSON.stringify(brandTheme)};`;
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
    resolve: {
      alias: [
        {
          find: "@openerx/desktop-ui/workspace-bridge",
          replacement: path.join(repo, "packages/desktop-ui/src/workspace-bridge.ts"),
        },
        {
          find: "@openerx/desktop-ui/workspace",
          replacement: path.join(repo, "packages/desktop-ui/src/workspace.tsx"),
        },
        ...(existsSync(extension)
          ? [{ find: "@openerx/desktop-extension/renderer", replacement: extension }]
          : []),
      ],
    },
    build: { outDir: path.join(temporary, "dist"), emptyOutDir: true },
  });
  browser = await chromium.launch({ headless: true, executablePath });
  for (const theme of ["light", "dark"]) {
    if (!requestedGroups.has("settings")) continue;
    const { page, errors } = await openPage(
      920,
      640,
      theme,
      "/settings/account?section=appearance",
    );
    await page.getByRole("heading", { name: "外观", exact: true }).waitFor();
    let layout;
    try {
      layout = await verifySettingsLayout(page, {
        evidenceDirectory: evidence,
        prefix: `app-settings-${theme}`,
      });
    } catch (error) {
      await page.setViewportSize({ width: 613, height: 427 });
      const navMetrics = [];
      for (const button of await page.locator(".settings-nav-scroll button").all()) {
        await button.focus();
        await page.waitForTimeout(200);
        navMetrics.push(
          await button.evaluate((element) => {
            const r = element.getBoundingClientRect(),
              nav = element.closest(".settings-nav-scroll"),
              n = nav.getBoundingClientRect();
            return {
              name: element.textContent,
              rect: { left: r.left, right: r.right, top: r.top, bottom: r.bottom },
              nav: {
                left: n.left,
                right: n.right,
                top: n.top,
                bottom: n.bottom,
                scrollLeft: nav.scrollLeft,
                scrollWidth: nav.scrollWidth,
                clientWidth: nav.clientWidth,
              },
            };
          }),
        );
      }
      await capture(page, `app-settings-${theme}-navigation-failure`);
      console.log(JSON.stringify({ error: String(error), navMetrics }));
      throw error;
    }
    const titles = [];
    for (const [width, height] of [
      [920, 640],
      [613, 427],
    ]) {
      await page.setViewportSize({ width, height });
      let axis;
      const supportedSections =
        brand?.platformAccountEnabled === false
          ? ["appearance", "tools", "update", "diagnostics"]
          : [
              "appearance",
              "model",
              "assistants",
              "tools",
              "memory",
              "remote",
              "billing",
              "update",
              "diagnostics",
            ];
      for (const section of supportedSections) {
        await page.evaluate((value) => {
          location.hash = `/settings/account?section=${value}`;
        }, section);
        await page.waitForFunction((value) => location.hash.includes(`section=${value}`), section);
        await page.locator(".settings-section-heading h1").waitFor();
        await capture(page, `app-settings-${section}-${width}-${height}-${theme}`);
        const metric = await headingMetric(page);
        if (axis) {
          assert(
            Math.abs(axis.left - metric.left) <= 1,
            `Settings heading left must align for ${section}`,
          );
          assert(
            Math.abs(axis.top - metric.top) <= 1,
            `Settings heading top must align for ${section}`,
          );
        } else axis = metric;
        titles.push({ width, height, section, ...metric });
      }
    }
    results.push({
      case: "settings",
      theme,
      layout,
      titles,
      fixture: await assertFixture(page, errors),
    });
    await page.close();
  }
  for (const theme of ["light", "dark"]) {
    if (!requestedGroups.has("files")) continue;
    for (const [width, height] of [
      [920, 640],
      [613, 427],
    ]) {
      const { page, errors } = await openPage(width, height, theme, "/files", "files-fail=1");
      let sidebarCollapsed = false;
      if (width < 640) {
        await page.getByRole("button", { name: "收起侧栏", exact: true }).click();
        sidebarCollapsed = true;
      }
      const alert = page.getByRole("alert").filter({ hasText: "文件列表读取失败" });
      await alert.waitFor();
      assert.equal(
        await page.getByText("还没有文件或成果", { exact: true }).count(),
        0,
        "Read failures must not show a fake empty state",
      );
      const retry = page.getByRole("button", { name: "重新读取文件", exact: true });
      await retry.waitFor();
      if (width < 640) await capture(page, `app-files-error-top-${width}-${height}-${theme}`);
      await alert.scrollIntoViewIfNeeded();
      await capture(page, `app-files-error-${width}-${height}-${theme}`);
      const before = await page.evaluate(
        () => window.__appLayoutFixture.reads.filter((name) => name === "listFiles").length,
      );
      await page.evaluate(() => {
        window.__appLayoutFixture.state.fileFailure = false;
      });
      await retry.click();
      await page.getByText("还没有文件或成果", { exact: true }).waitFor();
      assert.equal(await alert.count(), 0);
      await page.getByText("还没有文件或成果", { exact: true }).scrollIntoViewIfNeeded();
      const after = await page.evaluate(
        () => window.__appLayoutFixture.reads.filter((name) => name === "listFiles").length,
      );
      assert(after > before, "Retry must perform a real read through the mocked bridge");
      await capture(page, `app-files-empty-${width}-${height}-${theme}`);
      const rootWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      assert(rootWidth <= width, "Files states must not overflow horizontally");
      results.push({
        case: "files",
        width,
        height,
        theme,
        before,
        after,
        rootWidth,
        sidebarCollapsed,
        fixture: await assertFixture(page, errors),
      });
      await page.close();
    }
  }
  for (const theme of ["light", "dark"]) {
    if (!requestedGroups.has("tools")) continue;
    for (const [width, height] of [
      [920, 640],
      [613, 427],
    ]) {
      const { page, errors } = await openPage(
        width,
        height,
        theme,
        "/settings/account?section=tools",
        "tools-fail=1",
      );
      await page.getByRole("alert").filter({ hasText: "暂时无法读取工具状态" }).waitFor();
      const activeNavigation = [];
      if (width === 613) {
        activeNavigation.push(await assertActiveCategoryVisible(page, "compact direct route"));
      } else {
        await page.setViewportSize({ width: 613, height: 427 });
        await capture(page, `app-tools-navigation-resize-613-427-${theme}`);
        activeNavigation.push(await assertActiveCategoryVisible(page, "920px to 613px resize"));
        await page.setViewportSize({ width, height });
      }
      const alertColors = await page
        .locator(".settings-section-content [role=alert]")
        .evaluateAll((elements) =>
          elements.map((element) => ({
            text: element.textContent.trim(),
            color: getComputedStyle(element).color,
            fontSize: getComputedStyle(element).fontSize,
          })),
        );
      assert(
        alertColors.length >= (brand?.platformAccountEnabled === false ? 1 : 2),
        "Read failures from supported tools sections should remain visible",
      );
      const expectedErrorColor = await page
        .locator(".settings-section-content")
        .evaluate((container) => {
          const marker = document.createElement("span");
          marker.style.color = "var(--workspace-danger)";
          container.append(marker);
          const color = getComputedStyle(marker).color;
          marker.remove();
          return color;
        });
      assert(
        alertColors.every((alert) => alert.color === expectedErrorColor),
        "All tool failures must use the shared error text color",
      );
      await capture(page, `app-tools-error-${width}-${height}-${theme}`);
      await page.locator(".settings-section-content").evaluate((element) => {
        element.scrollTop = 320;
      });
      await capture(page, `app-tools-error-lower-${width}-${height}-${theme}`);
      const fixture = await assertFixture(page, errors);
      if (brand?.platformAccountEnabled === false) {
        assert(
          !fixture.reads.includes("getPiRuntimeSettings"),
          "Managed tools must not read unsupported native tools settings",
        );
        assert(
          !fixture.reads.includes("listMcpServers"),
          "Managed tools must not read unsupported MCP settings",
        );
      }
      results.push({
        case: "tools",
        width,
        height,
        theme,
        activeNavigation,
        alertColors,
        fixture,
      });
      await page.close();
    }
  }
  if (evidence)
    await writeFile(
      path.join(evidence, "app-layout-metrics.json"),
      JSON.stringify(results, null, 2),
    );
  console.log(
    JSON.stringify({
      status: "passed",
      groups: [...requestedGroups],
      cases: results.length,
      evidence,
    }),
  );
} finally {
  await browser?.close();
  await rm(temporary, { recursive: true, force: true });
}
