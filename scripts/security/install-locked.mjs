import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { verifyBracesBackport, verifyBracesLocks } from "./check-braces-backport.mjs";
import { verifyForgeBackport, verifyForgeLocks } from "./check-forge-backport.mjs";
import { checkInstalledPi } from "./pi-shrinkwrap-install.mjs";
import { checkPiShrinkwrapLock } from "./pi-shrinkwrap-lock.mjs";

// Fail before replacing installed dependencies if a refreshed lock restores
// Pi's vulnerable embedded resolution. Lock repair is a separate reviewed step.
const root = process.cwd();
const forgeRoot = existsSync(path.join(root, "vendor/security/node-forge-backport.json"))
  ? root
  : path.join(root, "core");
checkPiShrinkwrapLock(JSON.parse(readFileSync(path.join(root, "package-lock.json"), "utf8")));
verifyForgeLocks(forgeRoot);
verifyBracesLocks(forgeRoot);
const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error("NPM_CLI_MISSING: run npm run install:locked");
const result = spawnSync(
  process.execPath,
  [npmCli, "ci", "--ignore-scripts", "--no-audit", "--no-fund"],
  { cwd: root, stdio: "inherit" },
);
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
console.log(
  JSON.stringify({
    pi: checkInstalledPi(root),
    forge: verifyForgeBackport(forgeRoot),
    braces: verifyBracesBackport(forgeRoot),
  }),
);
