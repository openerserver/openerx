// @vitest-environment jsdom
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, expect, it } from "vitest";

const renderer = path.resolve(import.meta.dirname, "../src/renderer");
const theme = readFileSync(path.join(renderer, "theme.css"), "utf8");
const styles = readFileSync(path.join(renderer, "styles.css"), "utf8");
const brandPath = path.join(renderer, "brand-theme.css");
const brand = existsSync(brandPath) ? readFileSync(brandPath, "utf8") : "";

function tokens(source: string, selector: string) {
  const start = source.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`Missing theme selector: ${selector}`);
  return Object.fromEntries(
    [...source.slice(start, source.indexOf("}", start)).matchAll(/(--[\w-]+):\s*([^;]+);/g)].map(
      (match) => [match[1], match[2]],
    ),
  );
}

function luminance(color: string) {
  const channels = color.match(/^rgb\((\d+), (\d+), (\d+)\)$/);
  if (!channels) throw new Error(`Expected opaque computed color: ${color}`);
  const [red, green, blue] = channels.slice(1).map((channel) => {
    const value = Number(channel) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  if (red === undefined || green === undefined || blue === undefined)
    throw new Error(`Incomplete computed color: ${color}`);
  return red * 0.2126 + green * 0.7152 + blue * 0.0722;
}

afterEach(() => {
  document.head.innerHTML = "";
  document.body.innerHTML = "";
});

for (const variant of brand ? ["common", "unicom-uwa"] : ["common"]) {
  for (const mode of ["light", "dark"]) {
    it(`${variant} ${mode}: conversation menu labels are readable before hover or focus`, () => {
      const colors = {
        ...tokens(theme, ":root"),
        ...(mode === "light" ? tokens(theme, ':root[data-theme="light"]') : {}),
        ...(variant === "unicom-uwa" ? tokens(brand, ':root[data-brand="unicom-uwa"]') : {}),
        ...(variant === "unicom-uwa" && mode === "light"
          ? tokens(brand, ':root[data-brand="unicom-uwa"][data-theme="light"]')
          : {}),
      };
      // Resolve theme variables because jsdom does not resolve var() in computed styles.
      // Keep the complete stylesheet so selector specificity and later rules are exercised.
      const sheet = document.createElement("style");
      sheet.textContent = styles
        .replaceAll(/@import[^;]+;/g, "")
        .replaceAll(/var\((--[\w-]+)\)/g, (reference, name) => colors[name] ?? reference);
      document.head.append(sheet);
      document.body.innerHTML = `
        <header class="conversation-toolbar"><div class="toolbar-actions">
          <div class="conversation-menu" role="menu" aria-label="对话操作">
            <button type="button" role="menuitem">重命名</button>
            <button type="button" role="menuitem">移动到项目…</button>
            <button type="button" role="menuitem">归档对话</button>
            <button type="button" role="menuitem" class="danger-action">删除对话…</button>
          </div>
        </div></header>`;
      const menu = document.querySelector<HTMLElement>(".conversation-menu");
      if (!menu) throw new Error("Missing conversation menu");
      const menuBackground = getComputedStyle(menu).backgroundColor;
      for (const button of menu.querySelectorAll("button")) {
        const computed = getComputedStyle(button);
        const background = ["transparent", "rgba(0, 0, 0, 0)"].includes(computed.backgroundColor)
          ? menuBackground
          : computed.backgroundColor;
        const foregroundLuminance = luminance(computed.color);
        const backgroundLuminance = luminance(background);
        const contrast =
          (Math.max(foregroundLuminance, backgroundLuminance) + 0.05) /
          (Math.min(foregroundLuminance, backgroundLuminance) + 0.05);
        expect(
          contrast,
          `${button.textContent}: ${computed.color} on ${background}`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    });
  }
}
