import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { verifyInstalledBrace } from "./pi-shrinkwrap-install.mjs";

const script = fileURLToPath(import.meta.url);
const root = process.env.COMPAT_REPO ?? path.resolve(path.dirname(script), "../..");

async function runFixture() {
  const require = createRequire(path.join(root, "package.json"));
  const piDirectory = require.resolve
    .paths("@earendil-works/pi-coding-agent")
    .map((directory) => path.join(directory, "@earendil-works/pi-coding-agent"))
    .find((directory) => existsSync(path.join(directory, "package.json")));
  assert.ok(piDirectory, "Pi must be installed for its resource filter regression");
  assert.equal(JSON.parse(readFileSync(path.join(piDirectory, "package.json"))).version, "1.0.0");
  const piRequire = createRequire(path.join(piDirectory, "package.json"));
  const minimatchRequire = createRequire(piRequire.resolve("minimatch"));
  const braceEntry = minimatchRequire.resolve("brace-expansion");
  const braceDirectory = path.resolve(path.dirname(braceEntry), "../..");
  verifyInstalledBrace(braceDirectory);
  const { DefaultResourceLoader } = await import(
    pathToFileURL(path.join(piDirectory, "dist/core/resource-loader.js")).href
  );
  const { SettingsManager } = await import(
    pathToFileURL(path.join(piDirectory, "dist/core/settings-manager.js")).href
  );
  const directory = mkdtempSync(path.join(tmpdir(), "pi-resource-glob-"));
  try {
    const prompts = path.join(directory, "prompts");
    mkdirSync(prompts);
    const prompt = path.join(prompts, "safe.md");
    writeFileSync(prompt, "Synthetic local prompt, without executable resources.\n");
    const loader = new DefaultResourceLoader({
      cwd: directory,
      agentDir: path.join(directory, "agent"),
      settingsManager: SettingsManager.inMemory({}, { projectTrusted: false }),
      noExtensions: true,
      noSkills: true,
      noThemes: true,
      noContextFiles: true,
    });
    // Invoke the loader's actual local resource filter. Full discovery would
    // also inspect ~/.agents; this path needs only the isolated prompt above.
    const filter = (pattern) => {
      const target = new Map();
      loader.packageManager.resolveLocalEntries(
        [prompts, pattern],
        "prompts",
        target,
        { source: "local", scope: "user", origin: "top-level" },
        prompts,
      );
      assert.equal(target.size, 1);
      return target.get(prompt).enabled;
    };
    assert.equal(filter("!{safe,other}.md"), false, "ordinary brace globs must still work");
    const depth = 4_000;
    const deepGlob = `!${"{".repeat(depth)}safe,other${"}".repeat(depth)}.md`;
    // Official 5.0.12 bounds nesting and keeps excess nesting literal. The
    // deep exclusion cannot match this prompt or exhaust the native stack.
    assert.equal(filter(deepGlob), true);
    assert.equal(filter("!{safe,other}.md"), false, "filter remains usable after deep input");
    return { piVersion: "1.0.0", braceVersion: "5.0.12", depth, promptCount: 1 };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

if (process.argv.includes("--fixture")) {
  console.log(JSON.stringify(await runFixture()));
} else {
  test("Pi ResourceLoader local filtering bounds deeply nested globs and retains ordinary matching", {
    timeout: 60_000,
  }, () => {
    const result = spawnSync(process.execPath, [script, "--fixture"], {
      encoding: "utf8",
      timeout: 45_000,
    });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr);
    const evidence = JSON.parse(result.stdout.trim());
    assert.equal(evidence.braceVersion, "5.0.12");
    assert.equal(evidence.depth, 4_000);
    assert.equal(evidence.promptCount, 1);
  });
}
