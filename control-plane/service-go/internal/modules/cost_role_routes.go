package modules

import (
	"context"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	authpkg "openerx/control-plane/service-go/internal/auth"
	"openerx/control-plane/service-go/internal/web"
)

type createCostRecordRequest struct {
	ProjectID    string  `json:"projectId"`
	SessionID    *string `json:"sessionId"`
	TaskID       *string `json:"taskId"`
	AgentRunID   *string `json:"agentRunId"`
	ModelID      string  `json:"modelId"`
	ProviderID   string  `json:"providerId"`
	InputTokens  int     `json:"inputTokens"`
	OutputTokens int     `json:"outputTokens"`
	Cost         float64 `json:"cost"`
	BudgetPeriod *string `json:"budgetPeriod"`
}

func (api API) CostRoutes(r chi.Router) {
	r.Get("/budget", api.listBudgetConfigs)
	r.Post("/budget", api.createBudgetConfig)
	r.Patch("/budget/{budgetId}", api.updateBudgetConfig)
	r.Post("/records", api.createCostRecord)
	r.Get("/detail", api.costDetail)
}

func (api API) listBudgetConfigs(w http.ResponseWriter, r *http.Request) {
	projectID := r.URL.Query().Get("projectId")
	if projectID == "" {
		web.Error(w, http.StatusBadRequest, "projectId query param required")
		return
	}
	rows, err := api.DB.Query(r.Context(), `
		SELECT bc.id, bc.period, bc.limit_amount, bc.warn_threshold, bc.throttle_threshold,
		       COALESCE(SUM(cr.cost), 0)::float8 AS current_spend
		FROM budget_configs bc
		LEFT JOIN cost_records cr ON cr.project_id=bc.project_id
		WHERE bc.project_id=$1
		GROUP BY bc.id, bc.period, bc.limit_amount, bc.warn_threshold, bc.throttle_threshold, bc.created_at
		ORDER BY bc.created_at DESC
	`, projectID)
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	defer rows.Close()
	items := []map[string]any{}
	for rows.Next() {
		var id, period string
		var limit, warn, throttle, currentSpend float64
		if err := rows.Scan(&id, &period, &limit, &warn, &throttle, &currentSpend); err != nil {
			web.Error(w, http.StatusInternalServerError, err.Error())
			return
		}
		usage := 0.0
		if limit > 0 {
			usage = currentSpend / limit * 100
		}
		status := "ok"
		ratio := 0.0
		if limit > 0 {
			ratio = currentSpend / limit
		}
		switch {
		case ratio >= 1:
			status = "blocked"
		case ratio >= throttle:
			status = "throttle"
		case ratio >= warn:
			status = "warn"
		}
		items = append(items, map[string]any{
			"id": id, "period": period, "limit": limit, "currentSpend": currentSpend,
			"usage": usage, "status": status, "warnThreshold": warn, "throttleThreshold": throttle,
		})
	}
	web.JSON(w, http.StatusOK, items)
}

func (api API) createBudgetConfig(w http.ResponseWriter, r *http.Request) {
	var body struct {
		ProjectID         string  `json:"projectId"`
		Period            string  `json:"period"`
		LimitAmount       float64 `json:"limitAmount"`
		WarnThreshold     float64 `json:"warnThreshold"`
		ThrottleThreshold float64 `json:"throttleThreshold"`
	}
	if !decodeBody(w, r, &body) {
		return
	}
	if body.Period == "" {
		body.Period = "monthly"
	}
	if body.WarnThreshold == 0 {
		body.WarnThreshold = 0.8
	}
	if body.ThrottleThreshold == 0 {
		body.ThrottleThreshold = 0.95
	}
	id := uuid.NewString()
	now := time.Now().UTC()
	_, err := api.DB.Exec(r.Context(), `INSERT INTO budget_configs (id, project_id, period, limit_amount, warn_threshold, throttle_threshold, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)`, id, body.ProjectID, body.Period, body.LimitAmount, body.WarnThreshold, body.ThrottleThreshold, now)
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	web.JSON(w, http.StatusCreated, map[string]any{"id": id, "projectId": body.ProjectID, "period": body.Period, "limitAmount": body.LimitAmount, "warnThreshold": body.WarnThreshold, "throttleThreshold": body.ThrottleThreshold, "createdAt": formatRuntimeTime(&now)})
}

