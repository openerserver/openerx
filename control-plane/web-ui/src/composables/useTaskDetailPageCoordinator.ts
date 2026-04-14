import { computed, watch, type Ref } from "vue";
import type { useRoute, useRouter } from "vue-router";
import type { TreeTask } from "./useProjectTreeTask";

export function useTaskDetailPageCoordinator(args: {
  taskId: Ref<string>;
  task: Ref<TreeTask | null | undefined>;
  projectId: Ref<string | null | undefined>;
  route: ReturnType<typeof useRoute>;
  router: ReturnType<typeof useRouter>;
  realtimeConnected: Ref<boolean>;
  subscribeTask: (taskId: string) => void;
  subscribeProject: (projectId: string) => void;
  resetConversationRound: () => void;
  resetSnapshotState: () => void;
  loadInitialSnapshot: () => void | Promise<void>;
}) {
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
      args.resetConversationRound();
      args.resetSnapshotState();
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
    handleTaskSwitch,
  };
}