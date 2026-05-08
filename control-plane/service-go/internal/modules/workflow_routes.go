package modules

import (
	"context"
	"encoding/json"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	authpkg "openerx/control-plane/service-go/internal/auth"
	"openerx/control-plane/service-go/internal/web"
)

type roleConclusionRequest struct {
	RoleAgentID            string  `json:"roleAgentId"`
	Stage                  string  `json:"stage"`
	AggregationStrategy    string  `json:"aggregationStrategy"`
	Status                 string  `json:"status"`
	FinalDecision          string  `json:"finalDecision"`
	AggregateRiskLevel     string  `json:"aggregateRiskLevel"`
	ConfidenceScore        float64 `json:"confidenceScore"`
	ConsensusScore         float64 `json:"consensusScore"`
	WinningRationale       string  `json:"winningRationale"`
	MergedFindings         any     `json:"mergedFindings"`
	MinorityFindings       any     `json:"minorityFindings"`
	Conflicts              any     `json:"conflicts"`
	ApprovalRecommendation any     `json:"approvalRecommendation"`
	GeneratedAt            *string `json:"generatedAt"`
}

type developerChangeRequestCreate struct {
	TaskStageRunID      *string  `json:"taskStageRunId"`
	SourceRoleAgentID   string   `json:"sourceRoleAgentId"`
	AssignedRoleAgentID *string  `json:"assignedRoleAgentId"`
	Priority            string   `json:"priority"`
	Title               string   `json:"title"`
	Summary             string   `json:"summary"`
	RequiredChanges     []string `json:"requiredChanges"`
	RelatedFindingKeys  []string `json:"relatedFindingKeys"`
	Blocking            bool     `json:"blocking"`
	ApprovalRequired    bool     `json:"approvalRequired"`
	Status              string   `json:"status"`
}

type developerChangeRequestPatch struct {
	RequestID      string  `json:"requestId"`
	Status         string  `json:"status"`
	ResolutionNote *string `json:"resolutionNote"`
}

type workflowTemplateRequest struct {
	ID                           string   `json:"id"`
	ProjectID                    *string  `json:"projectId"`
	Name                         string   `json:"name"`
	Description                  *string  `json:"description"`
	Category                     *string  `json:"category"`
	Enabled                      bool     `json:"enabled"`
	SelectableByProjects         bool     `json:"selectableByProjects"`
	DefaultCollaborationMode     *string  `json:"defaultCollaborationMode"`
	DefaultAutopilotLevel        *string  `json:"defaultAutopilotLevel"`
	DefaultBossParticipationMode *string  `json:"defaultBossParticipationMode"`
	ForceBossParticipation       bool     `json:"forceBossParticipation"`
	StageOrder                   []string `json:"stageOrder"`
	DefaultRoles                 []string `json:"defaultRoles"`
}

type workflowStageRequest struct {
	ID                      string   `json:"id"`
	StageKey                string   `json:"stageKey"`
	Name                    string   `json:"name"`
	Enabled                 bool     `json:"enabled"`
	Mode                    string   `json:"mode"`
	PrimaryRoleAgentID      string   `json:"primaryRoleAgentId"`
	ParticipantRoleAgentIDs []string `json:"participantRoleAgentIds"`
	RoleExecutionPolicies   any      `json:"roleExecutionPolicies"`
	EntryCriteria           any      `json:"entryCriteria"`
	ExitCriteria            any      `json:"exitCriteria"`
	InitialTaskDefinition   any      `json:"initialTaskDefinition"`
	Hooks                   any      `json:"hooks"`
	Gates                   any      `json:"gates"`
	Approvals               any      `json:"approvals"`
	StageTemplateStrategy   any      `json:"stageTemplateStrategy"`
	FailurePolicy           any      `json:"failurePolicy"`
	OrderIndex              int      `json:"orderIndex"`
}

func (api API) WorkflowTemplateRoutes(r chi.Router) {
	r.Get("/", api.listWorkflowTemplates)
	r.Post("/", api.createWorkflowTemplate)
	r.Patch("/{templateId}", api.patchWorkflowTemplate)
	r.Post("/{templateId}/stages", api.createWorkflowTemplateStage)
	r.Get("/{templateId}/stages", api.listWorkflowTemplateStages)
	r.Delete("/{templateId}/stages/{stageId}", api.deleteWorkflowTemplateStage)
}

func (api API) RoleConclusionRoutes(r chi.Router) {
	r.Get("/", api.listRoleConclusions)
	r.Post("/", api.createRoleConclusion)
}

func (api API) DeveloperChangeRequestRoutes(r chi.Router) {
	r.Get("/", api.listDeveloperChangeRequests)
	r.Post("/", api.createDeveloperChangeRequest)
	r.Patch("/", api.patchDeveloperChangeRequest)
}

func (api API) TaskWorkflowRoutes(r chi.Router) {
	r.Get("/", api.getTaskWorkflow)
	r.Post("/retry-stage", api.retryTaskWorkflowStage)
}

