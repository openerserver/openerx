/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test";
import { shouldReplaceTraceTimeline } from "../../control-plane/web-ui-bff/src/modules/tasks/task-session-store";

describe("task session store", () => {
  test("does not replace a non-empty projection timeline with a longer fallback timeline", () => {
    expect(
      shouldReplaceTraceTimeline({
        currentItemCount: 2,
        fallbackItemCount: 5,
        projectionComplete: false,
      }),
    ).toBe(false);
  });

  test("replaces the timeline only when projection is empty and fallback has items", () => {
    expect(
      shouldReplaceTraceTimeline({
        currentItemCount: 0,
        fallbackItemCount: 3,
        projectionComplete: false,
      }),
    ).toBe(true);
  });
});