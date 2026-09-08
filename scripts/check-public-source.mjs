import { execFileSync } from "node:child_process";
import { lstatSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = path.resolve(import.meta.dirname, "..");

export function publicPathViolation(file) {
  const normalized = file.replaceAll("\\", "/");
  if (
    /(?:^|\/)(?:v1-backup|node_modules|\.git|\.codex-temp|\.private|enterprise|brands)(?:\/|$)/iu.test(
      normalized,
    )
  )
    return "private-or-generated-directory";
  if (
    /^(?:apps\/mobile|deliverables|docs\/presentations|apps\/desktop\/out[^/]*)(?:\/|$)/iu.test(
      normalized,
    )
  )
    return "non-public-directory";
  if (/(?:^|\/)(?:dist|out|coverage|\.vite)(?:\/|$)/u.test(normalized)) return "build-output";
  const name = path.posix.basename(normalized);
  if (/^\.env(?:\.|$)/u.test(name) && !/^\.env(?:\.[\w-]+)?\.example$/u.test(name))
    return "environment-file";
  if (/\.(?:sqlite3?|db)(?:-(?:wal|shm|journal))?$/iu.test(name)) return "user-database";
  if (/\.(?:p12|pfx|p8|pem|key|jks|keystore)$/iu.test(name)) return "credential-file";
  if (/\.(?:exe|msi|dmg|asar|dmp|log|inspect\.ndjson)$/iu.test(name))
    return "binary-or-runtime-output";
  if (name === "credentials.json" || name === ".gitmodules") return "private-configuration";
  if (
    normalized === "design-qa.md" ||
    normalized.startsWith("docs/archive/") ||
    /^docs\/v2\/(?:0\d|1[0-6])-/u.test(normalized)
  )
    return "internal-publication-material";
  return null;
}

export function publicIdentityViolations(commit) {
  const identities = [...commit.matchAll(/^(?:author|committer) (.*?) <([^>]+)>/gmu)];
  return identities
    .filter(
      ([, , email]) =>
        !/^(?:[^@\s]+@(?:users\.)?noreply\.github\.com|[^@\s]+@[^@\s]+\.invalid|noreply@github\.com)$/iu.test(
          email,
        ),
    )
    .map(() => "personal-commit-email");
}

export function githubPullRequestTestMergeSha(environment, event, checkoutSha, commit) {
  if (environment.GITHUB_ACTIONS !== "true" || environment.GITHUB_EVENT_NAME !== "pull_request")
    return null;
  const ref = /^refs\/pull\/([1-9]\d*)\/merge$/u.exec(environment.GITHUB_REF ?? "");
  const sha = environment.GITHUB_SHA;
  if (!ref || !/^[a-f\d]{40}$/u.test(sha ?? "") || sha !== checkoutSha) return null;
  if (
    !Number.isSafeInteger(event?.number) ||
    event.number !== Number(ref[1]) ||
    event.pull_request?.number !== event.number
  )
    return null;
  const base = event.pull_request?.base?.sha;
  const head = event.pull_request?.head?.sha;
  if (!/^[a-f\d]{40}$/u.test(base ?? "") || !/^[a-f\d]{40}$/u.test(head ?? "")) return null;
  const headers = commit.split("\n\n", 1)[0];
  const parents = [...headers.matchAll(/^parent ([a-f\d]{40})$/gmu)].map((match) => match[1]);
  return parents.length === 2 && parents[0] === base && parents[1] === head ? sha : null;
}

export function publicContentViolations(content) {
  if (content.includes("\0")) return [];
  const checks = [
    [
      "private-key",
      /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----(?:\r?\n|\\n)[A-Za-z0-9+/=]{40}/u,
    ],
    ["github-token", /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{60,})\b/u],
    ["aws-access-key", /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/u],
    ["provider-key", /\bsk-(?:proj-)?[A-Za-z0-9_-]{40,}\b/u],
  ];
  const violations = checks
    .filter(([, expression]) => expression.test(content))
    .map(([rule]) => rule);
  // Match home directories, not lower-case /users API routes. Keep explicit examples usable.
  const profiles = [
    ...content.matchAll(/(?:[A-Za-z]:[\\/]+[Uu]sers[\\/]+|\/Users\/|\/home\/)([^\\/\s"'`]+)/gu),
  ];
  if (
    profiles.some(
      ([, name]) =>
        !/^(?:example|alice|bob|name|user|runner|oai|<[^>]+>|\$\{[^}]+\})$/iu.test(name),
    )
  )
    violations.push("personal-home-directory");
  if (/codex-clipboard-[a-f\d]{8}-[a-f\d-]{27,}/iu.test(content))
    violations.push("personal-clipboard-reference");
  return violations;
}

function git(args, options = {}) {
  return execFileSync("git", args, { cwd: root, maxBuffer: 100 * 1024 * 1024, ...options });
}

function main() {
  if (process.env.OPENERX_BRAND_MANIFEST?.trim())
    throw new Error("PUBLIC_CHECK_REQUIRES_DEFAULT_BRAND");
  const failures = new Set();
  const inspect = (label, content) => {
    for (const rule of publicContentViolations(content)) failures.add(`${label}: ${rule}`);
  };
  const paths = git(["ls-files", "--cached", "--others", "--exclude-standard", "-z"])
    .toString()
    .split("\0")
    .filter(Boolean);
  for (const file of new Set(paths)) {
    const rule = publicPathViolation(file);
    if (rule) failures.add(`${file}: ${rule}`);
    let stat;
    try {
      stat = lstatSync(path.join(root, file));
    } catch {
      continue;
    }
    if (!stat.isFile()) {
      failures.add(`${file}: non-regular-file`);
      continue;
    }
    if (stat.size > 10 * 1024 * 1024) failures.add(`${file}: oversized-source-file`);
    else inspect(file, readFileSync(path.join(root, file), "utf8"));
  }

  // Scan every reachable tree, not merely ignored paths in the current checkout.
  const commits = git(["rev-list", "--all"]).toString().trim().split("\n").filter(Boolean);
  let testMergeSha = null;
  if (process.env.GITHUB_ACTIONS === "true" && process.env.GITHUB_EVENT_NAME === "pull_request") {
    try {
      const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"));
      const checkoutSha = git(["rev-parse", "HEAD"]).toString().trim();
      testMergeSha = githubPullRequestTestMergeSha(
        process.env,
        event,
        checkoutSha,
        git(["cat-file", "commit", checkoutSha]).toString(),
      );
    } catch {
      // Missing or invalid runner evidence must leave every identity check enabled.
    }
  }
  const blobs = new Map();
  for (const commit of commits) {
    // GitHub chooses the identity of this temporary integration commit; its tree is still scanned.
    if (commit !== testMergeSha) {
      for (const rule of publicIdentityViolations(git(["cat-file", "commit", commit]).toString())) {
        failures.add(`history:${commit.slice(0, 12)}: ${rule}`);
      }
    }
    for (const entry of git(["ls-tree", "-r", "-z", commit])
      .toString()
      .split("\0")
      .filter(Boolean)) {
      const [metadata, file] = entry.split("\t");
      const [mode, type, hash] = metadata.split(" ");
      const rule = publicPathViolation(file);
      if (rule) failures.add(`history:${file}: ${rule}`);
      if (mode === "160000" || mode === "120000")
        failures.add(`history:${file}: embedded-repository-or-symlink`);
      if (type === "blob") blobs.set(hash, file);
    }
  }
  if (blobs.size) {
    const batch = git(["cat-file", "--batch"], { input: `${[...blobs.keys()].join("\n")}\n` });
    let offset = 0;
    for (const [hash, file] of blobs) {
      const end = batch.indexOf(10, offset);
      const header = batch.subarray(offset, end).toString().split(" ");
      if (header[0] !== hash || header[1] !== "blob") throw new Error("HISTORY_BLOB_SCAN_FAILED");
      const size = Number(header[2]);
      if (!Number.isSafeInteger(size)) throw new Error("HISTORY_BLOB_SIZE_INVALID");
      inspect(`history:${file}`, batch.subarray(end + 1, end + 1 + size).toString());
      offset = end + 1 + size + 1;
    }
  }
  for (const required of [
    "LICENSE",
    "NOTICE",
    "README.md",
    "SECURITY.md",
    "CONTRIBUTING.md",
    "THIRD_PARTY_NOTICES.md",
    "THIRD_PARTY_LICENSES.txt",
    "docs/DEVELOPMENT.md",
    "docs/PRIVACY.md",
    "docs/PUBLISHING.md",
  ]) {
    try {
      readFileSync(path.join(root, required));
    } catch {
      failures.add(`${required}: required-file-missing`);
    }
  }
  if (failures.size) throw new Error(`PUBLIC_SOURCE_CHECK_FAILED\n${[...failures].join("\n")}`);
  console.log(
    `PUBLIC_SOURCE_OK files=${new Set(paths).size} commits=${commits.length} historicalBlobs=${blobs.size}; manual rights/privacy review still required`,
  );
}

if (import.meta.url === pathToFileURL(path.resolve(process.argv[1] ?? "")).href) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