func (api API) listRoleConclusions(w http.ResponseWriter, r *http.Request) {
	taskID := chi.URLParam(r, "taskId")
	migrated, ok, err := api.ensureRoleConclusionsAvailable(r.Context(), taskID)
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	if !ok {
		web.Error(w, http.StatusNotFound, "Task not found")
		return
	}
	rows, err := api.DB.Query(r.Context(), `
		SELECT id, role_agent_id, stage, aggregation_strategy, status, final_decision, aggregate_risk_level,
		       confidence_score, consensus_score, winning_rationale, merged_findings_json, minority_findings_json,
		       conflicts_json, approval_recommendation_json, generated_at
		FROM role_aggregate_conclusions
		WHERE task_id=$1
		ORDER BY generated_at DESC
	`, taskID)
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	defer rows.Close()
	items, err := scanRoleConclusionRows(rows)
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	web.JSON(w, http.StatusOK, map[string]any{"data": items, "meta": map[string]any{"workflowMigrated": migrated}})
}

func (api API) createRoleConclusion(w http.ResponseWriter, r *http.Request) {
	taskID := chi.URLParam(r, "taskId")
	var body roleConclusionRequest
	if !decodeBody(w, r, &body) {
		return
	}
	_, ok, err := api.ensureRoleConclusionsAvailable(r.Context(), taskID)
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	if !ok {
		web.Error(w, http.StatusNotFound, "Task not found")
		return
	}
	if body.AggregationStrategy == "" {
		body.AggregationStrategy = "merge-summary"
	}
	if body.Status == "" {
		body.Status = "aligned"
	}
	if body.FinalDecision == "" {
		body.FinalDecision = "allow"
	}
	if body.AggregateRiskLevel == "" {
		body.AggregateRiskLevel = "medium"
	}
	now := time.Now().UTC()
	var existing string
	err = api.DB.QueryRow(r.Context(), `SELECT id FROM role_aggregate_conclusions WHERE task_id=$1 AND role_agent_id=$2 AND stage=$3`, taskID, body.RoleAgentID, body.Stage).Scan(&existing)
	if err == nil {
		_, err = api.DB.Exec(r.Context(), `
			UPDATE role_aggregate_conclusions SET aggregation_strategy=$2, status=$3, final_decision=$4,
				aggregate_risk_level=$5, confidence_score=$6, consensus_score=$7, winning_rationale=$8,
				merged_findings_json=$9, minority_findings_json=$10, conflicts_json=$11,
				approval_recommendation_json=$12, generated_at=$13, updated_at=$13
			WHERE id=$1
		`, existing, body.AggregationStrategy, body.Status, body.FinalDecision, body.AggregateRiskLevel, body.ConfidenceScore,
			body.ConsensusScore, body.WinningRationale, jsonOrEmptyArray(body.MergedFindings), jsonOrEmptyArray(body.MinorityFindings),
			jsonOrEmptyArray(body.Conflicts), jsonOrNull(body.ApprovalRecommendation), now)
	} else {
		_, err = api.DB.Exec(r.Context(), `
			INSERT INTO role_aggregate_conclusions (
				id, task_id, task_stage_run_id, role_agent_id, stage, aggregation_strategy, status,
				final_decision, aggregate_risk_level, confidence_score, consensus_score, winning_rationale,
				merged_findings_json, minority_findings_json, conflicts_json, approval_recommendation_json,
				generated_at, created_at, updated_at
			) VALUES ($1,$2,NULL,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$16,$16)
		`, uuid.NewString(), taskID, body.RoleAgentID, body.Stage, body.AggregationStrategy, body.Status, body.FinalDecision,
			body.AggregateRiskLevel, body.ConfidenceScore, body.ConsensusScore, body.WinningRationale, jsonOrEmptyArray(body.MergedFindings),
			jsonOrEmptyArray(body.MinorityFindings), jsonOrEmptyArray(body.Conflicts), jsonOrNull(body.ApprovalRecommendation), now)
	}
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	rows, err := api.DB.Query(r.Context(), `
		SELECT id, role_agent_id, stage, aggregation_strategy, status, final_decision, aggregate_risk_level,
		       confidence_score, consensus_score, winning_rationale, merged_findings_json, minority_findings_json,
		       conflicts_json, approval_recommendation_json, generated_at
		FROM role_aggregate_conclusions
		WHERE task_id=$1
		ORDER BY generated_at DESC
	`, taskID)
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	defer rows.Close()
	items, err := scanRoleConclusionRows(rows)
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	web.JSON(w, http.StatusOK, map[string]any{"ok": true, "data": items})
}

func (api API) listDeveloperChangeRequests(w http.ResponseWriter, r *http.Request) {
	taskID := chi.URLParam(r, "taskId")
	migrated, ok, err := api.ensureDeveloperChangeRequestsAvailable(r.Context(), taskID)
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	if !ok {
		web.Error(w, http.StatusNotFound, "Task not found")
		return
	}
	rows, err := api.DB.Query(r.Context(), `
		SELECT id, task_stage_run_id, source_role_agent_id, assigned_role_agent_id, priority, title, summary,
		       required_changes_json, related_finding_keys_json, blocking, approval_required, status,
		       resolution_note, created_at, updated_at, resolved_at
		FROM developer_change_requests
		WHERE task_id=$1
		ORDER BY created_at DESC
	`, taskID)
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	defer rows.Close()
	items, err := scanDeveloperChangeRequestRows(rows)
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	web.JSON(w, http.StatusOK, map[string]any{"data": items, "meta": map[string]any{"workflowMigrated": migrated}})
}

