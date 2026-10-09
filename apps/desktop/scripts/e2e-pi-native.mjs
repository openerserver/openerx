import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { chromium, _electron as electron } from "playwright";
import { desktopArtifactIdentity } from "./desktop-artifact-identity.mjs";
import { checkModelImageInput } from "./model-capability-preflight.mjs";

const desktopDirectory = path.resolve(import.meta.dirname, "..");
const profileDirectory = mkdtempSync(path.join(tmpdir(), "openerx-e2e-pi-native-"));
const piAgentDirectory = path.join(profileDirectory, "pi-agent");
const fixtureApiKey = "synthetic-pi-native-fixture-key";
const modelSteps = [];
let fixtureError;
// Exercise the real BYOK adapter and its credential checks using only loopback HTTP.
// A non-BYOK faux model would correctly require a central account in UWA.
const fixtureServer = createServer(async (request, response) => {
  try {
    assert.equal(request.method, "POST");
    assert.equal(request.url, "/v1/chat/completions");
    assert.equal(request.headers.authorization, `Bearer ${fixtureApiKey}`);
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    const results = body.messages.filter((message) => message.role === "tool");
    const discovered = results.some((result) => result.tool_call_id === "native-discover");
    const composed = results.find((result) => result.tool_call_id === "native-compose");
    const call = !discovered
      ? {
          id: "native-discover",
          name: "tool_search",
          arguments: { query: "openerx_calculate arithmetic" },
        }
      : !composed
        ? {
            id: "native-compose",
            name: "codemode",
            arguments: {
              code: 'const values = await Promise.all([tools.openerx_calculate({expression:"11+22"}), tools.openerx_calculate({expression:"33+44"})]); text({sum:values.reduce((sum,value)=>sum+value.data.value,0),modelsEnabled:typeof models!=="undefined"});',
            },
          }
        : null;
    const content = composed
      ? typeof composed.content === "string"
        ? composed.content
        : JSON.stringify(composed.content)
      : undefined;
    if (content) {
      assert.match(content, /"sum":110/);
      assert.match(content, /"modelsEnabled":false/);
    }
    modelSteps.push(call?.name ?? "result");
    const delta = call
      ? {
          tool_calls: [
            {
              index: 0,
              id: call.id,
              type: "function",
              function: { name: call.name, arguments: JSON.stringify(call.arguments) },
            },
          ],
        }
      : { content };
    response.writeHead(200, { "content-type": "text/event-stream" });
    response.end(
      `data: ${JSON.stringify({ id: "pi-native-fixture-response", model: "pi-native-fixture", choices: [{ index: 0, delta, finish_reason: call ? "tool_calls" : "stop" }], usage: { prompt_tokens: 20, completion_tokens: 20, total_tokens: 40 } })}\n\ndata: [DONE]\n\n`,
    );
  } catch (error) {
    fixtureError = error;
    response.writeHead(500, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: { code: "NATIVE_FIXTURE_INVALID" } }));
  }
});
await new Promise((resolve) => fixtureServer.listen(0, "127.0.0.1", resolve));
const address = fixtureServer.address();
assert.ok(address && typeof address === "object");
const baseUrl = `http://127.0.0.1:${address.port}/v1`;
let application;
let packagedBrowser;
let packagedChild;
let packagedLog = "";
let packagedError;

