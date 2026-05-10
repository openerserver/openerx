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

type settleAssignmentRequest struct {
	Outcome         string   `json:"outcome"`
	RewardAmount    *float64 `json:"rewardAmount"`
	RewardCurrency  string   `json:"rewardCurrency"`
	ReputationDelta *float64 `json:"reputationDelta"`
	Note            *string  `json:"note"`
}

type settlementDelta struct {
	Status         string
	CompletedDelta int
	RejectedDelta  int
	RiskDelta      int
	Reputation     float64
}

type marketplaceTask struct {
	ID                    string
	ProjectID             string
	Title                 string
	Category              *string
	LifecycleStatus       *string
	RuntimeLevel          int
	RewardAmount          *float64
	RewardCurrency        string
	RiskLevel             string
	AssignmentID          *string
	AssignedContributorID *string
	CreatedAt             time.Time
	UpdatedAt             time.Time
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

type commitStepFileChange struct {
	FilePath   string
	Insertions int
	Deletions  int
}

type commitStepPolicyDecision struct {
	Allowed          bool
	Status           int
	Message          string
	OverallRisk      string
	ApprovalRequired bool
	Violations       []map[string]any
	ChangeRequest    map[string]any
}

type startCommitRuntimeRequest struct {
	TaskID         *string `json:"taskId"`
	CommitStepID   *string `json:"commitStepId"`
	RuntimeLevel   int     `json:"runtimeLevel"`
	Provider       string  `json:"provider"`
	Status         string  `json:"status"`
	PreviewURL     *string `json:"previewUrl"`
	TargetURL      *string `json:"targetUrl"`
	LogsURL        *string `json:"logsUrl"`
	TTLSeconds     int     `json:"ttlSeconds"`
	StartedAt      *string `json:"startedAt"`
	StoppedAt      *string `json:"stoppedAt"`
	LastAccessedAt *string `json:"lastAccessedAt"`
	ErrorMessage   *string `json:"errorMessage"`
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

func (api API) listTaskMarketplace(w http.ResponseWriter, r *http.Request) {
	projectID := r.URL.Query().Get("projectId")
	if projectID == "" {
		web.Error(w, http.StatusBadRequest, "projectId is required")
		return
	}
	user := authpkg.User(r)
	if !authpkg.HasProjectRole(user, projectID, "developer") {
		web.Error(w, http.StatusForbidden, "Insufficient project permissions")
		return
	}
	profile, err := api.ensureContributorProfile(r.Context(), user.Sub)
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	activeCount, err := api.countContributorActiveAssignments(r.Context(), profile.UserID)
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	todayCount, err := api.countContributorAssignmentsSince(r.Context(), profile.UserID, startOfUTCDay(time.Now().UTC()))
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	includeAssigned := r.URL.Query().Get("includeAssigned") == "1" || r.URL.Query().Get("includeAssigned") == "true"
	rows, err := api.DB.Query(r.Context(), `
		SELECT t.id, t.project_id, t.title, t.category, t.lifecycle_status,
		       COALESCE(tb.runtime_level, 1) AS runtime_level,
		       tb.reward_amount::float8, COALESCE(tb.reward_currency, 'points') AS reward_currency,
		       COALESCE(tb.risk_level, 'low') AS risk_level,
		       active.id AS assignment_id, active.contributor_user_id AS assigned_contributor_user_id,
		       t.created_at, t.updated_at
		FROM tasks t
		LEFT JOIN task_boundaries tb ON tb.task_id=t.id
		LEFT JOIN LATERAL (
			SELECT id, contributor_user_id
			FROM task_assignments
			WHERE task_id=t.id AND status='active'
			ORDER BY created_at DESC
			LIMIT 1
		) active ON true
		WHERE t.project_id=$1
		  AND ($2::boolean OR active.id IS NULL)
		  AND COALESCE(t.lifecycle_status, t.status, 'draft') NOT IN ('done', 'archived', 'cancelled')
		ORDER BY COALESCE(tb.reward_amount, 0) DESC, t.updated_at DESC
		LIMIT $3
	`, projectID, includeAssigned, parseLimit(r, 50, 200))
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	defer rows.Close()
	items := []map[string]any{}
	for rows.Next() {
		var item marketplaceTask
		if err := rows.Scan(
			&item.ID, &item.ProjectID, &item.Title, &item.Category, &item.LifecycleStatus,
			&item.RuntimeLevel, &item.RewardAmount, &item.RewardCurrency, &item.RiskLevel,
			&item.AssignmentID, &item.AssignedContributorID, &item.CreatedAt, &item.UpdatedAt,
		); err != nil {
			web.Error(w, http.StatusInternalServerError, err.Error())
			return
		}
		eligible, reason := marketplaceEligibility(profile, item.RiskLevel, item.RuntimeLevel, activeCount, todayCount)
		if item.AssignmentID != nil && *item.AssignmentID != "" {
			eligible = false
			reason = "Task already assigned"
		}
		items = append(items, map[string]any{
			"id": item.ID, "projectId": item.ProjectID, "title": item.Title, "category": item.Category,
			"lifecycleStatus": item.LifecycleStatus, "runtimeLevel": item.RuntimeLevel,
			"rewardAmount": item.RewardAmount, "rewardCurrency": item.RewardCurrency, "riskLevel": item.RiskLevel,
			"assignmentId": item.AssignmentID, "assignedContributorUserId": item.AssignedContributorID,
			"eligible": eligible, "blockedReason": reason,
			"createdAt": formatRuntimeTime(&item.CreatedAt), "updatedAt": formatRuntimeTime(&item.UpdatedAt),
		})
	}
	if err := rows.Err(); err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	web.JSON(w, http.StatusOK, map[string]any{"data": items})
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
	profile, err := api.ensureContributorProfile(r.Context(), contributorID)
	if errors.Is(err, pgx.ErrNoRows) {
		web.Error(w, http.StatusNotFound, "Contributor not found")
		return
	}
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	if err := api.validateContributorCanAcceptTask(r.Context(), taskID, profile); err != nil {
		web.Error(w, http.StatusForbidden, err.Error())
		return
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
		Action: "create", Target: id, Detail: map[string]any{"contributorUserId": contributorID, "contributorLevel": profile.Level, "lockedUntil": formatRuntimeTime(lockedUntil)},
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

func (api API) settleTaskAssignment(w http.ResponseWriter, r *http.Request) {
	taskID := chi.URLParam(r, "taskId")
	assignmentID := chi.URLParam(r, "assignmentId")
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
	var body settleAssignmentRequest
	if !decodeBody(w, r, &body) {
		return
	}
	delta, err := assignmentSettlementDelta(body.Outcome, body.ReputationDelta)
	if err != nil {
		web.Error(w, http.StatusBadRequest, err.Error())
		return
	}
	item, err := api.loadAssignment(r.Context(), assignmentID)
	if errors.Is(err, pgx.ErrNoRows) {
		web.Error(w, http.StatusNotFound, "Assignment not found")
		return
	}
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	if stringFromMap(item, "taskId") != taskID {
		web.Error(w, http.StatusNotFound, "Assignment not found")
		return
	}
	contributorID := stringFromMap(item, "contributorUserId")
	if _, err := api.ensureContributorProfile(r.Context(), contributorID); err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	rewardAmount := body.RewardAmount
	rewardCurrency := body.RewardCurrency
	if rewardCurrency == "" {
		rewardCurrency = "points"
	}
	if rewardAmount == nil {
		var amount *float64
		var currency string
		err := api.DB.QueryRow(r.Context(), `SELECT reward_amount::float8, reward_currency FROM task_boundaries WHERE task_id=$1`, taskID).Scan(&amount, &currency)
		if err == nil {
			rewardAmount = amount
			if currency != "" {
				rewardCurrency = currency
			}
		} else if !errors.Is(err, pgx.ErrNoRows) {
			web.Error(w, http.StatusInternalServerError, err.Error())
			return
		}
	}
	now := time.Now().UTC()
	_, err = api.DB.Exec(r.Context(), `
		UPDATE task_assignments
		SET status=$1, updated_at=$2, released_at=CASE WHEN $1='released' THEN $2 ELSE released_at END
		WHERE id=$3 AND task_id=$4
	`, delta.Status, now, assignmentID, taskID)
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	_, err = api.DB.Exec(r.Context(), `
		UPDATE contributor_profiles
		SET completed_tasks=completed_tasks+$2,
		    rejected_changes=rejected_changes+$3,
		    risk_incidents=risk_incidents+$4,
		    reputation_score=reputation_score+$5,
		    updated_at=$6
		WHERE user_id=$1
	`, contributorID, delta.CompletedDelta, delta.RejectedDelta, delta.RiskDelta, delta.Reputation, now)
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	_ = api.recordAudit(r.Context(), auditInput{
		UserID: user.Sub, ProjectID: projectID, TaskID: taskID, EventType: "task_assignment",
		Action: "settle", Target: assignmentID, RiskLevel: "low",
		Detail: map[string]any{
			"outcome": body.Outcome, "contributorUserId": contributorID, "rewardAmount": rewardAmount,
			"rewardCurrency": rewardCurrency, "reputationDelta": delta.Reputation, "note": body.Note,
		},
	})
	updated, err := api.loadAssignment(r.Context(), assignmentID)
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	web.JSON(w, http.StatusOK, map[string]any{
		"data": map[string]any{
			"assignment": updated, "outcome": body.Outcome, "rewardAmount": rewardAmount,
			"rewardCurrency": rewardCurrency, "reputationDelta": delta.Reputation,
		},
	})
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
	decision, err := api.evaluateCommitStepPolicy(r.Context(), projectID, taskID, user, body)
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	if !decision.Allowed {
		web.JSON(w, decision.Status, map[string]any{
			"error": decision.Message,
			"policyDecision": map[string]any{
				"overallRisk":      decision.OverallRisk,
				"approvalRequired": decision.ApprovalRequired,
				"violations":       decision.Violations,
				"changeRequest":    decision.ChangeRequest,
			},
		})
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
	startedAt := parseOptionalRuntimeTime(body.StartedAt)
	stoppedAt := parseOptionalRuntimeTime(body.StoppedAt)
	lastAccessedAt := parseOptionalRuntimeTime(body.LastAccessedAt)
	if status == "running" && startedAt == nil {
		startedAt = &now
	}
	expiresAt := now.Add(time.Duration(ttl) * time.Second)
	_, err = api.DB.Exec(r.Context(), `
		INSERT INTO commit_runtimes (
			id, task_id, commit_step_id, commit_sha, runtime_level, provider, status,
			preview_url, target_url, logs_url, ttl_seconds, requested_by_user_id, created_at,
			updated_at, expires_at, started_at, stopped_at, last_accessed_at, error_message
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$13,$14,$15,$16,$17,$18)
		ON CONFLICT (commit_sha) DO UPDATE SET
			commit_step_id=COALESCE(EXCLUDED.commit_step_id, commit_runtimes.commit_step_id),
			runtime_level=EXCLUDED.runtime_level,
			provider=EXCLUDED.provider,
			status=EXCLUDED.status,
			preview_url=EXCLUDED.preview_url,
			target_url=EXCLUDED.target_url,
			logs_url=EXCLUDED.logs_url,
			ttl_seconds=EXCLUDED.ttl_seconds,
			requested_by_user_id=EXCLUDED.requested_by_user_id,
			updated_at=EXCLUDED.updated_at,
			expires_at=EXCLUDED.expires_at,
			started_at=COALESCE(EXCLUDED.started_at, commit_runtimes.started_at),
			stopped_at=EXCLUDED.stopped_at,
			last_accessed_at=COALESCE(EXCLUDED.last_accessed_at, commit_runtimes.last_accessed_at),
			error_message=EXCLUDED.error_message
	`, id, taskID, nullString(commitStepID), commitSha, runtimeLevel, provider, status, previewURL, body.TargetURL, body.LogsURL, ttl, user.Sub, now, expiresAt, startedAt, stoppedAt, lastAccessedAt, body.ErrorMessage)
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	if commitStepID != "" {
		_, _ = api.DB.Exec(r.Context(), `UPDATE commit_steps SET preview_status=$1 WHERE id=$2`, commitStepPreviewStatus(status), commitStepID)
	}
	_ = api.recordAudit(r.Context(), auditInput{
		UserID: user.Sub, ProjectID: projectID, TaskID: taskID, EventType: "commit_runtime",
		Action: "start", Target: commitSha, Detail: map[string]any{"runtimeLevel": runtimeLevel, "provider": provider, "status": status, "previewUrl": previewURL, "targetUrl": body.TargetURL},
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
	return api.loadCommitRuntimeWhere(ctx, `commit_sha=$1`, commitSha)
}

func (api API) loadCommitRuntimeWhere(ctx context.Context, predicate string, arg any) (map[string]any, error) {
	var id, taskID, sha, provider, status string
	var commitStepID, previewURL, targetURL, logsURL, requestedByUserID, errorMessage *string
	var runtimeLevel, ttlSeconds int
	var createdAt, updatedAt time.Time
	var expiresAt, startedAt, stoppedAt, lastAccessedAt *time.Time
	err := api.DB.QueryRow(ctx, `
		SELECT id, task_id, commit_step_id, commit_sha, runtime_level, provider, status,
		       preview_url, target_url, logs_url, ttl_seconds, requested_by_user_id,
		       created_at, updated_at, expires_at, started_at, stopped_at, last_accessed_at,
		       error_message
		FROM commit_runtimes
		WHERE `+predicate, arg).Scan(&id, &taskID, &commitStepID, &sha, &runtimeLevel, &provider, &status, &previewURL, &targetURL, &logsURL, &ttlSeconds, &requestedByUserID, &createdAt, &updatedAt, &expiresAt, &startedAt, &stoppedAt, &lastAccessedAt, &errorMessage)
	if err != nil {
		return nil, err
	}
	return map[string]any{
		"id": id, "taskId": taskID, "commitStepId": commitStepID, "commitSha": sha,
		"runtimeLevel": runtimeLevel, "provider": provider, "status": status, "previewUrl": previewURL,
		"targetUrl": targetURL, "logsUrl": logsURL, "ttlSeconds": ttlSeconds, "requestedByUserId": requestedByUserID,
		"createdAt": formatRuntimeTime(&createdAt), "updatedAt": formatRuntimeTime(&updatedAt), "expiresAt": formatRuntimeTime(expiresAt),
		"startedAt": formatRuntimeTime(startedAt), "stoppedAt": formatRuntimeTime(stoppedAt),
		"lastAccessedAt": formatRuntimeTime(lastAccessedAt), "errorMessage": errorMessage,
	}, nil
}

func (api API) defaultRuntimeLevel(ctx context.Context, taskID string) int {
	var level int
	if err := api.DB.QueryRow(ctx, `SELECT runtime_level FROM task_boundaries WHERE task_id=$1`, taskID).Scan(&level); err == nil && level >= 1 && level <= 5 {
		return level
	}
	return 1
}

func (api API) evaluateCommitStepPolicy(ctx context.Context, projectID string, taskID string, user *authpkg.Claims, body createCommitStepRequest) (commitStepPolicyDecision, error) {
	decision := commitStepPolicyDecision{Allowed: true, OverallRisk: body.RiskLevel}
	profile, err := api.ensureContributorProfile(ctx, user.Sub)
	if err != nil {
		return decision, err
	}
	if profile.Status != "active" {
		return commitStepPolicyDecision{
			Allowed: false, Status: http.StatusForbidden, Message: fmt.Sprintf("Contributor is %s", profile.Status),
			OverallRisk: body.RiskLevel,
		}, nil
	}
	if !contributorCanAcceptRisk(profile.Level, body.RiskLevel) {
		return commitStepPolicyDecision{
			Allowed: false, Status: http.StatusForbidden,
			Message:     fmt.Sprintf("Contributor level %s cannot submit %s risk changes", profile.Level, body.RiskLevel),
			OverallRisk: body.RiskLevel,
		}, nil
	}
	if body.CodeChangeID == nil || *body.CodeChangeID == "" {
		return decision, nil
	}
	files, err := api.loadCommitStepFileChanges(ctx, taskID, *body.CodeChangeID)
	if err != nil {
		return decision, err
	}
	if len(files) == 0 {
		return decision, nil
	}
	owners, err := api.loadCodeOwnersForProjectContext(ctx, projectID)
	if err != nil {
		return decision, err
	}
	violations, overallRisk, approvalRequired := commitStepOwnerViolations(files, owners, body.RiskLevel)
	if !contributorCanAcceptRisk(profile.Level, overallRisk) {
		return commitStepPolicyDecision{
			Allowed: false, Status: http.StatusForbidden,
			Message:     fmt.Sprintf("Contributor level %s cannot submit %s risk changes", profile.Level, overallRisk),
			OverallRisk: overallRisk, ApprovalRequired: approvalRequired, Violations: violations,
		}, nil
	}
	matchedOwners := matchingCommitStepOwners(files, owners)
	if approvalRequired && !userCanBypassCommitOwnerApproval(user, projectID, profile, matchedOwners) {
		changeRequest, err := api.createCommitStepPolicyChangeRequest(ctx, taskID, body, overallRisk, violations)
		if err != nil {
			return decision, err
		}
		return commitStepPolicyDecision{
			Allowed: false, Status: http.StatusConflict,
			Message:          "Code owner approval is required before this commit step can be recorded",
			OverallRisk:      overallRisk,
			ApprovalRequired: true,
			Violations:       violations,
			ChangeRequest:    changeRequest,
		}, nil
	}
	decision.OverallRisk = overallRisk
	decision.ApprovalRequired = approvalRequired
	decision.Violations = violations
	return decision, nil
}

func (api API) loadCommitStepFileChanges(ctx context.Context, taskID string, codeChangeID string) ([]commitStepFileChange, error) {
	rows, err := api.DB.Query(ctx, `
		SELECT fc.file_path, fc.insertions, fc.deletions
		FROM file_changes fc
		JOIN code_changes cc ON cc.id=fc.change_id
		WHERE cc.task_id=$1 AND cc.id=$2
	`, taskID, codeChangeID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []commitStepFileChange{}
	for rows.Next() {
		var item commitStepFileChange
		if err := rows.Scan(&item.FilePath, &item.Insertions, &item.Deletions); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func commitStepOwnerViolations(files []commitStepFileChange, owners []codeOwnerRecord, fallbackRisk string) ([]map[string]any, string, bool) {
	violations := []map[string]any{}
	overallRisk := fallbackRisk
	approvalRequired := false
	for _, file := range files {
		matches := []map[string]any{}
		for _, owner := range owners {
			if !codeOwnerPatternMatches(owner.PathPattern, file.FilePath) {
				continue
			}
			matches = append(matches, publicCodeOwner(owner))
			if compareRisk(owner.RiskLevel, overallRisk) > 0 {
				overallRisk = owner.RiskLevel
			}
			if owner.RequiresApproval {
				approvalRequired = true
			}
		}
		if len(matches) > 0 {
			violations = append(violations, map[string]any{
				"ruleId": "code-owner-approval", "filePath": file.FilePath,
				"risk": overallRisk, "insertions": file.Insertions, "deletions": file.Deletions,
				"owners": matches,
			})
		}
	}
	return violations, overallRisk, approvalRequired
}

func matchingCommitStepOwners(files []commitStepFileChange, owners []codeOwnerRecord) []codeOwnerRecord {
	matches := []codeOwnerRecord{}
	seen := map[string]bool{}
	for _, file := range files {
		for _, owner := range owners {
			if !codeOwnerPatternMatches(owner.PathPattern, file.FilePath) || seen[owner.ID] {
				continue
			}
			seen[owner.ID] = true
			matches = append(matches, owner)
		}
	}
	return matches
}

func userCanBypassCommitOwnerApproval(user *authpkg.Claims, projectID string, profile contributorProfile, owners []codeOwnerRecord) bool {
	if contributorLevelRank(profile.Level) >= contributorLevelRank("L4") {
		return true
	}
	if authpkg.HasProjectRole(user, projectID, "project_admin") {
		return true
	}
	for _, owner := range owners {
		switch owner.OwnerType {
		case "user":
			if owner.OwnerRef == user.Sub {
				return true
			}
		case "role":
			if authpkg.HasProjectRole(user, projectID, owner.OwnerRef) {
				return true
			}
		}
	}
	return false
}

func (api API) createCommitStepPolicyChangeRequest(ctx context.Context, taskID string, body createCommitStepRequest, risk string, violations []map[string]any) (map[string]any, error) {
	_, ok, err := api.ensureDeveloperChangeRequestsAvailable(ctx, taskID)
	if err != nil {
		return nil, err
	}
	if !ok {
		return nil, pgx.ErrNoRows
	}
	id := uuid.NewString()
	now := time.Now().UTC()
	requiredChanges, _ := jsonBytes(violations)
	relatedFindingKeys, _ := jsonBytes([]string{"code-owner-approval"})
	title := "Code owner approval required"
	summary := fmt.Sprintf("Commit %s touches paths protected by code owner rules. Required risk level: %s.", body.CommitSha, risk)
	_, err = api.DB.Exec(ctx, `
		INSERT INTO developer_change_requests (
			id, task_id, task_stage_run_id, source_role_agent_id, assigned_role_agent_id, priority, title,
			summary, required_changes_json, related_finding_keys_json, blocking, approval_required, status,
			resolution_note, created_at, updated_at, resolved_at
		) VALUES ($1,$2,NULL,'policy.code-owner','role.code-owner','high',$3,$4,$5,$6,true,true,'open',NULL,$7,$7,NULL)
	`, id, taskID, title, summary, requiredChanges, relatedFindingKeys, now)
	if err != nil {
		return nil, err
	}
	return map[string]any{
		"id": id, "taskId": taskID, "priority": "high", "title": title, "summary": summary,
		"blocking": true, "approvalRequired": true, "status": "open", "createdAt": formatRuntimeTime(&now),
	}, nil
}

func marketplaceEligibility(profile contributorProfile, riskLevel string, runtimeLevel int, activeCount int, todayCount int) (bool, string) {
	if profile.Status != "active" {
		return false, fmt.Sprintf("Contributor is %s", profile.Status)
	}
	if !contributorCanAcceptRisk(profile.Level, riskLevel) {
		return false, fmt.Sprintf("Contributor level %s cannot accept %s risk tasks", profile.Level, riskLevel)
	}
	if runtimeLevel > 0 && !contributorCanUseRuntimeLevel(profile.Level, runtimeLevel) {
		return false, fmt.Sprintf("Contributor level %s cannot use runtime level %d", profile.Level, runtimeLevel)
	}
	if profile.ActiveTaskQuota >= 0 && activeCount >= profile.ActiveTaskQuota {
		return false, "Contributor active task quota exceeded"
	}
	if profile.DailyTaskQuota >= 0 && todayCount >= profile.DailyTaskQuota {
		return false, "Contributor daily task quota exceeded"
	}
	return true, ""
}

func assignmentSettlementDelta(outcome string, reputationDelta *float64) (settlementDelta, error) {
	switch outcome {
	case "accepted":
		value := 5.0
		if reputationDelta != nil {
			value = *reputationDelta
		}
		return settlementDelta{Status: "completed", CompletedDelta: 1, Reputation: value}, nil
	case "rejected":
		value := -5.0
		if reputationDelta != nil {
			value = *reputationDelta
		}
		return settlementDelta{Status: "released", RejectedDelta: 1, RiskDelta: 1, Reputation: value}, nil
	default:
		return settlementDelta{}, errors.New("outcome must be accepted or rejected")
	}
}

func (api API) validateContributorCanAcceptTask(ctx context.Context, taskID string, profile contributorProfile) error {
	if profile.Status != "active" {
		return fmt.Errorf("Contributor is %s", profile.Status)
	}
	riskLevel := "low"
	var runtimeLevel int
	err := api.DB.QueryRow(ctx, `SELECT risk_level, runtime_level FROM task_boundaries WHERE task_id=$1`, taskID).Scan(&riskLevel, &runtimeLevel)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return err
	}
	if !contributorCanAcceptRisk(profile.Level, riskLevel) {
		return fmt.Errorf("Contributor level %s cannot accept %s risk tasks", profile.Level, riskLevel)
	}
	if runtimeLevel > 0 && !contributorCanUseRuntimeLevel(profile.Level, runtimeLevel) {
		return fmt.Errorf("Contributor level %s cannot use runtime level %d", profile.Level, runtimeLevel)
	}
	activeCount, err := api.countContributorActiveAssignments(ctx, profile.UserID)
	if err != nil {
		return err
	}
	if profile.ActiveTaskQuota >= 0 && activeCount >= profile.ActiveTaskQuota {
		return fmt.Errorf("Contributor active task quota exceeded")
	}
	todayCount, err := api.countContributorAssignmentsSince(ctx, profile.UserID, startOfUTCDay(time.Now().UTC()))
	if err != nil {
		return err
	}
	if profile.DailyTaskQuota >= 0 && todayCount >= profile.DailyTaskQuota {
		return fmt.Errorf("Contributor daily task quota exceeded")
	}
	return nil
}

func (api API) countContributorActiveAssignments(ctx context.Context, userID string) (int, error) {
	var count int
	err := api.DB.QueryRow(ctx, `SELECT COUNT(*) FROM task_assignments WHERE contributor_user_id=$1 AND status='active'`, userID).Scan(&count)
	return count, err
}

func (api API) countContributorAssignmentsSince(ctx context.Context, userID string, since time.Time) (int, error) {
	var count int
	err := api.DB.QueryRow(ctx, `SELECT COUNT(*) FROM task_assignments WHERE contributor_user_id=$1 AND created_at >= $2`, userID, since).Scan(&count)
	return count, err
}

func startOfUTCDay(value time.Time) time.Time {
	year, month, day := value.UTC().Date()
	return time.Date(year, month, day, 0, 0, 0, 0, time.UTC)
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
