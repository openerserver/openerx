WITH snapshot_current_matches AS (
  SELECT
    snapshot.task_id,
    snapshot.current_session_id AS raw_session_id,
    COALESCE(
      exact.id,
      runtime.id,
      CASE
        WHEN snapshot.current_session_id LIKE 'task_session:%'
          THEN replace(snapshot.current_session_id, 'task_session:', 'task-session:')
        ELSE NULL
      END
    ) AS canonical_session_id
  FROM task_snapshots AS snapshot
  LEFT JOIN task_sessions AS exact
    ON exact.id = snapshot.current_session_id
  LEFT JOIN task_sessions AS runtime
    ON runtime.task_id = snapshot.task_id
   AND runtime.runtime_session_id = snapshot.current_session_id
  WHERE snapshot.current_session_id IS NOT NULL
),
snapshot_latest_matches AS (
  SELECT
    snapshot.task_id,
    snapshot.latest_session_id AS raw_session_id,
    COALESCE(
      exact.id,
      runtime.id,
      CASE
        WHEN snapshot.latest_session_id LIKE 'task_session:%'
          THEN replace(snapshot.latest_session_id, 'task_session:', 'task-session:')
        ELSE NULL
      END
    ) AS canonical_session_id
  FROM task_snapshots AS snapshot
  LEFT JOIN task_sessions AS exact
    ON exact.id = snapshot.latest_session_id
  LEFT JOIN task_sessions AS runtime
    ON runtime.task_id = snapshot.task_id
   AND runtime.runtime_session_id = snapshot.latest_session_id
  WHERE snapshot.latest_session_id IS NOT NULL
),
timeline_matches AS (
  SELECT
    timeline.id AS timeline_id,
    COALESCE(
      exact.id,
      runtime.id,
      CASE
        WHEN timeline.session_id LIKE 'task_session:%'
          THEN replace(timeline.session_id, 'task_session:', 'task-session:')
        ELSE NULL
      END
    ) AS canonical_session_id
  FROM task_timeline_views AS timeline
  LEFT JOIN task_sessions AS exact
    ON exact.id = timeline.session_id
  LEFT JOIN task_sessions AS runtime
    ON runtime.task_id = timeline.task_id
   AND runtime.runtime_session_id = timeline.session_id
  WHERE timeline.session_id IS NOT NULL
)
UPDATE task_snapshots AS snapshot
SET current_session_id = matches.canonical_session_id
FROM snapshot_current_matches AS matches
WHERE snapshot.task_id = matches.task_id
  AND snapshot.current_session_id = matches.raw_session_id
  AND matches.canonical_session_id IS NOT NULL
  AND snapshot.current_session_id IS DISTINCT FROM matches.canonical_session_id;

WITH snapshot_latest_matches AS (
  SELECT
    snapshot.task_id,
    snapshot.latest_session_id AS raw_session_id,
    COALESCE(
      exact.id,
      runtime.id,
      CASE
        WHEN snapshot.latest_session_id LIKE 'task_session:%'
          THEN replace(snapshot.latest_session_id, 'task_session:', 'task-session:')
        ELSE NULL
      END
    ) AS canonical_session_id
  FROM task_snapshots AS snapshot
  LEFT JOIN task_sessions AS exact
    ON exact.id = snapshot.latest_session_id
  LEFT JOIN task_sessions AS runtime
    ON runtime.task_id = snapshot.task_id
   AND runtime.runtime_session_id = snapshot.latest_session_id
  WHERE snapshot.latest_session_id IS NOT NULL
)
UPDATE task_snapshots AS snapshot
SET latest_session_id = matches.canonical_session_id
FROM snapshot_latest_matches AS matches
WHERE snapshot.task_id = matches.task_id
  AND snapshot.latest_session_id = matches.raw_session_id
  AND matches.canonical_session_id IS NOT NULL
  AND snapshot.latest_session_id IS DISTINCT FROM matches.canonical_session_id;

WITH timeline_matches AS (
  SELECT
    timeline.id AS timeline_id,
    COALESCE(
      exact.id,
      runtime.id,
      CASE
        WHEN timeline.session_id LIKE 'task_session:%'
          THEN replace(timeline.session_id, 'task_session:', 'task-session:')
        ELSE NULL
      END
    ) AS canonical_session_id
  FROM task_timeline_views AS timeline
  LEFT JOIN task_sessions AS exact
    ON exact.id = timeline.session_id
  LEFT JOIN task_sessions AS runtime
    ON runtime.task_id = timeline.task_id
   AND runtime.runtime_session_id = timeline.session_id
  WHERE timeline.session_id IS NOT NULL
)
UPDATE task_timeline_views AS timeline
SET session_id = matches.canonical_session_id
FROM timeline_matches AS matches
WHERE timeline.id = matches.timeline_id
  AND matches.canonical_session_id IS NOT NULL
  AND timeline.session_id IS DISTINCT FROM matches.canonical_session_id;
