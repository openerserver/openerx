import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const platformUrl = `http://127.0.0.1:${process.env.OPENERX_PLATFORM_PORT ?? "4099"}`;
const platform = spawn(process.execPath, [".vite/deepseek-platform/platform.mjs"], {
  cwd: repositoryRoot,
  env: process.env,
  stdio: ["ignore", "pipe", "inherit"],
});

let desktop = null;
let readyOutput = "";
let stopping = false;
const readyTimeout = setTimeout(() => {
  process.stderr.write("[openerx-dev] platform startup timed out\n");
  void stop(1);
}, 15_000);

platform.stdout.setEncoding("utf8");
platform.stdout.on("data", (chunk) => {
  process.stdout.write(chunk);
  readyOutput += chunk;
  if (!desktop && readyOutput.includes("[openerx-platform] ready")) {
    clearTimeout(readyTimeout);
    desktop = spawn("npm", ["run", "dev:desktop"], {
      cwd: repositoryRoot,
      env: {
        ...process.env,
        OPENERX_PLATFORM_URL: platformUrl,
        OPENERX_DEV_AUTO_SIGN_IN: "1",
        OPENERX_DEV_EMAIL: process.env.OPENERX_DEV_EMAIL ?? "desktop-dev@openerx.local",
      },
      stdio: "inherit",
    });
    desktop.once("exit", (code) => void stop(code ?? 0));
  }
});

platform.once("exit", (code) => {
  if (!stopping) {
    process.stderr.write(`[openerx-dev] platform exited with code ${code ?? "unknown"}\n`);
    void stop(code ?? 1);
  }
});

async function terminate(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, 3_000)),
  ]);
}

async function stop(exitCode) {
  if (stopping) return;
  stopping = true;
  clearTimeout(readyTimeout);
  await terminate(desktop);
  await terminate(platform);
  process.exit(exitCode);
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => void stop(0));
}
