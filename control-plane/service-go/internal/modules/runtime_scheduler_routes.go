package modules

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	authpkg "openerx/control-plane/service-go/internal/auth"
	"openerx/control-plane/service-go/internal/web"
)

type runtimeSchedulerStartRequest struct {
	CommitSha    string  `json:"commitSha"`
	TaskID       *string `json:"taskId"`
	CommitStepID *string `json:"commitStepId"`
	RuntimeLevel int     `json:"runtimeLevel"`
	Provider     string  `json:"provider"`
	TargetURL    string  `json:"targetUrl"`
	PreviewURL   *string `json:"previewUrl"`
	LogsURL      *string `json:"logsUrl"`
	TTLSeconds   int     `json:"ttlSeconds"`
}

type runtimeSchedulerStopRequest struct {
	Reason *string `json:"reason"`
}

func (api API) RuntimeSchedulerRoutes(r chi.Router) {
	r.Post("/start", api.runtimeSchedulerStart)
	r.Post("/stop/{runtimeId}", api.runtimeSchedulerStop)
	r.Get("/{runtimeId}/status", api.runtimeSchedulerStatus)
}

func (api API) runtimeSchedulerStart(w http.ResponseWriter, r *http.Request) {
	var body runtimeSchedulerStartRequest
	if !decodeBody(w, r, &body) {
		return
	}
	body.CommitSha = strings.TrimSpace(body.CommitSha)
	if body.CommitSha == "" {
		web.Error(w, http.StatusBadRequest, "commitSha is required")
		return
	}
	if body.RuntimeLevel == 0 {
		body.RuntimeLevel = 1
	}
	if !runtimeSchedulerSupportsLevel(body.RuntimeLevel) {
		web.Error(w, http.StatusBadRequest, fmt.Sprintf("runtime level %d is not supported by the MVP scheduler", body.RuntimeLevel))
		return
	}
	provider := body.Provider
	if provider == "" {
		provider = "local-registered"
	}
	if provider != "local-registered" {
		web.Error(w, http.StatusBadRequest, "Only local-registered provider is supported")
		return
	}
	if err := validateLocalPreviewTargetURL(body.TargetURL); err != nil {
		web.Error(w, http.StatusBadRequest, err.Error())
		return
	}
	step, err := api.loadCommitStepBySha(r.Context(), body.CommitSha)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	taskID := valueString(body.TaskID)
	commitStepID := valueString(body.CommitStepID)
	if step != nil {
		taskID = stringFromMap(step, "taskId")
		commitStepID = stringFromMap(step, "id")
	}
	if taskID == "" {
		web.Error(w, http.StatusBadRequest, "taskId is required when commit step is not recorded")
		return
	}
	projectID, err := api.taskProjectID(r.Context(), taskID)
	if errors.Is(err, pgx.ErrNoRows) {
		web.Error(w, http.StatusNotFound, "Task not found")
		return
	}
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	user := authpkg.User(r)
	if !authpkg.HasProjectRole(user, projectID, "developer") {
		web.Error(w, http.StatusForbidden, "Developer permission required")
		return
	}
	ttl := body.TTLSeconds
	if ttl <= 0 {
		ttl = 1800
	}
	previewURL := body.PreviewURL
	if previewURL == nil || *previewURL == "" {
		value := fmt.Sprintf("/preview/commits/%s", body.CommitSha)
		previewURL = &value
	}
	now := time.Now().UTC()
	expiresAt := now.Add(time.Duration(ttl) * time.Second)
	runtimeID := uuid.NewString()
	_, err = api.DB.Exec(r.Context(), `
		INSERT INTO commit_runtimes (
			id, task_id, commit_step_id, commit_sha, runtime_level, provider, status,
			preview_url, target_url, logs_url, ttl_seconds, requested_by_user_id, created_at,
			updated_at, expires_at, started_at, last_accessed_at, error_message
		) VALUES ($1,$2,$3,$4,$5,$6,'running',$7,$8,$9,$10,$11,$12,$12,$13,$12,$12,NULL)
		ON CONFLICT (commit_sha) DO UPDATE SET
			commit_step_id=COALESCE(EXCLUDED.commit_step_id, commit_runtimes.commit_step_id),
			runtime_level=EXCLUDED.runtime_level,
			provider=EXCLUDED.provider,
			status='running',
			preview_url=EXCLUDED.preview_url,
			target_url=EXCLUDED.target_url,
			logs_url=EXCLUDED.logs_url,
			ttl_seconds=EXCLUDED.ttl_seconds,
			requested_by_user_id=EXCLUDED.requested_by_user_id,
			updated_at=EXCLUDED.updated_at,
			expires_at=EXCLUDED.expires_at,
			started_at=COALESCE(commit_runtimes.started_at, EXCLUDED.started_at),
			stopped_at=NULL,
			last_accessed_at=EXCLUDED.last_accessed_at,
			error_message=NULL
	`, runtimeID, taskID, nullString(commitStepID), body.CommitSha, body.RuntimeLevel, provider, previewURL, body.TargetURL, body.LogsURL, ttl, user.Sub, now, expiresAt)
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	if commitStepID != "" {
		_, _ = api.DB.Exec(r.Context(), `UPDATE commit_steps SET preview_status='running' WHERE id=$1`, commitStepID)
	}
	_ = api.recordAudit(r.Context(), auditInput{
		UserID: user.Sub, ProjectID: projectID, TaskID: taskID, EventType: "runtime_scheduler",
		Action: "start", Target: body.CommitSha,
		Detail: map[string]any{"provider": provider, "targetUrl": body.TargetURL, "runtimeLevel": body.RuntimeLevel, "ttlSeconds": ttl},
	})
	item, err := api.loadCommitRuntimeBySha(r.Context(), body.CommitSha)
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	web.JSON(w, http.StatusOK, map[string]any{"data": item})
}