func (api API) createDeveloperChangeRequest(w http.ResponseWriter, r *http.Request) {
	taskID := chi.URLParam(r, "taskId")
	var body developerChangeRequestCreate
	if !decodeBody(w, r, &body) {
		return
	}
	_, ok, err := api.ensureDeveloperChangeRequestsAvailable(r.Context(), taskID)
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	if !ok {
		web.Error(w, http.StatusNotFound, "Task not found")
		return
	}
	if body.Priority == "" {
		body.Priority = "medium"
	}
	if body.Status == "" {
		body.Status = "open"
	}
	assigned := "role.developer"
	if body.AssignedRoleAgentID != nil && *body.AssignedRoleAgentID != "" {
		assigned = *body.AssignedRoleAgentID
	}
	id := uuid.NewString()
	now := time.Now().UTC()
	_, err = api.DB.Exec(r.Context(), `
		INSERT INTO developer_change_requests (
			id, task_id, task_stage_run_id, source_role_agent_id, assigned_role_agent_id, priority, title,
			summary, required_changes_json, related_finding_keys_json, blocking, approval_required, status,
			resolution_note, created_at, updated_at, resolved_at
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,NULL,$14,$14,NULL)
	`, id, taskID, body.TaskStageRunID, body.SourceRoleAgentID, assigned, body.Priority, body.Title, body.Summary,
		jsonOrEmptyArray(body.RequiredChanges), jsonOrEmptyArray(body.RelatedFindingKeys), body.Blocking, body.ApprovalRequired, body.Status, now)
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	web.JSON(w, http.StatusCreated, map[string]any{"ok": true, "id": id})
}

