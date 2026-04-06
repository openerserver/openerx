/**
 * Phase 1: Event-log Projector
 *
 * Reads unprojected events from `task_message_events` and replays them
 * into the normalized tables (`task_messages`, `task_message_parts`,
 * `task_timeline_views`) using the same code path as the live write.
 *
 * Because the live write already calls `upsertTaskSessionMessageRecord` (which
 * uses ON CONFLICT UPDATE), re-projecting the same event is a no-op; the
 * projector is therefore idempotent by design.
 *
 * Scheduling: this module exposes a single `projectPendingEvents()` function.
 * Callers are free to invoke it from a cron, a startup hook, or a CLI script.
 */

import { and, asc, eq } from "drizzle-orm";
import { db } from "../../db";
import { taskMessageEvents, taskSessions, tasks } from "../../db/schema";
import { createTaskSessionMessageWriteApi } from "./task-session-message-write-api";
import { createTaskSessionWriteApi } from "./task-session-write-api";

// ── Deps wiring (same as live path in task-route-builder-shared) ──

/**
 * Mirrors the private `resolveTaskSessionRecordByRuntimeSessionId` in
 * `task-route-builder-shared.ts`.  Kept inline to avoid coupling the
 * projector to route-builder internals.
 */
async function resolveTaskSessionRecordByRuntimeSessionId(
  taskId: string,
  projectId: string,
  runtimeSessionId: string,
) {
  const session = await db.query.taskSessions.findFirst({
    where: and(
      eq(taskSessions.runtimeSessionId, runtimeSessionId),
      eq(taskSessions.taskId, taskId),
      eq(taskSessions.projectId, projectId),
    ),
  });

  if (!session) return null;

  return {
    runtimeSessionId: session.runtimeSessionId ?? session.id,
    parentRuntimeSessionId: session.parentSessionId
      ? session.parentSessionId.replace(`task-session:${session.taskId}:`, "")
      : null,
    sessionKind: session.sessionKind,
  };
}

function buildProjectorDeps() {
  const sessionWriteApi = createTaskSessionWriteApi();

  const messageWriteApi = createTaskSessionMessageWriteApi({
    upsertTaskSessionRecord: sessionWriteApi.upsertTaskSessionRecord,
    resolveTaskSessionRecordByRuntimeSessionId,
  });

  return {
    upsertTaskSessionMessageRecord: messageWriteApi.upsertTaskSessionMessageRecord,
  };
}

// ── Core projection logic ──────────────────────────────────────────

export type ProjectionResult = {
  processed: number;
  failed: number;
  errors: Array<{ eventId: number; error: string }>;
};

/**
 * Project up to `batchSize` unprojected events, ordered by `(task_id, session_id, created_at)`.
 *
 * Returns a summary of how many events were projected and how many failed.
 * Failed events are NOT marked as projected; they will be retried next time.
 */
export async function projectPendingEvents(batchSize = 100): Promise<ProjectionResult> {
  const deps = buildProjectorDeps();

  // Fetch unprojected events in causal order
  const events = await db
    .select()
    .from(taskMessageEvents)
    .where(eq(taskMessageEvents.projected, false))
    .orderBy(
      asc(taskMessageEvents.taskId),
      asc(taskMessageEvents.sessionId),
      asc(taskMessageEvents.createdAt),
      asc(taskMessageEvents.id),
    )
    .limit(batchSize);

  if (events.length === 0) {
    return { processed: 0, failed: 0, errors: [] };
  }

  let processed = 0;
  let failed = 0;
  const errors: ProjectionResult["errors"] = [];

  for (const event of events) {
    try {
      const payload = event.payload as Record<string, unknown>;

      await deps.upsertTaskSessionMessageRecord({
        task: {
          id: event.taskId,
          // projectId is not stored in the event; look it up from the payload or
          // fall back to a direct DB lookup.  For Phase 1 we accept the cost of
          // the lookup; Phase 2 will add projectId to the event table.
          projectId: await resolveProjectIdForTask(event.taskId),
        },
        runtimeSessionId: event.sessionId,
        message: payload,
      });

      // Mark as projected
      await db
        .update(taskMessageEvents)
        .set({ projected: true })
        .where(eq(taskMessageEvents.id, event.id));

      processed++;
    } catch (err) {
      failed++;
      errors.push({
        eventId: Number(event.id),
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { processed, failed, errors };
}

// ── Helpers ────────────────────────────────────────────────────────

const projectIdCache = new Map<string, string>();

async function resolveProjectIdForTask(taskId: string): Promise<string> {
  const cached = projectIdCache.get(taskId);
  if (cached) return cached;

  const row = await db.query.tasks.findFirst({
    where: eq(tasks.id, taskId),
    columns: { projectId: true },
  });

  if (!row?.projectId) {
    throw new Error(`Task ${taskId} not found — cannot resolve projectId for projection`);
  }

  projectIdCache.set(taskId, row.projectId);
  return row.projectId;
}
