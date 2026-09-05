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

if (process.platform !== "darwin") throw new Error("BCU_ACTIONS_MACOS_REQUIRED");
console.log("BCU_ACTIONS_BOOT");

const desktopDirectory = process.cwd();
const outputDirectory = path.resolve(
  process.env.OPENERX_BCU_ACTIONS_OUTPUT ??
    path.join(desktopDirectory, ".vite", "browser-actions", "evidence"),
);
const helperPath = path.join(desktopDirectory, ".vite", "native", "openerx-browser-accessibility");

function observation(result: NormalizedToolResult): Omit<BrowserObservation, "image"> {
  const value = result.data as { observation?: Omit<BrowserObservation, "image"> };
  if (!value.observation) throw new Error("BCU_ACTIONS_OBSERVATION_MISSING");
  return value.observation;
}

function actionPath(result: NormalizedToolResult): BrowserObservation["actionPath"] {
  return (result.data as { actionPath?: BrowserObservation["actionPath"] }).actionPath ?? null;
}

function saveImage(fileName: string, result: NormalizedToolResult): void {
  const content = result.content?.find((item) => item.type === "image");
  if (content?.type !== "image") throw new Error("BCU_ACTIONS_IMAGE_MISSING");
  writeFileSync(path.join(outputDirectory, fileName), Buffer.from(content.data, "base64"), {
    mode: 0o600,
  });
}

