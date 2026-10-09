import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { build } from "vite";

// Build the actual shared App/Composer and its CSS. All bridge data are synthetic.
const desktop = fileURLToPath(new URL("../", import.meta.url));
const repo = path.resolve(desktop, "../..");
const fixture = path.join(desktop, "tests/fixtures/composer-layout");
const brandTheme = path.join(desktop, "src/renderer/brand-theme.css");
const brand = process.env.OPENERX_BRAND_MANIFEST
  ? JSON.parse(await readFile(path.resolve(process.env.OPENERX_BRAND_MANIFEST), "utf8"))
  : null;
const temporary = await mkdtemp(path.join(tmpdir(), "openerx-composer-layout-"));
const evidence = process.env.OPENERX_LAYOUT_OUTPUT_DIR
  ? path.resolve(process.env.OPENERX_LAYOUT_OUTPUT_DIR)
  : null;
const chrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const executablePath =
  process.env.OPENERX_LAYOUT_BROWSER_EXECUTABLE ??
  (process.platform === "darwin" && existsSync(chrome) ? chrome : chromium.executablePath());
const origin = "http://isolated-composer.fixture";
const results = [];
let browser;

async function settle(page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
}

async function capture(page, name) {
  if (evidence) await page.screenshot({ path: path.join(evidence, `${name}.png`) });
}

