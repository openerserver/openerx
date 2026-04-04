import { and, desc, eq } from "drizzle-orm";
import { db } from "../../db";
import { taskSnapshots } from "../../db/schema";
import type { TaskTreeRecord } from "../project-tree/task-view";

export function createTaskSnapshotReadApi(deps: {
  loadTaskTreeBackedRecord: (taskId: string) => Promise<TaskTreeRecord | null>;
}) {
  async function listTaskSnapshots(args: {
    projectId?: string;
    status?: string;
    limit?: number;
  }) {
    const limit = Number.isFinite(args.limit) ? Math.max(1, Math.min(500, args.limit ?? 200)) : 200;
    const filters = [] as Array<ReturnType<typeof eq>>;

    if (args.projectId) {
      filters.push(eq(taskSnapshots.projectId, args.projectId));
    }
    if (args.status) {
      filters.push(
        eq(taskSnapshots.lifecycleStatus, args.status as typeof taskSnapshots.lifecycleStatus._.data),
      );
    }

    const query = db
      .select()
      .from(taskSnapshots)
      .orderBy(desc(taskSnapshots.updatedAt))
      .limit(limit);
    const data = filters.length > 0 ? await query.where(and(...filters)) : await query;

    return { data };
  }

  async function getTaskSnapshot(taskId: string) {
    const task = await deps.loadTaskTreeBackedRecord(taskId);
    if (!task) {
      return { ok: false as const, status: 404 as const, error: "Task not found" };
    }

    const snapshot = await db.query.taskSnapshots.findFirst({
      where: eq(taskSnapshots.taskId, taskId),
    });

    return {
      ok: true as const,
      status: 200 as const,
      data: {
        data: snapshot ?? null,
        meta: {
          readSource: "task-domain-projection" as const,
          complete: Boolean(snapshot),
        },
      },
    };
  }

  return {
    listTaskSnapshots,
    getTaskSnapshot,
  };
}
