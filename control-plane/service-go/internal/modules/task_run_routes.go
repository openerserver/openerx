package modules

import (
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

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
	runtimeSessionID := body.SessionID
	if err := api.DB.QueryRow(r.Context(), `SELECT id FROM task_sessions WHERE (id=$1 OR runtime_session_id=$1) AND task_id=$2`, body.SessionID, taskID).Scan(&sessionExists); err != nil {
		var projectID string
		if taskErr := api.DB.QueryRow(r.Context(), `SELECT project_id FROM tasks WHERE id=$1`, taskID).Scan(&projectID); taskErr != nil {
			web.Error(w, http.StatusNotFound, "Task not found")
			return
		}
		sessionExists = taskSessionID(taskID, runtimeSessionID)
		now := time.Now().UTC()
		_, _ = api.DB.Exec(r.Context(), `
			INSERT INTO task_sessions (
				id, task_id, project_id, root_session_id, session_kind, trigger_type,
				execution_mode_snapshot, execution_status, runtime_session_id, status,
				depth, sort_key, created_at, updated_at, last_activity_at
			) VALUES ($1,$2,$3,$1,'primary','execute','single','running',$4,'running',0,$1,$5,$5,$5)
			ON CONFLICT (id) DO NOTHING
		`, sessionExists, taskID, projectID, runtimeSessionID, now)
	}
	var attemptIndex int
	_ = api.DB.QueryRow(r.Context(), `SELECT COALESCE(MAX(attempt_index), -1) + 1 FROM task_session_runs WHERE session_id=$1`, sessionExists).Scan(&attemptIndex)
	runID := body.ID
	if runID == "" {
		runID = uuid.NewString()
	} else if body.CandidateIndex == nil && body.AgentType == "builder" {
		runID = "run_" + sessionExists
	}
	runRuntimeSessionID := runID
	if body.ID != "" && body.CandidateIndex == nil && body.AgentType == "builder" {
		runRuntimeSessionID = body.SessionID
	}
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
	`, runID, taskID, sessionExists, attemptIndex, executionKind, runRuntimeSessionID, body.CandidateIndex, laneRole, body.AgentType, body.ModelUsed, status, body.Result, parseOptionalTime(body.StartedAt), parseOptionalTime(body.FinishedAt), now)
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	_ = api.writeRunSideEffects(r, taskID, sessionExists, runID, body.ID, status, body.Result, body.TokenUsed)
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
	if err := api.DB.QueryRow(r.Context(), `SELECT id, session_id FROM task_session_runs WHERE id=$1 OR id=$2 OR id=(SELECT run_id FROM task_operations WHERE id=$3 LIMIT 1) LIMIT 1`, runAlias, "run_"+runAlias, opID).Scan(&runID, &sessionID); err != nil {
		if err := api.DB.QueryRow(r.Context(), `SELECT id, session_id FROM task_session_runs WHERE task_id=$1 ORDER BY created_at DESC LIMIT 1`, taskID).Scan(&runID, &sessionID); err != nil {
			web.Error(w, http.StatusNotFound, "Task run not found")
			return
		}
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
	_ = api.writeRunSideEffects(r, taskID, sessionID, runID, runAlias, status, body.Result, body.TokenUsed)
	if status == "completed" {
		_, _ = api.DB.Exec(r.Context(), `UPDATE tasks SET lifecycle_status='done', updated_at=$1 WHERE id=$2`, time.Now().UTC(), taskID)
	}
	_ = api.upsertTaskSnapshot(r.Context(), taskID)
	web.JSON(w, http.StatusOK, map[string]any{"id": runAlias, "status": status})
}

func (api API) writeRunSideEffects(r *http.Request, taskID, sessionID, runID, externalRunID, status string, result *string, tokenUsed int) error {
	var projectID string
	_ = api.DB.QueryRow(r.Context(), `SELECT project_id FROM tasks WHERE id=$1`, taskID).Scan(&projectID)
	operationID := "session-operation:" + taskID + ":" + externalRunID
	if externalRunID == "" {
		operationID = "session-operation:" + taskID + ":" + runID
	}
	summary, _ := jsonBytes(map[string]any{"resultText": result})
	now := time.Now().UTC()
	_, _ = api.DB.Exec(r.Context(), `
		INSERT INTO task_operations (id, task_id, session_id, run_id, operation_index, operation_kind, status, summary_json, created_at, updated_at)
		VALUES ($1,$2,$3,$4,0,'model_request',$5,$6,$7,$7)
		ON CONFLICT (id) DO UPDATE SET status=EXCLUDED.status, summary_json=EXCLUDED.summary_json, updated_at=EXCLUDED.updated_at
	`, operationID, taskID, sessionID, runID, status, summary, now)
	_, _ = api.DB.Exec(r.Context(), `
		INSERT INTO task_usage_ledger_entries (id, task_id, project_id, session_id, operation_id, entry_kind, output_tokens, total_tokens, created_at, recorded_at)
		VALUES ($1,$2,$3,$4,$5,'model_request',$6,$6,$7,$7)
	`, uuid.NewString(), taskID, projectID, sessionID, operationID, tokenUsed, now)
	return nil
}

func (api API) AgentRunRoutes(r chi.Router) {
	r.Get("/{runId}/summary", api.agentRunSummary)
}

func (api API) agentRunSummary(w http.ResponseWriter, r *http.Request) {
	runID := chi.URLParam(r, "runId")
	var title string
	var result *string
	err := api.DB.QueryRow(r.Context(), `
		SELECT t.title, r.result_summary
		FROM task_session_runs r
		JOIN tasks t ON t.id=r.task_id
		WHERE r.id=$1
	`, runID).Scan(&title, &result)
	if err != nil {
		err = api.DB.QueryRow(r.Context(), `
			SELECT t.title, o.summary_json->>'resultText'
			FROM task_operations o
			JOIN tasks t ON t.id=o.task_id
			WHERE o.id LIKE $1
			LIMIT 1
		`, "%:"+runID).Scan(&title, &result)
	}
	if err != nil {
		web.Error(w, http.StatusNotFound, "Agent run not found")
		return
	}
	web.JSON(w, http.StatusOK, map[string]any{
		"taskTitle": title,
		"result":    result,
		"codeChanges": map[string]any{
			"changeCount": 0, "files": 0, "insertions": 0, "deletions": 0, "latestSummary": nil,
		},
	})
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
