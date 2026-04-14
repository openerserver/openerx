import type { TaskMemberViewModel } from "../lib/api";
import type { Ref } from "vue";

export function useTaskMemberPanel(args: {
  memberView: Ref<TaskMemberViewModel | null>;
  memberViewLoading: Ref<boolean>;
}) {
  return {
    memberView: args.memberView,
    memberViewLoading: args.memberViewLoading,
  };
}