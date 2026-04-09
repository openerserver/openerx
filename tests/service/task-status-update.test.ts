/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test";
import {
  buildTaskUpdates,
  updateStatusSchema,
} from "../../control-plane/service/src/modules/tasks/task-status-update";

describe("task status update", () => {
  test("accepts awaiting_adoption as a valid task status", () => {
    const parsed = updateStatusSchema.parse({ status: "awaiting_adoption" });

    expect(parsed.status).toBe("awaiting_adoption");
  });

  test("keeps awaiting_adoption as a non-terminal task status", () => {
    const updates = buildTaskUpdates(
      { status: "awaiting_adoption" },
      { startedAt: "2026-04-08T03:18:17.218Z" },
    );

    expect(updates).toMatchObject({
      status: "awaiting_adoption",
      finishedAt: null,
    });
  });
});