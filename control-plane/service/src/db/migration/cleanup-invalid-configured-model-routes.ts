#!/usr/bin/env bun

import type { ProjectSettings } from "../schema";
import { closeDatabase, postgresSql } from "../index";
import { getBooleanArg, parseCliArgs } from "./metadata";
import {
  normalizePersistedConfiguredModelValue,
  sanitizeProjectSettingsDefaultModel,
  type PersistedConfiguredModelCleanup,
} from "./configured-model-route-cleanup";

type ProjectCleanupRow = {
  id: string;
  settings: ProjectSettings | null;
};

type TaskCleanupRow = {
  id: string;
  projectId: string;
  preferredModel: string | null;
};

type TaskSessionCleanupRow = {
  id: string;
  taskId: string;
  projectId: string;
  selectedModel: string | null;
};

type ProjectCleanupUpdate = {
  id: string;
  nextSettings: ProjectSettings;
  modelCleanup: PersistedConfiguredModelCleanup;
};

type TaskCleanupUpdate = {
  id: string;
  projectId: string;
  nextValue: string | null;
  modelCleanup: PersistedConfiguredModelCleanup;
};

type TaskSessionCleanupUpdate = {
  id: string;
  taskId: string;
  projectId: string;
  nextValue: string | null;
  modelCleanup: PersistedConfiguredModelCleanup;
};

type CleanupSummary = {
  dryRun: boolean;
  projectId: string | null;
  scannedProjectDefaultModelCount: number;
  scannedTaskPreferredModelCount: number;
  scannedTaskSessionSelectedModelCount: number;
  clearedProjectDefaultModelCount: number;
  normalizedProjectDefaultModelCount: number;
  clearedTaskPreferredModelCount: number;
  normalizedTaskPreferredModelCount: number;
  clearedTaskSessionSelectedModelCount: number;
  normalizedTaskSessionSelectedModelCount: number;
  affectedProjectIds: string[];
  affectedTaskIds: string[];
  affectedTaskSessionIds: string[];
};

