import { join } from "node:path";
import {
  BAD_TIMESTAMP_LITERAL,
  BOOLEAN_COLUMN_NAMES,
  DEFAULT_WORK_DIR,
  JSONB_COLUMN_NAMES,
  KEY_FOREIGN_KEYS,
  LEGACY_OFFLINE_SOURCE_TABLES,
  SnapshotManifest,
  ensureDir,
  getOrderedTables,
  getPrimaryKeyColumn,
  getStringArg,
  isTimestampColumn,
  normalizeBooleanValue,
  nowIso,
  parseCliArgs,
  readJsonFile,
  readJsonLines,
  resolveInputPath,
  writeJsonFile,
  writeJsonLines,
} from "./metadata";

export interface TransformExportOptions {
  inputDir: string;
  outputDir: string;
}

const PROJECT_TREE_NODE_COLUMNS = [
  "id",
  "project_id",
  "parent_id",
  "path",
  "depth",
  "node_type",
  "role",
  "content_text",
  "content_json",
  "token_count",
  "runtime_session_id",
  "runtime_message_id",
  "branch_name",
  "is_active",
  "superseded_by",
  "created_at",
  "updated_at",
  "archived_at",
];

const PROJECT_TREE_BRANCH_COLUMNS = [
  "id",
  "project_id",
  "task_node_id",
  "branch_name",
  "head_node_id",
  "is_default",
  "created_at",
  "updated_at",
];

function sanitizeLtreeLabelSegment(value: string) {
  const sanitized = value.replace(/[^A-Za-z0-9_]/g, "_");
  return sanitized || "node";
}

function buildProjectRootNodeId(projectId: string) {
  return `project_root:${projectId}`;
}

function buildProjectRootPath(projectId: string) {
  return `project_${sanitizeLtreeLabelSegment(projectId)}`;
}

function buildTaskPath(projectId: string, taskId: string) {
  return `${buildProjectRootPath(projectId)}.task_${sanitizeLtreeLabelSegment(taskId)}`;
}

function buildProjectMainBranchId(projectId: string) {
  return `project_branch:main:${projectId}`;
}

