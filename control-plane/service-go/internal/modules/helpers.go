package modules

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"openerx/control-plane/service-go/internal/auth"
	"openerx/control-plane/service-go/internal/web"
)

type userRecord struct {
	ID                  string
	Username            string
	PhoneNumber         *string
	PasswordHash        string
	DisplayName         string
	Email               *string
	Role                string
	AccountStatus       string
	MustChangePassword  bool
	TokenVersion        int
	FailedLoginAttempts int
	LockedUntil         *time.Time
	LastLoginAt         *time.Time
	CreatedAt           time.Time
}

type projectRoleRecord struct {
	ProjectID string
	Role      string
}

func scanUser(row pgx.Row) (*userRecord, error) {
	var u userRecord
	err := row.Scan(
		&u.ID,
		&u.Username,
		&u.PhoneNumber,
		&u.PasswordHash,
		&u.DisplayName,
		&u.Email,
		&u.Role,
		&u.AccountStatus,
		&u.MustChangePassword,
		&u.TokenVersion,
		&u.FailedLoginAttempts,
		&u.LockedUntil,
		&u.LastLoginAt,
		&u.CreatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &u, nil
}

const userColumns = `
	id, username, phone_number, password_hash, display_name, email, role, account_status,
	must_change_password, token_version, failed_login_attempts, locked_until, last_login_at, created_at
`

func (api API) loadUserByID(ctx context.Context, id string) (*userRecord, error) {
	return scanUser(api.DB.QueryRow(ctx, `SELECT `+userColumns+` FROM users WHERE id=$1`, id))
}

func (api API) loadUserByUsername(ctx context.Context, username string) (*userRecord, error) {
	return scanUser(api.DB.QueryRow(ctx, `SELECT `+userColumns+` FROM users WHERE username=$1`, username))
}

func (api API) loadUserByPhone(ctx context.Context, phone string) (*userRecord, error) {
	return scanUser(api.DB.QueryRow(ctx, `SELECT `+userColumns+` FROM users WHERE phone_number=$1`, phone))
}

func (api API) loadProjectRoles(ctx context.Context, userID string) ([]projectRoleRecord, error) {
	rows, err := api.DB.Query(ctx, `SELECT project_id, role FROM project_roles WHERE user_id=$1 ORDER BY project_id`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var roles []projectRoleRecord
	for rows.Next() {
		var role projectRoleRecord
		if err := rows.Scan(&role.ProjectID, &role.Role); err != nil {
			return nil, err
		}
		roles = append(roles, role)
	}
	return roles, rows.Err()
}

func projectClaims(roles []projectRoleRecord) []auth.ProjectClaim {
	claims := make([]auth.ProjectClaim, 0, len(roles))
	for _, role := range roles {
		claims = append(claims, auth.ProjectClaim{ID: role.ProjectID, Role: role.Role})
	}
	return claims
}

func projectSummary(roles []projectRoleRecord) []map[string]any {
	items := make([]map[string]any, 0, len(roles))
	for _, role := range roles {
		items = append(items, map[string]any{"id": role.ProjectID, "role": role.Role})
	}
	return items
}

func publicUser(u userRecord, roles []projectRoleRecord) map[string]any {
	return map[string]any{
		"id":                 u.ID,
		"username":           u.Username,
		"phoneNumber":        u.PhoneNumber,
		"displayName":        u.DisplayName,
		"email":              u.Email,
		"role":               u.Role,
		"accountStatus":      u.AccountStatus,
		"mustChangePassword": u.MustChangePassword,
		"lastLoginAt":        web.NormalizeTime(u.LastLoginAt),
		"createdAt":          u.CreatedAt.UTC().Format(time.RFC3339Nano),
		"projects":           projectSummary(roles),
	}
}

func boolValue(v *bool, fallback bool) bool {
	if v == nil {
		return fallback
	}
	return *v
}

func stringPtr(value string) *string {
	return &value
}

func decodeBody(w http.ResponseWriter, r *http.Request, target any) bool {
	if err := web.DecodeJSON(r, target); err != nil {
		web.Error(w, http.StatusBadRequest, err.Error())
		return false
	}
	return true
}

func requireRole(minRole string, next http.Handler) http.Handler {
	return auth.RequireRole(minRole, next)
}

func parseLimit(r *http.Request, fallback int, max int) int {
	limit := fallback
	if raw := r.URL.Query().Get("limit"); raw != "" {
		if parsed, err := strconv.Atoi(raw); err == nil {
			limit = parsed
		}
	}
	if limit < 1 {
		return 1
	}
	if limit > max {
		return max
	}
	return limit
}

func jsonBytes(value any) ([]byte, error) {
	if value == nil {
		return nil, nil
	}
	return json.Marshal(value)
}

func scanJSONMap(value []byte) map[string]any {
	if len(value) == 0 {
		return nil
	}
	var out map[string]any
	_ = json.Unmarshal(value, &out)
	return out
}

func textFromPgText(value pgtype.Text) *string {
	if !value.Valid {
		return nil
	}
	return &value.String
}
