import { computed, type Ref, type UnwrapNestedRefs } from "vue";
import type { TaskMemberViewModel } from "../lib/api";

type PreviewFilePayload = {
  filePath: string;
  content?: string;
};

export function useTaskDetailSidebarPaneFeature(args: {
  collapsed: Ref<boolean>;
  filePreview: {
    handleCloseFilePreview: () => void;
    previewFile: Ref<PreviewFilePayload | null>;
  };
  member: {
    memberView: Ref<TaskMemberViewModel | null>;
    memberViewLoading: Ref<boolean>;
  };
  trace: {
    selectedSessionId: Ref<string | undefined>;
    taskId: Ref<string>;
    traceRefreshKey: Ref<number>;
  };
  toggleSidebar: () => void;
}) {
  const showSidebarContent = computed(() => !args.collapsed.value);
  const showFilePreview = computed(() => Boolean(args.filePreview.previewFile.value));
  const showMemberPanel = computed(
    () => args.member.memberViewLoading.value || Boolean(args.member.memberView.value),
  );

  return {
    collapsed: args.collapsed,
    handleCloseFilePreview: args.filePreview.handleCloseFilePreview,
    memberView: args.member.memberView,
    memberViewLoading: args.member.memberViewLoading,
    previewFile: args.filePreview.previewFile,
    selectedSessionId: args.trace.selectedSessionId,
    showFilePreview,
    showMemberPanel,
    showSidebarContent,
    taskId: args.trace.taskId,
    toggleSidebar: args.toggleSidebar,
    traceRefreshKey: args.trace.traceRefreshKey,
  };
}

export type TaskDetailSidebarPaneFeatureState = UnwrapNestedRefs<
  ReturnType<typeof useTaskDetailSidebarPaneFeature>
>;