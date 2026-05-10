package modules

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	authpkg "openerx/control-plane/service-go/internal/auth"
	"openerx/control-plane/service-go/internal/web"
)

type taskBoundaryRequest struct {
	AllowedPaths     []string `json:"allowedPaths"`
	BlockedPaths     []string `json:"blockedPaths"`
	AcceptanceChecks []string `json:"acceptanceChecks"`
	RuntimeLevel     int      `json:"runtimeLevel"`
	RewardAmount     *float64 `json:"rewardAmount"`
	RewardCurrency   string   `json:"rewardCurrency"`
	RiskLevel        string   `json:"riskLevel"`
}

type createAssignmentRequest struct {
	ContributorUserID *string `json:"contributorUserId"`
	LockedUntil       *string `json:"lockedUntil"`
}

type createWorkspaceRequest struct {
	AssignmentID  *string `json:"assignmentId"`
	BranchName    *string `json:"branchName"`
	BaseRevision  *string `json:"baseRevision"`
	WorkspaceRoot *string `json:"workspaceRoot"`
}

type createCommitStepRequest struct {
	AssignmentID      *string `json:"assignmentId"`
	WorkspaceBranchID *string `json:"workspaceBranchId"`
	CodeChangeID      *string `json:"codeChangeId"`
	StepIndex         int     `json:"stepIndex"`
	CommitSha         string  `json:"commitSha"`
	ParentCommitSha   *string `json:"parentCommitSha"`
	BranchName        *string `json:"branchName"`
	Summary           *string `json:"summary"`
	TestStatus        string  `json:"testStatus"`
	PreviewStatus     string  `json:"previewStatus"`
	RiskLevel         string  `json:"riskLevel"`
}

type startCommitRuntimeRequest struct {
	TaskID       *string `json:"taskId"`
	CommitStepID *string `json:"commitStepId"`
	RuntimeLevel int     `json:"runtimeLevel"`
	Provider     string  `json:"provider"`
	Status       string  `json:"status"`
	PreviewURL   *string `json:"previewUrl"`
	LogsURL      *string `json:"logsUrl"`
	TTLSeconds   int     `json:"ttlSeconds"`
}

func (api API) CommitRuntimeRoutes(r chi.Router) {
	r.Post("/{commitSha}/start", api.startCommitRuntime)
	r.Get("/{commitSha}", api.getCommitRuntime)
	r.Get("/{commitSha}/preview-url", api.getCommitRuntimePreviewURL)
}

func (api API) getTaskBoundary(w http.ResponseWriter, r *http.Request) {
	taskID := chi.URLParam(r, "taskId")
	if ok, err := api.ensureTaskAccess(r.Context(), w, r, taskID, "developer"); err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	} else if !ok {
		return
	}
	item, err := api.loadTaskBoundary(r.Context(), taskID)
	if errors.Is(err, pgx.ErrNoRows) {
		web.JSON(w, http.StatusOK, map[string]any{"data": nil})
		return
	}
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	web.JSON(w, http.StatusOK, map[string]any{"data": item})
}

