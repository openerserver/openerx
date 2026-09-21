import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { AutomationRepository } from "@openerx/storage";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AutomationScheduler, ChatAutomationDispatcher } from "../src";

const directories: string[] = [];

function databasePath(): string {
  const directory = mkdtempSync(path.join(tmpdir(), "openerx-scheduler-"));
  directories.push(directory);
  return path.join(directory, "scheduler.sqlite");
}

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe("AutomationScheduler", () => {
  it("dispatches due work once and leaves it running for event reconciliation", async () => {
    const now = "2026-08-29T02:00:00.000Z";
    const repository = new AutomationRepository(databasePath(), { now: () => now });
    const automation = repository.create({
      name: "Scheduler",
      prompt: "Run through chat.send",
      kind: "standalone",
      schedule: { mode: "once", expression: now, timezone: "UTC", startAt: now },
    });
    const dispatch = vi.fn().mockResolvedValue({
      conversationId: "00000000-0000-4000-8000-000000000090",
      assistantMessageId: "00000000-0000-4000-8000-000000000092",
      generationId: "00000000-0000-4000-8000-000000000091",
    });
    const onRunChanged = vi.fn();
    const scheduler = new AutomationScheduler({
      repository,
      dispatcher: { dispatch },
      hostId: "host-a",
      onRunChanged,
    });

    const first = await scheduler.tick();
    const second = await scheduler.tick();

    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch.mock.calls[0]?.[0]).toMatchObject({ id: automation.id });
    expect(first[0]).toMatchObject({
      status: "running",
      conversationId: "00000000-0000-4000-8000-000000000090",
    });
    expect(second).toEqual([]);
    expect(
      (
        await scheduler.handleChatEvent({
          eventId: "00000000-0000-4000-8000-000000000095",
          type: "message.completed",
          conversationId: "00000000-0000-4000-8000-000000000090",
          messageId: "00000000-0000-4000-8000-000000000092",
          sequence: 10,
          occurredAt: now,
          payloadVersion: 1,
          payload: {},
        })
      )?.status,
    ).toBe("succeeded");
    expect(
      await scheduler.handleChatEvent({
        eventId: "00000000-0000-4000-8000-000000000096",
        type: "message.completed",
        conversationId: "00000000-0000-4000-8000-000000000090",
        messageId: "00000000-0000-4000-8000-000000000092",
        sequence: 11,
        occurredAt: now,
        payloadVersion: 1,
        payload: {},
      }),
    ).toBeNull();
    expect(onRunChanged.mock.calls.map(([run]) => run.status)).toEqual([
      "claimed",
      "running",
      "succeeded",
    ]);
    repository.close();
  });

  it("reconciles wake-up misses and dispatches only the latest opted-in catch-up", async () => {
    let now = "2026-08-29T01:00:00.000Z";
    const repository = new AutomationRepository(databasePath(), { now: () => now });
    const skipped = repository.create({
      name: "Skip after sleep",
      prompt: "Skip stale work",
      kind: "standalone",
      schedule: {
        mode: "rrule",
        expression: "FREQ=DAILY",
        timezone: "UTC",
        startAt: "2026-08-29T02:00:00.000Z",
      },
    });
    const caughtUp = repository.create({
      name: "Catch up after sleep",
      prompt: "Run the latest work",
      kind: "standalone",
      schedule: {
        mode: "rrule",
        expression: "FREQ=DAILY",
        timezone: "UTC",
        startAt: "2026-08-29T02:00:00.000Z",
      },
      execution: { catchUpPolicy: "latest_once" },
    });
    const dispatch = vi.fn().mockResolvedValue({
      conversationId: "00000000-0000-4000-8000-000000000090",
      assistantMessageId: "00000000-0000-4000-8000-000000000092",
    });
    const onRunChanged = vi.fn();
    const scheduler = new AutomationScheduler({
      repository,
      dispatcher: { dispatch },
      hostId: "host-a",
      onRunChanged,
    });

    now = "2026-08-31T05:00:00.000Z";
    await expect(
      scheduler.reconcileAfterWake({
        suspendedAt: "2026-08-29T01:30:00.000Z",
        resumedAt: now,
      }),
    ).resolves.toMatchObject([
      {
        automationId: caughtUp.id,
        trigger: "catch_up",
        status: "running",
        scheduledFor: "2026-08-31T02:00:00.000Z",
      },
    ]);
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(repository.listRuns(skipped.id)).toMatchObject([
      { status: "missed", scheduledFor: "2026-08-29T02:00:00.000Z" },
    ]);
    expect(onRunChanged).toHaveBeenCalledWith(
      expect.objectContaining({ automationId: skipped.id, status: "missed" }),
    );
    await expect(
      scheduler.reconcileAfterWake({
        suspendedAt: "2026-08-31T06:00:00.000Z",
        resumedAt: "2026-08-31T05:00:00.000Z",
      }),
    ).rejects.toThrow("AUTOMATION_WAKE_WINDOW_INVALID");
    repository.close();
  });

  it("queues wake reconciliation when a regular tick is already dispatching", async () => {
    let now = "2026-08-29T01:00:00.000Z";
    const repository = new AutomationRepository(databasePath(), { now: () => now });
    repository.create({
      name: "Already dispatching",
      prompt: "Hold the first tick open",
      kind: "standalone",
      schedule: {
        mode: "once",
        expression: "2026-08-29T02:00:00.000Z",
        timezone: "UTC",
        startAt: "2026-08-29T02:00:00.000Z",
      },
    });
    const afterWake = repository.create({
      name: "Due during sleep",
      prompt: "Reconcile after the first tick",
      kind: "standalone",
      schedule: {
        mode: "once",
        expression: "2026-08-29T02:01:00.000Z",
        timezone: "UTC",
        startAt: "2026-08-29T02:01:00.000Z",
      },
    });
    let releaseDispatch: (() => void) | undefined;
    const dispatchGate = new Promise<void>((resolve) => {
      releaseDispatch = resolve;
    });
    const dispatch = vi.fn().mockImplementation(async () => {
      await dispatchGate;
      return {
        conversationId: "00000000-0000-4000-8000-000000000090",
        assistantMessageId: "00000000-0000-4000-8000-000000000092",
      };
    });
    const scheduler = new AutomationScheduler({
      repository,
      dispatcher: { dispatch },
      hostId: "host-a",
    });

    now = "2026-08-29T02:00:00.000Z";
    const regularTick = scheduler.tick();
    await vi.waitFor(() => expect(dispatch).toHaveBeenCalledTimes(1));
    now = "2026-08-29T02:02:00.000Z";
    await scheduler.reconcileAfterWake({
      suspendedAt: "2026-08-29T02:00:30.000Z",
      resumedAt: now,
    });
    releaseDispatch?.();
    await regularTick;

    await vi.waitFor(() =>
      expect(repository.listRuns(afterWake.id)[0]).toMatchObject({ status: "missed" }),
    );
    repository.close();
  });

  it("moves permission waits to needs_attention and cancels the waiting generation", async () => {
    const now = "2026-08-29T02:00:00.000Z";
    const repository = new AutomationRepository(databasePath(), { now: () => now });
    const automation = repository.create({
      name: "Needs review",
      prompt: "Request a protected operation",
      kind: "standalone",
      schedule: { mode: "once", expression: now, timezone: "UTC", startAt: now },
    });
    const cancel = vi.fn().mockResolvedValue(undefined);
    const scheduler = new AutomationScheduler({
      repository,
      dispatcher: {
        dispatch: vi.fn().mockResolvedValue({
          conversationId: "00000000-0000-4000-8000-000000000090",
          assistantMessageId: "00000000-0000-4000-8000-000000000092",
        }),
        cancel,
      },
      hostId: "host-a",
    });

    await scheduler.tick();
    const result = await scheduler.handleChatEvent({
      eventId: "00000000-0000-4000-8000-000000000095",
      type: "permission.required",
      conversationId: "00000000-0000-4000-8000-000000000090",
      messageId: "00000000-0000-4000-8000-000000000092",
      sequence: 10,
      occurredAt: now,
      payloadVersion: 1,
      payload: {},
    });

    expect(result).toMatchObject({
      status: "needs_attention",
      actionRequired: true,
      failureCode: "AUTOMATION_PERMISSION_REQUIRED",
    });
    expect(cancel).toHaveBeenCalledWith(expect.objectContaining({ id: result?.id }));
    expect(repository.listRuns(automation.id)[0]?.status).toBe("needs_attention");
    repository.close();
  });

  it("reconciles a recovered generation failure after an App Service restart", async () => {
    const now = "2026-08-29T02:00:00.000Z";
    const repository = new AutomationRepository(databasePath(), { now: () => now });
    const automation = repository.create({
      name: "Recovery",
      prompt: "Recover safely",
      kind: "standalone",
      schedule: { mode: "once", expression: now, timezone: "UTC", startAt: now },
    });
    const scheduler = new AutomationScheduler({
      repository,
      dispatcher: {
        dispatch: vi.fn().mockResolvedValue({
          conversationId: "00000000-0000-4000-8000-000000000090",
          assistantMessageId: "00000000-0000-4000-8000-000000000092",
        }),
      },
      hostId: "host-a",
    });

    await scheduler.tick();
    await scheduler.handleChatEvent({
      eventId: "00000000-0000-4000-8000-000000000095",
      type: "message.failed",
      conversationId: "00000000-0000-4000-8000-000000000090",
      messageId: "00000000-0000-4000-8000-000000000092",
      sequence: 10,
      occurredAt: now,
      payloadVersion: 1,
      payload: { reason: "APP_SERVICE_RESTARTED" },
    });

    expect(repository.listRuns(automation.id)[0]).toMatchObject({
      status: "failed",
      failureCode: "APP_SERVICE_RESTARTED",
    });
    repository.close();
  });

  it("records dispatch failures without wedging later ticks", async () => {
    const now = "2026-08-29T02:00:00.000Z";
    const repository = new AutomationRepository(databasePath(), { now: () => now });
    const automation = repository.create({
      name: "Failure",
      prompt: "Fail safely",
      kind: "standalone",
      schedule: { mode: "once", expression: now, timezone: "UTC", startAt: now },
    });
    const scheduler = new AutomationScheduler({
      repository,
      dispatcher: { dispatch: vi.fn().mockRejectedValue(new Error("MODEL_GATEWAY_TIMEOUT")) },
      hostId: "host-a",
    });

    expect(await scheduler.tick()).toEqual([]);
    expect(repository.listRuns(automation.id)[0]).toMatchObject({
      status: "failed",
      failureCode: "MODEL_GATEWAY_TIMEOUT",
    });
    expect(await scheduler.tick()).toEqual([]);
    repository.close();
  });

  it("persists transient retries with 1, 5 and 30 minute backoff", async () => {
    let now = "2026-08-29T02:00:00.000Z";
    const repository = new AutomationRepository(databasePath(), { now: () => now });
    const automation = repository.create({
      name: "Retry",
      prompt: "Retry transient startup failures",
      kind: "standalone",
      schedule: { mode: "once", expression: now, timezone: "UTC", startAt: now },
      execution: { retryPolicy: "transient_3" },
    });
    const dispatch = vi
      .fn()
      .mockRejectedValueOnce(new Error("MODEL_GATEWAY_TIMEOUT"))
      .mockRejectedValueOnce(new Error("MODEL_GATEWAY_TIMEOUT"))
      .mockRejectedValueOnce(new Error("MODEL_GATEWAY_TIMEOUT"))
      .mockResolvedValue({
        conversationId: "00000000-0000-4000-8000-000000000090",
        assistantMessageId: "00000000-0000-4000-8000-000000000092",
      });
    const scheduler = new AutomationScheduler({
      repository,
      dispatcher: { dispatch },
      hostId: "host-a",
    });

    await scheduler.tick();
    expect(repository.listRuns(automation.id)[0]).toMatchObject({
      status: "retry_scheduled",
      attempt: 1,
      leaseExpiresAt: "2026-08-29T02:01:00.000Z",
    });
    expect(await scheduler.tick()).toEqual([]);

    now = "2026-08-29T02:01:00.000Z";
    await scheduler.tick();
    expect(repository.listRuns(automation.id)[0]).toMatchObject({
      status: "retry_scheduled",
      attempt: 2,
      leaseExpiresAt: "2026-08-29T02:06:00.000Z",
    });

    now = "2026-08-29T02:06:00.000Z";
    await scheduler.tick();
    expect(repository.listRuns(automation.id)[0]).toMatchObject({
      status: "retry_scheduled",
      attempt: 3,
      leaseExpiresAt: "2026-08-29T02:36:00.000Z",
    });

    now = "2026-08-29T02:36:00.000Z";
    expect(await scheduler.tick()).toMatchObject([{ status: "running", attempt: 4 }]);
    expect(dispatch).toHaveBeenCalledTimes(4);
    repository.close();
  });
});

