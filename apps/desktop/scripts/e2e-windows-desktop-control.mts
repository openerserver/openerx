import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import {
  DESKTOP_CONTROL_VERSION,
  type DesktopControlOperation,
  type NormalizedToolResult,
} from "@openerx/contracts";
import { DesktopControlLease } from "../src/main/desktop-control/control-lease";
import { DesktopControlHost } from "../src/main/desktop-control/host";
import { WindowsDesktopDriver } from "../src/main/desktop-control/windows-driver";

const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const helperDirectory = path.join(desktop, "native/windows-desktop-helper/bin/publish/x64");
const directory = path.join(
  process.env.OPENERX_WDC_EVIDENCE_DIR ?? path.resolve(desktop, "../../.codex-temp/wdc-evidence"),
  randomUUID(),
);
await mkdir(directory, { recursive: true });
const targetTitle = `WDC fixture ${randomUUID()}`;
const outputFile = path.join(directory, "edited.txt");
const fixture = spawn(
  process.env.OPENERX_DOTNET ?? "dotnet",
  [
    path.join(desktop, "tests/native/WdcFixture/bin/Release/net10.0-windows/WdcFixture.dll"),
    targetTitle,
    outputFile,
  ],
  { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
);
fixture.on("error", (error) => console.error("WDC fixture launch failed", error.message));
fixture.stderr?.on("data", (chunk: Buffer) =>
  console.error("WDC fixture:", chunk.toString().slice(0, 1000)),
);
const driver = new WindowsDesktopDriver(
  path.join(helperDirectory, "openerx-desktop-helper.exe"),
  path.join(helperDirectory, "manifest.json"),
);
const host = new DesktopControlHost(driver, new DesktopControlLease());
const owner = { conversationId: randomUUID(), generationId: randomUUID() };
const signal = AbortSignal.timeout(90_000);
const execute = (request: DesktopControlOperation) => host.execute(request, signal, owner);
interface View {
  session: { sessionId: string; applicationId: string };
  observation: {
    observationId: string;
    elements: Array<{
      elementRef: string;
      name: string;
      value: string | null;
      role: string;
      sensitive: boolean;
      actions: string[];
    }>;
  };
}
const view = (r: NormalizedToolResult) => r.data as View;
const identity = (r: NormalizedToolResult) => ({
  contractVersion: DESKTOP_CONTROL_VERSION,
  sessionId: view(r).session.sessionId,
  applicationId: view(r).session.applicationId,
  observationId: view(r).observation.observationId,
});
const element = (r: NormalizedToolResult, name: string) => {
  const e = view(r).observation.elements.find((e) => e.name === name);
  assert(e, `missing ${name}`);
  return e;
};
try {
  await driver.probe(signal);
  let windowRef: string | undefined;
  let applicationId = "";
  for (let attempt = 0; attempt < 20 && !windowRef; attempt++) {
    if (fixture.exitCode !== null) throw new Error(`WDC fixture exited: ${fixture.exitCode}`);
    const list = await execute({ contractVersion: DESKTOP_CONTROL_VERSION, action: "list_apps" });
    const candidate = (
      list.data as { windows: Array<{ title: string; windowRef: string; applicationId: string }> }
    ).windows.find((w) => w.title === targetTitle);
    if (candidate) {
      windowRef = candidate.windowRef;
      applicationId = candidate.applicationId;
    } else await delay(250);
  }
  assert(windowRef, "fixture window not found");
  let result = await execute({
    contractVersion: DESKTOP_CONTROL_VERSION,
    action: "attach",
    applicationId,
    windowRef,
  });
  assert(!JSON.stringify(result).includes("WDC_SECRET_CANARY"), "password leaked");
  const capture = result.content.find((c) => c.type === "image");
  assert(capture?.type === "image");
  await writeFile(path.join(directory, "before.png"), Buffer.from(capture.data, "base64"));
  const stale = identity(result);
  result = await execute({
    ...identity(result),
    action: "set_value",
    effect: "local",
    elementRef: element(result, "WDC editor").elementRef,
    text: "桌面控制验证 😀\r\n第二行",
  });
  assert.equal(element(result, "WDC editor").value, "桌面控制验证 😀\r\n第二行");
  await assert.rejects(
    execute({ ...stale, action: "key", effect: "local", key: "Ctrl+A" }),
    /OBSERVATION_STALE/u,
  );
  // A rejected stale request invalidates current references; observe before continuing.
  result = await execute({
    contractVersion: DESKTOP_CONTROL_VERSION,
    action: "observe",
    applicationId,
    sessionId: identity(result).sessionId,
  });
  result = await execute({
    ...identity(result),
    action: "invoke",
    effect: "local",
    elementRef: element(result, "Save fixture").elementRef,
  });
  assert.equal(await readFile(outputFile, "utf8"), "桌面控制验证 😀\r\n第二行");
  await assert.rejects(
    execute({
      ...identity(result),
      action: "invoke",
      effect: "local",
      elementRef: element(result, "Send").elementRef,
    }),
    /COMMIT_APPROVAL_REQUIRED/u,
  );
  await assert.rejects(readFile(`${outputFile}.sent`), { code: "ENOENT" });
  const sessionId = identity(result).sessionId;
  await host.control({ sessionId, action: "pause" });
  await assert.rejects(
    execute({
      contractVersion: DESKTOP_CONTROL_VERSION,
      action: "observe",
      applicationId,
      sessionId,
    }),
    /USER_RESUME_REQUIRED/u,
  );
  await host.control({ sessionId, action: "resume" });
  result = await execute({
    contractVersion: DESKTOP_CONTROL_VERSION,
    action: "observe",
    applicationId,
    sessionId,
  });
  const after = result.content.find((c) => c.type === "image");
  assert(after?.type === "image");
  await writeFile(path.join(directory, "after.png"), Buffer.from(after.data, "base64"));
  await host.control({ sessionId, action: "stop" });
  assert.equal(host.descriptors()[0]?.state, "stopped");
  await writeFile(
    path.join(directory, "result.json"),
    JSON.stringify(
      {
        status: "passed",
        checks: [
          "native probe",
          "window identity",
          "UIA",
          "password masking",
          "Chinese and emoji",
          "file result",
          "stale observation",
          "commit guard",
          "pause/resume/stop",
        ],
      },
      null,
      2,
    ),
  );
  console.log(`WDC live PASS: ${directory}`);
} finally {
  host.close();
  fixture.kill();
}
