import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { DESKTOP_CONTROL_VERSION } from "@openerx/contracts";
import { z } from "zod";
import type {
  DesktopObservedAction,
  NativeObservation,
  NativeTarget,
} from "../src/main/desktop-control/driver";
import { WindowsDesktopDriver } from "../src/main/desktop-control/windows-driver";

const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const directory = path.join(
  process.env.OPENERX_WDC_EVIDENCE_DIR ?? path.resolve(desktop, "../../.codex-temp/wdc-evidence"),
  `foreground-${randomUUID()}`,
);
await mkdir(directory, { recursive: true });
const helper = path.join(desktop, "native/windows-desktop-helper/bin/publish/x64");
const fixture = path.join(
  desktop,
  "tests/native/WdcFixture/bin/Release/net10.0-windows/WdcFixture.dll",
);
const dotnet = process.env.OPENERX_DOTNET ?? "dotnet";
const driver = new WindowsDesktopDriver(
  path.join(helper, "openerx-desktop-helper.exe"),
  path.join(helper, "manifest.json"),
);
const foregroundSchema = z
  .object({
    windowId: z.string().regex(/^[1-9]\d{0,19}$/u),
    processId: z.number().int().positive(),
    processStartTime: z.string().regex(/^\d{1,20}$/u),
  })
  .strict();
