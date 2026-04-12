import { flushPromises } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ref } from "vue";
import type { TreeTask } from "../../control-plane/web-ui/src/composables/useProjectTreeTask";
import { useTaskDetailViewStateCoordinator } from "../../control-plane/web-ui/src/composables/useTaskDetailViewStateCoordinator";

const apiMocks = vi.hoisted(() => ({
  listTaskRuntimePermissions: vi.fn(),
}));

vi.mock("../../control-plane/web-ui/src/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../control-plane/web-ui/src/lib/api")>();
  return {
    ...actual,
    listTaskRuntimePermissions: apiMocks.listTaskRuntimePermissions,
  };
});

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

describe("useTaskDetailViewStateCoordinator", () => {
  beforeEach(() => {
    apiMocks.listTaskRuntimePermissions.mockReset();
  });

  it("keeps the latest session runtime permissions when an older request resolves last", async () => {
    const firstRefresh = createDeferred<{
      data: Array<{
        id: string;
        sessionId: string;
        permission: string;
        patterns: string[];
        metadata: Record<string, unknown> | null;
        always: string[];
        tool: { messageId: string; callId: string } | null;
      }>;
    }>();
    const secondRefresh = createDeferred<{
      data: Array<{
        id: string;
        sessionId: string;
        permission: string;
        patterns: string[];
        metadata: Record<string, unknown> | null;
        always: string[];
        tool: { messageId: string; callId: string } | null;
      }>;
    }>();

    apiMocks.listTaskRuntimePermissions
      .mockImplementationOnce(() => firstRefresh.promise)
      .mockImplementationOnce(() => secondRefresh.promise);

    const taskId = ref("task-1");
    const task = ref<TreeTask | null>(createTask());
    const taskSessionSummaries = ref([]);
    const selectedSessionId = ref<string | undefined>("parent-1");
    const selectedSessionNode = ref(null);
    const messageTrace = ref(null);

    const state = useTaskDetailViewStateCoordinator({
      taskId,
      task,
      taskSessionSummaries,
      selectedSessionId,
      selectedSessionNode,
      messageTrace,
    });

    void state.refreshRuntimePermissions(true);

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
    expect(state.selectedSessionRuntimePermissions.value.map((item) => item.id)).toEqual([
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
    expect(state.selectedSessionRuntimePermissions.value.map((item) => item.id)).toEqual([
      "perm-child",
    ]);
  });
});