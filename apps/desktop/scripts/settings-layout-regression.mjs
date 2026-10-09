import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import path from "node:path";

/** Verify the real settings shell; the caller opens it and supplies a Playwright page. */
export async function verifySettingsLayout(page, options = {}) {
  const originalViewport = page.viewportSize();
  const originalUrl = page.url();
  const originalFocus = await page.evaluateHandle(() => document.activeElement);
  const originalScroll = await page.evaluate(() => ({
    navLeft: document.querySelector(".settings-nav-scroll")?.scrollLeft ?? 0,
    contentTop: document.querySelector(".settings-section-content")?.scrollTop ?? 0,
  }));
  const shell = page.locator(".settings-account-page");
  await shell.waitFor();
  const capture = async (name) => {
    if (!options.evidenceDirectory) return;
    await mkdir(options.evidenceDirectory, { recursive: true });
    await page.screenshot({
      path: path.join(options.evidenceDirectory, `${options.prefix ?? "settings"}-${name}.png`),
    });
  };
  const settle = async () => {
    await page.evaluate(async () => {
      await document.fonts.ready;
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    });
  };
  const result = { widths: [], navigation: [] };
  try {
    for (let width = 1090; width <= 1110; width += 1) {
      await page.setViewportSize({ width, height: 769 });
      await settle();
      const measurement = await page
        .locator(".settings-section-content > *")
        .first()
        .evaluate((element) => {
          const rect = element.getBoundingClientRect();
          return { width: rect.width, left: rect.left };
        });
      const previous = result.widths.at(-1);
      if (previous) {
        assert.ok(
          Math.abs(measurement.width - previous.contentWidth) <= 2,
          `Settings content width must change continuously at ${width}px`,
        );
        assert.ok(
          Math.abs(measurement.left - previous.left) <= 2,
          `Settings content axis must change continuously at ${width}px`,
        );
      }
      result.widths.push({
        viewportWidth: width,
        contentWidth: measurement.width,
        left: measurement.left,
      });
      if (width === 1100 || width === 1101) await capture(`${width}px`);
    }

    await page.setViewportSize({ width: 613, height: 427 });
    await settle();
    result.compact = await page.locator(".settings-nav-scroll").evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return {
        height: rect.height,
        top: rect.top,
        bottom: rect.bottom,
        horizontalOverflow: document.documentElement.scrollWidth - innerWidth,
      };
    });
    assert.ok(result.compact.height >= 44, "Settings categories must retain a visible row");
    assert.ok(result.compact.bottom < 427, "Settings navigation must leave room for its content");
    assert.ok(result.compact.horizontalOverflow <= 1, "Settings must not widen the document");
    const buttons = page.locator(".settings-nav-scroll button");
    assert.ok((await buttons.count()) > 1, "The actual settings categories must be present");
    for (const button of await buttons.all()) {
      await button.focus();
      await settle();
      const measurement = await button.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        const nav = element.closest(".settings-nav-scroll").getBoundingClientRect();
        const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
        return {
          name: element.textContent?.trim() ?? "",
          focused: element === document.activeElement,
          visible:
            rect.left >= nav.left &&
            rect.right <= nav.right + 1 &&
            rect.top >= nav.top &&
            rect.bottom <= nav.bottom + 1 &&
            rect.left >= 0 &&
            rect.right <= innerWidth &&
            rect.top >= 0 &&
            rect.bottom <= innerHeight,
          clickable: element === hit || element.contains(hit),
        };
      });
      assert.equal(measurement.focused, true, `${measurement.name} must accept keyboard focus`);
      assert.equal(measurement.visible, true, `${measurement.name} must scroll fully into view`);
      assert.equal(measurement.clickable, true, `${measurement.name} must not be covered`);
      result.navigation.push(measurement);
    }
    await capture("compact-last-category");
    await buttons.first().focus();
    await settle();
    await capture("compact-first-category");
    assert.equal(
      page.url(),
      originalUrl,
      "Geometry checks must not change the active settings route",
    );
    return result;
  } finally {
    if (originalViewport) {
      await page.setViewportSize(originalViewport);
    } else {
      const session = await page.context().newCDPSession(page);
      await session.send("Emulation.clearDeviceMetricsOverride");
      await session.detach();
    }
    await originalFocus.evaluate((element) => {
      if (element instanceof HTMLElement && element.isConnected)
        element.focus({ preventScroll: true });
    });
    await originalFocus.dispose();
    await page.evaluate(({ navLeft, contentTop }) => {
      const nav = document.querySelector(".settings-nav-scroll");
      const content = document.querySelector(".settings-section-content");
      if (nav) nav.scrollLeft = navLeft;
      if (content) content.scrollTop = contentTop;
    }, originalScroll);
  }
}
