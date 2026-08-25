package modules

import (
	"context"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"

	"openerx/control-plane/service-go/internal/web"
)

type createTaskRunRequest struct {
	ID             string  `json:"id"`
	SessionID      string  `json:"sessionId"`
	AgentType      string  `json:"agentType"`
	CandidateIndex *int    `json:"candidateIndex"`
	Status         string  `json:"status"`
	ModelUsed      *string `json:"modelUsed"`
	Result         *string `json:"result"`
	TokenUsed      int     `json:"tokenUsed"`
	StartedAt      *string `json:"startedAt"`
	FinishedAt     *string `json:"finishedAt"`
}

func (api API) createTaskRun(w http.ResponseWriter, r *http.Request) {
	taskID := chi.URLParam(r, "taskId")
	var body createTaskRunRequest
	if !decodeBody(w, r, &body) {
		return
	}
	if body.ID == "" {
		web.Error(w, http.StatusBadRequest, "id is required")
		return
	}
	if body.SessionID == "" {
		web.Error(w, http.StatusBadRequest, "sessionId is required")
		return
	}
	if body.AgentType == "" {
		body.AgentType = "executor"
	}
	if body.Status == "" {
		body.Status = "running"
	}
	var sessionExists string
	if err := api.DB.QueryRow(r.Context(), `SELECT id FROM task_sessions WHERE (id=$1 OR runtime_session_id=$1) AND task_id=$2`, body.SessionID, taskID).Scan(&sessionExists); err != nil {
		var exists int
		if taskErr := api.DB.QueryRow(r.Context(), `SELECT 1 FROM tasks WHERE id=$1`, taskID).Scan(&exists); taskErr != nil {
			web.Error(w, http.StatusNotFound, "Task not found")
			return
		}
		web.Error(w, http.StatusNotFound, "Task session not found")
		return
	}
	var attemptIndex int
	_ = api.DB.QueryRow(r.Context(), `SELECT COALESCE(MAX(attempt_index), -1) + 1 FROM task_session_runs WHERE session_id=$1`, sessionExists).Scan(&attemptIndex)
	runID := body.ID
	runRuntimeSessionID := body.SessionID
	now := time.Now().UTC()
	status := sessionRunStatus(body.Status)
	executionKind := "parallel_candidate"
	laneRole := "candidate"
	if body.AgentType == "judge" {
		executionKind = "judge"
		laneRole = "judge"
	}
	_, err := api.DB.Exec(r.Context(), `
		INSERT INTO task_session_runs (
			id, task_id, session_id, attempt_index, trigger_type, execution_kind,
			runtime_session_id, candidate_index, lane_role, executor_kind, model_route, status, result_summary,
			started_at, finished_at, created_at
		) VALUES ($1,$2,$3,$4,'parallel_result',$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
		ON CONFLICT (id) DO UPDATE SET
			status=EXCLUDED.status,
			result_summary=COALESCE(EXCLUDED.result_summary, task_session_runs.result_summary),
			model_route=COALESCE(EXCLUDED.model_route, task_session_runs.model_route),
			finished_at=COALESCE(EXCLUDED.finished_at, task_session_runs.finished_at)
	`, runID, taskID, sessionExists, attemptIndex, executionKind, runRuntimeSessionID, body.CandidateIndex, laneRole, body.AgentType, body.ModelUsed, status, body.Result, parseOptionalTime(body.StartedAt), parseOptionalTime(body.FinishedAt), now)
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	if err := api.writeRunSideEffects(r, taskID, sessionExists, runID, body.ID, status, body.Result, body.TokenUsed); err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	_ = api.upsertTaskSnapshot(r.Context(), taskID)
	web.JSON(w, http.StatusCreated, map[string]any{"id": runID, "taskId": taskID, "sessionId": sessionExists, "status": status})
}

