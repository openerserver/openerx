package modules

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	authpkg "openerx/control-plane/service-go/internal/auth"
	"openerx/control-plane/service-go/internal/web"
)

func (api API) WorkbenchRoutes(r chi.Router) {
	r.Get("/layout", api.getWorkbenchLayout)
	r.Put("/layout", api.putWorkbenchLayout)
}

func (api API) ApprovalRoutes(r chi.Router) {
	r.Get("/", api.listApprovalTickets)
	r.Get("/{ticketId}", api.getApprovalTicket)
	r.Post("/{ticketId}/resolve", api.resolveApprovalTicket)
}

func (api API) GovernanceRoutes(r chi.Router) {
	r.Post("/evaluate/{changeId}", api.evaluateGovernanceChange)
	r.Get("/tasks/{taskId}/summary", api.taskGovernanceSummary)
}

func (api API) getWorkbenchLayout(w http.ResponseWriter, r *http.Request) {
	user := authpkg.User(r)
	if user == nil {
		web.Error(w, http.StatusUnauthorized, "Authentication required")
		return
	}
	var raw string
	err := api.DB.QueryRow(r.Context(), `SELECT layout_json FROM workbench_layouts WHERE user_id=$1`, user.Sub).Scan(&raw)
	if err == pgx.ErrNoRows {
		web.JSON(w, http.StatusOK, map[string]any{"data": map[string]any{}})
		return
	}
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	var layout map[string]any
	if err := json.Unmarshal([]byte(raw), &layout); err != nil {
		layout = map[string]any{}
	}
	web.JSON(w, http.StatusOK, map[string]any{"data": layout})
}

