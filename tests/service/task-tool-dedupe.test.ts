/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test";

import {
  normalizeTaskToolIdentity,
  resolveTaskToolIdentity,
} from "../../control-plane/service/src/modules/tasks/task-tool-dedupe";

describe("task tool dedupe helpers", () => {
  test("normalizeTaskToolIdentity strips runtime session and tool prefixes", () => {
    expect(normalizeTaskToolIdentity("runtime-1:tool:call-1", "runtime-1")).toBe("call-1");
    expect(normalizeTaskToolIdentity("tool:call-1", "runtime-1")).toBe("call-1");
  });

  test("resolveTaskToolIdentity reads shared candidate fields from identity sources", () => {
    expect(
      resolveTaskToolIdentity({
        runtimeSessionId: "runtime-1",
        identitySources: [{ callId: "runtime-1:tool:call-2" }],
        runtimeCandidates: [null],
      }),
    ).toBe("call-2");

    expect(
      resolveTaskToolIdentity({
        runtimeSessionId: "runtime-1",
        identitySources: [{ toolCallId: "call-3" }, { messageID: "tool:call-4" }],
        runtimeCandidates: [null],
      }),
    ).toBe("call-3");
  });

  test("resolveTaskToolIdentity falls back to runtime candidates when structured fields are absent", () => {
    expect(
      resolveTaskToolIdentity({
        runtimeSessionId: "runtime-1",
        identitySources: [{}],
        runtimeCandidates: ["runtime-1:tool:call-5"],
      }),
    ).toBe("call-5");
  });
});