func (api API) updateBudgetConfig(w http.ResponseWriter, r *http.Request) {
	budgetID := chi.URLParam(r, "budgetId")
	var existing struct {
		ProjectID         string
		Period            string
		LimitAmount       float64
		WarnThreshold     float64
		ThrottleThreshold float64
	}
	err := api.DB.QueryRow(r.Context(), `SELECT project_id, period, limit_amount, warn_threshold, throttle_threshold FROM budget_configs WHERE id=$1`, budgetID).Scan(&existing.ProjectID, &existing.Period, &existing.LimitAmount, &existing.WarnThreshold, &existing.ThrottleThreshold)
	if err == pgx.ErrNoRows {
		web.Error(w, http.StatusNotFound, "Budget config not found")
		return
	}
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	var body struct {
		Period            *string  `json:"period"`
		LimitAmount       *float64 `json:"limitAmount"`
		WarnThreshold     *float64 `json:"warnThreshold"`
		ThrottleThreshold *float64 `json:"throttleThreshold"`
	}
	if !decodeBody(w, r, &body) {
		return
	}
	_, err = api.DB.Exec(r.Context(), `
		UPDATE budget_configs SET
			period=COALESCE($1,period),
			limit_amount=COALESCE($2,limit_amount),
			warn_threshold=COALESCE($3,warn_threshold),
			throttle_threshold=COALESCE($4,throttle_threshold)
		WHERE id=$5
	`, body.Period, body.LimitAmount, body.WarnThreshold, body.ThrottleThreshold, budgetID)
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	period := existing.Period
	limit := existing.LimitAmount
	warn := existing.WarnThreshold
	throttle := existing.ThrottleThreshold
	if body.Period != nil {
		period = *body.Period
	}
	if body.LimitAmount != nil {
		limit = *body.LimitAmount
	}
	if body.WarnThreshold != nil {
		warn = *body.WarnThreshold
	}
	if body.ThrottleThreshold != nil {
		throttle = *body.ThrottleThreshold
	}
	web.JSON(w, http.StatusOK, map[string]any{"id": budgetID, "projectId": existing.ProjectID, "period": period, "limitAmount": limit, "warnThreshold": warn, "throttleThreshold": throttle})
}

func (api API) createCostRecord(w http.ResponseWriter, r *http.Request) {
	user := authpkg.User(r)
	var body createCostRecordRequest
	if !decodeBody(w, r, &body) {
		return
	}
	id := uuid.NewString()
	now := time.Now().UTC()
	_, err := api.DB.Exec(r.Context(), `
		INSERT INTO cost_records (
			id, ts, project_id, user_id, session_id, task_id, agent_run_id, model_id, provider_id,
			input_tokens, output_tokens, cost, budget_period
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
	`, id, now, body.ProjectID, user.Sub, body.SessionID, body.TaskID, body.AgentRunID, body.ModelID, body.ProviderID, body.InputTokens, body.OutputTokens, body.Cost, body.BudgetPeriod)
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	web.JSON(w, http.StatusCreated, map[string]any{"id": id, "ts": formatRuntimeTime(&now), "projectId": body.ProjectID, "taskId": body.TaskID})
}