func (api API) putWorkbenchLayout(w http.ResponseWriter, r *http.Request) {
	user := authpkg.User(r)
	if user == nil {
		web.Error(w, http.StatusUnauthorized, "Authentication required")
		return
	}
	var body map[string]any
	if !decodeBody(w, r, &body) {
		return
	}
	raw, _ := json.Marshal(body)
	now := time.Now().UTC()
	_, err := api.DB.Exec(r.Context(), `
		INSERT INTO workbench_layouts (user_id, layout_json, updated_at)
		VALUES ($1,$2,$3)
		ON CONFLICT (user_id) DO UPDATE SET layout_json=EXCLUDED.layout_json, updated_at=EXCLUDED.updated_at
	`, user.Sub, string(raw), now)
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	web.JSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (api API) listApprovalTickets(w http.ResponseWriter, r *http.Request) {
	status := r.URL.Query().Get("status")
	if status != "" && status != "pending" && status != "approved" && status != "rejected" && status != "expired" {
		web.Error(w, http.StatusBadRequest, "Invalid approval status")
		return
	}
	rows, err := api.DB.Query(r.Context(), `
		SELECT id, task_id, agent_run_id, action_type, risk_level, status, request_detail,
		       approver, comment, created_at, resolved_at, expires_at
		FROM approval_tickets
		WHERE ($1::text IS NULL OR status::text=$1)
		ORDER BY created_at DESC
	`, nullString(status))
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	defer rows.Close()
	items := []map[string]any{}
	for rows.Next() {
		item, err := scanApprovalTicket(rows)
		if err != nil {
			web.Error(w, http.StatusInternalServerError, err.Error())
			return
		}
		items = append(items, item)
	}
	web.JSON(w, http.StatusOK, items)
}

func (api API) getApprovalTicket(w http.ResponseWriter, r *http.Request) {
	item, err := api.loadApprovalTicket(r, chi.URLParam(r, "ticketId"))
	if err == pgx.ErrNoRows {
		web.Error(w, http.StatusNotFound, "Approval ticket not found")
		return
	}
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	web.JSON(w, http.StatusOK, item)
}

func (api API) resolveApprovalTicket(w http.ResponseWriter, r *http.Request) {
	user := authpkg.User(r)
	var body struct {
		Action  string  `json:"action"`
		Comment *string `json:"comment"`
	}
	if !decodeBody(w, r, &body) {
		return
	}
	if body.Action != "approve" && body.Action != "reject" {
		web.Error(w, http.StatusBadRequest, "Invalid approval action")
		return
	}
	ticketID := chi.URLParam(r, "ticketId")
	ticket, err := api.loadApprovalTicket(r, ticketID)
	if err == pgx.ErrNoRows {
		web.Error(w, http.StatusNotFound, "Approval ticket not found")
		return
	}
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	status, _ := ticket["status"].(string)
	if status != "pending" {
		web.Error(w, http.StatusConflict, "Ticket already "+status)
		return
	}
	if expiresAt, ok := ticket["expiresAt"].(string); ok {
		if parsed, err := time.Parse(time.RFC3339Nano, expiresAt); err == nil && parsed.Before(time.Now()) {
			_, _ = api.DB.Exec(r.Context(), `UPDATE approval_tickets SET status='expired', resolved_at=$1 WHERE id=$2`, time.Now().UTC(), ticketID)
			web.Error(w, http.StatusGone, "Ticket has expired")
			return
		}
	}
	nextStatus := "rejected"
	if body.Action == "approve" {
		nextStatus = "approved"
	}
	approver := ""
	if user != nil {
		approver = user.Sub
	}
	now := time.Now().UTC()
	_, err = api.DB.Exec(r.Context(), `
		UPDATE approval_tickets SET status=$1, approver=$2, comment=$3, resolved_at=$4 WHERE id=$5
	`, nextStatus, approver, body.Comment, now, ticketID)
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	_ = api.recordAudit(r.Context(), auditInput{
		UserID: approver, TaskID: stringFromAny(ticket["taskId"]), AgentRunID: stringFromAny(ticket["agentRunId"]),
		EventType: "approval", Action: nextStatus, Target: ticketID,
		Detail:    map[string]any{"comment": body.Comment, "actionType": ticket["actionType"], "riskLevel": ticket["riskLevel"]},
		RiskLevel: stringFromAny(ticket["riskLevel"]),
	})
	web.JSON(w, http.StatusOK, map[string]any{"id": ticketID, "status": nextStatus, "approver": approver, "comment": body.Comment})
}

func (api API) loadApprovalTicket(r *http.Request, ticketID string) (map[string]any, error) {
	return scanApprovalTicket(api.DB.QueryRow(r.Context(), `
		SELECT id, task_id, agent_run_id, action_type, risk_level, status, request_detail,
		       approver, comment, created_at, resolved_at, expires_at
		FROM approval_tickets WHERE id=$1
	`, ticketID))
}

type approvalTicketScanner interface {
	Scan(dest ...any) error
}

func scanApprovalTicket(row approvalTicketScanner) (map[string]any, error) {
	var id, taskID, actionType, riskLevel, status string
	var agentRunID, approver, comment *string
	var requestDetail []byte
	var createdAt, expiresAt time.Time
	var resolvedAt *time.Time
	if err := row.Scan(&id, &taskID, &agentRunID, &actionType, &riskLevel, &status, &requestDetail, &approver, &comment, &createdAt, &resolvedAt, &expiresAt); err != nil {
		return nil, err
	}
	return map[string]any{
		"id": id, "taskId": taskID, "agentRunId": agentRunID, "actionType": actionType,
		"riskLevel": riskLevel, "status": status, "requestDetail": scanJSONMap(requestDetail),
		"approver": approver, "comment": comment, "createdAt": formatRuntimeTime(&createdAt),
		"resolvedAt": formatRuntimeTime(resolvedAt), "expiresAt": formatRuntimeTime(&expiresAt),
	}, nil
}

func (api API) getTaskOperatingRuntimeMode(w http.ResponseWriter, r *http.Request) {
	taskID := chi.URLParam(r, "taskId")
	if ok, err := api.taskExists(r.Context(), taskID); err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	} else if !ok {
		web.Error(w, http.StatusNotFound, "Task not found")
		return
	}
	item, err := api.loadTaskOperatingMode(r, taskID)
	if err == pgx.ErrNoRows {
		web.JSON(w, http.StatusOK, map[string]any{"data": nil})
		return
	}
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	web.JSON(w, http.StatusOK, map[string]any{"data": item})
}