func (api API) putTaskBoundary(w http.ResponseWriter, r *http.Request) {
	taskID := chi.URLParam(r, "taskId")
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
	if !authpkg.HasProjectRole(user, projectID, "project_admin") {
		web.Error(w, http.StatusForbidden, "Project admin permission required")
		return
	}
	var body taskBoundaryRequest
	if !decodeBody(w, r, &body) {
		return
	}
	if body.RuntimeLevel == 0 {
		body.RuntimeLevel = 1
	}
	if err := validateTaskBoundary(body); err != nil {
		web.Error(w, http.StatusBadRequest, err.Error())
		return
	}
	allowedPaths, _ := jsonBytes(body.AllowedPaths)
	blockedPaths, _ := jsonBytes(body.BlockedPaths)
	acceptanceChecks, _ := jsonBytes(body.AcceptanceChecks)
	rewardCurrency := body.RewardCurrency
	if rewardCurrency == "" {
		rewardCurrency = "points"
	}
	riskLevel := body.RiskLevel
	if riskLevel == "" {
		riskLevel = "low"
	}
	now := time.Now().UTC()
	_, err = api.DB.Exec(r.Context(), `
		INSERT INTO task_boundaries (
			task_id, allowed_paths_json, blocked_paths_json, acceptance_checks_json,
			runtime_level, reward_amount, reward_currency, risk_level, created_at, updated_at
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9)
		ON CONFLICT (task_id) DO UPDATE SET
			allowed_paths_json=EXCLUDED.allowed_paths_json,
			blocked_paths_json=EXCLUDED.blocked_paths_json,
			acceptance_checks_json=EXCLUDED.acceptance_checks_json,
			runtime_level=EXCLUDED.runtime_level,
			reward_amount=EXCLUDED.reward_amount,
			reward_currency=EXCLUDED.reward_currency,
			risk_level=EXCLUDED.risk_level,
			updated_at=EXCLUDED.updated_at
	`, taskID, allowedPaths, blockedPaths, acceptanceChecks, body.RuntimeLevel, body.RewardAmount, rewardCurrency, riskLevel, now)
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	_ = api.recordAudit(r.Context(), auditInput{
		UserID: user.Sub, ProjectID: projectID, TaskID: taskID, EventType: "task_boundary",
		Action: "upsert", Target: taskID, RiskLevel: riskLevel,
		Detail: map[string]any{"runtimeLevel": body.RuntimeLevel, "allowedPaths": body.AllowedPaths, "blockedPaths": body.BlockedPaths},
	})
	item, err := api.loadTaskBoundary(r.Context(), taskID)
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	web.JSON(w, http.StatusOK, map[string]any{"data": item})
}

func (api API) createTaskAssignment(w http.ResponseWriter, r *http.Request) {
	taskID := chi.URLParam(r, "taskId")
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
	var body createAssignmentRequest
	if !decodeBody(w, r, &body) {
		return
	}
	contributorID := user.Sub
	if body.ContributorUserID != nil && *body.ContributorUserID != "" && *body.ContributorUserID != user.Sub {
		if !authpkg.HasProjectRole(user, projectID, "project_admin") {
			web.Error(w, http.StatusForbidden, "Project admin permission required to assign another contributor")
			return
		}
		contributorID = *body.ContributorUserID
	}
	id := uuid.NewString()
	now := time.Now().UTC()
	lockedUntil := parseOptionalRuntimeTime(body.LockedUntil)
	_, err = api.DB.Exec(r.Context(), `
		INSERT INTO task_assignments (id, task_id, contributor_user_id, status, locked_until, created_at, updated_at)
		VALUES ($1,$2,$3,'active',$4,$5,$5)
	`, id, taskID, contributorID, lockedUntil, now)
	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" {
			web.Error(w, http.StatusConflict, "Task already has an active assignment")
			return
		}
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	_ = api.recordAudit(r.Context(), auditInput{
		UserID: user.Sub, ProjectID: projectID, TaskID: taskID, EventType: "task_assignment",
		Action: "create", Target: id, Detail: map[string]any{"contributorUserId": contributorID, "lockedUntil": formatRuntimeTime(lockedUntil)},
	})
	item, err := api.loadAssignment(r.Context(), id)
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	web.JSON(w, http.StatusCreated, map[string]any{"data": item})
}

func (api API) getCurrentTaskAssignment(w http.ResponseWriter, r *http.Request) {
	taskID := chi.URLParam(r, "taskId")
	user := authpkg.User(r)
	if ok, err := api.ensureTaskAccess(r.Context(), w, r, taskID, "developer"); err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	} else if !ok {
		return
	}
	item, err := api.loadCurrentAssignmentForUser(r.Context(), taskID, user.Sub)
	if errors.Is(err, pgx.ErrNoRows) {
		web.JSON(w, http.StatusOK, map[string]any{"data": nil})
		return
	}
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	web.JSON(w, http.StatusOK, map[string]any{"data": item})
}

