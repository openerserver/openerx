import { join } from "node:path";
import {
  BAD_TIMESTAMP_LITERAL,
  BOOLEAN_COLUMN_NAMES,
  DEFAULT_WORK_DIR,
  JSONB_COLUMN_NAMES,
  KEY_FOREIGN_KEYS,
  LEGACY_OFFLINE_SOURCE_TABLES,
  type SnapshotManifest,
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

function pushTableWarning(warnings: Record<string, string[]>, tableName: string, message: string) {
  warnings[tableName] = warnings[tableName] ?? [];
  warnings[tableName].push(message);
}

function buildProjectRootNode(project: Record<string, unknown>) {
  const projectId = asString(project.id);
  if (!projectId) {
    return null;
  }

  const createdAt = asString(project.created_at) ?? nowIso();
  const updatedAt = asString(project.updated_at) ?? createdAt;

  return {
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
}

function buildProjectMainBranch(rootNode: Record<string, unknown>) {
  return {
    id: buildProjectMainBranchId(String(rootNode.project_id)),
    project_id: rootNode.project_id,
    task_node_id: null,
    branch_name: "main",
    head_node_id: rootNode.id,
    is_default: true,
    created_at: rootNode.created_at,
    updated_at: rootNode.updated_at,
  } satisfies Record<string, unknown>;
}

function synthesizeProjectRoots(projects: Array<Record<string, unknown>>) {
  const projectRootNodes: Array<Record<string, unknown>> = [];
  const projectBranches: Array<Record<string, unknown>> = [];
  const nodeRowsById = new Map<string, Record<string, unknown>>();

  for (const project of projects) {
    const rootNode = buildProjectRootNode(project);
    if (!rootNode) {
      continue;
    }

    projectRootNodes.push(rootNode);
    projectBranches.push(buildProjectMainBranch(rootNode));
    nodeRowsById.set(String(rootNode.id), rootNode);
  }

  return { projectRootNodes, projectBranches, nodeRowsById };
}

function buildLegacyTaskNode(task: Record<string, unknown>, rootNodeId: string) {
  const taskId = asString(task.id);
  const projectId = asString(task.project_id);
  if (!taskId || !projectId) {
    return null;
  }

  const createdAt = asString(task.created_at) ?? nowIso();
  const updatedAt = asString(task.finished_at) ?? asString(task.started_at) ?? createdAt;

  return {
    id: taskId,
    project_id: projectId,
    parent_id: rootNodeId,
    path: buildTaskPath(projectId, taskId),
    depth: 1,
    node_type: "task",
    role: null,
    content_text: asString(task.title),
    content_json: {},
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
}

function synthesizeLegacyTaskNodes(args: {
  legacyTasks: Array<Record<string, unknown>>;
  nodeRowsById: Map<string, Record<string, unknown>>;
  warnings: Record<string, string[]>;
}) {
  const taskNodes: Array<Record<string, unknown>> = [];

  for (const task of args.legacyTasks) {
    const taskId = asString(task.id);
    const projectId = asString(task.project_id);
    if (!taskId || !projectId) {
      pushTableWarning(
        args.warnings,
        "project_tree_nodes",
        "Skipped legacy task row without id/project_id while synthesizing project_tree_nodes.",
      );
      continue;
    }

    const rootNodeId = buildProjectRootNodeId(projectId);
    if (!args.nodeRowsById.has(rootNodeId)) {
      pushTableWarning(
        args.warnings,
        "project_tree_nodes",
        `Skipped legacy task ${taskId} because project root ${rootNodeId} was missing.`,
      );
      continue;
    }

    const taskNode = buildLegacyTaskNode(task, rootNodeId);
    if (!taskNode) {
      continue;
    }

    taskNodes.push(taskNode);
    args.nodeRowsById.set(taskId, taskNode);
  }

  return taskNodes;
}

function ensureSynthesizedTreeTableMetadata(
  tableMetaByName: Map<string, SnapshotManifest["tables"][number]>,
) {
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
}

function pruneLegacySourceTables(
  rowsByTable: Map<string, Array<Record<string, unknown>>>,
  warnings: Record<string, string[]>,
  consumedLegacyTasks: boolean,
) {
  if (consumedLegacyTasks && rowsByTable.delete("tasks")) {
    pushTableWarning(
      warnings,
      "tasks",
      "Omitted legacy tasks from normalized PostgreSQL import; equivalent task facts are synthesized into project_tree_nodes/project_tree_branches during tree-first import.",
    );
  }

  for (const tableName of LEGACY_OFFLINE_SOURCE_TABLES) {
    if (rowsByTable.delete(tableName)) {
      pushTableWarning(
        warnings,
        tableName,
        tableName === "task_sessions"
          ? "Omitted task_sessions from normalized PostgreSQL import; legacy branch-lineage input is no longer transformed during tree-first import."
          : `Omitted ${tableName} from normalized PostgreSQL import; equivalent task/session facts are synthesized into project_tree_nodes/project_tree_branches instead.`,
      );
    }
  }
}

function synthesizeTreeTables(
  rowsByTable: Map<string, Array<Record<string, unknown>>>,
  tableMetaByName: Map<string, SnapshotManifest["tables"][number]>,
  warnings: Record<string, string[]>,
) {
  const projects = rowsByTable.get("projects") ?? [];
  const existingNodeRows = rowsByTable.get("project_tree_nodes") ?? [];
  const consumedLegacyTasks = existingNodeRows.length === 0;
  const legacyTasks = consumedLegacyTasks ? (rowsByTable.get("tasks") ?? []) : [];

  if (projects.length === 0 && legacyTasks.length === 0) {
    return;
  }

  const { projectRootNodes, projectBranches, nodeRowsById } = synthesizeProjectRoots(projects);
  const taskNodes = synthesizeLegacyTaskNodes({
    legacyTasks,
    nodeRowsById,
    warnings,
  });

  const existingBranchRows = rowsByTable.get("project_tree_branches") ?? [];
  rowsByTable.set(
    "project_tree_nodes",
    mergeRowsById(existingNodeRows, [...projectRootNodes, ...taskNodes]),
  );
  rowsByTable.set("project_tree_branches", mergeRowsById(existingBranchRows, projectBranches));

  ensureSynthesizedTreeTableMetadata(tableMetaByName);
  pruneLegacySourceTables(rowsByTable, warnings, consumedLegacyTasks);
}

function normalizeTimestampValue(columnName: string, value: unknown) {
  if (
    typeof value === "string" &&
    isTimestampColumn(columnName) &&
    value === BAD_TIMESTAMP_LITERAL
  ) {
    return nowIso();
  }

  return value;
}

function normalizeJsonValue(columnName: string, value: unknown, warnings: string[]) {
  if (!JSONB_COLUMN_NAMES.has(columnName)) {
    return value;
  }

  if (value === null || value === undefined || value === "") {
    return null;
  }

  if (typeof value !== "string") {
    return value;
  }

  try {
    return JSON.parse(value);
  } catch (error) {
    warnings.push(
      `Failed to parse JSON column ${columnName}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return value;
  }
}

function normalizeValue(columnName: string, value: unknown, warnings: string[]) {
  const normalizedTimestamp = normalizeTimestampValue(columnName, value);
  const normalizedJson = normalizeJsonValue(columnName, normalizedTimestamp, warnings);

  if (BOOLEAN_COLUMN_NAMES.has(columnName)) {
    return normalizeBooleanValue(normalizedJson);
  }

  return normalizedJson;
}

function getParentValuesForRule(args: {
  rowsByTable: Map<string, Array<Record<string, unknown>>>;
  parentValueCache: Map<string, Set<string>>;
  targetTable: string;
  targetColumn: string;
}) {
  const cacheKey = `${args.targetTable}:${args.targetColumn}`;
  let parentValues = args.parentValueCache.get(cacheKey);
  if (!parentValues) {
    parentValues = new Set(
      (args.rowsByTable.get(args.targetTable) ?? [])
        .map((targetRow) => targetRow[args.targetColumn])
        .filter(
          (value): value is string | number =>
            typeof value === "string" || typeof value === "number",
        )
        .map((value) => String(value)),
    );
    args.parentValueCache.set(cacheKey, parentValues);
  }
  return parentValues;
}

function rowHasRequiredParents(args: {
  row: Record<string, unknown>;
  tableRules: typeof KEY_FOREIGN_KEYS;
  rowsByTable: Map<string, Array<Record<string, unknown>>>;
  parentValueCache: Map<string, Set<string>>;
}) {
  for (const rule of args.tableRules) {
    const childValue = args.row[rule.column];
    if (childValue === null || childValue === undefined || childValue === "") {
      continue;
    }

    const targetColumn = rule.targetColumn ?? "id";
    const parentValues = getParentValuesForRule({
      rowsByTable: args.rowsByTable,
      parentValueCache: args.parentValueCache,
      targetTable: rule.targetTable,
      targetColumn,
    });
    if (!parentValues.has(String(childValue))) {
      return false;
    }
  }

  return true;
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
    const filteredRows = rows.filter((row) =>
      rowHasRequiredParents({ row, tableRules, rowsByTable, parentValueCache }),
    );

    const droppedCount = rows.length - filteredRows.length;
    if (droppedCount > 0) {
      pushTableWarning(
        warnings,
        tableName,
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
    console.log(
      `Normalized ${table.name} (${normalizedRows.length} rows, pk=${table.primaryKeyColumn})`,
    );
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