func (api API) putTaskOperatingRuntimeMode(w http.ResponseWriter, r *http.Request) {
	taskID := chi.URLParam(r, "taskId")
	if ok, err := api.taskExists(r.Context(), taskID); err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	} else if !ok {
		web.Error(w, http.StatusNotFound, "Task not found")
		return
	}
	var body struct {
		CollaborationMode     string  `json:"collaborationMode"`
		AutopilotLevel        string  `json:"autopilotLevel"`
		BossParticipationMode string  `json:"bossParticipationMode"`
		SelectedTemplateID    *string `json:"selectedTemplateId"`
		ScenarioKey           *string `json:"scenarioKey"`
		Source                string  `json:"source"`
	}
	if !decodeBody(w, r, &body) {
		return
	}
	if body.CollaborationMode == "" || body.AutopilotLevel == "" || body.BossParticipationMode == "" || body.Source == "" {
		web.Error(w, http.StatusBadRequest, "Invalid operating mode")
		return
	}
	now := time.Now().UTC()
	_, err := api.DB.Exec(r.Context(), `
		INSERT INTO task_operating_modes (
			task_id, collaboration_mode, autopilot_level, boss_participation_mode,
			selected_template_id, scenario_key, source, created_at, updated_at
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8)
		ON CONFLICT (task_id) DO UPDATE SET
			collaboration_mode=EXCLUDED.collaboration_mode,
			autopilot_level=EXCLUDED.autopilot_level,
			boss_participation_mode=EXCLUDED.boss_participation_mode,
			selected_template_id=EXCLUDED.selected_template_id,
			scenario_key=EXCLUDED.scenario_key,
			source=EXCLUDED.source,
			updated_at=EXCLUDED.updated_at
	`, taskID, body.CollaborationMode, body.AutopilotLevel, body.BossParticipationMode, body.SelectedTemplateID, body.ScenarioKey, body.Source, now)
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	item, err := api.loadTaskOperatingMode(r, taskID)
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	web.JSON(w, http.StatusOK, map[string]any{"ok": true, "data": item})
}

func (api API) deleteTaskOperatingRuntimeMode(w http.ResponseWriter, r *http.Request) {
	taskID := chi.URLParam(r, "taskId")
	if ok, err := api.taskExists(r.Context(), taskID); err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	} else if !ok {
		web.Error(w, http.StatusNotFound, "Task not found")
		return
	}
	if _, err := api.DB.Exec(r.Context(), `DELETE FROM task_operating_modes WHERE task_id=$1`, taskID); err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	web.JSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (api API) loadTaskOperatingMode(r *http.Request, taskID string) (map[string]any, error) {
	var collaborationMode, autopilotLevel, bossParticipationMode, source string
	var selectedTemplateID, scenarioKey *string
	if err := api.DB.QueryRow(r.Context(), `
		SELECT collaboration_mode, autopilot_level, boss_participation_mode, selected_template_id, scenario_key, source
		FROM task_operating_modes WHERE task_id=$1
	`, taskID).Scan(&collaborationMode, &autopilotLevel, &bossParticipationMode, &selectedTemplateID, &scenarioKey, &source); err != nil {
		return nil, err
	}
	return map[string]any{
		"collaborationMode": collaborationMode, "autopilotLevel": autopilotLevel,
		"bossParticipationMode": bossParticipationMode, "selectedTemplateId": selectedTemplateID,
		"scenarioKey": scenarioKey, "source": source,
	}, nil
}

