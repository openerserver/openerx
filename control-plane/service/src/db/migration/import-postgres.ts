import { join } from "node:path";
import {
  SnapshotManifest,
  getBooleanArg,
  getOrderedTables,
  getStringArg,
  parseCliArgs,
  quoteIdentifier,
  readJsonFile,
  readJsonLines,
  resolveInputPath,
} from "./metadata";
import { openPostgresDatabase } from "../postgres-client";

export interface ImportPostgresSnapshotOptions {
  inputDir: string;
  truncateFirst?: boolean;
}

async function truncateTables(tableNames: string[]) {
  const { sql } = openPostgresDatabase({ logPrefix: "[db:import:pg]" });
  try {
    const joined = [...tableNames].reverse().map(quoteIdentifier).join(", ");
    if (joined.length > 0) {
      await sql.unsafe(`TRUNCATE TABLE ${joined} CASCADE`);
    }
  } finally {
    await sql.end();
  }
}

async function insertBatch(
  tableName: string,
  columns: string[],
  rows: Array<Record<string, unknown>>,
) {
  if (rows.length === 0) {
    return;
  }

  const { sql } = openPostgresDatabase({ logPrefix: `[db:import:pg:${tableName}]` });
  try {
    const values: unknown[] = [];
    const placeholders = rows
      .map((row, rowIndex) => {
        const rowPlaceholders = columns.map((columnName, columnIndex) => {
          values.push(row[columnName] ?? null);
          return `$${rowIndex * columns.length + columnIndex + 1}`;
        });
        return `(${rowPlaceholders.join(", ")})`;
      })
      .join(", ");

    const query = `INSERT INTO ${quoteIdentifier(tableName)} (${columns
      .map(quoteIdentifier)
      .join(", ")}) VALUES ${placeholders} ON CONFLICT DO NOTHING`;
    await sql.unsafe(query, values as never[]);
  } finally {
    await sql.end();
  }
}

export async function importPostgresSnapshot(options: ImportPostgresSnapshotOptions) {
  const inputDir = resolveInputPath(options.inputDir);
  const manifest = await readJsonFile<SnapshotManifest>(join(inputDir, "manifest.json"));
  const orderedTables = getOrderedTables(manifest.tables.map((table) => table.name));

  if (options.truncateFirst) {
    await truncateTables(orderedTables);
  }

  for (const tableName of orderedTables) {
    const table = manifest.tables.find((entry) => entry.name === tableName);
    if (!table) {
      continue;
    }

    const rows = await readJsonLines<Record<string, unknown>>(join(inputDir, table.fileName));
    const batchSize = 100;
    for (let index = 0; index < rows.length; index += batchSize) {
      const batch = rows.slice(index, index + batchSize);
      await insertBatch(table.name, table.columns, batch);
    }

    console.log(`Imported ${table.name} (${rows.length} rows)`);
  }

  return manifest;
}

if (import.meta.main) {
  const args = parseCliArgs();
  const inputDir = getStringArg(args, "in", join(process.cwd(), "tmp/sqlite-pg-migration/normalized"));
  const truncateFirst = getBooleanArg(args, "truncate", false);

  importPostgresSnapshot({ inputDir, truncateFirst }).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}