import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  BROWSER_COMPUTER_USE_CONTRACT_VERSION,
  type BrowserObservation,
  type NormalizedToolResult,
} from "@openerx/contracts";
import { app } from "electron";
import { ElectronWindowsSystemBrowserDriver } from "../src/main/browser-computer-use/electron-windows-system-browser-driver";
import {
  type SystemBrowserBinding,
  SystemDefaultBrowserAdapter,
} from "../src/main/browser-computer-use/system-default-browser-adapter";

if (process.platform !== "win32") throw new Error("BCU_SMOKE_WINDOWS_REQUIRED");
console.log("BCU_WINDOWS_BOOT");

const desktopDirectory = process.cwd();
const outputDirectory = path.resolve(
  process.env.OPENERX_BCU_WINDOWS_OUTPUT ??
    path.join(desktopDirectory, ".vite", "browser-windows", "evidence"),
);
const helperPath = path.join(desktopDirectory, "native", "windows-browser-accessibility.ps1");

function observation(result: NormalizedToolResult): Omit<BrowserObservation, "image"> {
  const value = result.data as { observation?: Omit<BrowserObservation, "image"> };
  if (!value.observation) throw new Error("BCU_WINDOWS_OBSERVATION_MISSING");
  return value.observation;
}

function saveImage(fileName: string, result: NormalizedToolResult): void {
  const content = result.content?.find((item) => item.type === "image");
  if (content?.type !== "image") throw new Error("BCU_WINDOWS_IMAGE_MISSING");
  writeFileSync(path.join(outputDirectory, fileName), Buffer.from(content.data, "base64"), {
    mode: 0o600,
  });
}

class TrackingWindowsSystemBrowserDriver extends ElectronWindowsSystemBrowserDriver {
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
  console.log("BCU_WINDOWS_READY");
  mkdirSync(outputDirectory, { recursive: true });
  const driver = new TrackingWindowsSystemBrowserDriver(helperPath);
  const adapter = new SystemDefaultBrowserAdapter(driver);
  const signal = new AbortController().signal;
  try {
    if (!(await driver.probeAvailability())) throw new Error("BCU_WINDOWS_READINESS_FAILED");
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
    if (!searchbox) throw new Error("BCU_WINDOWS_SEARCHBOX_MISSING");

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

    const erasedResult = await adapter.execute(
      {
        contractVersion: BROWSER_COMPUTER_USE_CONTRACT_VERSION,
        action: "key",
        sessionId: typed.sessionId,
        observationId: typed.observationId,
        key: "Backspace",
      },
      signal,
    );
    const erased = observation(erasedResult);
    const erasedSearchbox = erased.elements.find(
      (element) => element.role === "textbox" && element.actions.includes("setValue"),
    );
    if (erasedSearchbox?.value !== "phonesclou") {
      throw new Error("BCU_WINDOWS_NATIVE_KEY_FAILED");
    }

    const restoredResult = await adapter.execute(
      {
        contractVersion: BROWSER_COMPUTER_USE_CONTRACT_VERSION,
        action: "setValue",
        sessionId: erased.sessionId,
        observationId: erased.observationId,
        target: { elementRef: erasedSearchbox.elementRef },
        text: "phonescloud",
      },
      signal,
    );
    const restored = observation(restoredResult);
    const submit = restored.elements.find(
      (element) =>
        element.role === "button" &&
        element.actions.includes("invoke") &&
        element.name.includes("百度一下"),
    );
    if (!submit) throw new Error("BCU_WINDOWS_SUBMIT_MISSING");

    const searchedResult = await adapter.execute(
      {
        contractVersion: BROWSER_COMPUTER_USE_CONTRACT_VERSION,
        action: "invoke",
        sessionId: restored.sessionId,
        observationId: restored.observationId,
        target: { elementRef: submit.elementRef },
      },
      signal,
    );
    const searched = observation(searchedResult);
    if (!searched.url.includes("baidu.com/s?") || !searched.url.includes("phonescloud")) {
      throw new Error("BCU_WINDOWS_SEARCH_RESULT_MISMATCH");
    }
    saveImage("03-searched.png", searchedResult);

    const scrolledResult = await adapter.execute(
      {
        contractVersion: BROWSER_COMPUTER_USE_CONTRACT_VERSION,
        action: "scroll",
        sessionId: searched.sessionId,
        observationId: searched.observationId,
        direction: "down",
        distance: "small",
      },
      signal,
    );
    const scrolled = observation(scrolledResult);
    if (!scrolled.url.includes("baidu.com/s?")) throw new Error("BCU_WINDOWS_SCROLL_FAILED");

    const reloadedResult = await adapter.execute(
      {
        contractVersion: BROWSER_COMPUTER_USE_CONTRACT_VERSION,
        action: "reload",
        sessionId: scrolled.sessionId,
        observationId: scrolled.observationId,
      },
      signal,
    );
    const reloaded = observation(reloadedResult);
    if (!reloaded.url.includes("baidu.com/s?")) throw new Error("BCU_WINDOWS_RELOAD_FAILED");

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
      platform: process.platform,
      backend: reloaded.backend,
      controlPath: reloaded.controlPath,
      applicationId: reloaded.applicationId,
      nativeProcessId: reloaded.nativeProcessId,
      nativeWindowId: reloaded.nativeWindowId,
      finalUrl: reloaded.url,
      query: "phonescloud",
      semanticElementCount: reloaded.elements.length,
      screenshotDigest: reloaded.screenshotDigest,
      nativeActions: ["Backspace", "scroll", "reload"],
      closeState: session?.state ?? null,
    };
    writeFileSync(
      path.join(outputDirectory, "result.json"),
      `${JSON.stringify(evidence, null, 2)}\n`,
      { encoding: "utf8", mode: 0o600 },
    );
    console.log(`BCU_WINDOWS_OK:${JSON.stringify(evidence)}`);
  } catch (error) {
    console.error(`BCU_WINDOWS_FAILED:${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
    if (driver.binding) {
      await driver.closeOwnedWindow(driver.binding, signal).catch(() => undefined);
    }
  } finally {
    adapter.close();
    app.exit(process.exitCode ?? 0);
  }
}

void app
  .whenReady()
  .then(run)
  .catch((error: unknown) => {
    console.error(`BCU_WINDOWS_FAILED:${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
    app.exit(1);
  });
