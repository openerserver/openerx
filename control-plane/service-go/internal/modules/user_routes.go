package modules

import (
	"context"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"golang.org/x/crypto/bcrypt"

	authpkg "openerx/control-plane/service-go/internal/auth"
	"openerx/control-plane/service-go/internal/web"
)

var usernamePattern = regexp.MustCompile(`^[a-zA-Z0-9_-]+$`)

type createUserRequest struct {
	Username           string  `json:"username"`
	Password           string  `json:"password"`
	DisplayName        string  `json:"displayName"`
	Email              *string `json:"email"`
	MustChangePassword *bool   `json:"mustChangePassword"`
	Role               string  `json:"role"`
}

type updateUserRequest struct {
	DisplayName *string `json:"displayName"`
	Password    string  `json:"password"`
	Email       *string `json:"email"`
}

type roleRequest struct {
	Role string `json:"role"`
}

type statusRequest struct {
	Status string `json:"status"`
}

type resetPasswordRequest struct {
	Password           string `json:"password"`
	MustChangePassword *bool  `json:"mustChangePassword"`
}

func (api API) UserRoutes(r chi.Router) {
	orgAdmin := func(next http.Handler) http.Handler { return requireRole("org_admin", next) }
	platformAdmin := func(next http.Handler) http.Handler { return requireRole("platform_admin", next) }
	r.With(orgAdmin).Get("/", api.listUsers)
	r.With(orgAdmin).Post("/", api.createUser)
	r.With(orgAdmin).Patch("/{userId}", api.updateUser)
	r.With(platformAdmin).Put("/{userId}/role", api.setUserRole)
	r.With(orgAdmin).Put("/{userId}/status", api.setUserStatus)
	r.With(orgAdmin).Put("/{userId}/password", api.resetUserPassword)
}

func (api API) listUsers(w http.ResponseWriter, r *http.Request) {
	rows, err := api.DB.Query(r.Context(), `
		SELECT id, username, phone_number, display_name, email, role, account_status, must_change_password, token_version,
		       failed_login_attempts, locked_until, last_login_at, created_at
		FROM users ORDER BY created_at ASC
	`)
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	defer rows.Close()

	memberships, err := api.userMemberships(r.Context())
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}

	var items []map[string]any
	for rows.Next() {
		var id, username, displayName, role, status string
		var phone, email *string
		var mustChange bool
		var tokenVersion, failed int
		var locked, lastLogin *time.Time
		var created time.Time
		if err := rows.Scan(&id, &username, &phone, &displayName, &email, &role, &status, &mustChange, &tokenVersion, &failed, &locked, &lastLogin, &created); err != nil {
			web.Error(w, http.StatusInternalServerError, err.Error())
			return
		}
		items = append(items, map[string]any{
			"id": id, "username": username, "phoneNumber": phone, "displayName": displayName, "email": email, "role": role,
			"accountStatus": status, "mustChangePassword": mustChange, "tokenVersion": tokenVersion, "failedLoginAttempts": failed,
			"lockedUntil": web.NormalizeTime(locked), "lastLoginAt": web.NormalizeTime(lastLogin), "createdAt": created.UTC().Format(time.RFC3339Nano),
			"projects": memberships[id],
		})
	}
	web.JSON(w, http.StatusOK, items)
}

