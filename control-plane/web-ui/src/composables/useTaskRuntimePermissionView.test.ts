import { flushPromises } from "@vue/test-utils";
import { effectScope, ref } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TreeTask } from "./useProjectTreeTask";
import { useTaskRuntimePermissionView } from "./useTaskRuntimePermissionView";

const listTaskRuntimePermissionsMock = vi.hoisted(() => vi.fn());

vi.mock("../lib/api", () => ({
  listTaskRuntimePermissions: listTaskRuntimePermissionsMock,
}));

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

function createTask(overrides: Partial<TreeTask> = {}): TreeTask {
  return {
    id: "task-1",
    projectId: "project-1",
    userId: null,
    title: "Task 1",
    prompt: "prompt",
    status: "running",
    createdAt: "2026-04-11T00:00:00.000Z",
    nodeId: "node-1",
    ...overrides,
  };
}

describe("useTaskRuntimePermissionView", () => {
  let scope: ReturnType<typeof effectScope> | null = null;

  beforeEach(() => {
    listTaskRuntimePermissionsMock.mockReset();
  });

  afterEach(() => {
    scope?.stop();
    scope = null;
  });

  function mountFeature() {
    const taskId = ref("task-1");
    const task = ref<TreeTask | null>(createTask());
    const selectedSessionId = ref<string | undefined>("parent-1");

    scope = effectScope();
    const feature = scope.run(() =>
      useTaskRuntimePermissionView({
        taskId,
        task,
        selectedSessionId,
      }),
    );
    if (!feature) {
      throw new Error("expected runtime permission view");
    }

    return {
      feature,
      selectedSessionId,
      task,
      taskId,
    };
  }

  it("keeps the latest session runtime permissions when an older request resolves last", async () => {
    const firstRefresh = createDeferred<{ data: Array<any> }>();
    const secondRefresh = createDeferred<{ data: Array<any> }>();

    listTaskRuntimePermissionsMock
      .mockImplementationOnce(() => firstRefresh.promise)
      .mockImplementationOnce(() => secondRefresh.promise);

    const { feature, selectedSessionId } = mountFeature();

    void feature.refreshRuntimePermissions(true);

    selectedSessionId.value = "child-1";

    secondRefresh.resolve({
      data: [
        {
          id: "perm-child",
          sessionId: "child-1",
          permission: "command_execution",
          patterns: [],
          metadata: null,
          always: [],
          tool: null,
        },
      ],
    });

    await flushPromises();
    expect(feature.selectedSessionRuntimePermissions.value.map((item) => item.id)).toEqual([
      "perm-child",
    ]);

    firstRefresh.resolve({
      data: [
        {
          id: "perm-parent",
          sessionId: "parent-1",
          permission: "command_execution",
          patterns: [],
          metadata: null,
          always: [],
          tool: null,
        },
      ],
    });

    await flushPromises();
    expect(feature.selectedSessionRuntimePermissions.value.map((item) => item.id)).toEqual([
      "perm-child",
    ]);
  });

  it("exposes runtime permission labels, paths and patterns", () => {
    const { feature } = mountFeature();
    const permission = {
      id: "perm-1",
      sessionId: "parent-1",
      permission: "external_directory",
      patterns: ["src/**"],
      metadata: { parentDir: "/tmp/workspace" },
      always: [],
      tool: null,
    } as any;

    expect(feature.runtimePermissionLabel(permission.permission)).toBe("外部目录访问");
    expect(feature.runtimePermissionPath(permission)).toBe("/tmp/workspace");
    expect(feature.runtimePermissionPatterns(permission)).toEqual(["src/**"]);
  });

  it("falls back to the task session when no explicit session is selected", async () => {
    listTaskRuntimePermissionsMock.mockResolvedValue({
      data: [
        {
          id: "perm-task-session",
          sessionId: "task-session-1",
          permission: "command_execution",
          patterns: [],
          metadata: null,
          always: [],
          tool: null,
        },
      ],
    });

    const { feature, selectedSessionId, task } = mountFeature();
    selectedSessionId.value = undefined;
    task.value = createTask({ sessionId: "task-session-1" });

    await flushPromises();

    expect(listTaskRuntimePermissionsMock).toHaveBeenLastCalledWith("task-1", "task-session-1");
    expect(feature.selectedSessionRuntimePermissions.value.map((item) => item.id)).toEqual([
      "perm-task-session",
    ]);
  });
});