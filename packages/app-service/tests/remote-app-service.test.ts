import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type {
  AppServiceAuthorization,
  PiActivityEvent,
  PiFileToolRequestFrame,
  PiHostEventFrame,
  PiPromptFrame,
  PiSessionControlFrame,
  PiToolRequestFrame,
  RemoteCommand,
  RemoteCommandPayload,
} from "@openerx/contracts";
import { remoteCommandSchema } from "@openerx/contracts";
import { ChatRepository, RemoteRepository } from "@openerx/storage";
import { afterEach, describe, expect, it } from "vitest";
import { ChatAppService, type PiHostClient } from "../src";

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

class RemotePiHostClient implements PiHostClient {
  readonly prompts: PiPromptFrame[] = [];
  readonly controls: PiSessionControlFrame[] = [];
  prompt(frame: PiPromptFrame): Promise<void> {
    this.prompts.push(frame);
    return Promise.resolve();
  }
  abort(_generationId: string): Promise<void> {
    return Promise.resolve();
  }
  control(frame: PiSessionControlFrame): Promise<void> {
    this.controls.push(frame);
    return Promise.resolve();
  }
  onEvent(_listener: (frame: PiHostEventFrame) => void): () => void {
    return () => undefined;
  }
  onFileToolRequest(_listener: (frame: PiFileToolRequestFrame) => Promise<unknown>): () => void {
    return () => undefined;
  }
  onToolRequest(_listener: (frame: PiToolRequestFrame) => Promise<unknown>): () => void {
    return () => undefined;
  }
  onActivity(_listener: (frame: PiActivityEvent) => void): () => void {
    return () => undefined;
  }
}

const authorization: AppServiceAuthorization = {
  accountId: randomUUID(),
  accessToken: "a".repeat(48),
  accessTokenExpiresAt: "2026-08-26T12:00:00.000Z",
  platformBaseUrl: "https://platform.openerx.invalid",
};

function remoteCommand(
  payload: RemoteCommandPayload,
  input: {
    conversationId: string | null;
    generationId: string | null;
    baseRevision: number;
    sequence?: number;
  },
): RemoteCommand {
  return remoteCommandSchema.parse({
    version: 1,
    commandId: randomUUID(),
    accountId: authorization.accountId,
    pairingId: randomUUID(),
    controllerDeviceId: randomUUID(),
    hostDeviceId: randomUUID(),
    conversationId: input.conversationId,
    generationId: input.generationId,
    kind: payload.kind,
    baseRevision: input.baseRevision,
    sessionSequence: input.sequence ?? 1,
    issuedAt: "2026-08-26T10:00:00.000Z",
    expiresAt: "2026-08-26T10:01:00.000Z",
    idempotencyKey: `remote-app-${randomUUID()}`,
    encryptedPayload: "E".repeat(43),
    signature: "S".repeat(86),
  });
}

