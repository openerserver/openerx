import { useTaskRuntimePermissionActions } from "./useTaskRuntimePermissionActions";
import { useTaskRuntimePermissionView } from "./useTaskRuntimePermissionView";

export function useTaskRuntimePermissionFeature(args: {
  taskId: Parameters<typeof useTaskRuntimePermissionView>[0]["taskId"];
  task: Parameters<typeof useTaskRuntimePermissionView>[0]["task"];
  selectedSessionId: Parameters<typeof useTaskRuntimePermissionView>[0]["selectedSessionId"];
  refreshTaskSnapshot: Parameters<typeof useTaskRuntimePermissionActions>[0]["refreshTaskSnapshot"];
}) {
  const runtimePermissionView = useTaskRuntimePermissionView({
    taskId: args.taskId,
    task: args.task,
    selectedSessionId: args.selectedSessionId,
  });
  const runtimePermissionActions = useTaskRuntimePermissionActions({
    taskId: args.taskId,
    refreshTaskSnapshot: args.refreshTaskSnapshot,
    refreshRuntimePermissions: runtimePermissionView.refreshRuntimePermissions,
  });

  return {
    ...runtimePermissionView,
    ...runtimePermissionActions,
  };
}