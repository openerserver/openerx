import { basename, join } from "node:path";
import { Database } from "bun:sqlite";
import {
  DEFAULT_SQLITE_SNAPSHOT_PATH,
  SnapshotManifest,
  TableManifest,
  ensureDir,
  getPrimaryKeyColumn,
  getStringArg,
  nowIso,
  parseCliArgs,
  resolveInputPath,
  writeJsonFile,
  writeJsonLines,
} from "./metadata";

export interface ExportSqliteSnapshotOptions {
  sqlitePath: string;
  outputDir: string;
}

function getTableNames(sqlite: Database) {
  return sqlite
    .query(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name != '__drizzle_migrations' ORDER BY name",
    )
    .all() as Array<{ name: string }>;
}

function getTableColumns(sqlite: Database, tableName: string) {
  return sqlite.query(`PRAGMA table_info(\"${tableName}\")`).all() as Array<{ name: string }>;
}

export async function exportSqliteSnapshot(options: ExportSqliteSnapshotOptions) {
  const sqlitePath = resolveInputPath(options.sqlitePath);
  const outputDir = resolveInputPath(options.outputDir);

  await ensureDir(outputDir);

  const sqlite = new Database(sqlitePath, { readonly: true });

  try {
    const tables = getTableNames(sqlite);
    const manifestTables: TableManifest[] = [];

    for (const { name } of tables) {
      const fileName = `${name}.jsonl`;
      const rows = sqlite.query(`SELECT * FROM \"${name}\"`).all() as Array<Record<string, unknown>>;
      const columns = getTableColumns(sqlite, name).map((column) => column.name);
      await writeJsonLines(join(outputDir, fileName), rows);
      manifestTables.push({
        name,
        columns,
        rowCount: rows.length,
        primaryKeyColumn: getPrimaryKeyColumn(name),
        fileName,
      });
      console.log(`Exported ${name} (${rows.length} rows) -> ${basename(fileName)}`);
    }

    const manifest: SnapshotManifest = {
      kind: "sqlite-export",
      generatedAt: nowIso(),
      sourceDatabasePath: sqlitePath,
      outputDir,
      tables: manifestTables,
    };
    await writeJsonFile(join(outputDir, "manifest.json"), manifest);
    return manifest;
  } finally {
    sqlite.close();
  }
}

if (import.meta.main) {
  const args = parseCliArgs();
  const sqlitePath = getStringArg(args, "sqlite", DEFAULT_SQLITE_SNAPSHOT_PATH);
  const outputDir = getStringArg(args, "out", join(process.cwd(), "tmp/sqlite-export"));

  exportSqliteSnapshot({ sqlitePath, outputDir }).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}