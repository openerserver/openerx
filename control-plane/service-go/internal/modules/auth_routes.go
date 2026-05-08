package modules

import (
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"golang.org/x/crypto/bcrypt"

	authpkg "openerx/control-plane/service-go/internal/auth"
	"openerx/control-plane/service-go/internal/web"
)

const defaultSelfRegisterProjectID = "proj-default"

type loginRequest struct {
	Identifier string `json:"identifier"`
	Username   string `json:"username"`
	Password   string `json:"password"`
}

type registerRequest struct {
	PhoneNumber string  `json:"phoneNumber"`
	Password    string  `json:"password"`
	DisplayName string  `json:"displayName"`
	Email       *string `json:"email"`
}

type updateMeRequest struct {
	DisplayName     *string `json:"displayName"`
	Email           *string `json:"email"`
	CurrentPassword string  `json:"currentPassword"`
	NewPassword     string  `json:"newPassword"`
}

func (api API) AuthRoutes(r chi.Router) {
	r.Post("/login", api.login)
	r.Post("/register", api.register)
	r.With(api.Auth.Middleware).Post("/refresh", api.refresh)
	r.With(api.Auth.Middleware).Get("/me", api.me)
	r.With(api.Auth.Middleware).Patch("/me", api.updateMe)
}

func (api API) login(w http.ResponseWriter, r *http.Request) {
	var body loginRequest
	if !decodeBody(w, r, &body) {
		return
	}
	identifier := strings.TrimSpace(body.Identifier)
	if identifier == "" {
		identifier = strings.TrimSpace(body.Username)
	}
	if identifier == "" || body.Password == "" {
		web.Error(w, http.StatusBadRequest, "Phone number or username is required")
		return
	}

	phone := authpkg.NormalizeInternationalPhoneNumber(identifier)
	if strings.HasPrefix(identifier, "+") && phone == "" {
		web.Error(w, http.StatusUnauthorized, "Invalid credentials")
		return
	}

	var user *userRecord
	var err error
	if phone != "" {
		user, err = api.loadUserByPhone(r.Context(), phone)
	} else {
		user, err = api.loadUserByUsername(r.Context(), identifier)
	}
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	if user == nil {
		web.Error(w, http.StatusUnauthorized, "Invalid credentials")
		return
	}
	if user.AccountStatus != "active" {
		web.Error(w, http.StatusForbidden, "Account is disabled")
		return
	}
	if user.LockedUntil != nil && time.Now().Before(*user.LockedUntil) {
		remain := int(time.Until(*user.LockedUntil).Minutes()) + 1
		web.Error(w, http.StatusTooManyRequests, "账户已被临时锁定，请 "+strconvItoa(remain)+" 分钟后重试")
		return
	}
	if user.LockedUntil != nil {
		_, _ = api.DB.Exec(r.Context(), `UPDATE users SET failed_login_attempts=0, locked_until=NULL WHERE id=$1`, user.ID)
	}

	if err := bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(body.Password)); err != nil {
		attempts := user.FailedLoginAttempts + 1
		if attempts >= 5 {
			_, _ = api.DB.Exec(r.Context(), `UPDATE users SET failed_login_attempts=$1, locked_until=$2 WHERE id=$3`, attempts, time.Now().Add(15*time.Minute), user.ID)
		} else {
			_, _ = api.DB.Exec(r.Context(), `UPDATE users SET failed_login_attempts=$1 WHERE id=$2`, attempts, user.ID)
		}
		web.Error(w, http.StatusUnauthorized, "Invalid credentials")
		return
	}

	roles, err := api.loadProjectRoles(r.Context(), user.ID)
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}

	lastLoginAt := time.Now().UTC()
	if _, err := api.DB.Exec(r.Context(), `UPDATE users SET last_login_at=$1, failed_login_attempts=0, locked_until=NULL WHERE id=$2`, lastLoginAt, user.ID); err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	user.LastLoginAt = &lastLoginAt

	tv := user.TokenVersion
	token, err := api.Auth.Sign(authpkg.Claims{
		Sub:      user.ID,
		Org:      "",
		Projects: projectClaims(roles),
		Role:     user.Role,
		TV:       &tv,
	}, 4*time.Hour)
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	web.JSON(w, http.StatusOK, map[string]any{"token": token, "user": publicUser(*user, roles)})
}

