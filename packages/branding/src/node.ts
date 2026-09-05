import { readFileSync } from "node:fs";
import path from "node:path";
import { type DesktopBrand, openERXBrand } from "./index";

const colorPattern = /^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/iu;
const executablePattern = /^[A-Za-z0-9._-]{1,64}$/u;
const bundleIdPattern = /^[A-Za-z0-9]+(?:[.-][A-Za-z0-9-]+)+$/u;
const brandIdPattern = /^[a-z][a-z0-9-]{0,63}$/u;
const maximumAssetBytes = 5 * 1024 * 1024;

function record(value: unknown, errorCode: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(errorCode);
  return value as Record<string, unknown>;
}

function textValue(
  source: Record<string, unknown>,
  key: string,
  fallback: string,
  maximumLength = 160,
): string {
  const value = source[key] ?? fallback;
  if (typeof value !== "string" || !value.trim() || value.length > maximumLength) {
    throw new Error(`BRAND_MANIFEST_TEXT_INVALID:${key}`);
  }
  return value.trim();
}

function optionalText(source: Record<string, unknown>, key: string): string | null {
  const value = source[key];
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || value.length > 500) {
    throw new Error(`BRAND_MANIFEST_TEXT_INVALID:${key}`);
  }
  return value;
}

function assetDataUrl(manifestDirectory: string, relativeFile: string | null): string | null {
  if (!relativeFile) return null;
  if (path.isAbsolute(relativeFile)) throw new Error("BRAND_ASSET_PATH_MUST_BE_RELATIVE");
  const assetPath = path.resolve(manifestDirectory, relativeFile);
  const relativePath = path.relative(manifestDirectory, assetPath);
  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    throw new Error("BRAND_ASSET_OUTSIDE_MANIFEST_DIRECTORY");
  }
  const extension = path.extname(assetPath).toLowerCase();
  const mimeType =
    extension === ".png" ? "image/png" : extension === ".svg" ? "image/svg+xml" : null;
  if (!mimeType) throw new Error("BRAND_ASSET_TYPE_UNSUPPORTED");
  const content = readFileSync(assetPath);
  if (content.byteLength > maximumAssetBytes) throw new Error("BRAND_ASSET_TOO_LARGE");
  return `data:${mimeType};base64,${content.toString("base64")}`;
}

export function loadDesktopBrand(manifestPath = process.env.OPENERX_BRAND_MANIFEST): DesktopBrand {
  if (!manifestPath?.trim()) return openERXBrand;
  const resolvedManifestPath = path.resolve(manifestPath);
  const source = record(
    JSON.parse(readFileSync(resolvedManifestPath, "utf8")) as unknown,
    "BRAND_MANIFEST_INVALID",
  );
  if (source.schemaVersion !== 1) throw new Error("BRAND_MANIFEST_VERSION_UNSUPPORTED");
  const colors = record(source.colors, "BRAND_MANIFEST_COLORS_INVALID");
  const brand: DesktopBrand = {
    schemaVersion: 1,
    id: textValue(source, "id", openERXBrand.id, 64),
    productName: textValue(source, "productName", openERXBrand.productName),
    displayName: textValue(source, "displayName", openERXBrand.displayName),
    assistantName: textValue(source, "assistantName", openERXBrand.assistantName),
    assistantTitle: textValue(source, "assistantTitle", openERXBrand.assistantTitle),
    description: textValue(source, "description", openERXBrand.description, 240),
    appBundleId: textValue(source, "appBundleId", openERXBrand.appBundleId),
    executableName: textValue(source, "executableName", openERXBrand.executableName, 64),
    setupExecutableName: textValue(
      source,
      "setupExecutableName",
      openERXBrand.setupExecutableName,
      80,
    ),
    publisher: textValue(source, "publisher", openERXBrand.publisher),
    workspaceDirectoryName: textValue(
      source,
      "workspaceDirectoryName",
      openERXBrand.workspaceDirectoryName,
    ),
    markText: textValue(source, "markText", openERXBrand.markText, 8),
    logoAlt: textValue(source, "logoAlt", openERXBrand.logoAlt),
    colors: {
      accent: textValue(colors, "accent", openERXBrand.colors.accent, 9),
      accentStrong: textValue(colors, "accentStrong", openERXBrand.colors.accentStrong, 9),
      accentHover: textValue(colors, "accentHover", openERXBrand.colors.accentHover, 9),
      accentSoft: textValue(colors, "accentSoft", openERXBrand.colors.accentSoft, 9),
    },
    logoDataUrl: null,
    assistantImageDataUrl: null,
  };
  if (!brandIdPattern.test(brand.id)) throw new Error("BRAND_ID_INVALID");
  if (!bundleIdPattern.test(brand.appBundleId)) throw new Error("BRAND_BUNDLE_ID_INVALID");
  if (!executablePattern.test(brand.executableName)) throw new Error("BRAND_EXECUTABLE_INVALID");
  if (!executablePattern.test(brand.setupExecutableName)) {
    throw new Error("BRAND_SETUP_EXECUTABLE_INVALID");
  }
  for (const [key, value] of Object.entries(brand.colors)) {
    if (!colorPattern.test(value)) throw new Error(`BRAND_COLOR_INVALID:${key}`);
  }
  const manifestDirectory = path.dirname(resolvedManifestPath);
  brand.logoDataUrl = assetDataUrl(manifestDirectory, optionalText(source, "logoFile"));
  brand.assistantImageDataUrl = assetDataUrl(
    manifestDirectory,
    optionalText(source, "assistantImageFile"),
  );
  return brand;
}
