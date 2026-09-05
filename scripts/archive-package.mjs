import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const output = process.env.OPENERX_PACKAGE_OUT_DIR
  ? path.resolve(process.env.OPENERX_PACKAGE_OUT_DIR)
  : path.join(root, "apps/desktop/out");
const version = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")).version;
const target = `${process.platform}-${process.arch}`;
if (process.env.OPENERX_RELEASE_MODE === "1" || process.env.OPENERX_BRAND_MANIFEST?.trim())
  throw new Error("UNSIGNED_ARCHIVE_REQUIRES_PUBLIC_DEVELOPMENT_BUILD");
const directory = `OpenERX-${target}`;
const artifacts = path.join(output, "artifacts");
mkdirSync(artifacts, { recursive: true });
const name = `OpenERX-${version}-${target}-unsigned.tar.gz`;
const archive = path.join(artifacts, name);
// tar retains macOS framework symlinks and executable permissions that a raw
// upload-artifact directory would otherwise lose. Archive only the selected app.
execFileSync("tar", ["-czf", archive, "-C", output, directory], {
  stdio: "inherit",
  windowsHide: true,
});
const hash = createHash("sha256");
for await (const chunk of createReadStream(archive)) hash.update(chunk);
writeFileSync(path.join(artifacts, "SHA256SUMS"), `${hash.digest("hex")}  ${name}\n`);
console.log(`UNSIGNED_ARCHIVE_OK ${name} (not a signed release)`);
