import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { remoteCommandSchema } from "@openerx/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { RemoteRepository } from "../src";

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

describe("RemoteRepository", () => {
  it("replays a durable application result and rejects payload substitution", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "openerx-remote-repository-"));
    directories.push(directory);
    const repository = new RemoteRepository(path.join(directory, "profile.sqlite"));
    const command = remoteCommandSchema.parse({
      version: 1,
      commandId: randomUUID(),
      accountId: randomUUID(),
      pairingId: randomUUID(),
      controllerDeviceId: randomUUID(),
      hostDeviceId: randomUUID(),
      conversationId: randomUUID(),
      generationId: randomUUID(),
      kind: "session.steer",
      baseRevision: 2,
      sessionSequence: 1,
      issuedAt: "2026-08-26T10:00:00.000Z",
      expiresAt: "2026-08-26T10:01:00.000Z",
      idempotencyKey: "remote-repository-0001",
      encryptedPayload: "E".repeat(43),
      signature: "S".repeat(86),
    });
    const payload = { kind: "session.steer" as const, text: "run tests" };
    expect(repository.begin(command, payload)).toEqual({ replayed: false, result: null });
    const result = repository.complete(command.commandId, {
      kind: "remote.command.result",
      requestId: command.commandId,
      ok: true,
      appliedRevision: 3,
    });
    expect(repository.begin(command, payload)).toEqual({ replayed: true, result });
    expect(() => repository.begin(command, { ...payload, text: "delete files" })).toThrow(
      "REMOTE_COMMAND_REPLAY_CONFLICT",
    );
    repository.close();
  });

  it("marks an interrupted application outcome unknown and refuses blind replay", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "openerx-remote-repository-"));
    directories.push(directory);
    const databasePath = path.join(directory, "profile.sqlite");
    const command = remoteCommandSchema.parse({
      version: 1,
      commandId: randomUUID(),
      accountId: randomUUID(),
      pairingId: randomUUID(),
      controllerDeviceId: randomUUID(),
      hostDeviceId: randomUUID(),
      conversationId: randomUUID(),
      generationId: null,
      kind: "session.prompt",
      baseRevision: 2,
      sessionSequence: 1,
      issuedAt: "2026-08-26T10:00:00.000Z",
      expiresAt: "2026-08-26T10:01:00.000Z",
      idempotencyKey: "remote-repository-crash-0001",
      encryptedPayload: "E".repeat(43),
      signature: "S".repeat(86),
    });
    const payload = {
      kind: "session.prompt" as const,
      text: "apply reviewed changes",
      clientOperationId: "mobile-crash-0001",
      executionMode: "attended" as const,
    };
    const first = new RemoteRepository(databasePath);
    expect(first.begin(command, payload)).toEqual({ replayed: false, result: null });
    first.close();

    const recovered = new RemoteRepository(databasePath);
    expect(() => recovered.begin(command, payload)).toThrow("REMOTE_COMMAND_OUTCOME_UNKNOWN");
    recovered.close();
  });
});
