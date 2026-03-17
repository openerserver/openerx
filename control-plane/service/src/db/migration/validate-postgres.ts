import { join } from "node:path";
import {
  KEY_FOREIGN_KEYS,
  SAMPLE_TABLES,
  SnapshotManifest,
  ensureDir,
  getPrimaryKeyColumn,
  getStringArg,
  nowIso,
  parseCliArgs,
  quoteIdentifier,
  readJsonFile,
  readJsonLines,
  resolveInputPath,
  writeJsonFile,
} from "./metadata";
import { openPostgresDatabase } from "../postgres-client";

interface TableValidationReport {
  table: string;
  expectedRows: number;
  actualRows: number;
  primaryKeyColumn: string;
  expectedPrimaryKeyCoverage: number;
  actualPrimaryKeyCoverage: number;
  actualDistinctPrimaryKeys: number;
  samplesChecked: number;
  missingSamples: string[];
}

export interface ValidatePostgresSnapshotOptions {
  inputDir: string;
  outputDir?: string;
}

async function queryOne<T>(query: string, values: unknown[] = []) {
  const { sql } = openPostgresDatabase({ logPrefix: "[db:validate:pg]" });
  try {
    const rows = (await sql.unsafe(query, values as never[])) as T[];
    return rows[0] ?? null;
  } finally {
    await sql.end();
  }
}

async function buildTableReport(inputDir: string, table: SnapshotManifest["tables"][number]) {
  const primaryKeyColumn = getPrimaryKeyColumn(table.name);
  const rows = await readJsonLines<Record<string, unknown>>(join(inputDir, table.fileName));
  const expectedPrimaryKeyCoverage = rows.filter((row) => {
    const value = row[primaryKeyColumn];
    return value !== null && value !== undefined && String(value).length > 0;
  }).length;

  const actual = (await queryOne<{
    total: string;
    populated: string;
    distinct_count: string;
  }>(
    `SELECT COUNT(*)::text AS total, COUNT(${quoteIdentifier(primaryKeyColumn)})::text AS populated, COUNT(DISTINCT ${quoteIdentifier(primaryKeyColumn)})::text AS distinct_count FROM ${quoteIdentifier(table.name)}`,
  )) ?? { total: "0", populated: "0", distinct_count: "0" };

  const sampleValues = rows
    .map((row) => row[primaryKeyColumn])
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .slice(0, 3);
  const missingSamples: string[] = [];

  for (const sampleValue of sampleValues) {
    const found = await queryOne<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM ${quoteIdentifier(table.name)} WHERE ${quoteIdentifier(primaryKeyColumn)} = $1`,
      [sampleValue],
    );
    if (!found || Number(found.count) === 0) {
      missingSamples.push(sampleValue);
    }
  }

  return {
    table: table.name,
    expectedRows: table.rowCount,
    actualRows: Number(actual.total),
    primaryKeyColumn,
    expectedPrimaryKeyCoverage,
    actualPrimaryKeyCoverage: Number(actual.populated),
    actualDistinctPrimaryKeys: Number(actual.distinct_count),
    samplesChecked: sampleValues.length,
    missingSamples,
  } satisfies TableValidationReport;
}

async function validateForeignKeys() {
  const results: Array<{
    table: string;
    column: string;
    targetTable: string;
    targetColumn: string;
    missingReferences: number;
  }> = [];

  for (const rule of KEY_FOREIGN_KEYS) {
    const targetColumn = rule.targetColumn ?? "id";
    const row =
      (await queryOne<{ count: string }>(
        `SELECT COUNT(*)::text AS count
         FROM ${quoteIdentifier(rule.table)} child
         LEFT JOIN ${quoteIdentifier(rule.targetTable)} parent
           ON child.${quoteIdentifier(rule.column)} = parent.${quoteIdentifier(targetColumn)}
         WHERE child.${quoteIdentifier(rule.column)} IS NOT NULL
           AND parent.${quoteIdentifier(targetColumn)} IS NULL`,
      )) ?? { count: "0" };
    results.push({
      table: rule.table,
      column: rule.column,
      targetTable: rule.targetTable,
      targetColumn,
      missingReferences: Number(row.count),
    });
  }

  return results;
}

export async function validatePostgresSnapshot(options: ValidatePostgresSnapshotOptions) {
  const inputDir = resolveInputPath(options.inputDir);
  const outputDir = resolveInputPath(options.outputDir ?? inputDir);
  await ensureDir(outputDir);

  const manifest = await readJsonFile<SnapshotManifest>(join(inputDir, "manifest.json"));
  const tableReports: TableValidationReport[] = [];
  for (const table of manifest.tables) {
    tableReports.push(await buildTableReport(inputDir, table));
  }

  const foreignKeyReports = await validateForeignKeys();
  const summary = {
    generatedAt: nowIso(),
    tableReports,
    foreignKeyReports,
    sampleTablesCovered: SAMPLE_TABLES.filter((tableName) =>
      tableReports.some((report) => report.table === tableName),
    ),
  };

  await writeJsonFile(join(outputDir, "validation-report.json"), {
    kind: "validation-report",
    generatedAt: summary.generatedAt,
    tables: manifest.tables,
    stats: summary,
  });

  const failedRowCounts = tableReports.filter((report) => report.expectedRows !== report.actualRows);
  const failedPrimaryKeys = tableReports.filter(
    (report) =>
      report.expectedPrimaryKeyCoverage !== report.actualPrimaryKeyCoverage ||
      report.actualPrimaryKeyCoverage !== report.actualDistinctPrimaryKeys ||
      report.missingSamples.length > 0,
  );
  const failedForeignKeys = foreignKeyReports.filter((report) => report.missingReferences > 0);

  if (failedRowCounts.length > 0 || failedPrimaryKeys.length > 0 || failedForeignKeys.length > 0) {
    throw new Error(
      `PostgreSQL validation failed: rowCount=${failedRowCounts.length}, primaryKey=${failedPrimaryKeys.length}, foreignKey=${failedForeignKeys.length}. See validation-report.json for details.`,
    );
  }

  console.log(`Validated ${tableReports.length} tables and ${foreignKeyReports.length} key foreign keys.`);
  return summary;
}

if (import.meta.main) {
  const args = parseCliArgs();
  const inputDir = getStringArg(args, "in", join(process.cwd(), "tmp/sqlite-pg-migration/normalized"));
  const outputDir = getStringArg(args, "out", inputDir);

  validatePostgresSnapshot({ inputDir, outputDir }).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}