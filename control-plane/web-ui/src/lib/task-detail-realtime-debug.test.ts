import { describe, expect, it } from "vitest";
import type { TaskDetailRefreshRequest } from "./task-detail-refresh-policy";
import { summarizeTaskRefreshRequest } from "./task-detail-realtime-debug";

describe("summarizeTaskRefreshRequest", () => {
  it("returns null when given nothing", () => {
    expect(summarizeTaskRefreshRequest(null)).toBeNull();
    expect(summarizeTaskRefreshRequest(undefined)).toBeNull();
  });

  it("propagates phaseId so phase-scoped refresh can be traced downstream", () => {
    const request: TaskDetailRefreshRequest = {
      eventId: "event-phase-a",
      reason: "phase-resumed",
      phaseId: "phase-42",
      targets: { workflow: false, flow: true, messages: false },
      shouldBumpTraceRefreshKey: false,
    };

    expect(summarizeTaskRefreshRequest(request)).toEqual({
      eventId: "event-phase-a",
      reason: "phase-resumed",
      phaseId: "phase-42",
      targets: { workflow: false, flow: true, messages: false },
      shouldBumpTraceRefreshKey: false,
    });
  });

  it("leaves phaseId undefined when the refresh request has no phase context", () => {
    const request: TaskDetailRefreshRequest = {
      eventId: "event-session-a",
      reason: "task-reconcile-required",
      targets: { workflow: true, flow: true, messages: true },
      shouldBumpTraceRefreshKey: false,
    };

    const summary = summarizeTaskRefreshRequest(request);
    expect(summary?.phaseId).toBeUndefined();
  });
});
