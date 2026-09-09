import { mkdirSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import path from "node:path";
import {
  BROWSER_COMPUTER_USE_CONTRACT_VERSION,
  type BrowserObservation,
  type NormalizedToolResult,
} from "@openerx/contracts";
import { app } from "electron";
import { ElectronMacSystemBrowserDriver } from "../src/main/browser-computer-use/electron-mac-system-browser-driver";
import {
  type SystemBrowserBinding,
  SystemDefaultBrowserAdapter,
} from "../src/main/browser-computer-use/system-default-browser-adapter";

if (process.platform !== "darwin") throw new Error("BCU_TAKEOVER_MACOS_REQUIRED");
console.log("BCU_TAKEOVER_BOOT");

const desktopDirectory = process.cwd();
const outputDirectory = path.resolve(
  process.env.OPENERX_BCU_TAKEOVER_OUTPUT ??
    path.join(desktopDirectory, ".vite", "browser-takeover", "evidence"),
);
const helperPath = path.join(desktopDirectory, ".native-build", "openerx-browser-accessibility");
const defaultInputTimeoutMs = 120_000;

function inputTimeoutMs(): number {
  const configured = process.env.OPENERX_BCU_TAKEOVER_TIMEOUT_MS;
  if (!configured) return defaultInputTimeoutMs;

  const value = Number(configured);
  if (!Number.isSafeInteger(value) || value < 10_000 || value > 600_000) {
    throw new Error("BCU_TAKEOVER_TIMEOUT_INVALID");
  }
  return value;
}

function observation(result: NormalizedToolResult): Omit<BrowserObservation, "image"> {
  const value = result.data as { observation?: Omit<BrowserObservation, "image"> };
  if (!value.observation) throw new Error("BCU_TAKEOVER_OBSERVATION_MISSING");
  return value.observation;
}

async function fixtureServer(): Promise<{ server: Server; url: string }> {
  const server = createServer((_request, response) => {
    response.setHeader("Content-Type", "text/html; charset=utf-8");
    response.setHeader("Cache-Control", "no-store, max-age=0");
    response.end(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>OpenERX takeover fixture</title>
  <style>
    body { margin: 0; padding: 48px; color: #172033; font: 20px system-ui, sans-serif; }
    main { min-height: 520px; border: 3px solid #2563eb; border-radius: 20px; padding: 40px; }
  </style>
</head>
<body>
  <main aria-label="Takeover target">
    <h1>User input takeover fixture</h1>
    <p>Use a physical mouse or trackpad to click inside this blue panel.</p>
    <p>Automation-generated Computer Use input does not satisfy this human takeover gate.</p>
  </main>
</body>
</html>`);
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("BCU_TAKEOVER_SERVER_FAILED");
  return { server, url: `http://127.0.0.1:${address.port}/` };
}

async function closeServer(server: Server): Promise<void> {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

async function waitForPause(
  adapter: SystemDefaultBrowserAdapter,
  sessionId: string,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (adapter.descriptor(sessionId).state === "paused_for_user") return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("BCU_TAKEOVER_INPUT_TIMEOUT");
}

async function expectedError(operation: () => Promise<unknown>, code: string): Promise<void> {
  try {
    await operation();
  } catch (error) {
    if (error instanceof Error && error.message === code) return;
    throw error;
  }
  throw new Error(`BCU_TAKEOVER_EXPECTED_ERROR_MISSING:${code}`);
}

class TrackingMacSystemBrowserDriver extends ElectronMacSystemBrowserDriver {
  binding: SystemBrowserBinding | null = null;

  override async openDedicatedWindow(
    url: string,
    signal: AbortSignal,
  ): Promise<SystemBrowserBinding> {
    this.binding = await super.openDedicatedWindow(url, signal);
    return this.binding;
  }
}

async function run(): Promise<void> {
  console.log("BCU_TAKEOVER_READY");
  const timeoutMs = inputTimeoutMs();
  mkdirSync(outputDirectory, { recursive: true });
  const fixture = await fixtureServer();
  const driver = new TrackingMacSystemBrowserDriver(helperPath);
  const adapter = new SystemDefaultBrowserAdapter(driver);
  const signal = new AbortController().signal;
  let stage = "open";

  try {
    const openedResult = await adapter.execute(
      {
        contractVersion: BROWSER_COMPUTER_USE_CONTRACT_VERSION,
        action: "open",
        url: fixture.url,
      },
      signal,
    );
    const opened = observation(openedResult);
    console.log(
      `BCU_TAKEOVER_WAITING:${JSON.stringify({
        nativeWindowId: opened.nativeWindowId,
        requiredInput: "physical_pointer_or_keyboard",
        target: "exact_dedicated_window",
        timeoutMs,
      })}`,
    );

    stage = "wait-user-input";
    await waitForPause(adapter, opened.sessionId, timeoutMs);
    const pausedAt = new Date().toISOString();
    stage = "assert-paused-observe";
    await expectedError(
      async () =>
        await adapter.execute(
          {
            contractVersion: BROWSER_COMPUTER_USE_CONTRACT_VERSION,
            action: "observe",
            sessionId: opened.sessionId,
          },
          signal,
        ),
      "BROWSER_USER_TAKEOVER_REQUIRED",
    );
    stage = "assert-paused-action";
    await expectedError(
      async () =>
        await adapter.execute(
          {
            contractVersion: BROWSER_COMPUTER_USE_CONTRACT_VERSION,
            action: "key",
            sessionId: opened.sessionId,
            observationId: opened.observationId,
            key: "Space",
          },
          signal,
        ),
      "BROWSER_USER_TAKEOVER_REQUIRED",
    );

    stage = "resume";
    const resumedResult = await adapter.resumeAfterUser(opened.sessionId, signal);
    const resumed = observation(resumedResult);
    if (resumed.observationId === opened.observationId) {
      throw new Error("BCU_TAKEOVER_RESUME_OBSERVATION_REUSED");
    }
    stage = "assert-old-observation-expired";
    await expectedError(
      async () =>
        await adapter.execute(
          {
            contractVersion: BROWSER_COMPUTER_USE_CONTRACT_VERSION,
            action: "key",
            sessionId: opened.sessionId,
            observationId: opened.observationId,
            key: "Space",
          },
          signal,
        ),
      "BROWSER_OBSERVATION_EXPIRED",
    );

    stage = "close";
    const closedResult = await adapter.execute(
      {
        contractVersion: BROWSER_COMPUTER_USE_CONTRACT_VERSION,
        action: "close",
        sessionId: resumed.sessionId,
        observationId: resumed.observationId,
      },
      signal,
    );
    const closed = (closedResult.data as { session?: { state?: string } }).session;
    const evidence = {
      contractVersion: BROWSER_COMPUTER_USE_CONTRACT_VERSION,
      backend: resumed.backend,
      controlPath: resumed.controlPath,
      nativeWindowId: resumed.nativeWindowId,
      inputGate: "physical_exact_window_event",
      inputTimeoutMs: timeoutMs,
      pausedAt,
      pausedState: "paused_for_user",
      pausedObserveRejected: true,
      pausedActionRejected: true,
      resumedWithFreshObservation: true,
      oldObservationRejectedAfterResume: true,
      closeState: closed?.state ?? null,
    };
    writeFileSync(
      path.join(outputDirectory, "result.json"),
      `${JSON.stringify(evidence, null, 2)}\n`,
      { encoding: "utf8", mode: 0o600 },
    );
    console.log(`BCU_TAKEOVER_OK:${JSON.stringify(evidence)}`);
  } catch (error) {
    console.error(
      `BCU_TAKEOVER_FAILED:${stage}:${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
    if (driver.binding) {
      await driver.closeOwnedWindow(driver.binding, signal).catch(() => undefined);
    }
  } finally {
    adapter.close();
    await closeServer(fixture.server);
    app.exit(process.exitCode ?? 0);
  }
}

void app
  .whenReady()
  .then(run)
  .catch((error: unknown) => {
    console.error(`BCU_TAKEOVER_FAILED:${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
    app.exit(1);
  });
