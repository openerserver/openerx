import { describe, expect, it } from "vitest";
import {
  appServiceRequestFrameSchema,
  automationCommandEnvelopeSchema,
  automationDefinitionSchema,
  automationRunEventFrameSchema,
  automationSchedulerReconcileFrameSchema,
  parseAutomationCommandResult,
} from "../src";

describe("automation contracts", () => {
  it("accepts a strict create command through the App Service frame", () => {
    const command = automationCommandEnvelopeSchema.parse({
      command: "automation.create",
      input: {
        name: "Daily brief",
        prompt: "Prepare the brief",
        kind: "standalone",
        schedule: {
          mode: "rrule",
          expression: "FREQ=DAILY",
          timezone: "Asia/Shanghai",
          startAt: "2026-08-30T01:00:00.000Z",
        },
      },
    });
    expect(
      appServiceRequestFrameSchema.parse({
        kind: "app-service.request",
        requestId: "00000000-0000-4000-8000-000000000001",
        request: command,
      }).request.command,
    ).toBe("automation.create");
  });

  it("validates a complete persisted definition", () => {
    const definition = automationDefinitionSchema.parse({
      id: "00000000-0000-4000-8000-000000000001",
      ownerProfileId: "owner",
      name: "Once",
      prompt: "Run once",
      kind: "standalone",
      status: "active",
      schedule: {
        mode: "once",
        expression: "2026-08-30T01:00:00.000Z",
        timezone: "UTC",
        startAt: "2026-08-30T01:00:00.000Z",
      },
      target: { conversationId: null, branchId: null, workspaceGrantIds: [] },
      execution: {
        modelRef: "platform/auto",
        thinkingLevel: "medium",
        skillInstallationId: null,
        maxConcurrentRuns: 1,
        catchUpPolicy: "skip",
        retryPolicy: "none",
      },
      nextRunAt: "2026-08-30T01:00:00.000Z",
      lastRunAt: null,
      createdAt: "2026-08-29T01:00:00.000Z",
      updatedAt: "2026-08-29T01:00:00.000Z",
      revision: 1,
    });
    expect(definition.status).toBe("active");
  });

  it("validates automation run events sent to the desktop host", () => {
    const event = automationRunEventFrameSchema.parse({
      kind: "automation.run.event",
      run: {
        id: "00000000-0000-4000-8000-000000000010",
        automationId: "00000000-0000-4000-8000-000000000001",
        scheduledFor: "2026-08-30T01:00:00.000Z",
        trigger: "schedule",
        status: "needs_attention",
        conversationId: "00000000-0000-4000-8000-000000000090",
        branchId: null,
        assistantMessageId: "00000000-0000-4000-8000-000000000093",
        generationId: null,
        executionRunId: null,
        attempt: 1,
        claimedByHostId: "host-a",
        leaseExpiresAt: null,
        promptSnapshot: "Run safely",
        configSnapshot: {},
        failureCode: "AUTOMATION_PERMISSION_REQUIRED",
        actionRequired: true,
        createdAt: "2026-08-30T01:00:00.000Z",
        startedAt: "2026-08-30T01:00:00.000Z",
        finishedAt: "2026-08-30T01:01:00.000Z",
      },
    });

    expect(event.run).toMatchObject({ status: "needs_attention", actionRequired: true });
  });

  it("validates system-resume reconciliation windows", () => {
    expect(
      automationSchedulerReconcileFrameSchema.parse({
        kind: "automation.scheduler.reconcile",
        reason: "system_resume",
        suspendedAt: "2026-08-30T01:00:00.000Z",
        resumedAt: "2026-08-30T01:03:00.000Z",
      }),
    ).toMatchObject({ reason: "system_resume" });
    expect(() =>
      automationSchedulerReconcileFrameSchema.parse({
        kind: "automation.scheduler.reconcile",
        reason: "system_resume",
        suspendedAt: "2026-08-30T01:04:00.000Z",
        resumedAt: "2026-08-30T01:03:00.000Z",
      }),
    ).toThrow();
  });

  it("accepts update and schedule-preview commands with strict results", () => {
    expect(
      automationCommandEnvelopeSchema.parse({
        command: "automation.update",
        input: {
          automationId: "00000000-0000-4000-8000-000000000001",
          revision: 2,
          changes: { name: "Updated" },
        },
      }).command,
    ).toBe("automation.update");
    expect(
      parseAutomationCommandResult("automation.schedule.preview", {
        occurrences: ["2026-08-30T01:00:00.000Z"],
      }),
    ).toEqual({ occurrences: ["2026-08-30T01:00:00.000Z"] });
  });
});
