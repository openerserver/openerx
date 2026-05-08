package modules

import (
	"context"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"openerx/control-plane/service-go/internal/web"
)

type upsertTaskPhaseRequest struct {
	ID                  string  `json:"id"`
	PhaseIndex          *int    `json:"phaseIndex"`
	PhaseKind           string  `json:"phaseKind"`
	TriggerType         string  `json:"triggerType"`
	Status              string  `json:"status"`
	ParentPhaseID       *string `json:"parentPhaseId"`
	ResumedFromPhaseID  *string `json:"resumedFromPhaseId"`
	AnchorSessionID     *string `json:"anchorSessionId"`
	AnchorMessageID     *string `json:"anchorMessageId"`
	CandidateCount      *int    `json:"candidateCount"`
	WinnerSessionID     *string `json:"winnerSessionId"`
	JudgeSessionID      *string `json:"judgeSessionId"`
	RequestedModel      *string `json:"requestedModel"`
	EffectiveModel      *string `json:"effectiveModel"`
	ResultSummary       *string `json:"resultSummary"`
	ErrorText           *string `json:"errorText"`
	TerminalReason      *string `json:"terminalReason"`
	AwaitingAdoptionRaw *string `json:"awaitingAdoptionSince"`
}

func (api API) upsertTaskPhase(w http.ResponseWriter, r *http.Request) {
	taskID := chi.URLParam(r, "taskId")
	var body upsertTaskPhaseRequest
	if !decodeBody(w, r, &body) {
		return
	}
	phase, err := api.writeTaskPhase(r.Context(), taskID, body)
	if err != nil {
		if err == pgx.ErrNoRows {
			web.Error(w, http.StatusNotFound, "Task not found")
			return
		}
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	status := http.StatusCreated
	if phase["wasExisting"] == true {
		status = http.StatusOK
		delete(phase, "wasExisting")
	}
	web.JSON(w, status, phase)
}

func (api API) listTaskPhases(w http.ResponseWriter, r *http.Request) {
	taskID := chi.URLParam(r, "taskId")
	rows, err := api.DB.Query(r.Context(), `
		SELECT id, task_id, project_id, parent_phase_id, phase_index, phase_kind::text, trigger_type::text,
		       status::text, resumed_from_phase_id, awaiting_adoption_since, cancel_requested_at, cancelled_at,
		       terminal_reason::text, last_heartbeat_at, anchor_session_id, anchor_message_id, candidate_count,
		       winner_session_id, judge_session_id, requested_model, effective_model, result_summary, error_text,
		       started_at, finished_at, created_at, updated_at
		FROM task_execution_phases
		WHERE task_id=$1
		ORDER BY phase_index ASC, created_at ASC
	`, taskID)
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	defer rows.Close()
	items, err := scanTaskPhaseRows(rows)
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	web.JSON(w, http.StatusOK, map[string]any{"data": items, "meta": map[string]any{"readSource": "task-phase-first", "phaseCount": len(items)}})
}

func (api API) getTaskPhaseView(w http.ResponseWriter, r *http.Request) {
	taskID := chi.URLParam(r, "taskId")
	phaseID := chi.URLParam(r, "phaseId")
	phase, err := api.readTaskPhase(r.Context(), taskID, phaseID)
	if err != nil {
		web.Error(w, http.StatusNotFound, "Task phase not found")
		return
	}
	sessions, _ := api.readPhaseSessions(r.Context(), taskID, phaseID)
	web.JSON(w, http.StatusOK, map[string]any{
		"data": map[string]any{"phase": phase, "sessions": sessions},
		"meta": map[string]any{"readSource": "task-phase-first", "taskId": taskID, "phaseId": phaseID},
	})
}

func (api API) adoptTaskPhase(w http.ResponseWriter, r *http.Request) {
	api.transitionTaskPhase(w, r, "completed", "winner_adopted")
}

func (api API) pauseTaskPhase(w http.ResponseWriter, r *http.Request) {
	api.transitionTaskPhase(w, r, "paused", "")
}

func (api API) resumeTaskPhase(w http.ResponseWriter, r *http.Request) {
	api.transitionTaskPhase(w, r, "running", "")
}

func (api API) cancelTaskPhase(w http.ResponseWriter, r *http.Request) {
	api.transitionTaskPhase(w, r, "cancelled", "user_cancelled")
}

func (api API) transitionTaskPhase(w http.ResponseWriter, r *http.Request, status string, terminalReason string) {
	taskID := chi.URLParam(r, "taskId")
	phaseID := chi.URLParam(r, "phaseId")
	now := time.Now().UTC()
	var cancelledAt any
	if status == "cancelled" {
		cancelledAt = now
	}
	var finishedAt any
	if status == "completed" || status == "cancelled" || status == "failed" {
		finishedAt = now
	}
	tag, err := api.DB.Exec(r.Context(), `
		UPDATE task_execution_phases
		SET status=$1, terminal_reason=COALESCE($2, terminal_reason), cancelled_at=COALESCE($3, cancelled_at),
		    finished_at=COALESCE($4, finished_at), updated_at=$5
		WHERE id=$6 AND task_id=$7
	`, status, nullString(terminalReason), cancelledAt, finishedAt, now, phaseID, taskID)
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	if tag.RowsAffected() == 0 {
		web.Error(w, http.StatusNotFound, "Task phase not found")
		return
	}
	if status == "paused" {
		_, _ = api.DB.Exec(r.Context(), `UPDATE task_sessions SET status='running', execution_status='paused', updated_at=$1 WHERE task_id=$2 AND phase_id=$3`, now, taskID, phaseID)
	} else if status == "running" {
		_, _ = api.DB.Exec(r.Context(), `UPDATE task_sessions SET status='running', execution_status='running', updated_at=$1 WHERE task_id=$2 AND phase_id=$3`, now, taskID, phaseID)
	} else if status == "completed" {
		_, _ = api.DB.Exec(r.Context(), `UPDATE task_sessions SET status='completed', execution_status='complete', finished_at=COALESCE(finished_at,$1), updated_at=$1 WHERE task_id=$2 AND phase_id=$3`, now, taskID, phaseID)
	}
	_ = api.upsertTaskPhaseSnapshot(r.Context(), taskID, phaseID, status)
	phase, _ := api.readTaskPhase(r.Context(), taskID, phaseID)
	web.JSON(w, http.StatusOK, phase)
}

func (api API) writeTaskPhase(ctx context.Context, taskID string, body upsertTaskPhaseRequest) (map[string]any, error) {
	var projectID string
	if err := api.DB.QueryRow(ctx, `SELECT project_id FROM tasks WHERE id=$1`, taskID).Scan(&projectID); err != nil {
		return nil, err
	}
	phaseID := body.ID
	if phaseID == "" {
		phaseID = uuid.NewString()
	}
	phaseKind := body.PhaseKind
	if phaseKind == "" {
		phaseKind = "single"
	}
	triggerType := body.TriggerType
	if triggerType == "" {
		triggerType = "execute"
	}
	status := body.Status
	if status == "" {
		status = "running"
	}
	phaseIndex := 0
	if body.PhaseIndex != nil {
		phaseIndex = *body.PhaseIndex
	} else {
		_ = api.DB.QueryRow(ctx, `SELECT COALESCE(MAX(phase_index), -1) + 1 FROM task_execution_phases WHERE task_id=$1`, taskID).Scan(&phaseIndex)
	}
	now := time.Now().UTC()
	var existing string
	wasExisting := api.DB.QueryRow(ctx, `SELECT id FROM task_execution_phases WHERE id=$1 AND task_id=$2`, phaseID, taskID).Scan(&existing) == nil
	var awaitingAdoptionSince any
	if status == "awaiting_adoption" {
		awaitingAdoptionSince = now
		if body.AwaitingAdoptionRaw != nil && *body.AwaitingAdoptionRaw != "" {
			if parsed := parseOptionalTime(body.AwaitingAdoptionRaw); parsed != nil {
				awaitingAdoptionSince = parsed
			}
		}
	}
	var finishedAt any
	if status == "completed" || status == "failed" || status == "cancelled" {
		finishedAt = now
	}
	_, err := api.DB.Exec(ctx, `
		INSERT INTO task_execution_phases (
			id, task_id, project_id, parent_phase_id, phase_index, phase_kind, trigger_type, status,
			resumed_from_phase_id, awaiting_adoption_since, terminal_reason, anchor_session_id, anchor_message_id,
			candidate_count, winner_session_id, judge_session_id, requested_model, effective_model, result_summary,
			error_text, started_at, finished_at, created_at, updated_at
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$23)
		ON CONFLICT (id) DO UPDATE SET
			parent_phase_id=EXCLUDED.parent_phase_id,
			phase_kind=EXCLUDED.phase_kind,
			trigger_type=EXCLUDED.trigger_type,
			status=EXCLUDED.status,
			resumed_from_phase_id=EXCLUDED.resumed_from_phase_id,
			awaiting_adoption_since=COALESCE(task_execution_phases.awaiting_adoption_since, EXCLUDED.awaiting_adoption_since),
			terminal_reason=EXCLUDED.terminal_reason,
			anchor_session_id=EXCLUDED.anchor_session_id,
			anchor_message_id=EXCLUDED.anchor_message_id,
			candidate_count=EXCLUDED.candidate_count,
			winner_session_id=EXCLUDED.winner_session_id,
			judge_session_id=EXCLUDED.judge_session_id,
			requested_model=EXCLUDED.requested_model,
			effective_model=EXCLUDED.effective_model,
			result_summary=EXCLUDED.result_summary,
			error_text=EXCLUDED.error_text,
			finished_at=COALESCE(EXCLUDED.finished_at, task_execution_phases.finished_at),
			updated_at=EXCLUDED.updated_at
	`, phaseID, taskID, projectID, body.ParentPhaseID, phaseIndex, phaseKind, triggerType, status, body.ResumedFromPhaseID,
		awaitingAdoptionSince, body.TerminalReason, body.AnchorSessionID, body.AnchorMessageID, body.CandidateCount,
		body.WinnerSessionID, body.JudgeSessionID, body.RequestedModel, body.EffectiveModel, body.ResultSummary, body.ErrorText,
		now, finishedAt, now)
	if err != nil {
		return nil, err
	}
	if body.AnchorSessionID != nil && *body.AnchorSessionID != "" {
		_, _ = api.DB.Exec(ctx, `UPDATE task_sessions SET phase_id=$1, phase_role='anchor', updated_at=$2 WHERE task_id=$3 AND id=$4`, phaseID, now, taskID, *body.AnchorSessionID)
	}
	_ = api.upsertTaskPhaseSnapshot(ctx, taskID, phaseID, status)
	phase, err := api.readTaskPhase(ctx, taskID, phaseID)
	if phase != nil {
		phase["wasExisting"] = wasExisting
	}
	return phase, err
}

func (api API) upsertTaskPhaseSnapshot(ctx context.Context, taskID, phaseID, status string) error {
	lifecycle := "active"
	executionStatus := status
	if status == "completed" {
		lifecycle = "done"
		executionStatus = "complete"
	}
	if status == "cancelled" {
		lifecycle = "archived"
	}
	if status == "failed" {
		lifecycle = "done"
	}
	now := time.Now().UTC()
	var projectID string
	if err := api.DB.QueryRow(ctx, `SELECT project_id FROM tasks WHERE id=$1`, taskID).Scan(&projectID); err != nil {
		return err
	}
	_, err := api.DB.Exec(ctx, `
		INSERT INTO task_snapshots (
			task_id, project_id, lifecycle_status, current_execution_mode, current_execution_status,
			current_phase_id, latest_phase_id, active_candidate_count, last_activity_at, updated_at
		) VALUES ($1,$2,$3,'parallel',$4,$5,$5,0,$6,$6)
		ON CONFLICT (task_id) DO UPDATE SET
			lifecycle_status=EXCLUDED.lifecycle_status,
			current_execution_mode=EXCLUDED.current_execution_mode,
			current_execution_status=EXCLUDED.current_execution_status,
			current_phase_id=EXCLUDED.current_phase_id,
			latest_phase_id=EXCLUDED.latest_phase_id,
			updated_at=EXCLUDED.updated_at,
			last_activity_at=EXCLUDED.last_activity_at
	`, taskID, projectID, lifecycle, executionStatus, phaseID, now)
	return err
}

func (api API) readTaskPhase(ctx context.Context, taskID, phaseID string) (map[string]any, error) {
	rows, err := api.DB.Query(ctx, `
		SELECT id, task_id, project_id, parent_phase_id, phase_index, phase_kind::text, trigger_type::text,
		       status::text, resumed_from_phase_id, awaiting_adoption_since, cancel_requested_at, cancelled_at,
		       terminal_reason::text, last_heartbeat_at, anchor_session_id, anchor_message_id, candidate_count,
		       winner_session_id, judge_session_id, requested_model, effective_model, result_summary, error_text,
		       started_at, finished_at, created_at, updated_at
		FROM task_execution_phases
		WHERE task_id=$1 AND id=$2
	`, taskID, phaseID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items, err := scanTaskPhaseRows(rows)
	if err != nil {
		return nil, err
	}
	if len(items) == 0 {
		return nil, pgx.ErrNoRows
	}
	return items[0], nil
}

func scanTaskPhaseRows(rows pgx.Rows) ([]map[string]any, error) {
	items := []map[string]any{}
	for rows.Next() {
		var id, taskID, projectID, phaseKind, triggerType, status string
		var parentPhaseID, resumedFromPhaseID, terminalReason, anchorSessionID, anchorMessageID *string
		var winnerSessionID, judgeSessionID, requestedModel, effectiveModel, resultSummary, errorText *string
		var phaseIndex int
		var candidateCount *int
		var awaitingAdoptionSince, cancelRequestedAt, cancelledAt, lastHeartbeatAt, startedAt, finishedAt *time.Time
		var createdAt, updatedAt time.Time
		if err := rows.Scan(&id, &taskID, &projectID, &parentPhaseID, &phaseIndex, &phaseKind, &triggerType, &status,
			&resumedFromPhaseID, &awaitingAdoptionSince, &cancelRequestedAt, &cancelledAt, &terminalReason, &lastHeartbeatAt,
			&anchorSessionID, &anchorMessageID, &candidateCount, &winnerSessionID, &judgeSessionID, &requestedModel,
			&effectiveModel, &resultSummary, &errorText, &startedAt, &finishedAt, &createdAt, &updatedAt); err != nil {
			return nil, err
		}
		items = append(items, map[string]any{
			"id": id, "taskId": taskID, "projectId": projectID, "parentPhaseId": parentPhaseID,
			"phaseIndex": phaseIndex, "phaseKind": phaseKind, "triggerType": triggerType, "status": status,
			"resumedFromPhaseId": resumedFromPhaseID, "awaitingAdoptionSince": web.NormalizeTime(awaitingAdoptionSince),
			"cancelRequestedAt": web.NormalizeTime(cancelRequestedAt), "cancelledAt": web.NormalizeTime(cancelledAt),
			"terminalReason": terminalReason, "lastHeartbeatAt": web.NormalizeTime(lastHeartbeatAt),
			"anchorSessionId": anchorSessionID, "anchorMessageId": anchorMessageID, "candidateCount": candidateCount,
			"winnerSessionId": winnerSessionID, "judgeSessionId": judgeSessionID, "requestedModel": requestedModel,
			"effectiveModel": effectiveModel, "resultSummary": resultSummary, "errorText": errorText,
			"startedAt": web.NormalizeTime(startedAt), "finishedAt": web.NormalizeTime(finishedAt),
			"createdAt": createdAt.UTC().Format(time.RFC3339Nano), "updatedAt": updatedAt.UTC().Format(time.RFC3339Nano),
		})
	}
	return items, rows.Err()
}

func (api API) readPhaseSessions(ctx context.Context, taskID, phaseID string) ([]map[string]any, error) {
	rows, err := api.DB.Query(ctx, `SELECT id FROM task_sessions WHERE task_id=$1 AND phase_id=$2 ORDER BY created_at`, taskID, phaseID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	ids := []string{}
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
	return api.readTaskSessionsByID(ctx, taskID, ids)
}