describe("ChatAutomationDispatcher", () => {
  it("routes standalone work through chat.send with a stable run idempotency key", async () => {
    const handle = vi.fn().mockResolvedValue({
      conversationId: "00000000-0000-4000-8000-000000000090",
      branchId: "00000000-0000-4000-8000-000000000091",
      userMessageId: "00000000-0000-4000-8000-000000000092",
      assistantMessageId: "00000000-0000-4000-8000-000000000093",
    });
    const dispatcher = new ChatAutomationDispatcher({ handle });
    const definition = {
      id: "00000000-0000-4000-8000-000000000001",
      ownerProfileId: "owner",
      name: "Daily",
      prompt: "Original prompt",
      kind: "standalone" as const,
      status: "active" as const,
      schedule: {
        mode: "once" as const,
        expression: "2026-08-29T02:00:00.000Z",
        timezone: "UTC",
        startAt: "2026-08-29T02:00:00.000Z",
      },
      target: { conversationId: null, branchId: null, workspaceGrantIds: [] },
      execution: {
        modelRef: "platform/auto",
        thinkingLevel: "medium" as const,
        skillInstallationId: null,
        maxConcurrentRuns: 1 as const,
        catchUpPolicy: "skip" as const,
        retryPolicy: "none" as const,
      },
      nextRunAt: "2026-08-29T02:00:00.000Z",
      lastRunAt: null,
      createdAt: "2026-08-29T01:00:00.000Z",
      updatedAt: "2026-08-29T01:00:00.000Z",
      revision: 1,
    };
    const run = {
      id: "00000000-0000-4000-8000-000000000010",
      automationId: definition.id,
      scheduledFor: "2026-08-29T02:00:00.000Z",
      trigger: "schedule" as const,
      status: "claimed" as const,
      conversationId: null,
      branchId: null,
      assistantMessageId: null,
      generationId: null,
      executionRunId: null,
      attempt: 1,
      claimedByHostId: "host-a",
      leaseExpiresAt: "2026-08-29T02:01:00.000Z",
      promptSnapshot: "Frozen prompt",
      configSnapshot: {},
      failureCode: null,
      actionRequired: false,
      createdAt: "2026-08-29T02:00:00.000Z",
      startedAt: null,
      finishedAt: null,
    };

    await expect(dispatcher.dispatch(definition, run)).resolves.toEqual({
      conversationId: "00000000-0000-4000-8000-000000000090",
      assistantMessageId: "00000000-0000-4000-8000-000000000093",
    });
    expect(handle).toHaveBeenCalledWith(
      {
        command: "chat.send",
        input: expect.objectContaining({
          conversationId: null,
          text: "Frozen prompt",
          idempotencyKey: `automation-run:${run.id}`,
          modelRef: "platform/auto",
          thinkingLevel: "medium",
        }),
      },
      undefined,
      undefined,
    );

    await dispatcher.cancel({
      ...run,
      status: "running",
      conversationId: "00000000-0000-4000-8000-000000000090",
      assistantMessageId: "00000000-0000-4000-8000-000000000093",
      startedAt: "2026-08-29T02:00:00.000Z",
    });
    expect(handle).toHaveBeenLastCalledWith(
      {
        command: "chat.stop",
        input: {
          conversationId: "00000000-0000-4000-8000-000000000090",
          assistantMessageId: "00000000-0000-4000-8000-000000000093",
        },
      },
      undefined,
      undefined,
    );
  });
});
