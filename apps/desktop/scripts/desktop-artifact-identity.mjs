import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

// Build scripts must select the same product as the packaged application.
// Brand manifests are optional inputs; no private product is built into this module.
export function desktopArtifactIdentity(desktop, env = process.env) {
  const pkg = JSON.parse(readFileSync(path.join(desktop, "package.json"), "utf8"));
  const manifest = env.OPENERX_BRAND_MANIFEST ? path.resolve(env.OPENERX_BRAND_MANIFEST) : null;
  const brand = manifest ? JSON.parse(readFileSync(manifest, "utf8")) : {};
  const productName = brand.productName ?? pkg.productName;
  const executableName = brand.executableName ?? pkg.executableName ?? productName;
  const appBundleId = brand.appBundleId ?? "com.openerx.desktop";
  if (
    typeof productName !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9 ._-]{0,95}$/u.test(productName) ||
    productName.endsWith(".") ||
    productName.endsWith(" ")
  )
    throw new Error("DESKTOP_ARTIFACT_PRODUCT_INVALID");
  if (
    typeof executableName !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/u.test(executableName)
  )
    throw new Error("DESKTOP_ARTIFACT_EXECUTABLE_INVALID");
  if (typeof appBundleId !== "string" || !/^[A-Za-z0-9]+(?:[.-][A-Za-z0-9-]+)+$/u.test(appBundleId))
    throw new Error("DESKTOP_ARTIFACT_BUNDLE_INVALID");
  return { productName, executableName, appBundleId, version: pkg.version, manifest, brand };
}

export function desktopStoreInputs(desktop, env = process.env) {
  const identity = desktopArtifactIdentity(desktop, env);
  // A custom product must explicitly select its own Partner Center identity.
  if (identity.manifest && !env.OPENERX_WINDOWS_STORE_CONFIG)
    throw new Error("WINDOWS_STORE_PRODUCT_CONFIG_REQUIRED");
  const configurationFile = path.resolve(
    env.OPENERX_WINDOWS_STORE_CONFIG || path.join(desktop, "resources", "windows-store.json"),
  );
  if (!existsSync(configurationFile)) throw new Error("WINDOWS_STORE_PRODUCT_CONFIG_REQUIRED");
  const configuration = JSON.parse(readFileSync(configurationFile, "utf8").replace(/^\uFEFF/u, ""));
  if (configuration.executable !== `${identity.executableName}.exe`)
    throw new Error("WINDOWS_STORE_EXECUTABLE_MISMATCH");
  if (configuration.version !== `${identity.version}.0`)
    throw new Error("WINDOWS_STORE_VERSION_MISMATCH");
  let logoFile = env.OPENERX_WINDOWS_STORE_ICON;
  if (!logoFile && identity.manifest) {
    const relative = identity.brand.assistantImageFile || identity.brand.logoFile;
    if (typeof relative === "string" && !path.isAbsolute(relative)) {
      const base = path.dirname(identity.manifest);
      const candidate = path.resolve(base, relative);
      if (!path.relative(base, candidate).startsWith("..")) logoFile = candidate;
    }
  }
  logoFile = path.resolve(logoFile || path.join(desktop, "public", "assets", "openerx-mark.png"));
  if (!existsSync(logoFile)) throw new Error("WINDOWS_STORE_ICON_REQUIRED");
  return { ...identity, configurationFile, configuration, logoFile };
}
