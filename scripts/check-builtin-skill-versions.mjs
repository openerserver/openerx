import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const lockRelativePath = "packages/skills/builtin-skill-snapshots.json";
const lockPath = path.join(repositoryRoot, ...lockRelativePath.split("/"));

function skillVersion(files) {
  const manifest = files["agents/openai.yaml"];
  const match = typeof manifest === "string" ? /^version:\s*([^\s#]+)\s*$/m.exec(manifest) : null;
  if (!match) throw new Error("BUILTIN_SKILL_VERSION_MISSING");
  return match[1];
}

function skillName(files) {
  const definition = files["SKILL.md"];
  const match =
    typeof definition === "string" ? /^name:\s*([^\r\n#]+)\s*$/m.exec(definition) : null;
  if (!match) throw new Error("BUILTIN_SKILL_NAME_MISSING");
  return match[1].trim();
}

function skillChecksum(files) {
  const digest = createHash("sha256");
  for (const relativePath of Object.keys(files).sort((left, right) => left.localeCompare(right))) {
    digest.update(relativePath);
    digest.update("\0");
    digest.update(files[relativePath]);
    digest.update("\0");
  }
  return digest.digest("hex");
}

function parseSemver(version) {
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[a-z][a-z0-9-]*)?$/.exec(version);
  if (!match) throw new Error(`BUILTIN_SKILL_VERSION_INVALID: ${version}`);
  return match.slice(1).map(Number);
}

function compareSemver(left, right) {
  const leftParts = parseSemver(left);
  const rightParts = parseSemver(right);
  for (let index = 0; index < leftParts.length; index += 1) {
    const difference = leftParts[index] - rightParts[index];
    if (difference !== 0) return Math.sign(difference);
  }
  return 0;
}

export function assertVersionPolicy(baseSnapshot, currentSnapshot) {
  const baseById = new Map(baseSnapshot.skills.map((skill) => [skill.installationId, skill]));
  const violations = [];

  for (const current of currentSnapshot.skills) {
    const base = baseById.get(current.installationId);
    parseSemver(current.version);
    if (!base) continue;

    const versionComparison = compareSemver(current.version, base.version);
    if (versionComparison < 0) {
      violations.push(
        `${current.name}: version regressed from ${base.version} to ${current.version}`,
      );
      continue;
    }
    if (current.checksum !== base.checksum && versionComparison <= 0) {
      violations.push(
        `${current.name}: checksum changed but version did not increase (${base.version} -> ${current.version})`,
      );
    }
  }

  if (violations.length > 0) {
    throw new Error(`BUILTIN_SKILL_VERSION_NOT_INCREMENTED\n${violations.join("\n")}`);
  }
}

function createSnapshot(builtInSkills) {
  return {
    schemaVersion: 1,
    skills: builtInSkills
      .map((skill) => ({
        installationId: skill.installationId,
        name: skillName(skill.files),
        version: skillVersion(skill.files),
        checksum: skillChecksum(skill.files),
      }))
      .sort((left, right) => left.installationId.localeCompare(right.installationId)),
  };
}

function canonicalJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function readBaseSnapshot(baseRef) {
  if (!baseRef || /^0+$/.test(baseRef)) return null;
  try {
    const text = execFileSync("git", ["show", `${baseRef}:${lockRelativePath}`], {
      cwd: repositoryRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function argumentValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  // Use the same TypeScript resolver as the desktop build, including brand imports.
  const { createServer } = await import("vite");
  const server = await createServer({
    root: repositoryRoot,
    configFile: false,
    optimizeDeps: { noDiscovery: true, entries: [] },
    server: { middlewareMode: true },
    appType: "custom",
  });
  let builtInSkills;
  try {
    ({ builtInSkills } = await server.ssrLoadModule("/packages/skills/src/builtins.ts"));
  } finally {
    await server.close();
  }
  const currentSnapshot = createSnapshot(builtInSkills);

  if (process.argv.includes("--write")) {
    writeFileSync(lockPath, canonicalJson(currentSnapshot), "utf8");
    console.log(`Updated ${lockRelativePath}`);
    return;
  }

  const committedSnapshot = JSON.parse(readFileSync(lockPath, "utf8"));
  if (canonicalJson(committedSnapshot) !== canonicalJson(currentSnapshot)) {
    throw new Error(
      `BUILTIN_SKILL_SNAPSHOT_STALE: run "npm run update:builtin-skills:v2" and commit ${lockRelativePath}`,
    );
  }

  const baseRef =
    argumentValue("--base") ?? process.env.OPENERX_BUILTIN_SKILL_BASE_REF?.trim() ?? "HEAD";
  const baseSnapshot = readBaseSnapshot(baseRef);
  if (baseSnapshot) {
    assertVersionPolicy(baseSnapshot, currentSnapshot);
    console.log(`Built-in Skill versions are valid against ${baseRef}.`);
  } else {
    console.log(`No baseline snapshot found at ${baseRef}; current snapshot is valid.`);
  }
}

const entryPoint = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (import.meta.url === entryPoint) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