func (api API) releaseCurrentTaskAssignment(w http.ResponseWriter, r *http.Request) {
	taskID := chi.URLParam(r, "taskId")
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
	now := time.Now().UTC()
	tag, err := api.DB.Exec(r.Context(), `
		UPDATE task_assignments
		SET status='released', updated_at=$1, released_at=$1
		WHERE task_id=$2 AND contributor_user_id=$3 AND status='active'
	`, now, taskID, user.Sub)
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	if tag.RowsAffected() == 0 {
		web.Error(w, http.StatusNotFound, "Active assignment not found")
		return
	}
	_ = api.recordAudit(r.Context(), auditInput{
		UserID: user.Sub, ProjectID: projectID, TaskID: taskID, EventType: "task_assignment",
		Action: "release", Target: taskID,
	})
	web.JSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (api API) createWorkspaceBranch(w http.ResponseWriter, r *http.Request) {
	taskID := chi.URLParam(r, "taskId")
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
	var body createWorkspaceRequest
	if !decodeBody(w, r, &body) {
		return
	}
	existing, err := api.loadActiveWorkspaceBranch(r.Context(), taskID, user.Sub)
	if err == nil {
		web.JSON(w, http.StatusOK, map[string]any{"data": existing})
		return
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	assignmentID := body.AssignmentID
	if assignmentID == nil || *assignmentID == "" {
		assignment, err := api.loadCurrentAssignmentForUser(r.Context(), taskID, user.Sub)
		if err == nil {
			if id, ok := assignment["id"].(string); ok {
				assignmentID = &id
			}
		} else if !errors.Is(err, pgx.ErrNoRows) {
			web.Error(w, http.StatusInternalServerError, err.Error())
			return
		}
	}
	branchName := defaultBranchName(taskID, user.Sub)
	if body.BranchName != nil && strings.TrimSpace(*body.BranchName) != "" {
		branchName = strings.TrimSpace(*body.BranchName)
	}
	if err := validateBranchName(branchName); err != nil {
		web.Error(w, http.StatusBadRequest, err.Error())
		return
	}
	id := uuid.NewString()
	now := time.Now().UTC()
	_, err = api.DB.Exec(r.Context(), `
		INSERT INTO workspace_branches (
			id, task_id, assignment_id, user_id, branch_name, base_revision, workspace_root, status, created_at, updated_at
		) VALUES ($1,$2,$3,$4,$5,$6,$7,'active',$8,$8)
	`, id, taskID, assignmentID, user.Sub, branchName, body.BaseRevision, body.WorkspaceRoot, now)
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	_ = api.recordAudit(r.Context(), auditInput{
		UserID: user.Sub, ProjectID: projectID, TaskID: taskID, EventType: "workspace_branch",
		Action: "create", Target: id, Detail: map[string]any{"branchName": branchName, "assignmentId": assignmentID},
	})
	item, err := api.loadWorkspaceBranch(r.Context(), id)
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	web.JSON(w, http.StatusCreated, map[string]any{"data": item})
}

func (api API) getCurrentWorkspaceBranch(w http.ResponseWriter, r *http.Request) {
	taskID := chi.URLParam(r, "taskId")
	user := authpkg.User(r)
	if ok, err := api.ensureTaskAccess(r.Context(), w, r, taskID, "developer"); err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	} else if !ok {
		return
	}
	item, err := api.loadActiveWorkspaceBranch(r.Context(), taskID, user.Sub)
	if errors.Is(err, pgx.ErrNoRows) {
		web.JSON(w, http.StatusOK, map[string]any{"data": nil})
		return
	}
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	web.JSON(w, http.StatusOK, map[string]any{"data": item})
}

func (api API) createCommitStep(w http.ResponseWriter, r *http.Request) {
	taskID := chi.URLParam(r, "taskId")
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
	var body createCommitStepRequest
	if !decodeBody(w, r, &body) {
		return
	}
	body.CommitSha = strings.TrimSpace(body.CommitSha)
	if body.CommitSha == "" {
		web.Error(w, http.StatusBadRequest, "commitSha is required")
		return
	}
	if body.StepIndex <= 0 {
		stepIndex, err := api.nextCommitStepIndex(r.Context(), taskID)
		if err != nil {
			web.Error(w, http.StatusInternalServerError, err.Error())
			return
		}
		body.StepIndex = stepIndex
	}
	normalizeCommitStepDefaults(&body)
	if err := validateCommitStep(body); err != nil {
		web.Error(w, http.StatusBadRequest, err.Error())
		return
	}
	id := uuid.NewString()
	now := time.Now().UTC()
	_, err = api.DB.Exec(r.Context(), `
		INSERT INTO commit_steps (
			id, task_id, assignment_id, workspace_branch_id, code_change_id, step_index, commit_sha,
			parent_commit_sha, branch_name, summary, test_status, preview_status, risk_level, created_at
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
	`, id, taskID, body.AssignmentID, body.WorkspaceBranchID, body.CodeChangeID, body.StepIndex, body.CommitSha, body.ParentCommitSha, body.BranchName, body.Summary, body.TestStatus, body.PreviewStatus, body.RiskLevel, now)
	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" {
			web.Error(w, http.StatusConflict, "Commit step already exists")
			return
		}
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	_ = api.recordAudit(r.Context(), auditInput{
		UserID: user.Sub, ProjectID: projectID, TaskID: taskID, EventType: "commit_step",
		Action: "create", Target: id, RiskLevel: body.RiskLevel,
		Detail: map[string]any{"commitSha": body.CommitSha, "stepIndex": body.StepIndex, "testStatus": body.TestStatus, "previewStatus": body.PreviewStatus},
	})
	_ = api.insertTaskDomainEvent(r.Context(), projectID, taskID, nil, nil, nil, "commit.step.recorded", map[string]any{"commitStepId": id, "commitSha": body.CommitSha, "stepIndex": body.StepIndex})
	item, err := api.loadCommitStep(r.Context(), id)
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	web.JSON(w, http.StatusCreated, map[string]any{"data": item})
}