func (api API) listTaskRuns(w http.ResponseWriter, r *http.Request) {
	taskID := chi.URLParam(r, "taskId")
	rows, err := api.DB.Query(r.Context(), `
		SELECT r.id, r.task_id, r.session_id, r.execution_kind::text, r.lane_role::text, r.executor_kind, r.model_route,
		       r.status::text, r.result_summary, o.id, r.started_at, r.finished_at, r.created_at
		FROM task_session_runs r
		LEFT JOIN task_operations o ON o.run_id=r.id AND o.task_id=r.task_id
		WHERE r.task_id=$1
		ORDER BY r.created_at DESC
	`, taskID)
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	defer rows.Close()
	items := []map[string]any{}
	for rows.Next() {
		var id, taskID, sessionID, executionKind, laneRole, executorKind, status string
		var modelRoute, result, operationID *string
		var started, finished *time.Time
		var created time.Time
		if err := rows.Scan(&id, &taskID, &sessionID, &executionKind, &laneRole, &executorKind, &modelRoute, &status, &result, &operationID, &started, &finished, &created); err != nil {
			web.Error(w, http.StatusInternalServerError, err.Error())
			return
		}
		publicID := id
		if operationID != nil {
			if externalID := strings.TrimPrefix(*operationID, "session-operation:"+taskID+":"); externalID != *operationID && externalID != "" {
				publicID = externalID
			}
		}
		items = append(items, map[string]any{
			"id": publicID, "canonicalId": id, "taskId": taskID, "sessionId": sessionID, "executionKind": executionKind,
			"laneRole": laneRole, "agentType": executorKind, "modelUsed": modelRoute, "status": status,
			"result": result, "startedAt": web.NormalizeTime(started), "finishedAt": web.NormalizeTime(finished),
			"createdAt": created.UTC().Format(time.RFC3339Nano),
		})
	}
	if err := rows.Err(); err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	web.JSON(w, http.StatusOK, map[string]any{"data": items})
}

func (api API) updateTaskRun(w http.ResponseWriter, r *http.Request) {
	taskID := chi.URLParam(r, "taskId")
	runAlias := chi.URLParam(r, "runId")
	var body createTaskRunRequest
	if !decodeBody(w, r, &body) {
		return
	}
	var runID, sessionID string
	opID := "session-operation:" + taskID + ":" + runAlias
	if err := api.DB.QueryRow(r.Context(), `
		SELECT id, session_id
		FROM task_session_runs
		WHERE task_id=$4
		  AND (
		    id=$1
		    OR id=$2
		    OR id=(SELECT run_id FROM task_operations WHERE id=$3 AND task_id=$4 LIMIT 1)
		  )
		LIMIT 1
	`, runAlias, "run_"+runAlias, opID, taskID).Scan(&runID, &sessionID); err != nil {
		web.Error(w, http.StatusNotFound, "Task run not found")
		return
	}
	status := sessionRunStatus(body.Status)
	if status == "" {
		status = "completed"
	}
	finishedAt := parseOptionalTime(body.FinishedAt)
	if status == "completed" && finishedAt == nil {
		finishedAt = time.Now().UTC()
	}
	_, err := api.DB.Exec(r.Context(), `UPDATE task_session_runs SET status=$1, result_summary=COALESCE($2,result_summary), finished_at=COALESCE($3,finished_at) WHERE id=$4`, status, body.Result, finishedAt, runID)
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	if err := api.writeRunSideEffects(r, taskID, sessionID, runID, runAlias, status, body.Result, body.TokenUsed); err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	if status == "completed" {
		_, _ = api.DB.Exec(r.Context(), `UPDATE tasks SET lifecycle_status='done', updated_at=$1 WHERE id=$2`, time.Now().UTC(), taskID)
	}
	_ = api.upsertTaskSnapshot(r.Context(), taskID)
	web.JSON(w, http.StatusOK, map[string]any{"id": runAlias, "status": status})
}

