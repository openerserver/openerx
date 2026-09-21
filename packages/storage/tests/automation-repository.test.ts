import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AutomationRepository, nextAutomationRunAt } from "../src";

const directories: string[] = [];

function databasePath(): string {
  const directory = mkdtempSync(path.join(tmpdir(), "openerx-automation-"));
  directories.push(directory);
  return path.join(directory, "automation.sqlite");
}

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

function ids() {
  let sequence = 1;
  return () => `00000000-0000-4000-8000-${String(sequence++).padStart(12, "0")}`;
}

describe("AutomationRepository", () => {
  it("persists definitions and computes a bounded daily schedule", () => {
    let now = "2026-08-29T01:00:00.000Z";
    const repository = new AutomationRepository(databasePath(), {
      now: () => now,
      idFactory: ids(),
    });
    const automation = repository.create({
      name: "Daily brief",
      prompt: "Create the daily brief",
      kind: "standalone",
      schedule: {
        mode: "rrule",
        expression: "FREQ=DAILY;COUNT=3",
        timezone: "Asia/Shanghai",
        startAt: "2026-08-29T02:00:00.000Z",
      },
    });

    expect(automation.nextRunAt).toBe("2026-08-29T02:00:00.000Z");
    expect(automation.execution).toMatchObject({
      modelRef: "platform/auto",
      maxConcurrentRuns: 1,
      catchUpPolicy: "skip",
    });
    now = "2026-08-29T02:00:00.000Z";
    expect(repository.enqueueDue()).toHaveLength(1);
    expect(repository.get(automation.id).nextRunAt).toBe("2026-08-30T02:00:00.000Z");
    repository.close();
  });

  it("deduplicates the same scheduled occurrence across repeated ticks", () => {
    const file = databasePath();
    const idFactory = ids();
    const now = () => "2026-08-29T02:00:00.000Z";
    const repository = new AutomationRepository(file, { now, idFactory });
    const automation = repository.create({
      name: "Once",
      prompt: "Run exactly once",
      kind: "standalone",
      schedule: {
        mode: "once",
        expression: "2026-08-29T02:00:00.000Z",
        timezone: "UTC",
        startAt: "2026-08-29T02:00:00.000Z",
      },
    });

    expect(repository.enqueueDue()).toHaveLength(1);
    expect(repository.enqueueDue()).toHaveLength(0);
    expect(repository.listRuns(automation.id)).toHaveLength(1);
    repository.close();

    const reopened = new AutomationRepository(file, { now, idFactory });
    expect(reopened.enqueueDue()).toHaveLength(0);
    expect(reopened.listRuns(automation.id)).toHaveLength(1);
    reopened.close();
  });

  it("claims atomically, recovers an expired lease, and records terminal state", () => {
    let now = "2026-08-29T02:00:00.000Z";
    const repository = new AutomationRepository(databasePath(), {
      now: () => now,
      idFactory: ids(),
    });
    const automation = repository.create({
      name: "Lease",
      prompt: "Test the lease",
      kind: "standalone",
      schedule: {
        mode: "once",
        expression: now,
        timezone: "UTC",
        startAt: now,
      },
    });
    repository.enqueueDue();
    const first = repository.claimNext("host-a", 1_000);
    expect(first).toMatchObject({ status: "claimed", claimedByHostId: "host-a", attempt: 1 });
    expect(repository.claimNext("host-b", 1_000)).toBeNull();

    now = "2026-08-29T02:00:02.000Z";
    const recovered = repository.claimNext("host-b", 1_000);
    expect(recovered).toMatchObject({ status: "claimed", claimedByHostId: "host-b", attempt: 2 });
    const running = repository.markStarted(String(recovered?.id), {
      conversationId: "00000000-0000-4000-8000-000000000099",
    });
    expect(running.status).toBe("running");
    expect(repository.markFinished(running.id, "succeeded").status).toBe("succeeded");
    expect(repository.listRuns(automation.id)).toHaveLength(1);
    repository.close();
  });

  it("uses revision locking when pausing and resuming", () => {
    let now = "2026-08-29T01:00:00.000Z";
    const repository = new AutomationRepository(databasePath(), { now: () => now });
    const automation = repository.create({
      name: "Pause",
      prompt: "Pause me",
      kind: "standalone",
      schedule: {
        mode: "rrule",
        expression: "FREQ=WEEKLY",
        timezone: "UTC",
        startAt: "2026-08-30T01:00:00.000Z",
      },
    });
    const paused = repository.setStatus(automation.id, automation.revision, "paused");
    expect(paused).toMatchObject({ status: "paused", nextRunAt: null, revision: 2 });
    expect(() => repository.setStatus(automation.id, automation.revision, "active")).toThrow(
      "AUTOMATION_REVISION_CONFLICT",
    );
    now = "2026-08-29T03:00:00.000Z";
    expect(repository.setStatus(paused.id, paused.revision, "active").nextRunAt).toBe(
      "2026-08-30T01:00:00.000Z",
    );
    repository.close();
  });

  it("updates definitions with revision locking and previews the persisted schedule", () => {
    const now = "2026-08-29T01:00:00.000Z";
    const repository = new AutomationRepository(databasePath(), { now: () => now });
    const automation = repository.create({
      name: "Draft",
      prompt: "Prepare a draft",
      kind: "standalone",
      schedule: {
        mode: "rrule",
        expression: "FREQ=DAILY",
        timezone: "UTC",
        startAt: "2026-08-30T02:00:00.000Z",
      },
    });

    const updated = repository.update({
      automationId: automation.id,
      revision: automation.revision,
      changes: {
        name: "Weekly review",
        prompt: "Prepare the weekly review",
        schedule: {
          mode: "rrule",
          expression: "FREQ=WEEKLY",
          timezone: "UTC",
          startAt: "2026-08-30T02:00:00.000Z",
        },
      },
    });
    expect(updated).toMatchObject({
      name: "Weekly review",
      prompt: "Prepare the weekly review",
      revision: 2,
      nextRunAt: "2026-08-30T02:00:00.000Z",
    });
    expect(
      repository.previewSchedule({ schedule: updated.schedule, count: 3, after: now }),
    ).toEqual({
      occurrences: [
        "2026-08-30T02:00:00.000Z",
        "2026-09-06T02:00:00.000Z",
        "2026-09-13T02:00:00.000Z",
      ],
    });
    expect(() =>
      repository.update({
        automationId: automation.id,
        revision: automation.revision,
        changes: { name: "Stale update" },
      }),
    ).toThrow("AUTOMATION_REVISION_CONFLICT");
    repository.close();
  });

  it("rejects heartbeat definitions without a conversation target", () => {
    const repository = new AutomationRepository(databasePath());
    expect(() =>
      repository.create({
        name: "Heartbeat",
        prompt: "Continue the task",
        kind: "heartbeat",
        schedule: {
          mode: "once",
          expression: "2026-08-30T02:00:00.000Z",
          timezone: "UTC",
          startAt: "2026-08-30T02:00:00.000Z",
        },
      }),
    ).toThrow("AUTOMATION_HEARTBEAT_TARGET_REQUIRED");
    repository.close();
  });

  it("marks stale occurrences missed without replaying an offline backlog", () => {
    let now = "2026-08-29T01:00:00.000Z";
    const repository = new AutomationRepository(databasePath(), {
      now: () => now,
      idFactory: ids(),
    });
    const automation = repository.create({
      name: "No backlog",
      prompt: "Do not replay every missed day",
      kind: "standalone",
      schedule: {
        mode: "rrule",
        expression: "FREQ=DAILY",
        timezone: "UTC",
        startAt: "2026-08-29T02:00:00.000Z",
      },
    });

    now = "2026-08-31T05:00:00.000Z";
    expect(repository.enqueueDue()).toMatchObject([
      { status: "missed", scheduledFor: "2026-08-29T02:00:00.000Z" },
    ]);
    expect(repository.get(automation.id).nextRunAt).toBe("2026-09-01T02:00:00.000Z");
    expect(repository.enqueueDue()).toEqual([]);
    repository.close();
  });

  it("marks a just-due occurrence missed when reconciliation follows system sleep", () => {
    let now = "2026-08-29T01:00:00.000Z";
    const repository = new AutomationRepository(databasePath(), {
      now: () => now,
      idFactory: ids(),
    });
    const automation = repository.create({
      name: "Wake reconciliation",
      prompt: "Do not silently replay after sleep",
      kind: "standalone",
      schedule: {
        mode: "once",
        expression: "2026-08-29T02:00:00.000Z",
        timezone: "UTC",
        startAt: "2026-08-29T02:00:00.000Z",
      },
    });

    now = "2026-08-29T02:01:00.000Z";
    expect(repository.enqueueDue({ now, forceMissed: true })).toMatchObject([
      { status: "missed", scheduledFor: "2026-08-29T02:00:00.000Z" },
    ]);
    expect(repository.get(automation.id)).toMatchObject({
      lastRunAt: "2026-08-29T02:00:00.000Z",
      nextRunAt: null,
    });
    repository.close();
  });

  it("catches up only the latest occurrence after an offline backlog", () => {
    let now = "2026-08-29T01:00:00.000Z";
    const repository = new AutomationRepository(databasePath(), {
      now: () => now,
      idFactory: ids(),
    });
    const automation = repository.create({
      name: "Latest only",
      prompt: "Run only the most recent offline occurrence",
      kind: "standalone",
      schedule: {
        mode: "rrule",
        expression: "FREQ=DAILY",
        timezone: "UTC",
        startAt: "2026-08-29T02:00:00.000Z",
      },
      execution: { catchUpPolicy: "latest_once" },
    });

    now = "2026-08-31T05:00:00.000Z";
    expect(repository.enqueueDue({ now, forceMissed: true })).toMatchObject([
      {
        status: "scheduled",
        trigger: "catch_up",
        scheduledFor: "2026-08-31T02:00:00.000Z",
      },
    ]);
    expect(repository.get(automation.id)).toMatchObject({
      lastRunAt: "2026-08-31T02:00:00.000Z",
      nextRunAt: "2026-09-01T02:00:00.000Z",
    });
    expect(repository.enqueueDue({ now, forceMissed: true })).toEqual([]);
    repository.close();
  });

  it("skips a second manual run while the first is queued", () => {
    const now = "2026-08-29T01:00:00.000Z";
    const repository = new AutomationRepository(databasePath(), {
      now: () => now,
      idFactory: ids(),
    });
    const automation = repository.create({
      name: "Single flight",
      prompt: "Run once at a time",
      kind: "standalone",
      schedule: {
        mode: "once",
        expression: "2026-08-30T02:00:00.000Z",
        timezone: "UTC",
        startAt: "2026-08-30T02:00:00.000Z",
      },
    });

    expect(repository.runNow(automation.id).status).toBe("scheduled");
    expect(repository.runNow(automation.id).status).toBe("skipped_overlap");
    repository.close();
  });
});

