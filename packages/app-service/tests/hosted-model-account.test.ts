import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type {
  AppServiceAuthorization,
  GenerationReceipt,
  PiHostEventFrame,
} from "@openerx/contracts";
import { ChatRepository } from "@openerx/storage";
import { expect, it, vi } from "vitest";
import { ChatAppService, type PiHostClient, type SyncCoordinator } from "../src";

it("binds hosted generations to the login account, blocks model changes while running and keeps sync opt-in", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "hosted-account-test-"));
  let listener: ((event: PiHostEventFrame) => void) | undefined;
  const prompt = vi.fn(async () => {});
  const abort = vi.fn(async (generationId: string) => {
    listener?.({
      kind: "pi.product-event",
      generationId,
      eventId: randomUUID(),
      sequence: 1,
      occurredAt: new Date().toISOString(),
      type: "stopped",
    });
  });
  const pi: PiHostClient = {
    prompt,
    abort,
    control: async () => {},
    onEvent: (cb) => {
      listener = cb;
      return () => {};
    },
    onFileToolRequest: () => () => {},
    onToolRequest: () => () => {},
    onActivity: () => () => {},
  };
  const syncOnce = vi.fn();
  const service = new ChatAppService(new ChatRepository(path.join(directory, "test.sqlite")), pi, {
    syncOnce,
  } as unknown as SyncCoordinator);
  const auth: AppServiceAuthorization = {
    accountId: randomUUID(),
    accessToken: "x".repeat(43),
    accessTokenExpiresAt: new Date(Date.now() + 300000).toISOString(),
    platformBaseUrl: "https://central.example.test",
    modelApiVersion: "v3",
  };
  try {
    const receipt = (await service.handle(
      {
        command: "chat.send",
        input: {
          text: "hello",
          idempotencyKey: "hosted-generation-1",
          modelRef: "platform/model-a",
          thinkingLevel: "off",
        },
      },
      auth,
    )) as GenerationReceipt;
    expect(prompt).toHaveBeenCalledWith(
      expect.objectContaining({
        platform: expect.objectContaining({
          accountId: auth.accountId,
          modelApiVersion: "v3",
          selectedModelRef: "platform/model-a",
        }),
      }),
    );
    expect(syncOnce).not.toHaveBeenCalled();
    await expect(
      service.handle(
        {
          command: "chat.selectModel",
          input: { conversationId: receipt.conversationId, modelRef: "platform/model-b" },
        },
        auth,
      ),
    ).rejects.toThrow("CONVERSATION_GENERATION_ACTIVE");
    await service.invalidateModelAccount(auth.accountId);
    expect(abort).not.toHaveBeenCalled();
    await service.invalidateModelAccount(randomUUID());
    expect(abort).toHaveBeenCalledTimes(1);
    await expect(
      service.handle(
        {
          command: "chat.selectModel",
          input: { conversationId: receipt.conversationId, modelRef: "platform/model-b" },
        },
        auth,
      ),
    ).resolves.toMatchObject({ selectedModelRef: "platform/model-b" });
    expect(syncOnce).not.toHaveBeenCalled();
  } finally {
    await service.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