func (api API) register(w http.ResponseWriter, r *http.Request) {
	var body registerRequest
	if !decodeBody(w, r, &body) {
		return
	}
	phone := authpkg.NormalizeInternationalPhoneNumber(body.PhoneNumber)
	if phone == "" {
		web.Error(w, http.StatusBadRequest, "请输入有效的国际手机号，例如 +8613800000000")
		return
	}
	if len(body.Password) < 8 || !authpkg.ValidPasswordPolicy(body.Password) {
		web.Error(w, http.StatusBadRequest, "密码需包含大小写字母、数字和特殊字符")
		return
	}
	if strings.TrimSpace(body.DisplayName) == "" {
		web.Error(w, http.StatusBadRequest, "displayName is required")
		return
	}

	existing, err := api.loadUserByPhone(r.Context(), phone)
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	if existing != nil {
		web.Error(w, http.StatusConflict, "Phone number already registered")
		return
	}

	var projectID string
	if err := api.DB.QueryRow(r.Context(), `SELECT id FROM projects WHERE id=$1`, defaultSelfRegisterProjectID).Scan(&projectID); err != nil {
		if err == pgx.ErrNoRows {
			web.Error(w, http.StatusInternalServerError, "Default project is not configured for self-registration")
			return
		}
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}

	userID := uuid.NewString()
	username := authpkg.GeneratedUsernameFromPhone(phone, userID)
	now := time.Now().UTC()
	hash, err := bcrypt.GenerateFromPassword([]byte(body.Password), 12)
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}

	tx, err := api.DB.Begin(r.Context())
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	defer func() { _ = tx.Rollback(r.Context()) }()

	_, err = tx.Exec(r.Context(), `
		INSERT INTO users (id, username, phone_number, password_hash, display_name, email, role, account_status, must_change_password, last_login_at, created_at)
		VALUES ($1,$2,$3,$4,$5,$6,'developer','active',false,$7,$7)
	`, userID, username, phone, string(hash), body.DisplayName, body.Email, now)
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	_, err = tx.Exec(r.Context(), `INSERT INTO project_roles (id, user_id, project_id, role) VALUES ($1,$2,$3,'developer')`, uuid.NewString(), userID, defaultSelfRegisterProjectID)
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}

	_ = api.recordAudit(r.Context(), auditInput{
		UserID: userID, ProjectID: defaultSelfRegisterProjectID, EventType: "user.self_registered",
		Action: "self_register", Target: phone, RiskLevel: "medium",
		Detail: map[string]any{"userId": userID, "projectId": defaultSelfRegisterProjectID},
	})

	roles := []projectRoleRecord{{ProjectID: defaultSelfRegisterProjectID, Role: "developer"}}
	tv := 0
	token, err := api.Auth.Sign(authpkg.Claims{Sub: userID, Org: "", Projects: projectClaims(roles), Role: "developer", TV: &tv}, 4*time.Hour)
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	web.JSON(w, http.StatusCreated, map[string]any{
		"token": token,
		"user": map[string]any{
			"id": userID, "username": username, "phoneNumber": phone, "displayName": body.DisplayName,
			"email": body.Email, "role": "developer", "accountStatus": "active", "mustChangePassword": false,
			"lastLoginAt": now.Format(time.RFC3339Nano), "createdAt": now.Format(time.RFC3339Nano), "projects": projectSummary(roles),
		},
	})
}

func (api API) refresh(w http.ResponseWriter, r *http.Request) {
	user := authpkg.User(r)
	token, err := api.Auth.Sign(*user, 4*time.Hour)
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	web.JSON(w, http.StatusOK, map[string]any{"token": token})
}

func (api API) me(w http.ResponseWriter, r *http.Request) {
	claims := authpkg.User(r)
	user, err := api.loadUserByID(r.Context(), claims.Sub)
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	if user == nil {
		web.Error(w, http.StatusNotFound, "User not found")
		return
	}
	roles, err := api.loadProjectRoles(r.Context(), user.ID)
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	web.JSON(w, http.StatusOK, publicUser(*user, roles))
}

func (api API) updateMe(w http.ResponseWriter, r *http.Request) {
	claims := authpkg.User(r)
	var body updateMeRequest
	if !decodeBody(w, r, &body) {
		return
	}
	user, err := api.loadUserByID(r.Context(), claims.Sub)
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	if user == nil {
		web.Error(w, http.StatusNotFound, "User not found")
		return
	}

	if body.NewPassword != "" {
		if body.CurrentPassword == "" {
			web.Error(w, http.StatusBadRequest, "Current password is required")
			return
		}
		if err := bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(body.CurrentPassword)); err != nil {
			web.Error(w, http.StatusBadRequest, "Current password is incorrect")
			return
		}
		if !authpkg.ValidPasswordPolicy(body.NewPassword) {
			web.Error(w, http.StatusBadRequest, "密码需包含大小写字母、数字和特殊字符")
			return
		}
		hash, err := bcrypt.GenerateFromPassword([]byte(body.NewPassword), 12)
		if err != nil {
			web.Error(w, http.StatusInternalServerError, err.Error())
			return
		}
		_, err = api.DB.Exec(r.Context(), `
			UPDATE users
			SET display_name=COALESCE($1, display_name), email=$2, password_hash=$3, must_change_password=false, token_version=token_version+1
			WHERE id=$4
		`, body.DisplayName, body.Email, string(hash), user.ID)
		if err != nil {
			web.Error(w, http.StatusInternalServerError, err.Error())
			return
		}
	} else {
		_, err = api.DB.Exec(r.Context(), `UPDATE users SET display_name=COALESCE($1, display_name), email=COALESCE($2, email) WHERE id=$3`, body.DisplayName, body.Email, user.ID)
		if err != nil {
			web.Error(w, http.StatusInternalServerError, err.Error())
			return
		}
	}
	api.me(w, r)
}

func strconvItoa(value int) string {
	return strconv.FormatInt(int64(value), 10)
}