func (api API) listCommitSteps(w http.ResponseWriter, r *http.Request) {
	taskID := chi.URLParam(r, "taskId")
	if ok, err := api.ensureTaskAccess(r.Context(), w, r, taskID, "developer"); err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	} else if !ok {
		return
	}
	rows, err := api.DB.Query(r.Context(), `
		SELECT id, task_id, assignment_id, workspace_branch_id, code_change_id, step_index, commit_sha,
		       parent_commit_sha, branch_name, summary, test_status, preview_status, risk_level, created_at
		FROM commit_steps
		WHERE task_id=$1
		ORDER BY step_index ASC, created_at ASC
	`, taskID)
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	defer rows.Close()
	items, err := scanCommitStepRows(rows)
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	web.JSON(w, http.StatusOK, map[string]any{"data": items})
}

func (api API) getCommitStepFiles(w http.ResponseWriter, r *http.Request) {
	taskID := chi.URLParam(r, "taskId")
	stepID := chi.URLParam(r, "stepId")
	if ok, err := api.ensureTaskAccess(r.Context(), w, r, taskID, "developer"); err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	} else if !ok {
		return
	}
	var changeID *string
	if err := api.DB.QueryRow(r.Context(), `SELECT code_change_id FROM commit_steps WHERE id=$1 AND task_id=$2`, stepID, taskID).Scan(&changeID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			web.Error(w, http.StatusNotFound, "Commit step not found")
			return
		}
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	if changeID == nil || *changeID == "" {
		web.JSON(w, http.StatusOK, map[string]any{"data": []any{}})
		return
	}
	rctx := chi.NewRouteContext()
	rctx.URLParams.Add("taskId", taskID)
	rctx.URLParams.Add("changeId", *changeID)
	api.listTaskFileChanges(w, r.WithContext(context.WithValue(r.Context(), chi.RouteCtxKey, rctx)))
}

