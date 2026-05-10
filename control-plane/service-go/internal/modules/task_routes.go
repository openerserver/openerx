package modules

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	authpkg "openerx/control-plane/service-go/internal/auth"
	"openerx/control-plane/service-go/internal/web"
)

type createTaskRequest struct {
	ProjectID         string                      `json:"projectId"`
	Title             string                      `json:"title"`
	Prompt            string                      `json:"prompt"`
	Category          *string                     `json:"category"`
	RepoID            *string                     `json:"repoId"`
	WorkspaceRoot     *string                     `json:"workspaceRoot"`
	BaseRevision      *string                     `json:"baseRevision"`
	WorkingBranch     *string                     `json:"workingBranch"`
	CredentialID      *string                     `json:"credentialId"`
	GitAuthorName     *string                     `json:"gitAuthorName"`
	GitAuthorEmail    *string                     `json:"gitAuthorEmail"`
	GitCommitterName  *string                     `json:"gitCommitterName"`
	GitCommitterEmail *string                     `json:"gitCommitterEmail"`
	Strategy          any                         `json:"strategy"`
	StrategyJSON      any                         `json:"strategyJson"`
	PreferredModel    *string                     `json:"preferredModel"`
	LifecycleStatus   *string                     `json:"lifecycleStatus"`
	Relations         []createTaskRelationRequest `json:"relations"`
	RelationContext   *createTaskRelationContext  `json:"relationContext"`
}

type updateTaskRequest struct {
	Title             *string `json:"title"`
	Prompt            *string `json:"prompt"`
	Status            *string `json:"status"`
	SessionID         *string `json:"sessionId"`
	SelectedModel     *string `json:"selectedModel"`
	ExecutionMode     *string `json:"executionMode"`
	AutoAdvance       *bool   `json:"autoAdvanceStages"`
	Result            *string `json:"result"`
	LifecycleStatus   *string `json:"lifecycleStatus"`
	Strategy          any     `json:"strategy"`
	StrategyJSON      any     `json:"strategyJson"`
	WorkingBranch     *string `json:"workingBranch"`
	FinalCommitSha    *string `json:"finalCommitSha"`
	FinalBranchName   *string `json:"finalBranchName"`
	GitAuthorName     *string `json:"gitAuthorName"`
	GitAuthorEmail    *string `json:"gitAuthorEmail"`
	GitCommitterName  *string `json:"gitCommitterName"`
	GitCommitterEmail *string `json:"gitCommitterEmail"`
	PreferredModel    *string `json:"preferredModel"`
}

type createTaskRelationRequest struct {
	SourceTaskID string         `json:"sourceTaskId"`
	TargetTaskID string         `json:"targetTaskId"`
	Type         string         `json:"type"`
	Metadata     map[string]any `json:"metadata"`
}

type createTaskRelationContext struct {
	SpawnedFromTaskID string         `json:"spawnedFromTaskId"`
	DependsOnTaskIDs  []string       `json:"dependsOnTaskIds"`
	BlockedByTaskIDs  []string       `json:"blockedByTaskIds"`
	BlocksTaskIDs     []string       `json:"blocksTaskIds"`
	Metadata          map[string]any `json:"metadata"`
}

type normalizedTaskRelation struct {
	SourceTaskID string
	TargetTaskID string
	Type         string
	Metadata     map[string]any
}