func (api API) listTaskBossDecisions(w http.ResponseWriter, r *http.Request) {
	taskID := chi.URLParam(r, "taskId")
	if ok, err := api.taskExists(r.Context(), taskID); err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	} else if !ok {
		web.Error(w, http.StatusNotFound, "Task not found")
		return
	}
	rows, err := api.DB.Query(r.Context(), `
		SELECT id, ts, decision_type, reason, confidence, stage_key, metadata_json
		FROM boss_decisions WHERE task_id=$1 ORDER BY ts DESC, created_at DESC
	`, taskID)
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	defer rows.Close()
	items := []map[string]any{}
	for rows.Next() {
		var id, decisionType, reason string
		var ts time.Time
		var confidence *float64
		var stageKey *string
		var metadata []byte
		if err := rows.Scan(&id, &ts, &decisionType, &reason, &confidence, &stageKey, &metadata); err != nil {
			web.Error(w, http.StatusInternalServerError, err.Error())
			return
		}
		items = append(items, map[string]any{"id": id, "ts": formatRuntimeTime(&ts), "decisionType": decisionType, "reason": reason, "confidence": confidence, "stageKey": stageKey, "metadata": scanJSONMap(metadata)})
	}
	web.JSON(w, http.StatusOK, map[string]any{"data": items})
}

func (api API) createTaskBossDecision(w http.ResponseWriter, r *http.Request) {
	taskID := chi.URLParam(r, "taskId")
	if ok, err := api.taskExists(r.Context(), taskID); err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	} else if !ok {
		web.Error(w, http.StatusNotFound, "Task not found")
		return
	}
	var body struct {
		TS           *string        `json:"ts"`
		DecisionType string         `json:"decisionType"`
		Reason       string         `json:"reason"`
		Confidence   *float64       `json:"confidence"`
		StageKey     *string        `json:"stageKey"`
		Metadata     map[string]any `json:"metadata"`
	}
	if !decodeBody(w, r, &body) {
		return
	}
	if body.DecisionType == "" || body.Reason == "" {
		web.Error(w, http.StatusBadRequest, "decisionType and reason are required")
		return
	}
	ts := parseRuntimeTimeOrFallback(body.TS, time.Now().UTC())
	id := uuid.NewString()
	_, err := api.DB.Exec(r.Context(), `
		INSERT INTO boss_decisions (id, task_id, ts, decision_type, reason, confidence, stage_key, metadata_json, created_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
	`, id, taskID, ts, body.DecisionType, body.Reason, body.Confidence, body.StageKey, jsonOrNull(body.Metadata), time.Now().UTC())
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	web.JSON(w, http.StatusCreated, map[string]any{"ok": true, "data": map[string]any{"id": id, "ts": formatRuntimeTime(&ts), "decisionType": body.DecisionType, "reason": body.Reason, "confidence": body.Confidence, "stageKey": body.StageKey, "metadata": body.Metadata}})
}

func (api API) listTaskHumanEscalations(w http.ResponseWriter, r *http.Request) {
	taskID := chi.URLParam(r, "taskId")
	if ok, err := api.taskExists(r.Context(), taskID); err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	} else if !ok {
		web.Error(w, http.StatusNotFound, "Task not found")
		return
	}
	rows, err := api.DB.Query(r.Context(), `
		SELECT id, ts, reason, status, stage_key, requested_by, metadata_json
		FROM human_escalations WHERE task_id=$1 ORDER BY ts DESC, created_at DESC
	`, taskID)
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	defer rows.Close()
	items := []map[string]any{}
	for rows.Next() {
		var id, reason string
		var ts time.Time
		var status, stageKey, requestedBy *string
		var metadata []byte
		if err := rows.Scan(&id, &ts, &reason, &status, &stageKey, &requestedBy, &metadata); err != nil {
			web.Error(w, http.StatusInternalServerError, err.Error())
			return
		}
		items = append(items, map[string]any{"id": id, "ts": formatRuntimeTime(&ts), "reason": reason, "status": status, "stageKey": stageKey, "requestedBy": requestedBy, "metadata": scanJSONMap(metadata)})
	}
	web.JSON(w, http.StatusOK, map[string]any{"data": items})
}

