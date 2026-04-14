type VersionedTaskDetailSnapshot = {
  meta?: {
    snapshotVersion?: number;
    reconcileRequired?: boolean;
  };
};

export function resolveTaskDetailSnapshotVersion(view?: VersionedTaskDetailSnapshot | null) {
  const snapshotVersion = view?.meta?.snapshotVersion;
  return typeof snapshotVersion === "number" && Number.isFinite(snapshotVersion)
    ? snapshotVersion
    : null;
}

export function isTaskDetailSnapshotReconcileRequired(view?: VersionedTaskDetailSnapshot | null) {
  return view?.meta?.reconcileRequired === true;
}

export function shouldAcceptTaskDetailSnapshot<T extends VersionedTaskDetailSnapshot>(
  current: T | null,
  next: T | null,
) {
  const currentVersion = resolveTaskDetailSnapshotVersion(current);
  const nextVersion = resolveTaskDetailSnapshotVersion(next);

  if (currentVersion != null && nextVersion != null && nextVersion < currentVersion) {
    return false;
  }

  if (
    currentVersion != null &&
    nextVersion != null &&
    nextVersion === currentVersion &&
    !isTaskDetailSnapshotReconcileRequired(current) &&
    isTaskDetailSnapshotReconcileRequired(next)
  ) {
    return false;
  }

  return true;
}