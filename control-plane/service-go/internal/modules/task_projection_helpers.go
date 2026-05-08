package modules

import (
	"context"
	"net/http"
	"time"

	"github.com/google/uuid"

	"openerx/control-plane/service-go/internal/web"
)

func (api API) insertTaskDomainEvent(ctx context.Context, projectID, taskID string, sessionID *string, runID *string, runNodeID *string, eventType string, payload map[string]any) error {
	raw, _ := jsonBytes(payload)
	var seq int64
	_ = api.DB.QueryRow(ctx, `SELECT COALESCE(MAX(seq), -1) + 1 FROM task_domain_events WHERE task_id=$1`, taskID).Scan(&seq)
	_, err := api.DB.Exec(ctx, `
		INSERT INTO task_domain_events (id, project_id, task_id, session_id, run_id, run_node_id, event_type, payload_json, created_at, seq)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
		ON CONFLICT (task_id, seq) DO NOTHING
	`, uuid.NewString(), projectID, taskID, sessionID, runID, runNodeID, eventType, raw, time.Now().UTC(), seq)
	return err
}

type replayTaskProjectionsRequest struct {
	Scope     string `json:"scope"`
	TaskID    string `json:"taskId"`
	ProjectID string `json:"projectId"`
	Confirm   bool   `json:"confirm"`
	Reason    string `json:"reason"`
}

func (api API) replayTaskProjections(w http.ResponseWriter, r *http.Request) {
	var body replayTaskProjectionsRequest
	if !decodeBody(w, r, &body) {
		return
	}
	if body.Scope == "project" && !body.Confirm {
		web.Error(w, http.StatusBadRequest, "Project projection replay requires confirm=true")
		return
	}
	switch body.Scope {
	case "task":
		if body.TaskID == "" {
			web.Error(w, http.StatusBadRequest, "taskId is required")
			return
		}
		count, _ := api.replayTask(r.Context(), body.TaskID)
		web.JSON(w, http.StatusOK, map[string]any{"scope": "task", "replayedEventCount": count})
	case "project":
		if body.ProjectID == "" {
			web.Error(w, http.StatusBadRequest, "projectId is required")
			return
		}
		rows, err := api.DB.Query(r.Context(), `SELECT id FROM tasks WHERE project_id=$1`, body.ProjectID)
		if err != nil {
			web.Error(w, http.StatusInternalServerError, err.Error())
			return
		}
		defer rows.Close()
		taskCount := 0
		eventCount := 0
		for rows.Next() {
			var taskID string
			if err := rows.Scan(&taskID); err == nil {
				taskCount++
				count, _ := api.replayTask(r.Context(), taskID)
				eventCount += count
			}
		}
		web.JSON(w, http.StatusOK, map[string]any{"scope": "project", "confirmed": true, "replayedTaskCount": taskCount, "replayedEventCount": eventCount})
	default:
		web.Error(w, http.StatusBadRequest, "Unsupported projection replay scope")
	}
}

func (api API) replayTask(ctx context.Context, taskID string) (int, error) {
	var count int
	if err := api.DB.QueryRow(ctx, `SELECT COUNT(*) FROM task_domain_events WHERE task_id=$1`, taskID).Scan(&count); err != nil {
		return 0, err
	}
	if count > 0 {
		_ = api.upsertTaskSnapshotForReplay(ctx, taskID)
		var projectID string
		_ = api.DB.QueryRow(ctx, `SELECT project_id FROM tasks WHERE id=$1`, taskID).Scan(&projectID)
		now := time.Now().UTC()
		_, _ = api.DB.Exec(ctx, `
			INSERT INTO task_timeline_views (id, task_id, project_id, item_kind, display_text, metadata_json, sort_at, created_at, updated_at)
			VALUES ($1,$2,$3,'task_lifecycle','任务进入 pending 状态','{}'::jsonb,$4,$4,$4)
			ON CONFLICT (id) DO NOTHING
		`, "task-timeline:lifecycle:"+taskID+":pending", taskID, projectID, now)
	}
	return count, nil
}

