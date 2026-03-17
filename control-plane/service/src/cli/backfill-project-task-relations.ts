#!/usr/bin/env bun

import { desc, eq } from "drizzle-orm";
import { db } from "../db";
import { auditEvents, projectTaskRelations, tasks } from "../db/schema";
import {
  expandCreateTaskRelations,
  mergeRelationContexts,
  parseStoredRawRelations,
  parseStoredRelationContext,
} from "../modules/tasks/relation-protocol";

interface ParsedArgs {
  projectId?: string;
  dryRun: boolean;
  verbose: boolean;
}

function parseArgs(): ParsedArgs {
  const args = process.argv.slice(2);
  const parsed: Record<string, string> = {};
  const flags = new Set<string>();

  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (!arg?.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = args[index + 1];
    if (next && !next.startsWith("--")) {
      parsed[key] = next;
      index += 1;
    } else {
      flags.add(key);
    }
  }

  return {
    projectId: parsed.projectId || parsed.project,
    dryRun: flags.has("dry-run"),
    verbose: flags.has("verbose"),
  };
}

function parseJsonRecord(value: unknown): Record<string, unknown> | null {
  if (!value) {
    return null;
  }
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  }
  return typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

async function loadBackfillRows(args: ParsedArgs) {
  const taskRows = args.projectId
    ? await db.select().from(tasks).where(eq(tasks.projectId, args.projectId))
    : await db.select().from(tasks);

  const auditRows = args.projectId
    ? await db
        .select()
        .from(auditEvents)
        .where(eq(auditEvents.projectId, args.projectId))
        .orderBy(desc(auditEvents.ts))
    : await db.select().from(auditEvents).orderBy(desc(auditEvents.ts));

  const existingRows = args.projectId
    ? await db
        .select()
        .from(projectTaskRelations)
        .where(eq(projectTaskRelations.projectId, args.projectId))
    : await db.select().from(projectTaskRelations);

  return {
    taskRows,
    auditRows,
    existingRows,
  };
}

function buildLatestCreateAuditByTaskId(
  auditRows: Awaited<ReturnType<typeof loadBackfillRows>>["auditRows"],
) {
  const latestAuditByTaskId = new Map<string, (typeof auditRows)[number]>();
  for (const row of auditRows) {
    if (!row.taskId || latestAuditByTaskId.has(row.taskId)) {
      continue;
    }
    if (row.eventType === "task.created" || row.action === "create_task") {
      latestAuditByTaskId.set(row.taskId, row);
    }
  }
  return latestAuditByTaskId;
}

function expandTaskBackfillRelations(args: {
  task: Awaited<ReturnType<typeof loadBackfillRows>>["taskRows"][number];
  taskProjectMap: Map<string, string>;
  latestAuditByTaskId: Map<
    string,
    Awaited<ReturnType<typeof loadBackfillRows>>["auditRows"][number]
  >;
  existingKeys: Set<string>;
}) {
  const strategyRecord = parseJsonRecord(args.task.strategy);
  const auditDetail = parseJsonRecord(args.latestAuditByTaskId.get(args.task.id)?.detail);

  const rawRelations = [
    ...parseStoredRawRelations(strategyRecord?.relations),
    ...parseStoredRawRelations(auditDetail?.relations),
  ];
  const relationContext = mergeRelationContexts(
    parseStoredRelationContext(strategyRecord?.relationContext),
    parseStoredRelationContext(auditDetail?.relationContext),
  );

  const candidates = expandCreateTaskRelations({
    taskId: args.task.id,
    relations: rawRelations,
    relationContext: relationContext || undefined,
  });

  const inserts: Array<typeof projectTaskRelations.$inferInsert> = [];
  let skippedMissingTasks = 0;

  for (const relation of candidates) {
    const sourceProjectId = args.taskProjectMap.get(relation.sourceTaskId);
    const targetProjectId = args.taskProjectMap.get(relation.targetTaskId);
    if (sourceProjectId !== args.task.projectId || targetProjectId !== args.task.projectId) {
      skippedMissingTasks += 1;
      continue;
    }

    const dedupeKey = `${args.task.projectId}:${relation.sourceTaskId}:${relation.targetTaskId}:${relation.type}`;
    if (args.existingKeys.has(dedupeKey)) {
      continue;
    }

    args.existingKeys.add(dedupeKey);
    inserts.push({
      id: crypto.randomUUID(),
      projectId: args.task.projectId,
      sourceTaskId: relation.sourceTaskId,
      targetTaskId: relation.targetTaskId,
      relationType: relation.type,
      relationSource: "system",
      metadata: {
        ...(relation.metadata || {}),
        backfilledBy: "backfill-project-task-relations",
        backfilledAt: new Date().toISOString(),
      },
    });
  }

  return {
    inserts,
    skippedMissingTasks,
  };
}

async function main() {
  const args = parseArgs();
  const { taskRows, auditRows, existingRows } = await loadBackfillRows(args);

  const taskProjectMap = new Map(taskRows.map((task) => [task.id, task.projectId]));
  const latestAuditByTaskId = buildLatestCreateAuditByTaskId(auditRows);

  const existingKeys = new Set(
    existingRows.map(
      (row) => `${row.projectId}:${row.sourceTaskId}:${row.targetTaskId}:${row.relationType}`,
    ),
  );

  const inserts: Array<typeof projectTaskRelations.$inferInsert> = [];
  let skippedMissingTasks = 0;

  for (const task of taskRows) {
    const expanded = expandTaskBackfillRelations({
      task,
      taskProjectMap,
      latestAuditByTaskId,
      existingKeys,
    });
    inserts.push(...expanded.inserts);
    skippedMissingTasks += expanded.skippedMissingTasks;
  }

  if (!args.dryRun && inserts.length > 0) {
    await db.insert(projectTaskRelations).values(inserts);
  }

  console.log(
    JSON.stringify(
      {
        projectId: args.projectId || null,
        dryRun: args.dryRun,
        scannedTasks: taskRows.length,
        insertedRelations: inserts.length,
        skippedMissingTasks,
      },
      null,
      2,
    ),
  );

  if (args.verbose && inserts.length > 0) {
    for (const relation of inserts) {
      console.log(
        `${relation.projectId} ${relation.sourceTaskId} -> ${relation.targetTaskId} [${relation.relationType}]`,
      );
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