function html(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function fixturePage(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${html(title)}</title>
  <style>
    body { margin: 0; padding: 40px; color: #172033; font: 18px system-ui, sans-serif; }
    input, button { font: inherit; padding: 10px 14px; }
    .spacer { height: 5200px; background: linear-gradient(#f8fafc, #dbeafe); margin-top: 32px; }
  </style>
</head>
<body>${body}</body>
</html>`;
}

async function fixtureServer(): Promise<{
  server: Server;
  origin: string;
  pageBRequests: () => number;
}> {
  let pageACount = 0;
  let pageBCount = 0;
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    response.setHeader("Content-Type", "text/html; charset=utf-8");
    response.setHeader("Cache-Control", "no-store, max-age=0");
    if (url.pathname === "/a") {
      pageACount += 1;
      response.end(
        fixturePage(
          `Action Matrix A ${pageACount}`,
          `<h1>Action Matrix A</h1>
<form action="/b" method="get">
  <label>Query <input name="q" aria-label="Action query"></label>
  <button type="submit">Open page B</button>
</form>`,
        ),
      );
      return;
    }
    if (url.pathname === "/b") {
      pageBCount += 1;
      response.end(
        fixturePage(
          `Action Matrix B ${pageBCount}`,
          `<h1>Action Matrix B</h1>
<p>Query: ${html(url.searchParams.get("q") ?? "")}</p>
<a href="/a">Return to page A</a>
<div class="spacer" aria-label="Scrollable fixture"></div>
<button type="button">Bottom marker</button>`,
        ),
      );
      return;
    }
    response.statusCode = 404;
    response.end("Not found");
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("BCU_ACTIONS_SERVER_FAILED");
  return {
    server,
    origin: `http://127.0.0.1:${address.port}`,
    pageBRequests: () => pageBCount,
  };
}

async function closeServer(server: Server): Promise<void> {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
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
  console.log("BCU_ACTIONS_READY");
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
        url: `${fixture.origin}/a`,
      },
      signal,
    );
    const opened = observation(openedResult);
    stage = "find-searchbox";
    const searchbox = opened.elements.find(
      (element) =>
        ["searchbox", "textbox"].includes(element.role) &&
        element.name.includes("Action query") &&
        element.actions.includes("setValue"),
    );
    if (!searchbox) throw new Error("BCU_ACTIONS_SEARCHBOX_MISSING");

    stage = "set-value";
    const typedResult = await adapter.execute(
      {
        contractVersion: BROWSER_COMPUTER_USE_CONTRACT_VERSION,
        action: "setValue",
        sessionId: opened.sessionId,
        observationId: opened.observationId,
        target: { elementRef: searchbox.elementRef },
        text: "phonescloudX",
      },
      signal,
    );
    const typed = observation(typedResult);
    stage = "backspace";
    const keyResult = await adapter.execute(
      {
        contractVersion: BROWSER_COMPUTER_USE_CONTRACT_VERSION,
        action: "key",
        sessionId: typed.sessionId,
        observationId: typed.observationId,
        key: "Backspace",
      },
      signal,
    );
    const edited = observation(keyResult);
    const editedSearchbox = edited.elements.find((element) =>
      ["searchbox", "textbox"].includes(element.role),
    );
    if (editedSearchbox?.value !== "phonescloud") {
      throw new Error("BCU_ACTIONS_KEY_VALUE_MISMATCH");
    }
    stage = "find-submit";
    const submit = edited.elements.find(
      (element) =>
        element.role === "button" &&
        element.name.includes("Open page B") &&
        element.actions.includes("invoke"),
    );
    if (!submit) throw new Error("BCU_ACTIONS_SUBMIT_MISSING");
    stage = "invoke-submit";
    const invokedResult = await adapter.execute(
      {
        contractVersion: BROWSER_COMPUTER_USE_CONTRACT_VERSION,
        action: "invoke",
        sessionId: edited.sessionId,
        observationId: edited.observationId,
        target: { elementRef: submit.elementRef },
      },
      signal,
    );
    const invoked = observation(invokedResult);
    await new Promise((resolve) => setTimeout(resolve, 500));
    stage = "observe-page-b";
    const pageBResult = await adapter.execute(
      {
        contractVersion: BROWSER_COMPUTER_USE_CONTRACT_VERSION,
        action: "observe",
        sessionId: invoked.sessionId,
      },
      signal,
    );
    const pageB = observation(pageBResult);
    if (!pageB.url.startsWith(`${fixture.origin}/b?`) || !pageB.url.includes("q=phonescloud")) {
      throw new Error("BCU_ACTIONS_PAGE_B_MISMATCH");
    }
    saveImage("01-page-b.png", pageBResult);

    stage = "scroll";
    const scrolledResult = await adapter.execute(
      {
        contractVersion: BROWSER_COMPUTER_USE_CONTRACT_VERSION,
        action: "scroll",
        sessionId: pageB.sessionId,
        observationId: pageB.observationId,
        direction: "down",
        distance: "viewport",
      },
      signal,
    );
    const scrolled = observation(scrolledResult);
    if (scrolled.screenshotDigest === pageB.screenshotDigest) {
      throw new Error("BCU_ACTIONS_SCROLL_UNCHANGED");
    }
    saveImage("02-scrolled.png", scrolledResult);

    stage = "back";
    const backResult = await adapter.execute(
      {
        contractVersion: BROWSER_COMPUTER_USE_CONTRACT_VERSION,
        action: "back",
        sessionId: scrolled.sessionId,
        observationId: scrolled.observationId,
      },
      signal,
    );
    const backed = observation(backResult);
    if (new URL(backed.url).pathname !== "/a") throw new Error("BCU_ACTIONS_BACK_MISMATCH");

    stage = "forward";
    const forwardResult = await adapter.execute(
      {
        contractVersion: BROWSER_COMPUTER_USE_CONTRACT_VERSION,
        action: "forward",
        sessionId: backed.sessionId,
        observationId: backed.observationId,
      },
      signal,
    );
    const forwarded = observation(forwardResult);
    if (new URL(forwarded.url).pathname !== "/b") {
      throw new Error("BCU_ACTIONS_FORWARD_MISMATCH");
    }

    const requestsBeforeReload = fixture.pageBRequests();
    stage = "reload";
    const reloadResult = await adapter.execute(
      {
        contractVersion: BROWSER_COMPUTER_USE_CONTRACT_VERSION,
        action: "reload",
        sessionId: forwarded.sessionId,
        observationId: forwarded.observationId,
      },
      signal,
    );
    const reloaded = observation(reloadResult);
    if (
      new URL(reloaded.url).pathname !== "/b" ||
      fixture.pageBRequests() <= requestsBeforeReload
    ) {
      throw new Error("BCU_ACTIONS_RELOAD_MISMATCH");
    }
    saveImage("03-reloaded.png", reloadResult);

    stage = "close";
    const closedResult = await adapter.execute(
      {
        contractVersion: BROWSER_COMPUTER_USE_CONTRACT_VERSION,
        action: "close",
        sessionId: reloaded.sessionId,
        observationId: reloaded.observationId,
      },
      signal,
    );
    const session = (closedResult.data as { session?: { state?: string } }).session;
    const evidence = {
      contractVersion: BROWSER_COMPUTER_USE_CONTRACT_VERSION,
      backend: reloaded.backend,
      controlPath: reloaded.controlPath,
      nativeWindowId: reloaded.nativeWindowId,
      key: { name: "Backspace", value: editedSearchbox.value, path: actionPath(keyResult) },
      scroll: {
        direction: "down",
        distance: "viewport",
        changed: scrolled.screenshotDigest !== pageB.screenshotDigest,
        path: actionPath(scrolledResult),
      },
      back: { path: actionPath(backResult), pathname: new URL(backed.url).pathname },
      forward: { path: actionPath(forwardResult), pathname: new URL(forwarded.url).pathname },
      reload: { path: actionPath(reloadResult), pageBRequests: fixture.pageBRequests() },
      closeState: session?.state ?? null,
    };
    writeFileSync(
      path.join(outputDirectory, "result.json"),
      `${JSON.stringify(evidence, null, 2)}\n`,
      { encoding: "utf8", mode: 0o600 },
    );
    console.log(`BCU_ACTIONS_OK:${JSON.stringify(evidence)}`);
  } catch (error) {
    console.error(
      `BCU_ACTIONS_FAILED:${stage}:${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
    if (driver.binding) {
      await driver.closeOwnedWindow(driver.binding, signal).catch(() => undefined);
    }
  } finally {
    await closeServer(fixture.server);
    app.exit(process.exitCode ?? 0);
  }
}

void app
  .whenReady()
  .then(run)
  .catch((error: unknown) => {
    console.error(`BCU_ACTIONS_FAILED:${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
    app.exit(1);
  });
