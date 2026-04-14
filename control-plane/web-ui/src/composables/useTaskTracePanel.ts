import type { Ref } from "vue";

export function useTaskTracePanel(args: {
  selectedSessionId: Ref<string | undefined>;
  taskId: Ref<string>;
  traceRefreshKey: Ref<number>;
}) {
  return {
    selectedSessionId: args.selectedSessionId,
    taskId: args.taskId,
    traceRefreshKey: args.traceRefreshKey,
  };
}