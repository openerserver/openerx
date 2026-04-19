import { effectScope, ref } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useTaskMemberViewFeature } from "./useTaskMemberViewFeature";

const getTaskMemberViewMock = vi.hoisted(() => vi.fn());

vi.mock("../lib/api", () => ({
  getTaskMemberView: getTaskMemberViewMock,
}));

describe("useTaskMemberViewFeature", () => {
  let scope: ReturnType<typeof effectScope> | null = null;

  beforeEach(() => {
    getTaskMemberViewMock.mockReset();
    getTaskMemberViewMock.mockResolvedValue({
      meta: {
        snapshotVersion: 8,
        reconcileRequired: false,
      },
      members: [{ id: "member-1" }],
    });
  });

  afterEach(() => {
    scope?.stop();
    scope = null;
  });

  function mountFeature() {
    const taskId = ref("task-1");

    scope = effectScope();
    const feature = scope.run(() => useTaskMemberViewFeature({ taskId }));
    if (!feature) {
      throw new Error("expected task member view feature");
    }

    return {
      feature,
      taskId,
    };
  }

  it("refreshes the member snapshot for the current task", async () => {
    const { feature } = mountFeature();

    await feature.refreshMemberViewSnapshot();

    expect(getTaskMemberViewMock).toHaveBeenCalledWith("task-1");
    expect(feature.memberView.value).toEqual({
      meta: { snapshotVersion: 8, reconcileRequired: false },
      members: [{ id: "member-1" }],
    });
    expect(feature.memberReconcileRequired.value).toBe(false);
  });

  it("keeps newer member snapshots when an older response arrives later", async () => {
    const { feature } = mountFeature();

    feature.memberView.value = {
      meta: { snapshotVersion: 9, reconcileRequired: false },
      members: [{ id: "member-new" }],
    } as never;

    getTaskMemberViewMock.mockResolvedValueOnce({
      meta: { snapshotVersion: 7, reconcileRequired: false },
      members: [{ id: "member-old" }],
    });

    await feature.refreshMemberViewSnapshot();

    expect(feature.memberView.value).toEqual({
      meta: { snapshotVersion: 9, reconcileRequired: false },
      members: [{ id: "member-new" }],
    });
  });

  it("keeps a complete snapshot when an equal-version partial response arrives later", async () => {
    const { feature } = mountFeature();

    feature.memberView.value = {
      meta: { snapshotVersion: 8, reconcileRequired: false },
      members: [{ id: "member-new" }],
    } as never;

    getTaskMemberViewMock.mockResolvedValueOnce({
      meta: { snapshotVersion: 8, reconcileRequired: true },
      members: [{ id: "member-partial" }],
    });

    await feature.refreshMemberViewSnapshot();

    expect(feature.memberView.value).toEqual({
      meta: { snapshotVersion: 8, reconcileRequired: false },
      members: [{ id: "member-new" }],
    });
  });

  it("exposes reconcile required when the member snapshot is partial", async () => {
    const { feature } = mountFeature();

    getTaskMemberViewMock.mockResolvedValueOnce({
      meta: { snapshotVersion: 9, reconcileRequired: true },
      members: [{ id: "member-partial" }],
    });

    await feature.refreshMemberViewSnapshot();

    expect(feature.memberReconcileRequired.value).toBe(true);
  });

  it("loads the initial member snapshot and clears loading state", async () => {
    const { feature } = mountFeature();

    await feature.loadInitialMemberViewSnapshot();

    expect(getTaskMemberViewMock).toHaveBeenCalledWith("task-1");
    expect(feature.memberViewLoading.value).toBe(false);
  });

  it("resets member snapshot state", async () => {
    const { feature } = mountFeature();

    await feature.refreshMemberViewSnapshot();
    feature.resetMemberViewState();

    expect(feature.memberView.value).toBeNull();
    expect(feature.memberViewLoading.value).toBe(false);
  });
});