func (api API) costDetail(w http.ResponseWriter, r *http.Request) {
	taskID := r.URL.Query().Get("taskId")
	rows, err := api.DB.Query(r.Context(), `
		SELECT id, ts, project_id, task_id, model_id, provider_id, input_tokens, output_tokens, cost, budget_period
		FROM cost_records
		WHERE ($1::text IS NULL OR task_id=$1)
		ORDER BY ts DESC
	`, nullString(taskID))
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	defer rows.Close()
	items := []map[string]any{}
	for rows.Next() {
		var id, projectID, modelID, providerID string
		var taskIDPtr, budgetPeriod *string
		var ts time.Time
		var input, output int
		var cost float64
		if err := rows.Scan(&id, &ts, &projectID, &taskIDPtr, &modelID, &providerID, &input, &output, &cost, &budgetPeriod); err != nil {
			web.Error(w, http.StatusInternalServerError, err.Error())
			return
		}
		items = append(items, map[string]any{"id": id, "ts": formatRuntimeTime(&ts), "projectId": projectID, "taskId": taskIDPtr, "modelId": modelID, "providerId": providerID, "inputTokens": input, "outputTokens": output, "cost": cost, "budgetPeriod": budgetPeriod})
	}
	web.JSON(w, http.StatusOK, map[string]any{"taskId": taskID, "records": items})
}

type roleAgentRequest struct {
	ID                       string   `json:"id"`
	ProjectID                *string  `json:"projectId"`
	Name                     string   `json:"name"`
	Description              *string  `json:"description"`
	Scope                    string   `json:"scope"`
	Status                   string   `json:"status"`
	OwnerTeam                *string  `json:"ownerTeam"`
	PermissionProfile        string   `json:"permissionProfile"`
	ToolProfile              string   `json:"toolProfile"`
	DefaultExecutionMode     string   `json:"defaultExecutionMode"`
	AggregationStrategy      *string  `json:"aggregationStrategy"`
	MaxActiveBindings        *int     `json:"maxActiveBindings"`
	RequireConsensus         bool     `json:"requireConsensus"`
	RiskLevel                string   `json:"riskLevel"`
	RequiresApprovalForWrite bool     `json:"requiresApprovalForWrite"`
	AllowedStages            []string `json:"allowedStages"`
	OutputSchemaID           *string  `json:"outputSchemaId"`
	Tags                     []string `json:"tags"`
}

type roleAgentBindingRequest struct {
	ProjectID    *string  `json:"projectId"`
	BindingKey   string   `json:"bindingKey"`
	RuntimeAgent string   `json:"runtimeAgent"`
	Label        string   `json:"label"`
	Enabled      bool     `json:"enabled"`
	Priority     int      `json:"priority"`
	Model        *string  `json:"model"`
	Tags         []string `json:"tags"`
}

type roleAgentOverrideRequest struct {
	Name                     *string  `json:"name"`
	Description              *string  `json:"description"`
	Status                   *string  `json:"status"`
	OwnerTeam                *string  `json:"ownerTeam"`
	PermissionProfile        *string  `json:"permissionProfile"`
	ToolProfile              *string  `json:"toolProfile"`
	DefaultExecutionMode     *string  `json:"defaultExecutionMode"`
	AggregationStrategy      *string  `json:"aggregationStrategy"`
	MaxActiveBindings        *int     `json:"maxActiveBindings"`
	RequireConsensus         *bool    `json:"requireConsensus"`
	RiskLevel                *string  `json:"riskLevel"`
	RequiresApprovalForWrite *bool    `json:"requiresApprovalForWrite"`
	AllowedStages            []string `json:"allowedStages"`
	OutputSchemaID           *string  `json:"outputSchemaId"`
	Tags                     []string `json:"tags"`
	BindingsMode             *string  `json:"bindingsMode"`
}

func (api API) RoleAgentRoutes(r chi.Router) {
	r.Get("/", api.listRoleAgents)
	r.Post("/", api.createRoleAgent)
	r.Get("/{roleAgentId}", api.getRoleAgent)
	r.Patch("/{roleAgentId}", api.patchRoleAgent)
	r.Get("/{roleAgentId}/bindings", api.listRoleAgentBindings)
	r.Post("/{roleAgentId}/bindings", api.createRoleAgentBinding)
	r.Patch("/{roleAgentId}/bindings/{bindingId}", api.patchRoleAgentBinding)
	r.Get("/{roleAgentId}/projects/{projectId}/override", api.getRoleAgentOverride)
	r.Put("/{roleAgentId}/projects/{projectId}/override", api.putRoleAgentOverride)
	r.Patch("/{roleAgentId}/projects/{projectId}/override", api.patchRoleAgentOverride)
}