func (api API) TaskRoutes(r chi.Router) {
	r.Get("/", api.listTasks)
	r.Post("/", api.createTask)
	r.Get("/snapshots", api.taskSnapshots)
	r.Get("/{taskId}/query/normalized-conversation", api.normalizedConversation)
	r.Post("/{taskId}/sessions", api.createTaskSession)
	r.Get("/{taskId}/sessions", api.listTaskSessions)
	r.Get("/{taskId}/sessions/{sessionId}", api.getTaskSession)
	r.Post("/{taskId}/sessions/{sessionId}/messages", api.postTaskSessionCanonicalMessage)
	r.Get("/{taskId}/sessions/{sessionId}/messages", api.deprecatedSessionMessages)
	r.Get("/{taskId}/sessions/{sessionId}/operations", api.listTaskSessionOperations)
	r.Get("/{taskId}/sessions/{sessionId}/artifacts", api.listTaskSessionArtifacts)
	r.Get("/{taskId}/sessions/{sessionId}/usage-ledger", api.listTaskSessionUsageLedger)
	r.Post("/{taskId}/sessions/messages", api.persistTaskSessionMessage)
	r.Get("/{taskId}/sessions/{sessionId}/timeline", api.taskSessionTimeline)
	r.Get("/{taskId}/timeline-view", api.taskTimelineView)
	r.Post("/{taskId}/sessions/{sessionId}/activate", api.activateTaskSession)
	r.Post("/{taskId}/sessions/{sessionId}/archive", api.archiveTaskSession)
	r.Post("/{taskId}/runs", api.createTaskRun)
	r.Get("/{taskId}/runs", api.listTaskRuns)
	r.Patch("/{taskId}/runs/{runId}", api.updateTaskRun)
	r.Get("/{taskId}/execution-trace", api.taskExecutionTrace)
	r.Post("/projections/replay", api.replayTaskProjections)
	r.Get("/marketplace", api.listTaskMarketplace)
	r.Get("/{taskId}/boundary", api.getTaskBoundary)
	r.Put("/{taskId}/boundary", api.putTaskBoundary)
	r.Post("/{taskId}/assignments", api.createTaskAssignment)
	r.Get("/{taskId}/assignments/current", api.getCurrentTaskAssignment)
	r.Delete("/{taskId}/assignments/current", api.releaseCurrentTaskAssignment)
	r.Post("/{taskId}/workspaces", api.createWorkspaceBranch)
	r.Get("/{taskId}/workspaces/current", api.getCurrentWorkspaceBranch)
	r.Post("/{taskId}/commit-steps", api.createCommitStep)
	r.Get("/{taskId}/commit-steps", api.listCommitSteps)
	r.Get("/{taskId}/commit-steps/{stepId}/files", api.getCommitStepFiles)
	r.Get("/{taskId}/changes", api.listTaskCodeChanges)
	r.Get("/{taskId}/changes/{changeId}/files", api.listTaskFileChanges)
	r.Route("/{taskId}/role-conclusions", api.RoleConclusionRoutes)
	r.Route("/{taskId}/developer-change-requests", api.DeveloperChangeRequestRoutes)
	r.Route("/{taskId}/workflow", api.TaskWorkflowRoutes)
	r.Get("/{taskId}/operating-runtime/state", api.getTaskOperatingRuntimeState)
	r.Get("/{taskId}/operating-runtime/mode", api.getTaskOperatingRuntimeMode)
	r.Put("/{taskId}/operating-runtime/mode", api.putTaskOperatingRuntimeMode)
	r.Delete("/{taskId}/operating-runtime/mode", api.deleteTaskOperatingRuntimeMode)
	r.Get("/{taskId}/operating-runtime/boss-decisions", api.listTaskBossDecisions)
	r.Post("/{taskId}/operating-runtime/boss-decisions", api.createTaskBossDecision)
	r.Get("/{taskId}/operating-runtime/escalations", api.listTaskHumanEscalations)
	r.Post("/{taskId}/operating-runtime/escalations", api.createTaskHumanEscalation)
	r.Get("/{taskId}", api.getTask)
	r.Patch("/{taskId}", api.updateTask)
	r.Delete("/{taskId}", api.deleteTask)
	r.Get("/{taskId}/snapshot", api.getTaskSnapshot)
	r.Get("/{taskId}/tree", api.getTaskTree)
	r.Get("/{taskId}/messages", api.deprecatedTaskMessages)
	r.Get("/{taskId}/timeline", api.emptyList)
	r.Get("/{taskId}/phases", api.listTaskPhases)
	r.Post("/{taskId}/phases", api.upsertTaskPhase)
	r.Get("/{taskId}/phases/{phaseId}/view", api.getTaskPhaseView)
	r.Post("/{taskId}/phases/{phaseId}/adopt", api.adoptTaskPhase)
	r.Post("/{taskId}/phases/{phaseId}/pause", api.pauseTaskPhase)
	r.Post("/{taskId}/phases/{phaseId}/resume", api.resumeTaskPhase)
	r.Post("/{taskId}/phases/{phaseId}/cancel", api.cancelTaskPhase)
	r.HandleFunc("/*", RouteNotFound)
}

func (api API) listTasks(w http.ResponseWriter, r *http.Request) {
	projectID := r.URL.Query().Get("projectId")
	rows, err := api.DB.Query(r.Context(), `
		SELECT id, project_id, tree_node_id, created_by_user_id, title, prompt, category, repo_id, workspace_root,
		       base_revision, working_branch, credential_id, strategy_json, final_commit_sha, final_branch_name,
		       created_at, updated_at, lifecycle_status, preferred_model, activated_at, done_at, archived_at,
		       git_author_name, git_author_email, git_committer_name, git_committer_email
		FROM tasks
		WHERE ($1::text IS NULL OR project_id=$1)
		ORDER BY updated_at DESC
		LIMIT $2
	`, nullString(projectID), parseLimit(r, 50, 200))
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	defer rows.Close()
	items, err := scanTaskRows(rows)
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	web.JSON(w, http.StatusOK, map[string]any{"data": items})
}