func (api API) startCommitRuntime(w http.ResponseWriter, r *http.Request) {
	commitSha := strings.TrimSpace(chi.URLParam(r, "commitSha"))
	if commitSha == "" {
		web.Error(w, http.StatusBadRequest, "commitSha is required")
		return
	}
	var body startCommitRuntimeRequest
	if !decodeBody(w, r, &body) {
		return
	}
	step, err := api.loadCommitStepBySha(r.Context(), commitSha)
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
	runtimeLevel := body.RuntimeLevel
	if runtimeLevel == 0 {
		runtimeLevel = api.defaultRuntimeLevel(r.Context(), taskID)
	}
	if runtimeLevel < 1 || runtimeLevel > 5 {
		web.Error(w, http.StatusBadRequest, "runtimeLevel must be between 1 and 5")
		return
	}
	provider := body.Provider
	if provider == "" {
		provider = "local"
	}
	status := body.Status
	if status == "" {
		status = "queued"
	}
	if !validRuntimeStatus(status) {
		web.Error(w, http.StatusBadRequest, "Invalid runtime status")
		return
	}
	ttl := body.TTLSeconds
	if ttl <= 0 {
		ttl = 1800
	}
	previewURL := body.PreviewURL
	if previewURL == nil || *previewURL == "" {
		value := fmt.Sprintf("/preview/commits/%s", commitSha)
		previewURL = &value
	}
	id := uuid.NewString()
	now := time.Now().UTC()
	expiresAt := now.Add(time.Duration(ttl) * time.Second)
	_, err = api.DB.Exec(r.Context(), `
		INSERT INTO commit_runtimes (
			id, task_id, commit_step_id, commit_sha, runtime_level, provider, status,
			preview_url, logs_url, ttl_seconds, requested_by_user_id, created_at, updated_at, expires_at
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$12,$13)
		ON CONFLICT (commit_sha) DO UPDATE SET
			commit_step_id=COALESCE(EXCLUDED.commit_step_id, commit_runtimes.commit_step_id),
			runtime_level=EXCLUDED.runtime_level,
			provider=EXCLUDED.provider,
			status=EXCLUDED.status,
			preview_url=EXCLUDED.preview_url,
			logs_url=EXCLUDED.logs_url,
			ttl_seconds=EXCLUDED.ttl_seconds,
			requested_by_user_id=EXCLUDED.requested_by_user_id,
			updated_at=EXCLUDED.updated_at,
			expires_at=EXCLUDED.expires_at
	`, id, taskID, nullString(commitStepID), commitSha, runtimeLevel, provider, status, previewURL, body.LogsURL, ttl, user.Sub, now, expiresAt)
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	if commitStepID != "" {
		_, _ = api.DB.Exec(r.Context(), `UPDATE commit_steps SET preview_status=$1 WHERE id=$2`, commitStepPreviewStatus(status), commitStepID)
	}
	_ = api.recordAudit(r.Context(), auditInput{
		UserID: user.Sub, ProjectID: projectID, TaskID: taskID, EventType: "commit_runtime",
		Action: "start", Target: commitSha, Detail: map[string]any{"runtimeLevel": runtimeLevel, "provider": provider, "status": status, "previewUrl": previewURL},
	})
	item, err := api.loadCommitRuntimeBySha(r.Context(), commitSha)
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	web.JSON(w, http.StatusOK, map[string]any{"data": item})
}