func (api API) listRoleAgents(w http.ResponseWriter, r *http.Request) {
	projectID := nullString(r.URL.Query().Get("projectId"))
	rows, err := api.DB.Query(r.Context(), `
		SELECT id, project_id, name, description, scope, status, permission_profile, tool_profile,
		       default_execution_mode, allowed_stages_json, created_at, updated_at
		FROM role_agents
		WHERE ($1::text IS NULL OR project_id=$1)
		ORDER BY created_at DESC
	`, projectID)
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	defer rows.Close()
	items := []map[string]any{}
	includeBindings := r.URL.Query().Get("includeBindings") == "true"
	for rows.Next() {
		item, err := scanRoleAgent(rows)
		if err != nil {
			web.Error(w, http.StatusInternalServerError, err.Error())
			return
		}
		if includeBindings {
			bindings, _ := api.loadRoleAgentBindings(r.Context(), item["id"].(string), projectID)
			item["bindings"] = bindings
		}
		items = append(items, item)
	}
	web.JSON(w, http.StatusOK, map[string]any{"data": items})
}

func (api API) createRoleAgent(w http.ResponseWriter, r *http.Request) {
	var body roleAgentRequest
	if !decodeBody(w, r, &body) {
		return
	}
	if body.Scope == "" {
		body.Scope = "system"
	}
	if body.Status == "" {
		body.Status = "active"
	}
	if body.DefaultExecutionMode == "" || body.DefaultExecutionMode == "parallel" {
		body.DefaultExecutionMode = "single"
	}
	if body.RiskLevel == "" {
		body.RiskLevel = "low"
	}
	now := time.Now().UTC()
	_, err := api.DB.Exec(r.Context(), `
		INSERT INTO role_agents (
			id, project_id, name, description, scope, status, owner_team, permission_profile, tool_profile,
			default_execution_mode, aggregation_strategy, max_active_bindings, require_consensus, risk_level,
			requires_approval_for_write, allowed_stages_json, output_schema_id, tags_json, created_at, updated_at
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$19)
	`, body.ID, body.ProjectID, body.Name, body.Description, body.Scope, body.Status, body.OwnerTeam, body.PermissionProfile, body.ToolProfile,
		body.DefaultExecutionMode, body.AggregationStrategy, body.MaxActiveBindings, body.RequireConsensus, body.RiskLevel,
		body.RequiresApprovalForWrite, jsonOrEmptyArray(body.AllowedStages), body.OutputSchemaID, jsonOrNull(body.Tags), now)
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	item, _ := api.loadRoleAgent(r.Context(), body.ID)
	web.JSON(w, http.StatusCreated, item)
}

func (api API) getRoleAgent(w http.ResponseWriter, r *http.Request) {
	item, err := api.loadRoleAgent(r.Context(), chi.URLParam(r, "roleAgentId"))
	if err != nil {
		web.Error(w, http.StatusNotFound, "Role agent not found")
		return
	}
	web.JSON(w, http.StatusOK, map[string]any{"data": item})
}

func (api API) patchRoleAgent(w http.ResponseWriter, r *http.Request) {
	roleAgentID := chi.URLParam(r, "roleAgentId")
	var body roleAgentRequest
	if !decodeBody(w, r, &body) {
		return
	}
	now := time.Now().UTC()
	_, err := api.DB.Exec(r.Context(), `UPDATE role_agents SET description=COALESCE($2, description), updated_at=$3 WHERE id=$1`, roleAgentID, body.Description, now)
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	item, _ := api.loadRoleAgent(r.Context(), roleAgentID)
	web.JSON(w, http.StatusOK, item)
}

