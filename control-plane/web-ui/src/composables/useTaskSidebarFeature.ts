import { computed, ref, watch, type Ref } from "vue";
import type { TreeTask } from "./useProjectTreeTask";
import { useTaskFilePreviewPanel } from "./useTaskFilePreviewPanel";
import { useTaskMemberPanel } from "./useTaskMemberPanel";
import { useTaskMemberViewFeature } from "./useTaskMemberViewFeature";
import { useTaskTracePanel } from "./useTaskTracePanel";

type PreviewFilePayload = { filePath: string; content?: string };

export function useTaskSidebarFeature(args: {
  selectedSessionId: Ref<string | undefined>;
  task: Ref<TreeTask | null | undefined>;
  taskId: Ref<string>;
  traceRefreshKey: Ref<number>;
}) {
  const collapsed = ref(true);
  const previewFile = ref<PreviewFilePayload | null>(null);
  const resolvedTaskId = computed(() => args.task.value?.id ?? args.taskId.value);
  const memberFeature = useTaskMemberViewFeature({ taskId: args.taskId });

  function handleOpenFilePreview(payload: PreviewFilePayload) {
    previewFile.value = payload;
    collapsed.value = false;
  }

  function handleCloseFilePreview() {
    previewFile.value = null;
  }

  function toggleSidebar() {
    collapsed.value = !collapsed.value;
  }

  watch(
    args.taskId,
    () => {
      previewFile.value = null;
    },
    { immediate: false },
  );

  const filePreviewPanel = useTaskFilePreviewPanel({
    previewFile,
    handleCloseFilePreview,
  });
  const memberPanel = useTaskMemberPanel({
    memberView: memberFeature.memberView,
    memberViewLoading: memberFeature.memberViewLoading,
  });
  const tracePanel = useTaskTracePanel({
    selectedSessionId: args.selectedSessionId,
    taskId: resolvedTaskId,
    traceRefreshKey: args.traceRefreshKey,
  });

  return {
    collapsed,
    handleCloseFilePreview,
    handleOpenFilePreview,
    loadInitialMemberViewSnapshot: memberFeature.loadInitialMemberViewSnapshot,
    memberReconcileRequired: memberFeature.memberReconcileRequired,
    previewFile,
    refreshMemberViewSnapshot: memberFeature.refreshMemberViewSnapshot,
    resetMemberViewState: memberFeature.resetMemberViewState,
    selectedSessionId: args.selectedSessionId,
    taskId: resolvedTaskId,
    toggleSidebar,
    ...filePreviewPanel,
    ...memberPanel,
    ...tracePanel,
    filePreviewPanel,
    memberPanel,
    tracePanel,
  };
}