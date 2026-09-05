import { automationRunSchema } from "@openerx/contracts";
import { describe, expect, it } from "vitest";
import { automationNotificationContent } from "../src/main/automation-notification";

function run(status: "running" | "succeeded" | "failed" | "needs_attention" | "missed") {
  return automationRunSchema.parse({
    id: "00000000-0000-4000-8000-000000000010",
    automationId: "00000000-0000-4000-8000-000000000001",
    scheduledFor: "2026-08-30T01:00:00.000Z",
    trigger: "schedule",
    status,
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
    failureCode: status === "failed" ? "AUTOMATION_DISPATCH_FAILED" : null,
    actionRequired: status === "needs_attention",
    createdAt: "2026-08-30T01:00:00.000Z",
    startedAt: "2026-08-30T01:00:00.000Z",
    finishedAt: status === "running" ? null : "2026-08-30T01:01:00.000Z",
  });
}

describe("automationNotificationContent", () => {
  it("notifies only user-relevant terminal states", () => {
    expect(automationNotificationContent(run("running"))).toBeNull();
    expect(automationNotificationContent(run("succeeded"))?.title).toBe("自动化已完成");
    expect(automationNotificationContent(run("needs_attention"))?.title).toBe("自动化需要处理");
    expect(automationNotificationContent(run("failed"))?.body).toContain(
      "AUTOMATION_DISPATCH_FAILED",
    );
    expect(automationNotificationContent(run("missed"))?.title).toBe("自动化已错过");
  });
});
