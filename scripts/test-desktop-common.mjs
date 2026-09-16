import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const vitest = path.join(path.dirname(require.resolve("vitest/package.json")), "vitest.mjs");
const tsc = path.join(path.dirname(require.resolve("typescript/package.json")), "bin/tsc");
function run(entry, args, cwd = root) {
  const result = spawnSync(process.execPath, [entry, ...args], { cwd, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
for (const project of [
  "apps/desktop",
  "packages/app-service",
  "packages/pi-host",
  "packages/remote-host",
  "packages/remote-protocol",
])
  run(tsc, ["--noEmit", "-p", `${project}/tsconfig.json`]);
run(
  vitest,
  [
    "run",
    "--maxWorkers=2",
    "tests/browser-settings-panel.test.tsx",
    "tests/browser-computer-use-system-default.test.ts",
    "tests/browser-computer-use-browser-bridge.test.ts",
    "tests/desktop-tool-availability.test.ts",
    "tests/desktop-native-permissions.test.ts",
    "tests/desktop-control-ui.test.tsx",
    "tests/model-connection.test.ts",
    "tests/chat-ui.test.tsx",
    "tests/mcp-config.test.ts",
    "tests/mcp-editor.test.tsx",
    "tests/mcp-settings.test.ts",
    "tests/mac-signing.test.ts",
    "tests/credential-vault.test.ts",
    "tests/account-session-manager.test.ts",
    "tests/desktop-data-persistence.test.ts",
    "tests/remote-settings.test.tsx",
    "tests/remote-connections.test.tsx",
    "tests/remote-authorization-refresh.test.ts",
  ],
  path.join(root, "apps/desktop"),
);
run(vitest, [
  "run",
  "--maxWorkers=2",
  "--testTimeout=30000",
  "packages/app-service/tests/remote-app-service.test.ts",
  "packages/contracts/tests/remote.test.ts",
  "packages/app-service/tests/tool-app-service.test.ts",
  "packages/remote-host/tests/http-transport.test.ts",
  "packages/pi-host/tests/agent-session.test.ts",
  "packages/tool-sdk/tests/broker.test.ts",
  "packages/tool-sdk/tests/workspace-change-tracker.test.ts",
  "packages/tool-sdk/tests/mcp-adapter.test.ts",
  "services/remote-control-gateway/tests/connection-requests.test.ts",
  "services/remote-control-gateway/tests/remote-control-gateway.test.ts",
  "tests/v2/remote-connection-http.test.ts",
  "tests/v2/remote-host-gateway.test.ts",
]);
console.log("Common desktop regressions passed.");
