import { message } from "ant-design-vue";
import { type Ref, ref } from "vue";
import { replyTaskRuntimePermission, type TaskRuntimePermission } from "../lib/api";

export function useTaskRuntimePermissionActions(args: {
  taskId: Ref<string>;
  refreshTaskSnapshot: (options?: { workflow?: boolean; flow?: boolean; messages?: boolean }) =>
    | void
    | Promise<void>;
  refreshRuntimePermissions: (silent?: boolean) => void | Promise<void>;
}) {
  const runtimePermissionActionId = ref<string | null>(null);

  async function handleReplyRuntimePermission(
    permission: TaskRuntimePermission,
    reply: "once" | "always" | "reject",
  ) {
    if (!args.taskId.value) return;

    runtimePermissionActionId.value = `${permission.id}:${reply}`;
    try {
      await replyTaskRuntimePermission(args.taskId.value, permission.id, { reply });
      message.success(
        reply === "reject"
          ? "已拒绝运行时审批"
          : reply === "always"
            ? permission.permission === "command_execution"
              ? "已永久允许该命令执行"
              : permission.permission === "external_directory"
                ? "已永久允许该目录访问"
                : "已永久允许该权限"
            : "已允许本次访问",
      );
      await args.refreshRuntimePermissions(true);
      await args.refreshTaskSnapshot({ messages: true, workflow: true, flow: true });
    } catch (err) {
      message.error(err instanceof Error ? err.message : "处理运行时审批失败");
    } finally {
      runtimePermissionActionId.value = null;
    }
  }

  return {
    handleReplyRuntimePermission,
    runtimePermissionActionId,
  };
}