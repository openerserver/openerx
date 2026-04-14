import { watch, type Ref } from "vue";
import type { TaskDetailRefreshRequest } from "../lib/task-detail-refresh-policy";
import type { TreeTask } from "./useProjectTreeTask";

export function useTaskDetailTaskStatusSync(args: {
  latestTaskRefreshRequest: Ref<TaskDetailRefreshRequest | null>;
  task: Ref<TreeTask | null>;
  getCurrentTimestamp?: () => string;
}) {
  const getCurrentTimestamp = args.getCurrentTimestamp ?? (() => new Date().toISOString());

  watch(
    () => args.latestTaskRefreshRequest.value?.eventId,
    () => {
      const refreshRequest = args.latestTaskRefreshRequest.value;
      const currentTask = args.task.value;
      if (!refreshRequest || !currentTask) {
        return;
      }

      if (refreshRequest.reason === "task-completed") {
        args.task.value = {
          ...currentTask,
          status: "completed",
          finishedAt: currentTask.finishedAt ?? getCurrentTimestamp(),
        };
        return;
      }

      if (refreshRequest.reason === "task-failed") {
        args.task.value = {
          ...currentTask,
          status: "failed",
          finishedAt: currentTask.finishedAt ?? getCurrentTimestamp(),
        };
        return;
      }

      if (refreshRequest.reason === "task-continued") {
        args.task.value = {
          ...currentTask,
          status: "running",
          finishedAt: undefined,
        };
      }
    },
  );
}