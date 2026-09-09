import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { createHmac } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type {
  RemoteCommand,
  RemoteCommandPayload,
  RemoteDevicePairing,
  RemoteHost,
  RemoteProductEvent,
} from "@openerx/contracts";
import {
  commandCipherContext,
  decryptRemoteObject,
  encryptRemotePayload,
  generateRemoteDeviceKeyPair,
  remotePairingProof,
  signRemoteCommand,
} from "@openerx/remote-protocol";
import { _electron as electron } from "playwright";

const desktopDirectory = path.resolve(import.meta.dirname, "../..");
const mainEntry = path.join(desktopDirectory, ".vite", "build", "main.js");
const platformEntry = path.join(desktopDirectory, ".vite", "build", "platform-alpha-test.mjs");
const profileDirectory = mkdtempSync(path.join(tmpdir(), "openerx-remote-e2e-"));
const platform = fork(platformEntry, [], { stdio: ["ignore", "pipe", "pipe", "ipc"] });
platform.stderr?.pipe(process.stderr);
const platformUrl = await new Promise<string>((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error("Platform Alpha readiness timed out")), 10_000);
  platform.once("error", reject);
  platform.on("message", (message: unknown) => {
    const candidate = message as { kind?: string; baseUrl?: string };
    if (candidate.kind === "platform-alpha.ready" && candidate.baseUrl) {
      clearTimeout(timeout);
      resolve(candidate.baseUrl);
    }
  });
});

async function json<T>(
  pathname: string,
  token: string | null,
  init: RequestInit = {},
): Promise<{ response: Response; value: T }> {
  const response = await fetch(`${platformUrl}${pathname}`, {
    ...init,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...init.headers,
    },
  });
  return { response, value: (await response.json()) as T };
}

async function mobileSession(email: string) {
  const challenge = await json<{ challengeId: string }>("/api/v2/account/challenges", null, {
    method: "POST",
    body: JSON.stringify({ email }),
  });
  return (
    await json<{ accessToken: string; account: { accountId: string } }>(
      "/api/v2/account/sessions",
      null,
      {
        method: "POST",
        body: JSON.stringify({
          challengeId: challenge.value.challengeId,
          code: "123456",
          device: {
            deviceId: crypto.randomUUID(),
            name: "Remote E2E iPhone",
            platform: "ios",
            arch: "arm64",
          },
        }),
      },
    )
  ).value;
}

async function fund(accessToken: string): Promise<void> {
  const terms = await json<{ terms: { version: string } }>("/api/v2/billing/terms", accessToken);
  assert.equal(terms.response.status, 200, JSON.stringify(terms.value));
  await json("/api/v2/billing/terms/accept", accessToken, {
    method: "POST",
    body: JSON.stringify({ version: terms.value.terms.version }),
  });
  const order = (
    await json<{ orderId: string; amountMinor: number; currency: string }>(
      "/api/v2/billing/recharge-orders",
      accessToken,
      {
        method: "POST",
        body: JSON.stringify({
          amountMinor: 5_000,
          provider: "alipay",
          idempotencyKey: "e2e-remote-recharge",
        }),
      },
    )
  ).value;
  const unsigned = {
    eventId: crypto.randomUUID(),
    orderId: order.orderId,
    providerReference: `e2e-remote-${order.orderId}`,
    amountMinor: order.amountMinor,
    currency: order.currency,
    status: "succeeded" as const,
    occurredAt: new Date().toISOString(),
  };
  const signature = createHmac("sha256", "openerx-m3-e2e-alipay")
    .update(
      [
        unsigned.eventId,
        unsigned.orderId,
        unsigned.providerReference,
        unsigned.amountMinor,
        unsigned.currency,
        unsigned.status,
        unsigned.occurredAt,
      ].join("|"),
      "utf8",
    )
    .digest("hex");
  const callback = await json("/api/v2/payment/callback", null, {
    method: "POST",
    body: JSON.stringify({ ...unsigned, signature }),
  });
  assert.equal(callback.response.status, 200);
}

