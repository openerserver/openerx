import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import {
  desktopArtifactIdentity,
  desktopStoreInputs,
} from "../scripts/desktop-artifact-identity.mjs";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), "openerx-artifact-identity-"));
  roots.push(root);
  writeFileSync(
    path.join(root, "package.json"),
    JSON.stringify({ productName: "Personal", version: "2.0.1" }),
  );
  const brand = path.join(root, "brand.json");
  writeFileSync(
    brand,
    JSON.stringify({
      productName: "Custom Product",
      executableName: "CustomProduct",
      appBundleId: "org.example.custom",
      assistantImageFile: "icon.png",
    }),
  );
  writeFileSync(path.join(root, "icon.png"), "test fixture");
  return { root, brand };
}

it("uses the current product identity for package directories, binaries and signatures", () => {
  const f = fixture();
  expect(desktopArtifactIdentity(f.root, {})).toMatchObject({
    productName: "Personal",
    executableName: "Personal",
    appBundleId: "com.openerx.desktop",
  });
  expect(desktopArtifactIdentity(f.root, { OPENERX_BRAND_MANIFEST: f.brand })).toMatchObject({
    productName: "Custom Product",
    executableName: "CustomProduct",
    appBundleId: "org.example.custom",
  });
});

it("does not reuse a default Store identity for a custom product", () => {
  const f = fixture();
  mkdirSync(path.join(f.root, "resources"));
  writeFileSync(path.join(f.root, "resources", "windows-store.json"), "{}");
  expect(() => desktopStoreInputs(f.root, { OPENERX_BRAND_MANIFEST: f.brand })).toThrow(
    "WINDOWS_STORE_PRODUCT_CONFIG_REQUIRED",
  );
});

it("accepts only a matching executable and package version in an explicit Store config", () => {
  const f = fixture();
  const config = path.join(f.root, "store.json");
  const env = { OPENERX_BRAND_MANIFEST: f.brand, OPENERX_WINDOWS_STORE_CONFIG: config };
  writeFileSync(config, JSON.stringify({ executable: "Personal.exe", version: "2.0.1.0" }));
  expect(() => desktopStoreInputs(f.root, env)).toThrow("EXECUTABLE_MISMATCH");
  writeFileSync(config, JSON.stringify({ executable: "CustomProduct.exe", version: "2.0.0.0" }));
  expect(() => desktopStoreInputs(f.root, env)).toThrow("VERSION_MISMATCH");
  writeFileSync(config, JSON.stringify({ executable: "CustomProduct.exe", version: "2.0.1.0" }));
  expect(desktopStoreInputs(f.root, env).logoFile).toBe(path.join(f.root, "icon.png"));
});

it("rejects path traversal in the product name before searching artifacts", () => {
  const f = fixture();
  writeFileSync(f.brand, JSON.stringify({ productName: "../Other" }));
  expect(() => desktopArtifactIdentity(f.root, { OPENERX_BRAND_MANIFEST: f.brand })).toThrow(
    "PRODUCT_INVALID",
  );
});