func (api API) writeRunSideEffects(r *http.Request, taskID, sessionID, runID, externalRunID, status string, result *string, tokenUsed int) error {
	var projectID string
	if err := api.DB.QueryRow(r.Context(), `SELECT project_id FROM tasks WHERE id=$1`, taskID).Scan(&projectID); err != nil {
		return err
	}
	operationID := "session-operation:" + taskID + ":" + externalRunID
	if externalRunID == "" {
		operationID = "session-operation:" + taskID + ":" + runID
	}
	summary, _ := jsonBytes(map[string]any{"resultText": result})
	now := time.Now().UTC()
	if _, err := api.DB.Exec(r.Context(), `
		INSERT INTO task_operations (id, task_id, session_id, run_id, operation_index, operation_kind, status, summary_json, created_at, updated_at)
		VALUES ($1,$2,$3,$4,0,'model_request',$5,$6,$7,$7)
		ON CONFLICT (id) DO UPDATE SET status=EXCLUDED.status, summary_json=EXCLUDED.summary_json, updated_at=EXCLUDED.updated_at
	`, operationID, taskID, sessionID, runID, status, summary, now); err != nil {
		return err
	}
	ledgerID := "task-usage-ledger:" + operationID
	if _, err := api.DB.Exec(r.Context(), `
		INSERT INTO task_usage_ledger_entries (id, task_id, project_id, session_id, operation_id, entry_kind, output_tokens, total_tokens, created_at, recorded_at)
		VALUES ($1,$2,$3,$4,$5,'model_request',$6,$6,$7,$7)
		ON CONFLICT (id) DO UPDATE SET
			output_tokens=EXCLUDED.output_tokens,
			total_tokens=EXCLUDED.total_tokens,
			recorded_at=EXCLUDED.recorded_at
	`, ledgerID, taskID, projectID, sessionID, operationID, tokenUsed, now); err != nil {
		return err
	}
	return nil
}

func (api API) AgentRunRoutes(r chi.Router) {
	r.Get("/summaries", api.listAgentRunSummaries)
	r.Get("/{runId}/summary", api.agentRunSummary)
}

type agentRunSummary struct {
	AgentRunID           string
	TaskID               string
	TaskTitle            string
	ProjectID            string
	ProjectName          *string
	AgentType            string
	Status               string
	SessionID            *string
	ModelUsed            *string
	StartedAt            *time.Time
	FinishedAt           *time.Time
	LastActivityAt       *time.Time
	TokenUsed            int64
	ResultSummary        *string
	Result               *string
	Error                *string
	ApprovalTickets      int64
	PendingApprovals     int64
	LatestApprovalStatus *string
	RecentAuditEvents    int64
	LatestHighRiskAction *string
	CodeChangeCount      int64
	FileCount            int64
	Insertions           int64
	Deletions            int64
	LatestChangeSummary  *string
}

func normalizeAgentRunStatus(status string) string {
	switch status {
	case "queued":
		return "pending"
	case "cancelled":
		return "terminated"
	default:
		return status
	}
}

func durationMs(startedAt, finishedAt *time.Time) *int64 {
	if startedAt == nil || finishedAt == nil || finishedAt.Before(*startedAt) {
		return nil
	}
	ms := finishedAt.Sub(*startedAt).Milliseconds()
	return &ms
}

