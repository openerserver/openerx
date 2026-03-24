import { join } from "node:path";
import { exportSqliteSnapshot } from "./export-sqlite";
import { importPostgresSnapshot } from "./import-postgres";
import {
  DEFAULT_SQLITE_SNAPSHOT_PATH,
  DEFAULT_WORK_DIR,
  ensureDir,
  getBooleanArg,
  getStringArg,
  nowIso,
  parseCliArgs,
  resolveInputPath,
  writeJsonFile,
} from "./metadata";
import { transformExportSnapshot } from "./transform-export";
import { validatePostgresSnapshot } from "./validate-postgres";

export interface SqliteToPostgresOptions {
  sqlitePath: string;
  workDir: string;
  truncateFirst?: boolean;
}

export async function migrateSqliteSnapshotToPostgres(options: SqliteToPostgresOptions) {
  const sqlitePath = resolveInputPath(options.sqlitePath);
  const workDir = resolveInputPath(options.workDir);
  const runDir = join(workDir, `run-${nowIso().replaceAll(":", "-")}`);
  const exportDir = join(runDir, "export");
  const normalizedDir = join(runDir, "normalized");

  await ensureDir(exportDir);
  await ensureDir(normalizedDir);

  await exportSqliteSnapshot({ sqlitePath, outputDir: exportDir });
  await transformExportSnapshot({ inputDir: exportDir, outputDir: normalizedDir });
  await importPostgresSnapshot({ inputDir: normalizedDir, truncateFirst: options.truncateFirst });
  const summary = await validatePostgresSnapshot({ inputDir: normalizedDir, outputDir: runDir });

  await writeJsonFile(join(runDir, "run-summary.json"), {
    generatedAt: nowIso(),
    sqlitePath,
    exportDir,
    normalizedDir,
    validationReport: join(runDir, "validation-report.json"),
    summary,
  });

  console.log(`SQLite snapshot migration completed. Artifacts: ${runDir}`);
  return runDir;
}

if (import.meta.main) {
  const args = parseCliArgs();
  const sqlitePath = getStringArg(args, "sqlite", DEFAULT_SQLITE_SNAPSHOT_PATH);
  const workDir = getStringArg(args, "work-dir", DEFAULT_WORK_DIR);
  const truncateFirst = getBooleanArg(args, "truncate", false);

  migrateSqliteSnapshotToPostgres({ sqlitePath, workDir, truncateFirst }).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
