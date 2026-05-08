package modules

import (
	"context"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	authpkg "openerx/control-plane/service-go/internal/auth"
	"openerx/control-plane/service-go/internal/web"
)

type auditInput struct {
	UserID       string
	ProjectID    string
	SessionID    string
	TaskID       string
	AgentRunID   string
	EventType    string
	Action       string
	Target       string
	Detail       map[string]any
	RiskLevel    string
	TraceID      string
	CredentialID string
}

type createAuditRequest struct {
	ProjectID  string         `json:"projectId"`
	SessionID  string         `json:"sessionId"`
	TaskID     string         `json:"taskId"`
	AgentRunID string         `json:"agentRunId"`
	EventType  string         `json:"eventType"`
	Action     string         `json:"action"`
	Target     string         `json:"target"`
	Detail     map[string]any `json:"detail"`
	RiskLevel  string         `json:"riskLevel"`
	TraceID    string         `json:"traceId"`
}

func (api API) AuditRoutes(r chi.Router) {
	r.Use(func(next http.Handler) http.Handler { return requireRole("developer", next) })
	r.Get("/", api.listAudit)
	r.Get("/trace/{traceId}", api.auditTrace)
	r.Get("/{eventId}", api.getAudit)
	r.Post("/", api.createAudit)
}

func (api API) recordAudit(ctx context.Context, input auditInput) error {
	risk := input.RiskLevel
	if risk == "" {
		risk = "low"
	}
	detail, err := jsonBytes(input.Detail)
	if err != nil {
		return err
	}
	_, err = api.DB.Exec(ctx, `
		INSERT INTO audit_events (id, ts, user_id, project_id, session_id, task_id, agent_run_id, event_type, action, target, detail, risk_level, trace_id, credential_id)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
	`, uuid.NewString(), time.Now().UTC(), nullString(input.UserID), nullString(input.ProjectID), nullString(input.SessionID), nullString(input.TaskID), nullString(input.AgentRunID), input.EventType, input.Action, nullString(input.Target), detail, risk, nullString(input.TraceID), nullString(input.CredentialID))
	return err
}

func (api API) listAudit(w http.ResponseWriter, r *http.Request) {
	limit := parseLimit(r, 50, 500)
	offset := 0
	rows, err := api.DB.Query(r.Context(), `
		SELECT id, ts, user_id, project_id, session_id, task_id, agent_run_id, event_type, action, target, detail, risk_level, trace_id, credential_id, author_resolved_as
		FROM audit_events
		WHERE ($1::text IS NULL OR project_id=$1)
		  AND ($2::text IS NULL OR user_id=$2)
		  AND ($3::text IS NULL OR event_type=$3)
		ORDER BY ts DESC
		LIMIT $4 OFFSET $5
	`, nullString(r.URL.Query().Get("projectId")), nullString(r.URL.Query().Get("userId")), nullString(r.URL.Query().Get("type")), limit, offset)
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	defer rows.Close()
	items, err := scanAuditRows(rows)
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	web.JSON(w, http.StatusOK, map[string]any{"data": items, "limit": limit, "offset": offset})
}

func (api API) getAudit(w http.ResponseWriter, r *http.Request) {
	rows, err := api.DB.Query(r.Context(), `
		SELECT id, ts, user_id, project_id, session_id, task_id, agent_run_id, event_type, action, target, detail, risk_level, trace_id, credential_id, author_resolved_as
		FROM audit_events WHERE id=$1
	`, chi.URLParam(r, "eventId"))
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	defer rows.Close()
	items, err := scanAuditRows(rows)
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	if len(items) == 0 {
		web.Error(w, http.StatusNotFound, "Audit event not found")
		return
	}
	web.JSON(w, http.StatusOK, items[0])
}

func (api API) auditTrace(w http.ResponseWriter, r *http.Request) {
	rows, err := api.DB.Query(r.Context(), `
		SELECT id, ts, user_id, project_id, session_id, task_id, agent_run_id, event_type, action, target, detail, risk_level, trace_id, credential_id, author_resolved_as
		FROM audit_events WHERE trace_id=$1 ORDER BY ts
	`, chi.URLParam(r, "traceId"))
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	defer rows.Close()
	items, err := scanAuditRows(rows)
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	web.JSON(w, http.StatusOK, items)
}

func (api API) createAudit(w http.ResponseWriter, r *http.Request) {
	user := authpkg.User(r)
	if user.Role != "platform_admin" && user.Role != "org_admin" && user.Role != "admin" {
		web.Error(w, http.StatusForbidden, "Requires org_admin role")
		return
	}
	var body createAuditRequest
	if !decodeBody(w, r, &body) {
		return
	}
	if body.EventType == "" || body.Action == "" {
		web.Error(w, http.StatusBadRequest, "eventType and action are required")
		return
	}
	err := api.recordAudit(r.Context(), auditInput{
		UserID: user.Sub, ProjectID: body.ProjectID, SessionID: body.SessionID, TaskID: body.TaskID, AgentRunID: body.AgentRunID,
		EventType: body.EventType, Action: body.Action, Target: body.Target, Detail: body.Detail, RiskLevel: body.RiskLevel, TraceID: body.TraceID,
	})
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	web.JSON(w, http.StatusCreated, map[string]any{"ok": true})
}

func scanAuditRows(rows interface {
	Next() bool
	Scan(...any) error
	Err() error
}) ([]map[string]any, error) {
	var items []map[string]any
	for rows.Next() {
		var id, eventType, action string
		var ts time.Time
		var userID, projectID, sessionID, taskID, agentRunID, target, risk, traceID, credentialID, authorResolvedAs *string
		var detail []byte
		if err := rows.Scan(&id, &ts, &userID, &projectID, &sessionID, &taskID, &agentRunID, &eventType, &action, &target, &detail, &risk, &traceID, &credentialID, &authorResolvedAs); err != nil {
			return nil, err
		}
		items = append(items, map[string]any{
			"id": id, "ts": ts.UTC().Format(time.RFC3339Nano), "userId": userID, "projectId": projectID, "sessionId": sessionID,
			"taskId": taskID, "agentRunId": agentRunID, "eventType": eventType, "action": action, "target": target,
			"detail": scanJSONMap(detail), "riskLevel": risk, "traceId": traceID, "credentialId": credentialID, "authorResolvedAs": authorResolvedAs,
		})
	}
	return items, rows.Err()
}

func nullString(value string) any {
	if value == "" {
		return nil
	}
	return value
}