func agentRunSummaryJSON(run agentRunSummary) map[string]any {
	return map[string]any{
		"agentRunId":     run.AgentRunID,
		"taskId":         run.TaskID,
		"taskTitle":      run.TaskTitle,
		"projectId":      run.ProjectID,
		"projectName":    run.ProjectName,
		"agentType":      run.AgentType,
		"status":         normalizeAgentRunStatus(run.Status),
		"sessionId":      run.SessionID,
		"modelUsed":      run.ModelUsed,
		"startedAt":      web.NormalizeTime(run.StartedAt),
		"finishedAt":     web.NormalizeTime(run.FinishedAt),
		"lastActivityAt": web.NormalizeTime(run.LastActivityAt),
		"durationMs":     durationMs(run.StartedAt, run.FinishedAt),
		"tokenUsed":      run.TokenUsed,
		"blockerType":    nil,
		"blockerLabel":   "",
		"riskLevel":      nil,
		"guidanceCount":  0,
		"resultSummary":  run.ResultSummary,
		"result":         run.Result,
		"error":          run.Error,
		"longSummary":    nil,
		"latestEvents":   []any{},
		"actionPermissions": map[string]any{
			"canPause":           run.Status == "running",
			"canResume":          run.Status == "paused",
			"canTerminate":       run.Status == "running" || run.Status == "paused",
			"canInjectGuidance":  true,
			"canViewApproval":    true,
			"canViewAudit":       true,
			"canViewCodeChanges": true,
			"canExport":          true,
		},
		"governance": map[string]any{
			"approvalTickets":      run.ApprovalTickets,
			"pendingApprovals":     run.PendingApprovals,
			"latestApprovalStatus": run.LatestApprovalStatus,
			"recentAuditEvents":    run.RecentAuditEvents,
			"latestHighRiskAction": run.LatestHighRiskAction,
		},
		"codeChanges": map[string]any{
			"changeCount":   run.CodeChangeCount,
			"files":         run.FileCount,
			"insertions":    run.Insertions,
			"deletions":     run.Deletions,
			"latestSummary": run.LatestChangeSummary,
		},
	}
}