func (api API) listRoleAgentBindings(w http.ResponseWriter, r *http.Request) {
	bindings, err := api.loadRoleAgentBindings(r.Context(), chi.URLParam(r, "roleAgentId"), nullString(r.URL.Query().Get("projectId")))
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	web.JSON(w, http.StatusOK, map[string]any{"data": bindings})
}

func (api API) createRoleAgentBinding(w http.ResponseWriter, r *http.Request) {
	roleAgentID := chi.URLParam(r, "roleAgentId")
	var body roleAgentBindingRequest
	if !decodeBody(w, r, &body) {
		return
	}
	if body.Priority == 0 {
		body.Priority = 1
	}
	id := uuid.NewString()
	now := time.Now().UTC()
	_, err := api.DB.Exec(r.Context(), `
		INSERT INTO role_agent_bindings (id, role_agent_id, project_id, binding_key, runtime_agent, label, enabled, priority, model, tags_json, created_at, updated_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11)
	`, id, roleAgentID, body.ProjectID, body.BindingKey, body.RuntimeAgent, body.Label, body.Enabled, body.Priority, body.Model, jsonOrNull(body.Tags), now)
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	item, _ := api.loadRoleAgentBinding(r.Context(), id)
	web.JSON(w, http.StatusCreated, item)
}

func (api API) patchRoleAgentBinding(w http.ResponseWriter, r *http.Request) {
	bindingID := chi.URLParam(r, "bindingId")
	var body roleAgentBindingRequest
	if !decodeBody(w, r, &body) {
		return
	}
	now := time.Now().UTC()
	_, err := api.DB.Exec(r.Context(), `UPDATE role_agent_bindings SET priority=COALESCE(NULLIF($2,0), priority), updated_at=$3 WHERE id=$1`, bindingID, body.Priority, now)
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	item, _ := api.loadRoleAgentBinding(r.Context(), bindingID)
	web.JSON(w, http.StatusOK, item)
}

func (api API) getRoleAgentOverride(w http.ResponseWriter, r *http.Request) {
	item, err := api.loadRoleAgentOverride(r.Context(), chi.URLParam(r, "roleAgentId"), chi.URLParam(r, "projectId"))
	if err != nil {
		web.JSON(w, http.StatusOK, map[string]any{"data": nil})
		return
	}
	web.JSON(w, http.StatusOK, map[string]any{"data": item})
}

func (api API) putRoleAgentOverride(w http.ResponseWriter, r *http.Request) {
	api.upsertRoleAgentOverride(w, r)
}

func (api API) patchRoleAgentOverride(w http.ResponseWriter, r *http.Request) {
	api.upsertRoleAgentOverride(w, r)
}

func (api API) upsertRoleAgentOverride(w http.ResponseWriter, r *http.Request) {
	roleAgentID := chi.URLParam(r, "roleAgentId")
	projectID := chi.URLParam(r, "projectId")
	var body roleAgentOverrideRequest
	if !decodeBody(w, r, &body) {
		return
	}
	mode := "inherit"
	if body.BindingsMode != nil && *body.BindingsMode != "" {
		mode = *body.BindingsMode
	}
	now := time.Now().UTC()
	id := uuid.NewString()
	_, err := api.DB.Exec(r.Context(), `
		INSERT INTO role_agent_project_overrides (
			id, role_agent_id, project_id, name, description, status, bindings_mode, created_at, updated_at
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8)
		ON CONFLICT (role_agent_id, project_id) DO UPDATE SET
			name=COALESCE(EXCLUDED.name, role_agent_project_overrides.name),
			description=COALESCE(EXCLUDED.description, role_agent_project_overrides.description),
			status=COALESCE(EXCLUDED.status, role_agent_project_overrides.status),
			bindings_mode=COALESCE(EXCLUDED.bindings_mode, role_agent_project_overrides.bindings_mode),
			updated_at=EXCLUDED.updated_at
	`, id, roleAgentID, projectID, body.Name, body.Description, body.Status, mode, now)
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	item, _ := api.loadRoleAgentOverride(r.Context(), roleAgentID, projectID)
	web.JSON(w, http.StatusOK, map[string]any{"data": item})
}

