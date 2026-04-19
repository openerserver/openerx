import { describe, expect, it } from "bun:test";
import {
  buildPublicTaskExecutionPhaseRecord,
  buildPublicTaskExecutionPhaseSummary,
  groupTaskSessionIdsByPhaseId,
} from "../../control-plane/service/src/modules/tasks/task-phase-public-record";

function createPhase(overrides: Record<string, unknown> = {}) {
  return {
    id: "phase-1",
    taskId: "task-1",
    projectId: "proj-1",
    parentPhaseId: null,
    phaseIndex: 2,
    phaseKind: "parallel",
    triggerType: "user",
    status: "awaiting_adoption",
    resumedFromPhaseId: null,
    awaitingAdoptionSince: "2026-04-16T10:00:00.000Z",
    cancelRequestedAt: null,
    cancelledAt: null,
    terminalReason: null,
    lastHeartbeatAt: "2026-04-16T10:01:00.000Z",
    anchorSessionId: "session-anchor",
    anchorMessageId: "msg-anchor",
    candidateCount: 3,
    winnerSessionId: null,
    judgeSessionId: null,
    requestedModel: "gpt-5",
    effectiveModel: "gpt-5",
    resultSummary: null,
    errorText: null,
    startedAt: "2026-04-16T09:59:00.000Z",
    finishedAt: null,
    createdAt: "2026-04-16T09:59:00.000Z",
    updatedAt: "2026-04-16T10:01:30.000Z",
    ...overrides,
  } as Parameters<typeof buildPublicTaskExecutionPhaseRecord>[0]["phase"];
}

describe("buildPublicTaskExecutionPhaseRecord", () => {
  it("exposes the full public phase record including session ids", () => {
    const record = buildPublicTaskExecutionPhaseRecord({
      phase: createPhase(),
      sessionIds: ["ses-1", "ses-2"],
    });

    expect(record.id).toBe("phase-1");
    expect(record.phaseIndex).toBe(2);
    expect(record.phaseKind).toBe("parallel");
    expect(record.status).toBe("awaiting_adoption");
    expect(record.sessionIds).toEqual(["ses-1", "ses-2"]);
    expect(record.coordinationKey).toBeNull();
  });
});

describe("buildPublicTaskExecutionPhaseSummary", () => {
  it("returns only the phase-first minimal identity contract fields", () => {
    const summary = buildPublicTaskExecutionPhaseSummary(createPhase({ winnerSessionId: "ses-winner" }));

    expect(summary).toEqual({
      id: "phase-1",
      phaseIndex: 2,
      phaseKind: "parallel",
      status: "awaiting_adoption",
      anchorSessionId: "session-anchor",
      winnerSessionId: "ses-winner",
      candidateCount: 3,
      updatedAt: "2026-04-16T10:01:30.000Z",
    });
  });

  it("does not leak the richer record fields (phase identity contract is strictly minimal)", () => {
    const summary = buildPublicTaskExecutionPhaseSummary(createPhase());
    const keys = Object.keys(summary).sort();
    expect(keys).toEqual(
      [
        "anchorSessionId",
        "candidateCount",
        "id",
        "phaseIndex",
        "phaseKind",
        "status",
        "updatedAt",
        "winnerSessionId",
      ].sort(),
    );
  });
});

describe("groupTaskSessionIdsByPhaseId", () => {
  it("groups sessions by phaseId and preserves input order within each bucket", () => {
    const grouped = groupTaskSessionIdsByPhaseId([
      { id: "ses-a1", phaseId: "phase-a" },
      { id: "ses-b1", phaseId: "phase-b" },
      { id: "ses-a2", phaseId: "phase-a" },
      { id: "ses-b2", phaseId: "phase-b" },
      { id: "ses-a3", phaseId: "phase-a" },
    ]);

    expect(Array.from(grouped.keys())).toEqual(["phase-a", "phase-b"]);
    expect(grouped.get("phase-a")).toEqual(["ses-a1", "ses-a2", "ses-a3"]);
    expect(grouped.get("phase-b")).toEqual(["ses-b1", "ses-b2"]);
  });

  it("drops sessions with null, empty, or whitespace-only phaseId", () => {
    const grouped = groupTaskSessionIdsByPhaseId([
      { id: "ses-ok", phaseId: "phase-1" },
      { id: "ses-null", phaseId: null },
      { id: "ses-empty", phaseId: "" },
      { id: "ses-spaces", phaseId: "   " },
    ]);

    expect(grouped.size).toBe(1);
    expect(grouped.get("phase-1")).toEqual(["ses-ok"]);
  });

  it("returns an empty Map for an empty input", () => {
    const grouped = groupTaskSessionIdsByPhaseId([]);
    expect(grouped.size).toBe(0);
  });
});
