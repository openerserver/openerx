import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceRoots = ["apps", "packages", "services"];
const sourceExtensions = new Set([".js", ".jsx", ".mjs", ".mts", ".ts", ".tsx"]);
const ignoredDirectories = new Set([".vite", "coverage", "dist", "node_modules", "out"]);
const forbiddenLegacyNames = [
  "v1-backup",
  "control-plane",
  "opencode-fork",
  "claude-code-main",
  "pi-mono",
];

function collectFiles(directory) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) {
      continue;
    }

    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectFiles(absolutePath));
    } else if (sourceExtensions.has(path.extname(entry.name))) {
      files.push(absolutePath);
    }
  }
  return files;
}

function workspaceOwner(filePath) {
  const relativePath = path.relative(repositoryRoot, filePath);
  const [kind, name] = relativePath.split(path.sep);
  return { kind, name };
}

function workspaceTargetFromRelativeImport(filePath, specifier) {
  const targetPath = path.resolve(path.dirname(filePath), specifier);
  const relativePath = path.relative(repositoryRoot, targetPath);
  const [kind, name] = relativePath.split(path.sep);
  return sourceRoots.includes(kind) ? { kind, name } : undefined;
}

const workspacePackages = new Map();
for (const kind of sourceRoots) {
  const root = path.join(repositoryRoot, kind);
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }
    const packageJsonPath = path.join(root, entry.name, "package.json");
    try {
      const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));
      if (typeof packageJson.name === "string") {
        workspacePackages.set(packageJson.name, { kind, name: entry.name });
      }
    } catch (error) {
      if (error?.code !== "ENOENT") {
        throw error;
      }
    }
  }
}

const violations = [];
const files = sourceRoots.flatMap((root) => collectFiles(path.join(repositoryRoot, root)));
const importPattern = /(?:from\s*|import\s*\(|require\s*\()\s*["']([^"']+)["']/g;

for (const filePath of files) {
  const owner = workspaceOwner(filePath);
  const source = readFileSync(filePath, "utf8");
  for (const match of source.matchAll(importPattern)) {
    const specifier = match[1];
    if (forbiddenLegacyNames.some((name) => specifier.includes(name))) {
      violations.push(
        `${path.relative(repositoryRoot, filePath)} imports legacy path ${specifier}`,
      );
      continue;
    }

    const target = specifier.startsWith(".")
      ? workspaceTargetFromRelativeImport(filePath, specifier)
      : workspacePackages.get(specifier);
    if (!target || (owner.kind === target.kind && owner.name === target.name)) {
      continue;
    }

    if (target.kind !== "packages") {
      violations.push(
        `${path.relative(repositoryRoot, filePath)} crosses into ${target.kind}/${target.name}; shared code must flow through packages/`,
      );
    }
  }
}

if (violations.length > 0) {
  console.error("[v2-boundaries] FAILED");
  for (const violation of violations) {
    console.error(`- ${violation}`);
  }
  process.exitCode = 1;
} else {
  console.log(
    `[v2-boundaries] OK: checked ${files.length} source files; V2 does not import Legacy or sibling app/service implementations.`,
  );
}