type ForegroundState = z.infer<typeof foregroundSchema>;
const ownedWindowSchema = foregroundSchema.extend({
  minimized: z.boolean(),
  visible: z.boolean(),
});
type OwnedWindowState = z.infer<typeof ownedWindowSchema>;
interface SwitchEvidence {
  index: number;
  application: string;
  mode: "background" | "minimized";
  target: ForegroundState;
  status: "started" | "focused" | "verified";
  before: ForegroundState | null;
  after?: ForegroundState | null;
  afterActions?: ForegroundState | null;
  windowBefore?: OwnedWindowState;
  windowAfter?: OwnedWindowState;
  focusElapsedMs?: number;
  screenshot?: string;
}
const checks: string[] = [];
const switches: SwitchEvidence[] = [];
const owned: NativeTarget[] = [];
const launchers: ReturnType<typeof spawn>[] = [];
const signal = AbortSignal.timeout(180_000);
const inputController = new AbortController();
const activeSignal = AbortSignal.any([signal, inputController.signal]);
let stage = "native_preflight";
let takenOver = false;
let monitorLost = false;
let monitor: { close(): void } | undefined;
let before: NativeTarget[] = [];
let helperManifest: unknown;
let launcherError: Error | undefined;

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
function foregroundIdentity(target: NativeTarget): ForegroundState {
  return {
    windowId: target.windowId,
    processId: target.processId,
    processStartTime: target.processStartTime,
  };
}
async function foreground() {
  const { stdout } = await promisify(execFile)(dotnet, [fixture, "--foreground-state", "unused"], {
    windowsHide: true,
    timeout: 10_000,
    signal: activeSignal,
    maxBuffer: 4096,
  });
  activeSignal.throwIfAborted();
  return foregroundSchema.nullable().parse(JSON.parse(stdout.trim()));
}
async function ownedWindow(target: NativeTarget) {
  const { stdout } = await promisify(execFile)(
    dotnet,
    [fixture, "--owned-window-state", JSON.stringify(target)],
    { windowsHide: true, timeout: 10_000, signal: activeSignal, maxBuffer: 4096 },
  );
  activeSignal.throwIfAborted();
  const state = ownedWindowSchema.parse(JSON.parse(stdout.trim()));
  assert.deepEqual(
    {
      windowId: state.windowId,
      processId: state.processId,
      processStartTime: state.processStartTime,
    },
    foregroundIdentity(target),
    "Owned window identity changed",
  );
  return state;
}
async function minimizeOwned(target: NativeTarget) {
  await promisify(execFile)(dotnet, [fixture, "--minimize-owned-window", JSON.stringify(target)], {
    windowsHide: true,
    timeout: 10_000,
    signal: activeSignal,
  });
  for (let attempt = 0; attempt < 10; attempt++) {
    const state = await ownedWindow(target);
    if (state.minimized) return state;
    await delay(100, undefined, { signal: activeSignal });
  }
  throw new Error("Isolated target did not become minimized");
}
function launch(mode: string, file: string) {
  const child = spawn(dotnet, [fixture, mode, file], {
    windowsHide: true,
    stdio: "ignore",
  });
  child.once("error", (error) => {
    launcherError = error;
  });
  launchers.push(child);
}
async function waitWindow(predicate: (target: NativeTarget) => boolean) {
  for (let attempt = 0; attempt < 30; attempt++) {
    if (launcherError) throw launcherError;
    const candidate = (await driver.list(signal)).find(
      (target) => !before.some((old) => old.windowId === target.windowId) && predicate(target),
    );
    if (candidate) {
      await delay(1000, undefined, { signal });
      const stable = (await driver.list(signal)).find(
        (target) =>
          target.windowId === candidate.windowId &&
          target.processId === candidate.processId &&
          target.processStartTime === candidate.processStartTime &&
          predicate(target),
      );
      if (!stable) continue;
      owned.push(stable);
      await writeFile(path.join(directory, "owned.json"), JSON.stringify(owned, null, 2));
      return stable;
    }
    await delay(200, undefined, { signal });
  }
  throw new Error("new isolated app window not found");
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
  operation: DesktopObservedAction,
  runtimeId?: string,
) {
  const element = runtimeId
    ? observation.elements.find((candidate) => candidate.runtimeId === runtimeId)
    : undefined;
  await driver.act(observation.target, observation, operation, element, activeSignal);
  await delay(120, undefined, { signal: activeSignal });
  return driver.observe(observation.target, activeSignal);
}
const expectedText = "Windows 自动前台切换验证 😀";
const noteFile = path.join(directory, "WDC-Foreground-Notepad.txt");
async function checkNotepad(observation: NativeObservation, firstVisit: boolean) {
  if (firstVisit) {
    observation = await action(observation, {
      ...identity(observation.target),
      action: "key",
      key: "Ctrl+A",
      effect: "local",
    });
    const editor = observation.elements.find(
      (element) =>
        element.actions.includes("type_text") && ["Document", "Edit"].includes(element.role),
    );
    assert(editor, "Notepad text control not exposed by UIA");
    observation = await action(
      observation,
      {
        ...identity(observation.target),
        action: "type_text",
        elementRef: randomUUID(),
        text: expectedText,
        effect: "local",
      },
      editor.runtimeId,
    );
    observation = await action(observation, {
      ...identity(observation.target),
      action: "key",
      key: "Ctrl+S",
      effect: "local",
    });
  }
  assert.equal((await readFile(noteFile, "utf8")).replace(/^\uFEFF/u, ""), expectedText);
  return observation;
}
async function checkCalculator(observation: NativeObservation, firstVisit: boolean) {
  if (firstVisit) {
    // Reset only the isolated calculator after foreground identity is verified.
    observation = await action(observation, {
      ...identity(observation.target),
      action: "key",
      key: "Escape",
      effect: "local",
    });
    for (const names of [
      ["一", "One", "1"],
      ["加", "Plus", "加号"],
      ["二", "Two", "2"],
      ["等于", "Equals"],
    ]) {
      const button = observation.elements.find(
        (element) =>
          element.role === "Button" &&
          names.includes(element.name) &&
          element.actions.includes("invoke"),
      );
      if (!button) {
        await writeFile(
          path.join(directory, "calculator-controls.json"),
          JSON.stringify(
            observation.elements
              .filter((element) => element.role === "Button")
              .map((element) => ({ name: element.name, actions: element.actions })),
            null,
            2,
          ),
        );
        throw new Error(`Calculator button missing: ${names[0]}`);
      }
      observation = await action(
        observation,
        {
          ...identity(observation.target),
          action: "invoke",
          elementRef: randomUUID(),
          effect: "local",
        },
        button.runtimeId,
      );
    }
  }
  assert(
    observation.elements.some(
      (element) =>
        /(?:显示为|Display is|显示|Display).*\b3\b/iu.test(element.name) || element.value === "3",
    ),
    "Calculator result is not 3",
  );
  return observation;
}
async function report(status: "passed" | "failed", reason?: string) {
  await writeFile(
    path.join(directory, "result.json"),
    JSON.stringify(
      {
        status,
        foregroundMode: "automatic-background-switch",
        stage,
        reason,
        helperManifest,
        checks,
        switches,
        userTakeover: takenOver,
        monitorLost,
      },
      null,
      2,
    ),
  );
}