func (api API) createTask(w http.ResponseWriter, r *http.Request) {
	user := authpkg.User(r)
	var body createTaskRequest
	if !decodeBody(w, r, &body) {
		return
	}
	if body.ProjectID == "" || body.Title == "" || body.Prompt == "" {
		web.Error(w, http.StatusBadRequest, "projectId, title and prompt are required")
		return
	}
	if body.CredentialID != nil && *body.CredentialID != "" {
		var exists string
		if err := api.DB.QueryRow(r.Context(), `SELECT id FROM repository_credentials WHERE id=$1 AND project_id=$2 AND status='active'`, *body.CredentialID, body.ProjectID).Scan(&exists); err != nil {
			web.Error(w, http.StatusBadRequest, "Invalid credentialId")
			return
		}
	}
	if !authpkg.HasProjectRole(user, body.ProjectID, "developer") {
		web.Error(w, http.StatusForbidden, "Insufficient project permissions")
		return
	}
	if err := api.validateCreateTaskRelations(r.Context(), body.ProjectID, body); err != nil {
		web.Error(w, http.StatusBadRequest, err.Error())
		return
	}
	taskID := uuid.NewString()
	treeNodeID := taskID
	now := time.Now().UTC()
	strategy := normalizeTaskStrategyPayload(body.StrategyJSON)
	if strategy == nil {
		strategy = normalizeTaskStrategyPayload(body.Strategy)
	}
	strategyRaw, _ := jsonBytes(strategy)
	if strategyRaw == nil {
		strategyRaw = []byte(`{}`)
	}
	status := "draft"
	if body.LifecycleStatus != nil && *body.LifecycleStatus != "" {
		status = *body.LifecycleStatus
	}
	_ = api.ensureProjectRoot(r.Context(), body.ProjectID)
	_, _ = api.DB.Exec(r.Context(), `
		INSERT INTO project_tree_nodes (id, project_id, parent_id, path, depth, node_type, content_text, content_json, ref_type, ref_id, created_at, updated_at)
		VALUES ($1,$2,$3,(SELECT path || $4::ltree FROM project_tree_nodes WHERE id=$3),1,'task',$5,$6,'task',$1,$7,$7)
		ON CONFLICT (id) DO NOTHING
	`, treeNodeID, body.ProjectID, "project_root:"+body.ProjectID, "task_"+safeLtree(taskID), body.Title+"\n\n"+body.Prompt, []byte(`{}`), now)
	_, err := api.DB.Exec(r.Context(), `
		INSERT INTO tasks (id, project_id, tree_node_id, created_by_user_id, title, prompt, category, repo_id, workspace_root, base_revision,
		                   working_branch, credential_id, strategy_json, created_at, updated_at, lifecycle_status, preferred_model,
		                   git_author_name, git_author_email, git_committer_name, git_committer_email)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$14,$15,$16,$17,$18,$19,$20)
	`, taskID, body.ProjectID, treeNodeID, user.Sub, body.Title, body.Prompt, body.Category, body.RepoID, body.WorkspaceRoot, body.BaseRevision, body.WorkingBranch, body.CredentialID, strategyRaw, now, status, body.PreferredModel, body.GitAuthorName, body.GitAuthorEmail, body.GitCommitterName, body.GitCommitterEmail)
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	if err := api.syncCreateTaskRelationLinks(r.Context(), body.ProjectID, taskID, body); err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	_ = api.insertTaskDomainEvent(r.Context(), body.ProjectID, taskID, nil, nil, nil, "task.aggregate.upserted", map[string]any{"taskId": taskID, "projectId": body.ProjectID, "title": body.Title})
	_, _ = api.DB.Exec(r.Context(), `
		INSERT INTO task_timeline_views (id, task_id, project_id, item_kind, display_text, metadata_json, sort_at, created_at, updated_at)
		VALUES ($1,$2,$3,'task_lifecycle','任务进入 pending 状态','{}'::jsonb,$4,$4,$4)
		ON CONFLICT (id) DO NOTHING
	`, "task-timeline:lifecycle:"+taskID+":pending", taskID, body.ProjectID, now)
	_ = api.upsertTaskSnapshot(r.Context(), taskID)
	web.JSON(w, http.StatusCreated, map[string]any{"id": taskID, "status": publicTaskStatus(status), "projectId": body.ProjectID, "nodeId": treeNodeID, "treeNodeId": treeNodeID, "title": body.Title, "prompt": body.Prompt, "createdAt": now.Format(time.RFC3339Nano), "updatedAt": now.Format(time.RFC3339Nano)})
}

func (api API) getTask(w http.ResponseWriter, r *http.Request) {
	api.getTaskByID(w, r, chi.URLParam(r, "taskId"), false)
}

func (api API) getProjectTreeTask(w http.ResponseWriter, r *http.Request) {
	api.getTaskByID(w, r, chi.URLParam(r, "taskId"), false)
}

func (api API) getTaskByID(w http.ResponseWriter, r *http.Request, taskID string, wrapped bool) {
	rows, err := api.DB.Query(r.Context(), `
		SELECT id, project_id, tree_node_id, created_by_user_id, title, prompt, category, repo_id, workspace_root,
		       base_revision, working_branch, credential_id, strategy_json, final_commit_sha, final_branch_name,
		       created_at, updated_at, lifecycle_status, preferred_model, activated_at, done_at, archived_at,
		       git_author_name, git_author_email, git_committer_name, git_committer_email
		FROM tasks WHERE id=$1
	`, taskID)
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	defer rows.Close()
	items, err := scanTaskRows(rows)
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	if len(items) == 0 {
		web.Error(w, http.StatusNotFound, "Task not found")
		return
	}
	if err := api.enrichTaskRecord(r.Context(), items[0]); err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	if wrapped {
		web.JSON(w, http.StatusOK, map[string]any{"data": items[0]})
		return
	}
	web.JSON(w, http.StatusOK, items[0])
}

