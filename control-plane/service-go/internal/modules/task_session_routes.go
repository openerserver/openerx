package modules

import (
	"context"
	"encoding/json"
	"net/http"
	"net/url"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"openerx/control-plane/service-go/internal/web"
)

type createTaskSessionRequest struct {
	RuntimeSessionID       string  `json:"runtimeSessionId"`
	ParentRuntimeSessionID *string `json:"parentRuntimeSessionId"`
	ForkedFromMessageID    *string `json:"forkedFromMessageId"`
	BranchName             *string `json:"branchName"`
	SourceType             string  `json:"sourceType"`
	SessionKind            string  `json:"sessionKind"`
	ExecutionModeSnapshot  string  `json:"executionModeSnapshot"`
	CandidateIndex         *int    `json:"candidateIndex"`
	StepIndex              *int    `json:"stepIndex"`
	IsActive               *bool   `json:"isActive"`
	SelectedModel          *string `json:"selectedModel"`
	ExecutionMode          string  `json:"executionMode"`
}

type persistTaskSessionMessageRequest struct {
	RuntimeSessionID string         `json:"runtimeSessionId"`
	Message          map[string]any `json:"message"`
}

type postTaskSessionCanonicalMessageRequest struct {
	ClientMessageID string `json:"client_message_id"`
	Text            string `json:"text"`
}

func taskSessionID(taskID, runtimeSessionID string) string {
	return "task-session:" + taskID + ":" + runtimeSessionID
}

func taskSessionNodeID(taskID, runtimeSessionID string) string {
	return "branch-node:" + taskID + ":" + runtimeSessionID
}

func taskSessionMessageID(sessionID, runtimeMessageID string) string {
	return "task-session-message:" + sessionID + ":" + runtimeMessageID
}

func (api API) createTaskSession(w http.ResponseWriter, r *http.Request) {
	taskID := chi.URLParam(r, "taskId")
	var body createTaskSessionRequest
	if !decodeBody(w, r, &body) {
		return
	}
	if body.RuntimeSessionID == "" {
		web.Error(w, http.StatusBadRequest, "runtimeSessionId is required")
		return
	}
	if body.SourceType == "" {
		body.SourceType = "root"
	}
	if body.ExecutionMode == "" {
		body.ExecutionMode = "single"
	}
	if body.ExecutionModeSnapshot != "" {
		body.ExecutionMode = body.ExecutionModeSnapshot
	}
	candidateIndex := body.CandidateIndex
	if candidateIndex == nil {
		candidateIndex = body.StepIndex
	}

	var projectID string
	if err := api.DB.QueryRow(r.Context(), `SELECT project_id FROM tasks WHERE id=$1`, taskID).Scan(&projectID); err != nil {
		web.Error(w, http.StatusNotFound, "Task not found")
		return
	}
	sessionID := taskSessionID(taskID, body.RuntimeSessionID)
	nodeID := taskSessionNodeID(taskID, body.RuntimeSessionID)
	parentNodeID := taskID
	var parentSessionID *string
	rootSessionID := sessionID
	if body.ParentRuntimeSessionID != nil && *body.ParentRuntimeSessionID != "" {
		pid := taskSessionID(taskID, *body.ParentRuntimeSessionID)
		parentSessionID = &pid
		parentNodeID = taskSessionNodeID(taskID, *body.ParentRuntimeSessionID)
		_ = api.DB.QueryRow(r.Context(), `SELECT COALESCE(root_session_id, id) FROM task_sessions WHERE id=$1`, pid).Scan(&rootSessionID)
	}
	var forkedMessageCanonical *string
	if body.ForkedFromMessageID != nil && *body.ForkedFromMessageID != "" {
		canonical := resolveMessageID(r.Context(), api, taskID, *body.ForkedFromMessageID)
		if canonical != "" {
			forkedMessageCanonical = &canonical
		}
	}
	lineageJSON, _ := jsonBytes(map[string]any{
		"sourceType":             body.SourceType,
		"parentRuntimeSessionId": body.ParentRuntimeSessionID,
		"forkedFromMessageId":    body.ForkedFromMessageID,
	})
	isActive := boolValue(body.IsActive, true)
	now := time.Now().UTC()

	tx, err := api.DB.Begin(r.Context())
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	defer tx.Rollback(r.Context())

	var parentPath string
	var parentDepth int
	if err := tx.QueryRow(r.Context(), `SELECT path::text, depth FROM project_tree_nodes WHERE id=$1 AND project_id=$2`, parentNodeID, projectID).Scan(&parentPath, &parentDepth); err != nil {
		web.Error(w, http.StatusNotFound, "Parent tree node not found")
		return
	}
	_, err = tx.Exec(r.Context(), `
		INSERT INTO project_tree_nodes (
			id, project_id, parent_id, path, depth, node_type, content_json, runtime_session_id,
			branch_name, is_active, ref_type, ref_id, created_at, updated_at, archived_at
		) VALUES ($1,$2,$3,$4::ltree,$5,'session',$6,$7,$8,$9,'task_session',$10,$11,$11,NULL)
		ON CONFLICT (id) DO UPDATE SET
			content_json=EXCLUDED.content_json,
			runtime_session_id=EXCLUDED.runtime_session_id,
			branch_name=EXCLUDED.branch_name,
			is_active=EXCLUDED.is_active,
			archived_at=NULL,
			updated_at=EXCLUDED.updated_at
	`, nodeID, projectID, parentNodeID, parentPath+".session_"+safeLtree(body.RuntimeSessionID), parentDepth+1, lineageJSON, body.RuntimeSessionID, body.BranchName, isActive, sessionID, now)
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	sessionKind := "primary"
	if body.SessionKind != "" {
		sessionKind = body.SessionKind
	} else if body.SourceType == "fork" {
		sessionKind = "manual_branch"
	}
	_, err = tx.Exec(r.Context(), `
		INSERT INTO task_sessions (
			id, task_id, project_id, tree_node_id, parent_session_id, root_session_id, session_kind,
			trigger_type, execution_mode_snapshot, execution_status, branch_name, runtime_session_id,
			forked_from_message_id, selected_model, status, source_message_id, session_type,
			candidate_index, depth, sort_key, created_at, updated_at, last_activity_at, archived_at
		) VALUES ($1,$2,$3,$4,$5,$6,$7,'execute',$8,$9,$10,$11,$12,$13,$14,$12,$15,$16,$17,$18,$19,$19,$19,NULL)
		ON CONFLICT (id) DO UPDATE SET
			tree_node_id=EXCLUDED.tree_node_id,
			parent_session_id=EXCLUDED.parent_session_id,
			root_session_id=EXCLUDED.root_session_id,
			branch_name=EXCLUDED.branch_name,
			runtime_session_id=EXCLUDED.runtime_session_id,
			selected_model=EXCLUDED.selected_model,
			status=EXCLUDED.status,
			execution_status=EXCLUDED.execution_status,
			candidate_index=EXCLUDED.candidate_index,
			archived_at=NULL,
			updated_at=EXCLUDED.updated_at
	`, sessionID, taskID, projectID, nodeID, parentSessionID, rootSessionID, sessionKind, body.ExecutionMode, "running", body.BranchName, body.RuntimeSessionID, forkedMessageCanonical, body.SelectedModel, "running", body.SourceType, candidateIndex, parentDepth, nodeID, now)
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	_ = api.upsertTaskSnapshot(r.Context(), taskID)
	web.JSON(w, http.StatusCreated, map[string]any{
		"id": sessionID, "taskId": taskID, "projectId": projectID, "runtimeSessionId": body.RuntimeSessionID,
		"treeNodeId": nodeID, "branchName": body.BranchName,
	})
}

