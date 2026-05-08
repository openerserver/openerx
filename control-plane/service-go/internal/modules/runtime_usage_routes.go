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

type runtimeLedgerSyncRequest struct {
	TaskID                   string  `json:"taskId"`
	AgentRunID               string  `json:"agentRunId"`
	RuntimeSessionID         string  `json:"runtimeSessionId"`
	ExecutionSource          string  `json:"executionSource"`
	EntrypointType           string  `json:"entrypointType"`
	OrchestrationFingerprint *string `json:"orchestrationFingerprint"`
	DefaultProviderID        *string `json:"defaultProviderId"`
	DefaultModelID           *string `json:"defaultModelId"`
	RequestCountDelta        int     `json:"requestCountDelta"`
	StepCountDelta           int     `json:"stepCountDelta"`
	InputTokens              int     `json:"inputTokens"`
	OutputTokens             int     `json:"outputTokens"`
	TotalTokens              int     `json:"totalTokens"`
	CostUSD                  float64 `json:"costUsd"`
	CandidateCount           int     `json:"candidateCount"`
	JudgeRequestCountDelta   int     `json:"judgeRequestCountDelta"`
	HookRequestCountDelta    int     `json:"hookRequestCountDelta"`
	Status                   string  `json:"status"`
	StartedAt                *string `json:"startedAt"`
	FinishedAt               *string `json:"finishedAt"`
	Step                     struct {
		ID                  string  `json:"id"`
		StepType            string  `json:"stepType"`
		TriggerType         *string `json:"triggerType"`
		HookID              *string `json:"hookId"`
		CandidateIndex      *int    `json:"candidateIndex"`
		RequestIndex        int     `json:"requestIndex"`
		ProviderID          *string `json:"providerId"`
		ModelID             *string `json:"modelId"`
		InputTokens         int     `json:"inputTokens"`
		OutputTokens        int     `json:"outputTokens"`
		TotalTokens         int     `json:"totalTokens"`
		CostUSD             float64 `json:"costUsd"`
		AmplificationSource *string `json:"amplificationSource"`
		Status              string  `json:"status"`
		StartedAt           *string `json:"startedAt"`
		FinishedAt          *string `json:"finishedAt"`
	} `json:"step"`
}