func (api API) updateTask(w http.ResponseWriter, r *http.Request) {
	taskID := chi.URLParam(r, "taskId")
	var body updateTaskRequest
	if !decodeBody(w, r, &body) {
		return
	}
	strategy, err := api.loadTaskStrategy(r.Context(), taskID)
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	if body.Strategy != nil || body.StrategyJSON != nil {
		strategy = normalizeTaskStrategyPayload(body.StrategyJSON)
		if strategy == nil {
			strategy = normalizeTaskStrategyPayload(body.Strategy)
		}
		if strategy == nil {
			strategy = map[string]any{}
		}
	}
	compat := map[string]any{}
	if existing, ok := strategy["_goCompat"].(map[string]any); ok {
		for k, v := range existing {
			compat[k] = v
		}
	}
	if body.Status != nil {
		compat["status"] = *body.Status
	}
	if body.SessionID != nil {
		compat["sessionId"] = *body.SessionID
	}
	if body.SelectedModel != nil {
		compat["selectedModel"] = *body.SelectedModel
	}
	if body.ExecutionMode != nil {
		compat["executionMode"] = *body.ExecutionMode
		compat["orchestrationKind"] = *body.ExecutionMode
	}
	if body.AutoAdvance != nil {
		compat["autoAdvanceStages"] = *body.AutoAdvance
	}
	if body.Result != nil {
		compat["result"] = *body.Result
	}
	if len(compat) > 0 {
		strategy["_goCompat"] = compat
	}
	strategyRaw, _ := jsonBytes(strategy)
	lifecycleStatus := body.LifecycleStatus
	if lifecycleStatus == nil && body.Status != nil {
		mapped := lifecycleFromPublicStatus(*body.Status)
		lifecycleStatus = &mapped
	}
	var doneAt any
	if lifecycleStatus != nil && *lifecycleStatus == "done" {
		doneAt = time.Now().UTC()
	}
	_, err = api.DB.Exec(r.Context(), `
		UPDATE tasks
		SET title=COALESCE($1,title), prompt=COALESCE($2,prompt), lifecycle_status=COALESCE($3,lifecycle_status),
		    strategy_json=COALESCE($4,strategy_json), working_branch=COALESCE($5,working_branch),
		    final_commit_sha=COALESCE($6,final_commit_sha), final_branch_name=COALESCE($7,final_branch_name),
		    preferred_model=COALESCE($8,preferred_model), git_author_name=COALESCE($11,git_author_name),
		    git_author_email=COALESCE($12,git_author_email), git_committer_name=COALESCE($13,git_committer_name),
		    git_committer_email=COALESCE($14,git_committer_email), done_at=COALESCE($15, done_at), updated_at=$9
		WHERE id=$10
	`, body.Title, body.Prompt, lifecycleStatus, strategyRaw, body.WorkingBranch, body.FinalCommitSha, body.FinalBranchName, body.PreferredModel, time.Now().UTC(), taskID, body.GitAuthorName, body.GitAuthorEmail, body.GitCommitterName, body.GitCommitterEmail, doneAt)
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	if body.Title != nil || body.Prompt != nil || body.WorkingBranch != nil || body.SessionID != nil {
		_, _ = api.DB.Exec(r.Context(), `
			UPDATE project_tree_nodes
			SET content_text=COALESCE($1, content_text),
			    content_json='{}'::jsonb,
			    runtime_session_id=COALESCE($2, runtime_session_id),
			    branch_name=COALESCE($3, branch_name),
			    updated_at=$4
			WHERE id=$5
		`, body.Title, body.SessionID, body.WorkingBranch, time.Now().UTC(), taskID)
	}
	_ = api.upsertTaskSnapshot(r.Context(), taskID)
	api.getTask(w, r)
}

func (api API) deleteTask(w http.ResponseWriter, r *http.Request) {
	taskID := chi.URLParam(r, "taskId")
	tx, err := api.DB.Begin(r.Context())
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	defer tx.Rollback(r.Context())
	statements := []string{
		`DELETE FROM task_timeline_views WHERE task_id=$1`,
		`DELETE FROM runtime_usage_ledger_steps WHERE task_id=$1`,
		`DELETE FROM runtime_usage_ledgers WHERE task_id=$1`,
		`DELETE FROM task_usage_ledger_entries WHERE task_id=$1`,
		`DELETE FROM task_artifacts WHERE task_id=$1`,
		`DELETE FROM task_operations WHERE task_id=$1`,
		`DELETE FROM task_snapshots WHERE task_id=$1`,
		`DELETE FROM task_message_parts WHERE message_id IN (SELECT id FROM task_messages WHERE task_id=$1)`,
		`DELETE FROM task_messages WHERE task_id=$1`,
		`DELETE FROM task_session_runs WHERE task_id=$1`,
		`DELETE FROM task_sessions WHERE task_id=$1`,
		`DELETE FROM task_domain_events WHERE task_id=$1`,
		`DELETE FROM approval_tickets WHERE task_id=$1`,
		`DELETE FROM boss_decisions WHERE task_id=$1`,
		`DELETE FROM human_escalations WHERE task_id=$1`,
		`DELETE FROM task_operating_modes WHERE task_id=$1`,
		`DELETE FROM task_stage_runs WHERE workflow_run_id IN (SELECT id FROM task_workflow_runs WHERE task_id=$1)`,
		`DELETE FROM task_workflow_runs WHERE task_id=$1`,
		`DELETE FROM role_aggregate_conclusions WHERE task_id=$1`,
		`DELETE FROM developer_change_requests WHERE task_id=$1`,
		`DELETE FROM file_changes WHERE change_id IN (SELECT id FROM code_changes WHERE task_id=$1)`,
		`DELETE FROM code_changes WHERE task_id=$1`,
		`DELETE FROM task_execution_phases WHERE task_id=$1`,
		`DELETE FROM project_tree_links WHERE source_node_id=$1 OR target_node_id=$1`,
		`DELETE FROM tasks WHERE id=$1`,
		`DELETE FROM project_tree_nodes WHERE id=$1`,
	}
	for _, statement := range statements {
		if _, err := tx.Exec(r.Context(), statement, taskID); err != nil {
			web.Error(w, http.StatusInternalServerError, err.Error())
			return
		}
	}
	if err := tx.Commit(r.Context()); err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	web.JSON(w, http.StatusOK, map[string]any{"ok": true, "id": taskID})
}

