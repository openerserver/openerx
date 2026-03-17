import { join } from "node:path";
import {
  BAD_TIMESTAMP_LITERAL,
  BOOLEAN_COLUMN_NAMES,
  DEFAULT_WORK_DIR,
  JSONB_COLUMN_NAMES,
  KEY_FOREIGN_KEYS,
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

  pruneRowsWithMissingParents(rowsByTable, warnings);

  const normalizedTables = sourceManifest.tables.map((table) => {
    const normalizedRows = rowsByTable.get(table.name) ?? [];
    return {
      ...table,
      rowCount: normalizedRows.length,
      primaryKeyColumn: getPrimaryKeyColumn(table.name),
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