try {
  assert(existsSync(executablePath), "Install Chromium or set OPENERX_LAYOUT_BROWSER_EXECUTABLE");
  if (evidence) await mkdir(evidence, { recursive: true });
  await build({
    root: fixture,
    configFile: false,
    base: "/",
    publicDir: path.join(desktop, "public"),
    logLevel: "error",
    define: brand ? { __OPENERX_BRAND__: JSON.stringify(brand) } : {},
    plugins: [
      {
        name: "composer-fixture-edition",
        transform(code, id) {
          if (id === path.join(fixture, "main.tsx") && existsSync(brandTheme))
            return `${code}\nimport ${JSON.stringify(brandTheme)};`;
        },
        transformIndexHtml(html) {
          return brand
            ? html.replace('<html lang="zh-CN"', `<html data-brand="${brand.id}" lang="zh-CN"`)
            : html;
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
        {
          find: "@openerx/desktop-ui/workspace",
          replacement: path.join(repo, "packages/desktop-ui/src/workspace.tsx"),
        },
        {
          find: "@openerx/desktop-extension/renderer",
          replacement: path.join(fixture, "extension.tsx"),
        },
      ],
    },
    build: { outDir: path.join(temporary, "dist"), emptyOutDir: true },
  });
  browser = await chromium.launch({ headless: true, executablePath });
  for (const [width, height] of [
    [920, 640],
    [613, 427],
  ]) {
    for (const scheme of ["light", "dark"]) {
      const page = await browser.newPage({
        viewport: { width, height },
        locale: "zh-CN",
        colorScheme: scheme,
      });
      const errors = [];
      const requests = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.route("**/*", async (route) => {
        const url = new URL(route.request().url());
        requests.push(url.href);
        assert.equal(url.origin, origin, "Composer fixture must never contact an external service");
        const file = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
        assert(!file.includes(".."));
        await route.fulfill({
          body: await readFile(path.join(temporary, "dist", file)),
          contentType: file.endsWith("js")
            ? "application/javascript"
            : file.endsWith("css")
              ? "text/css"
              : file.endsWith("svg")
                ? "image/svg+xml"
                : "text/html",
        });
      });
      await page.goto(origin);
      await page.getByText("查看任务示例", { exact: true }).waitFor();
      await settle(page);
      // The compact shell offers its sidebar as an overlay. Collapse it through the real control.
      if (width <= 640) await page.getByRole("button", { name: "收起侧栏", exact: true }).click();
      await settle(page);
      const initial = await page.locator(".new-chat-page").evaluate((main) => {
        const rect = (element) => {
          const bounds = element.getBoundingClientRect();
          return { top: bounds.top, bottom: bounds.bottom, left: bounds.left, right: bounds.right };
        };
        return {
          input: rect(main.querySelector("textarea")),
          tools: rect(main.querySelector(".composer-actions")),
          examplesCollapsed: !main.querySelector("details.new-chat-suggestions").open,
          pageScrollWidth: document.documentElement.scrollWidth,
          pageClientWidth: document.documentElement.clientWidth,
          fixture: window.__composerLayoutFixture,
        };
      });
      assert(initial.examplesCollapsed);
      assert(
        initial.input.top >= 0 && initial.input.bottom <= height,
        "Initial input must fit the first screen",
      );
      assert(
        initial.tools.top >= 0 && initial.tools.bottom <= height,
        "Initial composer toolbar must fit the first screen",
      );
      assert(
        initial.pageScrollWidth <= initial.pageClientWidth,
        "Initial composer must not widen the document",
      );
      await capture(page, `new-chat-${width}-${height}-${scheme}`);
      await page.getByRole("button", { name: "选择 Skill菜单", exact: true }).click();
      const menu = page.getByRole("listbox", { name: "选择 Skill", exact: true });
      await menu.waitFor();
      await page.waitForTimeout(200);
      const menuMetrics = await menu.evaluate((element) => {
        const bounds = element.getBoundingClientRect();
        return {
          top: bounds.top,
          bottom: bounds.bottom,
          left: bounds.left,
          right: bounds.right,
          clientHeight: element.clientHeight,
          scrollHeight: element.scrollHeight,
          pageScrollWidth: document.documentElement.scrollWidth,
          pageClientWidth: document.documentElement.clientWidth,
          portal: element.parentElement === document.body,
        };
      });
      assert(menuMetrics.portal);
      assert(
        menuMetrics.left >= 0 &&
          menuMetrics.right <= menuMetrics.pageClientWidth &&
          menuMetrics.top >= 0 &&
          menuMetrics.bottom <= height,
        "Full Skill menu must stay inside the viewport",
      );
      assert(
        menuMetrics.pageScrollWidth <= menuMetrics.pageClientWidth,
        "Opening a menu must not introduce horizontal page scrolling",
      );
      assert(
        menuMetrics.scrollHeight > menuMetrics.clientHeight,
        "Long Skill lists must scroll inside their menu",
      );
      assert(await menu.getByText("创建、编辑 DOCX 文档，并预览版式。", { exact: true }).count());
      await capture(page, `skill-menu-${width}-${height}-${scheme}`);
      await page.keyboard.press("End");
      await settle(page);
      const end = await menu.evaluate((element) => {
        const option = Array.from(element.querySelectorAll(".composer-select-option")).at(-1);
        const row = option.getBoundingClientRect();
        const bounds = element.getBoundingClientRect();
        return {
          focused: document.activeElement === option,
          label: option.textContent,
          top: row.top,
          bottom: row.bottom,
          menuTop: bounds.top,
          menuBottom: bounds.bottom,
          scrollTop: element.scrollTop,
          count: element.querySelectorAll(".composer-select-option").length,
          fixture: window.__composerLayoutFixture,
        };
      });
      assert(
        end.focused && end.scrollTop > 0 && end.top >= end.menuTop && end.bottom <= end.menuBottom,
        "Keyboard End must focus and reveal the final Skill",
      );
      assert.equal(end.count, initial.fixture.skillCount + 1);
      assert.deepEqual(end.fixture.calls, []);
      assert.deepEqual(errors, []);
      await capture(page, `skill-menu-end-${width}-${height}-${scheme}`);
      await page.keyboard.press("Escape");
      await menu.waitFor({ state: "detached" });
      results.push({
        width,
        height,
        scheme,
        compactSidebarCollapsed: width <= 640,
        initial,
        menu: menuMetrics,
        end,
        errors,
        requests,
      });
      await page.close();
    }
  }
  if (evidence)
    await writeFile(
      path.join(evidence, "composer-layout-metrics.json"),
      JSON.stringify(results, null, 2),
    );
  console.log(JSON.stringify({ status: "passed", cases: results.length, evidence }));
} finally {
  await browser?.close();
  await rm(temporary, { recursive: true, force: true });
}