func (api API) listProjectTreeTasks(w http.ResponseWriter, r *http.Request) {
	projectID := r.URL.Query().Get("projectId")
	limit := parseLimit(r, 50, 200)
	publicStatus := r.URL.Query().Get("status")
	queryLimit := limit + 1
	if publicStatus != "" {
		queryLimit = limit * 20
		if queryLimit < 200 {
			queryLimit = 200
		}
	}
	rows, err := api.DB.Query(r.Context(), `
		SELECT id, project_id, tree_node_id, created_by_user_id, title, prompt, category, repo_id, workspace_root,
		       base_revision, working_branch, credential_id, strategy_json, final_commit_sha, final_branch_name,
		       created_at, updated_at, lifecycle_status, preferred_model, activated_at, done_at, archived_at,
		       git_author_name, git_author_email, git_committer_name, git_committer_email
		FROM tasks
		WHERE ($1::text IS NULL OR project_id=$1)
		ORDER BY updated_at DESC
		LIMIT $2
	`, nullString(projectID), queryLimit)
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	defer rows.Close()
	items, err := scanTaskRows(rows)
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	enriched := make([]map[string]any, 0, len(items))
	for _, item := range items {
		if err := api.enrichTaskRecord(r.Context(), item); err != nil {
			web.Error(w, http.StatusInternalServerError, err.Error())
			return
		}
		if publicStatus != "" && item["status"] != publicStatus {
			continue
		}
		enriched = append(enriched, item)
	}
	total := len(enriched)
	truncated := total > limit
	if truncated {
		enriched = enriched[:limit]
	}
	web.JSON(w, http.StatusOK, map[string]any{"data": enriched, "totalCount": total, "limit": limit, "truncated": truncated})
}

func (api API) taskSnapshots(w http.ResponseWriter, r *http.Request) {
	projectID := r.URL.Query().Get("projectId")
	status := r.URL.Query().Get("status")
	limit := parseLimit(r, 50, 200)
	rows, err := api.DB.Query(r.Context(), `
		SELECT id, project_id, tree_node_id, created_by_user_id, title, prompt, category, repo_id, workspace_root,
		       base_revision, working_branch, credential_id, strategy_json, final_commit_sha, final_branch_name,
		       created_at, updated_at, lifecycle_status, preferred_model, activated_at, done_at, archived_at,
		       git_author_name, git_author_email, git_committer_name, git_committer_email
		FROM tasks
		WHERE ($1::text IS NULL OR project_id=$1)
		ORDER BY updated_at DESC
		LIMIT $2
	`, nullString(projectID), limit*2)
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	defer rows.Close()
	tasks, err := scanTaskRows(rows)
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	items := []map[string]any{}
	for _, task := range tasks {
		if err := api.enrichTaskRecord(r.Context(), task); err != nil {
			web.Error(w, http.StatusInternalServerError, err.Error())
			return
		}
		if status != "" && task["status"] != status {
			continue
		}
		items = append(items, snapshotResponse(task))
		if len(items) >= limit {
			break
		}
	}
	web.JSON(w, http.StatusOK, map[string]any{"data": items, "limit": limit, "truncated": len(items) == limit})
}

func (api API) getTaskSnapshot(w http.ResponseWriter, r *http.Request) {
	taskID := chi.URLParam(r, "taskId")
	rows, err := api.DB.Query(r.Context(), `
		SELECT id, project_id, tree_node_id, created_by_user_id, title, prompt, category, repo_id, workspace_root,
		       base_revision, working_branch, credential_id, strategy_json, final_commit_sha, final_branch_name,
		       created_at, updated_at, lifecycle_status, preferred_model, activated_at, done_at, archived_at,
		       git_author_name, git_author_email, git_committer_name, git_committer_email
		FROM tasks WHERE id=$1
	`, taskID)
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	defer rows.Close()
	items, err := scanTaskRows(rows)
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	if len(items) == 0 {
		web.JSON(w, http.StatusOK, map[string]any{"data": nil, "meta": map[string]any{"readSource": "task-domain-projection", "complete": false}})
		return
	}
	_ = api.enrichTaskRecord(r.Context(), items[0])
	web.JSON(w, http.StatusOK, map[string]any{"data": snapshotResponse(items[0]), "meta": map[string]any{"readSource": "task-domain-projection", "complete": true}})
}