describe("ChatAppService remote Pi mapping", () => {
  it("maps steer directly to the active Pi session and replays the product command once", async () => {
    const directory = mkdtempSync(path.join(tmpdir(), "openerx-remote-app-"));
    directories.push(directory);
    const databasePath = path.join(directory, "profile.sqlite");
    const chat = new ChatRepository(databasePath);
    const remote = new RemoteRepository(databasePath);
    const pi = new RemotePiHostClient();
    const service = new ChatAppService(chat, pi, null, null, null, remote);
    const receipt = (await service.handle(
      {
        command: "chat.send",
        input: { text: "long-running task", idempotencyKey: "local-seed-0001" },
      },
      authorization,
    )) as { conversationId: string };
    const prompt = pi.prompts[0];
    if (!prompt) throw new Error("prompt missing");
    const payload = { kind: "session.steer" as const, text: "先运行测试" };
    const command = remoteCommand(payload, {
      conversationId: receipt.conversationId,
      generationId: prompt.generationId,
      baseRevision: service.currentRemoteRevision(receipt.conversationId),
    });

    expect(await service.applyRemoteCommand(command, payload, authorization)).toMatchObject({
      ok: true,
    });
    expect(await service.applyRemoteCommand(command, payload, authorization)).toMatchObject({
      ok: true,
    });
    expect(pi.controls).toEqual([
      expect.objectContaining({
        requestId: command.commandId,
        generationId: prompt.generationId,
        action: "steer",
        text: payload.text,
      }),
    ]);
    service.close();
  });

  it("rejects a stale revision before any Pi control call", async () => {
    const directory = mkdtempSync(path.join(tmpdir(), "openerx-remote-app-"));
    directories.push(directory);
    const databasePath = path.join(directory, "profile.sqlite");
    const chat = new ChatRepository(databasePath);
    const remote = new RemoteRepository(databasePath);
    const pi = new RemotePiHostClient();
    const service = new ChatAppService(chat, pi, null, null, null, remote);
    const receipt = (await service.handle(
      {
        command: "chat.send",
        input: { text: "active task", idempotencyKey: "local-seed-0002" },
      },
      authorization,
    )) as { conversationId: string };
    const prompt = pi.prompts[0];
    if (!prompt) throw new Error("prompt missing");
    const payload = { kind: "session.follow_up" as const, text: "完成后总结" };
    const command = remoteCommand(payload, {
      conversationId: receipt.conversationId,
      generationId: prompt.generationId,
      baseRevision: 0,
    });
    expect(await service.applyRemoteCommand(command, payload, authorization)).toMatchObject({
      ok: false,
      errorCode: "REMOTE_BASE_REVISION_CONFLICT",
    });
    expect(pi.controls).toHaveLength(0);
    service.close();
  });

  it("resolves the active Pi generation by conversation without exposing a Pi session id", async () => {
    const directory = mkdtempSync(path.join(tmpdir(), "openerx-remote-app-"));
    directories.push(directory);
    const databasePath = path.join(directory, "profile.sqlite");
    const chat = new ChatRepository(databasePath);
    const remote = new RemoteRepository(databasePath);
    const pi = new RemotePiHostClient();
    const service = new ChatAppService(chat, pi, null, null, null, remote);
    const receipt = (await service.handle(
      {
        command: "chat.send",
        input: { text: "active task", idempotencyKey: "local-seed-0003" },
      },
      authorization,
    )) as { conversationId: string; assistantMessageId: string };
    const payload = {
      kind: "session.abort" as const,
      assistantMessageId: receipt.assistantMessageId,
    };
    const command = remoteCommand(payload, {
      conversationId: receipt.conversationId,
      generationId: null,
      baseRevision: service.currentRemoteRevision(receipt.conversationId),
    });

    expect(await service.applyRemoteCommand(command, payload, authorization)).toMatchObject({
      ok: true,
    });
    expect(pi.controls).toEqual([
      expect.objectContaining({ requestId: command.commandId, action: "abort" }),
    ]);
    service.close();
  });

  it("starts a new Pi prompt through the existing chat idempotency path", async () => {
    const directory = mkdtempSync(path.join(tmpdir(), "openerx-remote-app-"));
    directories.push(directory);
    const databasePath = path.join(directory, "profile.sqlite");
    const service = new ChatAppService(
      new ChatRepository(databasePath),
      new RemotePiHostClient(),
      null,
      null,
      null,
      new RemoteRepository(databasePath),
    );
    const payload = {
      kind: "task.start" as const,
      text: "检查项目并运行测试",
      clientOperationId: "mobile-task-0001",
    };
    const command = remoteCommand(payload, {
      conversationId: null,
      generationId: null,
      baseRevision: 0,
    });
    const result = await service.applyRemoteCommand(command, payload, authorization);
    expect(result).toMatchObject({ ok: true, appliedRevision: expect.any(Number) });
    expect(service.currentRemoteRevision(null)).toBe(0);
    service.close();
  });
});
