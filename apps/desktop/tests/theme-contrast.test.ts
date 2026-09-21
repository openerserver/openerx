// @vitest-environment node
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const renderer = path.resolve(import.meta.dirname, "../src/renderer");
const theme = readFileSync(path.join(renderer, "theme.css"), "utf8");
function tokens(selector: string, source = theme) {
  const start = source.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`Missing theme: ${selector}`);
  const body = source.slice(start, source.indexOf("}", start));
  return Object.fromEntries(
    [...body.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((match) => [match[1], match[2]]),
  );
}
function luminance(hex: string) {
  const channels = hex.match(/[a-f\d]{2}/gi)?.map((part) => {
    const value = Number.parseInt(part, 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  const [red, green, blue] = channels ?? [];
  if (red === undefined || green === undefined || blue === undefined)
    throw new Error(`Expected opaque sRGB color: ${hex}`);
  return red * 0.2126 + green * 0.7152 + blue * 0.0722;
}
function contrast(a: string, b: string) {
  const x = luminance(a),
    y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

const brandPath = path.join(renderer, "brand-theme.css");
const brand = existsSync(brandPath) ? readFileSync(brandPath, "utf8") : null;
const variants = brand ? ["common", "unicom-uwa"] : ["common"];
for (const variant of variants)
  describe(`${variant} desktop theme readability`, () => {
    for (const mode of ["dark", "light"]) {
      const colors = {
        ...tokens(":root"),
        ...(mode === "light" ? tokens(':root[data-theme="light"]') : {}),
        ...(variant === "unicom-uwa" && brand
          ? tokens(':root[data-brand="unicom-uwa"]', brand)
          : {}),
        ...(variant === "unicom-uwa" && brand && mode === "light"
          ? tokens(':root[data-brand="unicom-uwa"][data-theme="light"]', brand)
          : {}),
      };
      const check = (foreground: string, background: string, minimum = 4.5) => {
        expect(
          contrast(colors[`--workspace-${foreground}`], colors[`--workspace-${background}`]),
          `${mode}: ${foreground} on ${background}`,
        ).toBeGreaterThanOrEqual(minimum);
      };
      it(`${mode}: body, secondary text and links stay readable on all workspace surfaces`, () => {
        for (const background of [
          "bg",
          "surface",
          "surface-raised",
          "sidebar",
          "dock",
          "user-message",
          "status-surface",
          "accent-soft",
        ]) {
          for (const foreground of ["text", "muted", "muted-strong", "accent-strong"])
            check(foreground, background);
        }
      });
      it(`${mode}: primary actions and hover states keep a contrasting label`, () => {
        for (const background of ["accent", "accent-hover", "accent-strong"]) {
          check("accent-ink", background);
          check("accent-muted-ink", background);
        }
        check("danger-ink", "danger-action");
      });
      it(`${mode}: status labels remain readable on badges and ordinary surfaces`, () => {
        for (const state of ["success", "warning", "danger", "info"]) {
          for (const background of [`${state}-surface`, "surface", "surface-raised", "bg"])
            check(state, background);
        }
        check("code-text", "code-bg");
        check("code-text", "code-control");
        for (const surface of ["bg", "surface", "surface-raised"])
          check("border-strong", surface, 3);
      });
    }
    it("defines every referenced CSS variable, including auxiliary panels", () => {
      const sheets = readdirSync(renderer, { recursive: true }).filter((name) =>
        String(name).endsWith(".css"),
      );
      const sources = sheets.map((name) => readFileSync(path.join(renderer, String(name)), "utf8"));
      const definitions = new Set(
        sources.flatMap((source) =>
          [...source.matchAll(/(--[\w-]+)\s*:/g)].map((match) => match[1]),
        ),
      );
      for (const [index, source] of sources.entries()) {
        for (const match of source.matchAll(/var\((--[\w-]+)/g)) {
          expect(definitions.has(match[1]), `${sheets[index]} uses undefined ${match[1]}`).toBe(
            true,
          );
        }
      }
    });
    it("keeps the theme palette in one file and gives status text semantic colors", () => {
      const styles = readFileSync(path.join(renderer, "styles.css"), "utf8");
      expect(styles.startsWith('@import "./theme.css";')).toBe(true);
      expect(styles).not.toMatch(/--workspace-[\w-]+\s*:/);
      for (const [selector, token] of [
        [".inline-error", "danger"],
        [".run-succeeded", "success"],
        [".run-starting", "info"],
        [".account-status", "warning"],
      ]) {
        const rules = [...styles.matchAll(/([^{}]+)\{([^{}]+)\}/g)].filter((match) =>
          match[1]?.split(",").some((item) => item.trim() === selector),
        );
        expect(rules.length).toBeGreaterThan(0);
        for (const rule of rules) expect(rule[2]).toContain(`color: var(--workspace-${token});`);
      }
    });
  });