func (api API) getTaskTree(w http.ResponseWriter, r *http.Request) {
	taskID := chi.URLParam(r, "taskId")
	sessionID := r.URL.Query().Get("sessionId")
	includeLineage := r.URL.Query().Get("includeLineage") != "false"
	sessionIDs, err := api.lineageSessionIDs(r.Context(), taskID, sessionID, includeLineage)
	if err != nil {
		web.Error(w, http.StatusNotFound, "Task session not found")
		return
	}
	sessions, err := api.readTaskSessionsByID(r.Context(), taskID, sessionIDs)
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	messages, err := api.readSessionMessages(r, taskID, sessionIDs)
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	parts, err := api.readSessionMessageParts(r.Context(), sessionIDs)
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	if sessionID == "" && len(sessionIDs) > 0 {
		sessionID = sessionIDs[len(sessionIDs)-1]
	}
	web.JSON(w, http.StatusOK, map[string]any{
		"meta": map[string]any{
			"taskId": taskID, "currentSessionId": nullString(sessionID), "includeLineage": includeLineage,
			"readSource": "task-session-first",
		},
		"sessions":     sessions,
		"messages":     messages,
		"messageParts": parts,
		"operations":   []map[string]any{},
		"artifacts":    []map[string]any{},
	})
}

func snapshotResponse(task map[string]any) map[string]any {
	return map[string]any{
		"taskId": task["id"], "projectId": task["projectId"], "currentStatus": task["status"],
		"currentSessionId": task["sessionId"], "latestSessionId": task["sessionId"],
		"latestResult": task["result"], "latestResultSummary": task["result"],
		"orchestrationKind": task["orchestrationKind"], "currentExecutionMode": task["executionMode"],
		"currentExecutionStatus": "running", "lifecycleStatus": task["lifecycleStatus"],
	}
}

func (api API) emptyList(w http.ResponseWriter, _ *http.Request) {
	web.JSON(w, http.StatusOK, map[string]any{"data": []any{}})
}

func scanTaskRows(rows pgx.Rows) ([]map[string]any, error) {
	var items []map[string]any
	for rows.Next() {
		var id, projectID, title, prompt string
		var treeNodeID, createdBy, category, repoID, workspaceRoot, baseRevision, workingBranch, credentialID, finalCommitSha, finalBranchName, lifecycleStatus, preferredModel, gitAuthorName, gitAuthorEmail, gitCommitterName, gitCommitterEmail *string
		var strategy []byte
		var created, updated time.Time
		var activated, done, archived *time.Time
		if err := rows.Scan(&id, &projectID, &treeNodeID, &createdBy, &title, &prompt, &category, &repoID, &workspaceRoot, &baseRevision, &workingBranch, &credentialID, &strategy, &finalCommitSha, &finalBranchName, &created, &updated, &lifecycleStatus, &preferredModel, &activated, &done, &archived, &gitAuthorName, &gitAuthorEmail, &gitCommitterName, &gitCommitterEmail); err != nil {
			return nil, err
		}
		status := "draft"
		if lifecycleStatus != nil {
			status = *lifecycleStatus
		}
		strategyMap := scanJSONMap(strategy)
		publicStrategy := map[string]any{}
		for k, v := range strategyMap {
			if k == "_goCompat" {
				continue
			}
			publicStrategy[k] = v
		}
		items = append(items, map[string]any{
			"id": id, "projectId": projectID, "treeNodeId": treeNodeID, "createdByUserId": createdBy, "title": title, "prompt": prompt,
			"category": category, "repoId": repoID, "workspaceRoot": workspaceRoot, "baseRevision": baseRevision, "workingBranch": workingBranch,
			"credentialId": credentialID, "strategy": publicStrategy, "strategyJson": publicStrategy, "finalCommitSha": finalCommitSha,
			"finalBranchName": finalBranchName, "lifecycleStatus": status, "status": publicTaskStatus(status), "preferredModel": preferredModel,
			"gitAuthorName": gitAuthorName, "gitAuthorEmail": gitAuthorEmail, "gitCommitterName": gitCommitterName, "gitCommitterEmail": gitCommitterEmail,
			"activatedAt": web.NormalizeTime(activated), "doneAt": web.NormalizeTime(done), "finishedAt": web.NormalizeTime(done), "archivedAt": web.NormalizeTime(archived),
			"createdAt": created.UTC().Format(time.RFC3339Nano), "updatedAt": updated.UTC().Format(time.RFC3339Nano),
		})
	}
	return items, rows.Err()
}

func (api API) loadTaskStrategy(ctx context.Context, taskID string) (map[string]any, error) {
	var raw []byte
	if err := api.DB.QueryRow(ctx, `SELECT strategy_json FROM tasks WHERE id=$1`, taskID).Scan(&raw); err != nil {
		return nil, err
	}
	out := scanTaskStrategyJSON(raw)
	if out == nil {
		out = map[string]any{}
	}
	return out, nil
}

func (api API) validateCreateTaskRelations(ctx context.Context, projectID string, body createTaskRequest) error {
	for _, taskID := range collectCreateTaskRelationIDs(body) {
		var exists string
		err := api.DB.QueryRow(ctx, `SELECT id FROM tasks WHERE id=$1 AND project_id=$2`, taskID, projectID).Scan(&exists)
		if err == pgx.ErrNoRows {
			return fmt.Errorf("Related task %s not found in this project", taskID)
		}
		if err != nil {
			return err
		}
	}
	return nil
}

