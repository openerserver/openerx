import { ref } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";

const useTaskRuntimePermissionViewMock = vi.fn();
const useTaskRuntimePermissionActionsMock = vi.fn();

vi.mock("./useTaskRuntimePermissionView", () => ({
  useTaskRuntimePermissionView: useTaskRuntimePermissionViewMock,
}));

vi.mock("./useTaskRuntimePermissionActions", () => ({
  useTaskRuntimePermissionActions: useTaskRuntimePermissionActionsMock,
}));

import { useTaskRuntimePermissionFeature } from "./useTaskRuntimePermissionFeature";

describe("useTaskRuntimePermissionFeature", () => {
  beforeEach(() => {
    useTaskRuntimePermissionViewMock.mockReset();
    useTaskRuntimePermissionActionsMock.mockReset();
  });

  it("wires the view refresh into runtime permission actions", () => {
    const refreshRuntimePermissions = vi.fn();
    useTaskRuntimePermissionViewMock.mockReturnValue({
      refreshRuntimePermissions,
      runtimePermissionLabel: vi.fn(),
      runtimePermissionPath: vi.fn(),
      runtimePermissionPatterns: vi.fn(),
      runtimePermissions: ref([]),
      selectedSessionRuntimePermissions: ref([]),
    });
    useTaskRuntimePermissionActionsMock.mockReturnValue({
      handleReplyRuntimePermission: vi.fn(),
      runtimePermissionActionId: ref(null),
    });

    const taskId = ref("task-1");
    const task = ref<any>({ id: "task-1" });
    const selectedSessionId = ref<string | undefined>("session-1");
    const refreshTaskSnapshot = vi.fn();

    const feature = useTaskRuntimePermissionFeature({
      taskId,
      task,
      selectedSessionId,
      refreshTaskSnapshot,
    });

    expect(useTaskRuntimePermissionViewMock).toHaveBeenCalledWith({
      taskId,
      task,
      selectedSessionId,
    });
    expect(useTaskRuntimePermissionActionsMock).toHaveBeenCalledWith({
      taskId,
      refreshTaskSnapshot,
      refreshRuntimePermissions,
    });
    expect(feature.refreshRuntimePermissions).toBe(refreshRuntimePermissions);
  });
});