function remoteCommand(input: {
  payload: RemoteCommandPayload;
  host: RemoteHost;
  pairing: RemoteDevicePairing;
  accountId: string;
  controllerDeviceId: string;
  controllerPrivateKey: string;
  sequence: number;
}): RemoteCommand {
  const commandId = crypto.randomUUID();
  const issuedAt = new Date();
  const unsigned: Omit<RemoteCommand, "signature"> = {
    version: 1,
    commandId,
    accountId: input.accountId,
    pairingId: input.pairing.pairingId,
    controllerDeviceId: input.controllerDeviceId,
    hostDeviceId: input.host.hostDeviceId,
    conversationId: null,
    generationId: null,
    kind: input.payload.kind,
    baseRevision: 0,
    sessionSequence: input.sequence,
    issuedAt: issuedAt.toISOString(),
    expiresAt: new Date(issuedAt.getTime() + 45_000).toISOString(),
    idempotencyKey: `remote-e2e:${commandId}`,
    encryptedPayload: "pending-encryption-value-00000000",
  };
  unsigned.encryptedPayload = encryptRemotePayload(
    input.payload,
    input.controllerPrivateKey,
    input.pairing.hostPublicKey,
    commandCipherContext(unsigned),
  );
  return signRemoteCommand(unsigned, input.controllerPrivateKey);
}

