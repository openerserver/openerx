import { readFile, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

// appdmg 0.6 uses the old callable/path/callback API. Keep that interface while
// parsing with maintained image-size 2, never with the vulnerable 0.7 parser.
export function adaptLegacyImageSize(modern) {
  function legacy(input, callback) {
    if (typeof callback !== "function")
      return modern.imageSize(typeof input === "string" ? readFileSync(input) : input);
    const complete = (error, bytes) => {
      if (error) return callback(error);
      let dimensions;
      try {
        dimensions = modern.imageSize(bytes);
      } catch (error) {
        callback(error);
        return;
      }
      callback(null, dimensions);
    };
    if (typeof input === "string") readFile(input, complete);
    else queueMicrotask(() => complete(null, input));
  }
  return Object.assign(legacy, modern);
}

export function installDmgImageSizeAdapter() {
  const require = createRequire(import.meta.url);
  let appdmgRequire;
  try {
    const makerRequire = createRequire(require.resolve("@electron-forge/maker-dmg"));
    const installerRequire = createRequire(makerRequire.resolve("electron-installer-dmg"));
    appdmgRequire = createRequire(installerRequire.resolve("appdmg"));
  } catch (error) {
    // DMG's optional native dependencies are absent on Windows/Linux and in
    // editions without a DMG maker. Do not suppress errors in an installed parser.
    if (error.code === "MODULE_NOT_FOUND") return false;
    throw error;
  }
  const parserPath = appdmgRequire.resolve("image-size");
  const parserVersion = JSON.parse(
    readFileSync(path.resolve(path.dirname(parserPath), "../../package.json"), "utf8"),
  ).version;
  if (parserVersion !== "2.0.4") throw new Error("DMG_IMAGE_SIZE_VERSION_REVIEW_REQUIRED");
  const modern = appdmgRequire("image-size");
  if (typeof modern === "function") return true;
  if (typeof modern.imageSize !== "function") throw new Error("DMG_IMAGE_SIZE_API_INVALID");
  const cached = appdmgRequire.cache[parserPath];
  if (!cached) throw new Error("DMG_IMAGE_SIZE_MODULE_NOT_CACHED");
  cached.exports = adaptLegacyImageSize(modern);
  return true;
}
