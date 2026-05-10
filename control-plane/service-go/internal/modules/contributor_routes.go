package modules

import (
	"context"
	"errors"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"

	authpkg "openerx/control-plane/service-go/internal/auth"
	"openerx/control-plane/service-go/internal/web"
)

type contributorProfileRequest struct {
	Level               *string  `json:"level"`
	Status              *string  `json:"status"`
	ReputationScore     *float64 `json:"reputationScore"`
	CompletedTasks      *int     `json:"completedTasks"`
	RejectedChanges     *int     `json:"rejectedChanges"`
	RiskIncidents       *int     `json:"riskIncidents"`
	DailyTaskQuota      *int     `json:"dailyTaskQuota"`
	ActiveTaskQuota     *int     `json:"activeTaskQuota"`
	RuntimeMinutesQuota *int     `json:"runtimeMinutesQuota"`
	Notes               *string  `json:"notes"`
}

type contributorProfile struct {
	UserID              string
	Level               string
	Status              string
	ReputationScore     float64
	CompletedTasks      int
	RejectedChanges     int
	RiskIncidents       int
	DailyTaskQuota      int
	ActiveTaskQuota     int
	RuntimeMinutesQuota int
	Notes               *string
	CreatedAt           time.Time
	UpdatedAt           time.Time
}

func (api API) ContributorRoutes(r chi.Router) {
	r.Get("/me", api.getMyContributorProfile)
	r.With(func(next http.Handler) http.Handler { return requireRole("org_admin", next) }).Get("/", api.listContributorProfiles)
	r.With(func(next http.Handler) http.Handler { return requireRole("org_admin", next) }).Get("/{userId}", api.getContributorProfile)
	r.With(func(next http.Handler) http.Handler { return requireRole("org_admin", next) }).Put("/{userId}", api.putContributorProfile)
}

func (api API) getMyContributorProfile(w http.ResponseWriter, r *http.Request) {
	user := authpkg.User(r)
	profile, err := api.ensureContributorProfile(r.Context(), user.Sub)
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	web.JSON(w, http.StatusOK, map[string]any{"data": publicContributorProfile(profile)})
}