func (api API) syncRuntimeUsageLedger(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectId")
	var body runtimeLedgerSyncRequest
	if !decodeBody(w, r, &body) {
		return
	}
	if body.ExecutionSource == "" {
		body.ExecutionSource = "task-execute"
	}
	if body.EntrypointType == "" {
		body.EntrypointType = "single"
	}
	if body.Status == "" {
		body.Status = "completed"
	}
	if body.RuntimeSessionID == "" {
		body.RuntimeSessionID = uuid.NewString()
	}
	if body.CandidateCount == 0 {
		body.CandidateCount = 1
	}
	requestDelta := body.RequestCountDelta
	stepDelta := body.StepCountDelta
	if requestDelta == 0 {
		requestDelta = 1
	}
	if stepDelta == 0 {
		stepDelta = 1
	}
	startedAt := parseOptionalRuntimeTime(body.StartedAt)
	finishedAt := parseOptionalRuntimeTime(body.FinishedAt)
	ledgerID := uuid.NewString()
	now := time.Now().UTC()
	tx, err := api.DB.Begin(r.Context())
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	defer func() { _ = tx.Rollback(context.Background()) }()
	tag, err := tx.Exec(r.Context(), `
		INSERT INTO runtime_usage_ledgers (
			id, project_id, task_id, agent_run_id, runtime_session_id, execution_source, entrypoint_type,
			orchestration_fingerprint, default_provider_id, default_model_id, request_count, step_count,
			input_tokens, output_tokens, total_tokens, cost_usd, candidate_count, judge_request_count,
			hook_request_count, status, started_at, finished_at, synced_at, created_at, updated_at
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$23,$23)
		ON CONFLICT (runtime_session_id) DO NOTHING
	`, ledgerID, projectID, nullString(body.TaskID), nullString(body.AgentRunID), body.RuntimeSessionID, body.ExecutionSource, body.EntrypointType,
		body.OrchestrationFingerprint, body.DefaultProviderID, body.DefaultModelID, requestDelta, stepDelta, body.InputTokens, body.OutputTokens,
		body.TotalTokens, body.CostUSD, body.CandidateCount, body.JudgeRequestCountDelta, body.HookRequestCountDelta, body.Status, startedAt, finishedAt, now)
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	newLedger := tag.RowsAffected() > 0
	var actualLedgerID string
	if err := tx.QueryRow(r.Context(), `SELECT id FROM runtime_usage_ledgers WHERE runtime_session_id=$1`, body.RuntimeSessionID).Scan(&actualLedgerID); err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	stepID := body.Step.ID
	if stepID == "" {
		stepID = uuid.NewString()
	}
	stepType := body.Step.StepType
	if stepType == "" {
		stepType = "execution"
	}
	stepStatus := body.Step.Status
	if stepStatus == "" {
		stepStatus = "completed"
	}
	stepStartedAt := parseOptionalRuntimeTime(body.Step.StartedAt)
	stepFinishedAt := parseOptionalRuntimeTime(body.Step.FinishedAt)
	if stepStartedAt == nil {
		stepStartedAt = startedAt
	}
	if stepFinishedAt == nil {
		stepFinishedAt = finishedAt
	}
	stepTag, err := tx.Exec(r.Context(), `
		INSERT INTO runtime_usage_ledger_steps (
			id, ledger_id, project_id, task_id, agent_run_id, runtime_session_id, step_type, request_index,
			trigger_type, hook_id, candidate_index, provider_id, model_id, input_tokens, output_tokens,
			total_tokens, cost_usd, amplification_source, status, started_at, finished_at, created_at, updated_at
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$22)
		ON CONFLICT (id) DO NOTHING
	`, stepID, actualLedgerID, projectID, nullString(body.TaskID), nullString(body.AgentRunID), body.RuntimeSessionID, stepType, body.Step.RequestIndex,
		body.Step.TriggerType, body.Step.HookID, body.Step.CandidateIndex, body.Step.ProviderID, body.Step.ModelID, body.Step.InputTokens,
		body.Step.OutputTokens, body.Step.TotalTokens, body.Step.CostUSD, body.Step.AmplificationSource, stepStatus, stepStartedAt, stepFinishedAt, now)
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	stepInserted := stepTag.RowsAffected() > 0
	deltaApplied := stepInserted
	if stepInserted && !newLedger {
		_, err = tx.Exec(r.Context(), `
			UPDATE runtime_usage_ledgers SET
				request_count=request_count+$2,
				step_count=step_count+$3,
				input_tokens=input_tokens+$4,
				output_tokens=output_tokens+$5,
				total_tokens=total_tokens+$6,
				cost_usd=cost_usd+$7,
				candidate_count=candidate_count+$8,
				judge_request_count=judge_request_count+$9,
				hook_request_count=hook_request_count+$10,
				status=$11,
				finished_at=COALESCE($12, finished_at),
				synced_at=$13,
				updated_at=$13
			WHERE id=$1
		`, actualLedgerID, requestDelta, stepDelta, body.InputTokens, body.OutputTokens, body.TotalTokens, body.CostUSD, body.CandidateCount,
			body.JudgeRequestCountDelta, body.HookRequestCountDelta, body.Status, finishedAt, now)
	} else {
		_, err = tx.Exec(r.Context(), `
			UPDATE runtime_usage_ledgers SET
				status=$2,
				finished_at=COALESCE($3, finished_at),
				synced_at=$4,
				updated_at=$4
			WHERE id=$1
		`, actualLedgerID, body.Status, finishedAt, now)
	}
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	ledger, err := loadRuntimeUsageLedger(r.Context(), tx, projectID, actualLedgerID)
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	web.JSON(w, http.StatusOK, map[string]any{
		"ledger": ledger, "stepInserted": stepInserted, "deltaApplied": deltaApplied,
	})
}

