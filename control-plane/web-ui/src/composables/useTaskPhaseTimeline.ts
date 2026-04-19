import { type Ref, computed } from "vue";

/**
 * Phase-first facade over `useTaskMessageSnapshot()`.
 *
 * The phase-first migration (docs/task-detail/task-detail-phase-first-migration-checklist.md §6.2)
 * wants TaskDetail's main timeline to be driven by a dedicated phase timeline feature rather than
 * by the session-shaped `useTaskMessageSnapshot()` entry. This composable is that dedicated
 * feature: it re-exposes the phase slices and the phase-scoped refresh primitives under a
 * phase-keyed API so callers never have to reason about `sessionId` when what they actually
 * want is "render the phase timeline".
 *
 * At this step it intentionally delegates to the existing snapshot composable — the goal is to
 * give the rest of the page a stable phase-first entry today so future cuts can migrate data
 * sources (e.g. `/phases` / `/phases/:phaseId/view`) without breaking page-level callers.
 */

type PhaseTimelineSnapshotSource<Slice> = {
  phaseSlices: Ref<readonly Slice[]>;
  loading: Ref<boolean>;
  error: Ref<string | null>;
  refresh: (silent?: boolean) => void | Promise<void>;
  refreshCurrentPhase?: (silent?: boolean, phaseId?: string) => void | Promise<void>;
};

export type UseTaskPhaseTimelineOptions<Slice extends { phase: { id: string } }> = {
  snapshot: PhaseTimelineSnapshotSource<Slice>;
  currentPhaseId?: Ref<string | undefined>;
};

export type UseTaskPhaseTimelineReturn<Slice extends { phase: { id: string } }> = {
  phaseSlices: Ref<readonly Slice[]>;
  currentPhaseSlice: Ref<Slice | undefined>;
  loading: Ref<boolean>;
  error: Ref<string | null>;
  refresh: (silent?: boolean) => void | Promise<void>;
  refreshPhase: (phaseId?: string, silent?: boolean) => void | Promise<void>;
};

export function useTaskPhaseTimeline<Slice extends { phase: { id: string } }>(
  options: UseTaskPhaseTimelineOptions<Slice>,
): UseTaskPhaseTimelineReturn<Slice> {
  const { snapshot, currentPhaseId } = options;

  const currentPhaseSlice = computed(() => {
    const phases = snapshot.phaseSlices.value;
    const targetPhaseId = currentPhaseId?.value;
    if (targetPhaseId) {
      const explicit = phases.find((slice) => slice.phase.id === targetPhaseId);
      if (explicit) {
        return explicit;
      }
    }
    return phases.at(-1);
  });

  async function refreshPhase(phaseId?: string, silent = true) {
    if (snapshot.refreshCurrentPhase) {
      await snapshot.refreshCurrentPhase(silent, phaseId);
      return;
    }
    await snapshot.refresh(silent);
  }

  return {
    phaseSlices: snapshot.phaseSlices,
    currentPhaseSlice,
    loading: snapshot.loading,
    error: snapshot.error,
    refresh: snapshot.refresh,
    refreshPhase,
  };
}
