// Local native UI fixture: real identity/sync/object/remote services, deterministic model.
// Never point a production app or account at this test server.
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { AccountSyncService } from "@openerx/account-sync-api";
import {
  ChatAppService,
  HttpAccountSyncTransport,
  type PiHostClient,
  SyncCoordinator,
} from "@openerx/app-service";
import type { PiHostEventFrame } from "@openerx/contracts";
import { FileAppService } from "@openerx/file-service";
import { IdentityService } from "@openerx/identity-api";
import { ModelGatewayService } from "@openerx/model-gateway";
import { ObjectStoreService } from "@openerx/object-store-api";
import { createPlatformAlphaServer, listenOnEphemeralPort } from "@openerx/platform-alpha";
import { RemoteControlGateway } from "@openerx/remote-control-gateway";
import {
  HttpRemoteGatewayTransport,
  projectChatEventForRemote,
  RemoteHostConnector,
} from "@openerx/remote-host";
import { generateRemoteDeviceKeyPair } from "@openerx/remote-protocol";
import { ChatRepository, FileRepository, RemoteRepository } from "@openerx/storage";
import { UsageStore } from "@openerx/token-usage-store";
import { MobileApi } from "../../../apps/mobile/src/mobile-api";

const directory = mkdtempSync(path.join(tmpdir(), "openerx-mobile-content-runtime-"));
const identity = new IdentityService(":memory:", {
  accessTokenTtlMs: 60 * 60_000,
  codeFactory: () => "123456",
  challengeCooldownMs: 0,
  mailer: { async deliver() {} },
});
const accountSync = new AccountSyncService(":memory:");
const objects = new ObjectStoreService(":memory:", path.join(directory, "objects"));
const usage = new UsageStore(":memory:");
const remote = new RemoteControlGateway(":memory:");
const models = new ModelGatewayService({
  catalog: [],
  usageStore: usage,
  executor: {
    async execute() {
      throw new Error("UNEXPECTED_MODEL_REQUEST");
    },
  },
});
const listener = await listenOnEphemeralPort(
  createPlatformAlphaServer({ identity, sync: accountSync, objects, usage, models, remote }),
);
const api = new MobileApi(listener.baseUrl);
const challenge = await api.requestCode("mobile-content@example.test");
const desktop = await api.verifyCode(challenge.challengeId, "123456", {
  deviceId: randomUUID(),
  name: "附件与历史测试电脑",
  platform: "darwin",
  arch: "arm64",
});
const principal = identity.authenticate(desktop.accessToken);
const authorization = {
  accountId: desktop.account.accountId,
  accessToken: desktop.accessToken,
  accessTokenExpiresAt: desktop.accessTokenExpiresAt,
  platformBaseUrl: listener.baseUrl,
};
const database = path.join(directory, "profile.sqlite");
const options = { ownerProfileId: principal.accountId, deviceId: principal.deviceId };
const chat = new ChatRepository(database, { ...options, selectedModelRef: "platform/standard" });
const files = new FileAppService(
  new FileRepository(database, options),
  path.join(directory, "profile"),
);
const sync = new SyncCoordinator(chat, new HttpAccountSyncTransport(), files);
let eventListener: (frame: PiHostEventFrame) => void = () => undefined;
const pi: PiHostClient = {
  async prompt(frame) {
    const received = frame.files
      ?.map((file) => {
        const parsed = files.readParsedFile(file.personalFileId);
        return `${file.displayName}\n${parsed.text.slice(0, 300) || "图片已接收"}`;
      })
      .join("\n\n");
    const text = received
      ? `已在电脑读取手机附件：\n${received}`
      : "历史上下文已恢复，可以继续任务。";
    eventListener({
      kind: "pi.product-event",
      generationId: frame.generationId,
      eventId: randomUUID(),
      sequence: 1,
      occurredAt: new Date().toISOString(),
      type: "delta",
      delta: text,
    });
    eventListener({
      kind: "pi.product-event",
      generationId: frame.generationId,
      eventId: randomUUID(),
      sequence: 2,
      occurredAt: new Date().toISOString(),
      type: "completed",
    });
  },
  async abort() {},
  async control() {},
  onEvent(callback) {
    eventListener = callback;
    return () => undefined;
  },
  onFileToolRequest() {
    return () => undefined;
  },
  onToolRequest() {
    return () => undefined;
  },
  onActivity() {
    return () => undefined;
  },
};
const service = new ChatAppService(chat, pi, sync, files, null, new RemoteRepository(database));
for (let index = 0; index < 55; index++) {
  const generation = chat.createGeneration({
    text: `电脑历史任务 ${index + 1}：历史同步验收`,
    idempotencyKey: randomUUID(),
  });
  chat.appendPiEvent(generation.receipt.assistantMessageId, {
    eventId: randomUUID(),
    sequence: 1,
    occurredAt: new Date().toISOString(),
    type: "delta",
    delta: `这是第 ${index + 1} 项任务的完整回答，创建时手机尚未配对。`,
  });
  chat.appendPiEvent(generation.receipt.assistantMessageId, {
    eventId: randomUUID(),
    sequence: 2,
    occurredAt: new Date().toISOString(),
    type: "completed",
  });
}
await sync.syncOnce(authorization);
const keys = generateRemoteDeviceKeyPair();
const connector = new RemoteHostConnector({
  databasePath: path.join(directory, "connector.sqlite"),
  host: {
    hostDeviceId: principal.deviceId,
    displayName: "附件与历史测试电脑",
    platform: "darwin",
    arch: "arm64",
    appVersion: "2.0.5",
    capabilities: ["task.start", "attachment.upload", "session.control"],
    remoteEnabled: true,
  },
  hostPrivateKey: keys.privateKey,
  transport: new HttpRemoteGatewayTransport(listener.baseUrl, desktop.accessToken),
  applier: {
    currentRevision: (id) => service.prepareRemoteRevision(id, authorization),
    apply: (command, payload) => service.applyRemoteCommand(command, payload, authorization),
  },
});
service.onEvent((event) => {
  const projection = projectChatEventForRemote(event);
  if (projection)
    void connector
      .publishEvent({
        ...projection,
        payload: {
          ...projection.payload,
          conversationRevision: service.currentRemoteRevision(event.conversationId),
        },
      })
      .catch(() => undefined);
});
await connector.start();
let ticking = false;
const timer = setInterval(async () => {
  if (ticking) return;
  ticking = true;
  try {
    for (const request of remote.listConnectionRequests(principal)) {
      if (request.status === "pending")
        remote.decideConnectionRequest(principal, {
          requestId: request.requestId,
          decision: "approve",
          hostPublicKey: keys.publicKey,
        });
    }
    await connector.tick();
  } finally {
    ticking = false;
  }
}, 500);
writeFileSync(
  path.join(directory, "手机附件验收.txt"),
  "手机上传验证：订单 A-101，数量 7，总价 12345 元。\n",
);
console.log(
  JSON.stringify({
    baseUrl: listener.baseUrl,
    directory,
    email: "mobile-content@example.test",
    code: "123456",
  }),
);
async function close() {
  clearInterval(timer);
  await connector.stop();
  await service.close();
  connector.close();
  await listener.close();
  identity.close();
  accountSync.close();
  objects.close();
  remote.close();
  usage.close();
  rmSync(directory, { recursive: true, force: true });
  process.exit(0);
}
process.on("SIGTERM", () => void close());
process.on("SIGINT", () => void close());
