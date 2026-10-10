import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { z } from "zod";
import { assertTargetIdentity, type NativeTarget } from "../src/main/desktop-control/driver";
import { WindowsDesktopDriver } from "../src/main/desktop-control/windows-driver";

assert.equal(process.platform, "win32", "Native recovery acceptance requires Windows");
assert.equal(process.arch, "x64", "Native desktop helper currently requires x64");

const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const directory = path.join(
  process.env.OPENERX_WDC_EVIDENCE_DIR ?? path.resolve(desktop, "../../artifacts/tool-health"),
  `foreground-recovery-${randomUUID()}`,
);
await mkdir(directory, { recursive: true });
const helperDirectory = path.join(desktop, "native/windows-desktop-helper/bin/publish/x64");
const helperExecutable = path.join(helperDirectory, "openerx-desktop-helper.exe");
const fixtureAssembly = path.join(
  desktop,
  "tests/native/WdcFixture/bin/Release/net10.0-windows/WdcFixture.dll",
);
const dotnet = process.env.OPENERX_DOTNET ?? "dotnet";
const powershell = path.win32.join(
  process.env.SystemRoot ?? "C:\\Windows",
  "System32/WindowsPowerShell/v1.0/powershell.exe",
);
const driver = new WindowsDesktopDriver(
  helperExecutable,
  path.join(helperDirectory, "manifest.json"),
);
const fixtures: ReturnType<typeof spawn>[] = [];
const checks: string[] = [];
const evidence: Record<string, unknown> = {};
const signal = AbortSignal.timeout(75_000);
const identitySchema = z
  .object({
    windowId: z.string().regex(/^[1-9]\d{0,19}$/u),
    processId: z.number().int().positive(),
    processStartTime: z.string().regex(/^\d{1,20}$/u),
  })
  .strict();
type ForegroundIdentity = z.infer<typeof identitySchema>;
let stage = "preflight";

function identity(target: NativeTarget): ForegroundIdentity {
  return {
    windowId: target.windowId,
    processId: target.processId,
    processStartTime: target.processStartTime,
  };
}

async function foreground(): Promise<ForegroundIdentity | null> {
  const { stdout } = await promisify(execFile)(
    dotnet,
    [fixtureAssembly, "--foreground-state", "unused"],
    { windowsHide: true, timeout: 8000, signal, maxBuffer: 4096 },
  );
  return identitySchema.nullable().parse(JSON.parse(stdout.trim()));
}

async function helperChildren(): Promise<number[]> {
  // Read only this test process's helpers. Never enumerate or terminate other
  // owners' helpers, and never depend on the production driver's private state.
  const script = `$ErrorActionPreference='Stop'; $items=@(Get-CimInstance Win32_Process -Filter "ParentProcessId = ${process.pid} AND Name = 'openerx-desktop-helper.exe'" | Select-Object ProcessId,ExecutablePath); ConvertTo-Json -Compress -InputObject $items`;
  const { stdout } = await promisify(execFile)(
    powershell,
    [
      "-NoProfile",
      "-NonInteractive",
      "-EncodedCommand",
      Buffer.from(script, "utf16le").toString("base64"),
    ],
    { windowsHide: true, timeout: 8000, signal, maxBuffer: 16_384 },
  );
  const children = z
    .array(
      z.object({ ProcessId: z.number().int().positive(), ExecutablePath: z.string() }).strict(),
    )
    .parse(JSON.parse(stdout.trim()));
  for (const child of children)
    assert.equal(
      path.win32.normalize(child.ExecutablePath).toLowerCase(),
      path.win32.normalize(helperExecutable).toLowerCase(),
      "Unexpected helper executable under the test process",
    );
  return children.map((child) => child.ProcessId);
}

async function launchOwnedForeground(label: string): Promise<NativeTarget> {
  const title = `WDC recovery ${label} ${randomUUID()}`;
  const child = spawn(dotnet, [fixtureAssembly, title, path.join(directory, `${label}.txt`)], {
    windowsHide: true,
    stdio: "ignore",
  });
  fixtures.push(child);
  let launchError: Error | undefined;
  child.once("error", (error) => {
    launchError = error;
  });
  for (let attempt = 0; attempt < 35; attempt++) {
    if (launchError) throw launchError;
    assert.equal(child.exitCode, null, "Owned fixture exited before acceptance");
    const candidate = (await driver.list(signal)).find(
      (target) => target.title === title && target.processId === child.pid,
    );
    if (candidate && (await foreground())?.windowId === candidate.windowId) return candidate;
    await delay(150, undefined, { signal });
  }
  throw new Error("WDC_FIXTURE_FOREGROUND_PRECONDITION_UNAVAILABLE");
}

async function report(status: "passed" | "failed", error?: unknown) {
  await writeFile(
    path.join(directory, "result.json"),
    JSON.stringify(
      {
        status,
        stage,
        scope: "native read-only recovery safety; fixture arranges only owned-window preconditions",
        provesUserClickRecovery: false,
        helperManifest: JSON.parse(
          await readFile(path.join(helperDirectory, "manifest.json"), "utf8"),
        ),
        checks,
        evidence,
        ...(error ? { error: error instanceof Error ? error.message : String(error) } : {}),
      },
      null,
      2,
    ),
  );
}