func (api API) upsertTaskSnapshot(ctx context.Context, taskID string) error {
	return api.upsertTaskSnapshotWithSessionFallback(ctx, taskID, true)
}

func (api API) upsertTaskSnapshotForReplay(ctx context.Context, taskID string) error {
	return api.upsertTaskSnapshotWithSessionFallback(ctx, taskID, false)
}

func (api API) upsertTaskSnapshotWithSessionFallback(ctx context.Context, taskID string, includeSessionFallback bool) error {
	rows, err := api.DB.Query(ctx, `
		SELECT id, project_id, tree_node_id, created_by_user_id, title, prompt, category, repo_id, workspace_root,
		       base_revision, working_branch, credential_id, strategy_json, final_commit_sha, final_branch_name,
		       created_at, updated_at, lifecycle_status, preferred_model, activated_at, done_at, archived_at,
		       git_author_name, git_author_email, git_committer_name, git_committer_email
		FROM tasks WHERE id=$1
	`, taskID)
	if err != nil {
		return err
	}
	defer rows.Close()
	items, err := scanTaskRows(rows)
	if err != nil || len(items) == 0 {
		return err
	}
	item := items[0]
	_ = api.enrichTaskRecord(ctx, item)
	projectID, _ := item["projectId"].(string)
	lifecycle, _ := item["lifecycleStatus"].(string)
	mode, _ := item["executionMode"].(string)
	result, _ := item["result"].(string)
	if result == "" {
		_ = api.DB.QueryRow(ctx, `SELECT result_summary FROM task_session_runs WHERE task_id=$1 AND result_summary IS NOT NULL ORDER BY created_at DESC LIMIT 1`, taskID).Scan(&result)
	}
	sessionRuntime, _ := item["sessionId"].(string)
	var canonicalSessionID *string
	if sessionRuntime != "" {
		var id string
		if err := api.DB.QueryRow(ctx, `SELECT id FROM task_sessions WHERE task_id=$1 AND (id=$2 OR runtime_session_id=$2) LIMIT 1`, taskID, sessionRuntime).Scan(&id); err == nil {
			canonicalSessionID = &id
		}
	}
	if includeSessionFallback && canonicalSessionID == nil {
		var id, runtime string
		if err := api.DB.QueryRow(ctx, `SELECT id, COALESCE(runtime_session_id, id) FROM task_sessions WHERE task_id=$1 ORDER BY updated_at DESC, created_at DESC LIMIT 1`, taskID).Scan(&id, &runtime); err == nil {
			canonicalSessionID = &id
			sessionRuntime = runtime
			item["sessionId"] = runtime
		}
	}
	if lifecycle == "draft" && canonicalSessionID != nil {
		lifecycle = "active"
	}
	now := time.Now().UTC()
	var currentStatus any
	if mode != "" {
		currentStatus = "running"
	}
	_, err = api.DB.Exec(ctx, `
		INSERT INTO task_snapshots (
			task_id, project_id, lifecycle_status, current_execution_mode, current_execution_status,
			current_session_id, latest_session_id, latest_result_summary, active_candidate_count,
			last_activity_at, updated_at
		) VALUES ($1,$2,$3,$4,$5,$6,$6,$7,0,$8,$8)
		ON CONFLICT (task_id) DO UPDATE SET
			lifecycle_status=EXCLUDED.lifecycle_status,
			current_execution_mode=EXCLUDED.current_execution_mode,
			current_execution_status=EXCLUDED.current_execution_status,
			current_session_id=EXCLUDED.current_session_id,
			latest_session_id=EXCLUDED.latest_session_id,
			latest_result_summary=EXCLUDED.latest_result_summary,
			updated_at=EXCLUDED.updated_at,
			last_activity_at=EXCLUDED.last_activity_at
	`, taskID, projectID, lifecycle, nullString(mode), currentStatus, canonicalSessionID, nullString(result), now)
	return err
}
