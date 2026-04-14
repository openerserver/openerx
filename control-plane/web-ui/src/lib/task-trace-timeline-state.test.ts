import { describe, expect, it } from "vitest";
import {
  isTraceTimelineComplete,
  resolveTraceTimelineAvailability,
} from "./task-trace-timeline-state";

describe("resolveTraceTimelineAvailability", () => {
  it("treats reconcile-required traces with items as partial", () => {
    expect(
      resolveTraceTimelineAvailability({
        reconcileRequired: true,
        complete: false,
        itemCount: 2,
      }),
    ).toBe("partial");
    expect(
      isTraceTimelineComplete({
        reconcileRequired: true,
        complete: false,
        itemCount: 2,
      }),
    ).toBe(false);
  });

  it("treats empty incomplete traces as unavailable", () => {
    expect(
      resolveTraceTimelineAvailability({
        complete: false,
        itemCount: 0,
      }),
    ).toBe("none");
  });

  it("preserves legacy cacheState fallback while callers are cut over", () => {
    expect(
      resolveTraceTimelineAvailability({
        cacheState: "complete",
      }),
    ).toBe("complete");
  });
});