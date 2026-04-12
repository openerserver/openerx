import { computed, watch, type Ref } from "vue";
import type { useRoute, useRouter } from "vue-router";
import type { TaskSessionRecord } from "../lib/api";
import type { TreeTask } from "./useProjectTreeTask";

export function useTaskDetailPageCoordinator(args: {
  taskId: Ref<string>;
  selectedSessionId: Ref<string | undefined>;
  task: Ref<TreeTask | null | undefined>;
  projectId: Ref<string | null | undefined>;
  taskSessionSummaries: Ref<TaskSessionRecord[]>;
  route: ReturnType<typeof useRoute>;
  router: ReturnType<typeof useRouter>;
  realtimeConnected: Ref<boolean>;
  subscribeTask: (taskId: string) => void;
  subscribeProject: (projectId: string) => void;
  resetSnapshotState: () => void;
  resetSequentialStepState: () => void;
  loadInitialSnapshot: () => void | Promise<void>;
}) {
  const canForkFromCurrentSession = computed(() =>
    Boolean(args.selectedSessionId.value || args.task.value?.sessionId),
  );

  function resolveTaskSessionRequestId(sessionId?: string | null) {
    if (!sessionId) {
      return undefined;
    }

    const matchedSummary = args.taskSessionSummaries.value.find(
      (summary) => summary.id === sessionId || summary.taskSessionId === sessionId,
    );
    return matchedSummary?.taskSessionId ?? sessionId;
  }

  function stripLegacySessionQueryFromRoute() {
    if (!args.taskId.value || !Object.prototype.hasOwnProperty.call(args.route.query, "session")) {
      return;
    }

    const { session: _session, ...queryWithoutSession } = args.route.query;
    void args.router.replace({
      name: "TaskDetailV3",
      params: { taskId: args.taskId.value },
      query: queryWithoutSession,
    });
  }

  function handleTaskSwitch(nextTaskId: string) {
    void args.router.replace({ name: "TaskDetailV3", params: { taskId: nextTaskId } });
  }

  watch(
    args.taskId,
    () => {
      args.selectedSessionId.value = undefined;
      args.resetSnapshotState();
      args.resetSequentialStepState();
    },
    { immediate: false },
  );

  watch(
    () => args.task.value?.id,
    (newId) => {
      if (newId && newId === args.taskId.value) {
        void args.loadInitialSnapshot();
      }
    },
    { immediate: true },
  );

  watch(
    () => args.route.query.session,
    () => {
      stripLegacySessionQueryFromRoute();
    },
    { immediate: true },
  );

  watch(
    args.realtimeConnected,
    (connected) => {
      if (connected && args.taskId.value) {
        args.subscribeTask(args.taskId.value);
        if (args.projectId.value) {
          args.subscribeProject(args.projectId.value);
        }
      }
    },
    { immediate: true },
  );

  return {
    canForkFromCurrentSession,
    handleTaskSwitch,
    resolveTaskSessionRequestId,
  };
}