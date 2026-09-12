import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { _electron as electron } from "playwright";

const desktopDirectory = path.resolve(import.meta.dirname, "..");
const profileDirectory = mkdtempSync(
  path.join(realpathSync(tmpdir()), "openerx-model-accounting-"),
);
const evidenceDirectory = path.resolve(desktopDirectory, "../../docs/v2/evidence");
const date = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(new Date());
let mode = "success";
let requests = 0;
const server = http.createServer(async (request, response) => {
  for await (const _chunk of request) {
    /* Synthetic fixture request; do not retain prompts or credentials. */
  }
  requests += 1;
  if (mode === "authentication") {
    response.writeHead(401, { "content-type": "application/json" });
    response.end(
      JSON.stringify({ error: { code: "invalid_api_key", message: "Invalid fixture credential" } }),
    );
    return;
  }
  response.writeHead(200, { "content-type": "text/event-stream" });
  const usage =
    mode === "missing"
      ? undefined
      : {
          prompt_tokens: 100,
          prompt_cache_hit_tokens: 40,
          completion_tokens: 20,
          completion_tokens_details: { reasoning_tokens: 7 },
          total_tokens: 120,
        };
  response.end(
    `data: ${JSON.stringify({ id: "fixture-response", model: "fixture-model", choices: [{ index: 0, delta: { content: "ACCOUNTING_FIXTURE_OK" }, finish_reason: "stop" }], usage })}\n\ndata: [DONE]\n\n`,
  );
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
assert.ok(address && typeof address === "object");
let application;
async function launch() {
  application = await electron.launch({
    args: [path.join(desktopDirectory, ".vite/build/main.js")],
    cwd: desktopDirectory,
    env: {
      ...process.env,
      OPENERX_E2E: "1",
      OPENERX_E2E_USE_PLATFORM: "1",
      OPENERX_E2E_PROFILE_DIR: profileDirectory,
      OPENERX_E2E_APPLICATION_NAME: `openerx CX110 D3 ${path.basename(profileDirectory)}`,
      OPENERX_PLATFORM_URL: "",
      OPENERX_DEV_AUTO_SIGN_IN: "0",
    },
  });
  application.process().stderr.on("data", (chunk) => process.stderr.write(chunk));
  const page = await application.firstWindow();
  await page.waitForLoadState("domcontentloaded");
  await page.waitForFunction(() => Boolean(window.openerx));
  return page;
}
try {
  let page = await launch();
  await page.evaluate(async (baseUrl) => {
    await window.openerx.updateModelServiceSettings({
      mode: "byok",
      apiKey: "synthetic-accounting-fixture-key",
      byok: {
        baseUrl,
        modelId: "fixture-model",
        displayName: "Fixture model",
        contextWindow: 32_000,
        maxOutputTokens: 1024,
        capabilities: { imageInput: false, functionCalling: true, reasoning: false },
      },
    });
    await window.openerx.updateMemorySettings({
      memoriesEnabled: false,
      useMemories: false,
      generateMemories: false,
      syncMemories: false,
    });
  }, `http://127.0.0.1:${address.port}/v1`);
  const results = [];
  let successMessageId;
  for (const scenario of ["success", "missing", "authentication"]) {
    mode = scenario;
    const receipt = await page.evaluate(
      async (idempotencyKey) =>
        window.openerx.sendMessage({
          text: "Run the accounting fixture.",
          modelRef: "platform/byok",
          thinkingLevel: "off",
          idempotencyKey,
        }),
      randomUUID(),
    );
    const deadline = Date.now() + 30_000;
    while (true) {
      const completed = await page.evaluate(async ({ conversationId, assistantMessageId }) => {
        const snapshot = await window.openerx.getConversation({ conversationId });
        return snapshot.messages.some(
          (message) =>
            message.id === assistantMessageId && ["completed", "failed"].includes(message.status),
        );
      }, receipt);
      if (completed) break;
      assert.ok(Date.now() < deadline, "fixture generation timed out");
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    const result = await page.evaluate(
      async ({ conversationId, assistantMessageId }) => ({
        message: (await window.openerx.getConversation({ conversationId })).messages.find(
          (message) => message.id === assistantMessageId,
        ),
        records: await window.openerx.getUsageRecords({ messageId: assistantMessageId }),
        aggregate: await window.openerx.getUsage({ messageId: assistantMessageId }),
      }),
      receipt,
    );
    console.log(
      JSON.stringify({
        scenario,
        requests,
        messageStatus: result.message?.status,
        errorCode: result.message?.errorCode,
        recordCount: result.records.length,
      }),
    );
    assert.equal(result.records.length, 1);
    assert.equal(result.records[0].source, "byok");
    assert.equal(result.records[0].accountId, null);
    assert.equal(result.aggregate.source, "byok");
    if (scenario === "success") {
      successMessageId = receipt.assistantMessageId;
      assert.equal(result.records[0].totalTokens, 120);
      assert.equal(result.records[0].inputTokens, 60);
      assert.equal(result.records[0].reasoningTokens, 7);
    } else {
      assert.equal(result.records[0].totalTokens, null);
      assert.equal(result.aggregate.totalTokens.unknownRecords, 1);
    }
    if (scenario === "authentication") {
      assert.equal(result.message.errorCode, "MODEL_AUTHENTICATION_FAILED");
      assert.equal(result.records[0].failure.httpStatus, 401);
    } else assert.equal(result.message.status, "completed");
    await page.evaluate((conversationId) => {
      window.location.hash = `/chat/${conversationId}`;
    }, receipt.conversationId);
    await page.getByText("运行详情", { exact: true }).click();
    await page.getByRole("status", { name: "消息 Token 用量" }).waitFor();
    if (scenario === "authentication")
      await page
        .getByText("模型 API Key 无效或已失效，请在模型设置中更新密钥。", { exact: true })
        .waitFor();
    results.push({
      scenario,
      messageStatus: result.message.status,
      errorCode: result.message.errorCode,
      records: result.records.length,
      totalTokens: result.records[0].totalTokens,
      unknownRecords: result.aggregate.totalTokens.unknownRecords,
    });
  }
  await application.close();
  application = undefined;
  page = await launch();
  const reopened = await page.evaluate(
    async (messageId) => window.openerx.getUsageRecords({ messageId }),
    successMessageId,
  );
  assert.equal(reopened.length, 1);
  assert.equal(reopened[0].totalTokens, 120);
  const diagnostics = readFileSync(path.join(profileDirectory, "logs/diagnostics.jsonl"), "utf8");
  assert.ok(diagnostics.includes('"code":"MODEL_AUTHENTICATION_FAILED"'));
  assert.ok(!diagnostics.includes("synthetic-accounting-fixture-key"));
  mkdirSync(evidenceDirectory, { recursive: true });
  const evidence = {
    checkedAt: new Date().toISOString(),
    scope: "local Electron with synthetic loopback provider; no external model calls",
    piHostContractVersion: 11,
    requests,
    results,
    restartPersistence: true,
    classifiedDiagnostic: true,
    passed: true,
  };
  writeFileSync(
    path.join(evidenceDirectory, `model-accounting-e2e-${date}.json`),
    `${JSON.stringify(evidence, null, 2)}\n`,
  );
  console.log(JSON.stringify(evidence));
} finally {
  await application?.close();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  rmSync(profileDirectory, { recursive: true, force: true });
}