func (api API) listRuntimeUsageLedgers(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectId")
	taskID := nullString(r.URL.Query().Get("taskId"))
	status := nullString(r.URL.Query().Get("status"))
	limit := parseLimit(r, 50, 200)
	rows, err := api.DB.Query(r.Context(), `
		SELECT id, project_id, task_id, agent_run_id, runtime_session_id, execution_source, entrypoint_type,
		       default_provider_id, default_model_id, request_count, step_count, input_tokens, output_tokens,
		       total_tokens, cost_usd, candidate_count, judge_request_count, hook_request_count, status,
		       started_at, finished_at, synced_at, created_at, updated_at
		FROM runtime_usage_ledgers
		WHERE project_id=$1
		  AND ($2::text IS NULL OR task_id=$2)
		  AND ($3::runtime_usage_ledger_status IS NULL OR status=$3::runtime_usage_ledger_status)
		ORDER BY updated_at DESC
		LIMIT $4
	`, projectID, taskID, status, limit)
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	defer rows.Close()
	items := []map[string]any{}
	for rows.Next() {
		item, err := scanRuntimeUsageLedger(rows)
		if err != nil {
			web.Error(w, http.StatusInternalServerError, err.Error())
			return
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	var ledgerCount, requestCount, stepCount, totalTokens int
	var costUSD float64
	if err := api.DB.QueryRow(r.Context(), `
		SELECT COUNT(*), COALESCE(SUM(request_count),0), COALESCE(SUM(step_count),0),
		       COALESCE(SUM(total_tokens),0), COALESCE(SUM(cost_usd),0)
		FROM runtime_usage_ledgers
		WHERE project_id=$1
		  AND ($2::text IS NULL OR task_id=$2)
		  AND ($3::runtime_usage_ledger_status IS NULL OR status=$3::runtime_usage_ledger_status)
	`, projectID, taskID, status).Scan(&ledgerCount, &requestCount, &stepCount, &totalTokens, &costUSD); err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	web.JSON(w, http.StatusOK, map[string]any{
		"projectId": projectID,
		"totals": map[string]any{
			"ledgerCount":  ledgerCount,
			"requestCount": requestCount,
			"stepCount":    stepCount,
			"totalTokens":  totalTokens,
			"costUsd":      costUSD,
		},
		"items": items,
	})
}

func (api API) getRuntimeUsageLedger(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectId")
	ledgerID := chi.URLParam(r, "ledgerId")
	ledger, err := loadRuntimeUsageLedger(r.Context(), api.DB, projectID, ledgerID)
	if err != nil {
		if err == pgx.ErrNoRows {
			web.Error(w, http.StatusNotFound, "Runtime usage ledger not found")
			return
		}
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	rows, err := api.DB.Query(r.Context(), `
		SELECT id, ledger_id, project_id, task_id, agent_run_id, runtime_session_id, step_type, request_index,
		       provider_id, model_id, input_tokens, output_tokens, total_tokens, cost_usd, status,
		       started_at, finished_at, created_at, updated_at
		FROM runtime_usage_ledger_steps
		WHERE project_id=$1 AND ledger_id=$2
		ORDER BY request_index, created_at, id
	`, projectID, ledgerID)
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	defer rows.Close()
	steps := []map[string]any{}
	breakdown := map[string]int{}
	for rows.Next() {
		item, err := scanRuntimeUsageLedgerStep(rows)
		if err != nil {
			web.Error(w, http.StatusInternalServerError, err.Error())
			return
		}
		stepType, _ := item["stepType"].(string)
		breakdown[stepType]++
		steps = append(steps, item)
	}
	if err := rows.Err(); err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	web.JSON(w, http.StatusOK, map[string]any{
		"ledger":    ledger,
		"steps":     steps,
		"breakdown": map[string]any{"byStepType": breakdown},
	})
}

func (api API) getRuntimeUsageBaseline(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectId")
	providerID := r.URL.Query().Get("providerId")
	modelID := r.URL.Query().Get("modelId")
	entrypointType := r.URL.Query().Get("entrypointType")
	fingerprint := r.URL.Query().Get("orchestrationFingerprint")

	rows, err := api.DB.Query(r.Context(), `
		SELECT id, project_id, provider_id, model_id, entrypoint_type, orchestration_fingerprint, match_scope,
		       sample_size, p50_request_count, p90_request_count, p50_input_tokens, p90_input_tokens,
		       p50_output_tokens, p90_output_tokens, p50_total_tokens, p90_total_tokens, p50_cost_usd,
		       p90_cost_usd, last_ledger_at, generated_at, created_at, updated_at
		FROM runtime_usage_baselines
		WHERE project_id=$1
		  AND ($2::text='' OR provider_id=$2 OR provider_id='')
		  AND ($3::text='' OR model_id=$3 OR model_id='')
		  AND ($4::text='' OR entrypoint_type=$4 OR entrypoint_type='')
		  AND ($5::text='' OR orchestration_fingerprint=$5 OR orchestration_fingerprint='')
		ORDER BY
		  CASE match_scope
		    WHEN 'project+provider+model+entrypoint+fingerprint' THEN 1
		    WHEN 'project+provider+model+entrypoint' THEN 2
		    WHEN 'project+provider+model' THEN 3
		    WHEN 'project+entrypoint' THEN 4
		    ELSE 5
		  END,
		  generated_at DESC
	`, projectID, providerID, modelID, entrypointType, fingerprint)
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	defer rows.Close()
	candidates := []map[string]any{}
	for rows.Next() {
		item, err := scanRuntimeUsageBaseline(rows)
		if err != nil {
			web.Error(w, http.StatusInternalServerError, err.Error())
			return
		}
		candidates = append(candidates, item)
	}
	if err := rows.Err(); err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	if len(candidates) == 0 {
		generated, err := api.deriveRuntimeUsageBaseline(r, projectID, providerID, modelID, entrypointType, fingerprint)
		if err != nil {
			web.Error(w, http.StatusInternalServerError, err.Error())
			return
		}
		if generated != nil {
			candidates = append(candidates, generated)
		}
	}
	var baseline any
	for _, item := range candidates {
		if sampleSize, _ := item["sampleSize"].(int); sampleSize > 0 {
			baseline = item
			break
		}
	}
	web.JSON(w, http.StatusOK, map[string]any{
		"projectId": projectID,
		"query": map[string]any{
			"providerId": providerIDOrNil(providerID), "modelId": providerIDOrNil(modelID),
			"entrypointType": providerIDOrNil(entrypointType), "orchestrationFingerprint": providerIDOrNil(fingerprint),
		},
		"baseline":   baseline,
		"candidates": candidates,
	})
}

func (api API) deriveRuntimeUsageBaseline(r *http.Request, projectID string, providerID string, modelID string, entrypointType string, fingerprint string) (map[string]any, error) {
	var sampleSize int
	var p50Request, p90Request, p50Input, p90Input, p50Output, p90Output, p50Total, p90Total, p50Cost, p90Cost *float64
	var lastLedgerAt *time.Time
	err := api.DB.QueryRow(r.Context(), `
		SELECT COUNT(*)::int,
		       percentile_cont(0.5) WITHIN GROUP (ORDER BY request_count)::float8,
		       percentile_cont(0.9) WITHIN GROUP (ORDER BY request_count)::float8,
		       percentile_cont(0.5) WITHIN GROUP (ORDER BY input_tokens)::float8,
		       percentile_cont(0.9) WITHIN GROUP (ORDER BY input_tokens)::float8,
		       percentile_cont(0.5) WITHIN GROUP (ORDER BY output_tokens)::float8,
		       percentile_cont(0.9) WITHIN GROUP (ORDER BY output_tokens)::float8,
		       percentile_cont(0.5) WITHIN GROUP (ORDER BY total_tokens)::float8,
		       percentile_cont(0.9) WITHIN GROUP (ORDER BY total_tokens)::float8,
		       percentile_cont(0.5) WITHIN GROUP (ORDER BY cost_usd)::float8,
		       percentile_cont(0.9) WITHIN GROUP (ORDER BY cost_usd)::float8,
		       MAX(synced_at)
		FROM runtime_usage_ledgers
		WHERE project_id=$1
		  AND ($2::text='' OR default_provider_id=$2)
		  AND ($3::text='' OR default_model_id=$3)
		  AND ($4::text='' OR entrypoint_type=$4)
		  AND ($5::text='' OR orchestration_fingerprint=$5)
	`, projectID, providerID, modelID, entrypointType, fingerprint).Scan(&sampleSize, &p50Request, &p90Request, &p50Input, &p90Input, &p50Output, &p90Output, &p50Total, &p90Total, &p50Cost, &p90Cost, &lastLedgerAt)
	if err != nil {
		return nil, err
	}
	if sampleSize == 0 {
		return nil, nil
	}
	now := time.Now().UTC()
	return map[string]any{
		"id": "derived:" + projectID, "projectId": projectID, "providerId": providerID, "modelId": modelID,
		"entrypointType": entrypointType, "orchestrationFingerprint": fingerprint, "matchScope": "project",
		"sampleSize": sampleSize, "p50RequestCount": p50Request, "p90RequestCount": p90Request,
		"p50InputTokens": p50Input, "p90InputTokens": p90Input, "p50OutputTokens": p50Output,
		"p90OutputTokens": p90Output, "p50TotalTokens": p50Total, "p90TotalTokens": p90Total,
		"p50CostUsd": p50Cost, "p90CostUsd": p90Cost, "lastLedgerAt": formatRuntimeTime(lastLedgerAt),
		"generatedAt": formatRuntimeTime(&now), "createdAt": formatRuntimeTime(&now), "updatedAt": formatRuntimeTime(&now),
	}, nil
}

func providerIDOrNil(value string) any {
	if value == "" {
		return nil
	}
	return value
}

type runtimeLedgerQuerier interface {
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

func loadRuntimeUsageLedger(ctx context.Context, q runtimeLedgerQuerier, projectID string, ledgerID string) (map[string]any, error) {
	row := q.QueryRow(ctx, `
		SELECT id, project_id, task_id, agent_run_id, runtime_session_id, execution_source, entrypoint_type,
		       default_provider_id, default_model_id, request_count, step_count, input_tokens, output_tokens,
		       total_tokens, cost_usd, candidate_count, judge_request_count, hook_request_count, status,
		       started_at, finished_at, synced_at, created_at, updated_at
		FROM runtime_usage_ledgers
		WHERE project_id=$1 AND id=$2
	`, projectID, ledgerID)
	return scanRuntimeUsageLedger(row)
}

func scanRuntimeUsageLedger(row pgx.Row) (map[string]any, error) {
	var id, projectID, runtimeSessionID, executionSource, entrypointType, status string
	var taskID, agentRunID, defaultProviderID, defaultModelID *string
	var requestCount, stepCount, inputTokens, outputTokens, totalTokens, candidateCount, judgeRequestCount, hookRequestCount int
	var costUSD float64
	var startedAt, finishedAt, syncedAt, createdAt, updatedAt *time.Time
	if err := row.Scan(&id, &projectID, &taskID, &agentRunID, &runtimeSessionID, &executionSource, &entrypointType,
		&defaultProviderID, &defaultModelID, &requestCount, &stepCount, &inputTokens, &outputTokens, &totalTokens,
		&costUSD, &candidateCount, &judgeRequestCount, &hookRequestCount, &status, &startedAt, &finishedAt,
		&syncedAt, &createdAt, &updatedAt); err != nil {
		return nil, err
	}
	return map[string]any{
		"id": id, "projectId": projectID, "taskId": taskID, "agentRunId": agentRunID,
		"runtimeSessionId": runtimeSessionID, "executionSource": executionSource, "entrypointType": entrypointType,
		"defaultProviderId": defaultProviderID, "defaultModelId": defaultModelID,
		"requestCount": requestCount, "stepCount": stepCount, "inputTokens": inputTokens,
		"outputTokens": outputTokens, "totalTokens": totalTokens, "costUsd": costUSD,
		"candidateCount": candidateCount, "judgeRequestCount": judgeRequestCount,
		"hookRequestCount": hookRequestCount, "status": status,
		"startedAt": formatRuntimeTime(startedAt), "finishedAt": formatRuntimeTime(finishedAt),
		"syncedAt": formatRuntimeTime(syncedAt), "createdAt": formatRuntimeTime(createdAt), "updatedAt": formatRuntimeTime(updatedAt),
	}, nil
}

func scanRuntimeUsageBaseline(row pgx.Row) (map[string]any, error) {
	var id, projectID, providerID, modelID, entrypointType, fingerprint, matchScope string
	var sampleSize int
	var p50Request, p90Request, p50Input, p90Input, p50Output, p90Output, p50Total, p90Total, p50Cost, p90Cost *float64
	var lastLedgerAt, generatedAt, createdAt, updatedAt *time.Time
	if err := row.Scan(&id, &projectID, &providerID, &modelID, &entrypointType, &fingerprint, &matchScope,
		&sampleSize, &p50Request, &p90Request, &p50Input, &p90Input, &p50Output, &p90Output, &p50Total,
		&p90Total, &p50Cost, &p90Cost, &lastLedgerAt, &generatedAt, &createdAt, &updatedAt); err != nil {
		return nil, err
	}
	return map[string]any{
		"id": id, "projectId": projectID, "providerId": providerID, "modelId": modelID,
		"entrypointType": entrypointType, "orchestrationFingerprint": fingerprint, "matchScope": matchScope,
		"sampleSize": sampleSize, "p50RequestCount": p50Request, "p90RequestCount": p90Request,
		"p50InputTokens": p50Input, "p90InputTokens": p90Input, "p50OutputTokens": p50Output,
		"p90OutputTokens": p90Output, "p50TotalTokens": p50Total, "p90TotalTokens": p90Total,
		"p50CostUsd": p50Cost, "p90CostUsd": p90Cost, "lastLedgerAt": formatRuntimeTime(lastLedgerAt),
		"generatedAt": formatRuntimeTime(generatedAt), "createdAt": formatRuntimeTime(createdAt), "updatedAt": formatRuntimeTime(updatedAt),
	}, nil
}

func scanRuntimeUsageLedgerStep(row pgx.Row) (map[string]any, error) {
	var id, ledgerID, projectID, stepType, status string
	var taskID, agentRunID, runtimeSessionID, providerID, modelID *string
	var requestIndex, inputTokens, outputTokens, totalTokens int
	var costUSD float64
	var startedAt, finishedAt, createdAt, updatedAt *time.Time
	if err := row.Scan(&id, &ledgerID, &projectID, &taskID, &agentRunID, &runtimeSessionID, &stepType, &requestIndex,
		&providerID, &modelID, &inputTokens, &outputTokens, &totalTokens, &costUSD, &status,
		&startedAt, &finishedAt, &createdAt, &updatedAt); err != nil {
		return nil, err
	}
	return map[string]any{
		"id": id, "ledgerId": ledgerID, "projectId": projectID, "taskId": taskID, "agentRunId": agentRunID,
		"runtimeSessionId": runtimeSessionID, "stepType": stepType, "requestIndex": requestIndex,
		"providerId": providerID, "modelId": modelID, "inputTokens": inputTokens, "outputTokens": outputTokens,
		"totalTokens": totalTokens, "costUsd": costUSD, "status": status,
		"startedAt": formatRuntimeTime(startedAt), "finishedAt": formatRuntimeTime(finishedAt),
		"createdAt": formatRuntimeTime(createdAt), "updatedAt": formatRuntimeTime(updatedAt),
	}, nil
}

func parseOptionalRuntimeTime(value *string) *time.Time {
	if value == nil || *value == "" {
		return nil
	}
	if parsed, err := time.Parse(time.RFC3339Nano, *value); err == nil {
		utc := parsed.UTC()
		return &utc
	}
	return nil
}

func formatRuntimeTime(value *time.Time) any {
	if value == nil || value.IsZero() {
		return nil
	}
	return value.UTC().Format("2006-01-02T15:04:05.000Z")
}
