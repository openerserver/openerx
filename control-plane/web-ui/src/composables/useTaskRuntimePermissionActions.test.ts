import { effectScope, ref } from "vue";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useTaskRuntimePermissionActions } from "./useTaskRuntimePermissionActions";

const replyTaskRuntimePermissionMock = vi.hoisted(() => vi.fn());
const messageSuccessMock = vi.hoisted(() => vi.fn());
const messageErrorMock = vi.hoisted(() => vi.fn());

vi.mock("ant-design-vue", () => ({
  message: {
    success: messageSuccessMock,
    error: messageErrorMock,
  },
}));

vi.mock("../lib/api", () => ({
  replyTaskRuntimePermission: replyTaskRuntimePermissionMock,
}));

describe("useTaskRuntimePermissionActions", () => {
  let scope: ReturnType<typeof effectScope> | null = null;

  afterEach(() => {
    scope?.stop();
    scope = null;
    replyTaskRuntimePermissionMock.mockReset();
    messageSuccessMock.mockReset();
    messageErrorMock.mockReset();
  });

  function mountActions(taskId = "task-1") {
    const refreshTaskSnapshot = vi.fn(async () => undefined);
    const refreshRuntimePermissions = vi.fn(async () => undefined);

    scope = effectScope();
    const actions = scope.run(() =>
      useTaskRuntimePermissionActions({
        taskId: ref(taskId),
        refreshTaskSnapshot,
        refreshRuntimePermissions,
      }),
    );
    if (!actions) {
      throw new Error("expected runtime permission actions");
    }

    return {
      actions,
      refreshRuntimePermissions,
      refreshTaskSnapshot,
    };
  }

  it("replies runtime permission and refreshes related state", async () => {
    replyTaskRuntimePermissionMock.mockResolvedValue(undefined);
    const permission = {
      id: "perm-1",
      permission: "command_execution",
    } as any;
    const { actions, refreshRuntimePermissions, refreshTaskSnapshot } = mountActions();

    await actions.handleReplyRuntimePermission(permission, "always");

    expect(replyTaskRuntimePermissionMock).toHaveBeenCalledWith("task-1", "perm-1", {
      reply: "always",
    });
    expect(refreshRuntimePermissions).toHaveBeenCalledWith(true);
    expect(refreshTaskSnapshot).toHaveBeenCalledWith({
      messages: true,
      workflow: true,
      flow: true,
    });
    expect(messageSuccessMock).toHaveBeenCalledWith("已永久允许该命令执行");
    expect(actions.runtimePermissionActionId.value).toBeNull();
  });

  it("surfaces runtime permission failures and clears the loading marker", async () => {
    replyTaskRuntimePermissionMock.mockRejectedValue(new Error("boom"));
    const permission = {
      id: "perm-1",
      permission: "external_directory",
    } as any;
    const { actions, refreshRuntimePermissions, refreshTaskSnapshot } = mountActions();

    await actions.handleReplyRuntimePermission(permission, "reject");

    expect(refreshRuntimePermissions).not.toHaveBeenCalled();
    expect(refreshTaskSnapshot).not.toHaveBeenCalled();
    expect(messageErrorMock).toHaveBeenCalledWith("boom");
    expect(actions.runtimePermissionActionId.value).toBeNull();
  });
});