func collectCreateTaskRelationIDs(body createTaskRequest) []string {
	seen := map[string]bool{}
	add := func(value string) {
		value = strings.TrimSpace(value)
		if value != "" {
			seen[value] = true
		}
	}
	for _, relation := range body.Relations {
		add(relation.SourceTaskID)
		add(relation.TargetTaskID)
	}
	if body.RelationContext != nil {
		add(body.RelationContext.SpawnedFromTaskID)
		for _, id := range body.RelationContext.DependsOnTaskIDs {
			add(id)
		}
		for _, id := range body.RelationContext.BlockedByTaskIDs {
			add(id)
		}
		for _, id := range body.RelationContext.BlocksTaskIDs {
			add(id)
		}
	}
	ids := make([]string, 0, len(seen))
	for id := range seen {
		ids = append(ids, id)
	}
	return ids
}

func (api API) syncCreateTaskRelationLinks(ctx context.Context, projectID string, taskID string, body createTaskRequest) error {
	relations := expandCreateTaskRelations(taskID, body)
	for _, relation := range relations {
		linkType := taskRelationLinkType(relation.Type)
		if linkType == "" {
			continue
		}
		metadata := mergeMaps(relation.Metadata, map[string]any{"relationSource": "task-create"})
		metadataRaw, _ := jsonBytes(metadata)
		now := time.Now().UTC()
		var existingID string
		err := api.DB.QueryRow(ctx, `
			SELECT id FROM project_tree_links
			WHERE source_node_id=$1 AND target_node_id=$2 AND link_type=$3
		`, relation.SourceTaskID, relation.TargetTaskID, linkType).Scan(&existingID)
		if err == nil {
			if _, err = api.DB.Exec(ctx, `UPDATE project_tree_links SET metadata=$2 WHERE id=$1`, existingID, metadataRaw); err != nil {
				return err
			}
			continue
		}
		if err != pgx.ErrNoRows {
			return err
		}
		_, err = api.DB.Exec(ctx, `
			INSERT INTO project_tree_links (id, source_node_id, source_project_id, target_node_id, target_project_id, link_type, metadata, bidirectional, created_by, created_at)
			VALUES ($1,$2,$3,$4,$5,$6,$7,false,$8,$9)
		`, uuid.NewString(), relation.SourceTaskID, projectID, relation.TargetTaskID, projectID, linkType, metadataRaw, nil, now)
		if err != nil {
			return err
		}
	}
	return nil
}

func expandCreateTaskRelations(taskID string, body createTaskRequest) []normalizedTaskRelation {
	relations := []normalizedTaskRelation{}
	seen := map[string]bool{}
	push := func(relation normalizedTaskRelation) {
		relation.SourceTaskID = strings.TrimSpace(relation.SourceTaskID)
		relation.TargetTaskID = strings.TrimSpace(relation.TargetTaskID)
		relation.Type = strings.TrimSpace(relation.Type)
		if relation.SourceTaskID == "" || relation.TargetTaskID == "" || relation.SourceTaskID == relation.TargetTaskID {
			return
		}
		if taskRelationLinkType(relation.Type) == "" {
			return
		}
		key := relation.SourceTaskID + ":" + relation.TargetTaskID + ":" + relation.Type
		if seen[key] {
			return
		}
		seen[key] = true
		relations = append(relations, relation)
	}
	for _, relation := range body.Relations {
		sourceTaskID := strings.TrimSpace(relation.SourceTaskID)
		if sourceTaskID == "" {
			sourceTaskID = taskID
		}
		targetTaskID := strings.TrimSpace(relation.TargetTaskID)
		if targetTaskID == "" {
			targetTaskID = taskID
		}
		push(normalizedTaskRelation{
			SourceTaskID: sourceTaskID,
			TargetTaskID: targetTaskID,
			Type:         relation.Type,
			Metadata:     relation.Metadata,
		})
	}
	if body.RelationContext == nil {
		return relations
	}
	baseMetadata := mergeMaps(body.RelationContext.Metadata, map[string]any{"protocol": "relation-context-v1"})
	if sourceTaskID := strings.TrimSpace(body.RelationContext.SpawnedFromTaskID); sourceTaskID != "" {
		push(normalizedTaskRelation{
			SourceTaskID: sourceTaskID,
			TargetTaskID: taskID,
			Type:         "spawned-from",
			Metadata:     mergeMaps(baseMetadata, map[string]any{"field": "spawnedFromTaskId"}),
		})
	}
	for _, sourceTaskID := range uniqueTrimmed(body.RelationContext.DependsOnTaskIDs) {
		push(normalizedTaskRelation{
			SourceTaskID: sourceTaskID,
			TargetTaskID: taskID,
			Type:         "depends-on",
			Metadata:     mergeMaps(baseMetadata, map[string]any{"field": "dependsOnTaskIds"}),
		})
	}
	for _, sourceTaskID := range uniqueTrimmed(body.RelationContext.BlockedByTaskIDs) {
		push(normalizedTaskRelation{
			SourceTaskID: sourceTaskID,
			TargetTaskID: taskID,
			Type:         "blocks",
			Metadata:     mergeMaps(baseMetadata, map[string]any{"field": "blockedByTaskIds"}),
		})
	}
	for _, targetTaskID := range uniqueTrimmed(body.RelationContext.BlocksTaskIDs) {
		push(normalizedTaskRelation{
			SourceTaskID: taskID,
			TargetTaskID: targetTaskID,
			Type:         "blocks",
			Metadata:     mergeMaps(baseMetadata, map[string]any{"field": "blocksTaskIds"}),
		})
	}
	return relations
}

