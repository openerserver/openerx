import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  type AppServiceAuthorization,
  type RemoteCommand,
  type RemoteCommandPayload,
  remoteCommandPayloadSchema,
  remoteCommandSchema,
  remoteProjectSummarySchema,
} from "@openerx/contracts";
import { ChatRepository, ProjectRepository, RemoteRepository } from "@openerx/storage";
import { afterEach, expect, test, vi } from "vitest";
import { ChatAppService, type PiHostClient } from "../src";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of cleanups.splice(0).reverse()) await close();
});
function fixture() {
  const directory = mkdtempSync(path.join(tmpdir(), "remote-project-create-"));
  const database = path.join(directory, "profile.sqlite");
  const accountId = randomUUID();
  const projects = new ProjectRepository(database, { ownerProfileId: accountId });
  const chat = new ChatRepository(database, { ownerProfileId: accountId });
  const pi: PiHostClient = {
    prompt: vi.fn(async () => {}),
    abort: vi.fn(async () => {}),
    control: vi.fn(async () => {}),
    onEvent: () => () => {},
    onActivity: () => () => {},
    onFileToolRequest: () => () => {},
    onToolRequest: () => () => {},
  };
  const service = new ChatAppService(
    chat,
    pi,
    null,
    null,
    null,
    new RemoteRepository(database),
    null,
    null,
    projects,
  );
  const authorization: AppServiceAuthorization = {
    accountId,
    accessToken: "a".repeat(48),
    accessTokenExpiresAt: new Date(Date.now() + 3600000).toISOString(),
    platformBaseUrl: "https://platform.example.test",
  };
  cleanups.push(async () => {
    await service.close();
    projects.close();
    rmSync(directory, { recursive: true, force: true });
  });
  const payload = remoteCommandPayloadSchema.parse({
    kind: "project.create",
    operationId: randomUUID(),
    name: "  手机新项目  ",
    instructions: "先验证再修改。",
  });
  const command = (
    value: RemoteCommandPayload = payload,
    overrides: Partial<RemoteCommand> = {},
  ): RemoteCommand =>
    remoteCommandSchema.parse({
      version: 1,
      commandId: randomUUID(),
      accountId,
      pairingId: randomUUID(),
      controllerDeviceId: randomUUID(),
      hostDeviceId: randomUUID(),
      conversationId: null,
      generationId: null,
      kind: value.kind,
      baseRevision: 0,
      sessionSequence: 1,
      issuedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 30000).toISOString(),
      idempotencyKey: randomUUID(),
      encryptedPayload: "a".repeat(43),
      signature: "a".repeat(43),
      ...overrides,
    });
  return { database, accountId, projects, chat, pi, service, authorization, payload, command };
}

test("mobile project creation is durable and idempotent across command retries, then accepts a task", async () => {
  const f = fixture(),
    command = f.command();
  const result = await f.service.applyRemoteCommand(command, f.payload, f.authorization);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.errorCode);
  const project = remoteProjectSummarySchema.parse(result.result);
  expect(project).toMatchObject({
    name: "手机新项目",
    instructions: "先验证再修改。",
    directories: [],
    conversationCount: 0,
  });
  expect(await f.service.applyRemoteCommand(command, f.payload, f.authorization)).toEqual(result);
  expect(await f.service.applyRemoteCommand(f.command(), f.payload, f.authorization)).toMatchObject(
    { ok: true, result: project },
  );
  const reopened = new ProjectRepository(f.database, { ownerProfileId: f.accountId });
  try {
    expect(reopened.listProjects()).toHaveLength(1);
    expect(reopened.getProject(project.projectId).project.name).toBe(project.name);
  } finally {
    reopened.close();
  }
  expect(f.pi.prompt).not.toHaveBeenCalled();
  expect(f.chat.listConversations()).toEqual([]);
  const task: RemoteCommandPayload = {
    kind: "task.start",
    text: "继续项目",
    clientOperationId: randomUUID(),
    projectId: project.projectId,
  };
  const started = await f.service.applyRemoteCommand(f.command(task), task, f.authorization);
  expect(started.ok).toBe(true);
  expect(f.chat.listConversations()[0]?.projectId).toBe(project.projectId);
  expect(f.pi.prompt).toHaveBeenCalledTimes(1);
});

test("mobile project creation rejects conversation scope, stale revisions, and foreign accounts", async () => {
  const f = fixture();
  const conversation = f.chat.createGeneration({
    text: "Existing task",
    idempotencyKey: randomUUID(),
  });
  const id = conversation.receipt.conversationId;
  expect(
    await f.service.applyRemoteCommand(
      f.command(f.payload, {
        conversationId: id,
        baseRevision: f.service.currentRemoteRevision(id),
      }),
      f.payload,
      f.authorization,
    ),
  ).toMatchObject({ ok: false, errorCode: "REMOTE_NEW_TASK_SCOPE_REQUIRED" });
  expect(
    await f.service.applyRemoteCommand(
      f.command(f.payload, { baseRevision: 1 }),
      f.payload,
      f.authorization,
    ),
  ).toMatchObject({ ok: false, errorCode: "REMOTE_BASE_REVISION_CONFLICT" });
  await expect(
    f.service.applyRemoteCommand(f.command(), f.payload, {
      ...f.authorization,
      accountId: randomUUID(),
    }),
  ).rejects.toThrow("ACCOUNT_SCOPE_VIOLATION");
  expect(f.projects.listProjects()).toEqual([]);
});

test("mobile creation validates names, instructions and operation IDs without exposing directory grants", () => {
  const valid = { kind: "project.create", operationId: randomUUID(), name: "项目" };
  expect(remoteCommandPayloadSchema.parse(valid)).toMatchObject({ instructions: "" });
  for (const patch of [
    { name: "  " },
    { name: "中".repeat(81) },
    { operationId: "invalid" },
    { instructions: "x".repeat(20001) },
    { rootPath: "/private" },
    { workspaceGrantId: randomUUID() },
  ])
    expect(remoteCommandPayloadSchema.safeParse({ ...valid, ...patch }).success).toBe(false);
});
