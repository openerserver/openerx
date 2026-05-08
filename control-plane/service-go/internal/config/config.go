package config

import (
	"os"
	"path/filepath"
	"runtime"
	"strconv"
)

const DefaultJWTSecret = "openerx-dev-secret-change-in-production"

type Config struct {
	Port          string
	CORSOrigin    string
	DatabaseURL   string
	DBMaxConns    int32
	JWTSecret     string
	MigrationsDir string
}

func Load() Config {
	_, file, _, _ := runtime.Caller(0)
	serviceGoRoot := filepath.Clean(filepath.Join(filepath.Dir(file), "../.."))
	repoRoot := filepath.Clean(filepath.Join(serviceGoRoot, "../.."))

	port := firstNonEmpty(os.Getenv("PORT"), "4097")
	dbMax := int32(10)
	if raw := os.Getenv("CONTROL_PLANE_DB_MAX_CONNECTIONS"); raw != "" {
		if parsed, err := strconv.Atoi(raw); err == nil && parsed > 0 {
			dbMax = int32(parsed)
		}
	}

	return Config{
		Port:          port,
		CORSOrigin:    firstNonEmpty(os.Getenv("CORS_ORIGIN"), "http://localhost:5173"),
		DatabaseURL:   firstNonEmpty(os.Getenv("DATABASE_URL"), os.Getenv("TEST_DATABASE_URL"), "postgres://127.0.0.1:5432/openerx"),
		DBMaxConns:    dbMax,
		JWTSecret:     firstNonEmpty(os.Getenv("JWT_SECRET"), DefaultJWTSecret),
		MigrationsDir: firstNonEmpty(os.Getenv("CONTROL_PLANE_MIGRATIONS_DIR"), filepath.Join(repoRoot, "control-plane/service/drizzle-pg")),
	}
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if value != "" {
			return value
		}
	}
	return ""
}