describe("nextAutomationRunAt", () => {
  it("keeps the same local time across daylight-saving transitions", () => {
    const schedule = {
      mode: "rrule" as const,
      expression: "FREQ=DAILY",
      timezone: "America/New_York",
      startAt: "2026-03-07T14:00:00.000Z",
    };
    expect(nextAutomationRunAt(schedule, schedule.startAt)).toBe("2026-03-08T13:00:00.000Z");
    expect(nextAutomationRunAt(schedule, "2026-03-08T13:00:00.000Z")).toBe(
      "2026-03-09T13:00:00.000Z",
    );
  });

  it("moves a nonexistent spring-forward local time to the first valid minute", () => {
    const schedule = {
      mode: "rrule" as const,
      expression: "FREQ=DAILY",
      timezone: "America/New_York",
      startAt: "2026-03-07T07:30:00.000Z",
    };
    expect(nextAutomationRunAt(schedule, schedule.startAt)).toBe("2026-03-08T07:00:00.000Z");
    expect(nextAutomationRunAt(schedule, "2026-03-08T07:00:00.000Z")).toBe(
      "2026-03-09T06:30:00.000Z",
    );
  });

  it("rejects unsupported rules and invalid timezones", () => {
    expect(() =>
      nextAutomationRunAt(
        {
          mode: "rrule",
          expression: "FREQ=MONTHLY",
          timezone: "UTC",
          startAt: "2026-08-29T00:00:00.000Z",
        },
        "2026-08-29T00:00:00.000Z",
      ),
    ).toThrow("AUTOMATION_RRULE_UNSUPPORTED");
    expect(() =>
      nextAutomationRunAt(
        {
          mode: "once",
          expression: "2026-08-30T00:00:00.000Z",
          timezone: "Not/A_Timezone",
          startAt: "2026-08-30T00:00:00.000Z",
        },
        "2026-08-29T00:00:00.000Z",
      ),
    ).toThrow("AUTOMATION_TIMEZONE_INVALID");
  });
});