func (api API) patchDeveloperChangeRequest(w http.ResponseWriter, r *http.Request) {
	taskID := chi.URLParam(r, "taskId")
	var body developerChangeRequestPatch
	if !decodeBody(w, r, &body) {
		return
	}
	if body.Status == "" {
		body.Status = "open"
	}
	now := time.Now().UTC()
	var resolvedAt any
	if body.Status == "resolved" || body.Status == "won't-fix" {
		resolvedAt = now
	}
	tag, err := api.DB.Exec(r.Context(), `
		UPDATE developer_change_requests
		SET status=$3, resolution_note=COALESCE($4, resolution_note), updated_at=$5, resolved_at=$6
		WHERE task_id=$1 AND id=$2
	`, taskID, body.RequestID, body.Status, body.ResolutionNote, now, resolvedAt)
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	if tag.RowsAffected() == 0 {
		web.Error(w, http.StatusNotFound, "Change request not found")
		return
	}
	web.JSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (api API) listWorkflowTemplates(w http.ResponseWriter, r *http.Request) {
	projectID := nullString(r.URL.Query().Get("projectId"))
	rows, err := api.DB.Query(r.Context(), `SELECT id, project_id, name, description, category, enabled, selectable_by_projects, stage_order_json, created_at, updated_at FROM workflow_templates WHERE ($1::text IS NULL OR project_id=$1) ORDER BY created_at DESC`, projectID)
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	defer rows.Close()
	items := []map[string]any{}
	for rows.Next() {
		item, err := scanWorkflowTemplate(rows)
		if err != nil {
			web.Error(w, http.StatusInternalServerError, err.Error())
			return
		}
		items = append(items, item)
	}
	web.JSON(w, http.StatusOK, map[string]any{"data": items})
}

func (api API) patchWorkflowTemplate(w http.ResponseWriter, r *http.Request) {
	templateID := chi.URLParam(r, "templateId")
	var body workflowTemplateRequest
	if !decodeBody(w, r, &body) {
		return
	}
	now := time.Now().UTC()
	_, err := api.DB.Exec(r.Context(), `
		UPDATE workflow_templates SET
			name=COALESCE(NULLIF($2,''), name),
			description=COALESCE($3, description),
			category=COALESCE($4, category),
			updated_at=$5
		WHERE id=$1
	`, templateID, body.Name, body.Description, body.Category, now)
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	item, err := api.loadWorkflowTemplate(r.Context(), templateID)
	if err != nil {
		web.Error(w, http.StatusNotFound, "Workflow template not found")
		return
	}
	web.JSON(w, http.StatusOK, item)
}

func (api API) createWorkflowTemplate(w http.ResponseWriter, r *http.Request) {
	user := authpkg.User(r)
	var body workflowTemplateRequest
	if !decodeBody(w, r, &body) {
		return
	}
	now := time.Now().UTC()
	_, err := api.DB.Exec(r.Context(), `
		INSERT INTO workflow_templates (
			id, project_id, name, description, category, enabled, selectable_by_projects,
			default_collaboration_mode, default_autopilot_level, default_boss_participation_mode,
			force_boss_participation, stage_order_json, default_roles_json, version, created_by, updated_by,
			created_at, updated_at
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,1,$14,$14,$15,$15)
	`, body.ID, body.ProjectID, body.Name, body.Description, body.Category, body.Enabled, body.SelectableByProjects,
		body.DefaultCollaborationMode, body.DefaultAutopilotLevel, body.DefaultBossParticipationMode, body.ForceBossParticipation,
		jsonOrEmptyArray(body.StageOrder), jsonOrNull(body.DefaultRoles), user.Sub, now)
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	item, _ := api.loadWorkflowTemplate(r.Context(), body.ID)
	web.JSON(w, http.StatusCreated, item)
}

func (api API) listWorkflowTemplateStages(w http.ResponseWriter, r *http.Request) {
	rows, err := api.DB.Query(r.Context(), `SELECT id, template_id, stage_key, name, enabled, mode, primary_role_agent_id, participant_role_agent_ids_json, order_index FROM workflow_template_stages WHERE template_id=$1 ORDER BY order_index, stage_key`, chi.URLParam(r, "templateId"))
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	defer rows.Close()
	items, err := scanWorkflowTemplateStageRows(rows)
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	web.JSON(w, http.StatusOK, map[string]any{"data": items})
}

func (api API) createWorkflowTemplateStage(w http.ResponseWriter, r *http.Request) {
	templateID := chi.URLParam(r, "templateId")
	var body workflowStageRequest
	if !decodeBody(w, r, &body) {
		return
	}
	if body.Mode == "" {
		body.Mode = "single"
	}
	_, err := api.DB.Exec(r.Context(), `
		INSERT INTO workflow_template_stages (
			id, template_id, stage_key, name, enabled, mode, primary_role_agent_id,
			participant_role_agent_ids_json, role_execution_policies_json, entry_criteria_json,
			exit_criteria_json, initial_task_definition_json, hooks_json, gates_json, approvals_json,
			stage_template_strategy_json, failure_policy_json, order_index
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
	`, body.ID, templateID, body.StageKey, body.Name, body.Enabled, body.Mode, body.PrimaryRoleAgentID,
		jsonOrEmptyArray(body.ParticipantRoleAgentIDs), jsonOrNull(body.RoleExecutionPolicies), jsonOrNull(body.EntryCriteria),
		jsonOrNull(body.ExitCriteria), jsonOrNull(body.InitialTaskDefinition), jsonOrNull(body.Hooks), jsonOrNull(body.Gates),
		jsonOrNull(body.Approvals), jsonOrNull(body.StageTemplateStrategy), jsonOrNull(body.FailurePolicy), body.OrderIndex)
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	web.JSON(w, http.StatusCreated, map[string]any{"id": body.ID, "templateId": templateID, "stageKey": body.StageKey, "name": body.Name, "enabled": body.Enabled, "mode": body.Mode, "primaryRoleAgentId": body.PrimaryRoleAgentID, "participantRoleAgentIds": body.ParticipantRoleAgentIDs, "orderIndex": body.OrderIndex})
}

func (api API) deleteWorkflowTemplateStage(w http.ResponseWriter, r *http.Request) {
	_, _ = api.DB.Exec(r.Context(), `DELETE FROM workflow_template_stages WHERE template_id=$1 AND id=$2`, chi.URLParam(r, "templateId"), chi.URLParam(r, "stageId"))
	web.JSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (api API) getTaskWorkflow(w http.ResponseWriter, r *http.Request) {
	taskID := chi.URLParam(r, "taskId")
	ok, err := api.ensureTaskWorkflowAvailable(r.Context(), taskID)
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	if !ok {
		web.Error(w, http.StatusNotFound, "Task not found")
		return
	}
	workflowRun, err := api.loadTaskWorkflowRun(r.Context(), taskID)
	if err != nil {
		if err == pgx.ErrNoRows {
			web.JSON(w, http.StatusOK, map[string]any{"data": map[string]any{"workflowRun": nil, "stages": []any{}}})
			return
		}
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	if err := api.ensureStageRunsForWorkflow(r.Context(), workflowRun); err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	stages, err := api.loadTaskStageRuns(r.Context(), workflowRun["id"].(string))
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	workflowRun, _ = api.loadTaskWorkflowRun(r.Context(), taskID)
	web.JSON(w, http.StatusOK, map[string]any{"data": map[string]any{"workflowRun": workflowRun, "stages": stages}})
}

func (api API) retryTaskWorkflowStage(w http.ResponseWriter, r *http.Request) {
	taskID := chi.URLParam(r, "taskId")
	var body struct {
		StageKey string `json:"stageKey"`
	}
	if !decodeBody(w, r, &body) {
		return
	}
	workflowRun, err := api.loadTaskWorkflowRun(r.Context(), taskID)
	if err != nil {
		web.Error(w, http.StatusNotFound, "Workflow run not found")
		return
	}
	now := time.Now().UTC()
	tag, err := api.DB.Exec(r.Context(), `
		UPDATE task_stage_runs
		SET status='running', blocking_reason=NULL, approval_state='not-required', started_at=$3, finished_at=NULL, updated_at=$3
		WHERE workflow_run_id=$1 AND stage_key=$2
	`, workflowRun["id"], body.StageKey, now)
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	if tag.RowsAffected() == 0 {
		web.Error(w, http.StatusNotFound, "Stage run not found")
		return
	}
	web.JSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (api API) getTaskOperatingRuntimeState(w http.ResponseWriter, r *http.Request) {
	taskID := chi.URLParam(r, "taskId")
	strategy, err := api.loadTaskStrategy(r.Context(), taskID)
	if err != nil {
		web.Error(w, http.StatusNotFound, "Task not found")
		return
	}
	collaborationMode := stringFromMap(strategy, "collaborationMode")
	autopilotLevel := stringFromMap(strategy, "autopilotLevel")
	bossMode := stringFromMap(strategy, "bossParticipationMode")
	selectedTemplateID := stringFromMap(strategy, "selectedTemplateId")
	scenarioKey := stringFromMap(strategy, "scenarioKey")
	currentStageKey := stringFromMap(strategy, "currentStageKey")
	currentStageStatus := stringFromMap(strategy, "currentStageStatus")
	if collaborationMode == "" {
		collaborationMode = "solo"
	}
	if autopilotLevel == "" {
		autopilotLevel = "L0"
	}
	if bossMode == "" {
		bossMode = "disabled"
	}
	now := time.Now().UTC()
	_, err = api.DB.Exec(r.Context(), `
		INSERT INTO task_operating_modes (
			task_id, collaboration_mode, autopilot_level, boss_participation_mode,
			selected_template_id, scenario_key, source, created_at, updated_at
		) VALUES ($1,$2,$3,$4,$5,$6,'legacy-strategy',$7,$7)
		ON CONFLICT (task_id) DO UPDATE SET
			collaboration_mode=EXCLUDED.collaboration_mode,
			autopilot_level=EXCLUDED.autopilot_level,
			boss_participation_mode=EXCLUDED.boss_participation_mode,
			selected_template_id=EXCLUDED.selected_template_id,
			scenario_key=EXCLUDED.scenario_key,
			source=EXCLUDED.source,
			updated_at=EXCLUDED.updated_at
	`, taskID, collaborationMode, autopilotLevel, bossMode, nullString(selectedTemplateID), nullString(scenarioKey), now)
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	for _, key := range []string{"collaborationMode", "autopilotLevel", "bossParticipationMode", "selectedTemplateId", "scenarioKey"} {
		delete(strategy, key)
	}
	raw, _ := jsonBytes(strategy)
	_, _ = api.DB.Exec(r.Context(), `UPDATE tasks SET strategy_json=$1, updated_at=$2 WHERE id=$3`, raw, now, taskID)
	web.JSON(w, http.StatusOK, map[string]any{
		"taskId": taskID, "collaborationMode": collaborationMode, "autopilotLevel": autopilotLevel,
		"bossParticipationMode": bossMode, "selectedTemplateId": nilIfEmpty(selectedTemplateID),
		"scenarioKey": nilIfEmpty(scenarioKey), "currentStageKey": nilIfEmpty(currentStageKey),
		"currentStageStatus": nilIfEmpty(currentStageStatus),
	})
}

func (api API) taskExists(ctx context.Context, taskID string) (bool, error) {
	var id string
	err := api.DB.QueryRow(ctx, `SELECT id FROM tasks WHERE id=$1`, taskID).Scan(&id)
	if err == pgx.ErrNoRows {
		return false, nil
	}
	return err == nil, err
}

func (api API) ensureRoleConclusionsAvailable(ctx context.Context, taskID string) (bool, bool, error) {
	ok, err := api.taskExists(ctx, taskID)
	if err != nil || !ok {
		return false, ok, err
	}
	var count int
	_ = api.DB.QueryRow(ctx, `SELECT COUNT(*) FROM role_aggregate_conclusions WHERE task_id=$1`, taskID).Scan(&count)
	if count > 0 {
		_ = api.removeLegacyWorkflowStrategyFields(ctx, taskID, "roleAggregateConclusions")
		return false, true, nil
	}
	strategy, err := api.loadTaskStrategy(ctx, taskID)
	if err != nil {
		return false, true, err
	}
	rawItems, _ := strategy["roleAggregateConclusions"].([]any)
	if len(rawItems) == 0 {
		return false, true, nil
	}
	now := time.Now().UTC()
	for _, raw := range rawItems {
		item, _ := raw.(map[string]any)
		id := stringFromMap(item, "id")
		if id == "" {
			id = uuid.NewString()
		}
		_, err = api.DB.Exec(ctx, `
			INSERT INTO role_aggregate_conclusions (
				id, task_id, task_stage_run_id, role_agent_id, stage, aggregation_strategy, status,
				final_decision, aggregate_risk_level, confidence_score, consensus_score, winning_rationale,
				merged_findings_json, minority_findings_json, conflicts_json, approval_recommendation_json,
				generated_at, created_at, updated_at
			) VALUES ($1,$2,NULL,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$16,$16)
			ON CONFLICT (id) DO NOTHING
		`, id, taskID, stringFallback(stringFromMap(item, "roleAgentId"), "role.unknown"), stringFallback(stringFromMap(item, "stage"), "default"),
			stringFallback(stringFromMap(item, "aggregationStrategy"), "merge-summary"), stringFallback(stringFromMap(item, "status"), "aligned"),
			stringFallback(stringFromMap(item, "finalDecision"), "allow"), stringFallback(stringFromMap(item, "aggregateRiskLevel"), "medium"),
			floatFromMap(item, "confidenceScore"), floatFromMap(item, "consensusScore"), stringFallback(stringFromMap(item, "winningRationale"), ""),
			jsonOrEmptyArray(item["mergedFindings"]), jsonOrEmptyArray(item["minorityFindings"]), jsonOrEmptyArray(item["conflicts"]),
			jsonOrNull(item["approvalRecommendation"]), now)
		if err != nil {
			return false, true, err
		}
	}
	_ = api.removeLegacyWorkflowStrategyFields(ctx, taskID, "roleAggregateConclusions")
	return true, true, nil
}

func (api API) ensureDeveloperChangeRequestsAvailable(ctx context.Context, taskID string) (bool, bool, error) {
	ok, err := api.taskExists(ctx, taskID)
	if err != nil || !ok {
		return false, ok, err
	}
	var count int
	_ = api.DB.QueryRow(ctx, `SELECT COUNT(*) FROM developer_change_requests WHERE task_id=$1`, taskID).Scan(&count)
	if count > 0 {
		_ = api.removeLegacyWorkflowStrategyFields(ctx, taskID, "developerChangeRequests")
		return false, true, nil
	}
	strategy, err := api.loadTaskStrategy(ctx, taskID)
	if err != nil {
		return false, true, err
	}
	rawItems, _ := strategy["developerChangeRequests"].([]any)
	if len(rawItems) == 0 {
		return false, true, nil
	}
	now := time.Now().UTC()
	for _, raw := range rawItems {
		item, _ := raw.(map[string]any)
		id := stringFromMap(item, "id")
		if id == "" {
			id = uuid.NewString()
		}
		_, err = api.DB.Exec(ctx, `
			INSERT INTO developer_change_requests (
				id, task_id, task_stage_run_id, source_role_agent_id, assigned_role_agent_id, priority, title,
				summary, required_changes_json, related_finding_keys_json, blocking, approval_required, status,
				resolution_note, created_at, updated_at, resolved_at
			) VALUES ($1,$2,NULL,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NULL,$13,$13,NULL)
			ON CONFLICT (id) DO NOTHING
		`, id, taskID, stringFallback(stringFromMap(item, "sourceRoleAgentId"), "role.unknown"), stringFallback(stringFromMap(item, "assignedRoleAgentId"), "role.developer"),
			stringFallback(stringFromMap(item, "priority"), "medium"), stringFallback(stringFromMap(item, "title"), "Untitled"), stringFallback(stringFromMap(item, "summary"), ""),
			jsonOrEmptyArray(item["requiredChanges"]), jsonOrEmptyArray(item["relatedFindingKeys"]), boolFromMap(item, "blocking"), boolFromMap(item, "approvalRequired"),
			stringFallback(stringFromMap(item, "status"), "open"), now)
		if err != nil {
			return false, true, err
		}
	}
	_ = api.removeLegacyWorkflowStrategyFields(ctx, taskID, "developerChangeRequests")
	return true, true, nil
}

func (api API) ensureTaskWorkflowAvailable(ctx context.Context, taskID string) (bool, error) {
	ok, err := api.taskExists(ctx, taskID)
	if err != nil || !ok {
		return ok, err
	}
	_, _, _ = api.ensureRoleConclusionsAvailable(ctx, taskID)
	_, _, _ = api.ensureDeveloperChangeRequestsAvailable(ctx, taskID)
	if _, err := api.loadTaskWorkflowRun(ctx, taskID); err == nil {
		return true, nil
	}
	strategy, err := api.loadTaskStrategy(ctx, taskID)
	if err != nil {
		return true, err
	}
	templateID := stringFromMap(strategy, "selectedTemplateId")
	if templateID == "" {
		return true, nil
	}
	currentStage := stringFromMap(strategy, "currentStage")
	if currentStage == "" {
		currentStage = "intake"
		var stage string
		_ = api.DB.QueryRow(ctx, `SELECT stage FROM role_aggregate_conclusions WHERE task_id=$1 ORDER BY generated_at DESC LIMIT 1`, taskID).Scan(&stage)
		if stage != "" {
			currentStage = stage
		}
	}
	now := time.Now().UTC()
	workflowRunID := "task-workflow:" + taskID
	_, err = api.DB.Exec(ctx, `
		INSERT INTO task_workflow_runs (id, task_id, template_id, current_stage, status, started_at, created_at, updated_at)
		VALUES ($1,$2,$3,$4,'running',$5,$5,$5)
		ON CONFLICT (id) DO NOTHING
	`, workflowRunID, taskID, templateID, currentStage, now)
	return true, err
}

func (api API) ensureStageRunsForWorkflow(ctx context.Context, workflowRun map[string]any) error {
	workflowRunID, _ := workflowRun["id"].(string)
	templateID, _ := workflowRun["templateId"].(string)
	currentStage, _ := workflowRun["currentStage"].(string)
	var existing int
	_ = api.DB.QueryRow(ctx, `SELECT COUNT(*) FROM task_stage_runs WHERE workflow_run_id=$1`, workflowRunID).Scan(&existing)
	if existing > 0 {
		return nil
	}
	rows, err := api.DB.Query(ctx, `SELECT stage_key, primary_role_agent_id, participant_role_agent_ids_json FROM workflow_template_stages WHERE template_id=$1 ORDER BY order_index, stage_key`, templateID)
	if err != nil {
		return err
	}
	defer rows.Close()
	now := time.Now().UTC()
	seenCurrent := false
	for rows.Next() {
		var stageKey, primary string
		var participants []byte
		if err := rows.Scan(&stageKey, &primary, &participants); err != nil {
			return err
		}
		status := "pending"
		var startedAt any
		var finishedAt any
		if stageKey == currentStage {
			status = "running"
			startedAt = now
			seenCurrent = true
		} else if !seenCurrent {
			status = "completed"
			startedAt = now
			finishedAt = now
		}
		_, err = api.DB.Exec(ctx, `
			INSERT INTO task_stage_runs (
				id, workflow_run_id, stage_key, status, primary_role_agent_id, participant_role_agent_ids_json,
				started_at, finished_at, blocking_reason, approval_state, artifacts_summary_json, created_at, updated_at
			) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NULL,'not-required',NULL,$9,$9)
		`, uuid.NewString(), workflowRunID, stageKey, status, primary, participants, startedAt, finishedAt, now)
		if err != nil {
			return err
		}
	}
	return rows.Err()
}

func (api API) removeLegacyWorkflowStrategyFields(ctx context.Context, taskID string, keys ...string) error {
	strategy, err := api.loadTaskStrategy(ctx, taskID)
	if err != nil {
		return err
	}
	changed := false
	for _, key := range keys {
		if _, exists := strategy[key]; exists {
			delete(strategy, key)
			changed = true
		}
	}
	if !changed {
		return nil
	}
	raw, _ := jsonBytes(strategy)
	_, err = api.DB.Exec(ctx, `UPDATE tasks SET strategy_json=$1, updated_at=$2 WHERE id=$3`, raw, time.Now().UTC(), taskID)
	return err
}

func scanRoleConclusionRows(rows pgx.Rows) ([]map[string]any, error) {
	items := []map[string]any{}
	for rows.Next() {
		var id, roleAgentID, stage, aggregationStrategy, status, finalDecision, risk, rationale string
		var confidence, consensus float64
		var merged, minority, conflicts, approval []byte
		var generated time.Time
		if err := rows.Scan(&id, &roleAgentID, &stage, &aggregationStrategy, &status, &finalDecision, &risk, &confidence, &consensus, &rationale, &merged, &minority, &conflicts, &approval, &generated); err != nil {
			return nil, err
		}
		items = append(items, map[string]any{
			"id": id, "roleAgentId": roleAgentID, "stage": stage, "aggregationStrategy": aggregationStrategy,
			"status": status, "finalDecision": finalDecision, "aggregateRiskLevel": risk, "confidenceScore": confidence,
			"consensusScore": consensus, "winningRationale": rationale, "mergedFindings": scanJSONAnyDefault(merged, []any{}),
			"minorityFindings": scanJSONAnyDefault(minority, []any{}), "conflicts": scanJSONAnyDefault(conflicts, []any{}),
			"approvalRecommendation": scanJSONAnyDefault(approval, nil), "generatedAt": formatRuntimeTime(&generated),
		})
	}
	return items, rows.Err()
}

func scanDeveloperChangeRequestRows(rows pgx.Rows) ([]map[string]any, error) {
	items := []map[string]any{}
	for rows.Next() {
		var id, sourceRoleAgentID, assignedRoleAgentID, priority, title, summary, status string
		var taskStageRunID, resolutionNote *string
		var required, related []byte
		var blocking, approvalRequired bool
		var created, updated time.Time
		var resolved *time.Time
		if err := rows.Scan(&id, &taskStageRunID, &sourceRoleAgentID, &assignedRoleAgentID, &priority, &title, &summary, &required, &related, &blocking, &approvalRequired, &status, &resolutionNote, &created, &updated, &resolved); err != nil {
			return nil, err
		}
		items = append(items, map[string]any{
			"id": id, "taskStageRunId": taskStageRunID, "sourceRoleAgentId": sourceRoleAgentID, "assignedRoleAgentId": assignedRoleAgentID,
			"priority": priority, "title": title, "summary": summary, "requiredChanges": scanJSONAnyDefault(required, []any{}),
			"relatedFindingKeys": scanJSONAnyDefault(related, []any{}), "blocking": blocking, "approvalRequired": approvalRequired,
			"status": status, "resolutionNote": resolutionNote, "createdAt": formatRuntimeTime(&created), "updatedAt": formatRuntimeTime(&updated), "resolvedAt": formatRuntimeTime(resolved),
		})
	}
	return items, rows.Err()
}

func (api API) loadWorkflowTemplate(ctx context.Context, templateID string) (map[string]any, error) {
	return scanWorkflowTemplate(api.DB.QueryRow(ctx, `SELECT id, project_id, name, description, category, enabled, selectable_by_projects, stage_order_json, created_at, updated_at FROM workflow_templates WHERE id=$1`, templateID))
}

func scanWorkflowTemplate(row pgx.Row) (map[string]any, error) {
	var id, name string
	var projectID, description, category *string
	var enabled, selectable bool
	var stageOrder []byte
	var created, updated time.Time
	if err := row.Scan(&id, &projectID, &name, &description, &category, &enabled, &selectable, &stageOrder, &created, &updated); err != nil {
		return nil, err
	}
	return map[string]any{"id": id, "projectId": projectID, "name": name, "description": description, "category": category, "enabled": enabled, "selectableByProjects": selectable, "stageOrder": scanJSONAnyDefault(stageOrder, []any{}), "createdAt": formatRuntimeTime(&created), "updatedAt": formatRuntimeTime(&updated)}, nil
}

func scanWorkflowTemplateStageRows(rows pgx.Rows) ([]map[string]any, error) {
	items := []map[string]any{}
	for rows.Next() {
		var id, templateID, stageKey, name, mode, primary string
		var enabled bool
		var participants []byte
		var orderIndex int
		if err := rows.Scan(&id, &templateID, &stageKey, &name, &enabled, &mode, &primary, &participants, &orderIndex); err != nil {
			return nil, err
		}
		items = append(items, map[string]any{"id": id, "templateId": templateID, "stageKey": stageKey, "name": name, "enabled": enabled, "mode": mode, "primaryRoleAgentId": primary, "participantRoleAgentIds": scanJSONAnyDefault(participants, []any{}), "orderIndex": orderIndex})
	}
	return items, rows.Err()
}

func (api API) loadTaskWorkflowRun(ctx context.Context, taskID string) (map[string]any, error) {
	var id, templateID, currentStage, status string
	var started, created, updated time.Time
	var finished *time.Time
	err := api.DB.QueryRow(ctx, `SELECT id, template_id, current_stage, status, started_at, finished_at, created_at, updated_at FROM task_workflow_runs WHERE task_id=$1 ORDER BY created_at DESC LIMIT 1`, taskID).Scan(&id, &templateID, &currentStage, &status, &started, &finished, &created, &updated)
	if err != nil {
		return nil, err
	}
	return map[string]any{"id": id, "taskId": taskID, "templateId": templateID, "currentStage": currentStage, "status": status, "startedAt": formatRuntimeTime(&started), "finishedAt": formatRuntimeTime(finished), "createdAt": formatRuntimeTime(&created), "updatedAt": formatRuntimeTime(&updated)}, nil
}

func (api API) loadTaskStageRuns(ctx context.Context, workflowRunID string) ([]map[string]any, error) {
	rows, err := api.DB.Query(ctx, `SELECT id, stage_key, status, primary_role_agent_id, participant_role_agent_ids_json, started_at, finished_at, blocking_reason, approval_state, created_at, updated_at FROM task_stage_runs WHERE workflow_run_id=$1 ORDER BY created_at, stage_key`, workflowRunID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []map[string]any{}
	for rows.Next() {
		var id, stageKey, status, primary, approval string
		var participants []byte
		var started, finished *time.Time
		var blocking *string
		var created, updated time.Time
		if err := rows.Scan(&id, &stageKey, &status, &primary, &participants, &started, &finished, &blocking, &approval, &created, &updated); err != nil {
			return nil, err
		}
		items = append(items, map[string]any{"id": id, "workflowRunId": workflowRunID, "stageKey": stageKey, "status": status, "primaryRoleAgentId": primary, "participantRoleAgentIds": scanJSONAnyDefault(participants, []any{}), "startedAt": formatRuntimeTime(started), "finishedAt": formatRuntimeTime(finished), "blockingReason": blocking, "approvalState": approval, "createdAt": formatRuntimeTime(&created), "updatedAt": formatRuntimeTime(&updated)})
	}
	return items, rows.Err()
}

func jsonOrEmptyArray(value any) []byte {
	if value == nil {
		return []byte(`[]`)
	}
	raw, err := jsonBytes(value)
	if err != nil || raw == nil {
		return []byte(`[]`)
	}
	return raw
}

func jsonOrNull(value any) any {
	if value == nil {
		return nil
	}
	raw, err := jsonBytes(value)
	if err != nil {
		return nil
	}
	return raw
}

func scanJSONAnyDefault(raw []byte, fallback any) any {
	if len(raw) == 0 {
		return fallback
	}
	var out any
	if err := json.Unmarshal(raw, &out); err != nil {
		return fallback
	}
	return out
}

func stringFromMap(item map[string]any, key string) string {
	if value, ok := item[key].(string); ok {
		return value
	}
	return ""
}

func stringFallback(value, fallback string) string {
	if value == "" {
		return fallback
	}
	return value
}

func nilIfEmpty(value string) any {
	if value == "" {
		return nil
	}
	return value
}

func floatFromMap(item map[string]any, key string) float64 {
	switch value := item[key].(type) {
	case float64:
		return value
	case float32:
		return float64(value)
	case int:
		return float64(value)
	default:
		return 0
	}
}

func boolFromMap(item map[string]any, key string) bool {
	if value, ok := item[key].(bool); ok {
		return value
	}
	return false
}