function getOptionalStringArg(args: Record<string, string | boolean>, key: string) {
  const value = args[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function summarizeModelCleanupChanges<T extends { modelCleanup: PersistedConfiguredModelCleanup }>(
  updates: T[],
) {
  return {
    cleared: updates.filter((update) => update.modelCleanup.changeKind === "cleared").length,
    normalized: updates.filter((update) => update.modelCleanup.changeKind === "normalized").length,
  };
}

async function loadProjectCleanupRows(projectId?: string) {
  if (projectId) {
    return postgresSql<ProjectCleanupRow[]>`
      select id, settings
      from projects
      where id = ${projectId}
        and settings ? 'defaultModel'
      order by id asc
    `;
  }

  return postgresSql<ProjectCleanupRow[]>`
    select id, settings
    from projects
    where settings ? 'defaultModel'
    order by id asc
  `;
}

async function loadTaskCleanupRows(projectId?: string) {
  if (projectId) {
    return postgresSql<TaskCleanupRow[]>`
      select
        id,
        project_id as "projectId",
        preferred_model as "preferredModel"
      from tasks
      where project_id = ${projectId}
        and preferred_model is not null
      order by id asc
    `;
  }

  return postgresSql<TaskCleanupRow[]>`
    select
      id,
      project_id as "projectId",
      preferred_model as "preferredModel"
    from tasks
    where preferred_model is not null
    order by id asc
  `;
}

async function loadTaskSessionCleanupRows(projectId?: string) {
  if (projectId) {
    return postgresSql<TaskSessionCleanupRow[]>`
      select
        id,
        task_id as "taskId",
        project_id as "projectId",
        selected_model as "selectedModel"
      from task_sessions
      where project_id = ${projectId}
        and selected_model is not null
      order by id asc
    `;
  }

  return postgresSql<TaskSessionCleanupRow[]>`
    select
      id,
      task_id as "taskId",
      project_id as "projectId",
      selected_model as "selectedModel"
    from task_sessions
    where selected_model is not null
    order by id asc
  `;
}

function buildProjectCleanupUpdates(rows: ProjectCleanupRow[]) {
  return rows
    .map((row) => {
      const { nextSettings, modelCleanup } = sanitizeProjectSettingsDefaultModel(row.settings);
      if (!modelCleanup.changed || !nextSettings) {
        return null;
      }

      return {
        id: row.id,
        nextSettings,
        modelCleanup,
      } satisfies ProjectCleanupUpdate;
    })
    .filter((row): row is ProjectCleanupUpdate => Boolean(row));
}

function buildTaskCleanupUpdates(rows: TaskCleanupRow[]) {
  return rows
    .map((row) => {
      const modelCleanup = normalizePersistedConfiguredModelValue(row.preferredModel);
      if (!modelCleanup.changed) {
        return null;
      }

      return {
        id: row.id,
        projectId: row.projectId,
        nextValue: modelCleanup.nextValue,
        modelCleanup,
      } satisfies TaskCleanupUpdate;
    })
    .filter((row): row is TaskCleanupUpdate => Boolean(row));
}

function buildTaskSessionCleanupUpdates(rows: TaskSessionCleanupRow[]) {
  return rows
    .map((row) => {
      const modelCleanup = normalizePersistedConfiguredModelValue(row.selectedModel);
      if (!modelCleanup.changed) {
        return null;
      }

      return {
        id: row.id,
        taskId: row.taskId,
        projectId: row.projectId,
        nextValue: modelCleanup.nextValue,
        modelCleanup,
      } satisfies TaskSessionCleanupUpdate;
    })
    .filter((row): row is TaskSessionCleanupUpdate => Boolean(row));
}

async function applyCleanupUpdates(args: {
  projectUpdates: ProjectCleanupUpdate[];
  taskUpdates: TaskCleanupUpdate[];
  taskSessionUpdates: TaskSessionCleanupUpdate[];
}) {
  if (
    args.projectUpdates.length === 0 &&
    args.taskUpdates.length === 0 &&
    args.taskSessionUpdates.length === 0
  ) {
    return;
  }

  await postgresSql.begin(async (transaction) => {
    for (const update of args.projectUpdates) {
      await transaction.unsafe(
        `UPDATE projects
            SET settings = $2::jsonb,
                updated_at = CURRENT_TIMESTAMP
          WHERE id = $1`,
        [update.id, JSON.stringify(update.nextSettings)] as never[],
      );
    }

    for (const update of args.taskUpdates) {
      await transaction.unsafe(
        `UPDATE tasks
            SET preferred_model = $2,
                updated_at = CURRENT_TIMESTAMP
          WHERE id = $1`,
        [update.id, update.nextValue] as never[],
      );
    }

    for (const update of args.taskSessionUpdates) {
      await transaction.unsafe(
        `UPDATE task_sessions
            SET selected_model = $2,
                updated_at = CURRENT_TIMESTAMP
          WHERE id = $1`,
        [update.id, update.nextValue] as never[],
      );
    }
  });
}

function buildCleanupSummary(args: {
  dryRun: boolean;
  projectId?: string;
  projectRows: ProjectCleanupRow[];
  projectUpdates: ProjectCleanupUpdate[];
  taskRows: TaskCleanupRow[];
  taskUpdates: TaskCleanupUpdate[];
  taskSessionRows: TaskSessionCleanupRow[];
  taskSessionUpdates: TaskSessionCleanupUpdate[];
}): CleanupSummary {
  const projectCounts = summarizeModelCleanupChanges(args.projectUpdates);
  const taskCounts = summarizeModelCleanupChanges(args.taskUpdates);
  const taskSessionCounts = summarizeModelCleanupChanges(args.taskSessionUpdates);

  const affectedProjectIds = new Set<string>();
  const affectedTaskIds = new Set<string>();
  const affectedTaskSessionIds = new Set<string>();

  for (const update of args.projectUpdates) {
    affectedProjectIds.add(update.id);
  }
  for (const update of args.taskUpdates) {
    affectedProjectIds.add(update.projectId);
    affectedTaskIds.add(update.id);
  }
  for (const update of args.taskSessionUpdates) {
    affectedProjectIds.add(update.projectId);
    affectedTaskIds.add(update.taskId);
    affectedTaskSessionIds.add(update.id);
  }

  return {
    dryRun: args.dryRun,
    projectId: args.projectId ?? null,
    scannedProjectDefaultModelCount: args.projectRows.length,
    scannedTaskPreferredModelCount: args.taskRows.length,
    scannedTaskSessionSelectedModelCount: args.taskSessionRows.length,
    clearedProjectDefaultModelCount: projectCounts.cleared,
    normalizedProjectDefaultModelCount: projectCounts.normalized,
    clearedTaskPreferredModelCount: taskCounts.cleared,
    normalizedTaskPreferredModelCount: taskCounts.normalized,
    clearedTaskSessionSelectedModelCount: taskSessionCounts.cleared,
    normalizedTaskSessionSelectedModelCount: taskSessionCounts.normalized,
    affectedProjectIds: Array.from(affectedProjectIds).sort(),
    affectedTaskIds: Array.from(affectedTaskIds).sort(),
    affectedTaskSessionIds: Array.from(affectedTaskSessionIds).sort(),
  };
}

function printSummary(summary: CleanupSummary) {
  console.log("Cleanup invalid configured model routes");
  console.log(JSON.stringify(summary, null, 2));
}

export async function cleanupInvalidConfiguredModelRoutes(args?: {
  projectId?: string;
  dryRun?: boolean;
}) {
  const projectRows = await loadProjectCleanupRows(args?.projectId);
  const taskRows = await loadTaskCleanupRows(args?.projectId);
  const taskSessionRows = await loadTaskSessionCleanupRows(args?.projectId);

  const projectUpdates = buildProjectCleanupUpdates(projectRows);
  const taskUpdates = buildTaskCleanupUpdates(taskRows);
  const taskSessionUpdates = buildTaskSessionCleanupUpdates(taskSessionRows);

  if (!args?.dryRun) {
    await applyCleanupUpdates({
      projectUpdates,
      taskUpdates,
      taskSessionUpdates,
    });
  }

  return buildCleanupSummary({
    dryRun: args?.dryRun ?? false,
    projectId: args?.projectId,
    projectRows,
    projectUpdates,
    taskRows,
    taskUpdates,
    taskSessionRows,
    taskSessionUpdates,
  });
}

async function main() {
  const args = parseCliArgs();
  const projectId = getOptionalStringArg(args, "project-id");
  const dryRun = getBooleanArg(args, "dry-run", false);
  const help = getBooleanArg(args, "help", false);

  if (help) {
    console.log(
      "Usage: bun run src/db/migration/cleanup-invalid-configured-model-routes.ts [--project-id <projectId>] [--dry-run]",
    );
    console.log(
      "Clears persisted invalid configured-model values from project settings, task preferred models, and task session selected models.",
    );
    return;
  }

  const summary = await cleanupInvalidConfiguredModelRoutes({
    projectId,
    dryRun,
  });
  printSummary(summary);
}

if (import.meta.main) {
  main()
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    })
    .finally(async () => {
      await closeDatabase();
    });
}