try {
  assert.notEqual(
    process.env.OPENERX_WDC_MANUAL_FOREGROUND,
    "1",
    "Manual foreground assistance is incompatible with this automatic-switch acceptance",
  );
  await driver.probe(signal);
  helperManifest = JSON.parse(await readFile(path.join(helper, "manifest.json"), "utf8"));
  before = await driver.list(signal);
  assert(
    !before.some((target) => /^notepad$/iu.test(target.application) || isCalculator(target)),
    "Close personal Notepad and Calculator windows before this isolated acceptance",
  );
  stage = "notepad_launch";
  await writeFile(noteFile, "WDC isolated foreground acceptance file", "utf8");
  launch("--launch-notepad", noteFile);
  const notepad = await waitWindow(
    (target) =>
      /^notepad$/iu.test(target.application) && target.title.includes("WDC-Foreground-Notepad"),
  );
  stage = "calculator_launch";
  launch("--launch-calculator", "unused");
  const calculator = await waitWindow(isCalculator);
  checks.push("two new isolated app windows discovered and retained");

  // Keep one monitor alive across every switch and every action. No per-window
  // manual focus, synthetic activation gesture, or fixture permission grant.
  stage = "input_monitor";
  monitor = await driver.monitor(
    () => {
      takenOver = true;
      inputController.abort(new Error("DESKTOP_USER_INPUT"));
    },
    () => {
      monitorLost = true;
      inputController.abort(new Error("DESKTOP_MONITOR_LOST"));
    },
    activeSignal,
  );
  const initial = await foreground();
  const first = initial?.windowId === notepad.windowId ? calculator : notepad;
  const second = first === notepad ? calculator : notepad;
  const visited = new Set<string>();
  const sequence = [first, second, first, second, first];
  for (const target of sequence) {
    const index = switches.length + 1;
    const minimize = index === sequence.length;
    const application = target === notepad ? "notepad" : "calculator";
    stage = `switch_${index}_${application}_background`;
    const stateBefore = await foreground();
    const step: SwitchEvidence = {
      index,
      application,
      mode: minimize ? "minimized" : "background",
      target: foregroundIdentity(target),
      status: "started",
      before: stateBefore,
    };
    switches.push(step);
    assert.notEqual(stateBefore?.windowId, target.windowId, "Target must start in the background");
    if (index > 1)
      assert.deepEqual(stateBefore, switches[index - 2]?.target, "Unexpected foreground change");
    if (minimize) {
      stage = `switch_${index}_${application}_minimize`;
      step.windowBefore = await minimizeOwned(target);
      assert(step.windowBefore.minimized, "Minimized precondition was not independently verified");
      const listed = (await driver.list(activeSignal)).find(
        (candidate) => candidate.windowId === target.windowId,
      );
      assert(listed, "Minimized target missing from application list");
      assert.deepEqual(foregroundIdentity(listed), step.target);
      assert.deepEqual(
        await foreground(),
        stateBefore,
        "Minimization changed the other foreground app",
      );
      checks.push("owned background window minimized and still discoverable");
    }
    stage = `switch_${index}_${application}_focus`;
    const started = Date.now();
    try {
      await driver.focus(target, activeSignal);
    } catch (error) {
      if (!activeSignal.aborted) step.after = await foreground().catch(() => undefined);
      throw error;
    } finally {
      step.focusElapsedMs = Date.now() - started;
    }
    step.after = await foreground();
    assert.deepEqual(step.after, step.target, "Foreground did not match the exact target process");
    if (minimize) {
      step.windowAfter = await ownedWindow(target);
      assert(!step.windowAfter.minimized && step.windowAfter.visible, "Target was not restored");
      checks.push("minimized target restored and activated by the production focus operation");
    }
    step.status = "focused";
    checks.push(`switch ${index}: ${application} changed from background to verified foreground`);

    stage = `switch_${index}_${application}_actions`;
    let observation = await driver.observe(target, activeSignal);
    observation =
      target === notepad
        ? await checkNotepad(observation, !visited.has(target.windowId))
        : await checkCalculator(observation, !visited.has(target.windowId));
    const screenshot = `${index}-${application}.png`;
    assert(observation.pngBase64, "Window screenshot missing");
    await writeFile(path.join(directory, screenshot), Buffer.from(observation.pngBase64, "base64"));
    step.screenshot = screenshot;
    step.afterActions = await foreground();
    assert.deepEqual(step.afterActions, step.target, "Foreground changed during app verification");
    activeSignal.throwIfAborted();
    step.status = "verified";
    checks.push(
      application === "notepad"
        ? `switch ${index}: Notepad Chinese/emoji content verified on disk and captured`
        : `switch ${index}: Calculator 1+2=3 verified through UIA and captured`,
    );
    visited.add(target.windowId);
    await writeFile(path.join(directory, "switches.json"), JSON.stringify(switches, null, 2));
  }
  assert.equal(switches.filter((step) => step.status === "verified").length, sequence.length);
  assert.equal(visited.size, 2);
  activeSignal.throwIfAborted();
  checks.push("single uninterrupted input monitor covered all switches and actions");
  stage = "complete";
  await report("passed");
  console.log(`WDC automatic foreground PASS: ${directory}`);
} catch (error) {
  const reason = activeSignal.aborted
    ? takenOver
      ? "DESKTOP_USER_INPUT"
      : monitorLost
        ? "DESKTOP_MONITOR_LOST"
        : "DESKTOP_ACCEPTANCE_TIMEOUT"
    : error instanceof Error
      ? error.message
      : "unknown failure";
  await report("failed", reason);
  console.error(`WDC automatic foreground FAIL at ${stage}: ${directory}`);
  throw error;
} finally {
  monitor?.close();
  driver.close();
  for (const launcher of launchers) launcher.kill();
  if (!takenOver && !monitorLost)
    for (const target of owned) {
      // Close only the exact process instance opened here, without force-killing
      // applications or touching windows after the user has taken control.
      await promisify(execFile)(dotnet, [fixture, "--close-owned-window", JSON.stringify(target)], {
        windowsHide: true,
        timeout: 10_000,
      }).catch(() => undefined);
    }
}
