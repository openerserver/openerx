import { Database } from "bun:sqlite";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DB_DIR = dirname(fileURLToPath(import.meta.url));
const SERVICE_ROOT = resolve(DB_DIR, "../..");

export function resolveDatabaseUrl(databaseUrl = process.env.DATABASE_URL) {
	if (!databaseUrl) {
		return resolve(SERVICE_ROOT, "data/openerx.db");
	}

	return isAbsolute(databaseUrl)
		? databaseUrl
		: resolve(SERVICE_ROOT, databaseUrl);
}

function isSqliteBusyError(error: unknown) {
	if (!(error instanceof Error)) {
		return false;
	}

	const sqliteError = error as Error & {
		code?: string;
		errno?: number;
	};

	return sqliteError.code?.startsWith("SQLITE_BUSY") === true
		|| sqliteError.errno === 5
		|| sqliteError.errno === 261
		|| /database is locked/i.test(error.message);
}

export function configureSqliteConnection(
	sqlite: Database,
	options: { databaseUrl?: string; logPrefix?: string } = {},
) {
	sqlite.exec("PRAGMA busy_timeout = 5000");

	try {
		sqlite.exec("PRAGMA journal_mode = WAL");
	} catch (error) {
		if (!isSqliteBusyError(error)) {
			throw error;
		}

		const prefix = options.logPrefix ? `${options.logPrefix} ` : "";
		const target = options.databaseUrl || "SQLite database";
		console.warn(
			`${prefix}SQLite WAL mode is temporarily unavailable for ${target}; continuing with the existing journal mode because the database is locked by another connection.`,
		);
		console.warn(error instanceof Error ? error.message : String(error));
	}

	sqlite.exec("PRAGMA foreign_keys = ON");
}