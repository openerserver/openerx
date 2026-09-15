import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => JSON.parse(readFileSync(path.join(root, file), "utf8"));
const write = (file, value) => writeFileSync(path.join(root, file), `${JSON.stringify(value, null, 2)}\n`);
const args = process.argv.slice(2);
const current = read("package.json");
let version = current.version;
const action = args[0] ?? "check";
if (action === "bump") {
  const index = ["major", "minor", "patch"].indexOf(args[1] ?? "patch");
  if (index < 0) throw new Error("Use major, minor or patch");
  const parts = version.split(".").map(Number);
  parts[index] += 1;
  for (let i = index + 1; i < 3; i++) parts[i] = 0;
  version = parts.join(".");
} else if (action === "set") version = args[1];
else if (!["sync", "check"].includes(action)) throw new Error("Use check, sync, bump or set");
if (!/^\d+\.\d+\.\d+$/u.test(version) || version === "0.0.0") throw new Error("PRODUCT_VERSION_REQUIRED");
const checking = action === "check";
const update = (file, mutate) => {
  const value = read(file), before = JSON.stringify(value);
  mutate(value);
  if (JSON.stringify(value) !== before) {
    if (checking) throw new Error(`PRODUCT_VERSION_DRIFT: ${file}`);
    write(file, value);
  }
};
const desktop = existsSync(path.join(root, "core/apps/desktop/package.json")) ? "core/apps/desktop" : "apps/desktop";
for (const file of ["package.json", `${desktop}/package.json`, "apps/mobile/package.json"])
  update(file, (value) => { value.version = version; });
update("apps/mobile/app.json", (value) => { value.expo.version = version; });
if (existsSync(path.join(root, `${desktop}/resources/windows-store.json`)))
  update(`${desktop}/resources/windows-store.json`, (value) => { value.version = `${version}.0`; });
update("package-lock.json", (value) => {
  value.version = version;
  for (const key of ["", desktop, "apps/mobile"])
    if (value.packages?.[key]) value.packages[key].version = version;
});
if (desktop.startsWith("core/")) {
  update("core/package.json", (value) => { value.version = version; });
  update("core/package-lock.json", (value) => {
    value.version = version;
    for (const key of ["", "apps/desktop"]) if (value.packages?.[key]) value.packages[key].version = version;
  });
}
const native = path.join(root, "apps/mobile/ios/UWA/Info.plist");
if (existsSync(native)) {
  const before = readFileSync(native, "utf8");
  const after = before.replace(/(<key>CFBundleShortVersionString<\/key>\s*<string>)[^<]+/u, `$1${version}`);
  if (checking && after !== before) throw new Error("PRODUCT_VERSION_DRIFT: iOS Info.plist");
  if (!checking) writeFileSync(native, after);
  const project = path.join(root, "apps/mobile/ios/UWA.xcodeproj/project.pbxproj");
  const projectBefore = readFileSync(project, "utf8");
  const projectAfter = projectBefore.replace(/MARKETING_VERSION = [^;]+;/gu, `MARKETING_VERSION = ${version};`);
  if (checking && projectAfter !== projectBefore) throw new Error("PRODUCT_VERSION_DRIFT: iOS project");
  if (!checking) writeFileSync(project, projectAfter);
}
const serverVersion = path.join(root, "services/central-auth/buildinfo/version.txt");
if (existsSync(serverVersion)) {
  if (checking && readFileSync(serverVersion, "utf8").trim() !== version) throw new Error("PRODUCT_VERSION_DRIFT: server");
  if (!checking) writeFileSync(serverVersion, `${version}\n`);
}
console.log(`Product version ${version}: ${checking ? "verified" : "synchronized"}`);