try {
  await driver.probe(signal);
  stage = "owned_foreground_precondition";
  const target = await launchOwnedForeground("target");
  evidence.target = identity(target);

  stage = "foreground_receipt_and_observation";
  const receipt = await driver.waitForForeground(target, signal);
  assert(Number.isInteger(receipt.lastInputTime) && receipt.lastInputTime >= 0);
  await driver.focus(target, signal, { activate: false, ...receipt });
  assert.deepEqual(await foreground(), identity(target));
  const observed = await driver.observe(target, signal);
  assertTargetIdentity(target, observed.target);
  assert(observed.pngBase64, "Foreground recovery observation has no screenshot");
  assert(observed.imageWidth > 0 && observed.imageHeight > 0);
  assert(observed.elements.some((element) => element.name === "WDC editor"));
  assert(!JSON.stringify(observed).includes("WDC_SECRET_CANARY"), "Password canary leaked");
  await writeFile(
    path.join(directory, "foreground.png"),
    Buffer.from(observed.pngBase64, "base64"),
  );
  evidence.receipt = receipt;
  checks.push("frontmost target returns receipt; verify-only focus and identity/UIA/PNG succeed");

  stage = "wrong_receipt";
  const currentReceipt = await driver.waitForForeground(target, signal);
  await assert.rejects(
    driver.focus(target, signal, {
      activate: false,
      lastInputTime: (currentReceipt.lastInputTime + 1) >>> 0,
    }),
    /DESKTOP_USER_INPUT_ACTIVE/u,
  );
  assert.deepEqual(await foreground(), identity(target));
  checks.push("wrong input receipt rejects without changing foreground");

  stage = "owned_background_precondition";
  const other = await launchOwnedForeground("other");
  const originalForeground = identity(other);
  assert.notEqual(target.windowId, other.windowId);
  evidence.backgroundForeground = originalForeground;

  stage = "background_verify_only";
  const foregroundReceipt = await driver.waitForForeground(other, signal);
  await assert.rejects(
    driver.focus(target, signal, { activate: false, ...foregroundReceipt }),
    /DESKTOP_TARGET_NOT_FRONTMOST/u,
  );
  assert.deepEqual(await foreground(), originalForeground);
  checks.push("background verify-only focus refuses and never activates the target");

  stage = "background_wait_timeout";
  const timeoutStarted = Date.now();
  await assert.rejects(
    driver.waitForForeground(target, signal),
    /DESKTOP_FOREGROUND_SELECTION_TIMEOUT/u,
  );
  const timeoutElapsedMs = Date.now() - timeoutStarted;
  assert(timeoutElapsedMs >= 9500 && timeoutElapsedMs < 14_000, "Unexpected selection timeout");
  assert.deepEqual(await foreground(), originalForeground);
  evidence.timeoutElapsedMs = timeoutElapsedMs;
  checks.push("background selection waits ten seconds, times out, and preserves foreground");

  stage = "cancel_wait";
  assert.deepEqual(await helperChildren(), [], "Previous native requests left a helper running");
  const cancellation = new AbortController();
  let settled = false;
  const waiting = driver
    .waitForForeground(target, AbortSignal.any([signal, cancellation.signal]))
    .then(
      () => ({ completed: true as const }),
      (error: unknown) => ({ completed: false as const, error }),
    )
    .finally(() => {
      settled = true;
    });
  const started = Date.now();
  let waitingChildren: number[] = [];
  while (!waitingChildren.length && Date.now() - started < 4000) {
    waitingChildren = await helperChildren();
    if (!waitingChildren.length) await delay(75, undefined, { signal });
  }
  assert.equal(settled, false, "Background wait settled before cancellation");
  assert.equal(waitingChildren.length, 1, "Did not observe the actual waiting helper");
  evidence.cancelledHelperPids = waitingChildren;
  const cancelledAt = Date.now();
  cancellation.abort();
  const outcome = await waiting;
  assert(!outcome.completed, "Cancelled wait unexpectedly completed");
  assert(outcome.error instanceof Error && outcome.error.message === "TOOL_CANCELLED");
  assert(Date.now() - cancelledAt < 2000, "Cancellation did not promptly settle the request");
  let remaining = await helperChildren();
  while (remaining.length && Date.now() - cancelledAt < 4000) {
    await delay(75, undefined, { signal });
    remaining = await helperChildren();
  }
  assert.deepEqual(remaining, [], "Cancelled waiting helper is still alive");
  await delay(800, undefined, { signal });
  assert.deepEqual(await helperChildren(), [], "A cancelled helper reappeared");
  assert.deepEqual(await foreground(), originalForeground);
  checks.push(
    "cancelled actual wait rejects promptly, helper exits, no late activation or resurrection",
  );

  stage = "fresh_request_after_cancel";
  const laterReceipt = await driver.waitForForeground(other, signal);
  await driver.focus(other, signal, { activate: false, ...laterReceipt });
  assert.deepEqual(await foreground(), originalForeground);
  checks.push("a fresh authorized request remains usable after cancellation");
  stage = "complete";
  await report("passed");
  console.log(`WDC recovery native PASS (${checks.length} checks): ${directory}`);
} catch (error) {
  await report("failed", error);
  throw error;
} finally {
  driver.close();
  for (const fixture of fixtures) fixture.kill();
}