func (api API) listTaskSessions(w http.ResponseWriter, r *http.Request) {
	taskID := chi.URLParam(r, "taskId")
	rows, err := api.DB.Query(r.Context(), `
		SELECT id, task_id, project_id, tree_node_id, parent_session_id, root_session_id, runtime_session_id,
		       branch_name, session_kind, execution_mode_snapshot, execution_status, status, session_type, candidate_index, selected_model,
		       created_at, updated_at, archived_at,
		       (SELECT runtime_session_id FROM task_sessions p WHERE p.id=task_sessions.parent_session_id) AS parent_runtime_session_id
		FROM task_sessions
		WHERE task_id=$1
		ORDER BY created_at ASC
	`, taskID)
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	defer rows.Close()
	items := []map[string]any{}
	for rows.Next() {
		var id, taskID, projectID, sessionKind, executionMode, executionStatus, status string
		var treeNodeID, parentSessionID, rootSessionID, runtimeSessionID, branchName, sourceType, parentRuntimeSessionID *string
		var candidateIndex *int
		var selectedModel *string
		var created, updated time.Time
		var archived *time.Time
		if err := rows.Scan(&id, &taskID, &projectID, &treeNodeID, &parentSessionID, &rootSessionID, &runtimeSessionID, &branchName, &sessionKind, &executionMode, &executionStatus, &status, &sourceType, &candidateIndex, &selectedModel, &created, &updated, &archived, &parentRuntimeSessionID); err != nil {
			web.Error(w, http.StatusInternalServerError, err.Error())
			return
		}
		items = append(items, map[string]any{
			"id": id, "taskId": taskID, "projectId": projectID, "treeNodeId": treeNodeID,
			"parentSessionId": parentSessionID, "rootSessionId": rootSessionID, "runtimeSessionId": runtimeSessionID,
			"branchName": branchName, "sessionKind": sessionKind, "executionModeSnapshot": executionMode,
			"sourceType": sourceType, "parentRuntimeSessionId": parentRuntimeSessionID,
			"candidateIndex": candidateIndex, "stepIndex": candidateIndex, "selectedModel": selectedModel,
			"executionStatus": executionStatus, "status": status, "createdAt": created.UTC().Format(time.RFC3339Nano),
			"updatedAt": updated.UTC().Format(time.RFC3339Nano), "archivedAt": web.NormalizeTime(archived),
		})
	}
	if err := rows.Err(); err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	web.JSON(w, http.StatusOK, map[string]any{
		"data": items,
		"meta": map[string]any{"readSource": "task-session-first", "sessionCount": len(items)},
	})
}

