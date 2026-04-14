import { message } from "ant-design-vue";
import type { Ref } from "vue";
import {
  adoptParallelCandidate,
  type ProjectionRunRecord,
  type TaskExecutionReconcileEnvelope,
} from "../lib/api";

function resolveParallelPhaseId(currentRun: ProjectionRunRecord | null): string | undefined {
  const parallelRunId = currentRun?.parallelRunId;
  return (
    currentRun?.phaseId ??
    (parallelRunId?.startsWith("task-session:")
      ? parallelRunId.slice("task-session:".length)
      : parallelRunId?.startsWith("tree-fallback:")
        ? parallelRunId.slice("tree-fallback:".length)
        : undefined)
  );
}

export function useTaskParallelCandidateActions(args: {
  taskId: Ref<string>;
  currentParallelRunRecord: Ref<ProjectionRunRecord | null>;
  refreshTaskSnapshot: (options?: { workflow?: boolean; flow?: boolean; messages?: boolean }) =>
    | void
    | Promise<void>;
  reconcileExecutionEnvelope: (envelope?: TaskExecutionReconcileEnvelope | null) =>
    | void
    | Promise<void>;
}) {
  async function handleAdoptCandidate(index: number) {
    if (!args.taskId.value) return;

    try {
      const phaseId = resolveParallelPhaseId(args.currentParallelRunRecord.value);
      if (!phaseId) {
        message.warning("当前并行运行缺少 phaseId，无法采纳候选结果");
        return;
      }

      const result = await adoptParallelCandidate(args.taskId.value, phaseId, index);
      message.success("已采纳候选结果");
      await args.reconcileExecutionEnvelope(result.execution);
    } catch (err) {
      message.error(err instanceof Error ? err.message : "采纳候选失败");
    }
  }

  return {
    handleAdoptCandidate,
  };
}