func (api API) createTaskHumanEscalation(w http.ResponseWriter, r *http.Request) {
	taskID := chi.URLParam(r, "taskId")
	if ok, err := api.taskExists(r.Context(), taskID); err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	} else if !ok {
		web.Error(w, http.StatusNotFound, "Task not found")
		return
	}
	var body struct {
		TS          *string        `json:"ts"`
		Reason      string         `json:"reason"`
		Status      *string        `json:"status"`
		StageKey    *string        `json:"stageKey"`
		RequestedBy *string        `json:"requestedBy"`
		Metadata    map[string]any `json:"metadata"`
	}
	if !decodeBody(w, r, &body) {
		return
	}
	if body.Reason == "" {
		web.Error(w, http.StatusBadRequest, "reason is required")
		return
	}
	ts := parseRuntimeTimeOrFallback(body.TS, time.Now().UTC())
	id := uuid.NewString()
	_, err := api.DB.Exec(r.Context(), `
		INSERT INTO human_escalations (id, task_id, ts, reason, status, stage_key, requested_by, metadata_json, created_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
	`, id, taskID, ts, body.Reason, body.Status, body.StageKey, body.RequestedBy, jsonOrNull(body.Metadata), time.Now().UTC())
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	web.JSON(w, http.StatusCreated, map[string]any{"ok": true, "data": map[string]any{"id": id, "ts": formatRuntimeTime(&ts), "reason": body.Reason, "status": body.Status, "stageKey": body.StageKey, "requestedBy": body.RequestedBy, "metadata": body.Metadata}})
}

func parseRuntimeTimeOrFallback(raw *string, fallback time.Time) time.Time {
	if raw == nil || *raw == "" {
		return fallback
	}
	for _, layout := range []string{time.RFC3339Nano, time.RFC3339} {
		if parsed, err := time.Parse(layout, *raw); err == nil {
			return parsed.UTC()
		}
	}
	return fallback
}

func stringFromAny(value any) string {
	switch v := value.(type) {
	case string:
		return v
	case *string:
		if v != nil {
			return *v
		}
	}
	return ""
}

func (api API) evaluateGovernanceChange(w http.ResponseWriter, r *http.Request) {
	changeID := chi.URLParam(r, "changeId")
	var taskID string
	if err := api.DB.QueryRow(r.Context(), `SELECT task_id FROM code_changes WHERE id=$1`, changeID).Scan(&taskID); err != nil {
		web.Error(w, http.StatusBadRequest, "Code change not found")
		return
	}
	summary, err := api.computeGovernanceSummary(r, taskID)
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	summary["changeId"] = changeID
	web.JSON(w, http.StatusOK, summary)
}

func (api API) taskGovernanceSummary(w http.ResponseWriter, r *http.Request) {
	summary, err := api.computeGovernanceSummary(r, chi.URLParam(r, "taskId"))
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	web.JSON(w, http.StatusOK, summary)
}

func (api API) computeGovernanceSummary(r *http.Request, taskID string) (map[string]any, error) {
	rows, err := api.DB.Query(r.Context(), `
		SELECT fc.file_path, fc.insertions, fc.deletions
		FROM file_changes fc
		JOIN code_changes cc ON cc.id=fc.change_id
		WHERE cc.task_id=$1
	`, taskID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	violations := []map[string]any{}
	totalFiles := 0
	totalLines := 0
	for rows.Next() {
		var path string
		var insertions, deletions int
		if err := rows.Scan(&path, &insertions, &deletions); err != nil {
			return nil, err
		}
		totalFiles++
		totalLines += insertions + deletions
		if insertions+deletions >= 500 {
			violations = append(violations, map[string]any{"ruleId": "large-change", "risk": "high", "message": "Large code change requires review", "filePath": path})
		}
	}
	risk := "low"
	if len(violations) > 0 {
		risk = "high"
	} else if totalFiles >= 10 || totalLines >= 200 {
		risk = "medium"
	}
	return map[string]any{"overallRisk": risk, "violations": violations, "approvalRequired": risk == "high" || risk == "critical"}, rows.Err()
}
