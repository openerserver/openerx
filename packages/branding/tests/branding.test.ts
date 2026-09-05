import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { openERXBrand } from "../src/index";
import { loadDesktopBrand } from "../src/node";

describe("desktop branding", () => {
  it("uses the public OpenERX brand by default", () => {
    expect(loadDesktopBrand()).toEqual(openERXBrand);
  });

  it("loads a private brand and embeds its local image assets", () => {
    const directory = path.join(tmpdir(), `openerx-brand-${crypto.randomUUID()}`);
    mkdirSync(path.join(directory, "assets"), { recursive: true });
    writeFileSync(path.join(directory, "assets", "logo.png"), Buffer.from([137, 80, 78, 71]));
    const manifestPath = path.join(directory, "brand.json");
    writeFileSync(
      manifestPath,
      JSON.stringify({
        ...openERXBrand,
        id: "example-enterprise",
        productName: "Example",
        executableName: "Example",
        setupExecutableName: "ExampleSetup.exe",
        logoDataUrl: undefined,
        assistantImageDataUrl: undefined,
        logoFile: "assets/logo.png",
      }),
    );

    const brand = loadDesktopBrand(manifestPath);
    expect(brand.productName).toBe("Example");
    expect(brand.logoDataUrl).toMatch(/^data:image\/png;base64,/u);
  });

  it("rejects assets outside the private manifest directory", () => {
    const directory = path.join(tmpdir(), `openerx-brand-${crypto.randomUUID()}`);
    mkdirSync(directory, { recursive: true });
    const manifestPath = path.join(directory, "brand.json");
    writeFileSync(
      manifestPath,
      JSON.stringify({
        ...openERXBrand,
        logoDataUrl: undefined,
        assistantImageDataUrl: undefined,
        logoFile: "../logo.png",
      }),
    );
    expect(() => loadDesktopBrand(manifestPath)).toThrow("BRAND_ASSET_OUTSIDE_MANIFEST_DIRECTORY");
  });
});
