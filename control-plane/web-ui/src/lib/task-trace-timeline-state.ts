export type TraceTimelineAvailability = "complete" | "partial" | "none" | null;

type TraceTimelineMetaLike = {
  cacheState?: "none" | "partial" | "complete";
  complete?: boolean;
  itemCount?: number;
  reconcileRequired?: boolean;
};

function resolveTraceTimelineItemCount(
  meta?: TraceTimelineMetaLike | null,
  fallbackItemCount = 0,
) {
  if (typeof meta?.itemCount === "number" && Number.isFinite(meta.itemCount)) {
    return meta.itemCount;
  }

  return fallbackItemCount > 0 ? fallbackItemCount : 0;
}

export function resolveTraceTimelineAvailability(
  meta?: TraceTimelineMetaLike | null,
  fallbackItemCount = 0,
): TraceTimelineAvailability {
  if (!meta) {
    return null;
  }

  const itemCount = resolveTraceTimelineItemCount(meta, fallbackItemCount);
  if (meta.reconcileRequired === true) {
    return itemCount > 0 ? "partial" : "none";
  }

  if (meta.cacheState === "partial" || meta.cacheState === "none") {
    return meta.cacheState;
  }

  if (typeof meta.complete === "boolean") {
    return meta.complete ? "complete" : itemCount > 0 ? "partial" : "none";
  }

  if (meta.cacheState === "complete") {
    return "complete";
  }

  return null;
}

export function isTraceTimelineComplete(
  meta?: TraceTimelineMetaLike | null,
  fallbackItemCount = 0,
) {
  return resolveTraceTimelineAvailability(meta, fallbackItemCount) === "complete";
}