func taskRelationLinkType(value string) string {
	switch strings.TrimSpace(value) {
	case "depends-on", "blocks":
		return strings.TrimSpace(value)
	case "spawned-from":
		return "spawned"
	default:
		return ""
	}
}

func mergeMaps(values ...map[string]any) map[string]any {
	merged := map[string]any{}
	for _, value := range values {
		for key, item := range value {
			merged[key] = item
		}
	}
	if len(merged) == 0 {
		return nil
	}
	return merged
}

func uniqueTrimmed(values []string) []string {
	seen := map[string]bool{}
	out := []string{}
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" || seen[value] {
			continue
		}
		seen[value] = true
		out = append(out, value)
	}
	return out
}

func scanTaskStrategyJSON(raw []byte) map[string]any {
	if len(raw) == 0 {
		return nil
	}
	var direct map[string]any
	if err := json.Unmarshal(raw, &direct); err == nil {
		return direct
	}
	var nested string
	if err := json.Unmarshal(raw, &nested); err == nil && nested != "" {
		var out map[string]any
		if err := json.Unmarshal([]byte(nested), &out); err == nil {
			return out
		}
	}
	return nil
}

func normalizeTaskStrategyPayload(value any) map[string]any {
	switch typed := value.(type) {
	case nil:
		return nil
	case map[string]any:
		return typed
	case string:
		if typed == "" {
			return map[string]any{}
		}
		var out map[string]any
		if err := json.Unmarshal([]byte(typed), &out); err == nil {
			return out
		}
		return map[string]any{}
	default:
		raw, err := json.Marshal(typed)
		if err != nil {
			return map[string]any{}
		}
		var out map[string]any
		if err := json.Unmarshal(raw, &out); err != nil {
			return map[string]any{}
		}
		return out
	}
}

func (api API) enrichTaskRecord(ctx context.Context, item map[string]any) error {
	taskID, _ := item["id"].(string)
	strategy, err := api.loadTaskStrategy(ctx, taskID)
	if err != nil {
		return err
	}
	if compat, ok := strategy["_goCompat"].(map[string]any); ok {
		for _, key := range []string{"status", "sessionId", "selectedModel", "executionMode", "orchestrationKind", "result"} {
			if value, exists := compat[key]; exists {
				item[key] = value
			}
		}
		if value, exists := compat["autoAdvanceStages"]; exists {
			item["autoAdvanceStages"] = value
		}
	}
	if _, exists := item["autoAdvanceStages"]; !exists {
		item["autoAdvanceStages"] = false
	}
	if _, exists := item["executionMode"]; !exists {
		item["executionMode"] = nil
	}
	if _, exists := item["orchestrationKind"]; !exists {
		item["orchestrationKind"] = nil
	}
	if _, exists := item["sessionId"]; !exists {
		item["sessionId"] = nil
	}
	if _, exists := item["result"]; !exists {
		item["result"] = nil
	}
	if credentialID, ok := item["credentialId"].(*string); ok && credentialID != nil {
		var label string
		if err := api.DB.QueryRow(ctx, `SELECT label FROM repository_credentials WHERE id=$1`, *credentialID).Scan(&label); err == nil {
			item["credentialLabel"] = label
		}
	}
	if _, exists := item["credentialLabel"]; !exists {
		item["credentialLabel"] = nil
	}
	var phaseStatus, runtimeSessionID, result *string
	err = api.DB.QueryRow(ctx, `
		SELECT p.status, s.runtime_session_id, COALESCE(s.result_text, s.result_summary, p.result_summary)
		FROM task_execution_phases p
		LEFT JOIN task_sessions s ON s.id=p.winner_session_id
		WHERE p.task_id=$1 AND p.status IN ('completed','failed','cancelled')
		ORDER BY p.phase_index DESC, p.updated_at DESC
		LIMIT 1
	`, taskID).Scan(&phaseStatus, &runtimeSessionID, &result)
	if err == nil && phaseStatus != nil {
		item["status"] = publicPhaseStatus(*phaseStatus)
		item["currentRunStatus"] = publicPhaseStatus(*phaseStatus)
		if runtimeSessionID != nil {
			item["sessionId"] = *runtimeSessionID
		}
		if result != nil {
			item["result"] = *result
		}
	}
	return nil
}

func publicTaskStatus(lifecycle string) string {
	switch lifecycle {
	case "draft":
		return "pending"
	case "active":
		return "running"
	case "done":
		return "completed"
	default:
		return lifecycle
	}
}

func lifecycleFromPublicStatus(status string) string {
	switch status {
	case "pending":
		return "draft"
	case "completed":
		return "done"
	case "archived":
		return "archived"
	default:
		return "active"
	}
}

func publicPhaseStatus(status string) string {
	if status == "completed" {
		return "completed"
	}
	return status
}