func (api API) userMemberships(ctx context.Context) (map[string][]map[string]any, error) {
	rows, err := api.DB.Query(ctx, `
		SELECT pr.user_id, pr.project_id, p.name, pr.role
		FROM project_roles pr
		INNER JOIN projects p ON p.id=pr.project_id
		ORDER BY p.name
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string][]map[string]any{}
	for rows.Next() {
		var userID, projectID, projectName, role string
		if err := rows.Scan(&userID, &projectID, &projectName, &role); err != nil {
			return nil, err
		}
		out[userID] = append(out[userID], map[string]any{"projectId": projectID, "projectName": projectName, "role": role})
	}
	return out, rows.Err()
}

func (api API) createUser(w http.ResponseWriter, r *http.Request) {
	var body createUserRequest
	if !decodeBody(w, r, &body) {
		return
	}
	if len(body.Username) < 3 || len(body.Username) > 50 || !usernamePattern.MatchString(body.Username) || strings.TrimSpace(body.DisplayName) == "" {
		web.Error(w, http.StatusBadRequest, "Invalid user payload")
		return
	}
	role := body.Role
	if role == "" {
		role = "developer"
	}
	if !authpkg.ValidPasswordPolicy(body.Password) {
		web.Error(w, http.StatusBadRequest, "密码需包含大小写字母、数字和特殊字符")
		return
	}
	actor := authpkg.User(r)
	if actor.Role != "platform_admin" && role == "platform_admin" {
		web.Error(w, http.StatusForbidden, "Only platform admins can create platform admin accounts")
		return
	}
	existing, err := api.loadUserByUsername(r.Context(), body.Username)
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	if existing != nil {
		web.Error(w, http.StatusConflict, "Username already exists")
		return
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(body.Password), 12)
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	id := uuid.NewString()
	mustChange := boolValue(body.MustChangePassword, false)
	_, err = api.DB.Exec(r.Context(), `
		INSERT INTO users (id, username, password_hash, display_name, email, role, account_status, must_change_password)
		VALUES ($1,$2,$3,$4,$5,$6,'active',$7)
	`, id, body.Username, string(hash), body.DisplayName, body.Email, role, mustChange)
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	_ = api.recordAudit(r.Context(), auditInput{UserID: actor.Sub, EventType: "user.created", Action: "create_user", Target: body.Username, RiskLevel: "medium", Detail: map[string]any{"createdUserId": id, "role": role, "mustChangePassword": mustChange}})
	web.JSON(w, http.StatusCreated, map[string]any{"id": id, "username": body.Username, "displayName": body.DisplayName, "email": body.Email, "role": role, "accountStatus": "active", "mustChangePassword": mustChange})
}

func (api API) updateUser(w http.ResponseWriter, r *http.Request) {
	userID := chi.URLParam(r, "userId")
	var body updateUserRequest
	if !decodeBody(w, r, &body) {
		return
	}
	existing, err := api.loadUserByID(r.Context(), userID)
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	if existing == nil {
		web.Error(w, http.StatusNotFound, "User not found")
		return
	}
	actor := authpkg.User(r)
	if actor.Role != "platform_admin" && existing.Role == "platform_admin" {
		web.Error(w, http.StatusForbidden, "Only platform admins can manage platform admin accounts")
		return
	}
	var hash any
	if body.Password != "" {
		if !authpkg.ValidPasswordPolicy(body.Password) {
			web.Error(w, http.StatusBadRequest, "密码需包含大小写字母、数字和特殊字符")
			return
		}
		generated, err := bcrypt.GenerateFromPassword([]byte(body.Password), 12)
		if err != nil {
			web.Error(w, http.StatusInternalServerError, err.Error())
			return
		}
		hash = string(generated)
	}
	_, err = api.DB.Exec(r.Context(), `
		UPDATE users
		SET display_name=COALESCE($1, display_name), email=COALESCE($2, email), password_hash=COALESCE($3, password_hash)
		WHERE id=$4
	`, body.DisplayName, body.Email, hash, userID)
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	web.JSON(w, http.StatusOK, map[string]any{"id": userID, "displayName": body.DisplayName, "email": body.Email})
}

func (api API) setUserRole(w http.ResponseWriter, r *http.Request) {
	userID := chi.URLParam(r, "userId")
	actor := authpkg.User(r)
	if actor.Sub == userID {
		web.Error(w, http.StatusBadRequest, "You cannot change your own role")
		return
	}
	var body roleRequest
	if !decodeBody(w, r, &body) {
		return
	}
	existing, err := api.loadUserByID(r.Context(), userID)
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	if existing == nil {
		web.Error(w, http.StatusNotFound, "User not found")
		return
	}
	_, err = api.DB.Exec(r.Context(), `UPDATE users SET role=$1 WHERE id=$2`, body.Role, userID)
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	_ = api.recordAudit(r.Context(), auditInput{UserID: actor.Sub, EventType: "user.role_changed", Action: "change_user_role", Target: existing.Username, RiskLevel: "high", Detail: map[string]any{"targetUserId": userID, "oldRole": existing.Role, "newRole": body.Role}})
	web.JSON(w, http.StatusOK, map[string]any{"id": userID, "role": body.Role})
}

func (api API) setUserStatus(w http.ResponseWriter, r *http.Request) {
	userID := chi.URLParam(r, "userId")
	actor := authpkg.User(r)
	if actor.Sub == userID {
		web.Error(w, http.StatusBadRequest, "You cannot change your own account status")
		return
	}
	var body statusRequest
	if !decodeBody(w, r, &body) {
		return
	}
	existing, err := api.loadUserByID(r.Context(), userID)
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	if existing == nil {
		web.Error(w, http.StatusNotFound, "User not found")
		return
	}
	if actor.Role != "platform_admin" && existing.Role == "platform_admin" {
		web.Error(w, http.StatusForbidden, "Only platform admins can manage platform admin accounts")
		return
	}
	if body.Status == "disabled" {
		_, err = api.DB.Exec(r.Context(), `UPDATE users SET account_status=$1, token_version=token_version+1 WHERE id=$2`, body.Status, userID)
	} else {
		_, err = api.DB.Exec(r.Context(), `UPDATE users SET account_status=$1 WHERE id=$2`, body.Status, userID)
	}
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	_ = api.recordAudit(r.Context(), auditInput{UserID: actor.Sub, EventType: "user." + body.Status, Action: "set_user_status", Target: existing.Username, RiskLevel: "high", Detail: map[string]any{"userId": userID, "status": body.Status}})
	web.JSON(w, http.StatusOK, map[string]any{"id": userID, "accountStatus": body.Status})
}

func (api API) resetUserPassword(w http.ResponseWriter, r *http.Request) {
	userID := chi.URLParam(r, "userId")
	var body resetPasswordRequest
	if !decodeBody(w, r, &body) {
		return
	}
	if !authpkg.ValidPasswordPolicy(body.Password) {
		web.Error(w, http.StatusBadRequest, "密码需包含大小写字母、数字和特殊字符")
		return
	}
	existing, err := api.loadUserByID(r.Context(), userID)
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	if existing == nil {
		web.Error(w, http.StatusNotFound, "User not found")
		return
	}
	actor := authpkg.User(r)
	if actor.Role != "platform_admin" && existing.Role == "platform_admin" {
		web.Error(w, http.StatusForbidden, "Only platform admins can manage platform admin accounts")
		return
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(body.Password), 12)
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	mustChange := boolValue(body.MustChangePassword, true)
	_, err = api.DB.Exec(r.Context(), `UPDATE users SET password_hash=$1, must_change_password=$2, token_version=token_version+1 WHERE id=$3`, string(hash), mustChange, userID)
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	_ = api.recordAudit(r.Context(), auditInput{UserID: actor.Sub, EventType: "user.password_reset", Action: "reset_user_password", Target: existing.Username, RiskLevel: "high", Detail: map[string]any{"targetUserId": userID, "mustChangePassword": mustChange}})
	web.JSON(w, http.StatusOK, map[string]any{"id": userID, "mustChangePassword": mustChange})
}