func (api API) getTaskSession(w http.ResponseWriter, r *http.Request) {
	taskID := chi.URLParam(r, "taskId")
	sessionID := routeSessionID(r)
	items, err := api.readTaskSessionsByID(r.Context(), taskID, []string{sessionID})
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	if len(items) == 0 {
		web.Error(w, http.StatusNotFound, "Task session not found")
		return
	}
	lineage, _ := api.lineageSessionIDs(r.Context(), taskID, sessionID, true)
	web.JSON(w, http.StatusOK, map[string]any{
		"data": items[0],
		"meta": map[string]any{
			"readSource": "task-session-first", "lineagePath": lineage,
			"isCurrent": true, "isLatest": true,
		},
	})
}

func (api API) persistTaskSessionMessage(w http.ResponseWriter, r *http.Request) {
	taskID := chi.URLParam(r, "taskId")
	var body persistTaskSessionMessageRequest
	if !decodeBody(w, r, &body) {
		return
	}
	if body.RuntimeSessionID == "" {
		web.Error(w, http.StatusBadRequest, "runtimeSessionId is required")
		return
	}
	if body.Message == nil {
		web.Error(w, http.StatusBadRequest, "message is required")
		return
	}
	sessionID := taskSessionID(taskID, body.RuntimeSessionID)
	info := mapValue(body.Message, "info")
	runtimeMessageID := stringMapValue(info, "id")
	if runtimeMessageID == "" {
		runtimeMessageID = stringMapValue(body.Message, "id")
	}
	if runtimeMessageID == "" {
		web.Error(w, http.StatusBadRequest, "message id is required")
		return
	}
	info["id"] = runtimeMessageID
	role := stringMapValue(info, "role")
	if role == "" {
		role = stringMapValue(body.Message, "role")
	}
	if role == "" {
		role = "assistant"
	}
	info["role"] = role
	body.Message["info"] = info
	var projectID, targetSessionID string
	var parentSessionID, sessionKind, sourceType *string
	if err := api.DB.QueryRow(r.Context(), `SELECT project_id, id, parent_session_id, session_kind, session_type FROM task_sessions WHERE id=$1 AND task_id=$2`, sessionID, taskID).Scan(&projectID, &targetSessionID, &parentSessionID, &sessionKind, &sourceType); err != nil {
		web.Error(w, http.StatusNotFound, "Task session not found")
		return
	}
	parts := arrayMapValue(body.Message, "parts")
	text := firstTextPart(parts)
	if role == "user" && parentSessionID != nil && (stringValue(sessionKind) == "candidate" || stringValue(sourceType) == "parallel") {
		targetSessionID = *parentSessionID
		var existingSeq int
		err := api.DB.QueryRow(r.Context(), `
			SELECT seq FROM task_messages
			WHERE task_id=$1 AND session_id=$2 AND role='user' AND text_content=$3
			LIMIT 1
		`, taskID, targetSessionID, text).Scan(&existingSeq)
		if err == nil {
			web.JSON(w, http.StatusCreated, map[string]any{"ok": true, "seq": existingSeq})
			return
		}
	}
	partCount := len(parts)
	rawPayload, _ := jsonBytes(body.Message)
	msgID := taskSessionMessageID(targetSessionID, runtimeMessageID)
	now := time.Now().UTC()
	var seq int
	_ = api.DB.QueryRow(r.Context(), `SELECT COALESCE(MAX(seq), -1) + 1 FROM task_messages WHERE session_id=$1`, targetSessionID).Scan(&seq)
	tx, err := api.DB.Begin(r.Context())
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	defer tx.Rollback(r.Context())
	_, err = tx.Exec(r.Context(), `
		INSERT INTO task_messages (
			id, task_id, session_id, role, message_kind, runtime_message_id, seq, text_content,
			text_preview, raw_payload, part_count, token_used, status, started_at, created_at, updated_at, completed_at
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8,$9,$10,0,'completed',$11,$11,$11,$11)
		ON CONFLICT (session_id, runtime_message_id) DO UPDATE SET
			role=EXCLUDED.role,
			message_kind=EXCLUDED.message_kind,
			text_content=EXCLUDED.text_content,
			text_preview=EXCLUDED.text_preview,
			raw_payload=EXCLUDED.raw_payload,
			part_count=EXCLUDED.part_count,
			status='completed',
			updated_at=EXCLUDED.updated_at,
			completed_at=EXCLUDED.completed_at
	`, msgID, taskID, targetSessionID, role, messageKind(role), runtimeMessageID, seq, text, rawPayload, partCount, now)
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	_, _ = tx.Exec(r.Context(), `DELETE FROM task_message_parts WHERE message_id=$1`, msgID)
	for idx, part := range parts {
		partPayload, _ := jsonBytes(part)
		partType := normalizePartType(stringMapValue(part, "type"))
		partText := stringMapValue(part, "text")
		_, err = tx.Exec(r.Context(), `
			INSERT INTO task_message_parts (id, message_id, part_index, part_type, text_content, json_payload, created_at)
			VALUES ($1,$2,$3,$4,$5,$6,$7)
		`, msgID+":"+safeLtree(partType)+":"+uuid.NewString(), msgID, idx, partType, nullString(partText), partPayload, now)
		if err != nil {
			web.Error(w, http.StatusInternalServerError, err.Error())
			return
		}
	}
	_, _ = tx.Exec(r.Context(), `
		UPDATE task_sessions
		SET head_message_id=$1, last_activity_at=$2, updated_at=$2
		WHERE id=$3
	`, msgID, now, targetSessionID)
	_, _ = tx.Exec(r.Context(), `
		INSERT INTO task_timeline_views (
			id, task_id, project_id, session_id, message_id, item_kind, item_role, display_text,
			metadata_json, sort_at, created_at, updated_at
		) VALUES ($1,$2,$3,$4,$5,'message',$6,$7,'{}'::jsonb,$8,$8,$8)
		ON CONFLICT (id) DO UPDATE SET
			item_role=EXCLUDED.item_role,
			display_text=EXCLUDED.display_text,
			sort_at=EXCLUDED.sort_at,
			updated_at=EXCLUDED.updated_at
	`, "task-timeline:message:"+msgID, taskID, projectID, targetSessionID, msgID, role, text, now)
	if err := tx.Commit(r.Context()); err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	_ = api.upsertTaskSnapshot(r.Context(), taskID)
	web.JSON(w, http.StatusCreated, map[string]any{"ok": true, "id": msgID, "messageId": msgID, "sessionId": targetSessionID, "seq": seq})
}