func scanAgentRunSummaryRows(rows interface {
	Next() bool
	Scan(dest ...any) error
	Err() error
	Close()
}) ([]agentRunSummary, error) {
	defer rows.Close()
	items := []agentRunSummary{}
	for rows.Next() {
		var item agentRunSummary
		if err := rows.Scan(
			&item.AgentRunID,
			&item.TaskID,
			&item.TaskTitle,
			&item.ProjectID,
			&item.ProjectName,
			&item.AgentType,
			&item.Status,
			&item.SessionID,
			&item.ModelUsed,
			&item.StartedAt,
			&item.FinishedAt,
			&item.LastActivityAt,
			&item.TokenUsed,
			&item.ResultSummary,
			&item.Result,
			&item.Error,
			&item.ApprovalTickets,
			&item.PendingApprovals,
			&item.LatestApprovalStatus,
			&item.RecentAuditEvents,
			&item.LatestHighRiskAction,
			&item.CodeChangeCount,
			&item.FileCount,
			&item.Insertions,
			&item.Deletions,
			&item.LatestChangeSummary,
		); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (api API) queryAgentRunSummaries(ctx context.Context, runID *string) ([]agentRunSummary, error) {
	const query = `
		WITH canonical AS (
			SELECT DISTINCT ON (r.id)
				COALESCE(
					NULLIF(o.summary_json->>'agentRunId', ''),
					CASE
						WHEN o.runtime_operation_id LIKE 'agent-run:%' THEN substring(o.runtime_operation_id FROM 11)
						WHEN o.id LIKE 'session-operation:' || r.task_id || ':%' THEN substring(o.id FROM length('session-operation:' || r.task_id || ':') + 1)
						ELSE NULL
					END,
					r.id
				) AS agent_run_id,
				r.task_id,
				COALESCE(r.runtime_session_id, s.runtime_session_id, s.id) AS session_id,
				COALESCE(NULLIF(o.summary_json->>'agentType', ''), NULLIF(o.title, ''), r.executor_kind, 'agent') AS agent_type,
				COALESCE(NULLIF(o.summary_json->>'status', ''), r.status::text, o.status::text, 'running') AS status,
				COALESCE(NULLIF(o.summary_json->>'modelUsed', ''), r.model_route) AS model_used,
				COALESCE(NULLIF(o.summary_json->>'tokenUsed', '')::bigint, r.total_tokens, 0) AS token_used,
				COALESCE(NULLIF(o.summary_json->>'resultText', ''), r.result_summary) AS result,
				COALESCE(NULLIF(o.summary_json->>'errorText', ''), r.error_text) AS error,
				COALESCE(o.started_at, r.started_at, o.created_at, r.created_at) AS started_at,
				COALESCE(o.finished_at, r.finished_at) AS finished_at,
				COALESCE(o.finished_at, r.finished_at, o.updated_at, r.created_at) AS last_activity_at,
				COALESCE(o.created_at, r.created_at) AS created_at
			FROM task_session_runs r
			LEFT JOIN task_operations o ON o.run_id=r.id AND o.task_id=r.task_id
			LEFT JOIN task_sessions s ON s.id=r.session_id AND s.task_id=r.task_id
			ORDER BY r.id, o.created_at DESC NULLS LAST
		)
		SELECT
			c.agent_run_id,
			t.id AS task_id,
			t.title AS task_title,
			t.project_id,
			p.name AS project_name,
			c.agent_type,
			c.status,
			c.session_id,
			c.model_used,
			c.started_at,
			c.finished_at,
			c.last_activity_at,
			c.token_used,
			c.result AS result_summary,
			c.result,
			c.error,
			(SELECT COUNT(*) FROM approval_tickets a WHERE a.task_id=t.id) AS approval_tickets,
			(SELECT COUNT(*) FROM approval_tickets a WHERE a.task_id=t.id AND a.status='pending') AS pending_approvals,
			(SELECT a.status FROM approval_tickets a WHERE a.task_id=t.id ORDER BY a.created_at DESC LIMIT 1) AS latest_approval_status,
			(SELECT COUNT(*) FROM audit_events ae WHERE ae.task_id=t.id AND ae.project_id=t.project_id) AS recent_audit_events,
			(SELECT ae.action FROM audit_events ae WHERE ae.task_id=t.id AND ae.project_id=t.project_id ORDER BY ae.ts DESC LIMIT 1) AS latest_high_risk_action,
			(SELECT COUNT(*) FROM code_changes cc WHERE cc.task_id=t.id) AS code_change_count,
			(SELECT COUNT(*) FROM file_changes fc JOIN code_changes cc ON cc.id=fc.change_id WHERE cc.task_id=t.id) AS file_count,
			COALESCE((SELECT SUM(fc.insertions) FROM file_changes fc JOIN code_changes cc ON cc.id=fc.change_id WHERE cc.task_id=t.id), 0) AS insertions,
			COALESCE((SELECT SUM(fc.deletions) FROM file_changes fc JOIN code_changes cc ON cc.id=fc.change_id WHERE cc.task_id=t.id), 0) AS deletions,
			(SELECT cc.summary FROM code_changes cc WHERE cc.task_id=t.id ORDER BY cc.created_at DESC LIMIT 1) AS latest_change_summary
		FROM canonical c
		JOIN tasks t ON t.id=c.task_id
		LEFT JOIN projects p ON p.id=t.project_id
		WHERE ($1::text IS NULL OR c.agent_run_id=$1 OR c.agent_run_id='run_' || $1)
		ORDER BY c.created_at DESC
	`
	rows, err := api.DB.Query(ctx, query, runID)
	if err != nil {
		return nil, err
	}
	return scanAgentRunSummaryRows(rows)
}

func (api API) listAgentRunSummaries(w http.ResponseWriter, r *http.Request) {
	items, err := api.queryAgentRunSummaries(r.Context(), nil)
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	data := make([]map[string]any, 0, len(items))
	for _, item := range items {
		data = append(data, agentRunSummaryJSON(item))
	}
	web.JSON(w, http.StatusOK, map[string]any{"data": data})
}

func (api API) agentRunSummary(w http.ResponseWriter, r *http.Request) {
	runID := chi.URLParam(r, "runId")
	items, err := api.queryAgentRunSummaries(r.Context(), &runID)
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	if len(items) == 0 {
		web.Error(w, http.StatusNotFound, "Agent run not found")
		return
	}
	web.JSON(w, http.StatusOK, agentRunSummaryJSON(items[0]))
}

func (api API) taskExecutionTrace(w http.ResponseWriter, r *http.Request) {
	taskID := chi.URLParam(r, "taskId")
	sessionID := r.URL.Query().Get("sessionId")
	includeLineage := r.URL.Query().Get("includeLineage") != "false"
	sessionIDs, err := api.lineageSessionIDs(r.Context(), taskID, sessionID, includeLineage)
	if err != nil {
		web.Error(w, http.StatusNotFound, "Task session not found")
		return
	}
	timeline, err := api.readTimelineItems(r, taskID, sessionIDs)
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	operations, err := api.readRunOperations(r, taskID, sessionIDs)
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
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
	snapshot, _ := api.syntheticSnapshot(r, taskID, sessionID)
	web.JSON(w, http.StatusOK, map[string]any{
		"data": map[string]any{
			"selectedSessionId": sessionID,
			"snapshot":          snapshot,
			"timeline":          timeline,
			"operations":        operations,
			"sessions":          sessions,
			"messages":          messages,
		},
		"meta": map[string]any{
			"readSource": "task-session-first", "timelineReadSource": "task-session-projection",
			"includeLineage": includeLineage, "complete": len(timeline) > 0, "lineagePath": sessionIDs,
			"timelineItemCount": len(timeline), "sessionCount": len(sessions),
		},
	})
}

func (api API) readRunOperations(r *http.Request, taskID string, sessionIDs []string) ([]map[string]any, error) {
	rows, err := api.DB.Query(r.Context(), `
		SELECT id, session_id, executor_kind, status, candidate_index, created_at
		FROM task_session_runs
		WHERE task_id=$1 AND session_id = ANY($2::text[])
		ORDER BY created_at ASC, attempt_index ASC
	`, taskID, sessionIDs)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []map[string]any{}
	for rows.Next() {
		var id, sessionID, executorKind, status string
		var candidateIndex *int
		var created time.Time
		if err := rows.Scan(&id, &sessionID, &executorKind, &status, &candidateIndex, &created); err != nil {
			return nil, err
		}
		meta := map[string]any{}
		if candidateIndex != nil {
			meta["candidateIndex"] = *candidateIndex
		}
		items = append(items, map[string]any{
			"id": id, "sessionId": sessionID, "operationKind": executorKind, "executorLabel": executorKind,
			"executionStatus": publicExecutionStatus(status), "modelId": nil, "outputText": nil,
			"metadataJson": meta, "createdAt": created.UTC().Format(time.RFC3339Nano),
		})
	}
	return items, rows.Err()
}

func (api API) syntheticSnapshot(r *http.Request, taskID, sessionID string) (map[string]any, error) {
	rows, err := api.DB.Query(r.Context(), `
		SELECT id, project_id, tree_node_id, created_by_user_id, title, prompt, category, repo_id, workspace_root,
		       base_revision, working_branch, credential_id, strategy_json, final_commit_sha, final_branch_name,
		       created_at, updated_at, lifecycle_status, preferred_model, activated_at, done_at, archived_at,
		       git_author_name, git_author_email, git_committer_name, git_committer_email
		FROM tasks WHERE id=$1
	`, taskID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items, err := scanTaskRows(rows)
	if err != nil || len(items) == 0 {
		return nil, err
	}
	item := items[0]
	_ = api.enrichTaskRecord(r.Context(), item)
	return map[string]any{
		"lifecycleStatus":         item["lifecycleStatus"],
		"currentExecutionMode":    item["executionMode"],
		"currentExecutionStatus":  "running",
		"currentSessionId":        sessionID,
		"latestSessionId":         sessionID,
		"latestResultSummary":     nil,
		"activeCandidateCount":    0,
		"lastActivityAt":          item["updatedAt"],
		"updatedAt":               item["updatedAt"],
		"currentStatus":           item["status"],
		"latestResult":            item["result"],
		"currentSessionRuntimeId": item["sessionId"],
	}, nil
}

func sessionRunStatus(status string) string {
	if status == "complete" {
		return "completed"
	}
	return status
}

func publicExecutionStatus(status string) string {
	if status == "completed" {
		return "complete"
	}
	return status
}

func parseOptionalTime(value *string) any {
	if value == nil || *value == "" {
		return nil
	}
	if parsed, err := time.Parse(time.RFC3339Nano, *value); err == nil {
		return parsed
	}
	return *value
}
