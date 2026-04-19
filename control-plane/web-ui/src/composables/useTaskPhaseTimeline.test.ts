import { describe, expect, it, vi } from "vitest";
import { ref } from "vue";
import { useTaskPhaseTimeline } from "./useTaskPhaseTimeline";

type TestSlice = {
  phase: { id: string };
  label: string;
};

function createSnapshot(slices: TestSlice[]) {
  const refresh = vi.fn().mockResolvedValue(undefined);
  const refreshCurrentPhase = vi.fn().mockResolvedValue(undefined);
  return {
    snapshot: {
      phaseSlices: ref(slices) as unknown as { value: readonly TestSlice[] },
      loading: ref(false),
      error: ref<string | null>(null),
      refresh,
      refreshCurrentPhase,
    },
    refresh,
    refreshCurrentPhase,
  };
}

describe("useTaskPhaseTimeline", () => {
  it("exposes the current phase slice based on currentPhaseId focus", () => {
    const { snapshot } = createSnapshot([
      { phase: { id: "phase-1" }, label: "a" },
      { phase: { id: "phase-2" }, label: "b" },
    ]);
    const currentPhaseId = ref<string | undefined>("phase-2");
    const timeline = useTaskPhaseTimeline({ snapshot: snapshot as never, currentPhaseId });

    expect(timeline.currentPhaseSlice.value?.phase.id).toBe("phase-2");

    currentPhaseId.value = "phase-1";
    expect(timeline.currentPhaseSlice.value?.phase.id).toBe("phase-1");
  });

  it("falls back to the last phase slice when focus does not match any loaded phase", () => {
    const { snapshot } = createSnapshot([
      { phase: { id: "phase-1" }, label: "a" },
      { phase: { id: "phase-2" }, label: "b" },
    ]);
    const currentPhaseId = ref<string | undefined>("phase-unknown");
    const timeline = useTaskPhaseTimeline({ snapshot: snapshot as never, currentPhaseId });

    expect(timeline.currentPhaseSlice.value?.phase.id).toBe("phase-2");
  });

  it("routes refreshPhase to refreshCurrentPhase with the explicit phaseId", async () => {
    const { snapshot, refreshCurrentPhase } = createSnapshot([
      { phase: { id: "phase-1" }, label: "a" },
    ]);
    const timeline = useTaskPhaseTimeline({ snapshot: snapshot as never });

    await timeline.refreshPhase("phase-7", true);

    expect(refreshCurrentPhase).toHaveBeenCalledTimes(1);
    expect(refreshCurrentPhase).toHaveBeenCalledWith(true, "phase-7");
  });

  it("falls back to refresh() when the snapshot does not expose refreshCurrentPhase", async () => {
    const { snapshot, refresh } = createSnapshot([{ phase: { id: "phase-1" }, label: "a" }]);
    const withoutPhaseRefresh = {
      ...snapshot,
      refreshCurrentPhase: undefined,
    };
    const timeline = useTaskPhaseTimeline({ snapshot: withoutPhaseRefresh as never });

    await timeline.refreshPhase("phase-1");

    expect(refresh).toHaveBeenCalledWith(true);
  });
});
