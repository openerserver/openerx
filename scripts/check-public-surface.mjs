import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const publicDocuments = [
  "README.md",
  "AGENTS.md",
  "SECURITY.md",
  "docs/development.md",
  "docs/architecture.md",
  "docs/models.md",
  "docs/releasing.md",
];
const allowed = new Set(publicDocuments);
const blockedRoots = new Set(["v1-backup", "deliverables", "checkpoints", "artifacts"]);
const documentExtension = /\.(?:md|mdx|rst)$/iu;
const officeExtension = /\.(?:pptx?|docx?|xlsx?|pdf)$/iu;
const fixturePath = /(?:^|\/)(?:tests?|fixtures?)(?:\/|$)/u;
const privateDocumentation =
  /\b(?:UWA|Unicom|OpenerX-Enterprise|openerx-advanced)\b|(?:^|\s)V1(?:\s|$)|v1-backup|\/Users\/|shell1\.phones-cloud/u;

export function publicSurfaceViolations(root, files) {
  const failures = [];
  for (const file of files) {
    const parts = file.split("/");
    if (
      blockedRoots.has(parts[0]) ||
      parts.some((part) =>
        ["node_modules", ".vite", "out", ".codex-temp", ".codex-tmp"].includes(part),
      ) ||
      (file.startsWith("docs/") && !allowed.has(file)) ||
      (documentExtension.test(file) && !allowed.has(file)) ||
      (officeExtension.test(file) && !fixturePath.test(file))
    )
      failures.push(`Not part of the public source distribution: ${file}`);
    if (!allowed.has(file)) continue;
    const text = readFileSync(path.join(root, file), "utf8");
    if (privateDocumentation.test(text))
      failures.push(`Private or obsolete documentation: ${file}`);
    const links = [
      ...[...text.matchAll(/\[[^\]]*\]\(([^)]+)\)/gu)].map((match) => match[1]),
      ...[...text.matchAll(/(?:src|href)="([^"]+)"/gu)].map((match) => match[1]),
    ];
    for (const raw of links) {
      const link = raw.trim().replace(/^<|>$/gu, "").split(/[?#]/u)[0];
      if (!link || /^(?:[a-z][a-z\d+.-]*:|\/\/)/iu.test(link)) continue;
      const target = path.resolve(root, path.dirname(file), decodeURIComponent(link));
      if (!target.startsWith(`${path.resolve(root)}${path.sep}`) || !existsSync(target))
        failures.push(`Broken or external local link in ${file}: ${raw}`);
    }
  }
  for (const document of publicDocuments)
    if (!files.includes(document)) failures.push(`Missing public guide: ${document}`);
  if (!files.includes("LICENSE")) failures.push("Missing LICENSE");
  return failures;
}

const entry = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (import.meta.url === entry) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const files = execFileSync(
    "git",
    ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
    {
      cwd: root,
      maxBuffer: 16 * 1024 * 1024,
    },
  )
    .toString()
    .split("\0")
    .filter(Boolean);
  const failures = publicSurfaceViolations(root, [...new Set(files)]);
  if (failures.length) {
    console.error(failures.join("\n"));
    process.exitCode = 1;
  } else
    console.log(
      `[public-surface] OK: ${files.length} source files; ${publicDocuments.length} public guides.`,
    );
}