async function launchPackaged(env) {
  const reservation = createServer();
  await new Promise((resolve) => reservation.listen(0, "127.0.0.1", resolve));
  const port = reservation.address().port;
  await new Promise((resolve) => reservation.close(resolve));
  // Electron's production fuses disable the Node inspector. Attach only to
  // Chromium's loopback renderer endpoint, leaving those fuses unchanged.
  packagedChild = spawn(
    process.env.OPENERX_E2E_EXECUTABLE,
    [`--remote-debugging-address=127.0.0.1`, `--remote-debugging-port=${port}`],
    { cwd: desktopDirectory, env, stdio: ["ignore", "pipe", "pipe"] },
  );
  packagedChild.on("error", (error) => {
    packagedError = error;
  });
  for (const stream of [packagedChild.stdout, packagedChild.stderr])
    stream.on("data", (chunk) => {
      packagedLog = (packagedLog + chunk.toString()).slice(-12_000);
    });
  const endpoint = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 30_000;
  while (true) {
    assert.ifError(packagedError);
    if (packagedChild.exitCode !== null || packagedChild.signalCode !== null)
      throw new Error(`PACKAGED_NATIVE_APP_EXITED: ${packagedLog}`);
    try {
      const response = await fetch(`${endpoint}/json/version`, {
        signal: AbortSignal.timeout(500),
      });
      if (response.ok) break;
    } catch {
      // The local renderer endpoint becomes available after app startup.
    }
    if (Date.now() >= deadline) throw new Error(`PACKAGED_CDP_NOT_READY: ${packagedLog}`);
    await delay(100);
  }
  packagedBrowser = await chromium.connectOverCDP(endpoint, { timeout: 10_000 });
  const context = packagedBrowser.contexts()[0];
  assert.ok(context, "Packaged Electron must expose its renderer browser context");
  return context.pages()[0] ?? (await context.waitForEvent("page", { timeout: 30_000 }));
}

async function stopPackaged() {
  try {
    await packagedBrowser?.close();
  } finally {
    if (
      packagedChild?.pid &&
      packagedChild.exitCode === null &&
      packagedChild.signalCode === null
    ) {
      const exited = new Promise((resolve) => packagedChild.once("exit", resolve));
      packagedChild.kill("SIGTERM");
      const deadline = setTimeout(() => packagedChild.kill("SIGKILL"), 5_000);
      try {
        await exited;
      } finally {
        clearTimeout(deadline);
      }
    }
  }
}

