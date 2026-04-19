/// <reference types="bun-types" />

import { afterEach, describe, expect, mock, test } from "bun:test";

import { buildTaskSessionRegistrations } from "../../control-plane/service/src/modules/tasks/task-route-session-registrations";

afterEach(() => {
  mock.restore();
});

describe("task route session registrations", () => {
  test("phase view registration adapts route args to the session read API signature", async () => {
    const getTaskPhaseView = mock(async (taskId: string, phaseId: string) => ({
      ok: true as const,
      status: 200 as const,
      data: { taskId, phaseId },
    }));

    const registrations = buildTaskSessionRegistrations({
      branchWriteApi: {},
      sessionMessageApi: {},
      phaseWriteApi: {},
      sessionReadApi: {
        getTaskPhaseView,
      },
    } as never);

    const response = await registrations.getTaskPhaseView({
      taskId: "task-1",
      phaseId: "phase-compare",
    });

    expect(getTaskPhaseView).toHaveBeenCalledWith("task-1", "phase-compare");
    expect(response).toEqual({
      ok: true,
      status: 200,
      data: {
        taskId: "task-1",
        phaseId: "phase-compare",
      },
    });
  });
});