func (api API) runtimeSchedulerStop(w http.ResponseWriter, r *http.Request) {
	runtimeID := chi.URLParam(r, "runtimeId")
	item, err := api.loadCommitRuntimeByID(r.Context(), runtimeID)
	if errors.Is(err, pgx.ErrNoRows) {
		web.Error(w, http.StatusNotFound, "Runtime not found")
		return
	}
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	taskID := stringFromMap(item, "taskId")
	projectID, err := api.taskProjectID(r.Context(), taskID)
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	user := authpkg.User(r)
	if !authpkg.HasProjectRole(user, projectID, "developer") {
		web.Error(w, http.StatusForbidden, "Developer permission required")
		return
	}
	var body runtimeSchedulerStopRequest
	_ = web.DecodeJSON(r, &body)
	now := time.Now().UTC()
	_, err = api.DB.Exec(r.Context(), `
		UPDATE commit_runtimes
		SET status='stopped', stopped_at=$1, updated_at=$1, error_message=$2
		WHERE id=$3
	`, now, body.Reason, runtimeID)
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	if commitStepID := optionalRuntimeString(item, "commitStepId"); commitStepID != "" {
		_, _ = api.DB.Exec(r.Context(), `UPDATE commit_steps SET preview_status='stopped' WHERE id=$1`, commitStepID)
	}
	_ = api.recordAudit(r.Context(), auditInput{
		UserID: user.Sub, ProjectID: projectID, TaskID: taskID, EventType: "runtime_scheduler",
		Action: "stop", Target: runtimeID, Detail: map[string]any{"reason": body.Reason},
	})
	updated, err := api.loadCommitRuntimeByID(r.Context(), runtimeID)
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	web.JSON(w, http.StatusOK, map[string]any{"data": updated})
}

func (api API) runtimeSchedulerStatus(w http.ResponseWriter, r *http.Request) {
	runtimeID := chi.URLParam(r, "runtimeId")
	item, err := api.loadCommitRuntimeByID(r.Context(), runtimeID)
	if errors.Is(err, pgx.ErrNoRows) {
		web.Error(w, http.StatusNotFound, "Runtime not found")
		return
	}
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	taskID := stringFromMap(item, "taskId")
	if ok, err := api.ensureTaskAccess(r.Context(), w, r, taskID, "developer"); err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	} else if !ok {
		return
	}
	web.JSON(w, http.StatusOK, map[string]any{"data": item})
}

func (api API) loadCommitRuntimeByID(ctx context.Context, runtimeID string) (map[string]any, error) {
	return api.loadCommitRuntimeWhere(ctx, `id=$1`, runtimeID)
}

func runtimeSchedulerSupportsLevel(level int) bool {
	return level == 1 || level == 2
}

func validateLocalPreviewTargetURL(raw string) error {
	parsed, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return errors.New("targetUrl must be a valid URL")
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return errors.New("targetUrl must use http or https")
	}
	host := parsed.Hostname()
	if host != "localhost" && host != "127.0.0.1" && host != "::1" {
		return errors.New("local-registered provider only accepts localhost targetUrl")
	}
	return nil
}

func optionalRuntimeString(item map[string]any, key string) string {
	switch value := item[key].(type) {
	case string:
		return value
	case *string:
		if value != nil {
			return *value
		}
	}
	return ""
}