try {
  const env = {
    ...process.env,
    OPENERX_E2E: "1",
    OPENERX_E2E_USE_PLATFORM: "1",
    OPENERX_E2E_PROFILE_DIR: profileDirectory,
    OPENERX_DEV_AUTO_SIGN_IN: "0",
    PI_CODING_AGENT_DIR: piAgentDirectory,
  };
  let page;
  if (process.env.OPENERX_E2E_EXECUTABLE) page = await launchPackaged(env);
  else {
    application = await electron.launch({
      args: [path.join(desktopDirectory, ".vite/build/main.js")],
      cwd: desktopDirectory,
      env,
    });
    page = await application.firstWindow();
  }
  await page.waitForLoadState("domcontentloaded");
  if (application)
    await application.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler("model:catalog:list");
      ipcMain.handle("model:catalog:list", () => [
        {
          modelRef: "platform/byok",
          displayName: "Local native tools fixture",
          version: "1.0.0",
          capabilities: {
            textInput: true,
            imageInput: false,
            fileInput: false,
            functionCalling: true,
            structuredOutput: true,
          },
          contextWindow: 128_000,
          maxOutputTokens: 8_192,
          status: "available",
          priceRef: "pi-native-fixture",
          priceSummary: "E2E only",
          free: true,
          thinkingLevels: ["off"],
        },
      ]);
    });
  const configured = await page.evaluate(
    ({ baseUrl, apiKey }) =>
      window.openerx.updateModelServiceSettings({
        mode: "byok",
        apiKey,
        byok: {
          baseUrl,
          modelId: "pi-native-fixture",
          displayName: "Local native tools fixture",
          contextWindow: 128_000,
          maxOutputTokens: 8192,
          capabilities: { imageInput: false, functionCalling: true, reasoning: false },
        },
      }),
    { baseUrl, apiKey: fixtureApiKey },
  );
  assert.equal(configured.mode, "byok");
  assert.equal(configured.credentialConfigured, true);
  assert.equal(configured.byok.baseUrl, baseUrl);
  const catalog = await page.evaluate(() => window.openerx.listModels());
  const byokModel = catalog.find(({ modelRef }) => modelRef === "platform/byok");
  assert.ok(byokModel);
  assert.equal(byokModel.status, "available");
  assert.equal(byokModel.displayName, "Local native tools fixture");
  await page.evaluate(() =>
    window.localStorage.setItem("openerx.defaultModelRef", "platform/byok"),
  );
  await page.reload({ waitUntil: "domcontentloaded" });
  const modelPreflight = await checkModelImageInput(page, "pi-native-tools");
  assert.equal(modelPreflight.imageInput, false);
  const settings = await page.evaluate(() => window.openerx.getPiRuntimeSettings());
  assert.equal(settings.nativeToolsEnabled, false);
  await page.evaluate(() => {
    window.location.hash = "/settings/account?section=tools";
  });
  const toggle = page.getByRole("checkbox", { name: "启用工具批量编排" });
  await toggle.click();
  await page.waitForFunction(
    async () => (await window.openerx.getPiRuntimeSettings()).nativeToolsEnabled,
  );
  await page.reload({ waitUntil: "domcontentloaded" });
  assert.equal(await toggle.isChecked(), true);
  await page.getByRole("button", { name: "返回应用", exact: true }).click();
  await page.getByRole("link", { name: "新对话", exact: true }).click();
  await page.getByLabel("发送消息").fill("[PI_TEST_NATIVE] 批量计算并汇总");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await page
    .locator(".message-assistant[data-message-status='completed']")
    .waitFor({ timeout: 30_000 });
  const output = await page.getByLabel("对话消息").innerText();
  assert.ifError(fixtureError);
  assert.deepEqual(modelSteps, ["tool_search", "codemode", "result"]);
  assert.equal(existsSync(path.join(piAgentDirectory, "auth.json")), true);
  assert.match(output, /"sum":110/);
  assert.match(output, /"modelsEnabled":false/);
  const workItems = await page.evaluate(() => window.openerx.listWorkItems({}));
  const detail = await page.evaluate(
    (workItemId) => window.openerx.getWorkItem({ workItemId }),
    workItems[0].id,
  );
  const calculations = detail.toolCalls.filter(({ toolName }) => toolName === "openerx_calculate");
  assert.equal(calculations.length, 2);
  assert.equal(
    calculations.every(({ status }) => status === "completed"),
    true,
  );
  assert.deepEqual(calculations.map(({ input }) => input.expression).sort(), ["11+22", "33+44"]);
  const nestedItems = detail.items.filter(
    ({ content }) =>
      content.type === "tool" &&
      content.parentPiToolCallId === "native-compose" &&
      calculations.some(({ id }) => id === content.toolCallId),
  );
  assert.equal(nestedItems.length, 2);
  assert.equal(
    nestedItems.every(({ status }) => status === "completed"),
    true,
  );
  await page.evaluate(() => {
    window.location.hash = "/settings/account?section=tools";
  });
  await toggle.click();
  await page.waitForFunction(
    async () => !(await window.openerx.getPiRuntimeSettings()).nativeToolsEnabled,
  );
  const evidence = {
    edition: application
      ? await application.evaluate(({ app }) => app.getName())
      : desktopArtifactIdentity(desktopDirectory).productName,
    piVersion: "1.0.0",
    defaultDisabled: true,
    switchPersists: true,
    nativeWorkerExecutes: true,
    brokeredComputations: calculations.length,
    total: 110,
    nestedParentRecorded: true,
    auxiliaryModelsEnabled: false,
    switchedOff: true,
    modelTransport: "loopback-byok",
    localByok: true,
    realPiHost: true,
    piCredentialsIsolated: true,
    authenticatedModelRequests: modelSteps.length,
    packaged: Boolean(packagedChild),
    automationTransport: packagedChild ? "renderer-cdp" : "electron",
    realModelCatalog: Boolean(packagedChild),
  };
  if (process.env.OPENERX_PI_NATIVE_REPORT)
    writeFileSync(process.env.OPENERX_PI_NATIVE_REPORT, `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(JSON.stringify(evidence));
} catch (error) {
  const pages = application
    ? application.windows()
    : (packagedBrowser?.contexts().flatMap((context) => context.pages()) ?? []);
  for (const page of pages) console.error((await page.locator("body").innerText()).slice(0, 8_000));
  if (packagedLog) console.error(packagedLog);
  throw error;
} finally {
  try {
    await application?.close();
    await stopPackaged();
  } finally {
    await new Promise((resolve) => fixtureServer.close(resolve));
    rmSync(profileDirectory, { recursive: true, force: true });
  }
}
