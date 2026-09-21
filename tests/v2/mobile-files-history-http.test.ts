import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { AccountSyncService } from "@openerx/account-sync-api";
import {
  ChatAppService,
  HttpAccountSyncTransport,
  type PiHostClient,
  SyncCoordinator,
} from "@openerx/app-service";
import {
  type AppServiceAuthorization,
  type PiHostEventFrame,
  type PiPromptFrame,
  type RemoteCommandPayload,
  remoteCommandSchema,
} from "@openerx/contracts";
import { FileAppService } from "@openerx/file-service";
import { IdentityService } from "@openerx/identity-api";
import { ModelGatewayService } from "@openerx/model-gateway";
import { ObjectStoreService } from "@openerx/object-store-api";
import { createPlatformAlphaServer, listenOnEphemeralPort } from "@openerx/platform-alpha";
import {
  decryptRemotePayload,
  encryptRemotePayload,
  generateRemoteDeviceKeyPair,
} from "@openerx/remote-protocol";
import { ChatRepository, FileRepository, RemoteRepository } from "@openerx/storage";
import { UsageStore } from "@openerx/token-usage-store";
import { afterEach, describe, expect, it } from "vitest";
import { attachmentDraft, MobileAttachmentUploader } from "../../apps/mobile/src/attachments";
import {
  historyTasks,
  type MobileHistoryState,
  MobileHistorySync,
} from "../../apps/mobile/src/history";
import { MobileApi } from "../../apps/mobile/src/mobile-api";

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
const hash = async (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

async function setup(platform: "ios" | "android") {
  const directory = mkdtempSync(path.join(tmpdir(), "openerx-mobile-content-"));
  const identity = new IdentityService(":memory:", {
    codeFactory: () => "123456",
    challengeCooldownMs: 0,
    mailer: { async deliver() {} },
  });
  const accountSync = new AccountSyncService(":memory:");
  const objects = new ObjectStoreService(":memory:", path.join(directory, "objects"));
  const usage = new UsageStore(":memory:");
  const models = new ModelGatewayService({
    catalog: [],
    usageStore: usage,
    executor: {
      async execute() {
        throw new Error("MODEL_NOT_EXPECTED");
      },
    },
  });
  const listener = await listenOnEphemeralPort(
    createPlatformAlphaServer({ identity, sync: accountSync, objects, usage, models }),
  );
  cleanups.push(async () => {
    await listener.close();
    identity.close();
    accountSync.close();
    objects.close();
    usage.close();
    rmSync(directory, { recursive: true, force: true });
  });
  const api = new MobileApi(listener.baseUrl);
  const signIn = async (email: string, devicePlatform: "ios" | "android" | "darwin") => {
    const challenge = await api.requestCode(email);
    return api.verifyCode(challenge.challengeId, "123456", {
      deviceId: randomUUID(),
      name: "Content test",
      platform: devicePlatform,
      arch: "arm64",
    });
  };
  const phone = await signIn("content@example.test", platform);
  const desktop = await signIn("content@example.test", "darwin");
  const authorization: AppServiceAuthorization = {
    accountId: desktop.account.accountId,
    accessToken: desktop.accessToken,
    accessTokenExpiresAt: desktop.accessTokenExpiresAt,
    platformBaseUrl: listener.baseUrl,
  };
  const database = path.join(directory, "desktop.sqlite");
  const repository = new ChatRepository(database, {
    ownerProfileId: desktop.account.accountId,
    deviceId: desktop.session.device.deviceId,
    selectedModelRef: "platform/standard",
  });
  const fileRepository = new FileRepository(database, {
    ownerProfileId: desktop.account.accountId,
    deviceId: desktop.session.device.deviceId,
  });
  const files = new FileAppService(fileRepository, path.join(directory, "profile"));
  const sync = new SyncCoordinator(repository, new HttpAccountSyncTransport(), files);
  const prompts: PiPromptFrame[] = [];
  let onEvent: (frame: PiHostEventFrame) => void = () => undefined;
  const pi: PiHostClient = {
    async prompt(frame) {
      prompts.push(frame);
      onEvent({
        kind: "pi.product-event",
        generationId: frame.generationId,
        eventId: randomUUID(),
        sequence: 1,
        occurredAt: new Date().toISOString(),
        type: "delta",
        delta: "已收到手机附件",
      });
      onEvent({
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
    onEvent(listener) {
      onEvent = listener;
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
  const service = new ChatAppService(
    repository,
    pi,
    sync,
    files,
    null,
    new RemoteRepository(database),
  );
  cleanups.push(() => service.close());
  const command = (payload: RemoteCommandPayload, conversationId: string | null = null) =>
    remoteCommandSchema.parse({
      version: 1,
      commandId: randomUUID(),
      accountId: desktop.account.accountId,
      pairingId: randomUUID(),
      controllerDeviceId: phone.session.device.deviceId,
      hostDeviceId: desktop.session.device.deviceId,
      conversationId,
      generationId: null,
      kind: payload.kind,
      baseRevision: repository.conversationRevision(conversationId),
      sessionSequence: 1,
      issuedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 45_000).toISOString(),
      idempotencyKey: randomUUID(),
      encryptedPayload: "E".repeat(43),
      signature: "S".repeat(86),
    });
  return { api, phone, authorization, signIn, service, files, repository, sync, prompts, command };
}

describe("mobile upload to desktop and account history over real HTTP", () => {
  it.each(["ios", "android"] as const)(
    "%s uploads, parses, binds files to a turn and restores full history on a fresh phone",
    async (platform) => {
      const s = await setup(platform);
      // No remote event existed for this older desktop conversation.
      const old = s.repository.createGeneration({
        text: "桌面旧任务",
        idempotencyKey: randomUUID(),
      });
      s.repository.appendPiEvent(old.receipt.assistantMessageId, {
        eventId: randomUUID(),
        sequence: 1,
        occurredAt: new Date().toISOString(),
        type: "delta",
        delta: "旧任务完整回答",
      });
      s.repository.appendPiEvent(old.receipt.assistantMessageId, {
        eventId: randomUUID(),
        sequence: 2,
        occurredAt: new Date().toISOString(),
        type: "completed",
      });
      await s.sync.syncOnce(s.authorization);
      const bytes = new TextEncoder().encode("手机报告：收入 12345 元。");
      const file = attachmentDraft({
        id: randomUUID(),
        uri: "fixture",
        displayName: "手机报告.txt",
        sizeBytes: bytes.length,
      });
      const uploader = new MobileAttachmentUploader(
        s.api,
        s.phone.account.accountId,
        () => s.phone.accessToken,
        async () => bytes,
        hash,
      );
      const attachments = await uploader.upload([file], () => undefined);
      const payload: RemoteCommandPayload = {
        kind: "task.start",
        text: "请阅读附件",
        clientOperationId: randomUUID(),
        attachments,
      };
      // The extended payload survives the same encrypted command codec used by the devices.
      const phoneKeys = generateRemoteDeviceKeyPair();
      const hostKeys = generateRemoteDeviceKeyPair();
      const encrypted = encryptRemotePayload(
        payload,
        phoneKeys.privateKey,
        hostKeys.publicKey,
        "test-transfer",
      );
      const decoded = decryptRemotePayload(
        encrypted,
        hostKeys.privateKey,
        phoneKeys.publicKey,
        "test-transfer",
      );
      const command = s.command(decoded);
      const outcome = await s.service.applyRemoteCommand(command, decoded, s.authorization);
      expect(outcome.ok).toBe(true);
      const prompt = s.prompts[0];
      if (!prompt) throw new Error("Expected a model prompt");
      expect(prompt.files).toMatchObject([{ displayName: "手机报告.txt", format: "text" }]);
      const fileId = prompt.files?.[0]?.personalFileId;
      if (!fileId) throw new Error("Expected an attached file");
      expect(s.files.readParsedFile(fileId).text).toContain("收入 12345 元");
      expect(s.files.attachments(prompt.conversationId)[0]?.messageId).toBe(
        prompt.history.at(-1)?.messageId,
      );
      expect(s.files.listFiles(prompt.conversationId)[0]?.sourceScopeId).toBeNull();
      expect(await s.service.applyRemoteCommand(command, decoded, s.authorization)).toEqual(
        outcome,
      );
      expect(s.prompts).toHaveLength(1);
      await s.sync.syncOnce(s.authorization);
      let saved: MobileHistoryState | null = null;
      const history = new MobileHistorySync(
        s.phone.account.accountId,
        (cursor) => s.api.pullHistory(s.phone.accessToken, cursor),
        {
          async load() {
            return saved;
          },
          async save(value) {
            saved = value;
          },
          async clear() {
            saved = null;
          },
        },
        () => undefined,
      );
      await history.sync();
      const tasks = historyTasks(history.state, []);
      expect(
        tasks.find((task) => task.id === old.receipt.conversationId)?.messages.at(-1)?.text,
      ).toBe("旧任务完整回答");
      expect(tasks.find((task) => task.id === prompt.conversationId)?.attachments).toMatchObject([
        { displayName: "手机报告.txt", sizeBytes: bytes.length },
      ]);
      expect(tasks.find((task) => task.id === prompt.conversationId)?.messages.at(-1)?.text).toBe(
        "已收到手机附件",
      );
      const nextFiles = await uploader.upload(
        [{ ...file, id: randomUUID(), displayName: "手机补充报告.txt" }],
        () => undefined,
      );
      const continuation: RemoteCommandPayload = {
        kind: "session.prompt",
        text: "继续阅读补充附件",
        clientOperationId: randomUUID(),
        attachments: nextFiles,
      };
      expect(
        (
          await s.service.applyRemoteCommand(
            s.command(continuation, prompt.conversationId),
            continuation,
            s.authorization,
          )
        ).ok,
      ).toBe(true);
      const nextPrompt = s.prompts.at(-1);
      expect(s.prompts).toHaveLength(2);
      const currentUser = nextPrompt?.history.at(-1)?.messageId;
      expect(currentUser).toBeTruthy();
      expect(currentUser).not.toBe(prompt.history.at(-1)?.messageId);
      expect(
        s.files.attachments(prompt.conversationId).filter((item) => item.messageId === currentUser),
      ).toHaveLength(1);
      await s.sync.syncOnce(s.authorization);
      await history.sync();
      expect(
        historyTasks(history.state, []).find((task) => task.id === prompt.conversationId)
          ?.attachments,
      ).toHaveLength(2);
    },
  );
  it("rejects foreign objects and mismatched content before a task or model call exists", async () => {
    const s = await setup("ios");
    const foreign = await s.signIn("foreign@example.test", "ios");
    const bytes = new TextEncoder().encode("private");
    const descriptor = {
      objectId: randomUUID(),
      sizeBytes: bytes.length,
      checksumSha256: await hash(bytes),
      mediaType: "text/plain",
    };
    await s.api.uploadObject(foreign.accessToken, descriptor, bytes);
    const payload: RemoteCommandPayload = {
      kind: "task.start",
      text: "read",
      clientOperationId: randomUUID(),
      attachments: [{ ...descriptor, displayName: "private.txt" }],
    };
    const foreignResult = await s.service.applyRemoteCommand(
      s.command(payload),
      payload,
      s.authorization,
    );
    expect(foreignResult).toMatchObject({ ok: false });
    await s.api.uploadObject(s.phone.accessToken, descriptor, bytes);
    payload.attachments = [
      { ...descriptor, displayName: "private.txt", checksumSha256: "0".repeat(64) },
    ];
    expect(
      await s.service.applyRemoteCommand(s.command(payload), payload, s.authorization),
    ).toMatchObject({ ok: false, errorCode: "OBJECT_CHECKSUM_MISMATCH" });
    expect(s.prompts).toHaveLength(0);
    expect(s.repository.listConversations()).toHaveLength(0);
  });
});