func (api API) postTaskSessionCanonicalMessage(w http.ResponseWriter, r *http.Request) {
	taskID := chi.URLParam(r, "taskId")
	sessionID := routeSessionID(r)
	var body postTaskSessionCanonicalMessageRequest
	if !decodeBody(w, r, &body) {
		return
	}
	if body.ClientMessageID == "" {
		web.Error(w, http.StatusBadRequest, "client_message_id is required")
		return
	}
	var existing taskCanonicalMessage
	err := api.DB.QueryRow(r.Context(), `
		SELECT id, task_id, session_id, role, status, client_message_id, runtime_message_id, seq,
		       text_content, created_at, completed_at
		FROM task_messages
		WHERE task_id=$1 AND session_id=$2 AND role='user' AND client_message_id=$3
		LIMIT 1
	`, taskID, sessionID, body.ClientMessageID).Scan(&existing.ID, &existing.TaskID, &existing.SessionID, &existing.Role, &existing.Status, &existing.ClientMessageID, &existing.RuntimeMessageID, &existing.Seq, &existing.TextContent, &existing.CreatedAt, &existing.CompletedAt)
	if err == nil {
		operation, _ := api.readCanonicalOperation(r.Context(), taskID, sessionID, body.ClientMessageID)
		web.JSON(w, http.StatusOK, canonicalMessageResponse(existing, operation))
		return
	}
	if err != pgx.ErrNoRows {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	var projectID string
	var runtimeSessionID *string
	if err := api.DB.QueryRow(r.Context(), `SELECT project_id, runtime_session_id FROM task_sessions WHERE id=$1 AND task_id=$2`, sessionID, taskID).Scan(&projectID, &runtimeSessionID); err != nil {
		web.Error(w, http.StatusNotFound, "Task session not found")
		return
	}
	now := time.Now().UTC()
	runtimeMessageID := "user:" + body.ClientMessageID
	messageID := taskSessionMessageID(sessionID, runtimeMessageID)
	runID := "task-session-run:" + taskID + ":model-request:" + body.ClientMessageID
	operationID := "session-operation:" + taskID + ":model-request:" + body.ClientMessageID
	var seq int
	_ = api.DB.QueryRow(r.Context(), `SELECT COALESCE(MAX(seq), -1) + 1 FROM task_messages WHERE session_id=$1`, sessionID).Scan(&seq)
	var attemptIndex int
	_ = api.DB.QueryRow(r.Context(), `SELECT COALESCE(MAX(attempt_index), -1) + 1 FROM task_session_runs WHERE session_id=$1`, sessionID).Scan(&attemptIndex)
	tx, err := api.DB.Begin(r.Context())
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	defer tx.Rollback(r.Context())
	rawPayload, _ := jsonBytes(map[string]any{"text": body.Text, "client_message_id": body.ClientMessageID})
	_, err = tx.Exec(r.Context(), `
		INSERT INTO task_messages (
			id, task_id, session_id, role, message_kind, runtime_message_id, client_message_id,
			seq, text_content, text_preview, raw_payload, part_count, token_used, status,
			started_at, created_at, updated_at, completed_at
		) VALUES ($1,$2,$3,'user','prompt',$4,$5,$6,$7,$7,$8,1,0,'completed',$9,$9,$9,$9)
	`, messageID, taskID, sessionID, runtimeMessageID, body.ClientMessageID, seq, body.Text, rawPayload, now)
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	partPayload, _ := jsonBytes(map[string]any{"type": "text", "text": body.Text})
	_, err = tx.Exec(r.Context(), `
		INSERT INTO task_message_parts (id, message_id, part_index, part_type, text_content, json_payload, created_at)
		VALUES ($1,$2,0,'text',$3,$4,$5)
		ON CONFLICT (message_id, part_index) DO UPDATE SET text_content=EXCLUDED.text_content, json_payload=EXCLUDED.json_payload
	`, messageID+":text", messageID, body.Text, partPayload, now)
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	_, err = tx.Exec(r.Context(), `
		INSERT INTO task_session_runs (
			id, task_id, session_id, attempt_index, runtime_session_id, trigger_type, execution_kind,
			lane_role, executor_kind, status, started_at, created_at
		) VALUES ($1,$2,$3,$4,$5,'user_prompt','single','primary','model','queued',$6,$6)
		ON CONFLICT (id) DO NOTHING
	`, runID, taskID, sessionID, attemptIndex, runtimeSessionID, now)
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	summaryRaw, _ := jsonBytes(map[string]any{"kind": "model_request"})
	_, err = tx.Exec(r.Context(), `
		INSERT INTO task_operations (
			id, task_id, session_id, run_id, message_id, runtime_operation_id, operation_index,
			operation_kind, status, summary_json, started_at, created_at, updated_at
		) VALUES ($1,$2,$3,$4,$5,$1,0,'model_request','queued',$6,$7,$7,$7)
		ON CONFLICT (id) DO UPDATE SET status=EXCLUDED.status, updated_at=EXCLUDED.updated_at
	`, operationID, taskID, sessionID, runID, messageID, summaryRaw, now)
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	_, _ = tx.Exec(r.Context(), `UPDATE task_sessions SET head_message_id=$1, latest_run_id=$2, last_activity_at=$3, updated_at=$3 WHERE id=$4`, messageID, runID, now, sessionID)
	if err := tx.Commit(r.Context()); err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	_ = projectID
	_ = api.upsertTaskSnapshot(r.Context(), taskID)
	operation, _ := api.readCanonicalOperation(r.Context(), taskID, sessionID, body.ClientMessageID)
	web.JSON(w, http.StatusCreated, canonicalMessageResponse(taskCanonicalMessage{
		ID: messageID, TaskID: taskID, SessionID: sessionID, Role: "user", Status: "completed",
		ClientMessageID: &body.ClientMessageID, RuntimeMessageID: &runtimeMessageID, Seq: seq,
		TextContent: &body.Text, CreatedAt: now, CompletedAt: &now,
	}, operation))
}

func (api API) normalizedConversation(w http.ResponseWriter, r *http.Request) {
	taskID := chi.URLParam(r, "taskId")
	sessionID := r.URL.Query().Get("sessionId")
	includeLineage := r.URL.Query().Get("includeLineage") == "true"
	sessionIDs, err := api.lineageSessionIDs(r.Context(), taskID, sessionID, includeLineage)
	if err != nil {
		web.Error(w, http.StatusNotFound, "Task session not found")
		return
	}
	items, err := api.readSessionMessages(r, taskID, sessionIDs)
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	web.JSON(w, http.StatusOK, map[string]any{
		"data": items,
		"meta": map[string]any{
			"readSource": "task-session-first", "viewType": "normalized-conversation",
			"sessionId": sessionID, "messageCount": len(items), "includeLineage": includeLineage,
		},
	})
}

func (api API) taskSessionTimeline(w http.ResponseWriter, r *http.Request) {
	taskID := chi.URLParam(r, "taskId")
	sessionID := routeSessionID(r)
	includeLineage := r.URL.Query().Get("includeLineage") != "false"
	sessionIDs, err := api.lineageSessionIDs(r.Context(), taskID, sessionID, includeLineage)
	if err != nil {
		web.Error(w, http.StatusNotFound, "Task session not found")
		return
	}
	items, err := api.readTimelineItems(r, taskID, sessionIDs)
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	web.JSON(w, http.StatusOK, map[string]any{
		"data": items,
		"meta": map[string]any{
			"includeLineage": includeLineage, "readSource": "task-session-projection",
			"sessionId":   sessionID,
			"lineagePath": sessionIDs, "itemCount": len(items), "cachedSessionCount": len(sessionIDs), "complete": len(items) > 0,
		},
	})
}

func (api API) taskTimelineView(w http.ResponseWriter, r *http.Request) {
	taskID := chi.URLParam(r, "taskId")
	sessionID := r.URL.Query().Get("sessionId")
	includeLineage := r.URL.Query().Get("includeLineage") != "false"
	sessionIDs, err := api.lineageSessionIDs(r.Context(), taskID, sessionID, includeLineage)
	if err != nil {
		web.Error(w, http.StatusNotFound, "Task session not found")
		return
	}
	items, err := api.readTimelineItems(r, taskID, sessionIDs)
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	web.JSON(w, http.StatusOK, map[string]any{
		"data": items,
		"meta": map[string]any{
			"includeLineage": includeLineage, "readSource": "task-session-projection",
			"lineagePath": sessionIDs, "itemCount": len(items), "cachedSessionCount": len(sessionIDs), "complete": len(items) > 0,
		},
	})
}

func (api API) deprecatedSessionMessages(w http.ResponseWriter, r *http.Request) {
	web.Error(w, http.StatusGone, "Deprecated route. Use /tasks/:taskId/query/normalized-conversation?sessionId=:sessionId")
}

func (api API) deprecatedTaskMessages(w http.ResponseWriter, r *http.Request) {
	web.Error(w, http.StatusGone, "Deprecated route. Use /tasks/:taskId/query/normalized-conversation")
}

func (api API) listTaskSessionOperations(w http.ResponseWriter, r *http.Request) {
	taskID := chi.URLParam(r, "taskId")
	sessionID := routeSessionID(r)
	rows, err := api.DB.Query(r.Context(), `
		SELECT id, operation_kind::text, status::text, summary_json, created_at, updated_at
		FROM task_operations
		WHERE task_id=$1 AND session_id=$2
		ORDER BY operation_index, created_at
	`, taskID, sessionID)
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	defer rows.Close()
	items := []map[string]any{}
	for rows.Next() {
		var id, kind, status string
		var summary []byte
		var created, updated time.Time
		if err := rows.Scan(&id, &kind, &status, &summary, &created, &updated); err != nil {
			web.Error(w, http.StatusInternalServerError, err.Error())
			return
		}
		publicKind := kind
		if publicKind == "model_request" {
			publicKind = "executor"
		}
		items = append(items, map[string]any{
			"id": id, "operationKind": publicKind, "kind": kind, "executionStatus": status, "status": status,
			"summary": scanJSONMap(summary), "createdAt": created.UTC().Format(time.RFC3339Nano), "updatedAt": updated.UTC().Format(time.RFC3339Nano),
		})
	}
	if err := rows.Err(); err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	web.JSON(w, http.StatusOK, map[string]any{
		"data": items,
		"meta": map[string]any{"readSource": "task-session-first", "sessionId": sessionID, "operationCount": len(items)},
	})
}

func (api API) listTaskSessionArtifacts(w http.ResponseWriter, r *http.Request) {
	sessionID := routeSessionID(r)
	web.JSON(w, http.StatusOK, map[string]any{
		"data": []map[string]any{},
		"meta": map[string]any{"readSource": "task-session-first", "sessionId": sessionID, "artifactCount": 0},
	})
}

func (api API) listTaskSessionUsageLedger(w http.ResponseWriter, r *http.Request) {
	sessionID := routeSessionID(r)
	web.JSON(w, http.StatusOK, map[string]any{
		"data": []map[string]any{},
		"meta": map[string]any{"readSource": "task-session-first", "sessionId": sessionID, "entryCount": 0},
	})
}

func (api API) activateTaskSession(w http.ResponseWriter, r *http.Request) {
	api.setTaskSessionArchived(w, r, false)
}

func (api API) archiveTaskSession(w http.ResponseWriter, r *http.Request) {
	api.setTaskSessionArchived(w, r, true)
}

func (api API) setTaskSessionArchived(w http.ResponseWriter, r *http.Request, archived bool) {
	taskID := chi.URLParam(r, "taskId")
	sessionID := routeSessionID(r)
	now := time.Now().UTC()
	var runtimeSessionID, treeNodeID string
	if err := api.DB.QueryRow(r.Context(), `SELECT runtime_session_id, tree_node_id FROM task_sessions WHERE id=$1 AND task_id=$2`, sessionID, taskID).Scan(&runtimeSessionID, &treeNodeID); err != nil {
		web.Error(w, http.StatusNotFound, "Task session not found")
		return
	}
	status := "running"
	execStatus := "running"
	var archivedAt any
	isActive := true
	if archived {
		status = "archived"
		execStatus = "cancelled"
		archivedAt = now
		isActive = false
	}
	_, err := api.DB.Exec(r.Context(), `
		UPDATE task_sessions
		SET status=$1, execution_status=$2, archived_at=$3, updated_at=$4, last_activity_at=$4
		WHERE id=$5
	`, status, execStatus, archivedAt, now, sessionID)
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	_, _ = api.DB.Exec(r.Context(), `
		UPDATE project_tree_nodes
		SET is_active=$1, archived_at=$2, updated_at=$3
		WHERE id=$4
	`, isActive, archivedAt, now, treeNodeID)
	if !archived {
		_, _ = api.DB.Exec(r.Context(), `
			UPDATE task_sessions
			SET execution_status='complete', updated_at=$1
			WHERE task_id=$2 AND parent_session_id=$3 AND archived_at IS NULL
		`, now, taskID, sessionID)
	}
	if archived {
		web.JSON(w, http.StatusOK, map[string]any{"ok": true})
		return
	}
	web.JSON(w, http.StatusOK, map[string]any{"ok": true, "activatedSessionId": runtimeSessionID})
}

func resolveMessageID(ctx context.Context, api API, taskID, id string) string {
	var canonical string
	_ = api.DB.QueryRow(ctx, `SELECT id FROM task_messages WHERE task_id=$1 AND (id=$2 OR runtime_message_id=$2) ORDER BY created_at DESC LIMIT 1`, taskID, id).Scan(&canonical)
	return canonical
}

func firstTextPart(parts []map[string]any) string {
	for _, part := range parts {
		if text := stringMapValue(part, "text"); text != "" {
			return text
		}
	}
	return ""
}

func messageKind(role string) string {
	if role == "assistant" {
		return "reply"
	}
	return "prompt"
}

func normalizePartType(partType string) string {
	switch partType {
	case "text", "tool_call", "tool_result", "thinking", "file_reference", "diff":
		return partType
	case "tool":
		return "tool_result"
	default:
		return "text"
	}
}

func stringValue(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}

func mapValue(parent map[string]any, key string) map[string]any {
	if parent == nil {
		return map[string]any{}
	}
	if value, ok := parent[key].(map[string]any); ok {
		return value
	}
	return map[string]any{}
}

func arrayMapValue(parent map[string]any, key string) []map[string]any {
	raw, ok := parent[key].([]any)
	if !ok {
		return []map[string]any{}
	}
	out := make([]map[string]any, 0, len(raw))
	for _, item := range raw {
		if mapped, ok := item.(map[string]any); ok {
			out = append(out, mapped)
		}
	}
	return out
}

func stringMapValue(parent map[string]any, key string) string {
	if parent == nil {
		return ""
	}
	if value, ok := parent[key].(string); ok {
		return value
	}
	return ""
}

func routeSessionID(r *http.Request) string {
	raw := chi.URLParam(r, "sessionId")
	if decoded, err := url.PathUnescape(raw); err == nil {
		return decoded
	}
	return raw
}

type taskCanonicalMessage struct {
	ID               string
	TaskID           string
	SessionID        string
	Role             string
	Status           string
	ClientMessageID  *string
	RuntimeMessageID *string
	Seq              int
	TextContent      *string
	CreatedAt        time.Time
	CompletedAt      *time.Time
}

type taskCanonicalOperation struct {
	ID     string
	Kind   string
	Status string
}

func (api API) readCanonicalOperation(ctx context.Context, taskID, sessionID, clientMessageID string) (*taskCanonicalOperation, error) {
	operationID := "session-operation:" + taskID + ":model-request:" + clientMessageID
	var op taskCanonicalOperation
	err := api.DB.QueryRow(ctx, `SELECT id, operation_kind::text, status::text FROM task_operations WHERE id=$1 AND task_id=$2 AND session_id=$3`, operationID, taskID, sessionID).Scan(&op.ID, &op.Kind, &op.Status)
	if err != nil {
		return nil, err
	}
	return &op, nil
}

func canonicalMessageResponse(message taskCanonicalMessage, operation *taskCanonicalOperation) map[string]any {
	var op any
	if operation != nil {
		op = map[string]any{"id": operation.ID, "kind": operation.Kind, "status": operation.Status}
	}
	return map[string]any{
		"task_id":    message.TaskID,
		"session_id": message.SessionID,
		"user_message": map[string]any{
			"id": message.ID, "client_message_id": message.ClientMessageID, "role": message.Role,
			"status": message.Status, "text": message.TextContent, "message_index": message.Seq,
			"created_at": message.CreatedAt.UTC().Format(time.RFC3339Nano), "completed_at": web.NormalizeTime(message.CompletedAt),
		},
		"assistant_message": nil,
		"operation":         op,
	}
}

func (api API) readTaskSessionsByID(ctx context.Context, taskID string, sessionIDs []string) ([]map[string]any, error) {
	if len(sessionIDs) == 0 {
		return []map[string]any{}, nil
	}
	rows, err := api.DB.Query(ctx, `
		SELECT id, task_id, project_id, tree_node_id, parent_session_id, root_session_id, runtime_session_id,
		       branch_name, session_kind, execution_mode_snapshot, execution_status, status, session_type, candidate_index, selected_model,
		       created_at, updated_at, archived_at,
		       (SELECT runtime_session_id FROM task_sessions p WHERE p.id=task_sessions.parent_session_id) AS parent_runtime_session_id
		FROM task_sessions
		WHERE task_id=$1 AND id=ANY($2)
		ORDER BY created_at ASC
	`, taskID, sessionIDs)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []map[string]any{}
	for rows.Next() {
		var id, taskID, projectID, sessionKind, executionMode, executionStatus, status string
		var treeNodeID, parentSessionID, rootSessionID, runtimeSessionID, branchName, sourceType, parentRuntimeSessionID *string
		var candidateIndex *int
		var selectedModel *string
		var created, updated time.Time
		var archived *time.Time
		if err := rows.Scan(&id, &taskID, &projectID, &treeNodeID, &parentSessionID, &rootSessionID, &runtimeSessionID, &branchName, &sessionKind, &executionMode, &executionStatus, &status, &sourceType, &candidateIndex, &selectedModel, &created, &updated, &archived, &parentRuntimeSessionID); err != nil {
			return nil, err
		}
		items = append(items, map[string]any{
			"id": id, "taskId": taskID, "projectId": projectID, "treeNodeId": treeNodeID,
			"parentSessionId": parentSessionID, "rootSessionId": rootSessionID, "runtimeSessionId": runtimeSessionID,
			"branchName": branchName, "sessionKind": sessionKind, "executionModeSnapshot": executionMode,
			"sourceType": sourceType, "parentRuntimeSessionId": parentRuntimeSessionID,
			"candidateIndex": candidateIndex, "stepIndex": candidateIndex, "selectedModel": selectedModel,
			"executionStatus": executionStatus, "status": status, "createdAt": created.UTC().Format(time.RFC3339Nano),
			"updatedAt": updated.UTC().Format(time.RFC3339Nano), "archivedAt": web.NormalizeTime(archived),
		})
	}
	return items, rows.Err()
}

func (api API) readSessionMessageParts(ctx context.Context, sessionIDs []string) ([]map[string]any, error) {
	if len(sessionIDs) == 0 {
		return []map[string]any{}, nil
	}
	rows, err := api.DB.Query(ctx, `
		SELECT p.id, p.message_id, p.part_index, p.part_type::text, p.text_content, p.json_payload, p.created_at
		FROM task_message_parts p
		INNER JOIN task_messages m ON m.id=p.message_id
		WHERE m.session_id=ANY($1)
		ORDER BY m.seq, p.part_index
	`, sessionIDs)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []map[string]any{}
	for rows.Next() {
		var id, messageID, partType string
		var idx int
		var text *string
		var payload []byte
		var created time.Time
		if err := rows.Scan(&id, &messageID, &idx, &partType, &text, &payload, &created); err != nil {
			return nil, err
		}
		items = append(items, map[string]any{
			"id": id, "messageId": messageID, "partIndex": idx, "partType": partType,
			"textContent": text, "jsonPayload": scanJSONMap(payload), "createdAt": created.UTC().Format(time.RFC3339Nano),
		})
	}
	return items, rows.Err()
}

func (api API) lineageSessionIDs(ctx context.Context, taskID, sessionID string, includeLineage bool) ([]string, error) {
	if sessionID == "" {
		rows, err := api.DB.Query(ctx, `SELECT id FROM task_sessions WHERE task_id=$1 ORDER BY created_at ASC`, taskID)
		if err != nil {
			return nil, err
		}
		defer rows.Close()
		var ids []string
		for rows.Next() {
			var id string
			if err := rows.Scan(&id); err != nil {
				return nil, err
			}
			ids = append(ids, id)
		}
		return ids, rows.Err()
	}
	if !includeLineage {
		return []string{sessionID}, nil
	}
	rows, err := api.DB.Query(ctx, `
		WITH RECURSIVE lineage AS (
			SELECT id, parent_session_id, 0 AS depth FROM task_sessions WHERE id=$1 AND task_id=$2
			UNION ALL
			SELECT s.id, s.parent_session_id, l.depth + 1
			FROM task_sessions s
			JOIN lineage l ON l.parent_session_id = s.id
		)
		SELECT id FROM lineage ORDER BY depth DESC
	`, sessionID, taskID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if len(ids) == 0 {
		return nil, pgx.ErrNoRows
	}
	return ids, nil
}

func (api API) readSessionMessages(r *http.Request, taskID string, sessionIDs []string) ([]map[string]any, error) {
	rows, err := api.DB.Query(r.Context(), `
		SELECT m.id, m.session_id, m.runtime_message_id, m.client_message_id, m.role, m.status::text, m.text_content, m.raw_payload, m.seq, m.created_at,
		       COALESCE(jsonb_agg(jsonb_build_object(
		         'id', p.id, 'partIndex', p.part_index, 'partType', p.part_type, 'textContent', p.text_content, 'jsonPayload', p.json_payload
		       ) ORDER BY p.part_index) FILTER (WHERE p.id IS NOT NULL), '[]'::jsonb) AS parts
		FROM task_messages m
		LEFT JOIN task_message_parts p ON p.message_id=m.id
		WHERE m.task_id=$1 AND m.session_id = ANY($2::text[])
		GROUP BY m.id
		ORDER BY m.created_at ASC, m.seq ASC
	`, taskID, sessionIDs)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []map[string]any{}
	for rows.Next() {
		var id, sessionID, role, status string
		var runtimeMessageID, clientMessageID, textContent *string
		var rawPayload, parts []byte
		var seq int
		var created time.Time
		if err := rows.Scan(&id, &sessionID, &runtimeMessageID, &clientMessageID, &role, &status, &textContent, &rawPayload, &seq, &created, &parts); err != nil {
			return nil, err
		}
		items = append(items, map[string]any{
			"id": id, "sessionId": sessionID, "runtimeMessageId": runtimeMessageID, "role": role,
			"clientMessageId": clientMessageID, "status": status, "textContent": textContent, "rawPayload": scanJSONMap(rawPayload), "seq": seq,
			"parts": scanJSONArray(parts), "createdAt": created.UTC().Format(time.RFC3339Nano),
		})
	}
	return items, rows.Err()
}

func (api API) readTimelineItems(r *http.Request, taskID string, sessionIDs []string) ([]map[string]any, error) {
	rows, err := api.DB.Query(r.Context(), `
		SELECT id, session_id, message_id, item_kind, item_role, display_text, sort_at
		FROM task_timeline_views
		WHERE task_id=$1 AND session_id = ANY($2::text[])
		ORDER BY sort_at ASC, created_at ASC
	`, taskID, sessionIDs)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []map[string]any{}
	for rows.Next() {
		var id, sessionID, itemKind string
		var messageID, itemRole, displayText *string
		var sortAt time.Time
		if err := rows.Scan(&id, &sessionID, &messageID, &itemKind, &itemRole, &displayText, &sortAt); err != nil {
			return nil, err
		}
		items = append(items, map[string]any{
			"id": id, "sessionId": sessionID, "messageId": messageID, "itemKind": itemKind,
			"itemRole": itemRole, "displayText": displayText, "sortAt": sortAt.UTC().Format(time.RFC3339Nano),
		})
	}
	return items, rows.Err()
}

func scanJSONArray(value []byte) []any {
	if len(value) == 0 {
		return []any{}
	}
	var out []any
	_ = json.Unmarshal(value, &out)
	return out
}