func (api API) listContributorProfiles(w http.ResponseWriter, r *http.Request) {
	level := r.URL.Query().Get("level")
	status := r.URL.Query().Get("status")
	if level != "" && !validContributorLevel(level) {
		web.Error(w, http.StatusBadRequest, "Invalid contributor level")
		return
	}
	if status != "" && !validContributorStatus(status) {
		web.Error(w, http.StatusBadRequest, "Invalid contributor status")
		return
	}
	rows, err := api.DB.Query(r.Context(), `
		SELECT cp.user_id, cp.level, cp.status, cp.reputation_score::float8, cp.completed_tasks,
		       cp.rejected_changes, cp.risk_incidents, cp.daily_task_quota, cp.active_task_quota,
		       cp.runtime_minutes_quota, cp.notes, cp.created_at, cp.updated_at,
		       u.username, u.display_name, u.email
		FROM contributor_profiles cp
		INNER JOIN users u ON u.id=cp.user_id
		WHERE ($1::text IS NULL OR cp.level=$1)
		  AND ($2::text IS NULL OR cp.status=$2)
		ORDER BY CASE cp.level
			WHEN 'L5' THEN 5
			WHEN 'L4' THEN 4
			WHEN 'L3' THEN 3
			WHEN 'L2' THEN 2
			ELSE 1
		END DESC, cp.reputation_score DESC, cp.updated_at DESC
		LIMIT $3
	`, nullString(level), nullString(status), parseLimit(r, 100, 500))
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	defer rows.Close()
	items := []map[string]any{}
	for rows.Next() {
		profile, userInfo, err := scanContributorProfileWithUser(rows)
		if err != nil {
			web.Error(w, http.StatusInternalServerError, err.Error())
			return
		}
		item := publicContributorProfile(profile)
		item["user"] = userInfo
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	web.JSON(w, http.StatusOK, map[string]any{"data": items})
}

func (api API) getContributorProfile(w http.ResponseWriter, r *http.Request) {
	userID := chi.URLParam(r, "userId")
	profile, err := api.ensureContributorProfile(r.Context(), userID)
	if errors.Is(err, pgx.ErrNoRows) {
		web.Error(w, http.StatusNotFound, "User not found")
		return
	}
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	web.JSON(w, http.StatusOK, map[string]any{"data": publicContributorProfile(profile)})
}

func (api API) putContributorProfile(w http.ResponseWriter, r *http.Request) {
	userID := chi.URLParam(r, "userId")
	var body contributorProfileRequest
	if !decodeBody(w, r, &body) {
		return
	}
	if body.Level != nil && !validContributorLevel(*body.Level) {
		web.Error(w, http.StatusBadRequest, "Invalid contributor level")
		return
	}
	if body.Status != nil && !validContributorStatus(*body.Status) {
		web.Error(w, http.StatusBadRequest, "Invalid contributor status")
		return
	}
	if invalidQuota(body.DailyTaskQuota) || invalidQuota(body.ActiveTaskQuota) || invalidQuota(body.RuntimeMinutesQuota) {
		web.Error(w, http.StatusBadRequest, "Quotas cannot be negative")
		return
	}
	if ok, err := api.userExists(r.Context(), userID); err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	} else if !ok {
		web.Error(w, http.StatusNotFound, "User not found")
		return
	}
	current, err := api.ensureContributorProfile(r.Context(), userID)
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	next := contributorProfileRequest{
		Level:               stringPtr(current.Level),
		Status:              stringPtr(current.Status),
		ReputationScore:     floatPtr(current.ReputationScore),
		CompletedTasks:      intPtr(current.CompletedTasks),
		RejectedChanges:     intPtr(current.RejectedChanges),
		RiskIncidents:       intPtr(current.RiskIncidents),
		DailyTaskQuota:      intPtr(current.DailyTaskQuota),
		ActiveTaskQuota:     intPtr(current.ActiveTaskQuota),
		RuntimeMinutesQuota: intPtr(current.RuntimeMinutesQuota),
		Notes:               current.Notes,
	}
	mergeContributorProfileRequest(&next, body)
	now := time.Now().UTC()
	_, err = api.DB.Exec(r.Context(), `
		INSERT INTO contributor_profiles (
			user_id, level, status, reputation_score, completed_tasks, rejected_changes,
			risk_incidents, daily_task_quota, active_task_quota, runtime_minutes_quota,
			notes, created_at, updated_at
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$12)
		ON CONFLICT (user_id) DO UPDATE SET
			level=EXCLUDED.level,
			status=EXCLUDED.status,
			reputation_score=EXCLUDED.reputation_score,
			completed_tasks=EXCLUDED.completed_tasks,
			rejected_changes=EXCLUDED.rejected_changes,
			risk_incidents=EXCLUDED.risk_incidents,
			daily_task_quota=EXCLUDED.daily_task_quota,
			active_task_quota=EXCLUDED.active_task_quota,
			runtime_minutes_quota=EXCLUDED.runtime_minutes_quota,
			notes=EXCLUDED.notes,
			updated_at=EXCLUDED.updated_at
	`, userID, *next.Level, *next.Status, *next.ReputationScore, *next.CompletedTasks, *next.RejectedChanges, *next.RiskIncidents, *next.DailyTaskQuota, *next.ActiveTaskQuota, *next.RuntimeMinutesQuota, next.Notes, now)
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	actor := authpkg.User(r)
	_ = api.recordAudit(r.Context(), auditInput{
		UserID: actor.Sub, EventType: "contributor_profile", Action: "upsert", Target: userID,
		RiskLevel: contributorProfileAuditRisk(current.Level, *next.Level, current.Status, *next.Status),
		Detail: map[string]any{
			"oldLevel": current.Level, "newLevel": *next.Level, "oldStatus": current.Status, "newStatus": *next.Status,
			"dailyTaskQuota": *next.DailyTaskQuota, "activeTaskQuota": *next.ActiveTaskQuota,
		},
	})
	profile, err := api.loadContributorProfile(r.Context(), userID)
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	web.JSON(w, http.StatusOK, map[string]any{"data": publicContributorProfile(profile)})
}

func (api API) ensureContributorProfile(ctx context.Context, userID string) (contributorProfile, error) {
	profile, err := api.loadContributorProfile(ctx, userID)
	if err == nil {
		return profile, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return contributorProfile{}, err
	}
	if ok, err := api.userExists(ctx, userID); err != nil {
		return contributorProfile{}, err
	} else if !ok {
		return contributorProfile{}, pgx.ErrNoRows
	}
	now := time.Now().UTC()
	_, err = api.DB.Exec(ctx, `
		INSERT INTO contributor_profiles (
			user_id, level, status, reputation_score, completed_tasks, rejected_changes,
			risk_incidents, daily_task_quota, active_task_quota, runtime_minutes_quota,
			created_at, updated_at
		) VALUES ($1,'L1','active',0,0,0,0,1,1,60,$2,$2)
		ON CONFLICT (user_id) DO NOTHING
	`, userID, now)
	if err != nil {
		return contributorProfile{}, err
	}
	return api.loadContributorProfile(ctx, userID)
}

func (api API) loadContributorProfile(ctx context.Context, userID string) (contributorProfile, error) {
	var profile contributorProfile
	err := api.DB.QueryRow(ctx, `
		SELECT user_id, level, status, reputation_score::float8, completed_tasks, rejected_changes,
		       risk_incidents, daily_task_quota, active_task_quota, runtime_minutes_quota,
		       notes, created_at, updated_at
		FROM contributor_profiles
		WHERE user_id=$1
	`, userID).Scan(
		&profile.UserID, &profile.Level, &profile.Status, &profile.ReputationScore,
		&profile.CompletedTasks, &profile.RejectedChanges, &profile.RiskIncidents,
		&profile.DailyTaskQuota, &profile.ActiveTaskQuota, &profile.RuntimeMinutesQuota,
		&profile.Notes, &profile.CreatedAt, &profile.UpdatedAt,
	)
	return profile, err
}

