import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { DESKTOP_CONTROL_VERSION } from "@openerx/contracts";
import type {
  DesktopObservedAction,
  NativeObservation,
  NativeTarget,
} from "../src/main/desktop-control/driver";
import { WindowsDesktopDriver } from "../src/main/desktop-control/windows-driver";

const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const directory = path.join(
  process.env.OPENERX_WDC_EVIDENCE_DIR ?? path.resolve(desktop, "../../.codex-temp/wdc-evidence"),
  `system-${randomUUID()}`,
);
await mkdir(directory, { recursive: true });
const helper = path.join(desktop, "native/windows-desktop-helper/bin/publish/x64");
const driver = new WindowsDesktopDriver(
  path.join(helper, "openerx-desktop-helper.exe"),
  path.join(helper, "manifest.json"),
);
const manualForeground = process.env.OPENERX_WDC_MANUAL_FOREGROUND === "1";
const testApp = process.env.OPENERX_WDC_TEST_APP ?? "both";
const runNotepad = testApp !== "calculator";
const runCalculator = testApp !== "notepad";
const checks: string[] = [];
const signal = AbortSignal.timeout(manualForeground ? 300_000 : 90_000);
let before: NativeTarget[] = [];
let stage = "native_preflight";
const owned: NativeTarget[] = [];
const launchers: ReturnType<typeof spawn>[] = [];
function isCalculator(target: NativeTarget) {
  if (/^(calculator|calculatorapp)$/iu.test(target.application)) return true;
  const frameHost = path.win32.join(
    process.env.SystemRoot ?? "C:\\Windows",
    "System32",
    "ApplicationFrameHost.exe",
  );
  return (
    /^ApplicationFrameHost$/iu.test(target.application) &&
    /^(计算器|Calculator)$/u.test(target.title) &&
    path.win32.normalize(target.executablePath).toLowerCase() === frameHost.toLowerCase()
  );
}
function launchFixture(mode: string, file: string) {
  const child = spawn(
    process.env.OPENERX_DOTNET ?? "dotnet",
    [
      path.join(desktop, "tests/native/WdcFixture/bin/Release/net10.0-windows/WdcFixture.dll"),
      mode,
      file,
    ],
    { windowsHide: true, stdio: "ignore" },
  );
  launchers.push(child);
}
let takenOver = false;
let monitor: { close(): void } | undefined;
const inputController = new AbortController();
const activeSignal = AbortSignal.any([signal, inputController.signal]);
const stopOnUserInput = () => {
  takenOver = true;
  inputController.abort();
};
async function focusTestWindow(target: NativeTarget) {
  if (manualForeground) {
    console.log(`WDC awaiting manual foreground: ${target.application} — ${target.title}`);
    await promisify(execFile)(
      process.env.OPENERX_DOTNET ?? "dotnet",
      [
        path.join(desktop, "tests/native/WdcFixture/bin/Release/net10.0-windows/WdcFixture.dll"),
        "--wait-owned-foreground",
        JSON.stringify(target),
      ],
      { windowsHide: true, timeout: 125_000, signal },
    );
  }
  await driver.focus(target, signal);
}
async function waitWindow(predicate: (t: NativeTarget) => boolean) {
  for (let i = 0; i < 30; i++) {
    const candidate = (await driver.list(signal)).find(
      (t) => !before.some((old) => old.windowId === t.windowId) && predicate(t),
    );
    if (candidate) {
      await delay(1000);
      const stable = (await driver.list(signal)).find(
        (t) =>
          t.windowId === candidate.windowId &&
          t.processId === candidate.processId &&
          t.processStartTime === candidate.processStartTime &&
          predicate(t),
      );
      if (!stable) continue;
      owned.push(stable);
      await writeFile(path.join(directory, "owned.json"), JSON.stringify(owned));
      return stable;
    }
    await delay(200);
  }
  throw new Error("new app window not found");
}
function identity(target: NativeTarget) {
  return {
    contractVersion: DESKTOP_CONTROL_VERSION,
    applicationId: target.applicationId,
    sessionId: randomUUID(),
    observationId: randomUUID(),
  };
}
async function action(
  observation: NativeObservation,
  op: DesktopObservedAction,
  runtimeId?: string,
) {
  const element = runtimeId
    ? observation.elements.find((e) => e.runtimeId === runtimeId)
    : undefined;
  await driver.act(observation.target, observation, op, element, activeSignal);
  await delay(120);
  return await driver.observe(observation.target, activeSignal);
}
try {
  assert(
    ["both", "notepad", "calculator"].includes(testApp),
    "OPENERX_WDC_TEST_APP must be notepad or calculator, or unset for both",
  );
  before = await driver.list(signal);
  // Never reuse or close a personal Notepad/Calculator window during this smoke.
  assert(
    !before.some(
      (t) =>
        (runNotepad && /^notepad$/iu.test(t.application)) || (runCalculator && isCalculator(t)),
    ),
    "Close personal sessions of the selected test app(s) before running this isolated smoke",
  );
  if (runNotepad) {
    stage = "notepad_launch";
    const file = path.join(directory, "WDC-Notepad.txt");
    await writeFile(file, "WDC isolated file", "utf8");
    // A visible, dedicated GUI launcher gives Windows its normal foreground handoff.
    // A hidden Node console must not work around SetForegroundWindow restrictions.
    launchFixture("--launch-notepad", file);
    const target = await waitWindow(
      (t) => /^notepad$/iu.test(t.application) && t.title.includes("WDC-Notepad"),
    );
    console.log("WDC system: Notepad discovered; focusing");
    stage = "notepad_foreground";
    await focusTestWindow(target);
    monitor = await driver.monitor(stopOnUserInput, stopOnUserInput, activeSignal);
    let observation = await driver.observe(target, activeSignal);
    stage = "notepad_edit_and_save";
    observation = await action(observation, {
      ...identity(target),
      action: "key",
      key: "Ctrl+A",
      effect: "local",
    });
    const editor = observation.elements.find(
      (e) => e.actions.includes("type_text") && ["Document", "Edit"].includes(e.role),
    );
    assert(editor, "Notepad text control not exposed by UIA");
    const text = "Windows 桌面控制验证 😀";
    observation = await action(
      observation,
      { ...identity(target), action: "type_text", elementRef: randomUUID(), text, effect: "local" },
      editor.runtimeId,
    );
    observation = await action(observation, {
      ...identity(target),
      action: "key",
      key: "Ctrl+S",
      effect: "local",
    });
    console.log("WDC system: Notepad typed and saved");
    assert.equal((await readFile(file, "utf8")).replace(/^\uFEFF/u, ""), text);
    assert(observation.pngBase64);
    await writeFile(
      path.join(directory, "notepad.png"),
      Buffer.from(observation.pngBase64, "base64"),
    );
    monitor.close();
    monitor = undefined;
    checks.push(
      "real Notepad Unicode input and disk verification",
      "native injected input does not trigger takeover",
    );
  }

  if (runCalculator) {
    stage = "calculator_launch";
    launchFixture("--launch-calculator", "unused");
    const calculator = await waitWindow(isCalculator);
    console.log("WDC system: Calculator discovered; focusing");
    stage = "calculator_foreground";
    await focusTestWindow(calculator);
    monitor = await driver.monitor(stopOnUserInput, stopOnUserInput, activeSignal);
    let observation = await driver.observe(calculator, activeSignal);
    stage = "calculator_calculate";
    const digit = (names: string[]) =>
      observation.elements.find(
        (e) => e.role === "Button" && names.includes(e.name) && e.actions.includes("invoke"),
      );
    for (const names of [
      ["一", "One", "1"],
      ["加", "Plus", "加号"],
      ["二", "Two", "2"],
      ["等于", "Equals"],
    ]) {
      const button = digit(names);
      if (!button) {
        await writeFile(
          path.join(directory, "calculator-controls.json"),
          JSON.stringify(
            observation.elements
              .filter((e) => e.role === "Button")
              .map((e) => ({ name: e.name, actions: e.actions })),
            null,
            2,
          ),
        );
        throw new Error(`Calculator button missing: ${names[0]}`);
      }
      observation = await action(
        observation,
        { ...identity(calculator), action: "invoke", elementRef: randomUUID(), effect: "local" },
        button.runtimeId,
      );
    }
    assert(
      observation.elements.some(
        (e) => /(?:显示为|Display is|显示|Display).*\b3\b/iu.test(e.name) || e.value === "3",
      ),
      "Calculator result is not 3",
    );
    assert(observation.pngBase64);
    await writeFile(
      path.join(directory, "calculator.png"),
      Buffer.from(observation.pngBase64, "base64"),
    );
    checks.push("real Calculator 1+2=3 through UIA");
  }
  await writeFile(
    path.join(directory, "result.json"),
    JSON.stringify(
      {
        status: "passed",
        testApp,
        foregroundMode: manualForeground ? "manual-assist" : "automatic",
        checks,
      },
      null,
      2,
    ),
  );
  console.log(`WDC system apps PASS: ${directory}`);
} catch (error) {
  await writeFile(
    path.join(directory, "result.json"),
    JSON.stringify(
      {
        status: "failed",
        testApp,
        foregroundMode: manualForeground ? "manual-assist" : "automatic",
        checks,
        stage,
        reason: error instanceof Error ? error.message : "unknown failure",
      },
      null,
      2,
    ),
  );
  console.error(`WDC system apps FAIL at ${stage}: ${directory}`);
  throw error;
} finally {
  monitor?.close();
  driver.close();
  for (const launcher of launchers) launcher.kill();
  if (!takenOver)
    for (const target of owned) {
      // Close only the exact process instance opened by this smoke; never force kill.
      await promisify(execFile)(
        process.env.OPENERX_DOTNET ?? "dotnet",
        [
          path.join(desktop, "tests/native/WdcFixture/bin/Release/net10.0-windows/WdcFixture.dll"),
          "--close-owned-window",
          JSON.stringify(target),
        ],
        { windowsHide: true },
      ).catch(() => undefined);
    }
}
