import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const sourceRoots = ["apps", "packages", "services"];
const ignored = new Set([".vite", "dist", "node_modules", "out", "tests", "test", "__tests__"]);
const extensions = new Set([".js", ".jsx", ".mjs", ".mts", ".ts", ".tsx"]);
const importPattern = /(?:from\s*|import\s*\(|require\s*\()\s*["']([^"']+)["']/gu;

function files(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory() && ignored.has(entry.name)) return [];
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) return files(absolute);
    return extensions.has(path.extname(entry.name)) ? [absolute] : [];
  });
}

const violations = [];
const piImports = [];
const workspaceEdges = new Set();
const productionFiles = sourceRoots.flatMap((directory) => files(path.join(root, directory)));

for (const file of productionFiles) {
  const relative = path.relative(root, file);
  const source = readFileSync(file, "utf8");
  const inPiHost = relative.startsWith(`packages${path.sep}pi-host${path.sep}`);
  const inMobile = relative.startsWith(`apps${path.sep}mobile${path.sep}`);
  const inRemote = /(?:remote-host|remote-control-gateway|remote-protocol)/u.test(relative);

  if (!inPiHost && /\b(?:AgentSession|SessionManager)\b/u.test(source)) {
    violations.push(`${relative}: Pi session primitive outside packages/pi-host`);
  }
  if (inRemote && /\b(?:AgentSession|SessionManager|RuntimeAdapter|AgentQueue)\b/u.test(source)) {
    violations.push(`${relative}: Remote contains a second execution/session primitive`);
  }
  for (const match of source.matchAll(importPattern)) {
    const specifier = match[1] ?? "";
    if (/v1-backup|control-plane|opencode-fork|claude-code-main|pi-mono/u.test(specifier)) {
      violations.push(`${relative}: imports Legacy path ${specifier}`);
    }
    if (specifier.startsWith("@earendil-works/pi-")) {
      piImports.push({ file: relative, specifier });
      if (!inPiHost) violations.push(`${relative}: imports Pi outside packages/pi-host`);
    }
    if (/\/providers\/(?:faux|fake)|(?:^|\/)fixtures?(?:\/|$)/u.test(specifier)) {
      violations.push(`${relative}: imports test/fake provider ${specifier}`);
    }
    if (
      inMobile &&
      (specifier.startsWith("node:") ||
        specifier === "@openerx/pi-host" ||
        specifier === "@openerx/tool-sdk")
    ) {
      violations.push(`${relative}: mobile contains host runtime dependency ${specifier}`);
    }
    if (specifier.startsWith("@openerx/")) {
      const [ownerKind, ownerName] = relative.split(path.sep);
      workspaceEdges.add(`${ownerKind}/${ownerName}->${specifier}`);
    }
  }
}

if (piImports.length === 0) violations.push("No production Pi import found");
if (piImports.some(({ file }) => !file.startsWith(`packages${path.sep}pi-host${path.sep}`))) {
  violations.push("Production Pi dependency is not isolated to packages/pi-host");
}

if (violations.length > 0) {
  console.error("[m9-release-graph] FAILED");
  for (const violation of [...new Set(violations)]) console.error(`- ${violation}`);
  process.exitCode = 1;
} else {
  console.log(
    `[m9-release-graph] OK: ${productionFiles.length} production files, ${piImports.length} Pi imports isolated to packages/pi-host, ${workspaceEdges.size} workspace edges; mobile and Remote contain no second harness.`,
  );
}