let application: Awaited<ReturnType<typeof electron.launch>> | undefined;
try {
  application = await electron.launch({
    args: [mainEntry],
    cwd: desktopDirectory,
    env: {
      ...process.env,
      OPENERX_E2E: "1",
      OPENERX_E2E_USE_PLATFORM: "1",
      OPENERX_E2E_PROFILE_DIR: profileDirectory,
      OPENERX_PLATFORM_URL: platformUrl,
    },
  });
  const page = await application.firstWindow();
  await page.waitForLoadState("domcontentloaded");
  await page.getByRole("link", { name: "设置", exact: true }).click();
  await page.getByLabel("邮箱").fill("remote-e2e@example.com");
  await page.getByRole("button", { name: "发送验证码" }).click();
  await page.getByLabel("六位验证码").fill("123456");
  await page.getByRole("button", { name: "验证并登录" }).click();
  await page.getByLabel("账户状态").getByText("已登录", { exact: true }).waitFor();

  const mobile = await mobileSession("remote-e2e@example.com");
  await fund(mobile.accessToken);
  await page.getByRole("button", { name: "远程连接", exact: true }).click();
  const remoteToggle = page.getByRole("switch", { name: "允许远程控制这台电脑" });
  await remoteToggle.click();
  await page.getByText("已开启", { exact: true }).waitFor();
  const remoteState = await page.evaluate(async () => await window.openerx.getRemoteState());
  assert.equal(remoteState.enabled, true);
  assert.equal(remoteState.available, true);
  await page.getByRole("button", { name: "添加设备", exact: true }).click();
  await page.getByAltText("远程连接一次性配对二维码").waitFor();
  const challenge = await page.evaluate(
    async () => await window.openerx.createRemotePairingChallenge(),
  );
  const controllerKeys = generateRemoteDeviceKeyPair();
  const pairResponse = await json<RemoteDevicePairing>(
    "/api/v2/remote/pairings",
    mobile.accessToken,
    {
      method: "POST",
      body: JSON.stringify({
        challengeId: challenge.challengeId,
        oneTimeNonce: challenge.oneTimeNonce,
        controllerDeviceId:
          challenge.hostDeviceId === mobile.account.accountId ? "invalid" : undefined,
      }),
    },
  );
  assert.equal(pairResponse.response.status, 400);

  const deviceList = await json<Array<{ device: { deviceId: string; platform: string } }>>(
    "/api/v2/devices",
    mobile.accessToken,
  );
  const controllerDeviceId = deviceList.value.find(({ device }) => device.platform === "ios")
    ?.device.deviceId;
  assert.ok(controllerDeviceId);
  const accepted = await json<RemoteDevicePairing>("/api/v2/remote/pairings", mobile.accessToken, {
    method: "POST",
    body: JSON.stringify({
      challengeId: challenge.challengeId,
      oneTimeNonce: challenge.oneTimeNonce,
      controllerDeviceId,
      controllerPublicKey: controllerKeys.publicKey,
      proof: remotePairingProof(
        challenge.challengeId,
        challenge.oneTimeNonce,
        controllerDeviceId,
        controllerKeys.privateKey,
      ),
    }),
  });
  assert.equal(accepted.response.status, 200, JSON.stringify(accepted.value));

  let host: RemoteHost | undefined;
  for (let index = 0; index < 30; index += 1) {
    const hosts = await json<RemoteHost[]>("/api/v2/remote/hosts", mobile.accessToken);
    host = hosts.value.find(({ hostDeviceId }) => hostDeviceId === challenge.hostDeviceId);
    if (host?.presence === "online") break;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  assert.equal(host?.presence, "online");
  await page.getByText("在线", { exact: true }).waitFor();
  if (process.env.OPENERX_E2E_SCREENSHOT_PATH) {
    await page.screenshot({ path: process.env.OPENERX_E2E_SCREENSHOT_PATH });
  }

  const command = remoteCommand({
    payload: {
      kind: "task.start",
      text: "从手机完成一次 Remote E2E 任务",
      clientOperationId: "remote-e2e-operation",
    },
    host: host as RemoteHost,
    pairing: accepted.value,
    accountId: mobile.account.accountId,
    controllerDeviceId,
    controllerPrivateKey: controllerKeys.privateKey,
    sequence: 1,
  });
  const submitted = await json("/api/v2/remote/commands", mobile.accessToken, {
    method: "POST",
    body: JSON.stringify(command),
  });
  assert.equal(submitted.response.status, 200);

  const decrypted: Array<{ envelope: RemoteProductEvent; payload: Record<string, unknown> }> = [];
  let cursor: string | null = null;
  for (let index = 0; index < 80; index += 1) {
    const query = new URLSearchParams({ hostDeviceId: host?.hostDeviceId ?? "", limit: "100" });
    if (cursor) query.set("afterCursor", cursor);
    const eventResponse = await json<RemoteProductEvent[]>(
      `/api/v2/remote/events?${query}`,
      mobile.accessToken,
    );
    for (const envelope of eventResponse.value) {
      decrypted.push({
        envelope,
        payload: decryptRemoteObject(
          envelope.encryptedPayload,
          controllerKeys.privateKey,
          accepted.value.hostPublicKey,
          `event:${envelope.eventId}:${accepted.value.pairingId}`,
        ),
      });
      cursor = envelope.cursor;
    }
    if (
      decrypted.some(
        ({ envelope }) =>
          envelope.kind === "message.completed" || envelope.kind === "message.failed",
      )
    )
      break;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  assert.ok(decrypted.some(({ envelope }) => envelope.kind === "conversation.updated"));
  assert.ok(
    decrypted.some(({ payload }) => String(payload.delta ?? "").includes("Remote E2E")),
    JSON.stringify(decrypted.map(({ envelope, payload }) => ({ kind: envelope.kind, payload }))),
  );
  assert.ok(decrypted.some(({ envelope }) => envelope.kind === "message.completed"));

  const replay = await json("/api/v2/remote/commands", mobile.accessToken, {
    method: "POST",
    body: JSON.stringify(command),
  });
  assert.equal(replay.response.status, 200);
  await new Promise((resolve) => setTimeout(resolve, 1_500));
  const charges = await json<unknown[]>("/api/v2/billing/charges", mobile.accessToken);
  assert.equal(charges.value.length, 1);

  const keyPath = path.join(
    profileDirectory,
    "accounts",
    mobile.account.accountId,
    "credentials",
    "remote-host.bin",
  );
  assert.equal(existsSync(keyPath), true);
  assert.equal(readFileSync(keyPath).toString().includes(challenge.hostPublicKey), false);

  const revoked = await json<RemoteDevicePairing>(
    `/api/v2/remote/pairings/${accepted.value.pairingId}`,
    mobile.accessToken,
    { method: "DELETE" },
  );
  assert.equal(revoked.value.status, "revoked");
  await remoteToggle.click();
  await page.getByText("未开启", { exact: true }).waitFor();
  assert.equal(await page.getByAltText("远程连接一次性配对二维码").count(), 0);

  console.log(
    "E2E_REMOTE_OK same-account-pairing-e2ee-start-cursor-replay-single-charge-revoke-disable-key-vault",
  );
} finally {
  await application?.close().catch(() => undefined);
  platform.send("shutdown");
  await new Promise((resolve) => platform.once("exit", resolve));
  rmSync(profileDirectory, { recursive: true, force: true });
}
