package db

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

const migrationLockKey int64 = 88411230041

type journal struct {
	Entries []journalEntry `json:"entries"`
}

type journalEntry struct {
	When int64  `json:"when"`
	Tag  string `json:"tag"`
}

type migrationFile struct {
	When       int64
	Tag        string
	Path       string
	Hash       string
	Statements []string
}

func EnsureMigrations(ctx context.Context, pool *pgxpool.Pool, migrationsDir string) error {
	started := time.Now()
	conn, err := pool.Acquire(ctx)
	if err != nil {
		return err
	}
	defer conn.Release()

	if _, err := conn.Exec(ctx, `SELECT pg_advisory_lock($1::bigint)`, migrationLockKey); err != nil {
		return err
	}
	defer func() {
		_, _ = conn.Exec(context.Background(), `SELECT pg_advisory_unlock($1::bigint)`, migrationLockKey)
	}()

	if _, err := conn.Exec(ctx, `CREATE SCHEMA IF NOT EXISTS "drizzle"`); err != nil {
		return err
	}
	if _, err := conn.Exec(ctx, `
		CREATE TABLE IF NOT EXISTS "drizzle"."__drizzle_migrations" (
			id SERIAL PRIMARY KEY,
			hash text NOT NULL,
			created_at bigint
		)
	`); err != nil {
		return err
	}

	files, err := readMigrationFiles(migrationsDir)
	if err != nil {
		return err
	}

	last, err := lastAppliedMigration(ctx, conn)
	if err != nil {
		return err
	}

	applied := 0
	for _, file := range files {
		if last != nil && *last >= file.When {
			continue
		}
		if err := applyMigration(ctx, conn.Conn(), file); err != nil {
			return fmt.Errorf("apply migration %s: %w", file.Tag, err)
		}
		applied++
		last = &file.When
	}

	fmt.Printf("[db:migrate:pg:go] durationMs=%d appliedCount=%d latestAppliedMillis=%v\n", time.Since(started).Milliseconds(), applied, nullableInt(last))
	return nil
}

func lastAppliedMigration(ctx context.Context, q interface {
	QueryRow(context.Context, string, ...any) pgx.Row
}) (*int64, error) {
	var value int64
	err := q.QueryRow(ctx, `
		SELECT created_at
		FROM "drizzle"."__drizzle_migrations"
		ORDER BY created_at DESC
		LIMIT 1
	`).Scan(&value)
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &value, nil
}

func applyMigration(ctx context.Context, conn *pgx.Conn, file migrationFile) error {
	tx, err := conn.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	for _, statement := range file.Statements {
		if strings.TrimSpace(statement) == "" {
			continue
		}
		if _, err := tx.Exec(ctx, statement); err != nil {
			return err
		}
	}
	if _, err := tx.Exec(ctx, `INSERT INTO "drizzle"."__drizzle_migrations" ("hash", "created_at") VALUES ($1, $2)`, file.Hash, file.When); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func readMigrationFiles(dir string) ([]migrationFile, error) {
	raw, err := os.ReadFile(filepath.Join(dir, "meta/_journal.json"))
	if err != nil {
		return nil, err
	}
	var j journal
	if err := json.Unmarshal(raw, &j); err != nil {
		return nil, err
	}

	files := make([]migrationFile, 0, len(j.Entries))
	for _, entry := range j.Entries {
		path := filepath.Join(dir, entry.Tag+".sql")
		sqlRaw, err := os.ReadFile(path)
		if err != nil {
			return nil, err
		}
		sum := sha256.Sum256(sqlRaw)
		files = append(files, migrationFile{
			When:       entry.When,
			Tag:        entry.Tag,
			Path:       path,
			Hash:       hex.EncodeToString(sum[:]),
			Statements: splitDrizzleStatements(string(sqlRaw)),
		})
	}
	sort.Slice(files, func(i, j int) bool { return files[i].When < files[j].When })
	return files, nil
}

func splitDrizzleStatements(input string) []string {
	parts := strings.Split(input, "--> statement-breakpoint")
	out := make([]string, 0, len(parts))
	for _, part := range parts {
		trimmed := strings.TrimSpace(part)
		if trimmed != "" {
			out = append(out, trimmed)
		}
	}
	return out
}

func nullableInt(value *int64) any {
	if value == nil {
		return "none"
	}
	return *value
}