func (api API) getCommitRuntime(w http.ResponseWriter, r *http.Request) {
	commitSha := chi.URLParam(r, "commitSha")
	item, err := api.loadCommitRuntimeBySha(r.Context(), commitSha)
	if errors.Is(err, pgx.ErrNoRows) {
		web.Error(w, http.StatusNotFound, "Commit runtime not found")
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

func (api API) getCommitRuntimePreviewURL(w http.ResponseWriter, r *http.Request) {
	commitSha := chi.URLParam(r, "commitSha")
	item, err := api.loadCommitRuntimeBySha(r.Context(), commitSha)
	if errors.Is(err, pgx.ErrNoRows) {
		web.Error(w, http.StatusNotFound, "Commit runtime not found")
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
	web.JSON(w, http.StatusOK, map[string]any{"data": map[string]any{"commitSha": commitSha, "previewUrl": item["previewUrl"], "status": item["status"], "expiresAt": item["expiresAt"]}})
}

func (api API) taskProjectID(ctx context.Context, taskID string) (string, error) {
	var projectID string
	err := api.DB.QueryRow(ctx, `SELECT project_id FROM tasks WHERE id=$1`, taskID).Scan(&projectID)
	return projectID, err
}

func (api API) ensureTaskAccess(ctx context.Context, w http.ResponseWriter, r *http.Request, taskID string, minRole string) (bool, error) {
	projectID, err := api.taskProjectID(ctx, taskID)
	if errors.Is(err, pgx.ErrNoRows) {
		web.Error(w, http.StatusNotFound, "Task not found")
		return false, nil
	}
	if err != nil {
		return false, err
	}
	user := authpkg.User(r)
	if !authpkg.HasProjectRole(user, projectID, minRole) {
		web.Error(w, http.StatusForbidden, "Insufficient project permissions")
		return false, nil
	}
	return true, nil
}

func (api API) loadTaskBoundary(ctx context.Context, taskID string) (map[string]any, error) {
	var allowedPaths, blockedPaths, checks []byte
	var runtimeLevel int
	var rewardAmount *float64
	var rewardCurrency, riskLevel string
	var createdAt, updatedAt time.Time
	err := api.DB.QueryRow(ctx, `
		SELECT allowed_paths_json, blocked_paths_json, acceptance_checks_json, runtime_level,
		       reward_amount, reward_currency, risk_level, created_at, updated_at
		FROM task_boundaries
		WHERE task_id=$1
	`, taskID).Scan(&allowedPaths, &blockedPaths, &checks, &runtimeLevel, &rewardAmount, &rewardCurrency, &riskLevel, &createdAt, &updatedAt)
	if err != nil {
		return nil, err
	}
	return map[string]any{
		"taskId": taskID, "allowedPaths": scanJSONArray(allowedPaths), "blockedPaths": scanJSONArray(blockedPaths),
		"acceptanceChecks": scanJSONArray(checks), "runtimeLevel": runtimeLevel, "rewardAmount": rewardAmount,
		"rewardCurrency": rewardCurrency, "riskLevel": riskLevel, "createdAt": formatRuntimeTime(&createdAt), "updatedAt": formatRuntimeTime(&updatedAt),
	}, nil
}

func (api API) loadAssignment(ctx context.Context, id string) (map[string]any, error) {
	return scanAssignment(api.DB.QueryRow(ctx, `
		SELECT id, task_id, contributor_user_id, status, locked_until, created_at, updated_at, released_at
		FROM task_assignments WHERE id=$1
	`, id))
}

func (api API) loadCurrentAssignmentForUser(ctx context.Context, taskID string, userID string) (map[string]any, error) {
	return scanAssignment(api.DB.QueryRow(ctx, `
		SELECT id, task_id, contributor_user_id, status, locked_until, created_at, updated_at, released_at
		FROM task_assignments
		WHERE task_id=$1 AND contributor_user_id=$2 AND status='active'
		ORDER BY created_at DESC
		LIMIT 1
	`, taskID, userID))
}

func scanAssignment(row pgx.Row) (map[string]any, error) {
	var id, taskID, contributorUserID, status string
	var lockedUntil, releasedAt *time.Time
	var createdAt, updatedAt time.Time
	if err := row.Scan(&id, &taskID, &contributorUserID, &status, &lockedUntil, &createdAt, &updatedAt, &releasedAt); err != nil {
		return nil, err
	}
	return map[string]any{
		"id": id, "taskId": taskID, "contributorUserId": contributorUserID, "status": status,
		"lockedUntil": formatRuntimeTime(lockedUntil), "createdAt": formatRuntimeTime(&createdAt),
		"updatedAt": formatRuntimeTime(&updatedAt), "releasedAt": formatRuntimeTime(releasedAt),
	}, nil
}

func (api API) loadWorkspaceBranch(ctx context.Context, id string) (map[string]any, error) {
	return scanWorkspaceBranch(api.DB.QueryRow(ctx, `
		SELECT id, task_id, assignment_id, user_id, branch_name, base_revision, workspace_root, status, created_at, updated_at
		FROM workspace_branches WHERE id=$1
	`, id))
}

func (api API) loadActiveWorkspaceBranch(ctx context.Context, taskID string, userID string) (map[string]any, error) {
	return scanWorkspaceBranch(api.DB.QueryRow(ctx, `
		SELECT id, task_id, assignment_id, user_id, branch_name, base_revision, workspace_root, status, created_at, updated_at
		FROM workspace_branches
		WHERE task_id=$1 AND user_id=$2 AND status='active'
		ORDER BY created_at DESC
		LIMIT 1
	`, taskID, userID))
}

func scanWorkspaceBranch(row pgx.Row) (map[string]any, error) {
	var id, taskID, userID, branchName, status string
	var assignmentID, baseRevision, workspaceRoot *string
	var createdAt, updatedAt time.Time
	if err := row.Scan(&id, &taskID, &assignmentID, &userID, &branchName, &baseRevision, &workspaceRoot, &status, &createdAt, &updatedAt); err != nil {
		return nil, err
	}
	return map[string]any{
		"id": id, "taskId": taskID, "assignmentId": assignmentID, "userId": userID, "branchName": branchName,
		"baseRevision": baseRevision, "workspaceRoot": workspaceRoot, "status": status,
		"createdAt": formatRuntimeTime(&createdAt), "updatedAt": formatRuntimeTime(&updatedAt),
	}, nil
}

func (api API) nextCommitStepIndex(ctx context.Context, taskID string) (int, error) {
	var current sql.NullInt64
	if err := api.DB.QueryRow(ctx, `SELECT MAX(step_index) FROM commit_steps WHERE task_id=$1`, taskID).Scan(&current); err != nil {
		return 0, err
	}
	if !current.Valid {
		return 1, nil
	}
	return int(current.Int64) + 1, nil
}

func (api API) loadCommitStep(ctx context.Context, id string) (map[string]any, error) {
	return scanCommitStep(api.DB.QueryRow(ctx, `
		SELECT id, task_id, assignment_id, workspace_branch_id, code_change_id, step_index, commit_sha,
		       parent_commit_sha, branch_name, summary, test_status, preview_status, risk_level, created_at
		FROM commit_steps WHERE id=$1
	`, id))
}

func (api API) loadCommitStepBySha(ctx context.Context, commitSha string) (map[string]any, error) {
	return scanCommitStep(api.DB.QueryRow(ctx, `
		SELECT id, task_id, assignment_id, workspace_branch_id, code_change_id, step_index, commit_sha,
		       parent_commit_sha, branch_name, summary, test_status, preview_status, risk_level, created_at
		FROM commit_steps WHERE commit_sha=$1
	`, commitSha))
}

func scanCommitStep(row pgx.Row) (map[string]any, error) {
	var id, taskID, commitSha, testStatus, previewStatus, riskLevel string
	var assignmentID, workspaceBranchID, codeChangeID, parentCommitSha, branchName, summary *string
	var stepIndex int
	var createdAt time.Time
	if err := row.Scan(&id, &taskID, &assignmentID, &workspaceBranchID, &codeChangeID, &stepIndex, &commitSha, &parentCommitSha, &branchName, &summary, &testStatus, &previewStatus, &riskLevel, &createdAt); err != nil {
		return nil, err
	}
	return map[string]any{
		"id": id, "taskId": taskID, "assignmentId": assignmentID, "workspaceBranchId": workspaceBranchID,
		"codeChangeId": codeChangeID, "stepIndex": stepIndex, "commitSha": commitSha,
		"parentCommitSha": parentCommitSha, "branchName": branchName, "summary": summary,
		"testStatus": testStatus, "previewStatus": previewStatus, "riskLevel": riskLevel,
		"createdAt": formatRuntimeTime(&createdAt),
	}, nil
}

func scanCommitStepRows(rows pgx.Rows) ([]map[string]any, error) {
	items := []map[string]any{}
	for rows.Next() {
		item, err := scanCommitStep(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (api API) loadCommitRuntimeBySha(ctx context.Context, commitSha string) (map[string]any, error) {
	var id, taskID, sha, provider, status string
	var commitStepID, previewURL, logsURL, requestedByUserID *string
	var runtimeLevel, ttlSeconds int
	var createdAt, updatedAt time.Time
	var expiresAt *time.Time
	err := api.DB.QueryRow(ctx, `
		SELECT id, task_id, commit_step_id, commit_sha, runtime_level, provider, status,
		       preview_url, logs_url, ttl_seconds, requested_by_user_id, created_at, updated_at, expires_at
		FROM commit_runtimes
		WHERE commit_sha=$1
	`, commitSha).Scan(&id, &taskID, &commitStepID, &sha, &runtimeLevel, &provider, &status, &previewURL, &logsURL, &ttlSeconds, &requestedByUserID, &createdAt, &updatedAt, &expiresAt)
	if err != nil {
		return nil, err
	}
	return map[string]any{
		"id": id, "taskId": taskID, "commitStepId": commitStepID, "commitSha": sha,
		"runtimeLevel": runtimeLevel, "provider": provider, "status": status, "previewUrl": previewURL,
		"logsUrl": logsURL, "ttlSeconds": ttlSeconds, "requestedByUserId": requestedByUserID,
		"createdAt": formatRuntimeTime(&createdAt), "updatedAt": formatRuntimeTime(&updatedAt), "expiresAt": formatRuntimeTime(expiresAt),
	}, nil
}

func (api API) defaultRuntimeLevel(ctx context.Context, taskID string) int {
	var level int
	if err := api.DB.QueryRow(ctx, `SELECT runtime_level FROM task_boundaries WHERE task_id=$1`, taskID).Scan(&level); err == nil && level >= 1 && level <= 5 {
		return level
	}
	return 1
}

func validateTaskBoundary(body taskBoundaryRequest) error {
	if body.RuntimeLevel < 1 || body.RuntimeLevel > 5 {
		return errors.New("runtimeLevel must be between 1 and 5")
	}
	if body.RiskLevel != "" && !validRiskLevel(body.RiskLevel) {
		return errors.New("Invalid riskLevel")
	}
	for _, path := range append(body.AllowedPaths, body.BlockedPaths...) {
		if err := validatePathPattern(path); err != nil {
			return err
		}
	}
	return nil
}

func validatePathPattern(path string) error {
	trimmed := strings.TrimSpace(path)
	if trimmed == "" {
		return errors.New("path patterns cannot be empty")
	}
	if strings.HasPrefix(trimmed, "/") || strings.Contains(trimmed, "..") {
		return fmt.Errorf("unsafe path pattern: %s", path)
	}
	return nil
}

func validateBranchName(name string) error {
	if name == "" {
		return errors.New("branchName is required")
	}
	if strings.Contains(name, " ") || strings.HasPrefix(name, "-") || strings.Contains(name, "..") {
		return errors.New("Invalid branchName")
	}
	return nil
}

func normalizeCommitStepDefaults(body *createCommitStepRequest) {
	if body.TestStatus == "" {
		body.TestStatus = "not_run"
	}
	if body.PreviewStatus == "" {
		body.PreviewStatus = "not_requested"
	}
	if body.RiskLevel == "" {
		body.RiskLevel = "low"
	}
}

func validateCommitStep(body createCommitStepRequest) error {
	if body.StepIndex < 1 {
		return errors.New("stepIndex must be positive")
	}
	if !validTestStatus(body.TestStatus) {
		return errors.New("Invalid testStatus")
	}
	if !validCommitPreviewStatus(body.PreviewStatus) {
		return errors.New("Invalid previewStatus")
	}
	if !validRiskLevel(body.RiskLevel) {
		return errors.New("Invalid riskLevel")
	}
	return nil
}

func validRiskLevel(value string) bool {
	return value == "low" || value == "medium" || value == "high" || value == "critical"
}

func validTestStatus(value string) bool {
	return value == "not_run" || value == "running" || value == "passed" || value == "failed" || value == "skipped"
}

func validCommitPreviewStatus(value string) bool {
	return value == "not_requested" || value == "queued" || value == "starting" || value == "running" || value == "failed" || value == "stopped"
}

func validRuntimeStatus(value string) bool {
	return value == "queued" || value == "prepared" || value == "starting" || value == "running" || value == "failed" || value == "stopped" || value == "expired"
}

func commitStepPreviewStatus(runtimeStatus string) string {
	switch runtimeStatus {
	case "queued", "prepared":
		return "queued"
	case "starting":
		return "starting"
	case "running":
		return "running"
	case "failed":
		return "failed"
	default:
		return "stopped"
	}
}

func valueString(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}

func defaultBranchName(taskID string, userID string) string {
	taskPart := taskID
	if len(taskPart) > 8 {
		taskPart = taskPart[:8]
	}
	userPart := userID
	if len(userPart) > 8 {
		userPart = userPart[:8]
	}
	return "codex/task-" + taskPart + "/" + userPart
}