function asString(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function asBoolean(value: unknown, defaultValue = false) {
  const normalized = normalizeBooleanValue(value);
  return typeof normalized === "boolean" ? normalized : defaultValue;
}

function mergeRowsById(
  existingRows: Array<Record<string, unknown>>,
  additionalRows: Array<Record<string, unknown>>,
) {
  const merged = new Map<string, Record<string, unknown>>();

  for (const row of existingRows) {
    const id = asString(row.id);
    if (!id) {
      continue;
    }
    merged.set(id, row);
  }

  for (const row of additionalRows) {
    const id = asString(row.id);
    if (!id || merged.has(id)) {
      continue;
    }
    merged.set(id, row);
  }

  return [...merged.values()];
}

function synthesizeTreeTables(
  rowsByTable: Map<string, Array<Record<string, unknown>>>,
  tableMetaByName: Map<string, SnapshotManifest["tables"][number]>,
  warnings: Record<string, string[]>,
) {
  const projects = rowsByTable.get("projects") ?? [];
  const legacyTasks = rowsByTable.get("tasks") ?? [];

  if (projects.length === 0 && legacyTasks.length === 0) {
    return;
  }

  const projectRootNodes: Array<Record<string, unknown>> = [];
  const taskNodes: Array<Record<string, unknown>> = [];
  const projectBranches: Array<Record<string, unknown>> = [];
  const nodeRowsById = new Map<string, Record<string, unknown>>();

  for (const project of projects) {
    const projectId = asString(project.id);
    if (!projectId) {
      continue;
    }
    const createdAt = asString(project.created_at) ?? nowIso();
    const updatedAt = asString(project.updated_at) ?? createdAt;
    const rootNode = {
      id: buildProjectRootNodeId(projectId),
      project_id: projectId,
      parent_id: null,
      path: buildProjectRootPath(projectId),
      depth: 0,
      node_type: "project_root",
      role: null,
      content_text: asString(project.name),
      content_json: null,
      token_count: null,
      runtime_session_id: null,
      runtime_message_id: null,
      branch_name: null,
      is_active: true,
      superseded_by: null,
      created_at: createdAt,
      updated_at: updatedAt,
      archived_at: null,
    } satisfies Record<string, unknown>;
    projectRootNodes.push(rootNode);
    nodeRowsById.set(String(rootNode.id), rootNode);

    projectBranches.push({
      id: buildProjectMainBranchId(projectId),
      project_id: projectId,
      task_node_id: null,
      branch_name: "main",
      head_node_id: rootNode.id,
      is_default: true,
      created_at: createdAt,
      updated_at: updatedAt,
    });
  }

  for (const task of legacyTasks) {
    const taskId = asString(task.id);
    const projectId = asString(task.project_id);
    if (!taskId || !projectId) {
      warnings.project_tree_nodes = warnings.project_tree_nodes ?? [];
      warnings.project_tree_nodes.push("Skipped legacy task row without id/project_id while synthesizing project_tree_nodes.");
      continue;
    }

    const rootNodeId = buildProjectRootNodeId(projectId);
    if (!nodeRowsById.has(rootNodeId)) {
      warnings.project_tree_nodes = warnings.project_tree_nodes ?? [];
      warnings.project_tree_nodes.push(`Skipped legacy task ${taskId} because project root ${rootNodeId} was missing.`);
      continue;
    }

    const createdAt = asString(task.created_at) ?? nowIso();
    const updatedAt = asString(task.finished_at) ?? asString(task.started_at) ?? createdAt;
    const taskNode = {
      id: taskId,
      project_id: projectId,
      parent_id: rootNodeId,
      path: buildTaskPath(projectId, taskId),
      depth: 1,
      node_type: "task",
      role: null,
      content_text: asString(task.title),
      content_json: {
        userId: asString(task.user_id),
        prompt: asString(task.prompt),
        status: asString(task.status),
        sessionId: asString(task.session_id),
        agentRunId: asString(task.agent_run_id),
        result: asString(task.result),
        category: asString(task.category),
        strategy: task.strategy ?? null,
        repoId: asString(task.repo_id),
        workspaceRoot: asString(task.workspace_root),
        baseRevision: asString(task.base_revision),
        workingBranch: asString(task.working_branch),
        selectedModel: asString(task.selected_model),
        executionMode: asString(task.execution_mode),
        executionPlan: task.execution_plan ?? null,
        autoAdvanceStages: asBoolean(task.auto_advance_stages, false),
        credentialId: asString(task.credential_id),
        gitAuthorName: asString(task.git_author_name),
        gitAuthorEmail: asString(task.git_author_email),
        gitCommitterName: asString(task.git_committer_name),
        gitCommitterEmail: asString(task.git_committer_email),
        finalCommitSha: asString(task.final_commit_sha),
        finalBranchName: asString(task.final_branch_name),
        changesSummary: task.changes_summary ?? null,
        createdAt,
        startedAt: asString(task.started_at),
        finishedAt: asString(task.finished_at),
      },
      token_count: null,
      runtime_session_id: asString(task.session_id),
      runtime_message_id: null,
      branch_name: asString(task.working_branch),
      is_active: true,
      superseded_by: null,
      created_at: createdAt,
      updated_at: updatedAt,
      archived_at: null,
    } satisfies Record<string, unknown>;

    taskNodes.push(taskNode);
    nodeRowsById.set(taskId, taskNode);
  }

  const existingNodeRows = rowsByTable.get("project_tree_nodes") ?? [];
  const existingBranchRows = rowsByTable.get("project_tree_branches") ?? [];
  rowsByTable.set(
    "project_tree_nodes",
    mergeRowsById(existingNodeRows, [...projectRootNodes, ...taskNodes]),
  );
  rowsByTable.set("project_tree_branches", mergeRowsById(existingBranchRows, projectBranches));

  if (!tableMetaByName.has("project_tree_nodes")) {
    tableMetaByName.set("project_tree_nodes", {
      name: "project_tree_nodes",
      columns: PROJECT_TREE_NODE_COLUMNS,
      rowCount: 0,
      primaryKeyColumn: "id",
      fileName: "project_tree_nodes.jsonl",
    });
  }
  if (!tableMetaByName.has("project_tree_branches")) {
    tableMetaByName.set("project_tree_branches", {
      name: "project_tree_branches",
      columns: PROJECT_TREE_BRANCH_COLUMNS,
      rowCount: 0,
      primaryKeyColumn: "id",
      fileName: "project_tree_branches.jsonl",
    });
  }

  for (const tableName of LEGACY_OFFLINE_SOURCE_TABLES) {
    if (rowsByTable.delete(tableName)) {
      warnings[tableName] = warnings[tableName] ?? [];
      warnings[tableName].push(
        tableName === "task_sessions"
          ? "Omitted task_sessions from normalized PostgreSQL import; legacy branch-lineage input is no longer transformed during tree-first import."
          : `Omitted ${tableName} from normalized PostgreSQL import; equivalent task/session facts are synthesized into project_tree_nodes/project_tree_branches instead.`,
      );
    }
  }
}

function normalizeValue(columnName: string, value: unknown, warnings: string[]) {
  if (typeof value === "string" && isTimestampColumn(columnName) && value === BAD_TIMESTAMP_LITERAL) {
    return nowIso();
  }

  if (JSONB_COLUMN_NAMES.has(columnName)) {
    if (value === null || value === undefined || value === "") {
      return null;
    }

    if (typeof value === "string") {
      try {
        return JSON.parse(value);
      } catch (error) {
        warnings.push(
          `Failed to parse JSON column ${columnName}: ${error instanceof Error ? error.message : String(error)}`,
        );
        return value;
      }
    }

    return value;
  }

  if (BOOLEAN_COLUMN_NAMES.has(columnName)) {
    return normalizeBooleanValue(value);
  }

  return value;
}

function pruneRowsWithMissingParents(
  rowsByTable: Map<string, Array<Record<string, unknown>>>,
  warnings: Record<string, string[]>,
) {
  const parentValueCache = new Map<string, Set<string>>();

  for (const tableName of getOrderedTables([...rowsByTable.keys()])) {
    const tableRules = KEY_FOREIGN_KEYS.filter((rule) => rule.table === tableName);
    if (tableRules.length === 0) {
      continue;
    }

    const rows = rowsByTable.get(tableName) ?? [];
    const filteredRows = rows.filter((row) => {
      for (const rule of tableRules) {
        const childValue = row[rule.column];
        if (childValue === null || childValue === undefined || childValue === "") {
          continue;
        }

        const targetColumn = rule.targetColumn ?? "id";
        const cacheKey = `${rule.targetTable}:${targetColumn}`;
        let parentValues = parentValueCache.get(cacheKey);
        if (!parentValues) {
          parentValues = new Set(
            (rowsByTable.get(rule.targetTable) ?? [])
              .map((targetRow) => targetRow[targetColumn])
              .filter((value): value is string | number =>
                typeof value === "string" || typeof value === "number",
              )
              .map((value) => String(value)),
          );
          parentValueCache.set(cacheKey, parentValues);
        }

        if (!parentValues.has(String(childValue))) {
          return false;
        }
      }

      return true;
    });

    const droppedCount = rows.length - filteredRows.length;
    if (droppedCount > 0) {
      warnings[tableName] = warnings[tableName] ?? [];
      warnings[tableName].push(
        `Dropped ${droppedCount} rows during FK normalization because required parent rows were missing in the SQLite snapshot.`,
      );
      rowsByTable.set(tableName, filteredRows);
    }
  }
}

export async function transformExportSnapshot(options: TransformExportOptions) {
  const inputDir = resolveInputPath(options.inputDir);
  const outputDir = resolveInputPath(options.outputDir);

  await ensureDir(outputDir);

  const sourceManifest = await readJsonFile<SnapshotManifest>(join(inputDir, "manifest.json"));
  const warnings: Record<string, string[]> = {};
  const rowsByTable = new Map<string, Array<Record<string, unknown>>>();
  const tableMetaByName = new Map(sourceManifest.tables.map((table) => [table.name, table]));

  for (const table of sourceManifest.tables) {
    const rows = await readJsonLines<Record<string, unknown>>(join(inputDir, table.fileName));
    const tableWarnings: string[] = [];
    const normalizedRows = rows.map((row) => {
      const normalized: Record<string, unknown> = {};
      for (const columnName of table.columns) {
        normalized[columnName] = normalizeValue(columnName, row[columnName], tableWarnings);
      }
      return normalized;
    });

    if (tableWarnings.length > 0) {
      warnings[table.name] = tableWarnings;
    }

    rowsByTable.set(table.name, normalizedRows);
  }

  synthesizeTreeTables(rowsByTable, tableMetaByName, warnings);

  pruneRowsWithMissingParents(rowsByTable, warnings);

  const normalizedTables = getOrderedTables([...rowsByTable.keys()]).map((tableName) => {
    const table = tableMetaByName.get(tableName);
    const normalizedRows = rowsByTable.get(tableName) ?? [];
    const columns = table?.columns ?? Object.keys(normalizedRows[0] ?? {});
    return {
      name: tableName,
      columns,
      rowCount: normalizedRows.length,
      primaryKeyColumn: getPrimaryKeyColumn(tableName),
      fileName: table?.fileName ?? `${tableName}.jsonl`,
    };
  });

  for (const table of normalizedTables) {
    const normalizedRows = rowsByTable.get(table.name) ?? [];
    await writeJsonLines(join(outputDir, table.fileName), normalizedRows);
    console.log(`Normalized ${table.name} (${normalizedRows.length} rows, pk=${table.primaryKeyColumn})`);
  }

  const normalizedManifest: SnapshotManifest = {
    kind: "normalized-export",
    generatedAt: nowIso(),
    sourceDir: inputDir,
    outputDir,
    sourceDatabasePath: sourceManifest.sourceDatabasePath,
    tables: normalizedTables,
    warnings,
  };

  await writeJsonFile(join(outputDir, "manifest.json"), normalizedManifest);
  return normalizedManifest;
}

if (import.meta.main) {
  const args = parseCliArgs();
  const inputDir = getStringArg(args, "in", join(DEFAULT_WORK_DIR, "export"));
  const outputDir = getStringArg(args, "out", join(DEFAULT_WORK_DIR, "normalized"));

  transformExportSnapshot({ inputDir, outputDir }).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}