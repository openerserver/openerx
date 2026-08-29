import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "../..");
const args = process.argv.slice(2);
const environmentFile = path.join(repositoryRoot, ".env");
if (existsSync(environmentFile)) process.loadEnvFile(environmentFile);

function runNode(script, scriptArgs) {
  const result = spawnSync(process.execPath, [script, ...scriptArgs], {
    cwd: repositoryRoot,
    env: process.env,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

await build({
  configFile: path.join(scriptDirectory, "vite.daily-probe.config.mts"),
  logLevel: "error",
});

const probeStatus = runNode(
  path.join(repositoryRoot, ".vite", "lws-daily-probe", "lws-daily-probe.mjs"),
  args,
);
if (probeStatus !== 0) {
  process.exitCode = probeStatus;
} else {
  const gateOutput = path.join(repositoryRoot, "tests", "v2", "golden", "lws-006-gate-status.json");
  if (existsSync(gateOutput)) {
    const require = createRequire(import.meta.url);
    const formatStatus = runNode(require.resolve("@biomejs/biome/bin/biome"), [
      "format",
      "--write",
      gateOutput,
    ]);
    if (formatStatus !== 0) process.exitCode = formatStatus;
  }
}
