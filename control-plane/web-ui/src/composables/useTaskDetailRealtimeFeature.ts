import { useTaskDetailPollingState } from "./useTaskDetailDerivedState";
import { useTaskDetailRefreshController } from "./useTaskDetailRefreshController";

type PollingArgs = Parameters<typeof useTaskDetailPollingState>[0];
type SubscriptionArgs = Omit<Parameters<typeof useTaskDetailRefreshController>[0], "shouldPollRunningStatus">;

export function useTaskDetailRealtimeFeature(args: {
  polling: PollingArgs;
  subscription: SubscriptionArgs;
}) {
  const { shouldPollRunningStatus } = useTaskDetailPollingState(args.polling);
  const subscription = useTaskDetailRefreshController({
    ...args.subscription,
    shouldPollRunningStatus,
  });

  return {
    shouldPollRunningStatus,
    ...subscription,
  };
}