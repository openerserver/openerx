import { useTaskConversationActions } from "./useTaskConversationActions";
import { useTaskConversationPresentationFeature } from "./useTaskConversationPresentationFeature";
import { useTaskConversationRoundActions } from "./useTaskConversationRoundActions";

type TaskConversationFeatureBaseArgs = {
  messageTrace: Parameters<typeof useTaskConversationPresentationFeature>[0]["messageTrace"];
  selectedSessionId: Parameters<typeof useTaskConversationPresentationFeature>[0]["selectedSessionId"];
  selectedSessionNode: Parameters<typeof useTaskConversationPresentationFeature>[0]["selectedSessionNode"];
  task: Parameters<typeof useTaskConversationPresentationFeature>[0]["task"];
  taskSessionSummaries: Parameters<typeof useTaskConversationPresentationFeature>[0]["taskSessionSummaries"];
};

type TaskConversationActionArgs = Omit<
  Parameters<typeof useTaskConversationActions>[0],
  "selectedSessionLabel" | "bumpConversationFocus" | "handleSwitchRound" | "resolveTaskSessionRequestId"
>;

export function useTaskConversationFeature(
  args: TaskConversationFeatureBaseArgs,
): ReturnType<typeof useTaskConversationPresentationFeature> &
  ReturnType<typeof useTaskConversationRoundActions>;
export function useTaskConversationFeature(
  args: TaskConversationFeatureBaseArgs & { actionArgs: TaskConversationActionArgs },
): ReturnType<typeof useTaskConversationPresentationFeature> &
  ReturnType<typeof useTaskConversationRoundActions> &
  ReturnType<typeof useTaskConversationActions>;

export function useTaskConversationFeature(
  args: TaskConversationFeatureBaseArgs & { actionArgs?: TaskConversationActionArgs },
) {
  const presentation = useTaskConversationPresentationFeature({
    task: args.task,
    taskSessionSummaries: args.taskSessionSummaries,
    selectedSessionId: args.selectedSessionId,
    selectedSessionNode: args.selectedSessionNode,
    messageTrace: args.messageTrace,
  });
  const rounds = useTaskConversationRoundActions({
    task: args.task,
    taskSessionSummaries: args.taskSessionSummaries,
    selectedSessionId: args.selectedSessionId,
  });
  const actions = args.actionArgs
    ? useTaskConversationActions({
        ...args.actionArgs,
        selectedSessionLabel: presentation.selectedSessionLabel,
        bumpConversationFocus: rounds.bumpConversationFocus,
        handleSwitchRound: rounds.handleSwitchRound,
        resolveTaskSessionRequestId: rounds.resolveTaskSessionRequestId,
      })
    : null;

  return {
    ...presentation,
    ...rounds,
    ...(actions ?? {}),
  };
}