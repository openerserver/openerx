/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test";

import {
  mapLifecycleStatusToPublicTaskStatus,
  normalizePublicTaskStatusValue,
  resolvePublicTaskStatus,
} from "../../control-plane/service/src/modules/tasks/public-task-status";

describe("public task status", () => {
  test("normalizes execution-style values into public task statuses", () => {
    expect(normalizePublicTaskStatusValue("complete")).toBe("completed");
    expect(normalizePublicTaskStatusValue("completed")).toBe("completed");
    expect(normalizePublicTaskStatusValue("queued")).toBe("pending");
    expect(normalizePublicTaskStatusValue("pending")).toBe("pending");
    expect(normalizePublicTaskStatusValue("awaiting_adoption")).toBe("awaiting_adoption");
  });

  test("maps lifecycle values into public task statuses", () => {
    expect(mapLifecycleStatusToPublicTaskStatus("done")).toBe("completed");
    expect(mapLifecycleStatusToPublicTaskStatus("active")).toBe("running");
    expect(mapLifecycleStatusToPublicTaskStatus("archived")).toBe("cancelled");
    expect(mapLifecycleStatusToPublicTaskStatus("draft")).toBe("pending");
  });

  test("prefers normalized execution status, then fallback status, then lifecycle", () => {
    expect(
      resolvePublicTaskStatus({
        currentExecutionStatus: "complete",
        lifecycleStatus: "active",
        fallbackStatus: "running",
      }),
    ).toBe("completed");

    expect(
      resolvePublicTaskStatus({
        currentExecutionStatus: "mystery",
        fallbackStatus: "awaiting_adoption",
        lifecycleStatus: "done",
      }),
    ).toBe("awaiting_adoption");

    expect(
      resolvePublicTaskStatus({
        currentExecutionStatus: null,
        fallbackStatus: null,
        lifecycleStatus: "active",
      }),
    ).toBe("running");
  });
});