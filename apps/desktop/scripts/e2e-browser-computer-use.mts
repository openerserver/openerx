import { mkdirSync, writeFileSync } from "node:fs";
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

if (process.platform !== "darwin") throw new Error("BCU_SMOKE_MACOS_REQUIRED");
console.log("BCU_SMOKE_BOOT");

const desktopDirectory = process.cwd();
const outputDirectory = path.resolve(
  process.env.OPENERX_BCU_SMOKE_OUTPUT ??
    path.join(desktopDirectory, ".vite", "browser-smoke", "evidence"),
);
const helperPath = path.join(desktopDirectory, ".vite", "native", "openerx-browser-accessibility");

function observation(result: NormalizedToolResult): Omit<BrowserObservation, "image"> {
  const value = result.data as { observation?: Omit<BrowserObservation, "image"> };
  if (!value.observation) throw new Error("BCU_SMOKE_OBSERVATION_MISSING");
  return value.observation;
}

function saveImage(fileName: string, result: NormalizedToolResult): void {
  const content = result.content?.find((item) => item.type === "image");
  if (content?.type !== "image") throw new Error("BCU_SMOKE_IMAGE_MISSING");
  writeFileSync(path.join(outputDirectory, fileName), Buffer.from(content.data, "base64"), {
    mode: 0o600,
  });
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
  console.log("BCU_SMOKE_READY");
  mkdirSync(outputDirectory, { recursive: true });
  const driver = new TrackingMacSystemBrowserDriver(helperPath);
  const adapter = new SystemDefaultBrowserAdapter(driver);
  const signal = new AbortController().signal;

  try {
    const openedResult = await adapter.execute(
      {
        contractVersion: BROWSER_COMPUTER_USE_CONTRACT_VERSION,
        action: "open",
        url: "https://www.baidu.com/",
      },
      signal,
    );
    const opened = observation(openedResult);
    saveImage("01-open.png", openedResult);
    const searchbox = opened.elements.find(
      (element) =>
        ["searchbox", "textbox"].includes(element.role) && element.actions.includes("setValue"),
    );
    if (!searchbox) throw new Error("BCU_SMOKE_SEARCHBOX_MISSING");

    const typedResult = await adapter.execute(
      {
        contractVersion: BROWSER_COMPUTER_USE_CONTRACT_VERSION,
        action: "setValue",
        sessionId: opened.sessionId,
        observationId: opened.observationId,
        target: { elementRef: searchbox.elementRef },
        text: "phonescloud",
      },
      signal,
    );
    const typed = observation(typedResult);
    saveImage("02-typed.png", typedResult);
    const submit = typed.elements.find(
      (element) =>
        element.role === "button" &&
        element.actions.includes("invoke") &&
        element.name.includes("百度一下"),
    );
    if (!submit) throw new Error("BCU_SMOKE_SUBMIT_MISSING");

    const searchedResult = await adapter.execute(
      {
        contractVersion: BROWSER_COMPUTER_USE_CONTRACT_VERSION,
        action: "invoke",
        sessionId: typed.sessionId,
        observationId: typed.observationId,
        target: { elementRef: submit.elementRef },
      },
      signal,
    );
    const searched = observation(searchedResult);
    if (!searched.url.includes("baidu.com/s?") || !searched.url.includes("phonescloud")) {
      throw new Error("BCU_SMOKE_SEARCH_RESULT_MISMATCH");
    }
    await new Promise((resolve) => setTimeout(resolve, 6_000));
    const settledResult = await adapter.execute(
      {
        contractVersion: BROWSER_COMPUTER_USE_CONTRACT_VERSION,
        action: "observe",
        sessionId: searched.sessionId,
      },
      signal,
    );
    const settled = observation(settledResult);
    saveImage("03-searched.png", settledResult);
    if (!settled.url.includes("baidu.com/s?") || !settled.url.includes("phonescloud")) {
      throw new Error("BCU_SMOKE_SETTLED_RESULT_MISMATCH");
    }

    const closedResult = await adapter.execute(
      {
        contractVersion: BROWSER_COMPUTER_USE_CONTRACT_VERSION,
        action: "close",
        sessionId: settled.sessionId,
        observationId: settled.observationId,
      },
      signal,
    );
    const session = (closedResult.data as { session?: { state?: string } }).session;
    const evidence = {
      contractVersion: BROWSER_COMPUTER_USE_CONTRACT_VERSION,
      backend: settled.backend,
      controlPath: settled.controlPath,
      nativeWindowId: settled.nativeWindowId,
      finalUrl: settled.url,
      query: "phonescloud",
      semanticElementCount: settled.elements.length,
      screenshotDigest: settled.screenshotDigest,
      closeState: session?.state ?? null,
    };
    writeFileSync(
      path.join(outputDirectory, "result.json"),
      `${JSON.stringify(evidence, null, 2)}\n`,
      {
        encoding: "utf8",
        mode: 0o600,
      },
    );
    console.log(`BCU_SMOKE_OK:${JSON.stringify(evidence)}`);
  } catch (error) {
    console.error(`BCU_SMOKE_FAILED:${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
    if (driver.binding) {
      await driver.closeOwnedWindow(driver.binding, signal).catch(() => undefined);
    }
  } finally {
    app.exit(process.exitCode ?? 0);
  }
}

void app
  .whenReady()
  .then(run)
  .catch((error: unknown) => {
    console.error(`BCU_SMOKE_FAILED:${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
    app.exit(1);
  });