func (api API) loadRoleAgent(ctx context.Context, id string) (map[string]any, error) {
	return scanRoleAgent(api.DB.QueryRow(ctx, `
		SELECT id, project_id, name, description, scope, status, permission_profile, tool_profile,
		       default_execution_mode, allowed_stages_json, created_at, updated_at
		FROM role_agents WHERE id=$1
	`, id))
}

func scanRoleAgent(row pgx.Row) (map[string]any, error) {
	var id, name, scope, status, permissionProfile, toolProfile, mode string
	var projectID, description *string
	var allowed []byte
	var created, updated time.Time
	if err := row.Scan(&id, &projectID, &name, &description, &scope, &status, &permissionProfile, &toolProfile, &mode, &allowed, &created, &updated); err != nil {
		return nil, err
	}
	return map[string]any{"id": id, "projectId": projectID, "name": name, "description": description, "scope": scope, "status": status, "permissionProfile": permissionProfile, "toolProfile": toolProfile, "defaultExecutionMode": mode, "allowedStages": scanJSONAnyDefault(allowed, []any{}), "createdAt": formatRuntimeTime(&created), "updatedAt": formatRuntimeTime(&updated)}, nil
}

func (api API) loadRoleAgentBindings(ctx context.Context, roleAgentID string, projectID any) ([]map[string]any, error) {
	rows, err := api.DB.Query(ctx, `
		SELECT id, role_agent_id, project_id, binding_key, runtime_agent, label, enabled, priority, model, tags_json, created_at, updated_at
		FROM role_agent_bindings
		WHERE role_agent_id=$1 AND ($2::text IS NULL OR project_id=$2)
		ORDER BY priority, created_at
	`, roleAgentID, projectID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []map[string]any{}
	for rows.Next() {
		item, err := scanRoleAgentBinding(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (api API) loadRoleAgentBinding(ctx context.Context, id string) (map[string]any, error) {
	return scanRoleAgentBinding(api.DB.QueryRow(ctx, `
		SELECT id, role_agent_id, project_id, binding_key, runtime_agent, label, enabled, priority, model, tags_json, created_at, updated_at
		FROM role_agent_bindings WHERE id=$1
	`, id))
}

func scanRoleAgentBinding(row pgx.Row) (map[string]any, error) {
	var id, roleAgentID, bindingKey, runtimeAgent, label string
	var projectID, model *string
	var enabled bool
	var priority int
	var tags []byte
	var created, updated time.Time
	if err := row.Scan(&id, &roleAgentID, &projectID, &bindingKey, &runtimeAgent, &label, &enabled, &priority, &model, &tags, &created, &updated); err != nil {
		return nil, err
	}
	return map[string]any{"id": id, "roleAgentId": roleAgentID, "projectId": projectID, "bindingKey": bindingKey, "runtimeAgent": runtimeAgent, "label": label, "enabled": enabled, "priority": priority, "model": model, "tags": scanJSONAnyDefault(tags, []any{}), "createdAt": formatRuntimeTime(&created), "updatedAt": formatRuntimeTime(&updated)}, nil
}

func (api API) loadRoleAgentOverride(ctx context.Context, roleAgentID, projectID string) (map[string]any, error) {
	var id string
	var name, description, status *string
	var mode string
	var created, updated time.Time
	err := api.DB.QueryRow(ctx, `
		SELECT id, name, description, status, bindings_mode, created_at, updated_at
		FROM role_agent_project_overrides WHERE role_agent_id=$1 AND project_id=$2
	`, roleAgentID, projectID).Scan(&id, &name, &description, &status, &mode, &created, &updated)
	if err != nil {
		return nil, err
	}
	return map[string]any{"id": id, "roleAgentId": roleAgentID, "projectId": projectID, "name": name, "description": description, "status": status, "bindingsMode": mode, "createdAt": formatRuntimeTime(&created), "updatedAt": formatRuntimeTime(&updated)}, nil
}