func (api API) userExists(ctx context.Context, userID string) (bool, error) {
	var id string
	err := api.DB.QueryRow(ctx, `SELECT id FROM users WHERE id=$1`, userID).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return true, nil
}

func scanContributorProfileWithUser(row pgx.Row) (contributorProfile, map[string]any, error) {
	var profile contributorProfile
	var username, displayName string
	var email *string
	err := row.Scan(
		&profile.UserID, &profile.Level, &profile.Status, &profile.ReputationScore,
		&profile.CompletedTasks, &profile.RejectedChanges, &profile.RiskIncidents,
		&profile.DailyTaskQuota, &profile.ActiveTaskQuota, &profile.RuntimeMinutesQuota,
		&profile.Notes, &profile.CreatedAt, &profile.UpdatedAt, &username, &displayName, &email,
	)
	return profile, map[string]any{"id": profile.UserID, "username": username, "displayName": displayName, "email": email}, err
}

func publicContributorProfile(profile contributorProfile) map[string]any {
	return map[string]any{
		"userId": profile.UserID, "level": profile.Level, "status": profile.Status,
		"reputationScore": profile.ReputationScore, "completedTasks": profile.CompletedTasks,
		"rejectedChanges": profile.RejectedChanges, "riskIncidents": profile.RiskIncidents,
		"dailyTaskQuota": profile.DailyTaskQuota, "activeTaskQuota": profile.ActiveTaskQuota,
		"runtimeMinutesQuota": profile.RuntimeMinutesQuota, "notes": profile.Notes,
		"createdAt": formatRuntimeTime(&profile.CreatedAt), "updatedAt": formatRuntimeTime(&profile.UpdatedAt),
	}
}

func mergeContributorProfileRequest(target *contributorProfileRequest, patch contributorProfileRequest) {
	if patch.Level != nil {
		target.Level = patch.Level
	}
	if patch.Status != nil {
		target.Status = patch.Status
	}
	if patch.ReputationScore != nil {
		target.ReputationScore = patch.ReputationScore
	}
	if patch.CompletedTasks != nil {
		target.CompletedTasks = patch.CompletedTasks
	}
	if patch.RejectedChanges != nil {
		target.RejectedChanges = patch.RejectedChanges
	}
	if patch.RiskIncidents != nil {
		target.RiskIncidents = patch.RiskIncidents
	}
	if patch.DailyTaskQuota != nil {
		target.DailyTaskQuota = patch.DailyTaskQuota
	}
	if patch.ActiveTaskQuota != nil {
		target.ActiveTaskQuota = patch.ActiveTaskQuota
	}
	if patch.RuntimeMinutesQuota != nil {
		target.RuntimeMinutesQuota = patch.RuntimeMinutesQuota
	}
	if patch.Notes != nil {
		target.Notes = patch.Notes
	}
}

func contributorLevelRank(level string) int {
	switch level {
	case "L1":
		return 1
	case "L2":
		return 2
	case "L3":
		return 3
	case "L4":
		return 4
	case "L5":
		return 5
	default:
		return 0
	}
}

func minContributorLevelForRisk(riskLevel string) string {
	switch riskLevel {
	case "low", "":
		return "L1"
	case "medium":
		return "L2"
	case "high":
		return "L3"
	case "critical":
		return "L5"
	default:
		return "L5"
	}
}

func contributorCanAcceptRisk(level string, riskLevel string) bool {
	return contributorLevelRank(level) >= contributorLevelRank(minContributorLevelForRisk(riskLevel))
}

func contributorCanUseRuntimeLevel(level string, runtimeLevel int) bool {
	maxLevel := map[string]int{
		"L1": 2,
		"L2": 3,
		"L3": 4,
		"L4": 5,
		"L5": 5,
	}
	allowed, ok := maxLevel[level]
	return ok && runtimeLevel <= allowed
}

func validContributorLevel(value string) bool {
	return contributorLevelRank(value) >= 1
}

func validContributorStatus(value string) bool {
	return value == "active" || value == "suspended" || value == "banned"
}

func invalidQuota(value *int) bool {
	return value != nil && *value < 0
}

func contributorProfileAuditRisk(oldLevel string, newLevel string, oldStatus string, newStatus string) string {
	if contributorLevelRank(newLevel) >= 4 || oldStatus != newStatus {
		return "high"
	}
	if contributorLevelRank(newLevel) > contributorLevelRank(oldLevel) {
		return "medium"
	}
	return "low"
}

func intPtr(value int) *int {
	return &value
}

func floatPtr(value float64) *float64 {
	return &value
}
