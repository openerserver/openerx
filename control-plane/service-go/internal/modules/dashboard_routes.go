package modules

import (
	"context"
	"encoding/json"
	"math"
	"net/http"
	"sort"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"

	"openerx/control-plane/service-go/internal/web"
)

func (api API) DashboardRoutes(r chi.Router) {
	r.Get("/governance-overview", api.governanceOverview)
}

func (api API) governanceOverview(w http.ResponseWriter, r *http.Request) {
	rangeValue := parseDashboardRange(r.URL.Query().Get("range"))
	now := time.Now().UTC()
	start, end := dashboardRangeBounds(rangeValue, now)

	summary, err := api.loadGovernanceSummary(r.Context(), start, end)
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	ledgers, err := api.loadGovernanceLedgers(r.Context(), start, end)
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	audits, err := api.loadGovernanceAudits(r.Context(), start, end)
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	taskByID, err := api.loadGovernanceTasks(r.Context(), ledgers, audits)
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	summary["blockedCount"] = 0
	summary["breakerCount"] = 0
	for _, audit := range audits {
		if strings.Contains(audit.Action, "blocked") {
			summary["blockedCount"]++
		}
		if audit.Action == "breaker_tripped" {
			summary["breakerCount"]++
		}
	}
	topRisk := buildGovernanceTopRiskTasks(ledgers, audits, taskByID)
	summary["topRiskTaskCount"] = len(topRisk)
	recentEvents := buildGovernanceRecentEvents(audits, taskByID)

	web.JSON(w, http.StatusOK, map[string]any{
		"range":        rangeValue,
		"generatedAt":  formatRuntimeTime(&now),
		"summary":      summary,
		"topRiskTasks": topRisk,
		"recentEvents": recentEvents,
	})
}

type governanceLedgerRecord struct {
	TaskID            *string
	ProjectID         string
	RuntimeSessionID  *string
	RequestCount      int
	TotalTokens       int
	CostUSD           float64
	JudgeRequestCount int
	HookRequestCount  int
	CandidateCount    int
	FinishedAt        *time.Time
	UpdatedAt         time.Time
	CreatedAt         time.Time
}

type governanceAuditRecord struct {
	ID        string
	ProjectID *string
	TaskID    *string
	SessionID *string
	Action    string
	Detail    map[string]any
	TS        time.Time
}

type governanceTaskRecord struct {
	ID               string
	ProjectID        string
	Title            string
	CurrentSessionID *string
	LastActivityAt   *time.Time
}

type governanceRiskTask struct {
	TaskID                 string  `json:"taskId"`
	ProjectID              string  `json:"projectId"`
	Title                  string  `json:"title"`
	RuntimeSessionID       *string `json:"runtimeSessionId"`
	RequestCount           int     `json:"requestCount"`
	TotalTokens            int     `json:"totalTokens"`
	CostUSD                float64 `json:"costUsd"`
	BlockedCount           int     `json:"blockedCount"`
	BreakerCount           int     `json:"breakerCount"`
	JudgeRequestCount      int     `json:"judgeRequestCount"`
	HookRequestCount       int     `json:"hookRequestCount"`
	ParallelCandidateCount int     `json:"parallelCandidateCount"`
	RiskScore              int     `json:"riskScore"`
	DominantDriver         string  `json:"dominantDriver"`
	LastGuardDecision      *string `json:"lastGuardDecision"`
	LastGuardReason        *string `json:"lastGuardReason"`
	LastBreakerReason      *string `json:"lastBreakerReason"`
	LastActivityAt         any     `json:"lastActivityAt"`
	lastActivityTime       *time.Time
	lastGuardAt            *time.Time
	lastBreakerAt          *time.Time
}

func (api API) loadGovernanceSummary(ctx context.Context, start time.Time, end time.Time) (map[string]int, error) {
	summary := map[string]int{
		"blockedCount": 0, "breakerCount": 0, "topRiskTaskCount": 0,
		"runningTaskCount": 0, "activeSessionCount": 0, "parallelTaskCount": 0, "sequentialChainTaskCount": 0,
		"recentTimelineItemCount": 0, "pausedTaskCount": 0, "failedTaskCount": 0, "activeCandidateCount": 0,
		"pendingChainStepCount": 0, "toolTimelineItemCount": 0, "decisionTimelineItemCount": 0,
	}
	var activeSessions, runningTasks, parallelTasks, sequentialChainTasks, pausedTasks, failedTasks, activeCandidates, pendingChainSteps int
	err := api.DB.QueryRow(ctx, `
		SELECT
			COUNT(DISTINCT current_session_id) FILTER (WHERE current_session_id IS NOT NULL),
			COUNT(*) FILTER (WHERE current_execution_status::text IN ('running','paused') OR lifecycle_status::text='active'),
			COUNT(*) FILTER (WHERE current_execution_mode::text='parallel'),
			COUNT(*) FILTER (WHERE current_execution_mode::text='sequential-chain'),
			COUNT(*) FILTER (WHERE current_execution_status::text='paused'),
			COUNT(*) FILTER (WHERE current_execution_status::text IN ('failed','cancelled') OR lifecycle_status::text IN ('failed','cancelled')),
			COALESCE(SUM(active_candidate_count),0),
			COALESCE(SUM(GREATEST(total_chain_steps - completed_chain_steps, 0)),0)
		FROM task_snapshots
	`).Scan(&activeSessions, &runningTasks, &parallelTasks, &sequentialChainTasks, &pausedTasks, &failedTasks, &activeCandidates, &pendingChainSteps)
	if err != nil {
		return nil, err
	}
	summary["activeSessionCount"] = activeSessions
	summary["runningTaskCount"] = runningTasks
	summary["parallelTaskCount"] = parallelTasks
	summary["sequentialChainTaskCount"] = sequentialChainTasks
	summary["pausedTaskCount"] = pausedTasks
	summary["failedTaskCount"] = failedTasks
	summary["activeCandidateCount"] = activeCandidates
	summary["pendingChainStepCount"] = pendingChainSteps
	var recentTimeline, toolTimeline, decisionTimeline int
	err = api.DB.QueryRow(ctx, `
		SELECT
			COUNT(*),
			COUNT(*) FILTER (WHERE item_kind='operation'),
			COUNT(*) FILTER (WHERE item_kind='task_lifecycle')
		FROM task_timeline_views
		WHERE sort_at >= $1 AND sort_at < $2
	`, start, end).Scan(&recentTimeline, &toolTimeline, &decisionTimeline)
	summary["recentTimelineItemCount"] = recentTimeline
	summary["toolTimelineItemCount"] = toolTimeline
	summary["decisionTimelineItemCount"] = decisionTimeline
	return summary, err
}

func (api API) loadGovernanceLedgers(ctx context.Context, start time.Time, end time.Time) ([]governanceLedgerRecord, error) {
	rows, err := api.DB.Query(ctx, `
		SELECT task_id, project_id, runtime_session_id, request_count, total_tokens, cost_usd,
		       judge_request_count, hook_request_count, candidate_count, finished_at, updated_at, created_at
		FROM runtime_usage_ledgers
		WHERE created_at >= $1 AND created_at < $2
		ORDER BY created_at DESC
	`, start, end)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []governanceLedgerRecord{}
	for rows.Next() {
		var item governanceLedgerRecord
		if err := rows.Scan(&item.TaskID, &item.ProjectID, &item.RuntimeSessionID, &item.RequestCount, &item.TotalTokens,
			&item.CostUSD, &item.JudgeRequestCount, &item.HookRequestCount, &item.CandidateCount, &item.FinishedAt,
			&item.UpdatedAt, &item.CreatedAt); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (api API) loadGovernanceAudits(ctx context.Context, start time.Time, end time.Time) ([]governanceAuditRecord, error) {
	rows, err := api.DB.Query(ctx, `
		SELECT id, project_id, task_id, session_id, action, detail, ts
		FROM audit_events
		WHERE event_type='paid_execution' AND ts >= $1 AND ts < $2
		ORDER BY ts DESC
	`, start, end)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []governanceAuditRecord{}
	for rows.Next() {
		var item governanceAuditRecord
		var detail []byte
		if err := rows.Scan(&item.ID, &item.ProjectID, &item.TaskID, &item.SessionID, &item.Action, &detail, &item.TS); err != nil {
			return nil, err
		}
		item.Detail = map[string]any{}
		if len(detail) > 0 {
			_ = json.Unmarshal(detail, &item.Detail)
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (api API) loadGovernanceTasks(ctx context.Context, ledgers []governanceLedgerRecord, audits []governanceAuditRecord) (map[string]governanceTaskRecord, error) {
	seen := map[string]bool{}
	taskIDs := []string{}
	for _, ledger := range ledgers {
		if ledger.TaskID != nil && !seen[*ledger.TaskID] {
			seen[*ledger.TaskID] = true
			taskIDs = append(taskIDs, *ledger.TaskID)
		}
	}
	for _, audit := range audits {
		if audit.TaskID != nil && !seen[*audit.TaskID] {
			seen[*audit.TaskID] = true
			taskIDs = append(taskIDs, *audit.TaskID)
		}
	}
	if len(taskIDs) == 0 {
		return map[string]governanceTaskRecord{}, nil
	}
	rows, err := api.DB.Query(ctx, `
		SELECT t.id, t.project_id, t.title, tsess.runtime_session_id,
		       COALESCE(s.last_activity_at, t.done_at, t.activated_at, t.updated_at, t.created_at) AS last_activity_at
		FROM tasks t
		LEFT JOIN task_snapshots s ON s.task_id=t.id
		LEFT JOIN task_sessions tsess ON tsess.id=s.current_session_id
		WHERE t.id = ANY($1::text[])
	`, taskIDs)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := map[string]governanceTaskRecord{}
	for rows.Next() {
		var item governanceTaskRecord
		if err := rows.Scan(&item.ID, &item.ProjectID, &item.Title, &item.CurrentSessionID, &item.LastActivityAt); err != nil {
			return nil, err
		}
		items[item.ID] = item
	}
	return items, rows.Err()
}

func buildGovernanceTopRiskTasks(ledgers []governanceLedgerRecord, audits []governanceAuditRecord, taskByID map[string]governanceTaskRecord) []map[string]any {
	items := map[string]*governanceRiskTask{}
	getOrCreate := func(taskID string, projectID string, title string, runtimeSessionID *string, lastActivity *time.Time, driver string) *governanceRiskTask {
		if existing := items[taskID]; existing != nil {
			return existing
		}
		created := &governanceRiskTask{
			TaskID: taskID, ProjectID: projectID, Title: title, RuntimeSessionID: runtimeSessionID,
			DominantDriver: driver, lastActivityTime: lastActivity,
		}
		created.LastActivityAt = formatRuntimeTime(lastActivity)
		items[taskID] = created
		return created
	}
	for _, ledger := range ledgers {
		if ledger.TaskID == nil {
			continue
		}
		task := taskByID[*ledger.TaskID]
		title := task.Title
		if title == "" {
			title = *ledger.TaskID
		}
		sessionID := task.CurrentSessionID
		if sessionID == nil {
			sessionID = ledger.RuntimeSessionID
		}
		last := latestTime(ledger.FinishedAt, &ledger.UpdatedAt, &ledger.CreatedAt)
		if task.LastActivityAt != nil && task.LastActivityAt.After(*last) {
			last = task.LastActivityAt
		}
		item := getOrCreate(*ledger.TaskID, ledger.ProjectID, title, sessionID, last, "cost")
		item.RequestCount += ledger.RequestCount
		item.TotalTokens += ledger.TotalTokens
		item.CostUSD = math.Round((item.CostUSD+ledger.CostUSD)*10000) / 10000
		item.JudgeRequestCount += ledger.JudgeRequestCount
		item.HookRequestCount += ledger.HookRequestCount
		if ledger.CandidateCount > 1 {
			item.ParallelCandidateCount += ledger.CandidateCount - 1
		}
		if item.RuntimeSessionID == nil {
			item.RuntimeSessionID = ledger.RuntimeSessionID
		}
		updateRiskLastActivity(item, last)
	}
	for _, audit := range audits {
		if audit.TaskID == nil {
			continue
		}
		task := taskByID[*audit.TaskID]
		projectID := ""
		if audit.ProjectID != nil {
			projectID = *audit.ProjectID
		}
		if projectID == "" {
			projectID = task.ProjectID
		}
		title := task.Title
		if title == "" {
			title = *audit.TaskID
		}
		sessionID := task.CurrentSessionID
		if sessionID == nil {
			sessionID = audit.SessionID
		}
		item := getOrCreate(*audit.TaskID, projectID, title, sessionID, &audit.TS, "blocked")
		if strings.Contains(audit.Action, "blocked") {
			item.BlockedCount++
		}
		if audit.Action == "breaker_tripped" {
			item.BreakerCount++
			if item.lastBreakerAt == nil || audit.TS.After(*item.lastBreakerAt) {
				item.LastBreakerReason = detailString(audit.Detail, "breakerReason", "reason")
				item.lastBreakerAt = &audit.TS
			}
		}
		if isGuardAudit(audit) && (item.lastGuardAt == nil || audit.TS.After(*item.lastGuardAt)) {
			item.LastGuardDecision = detailString(audit.Detail, "guardDecision")
			item.LastGuardReason = detailString(audit.Detail, "guardReason", "reason")
			item.lastGuardAt = &audit.TS
		}
		updateRiskLastActivity(item, &audit.TS)
	}
	list := make([]*governanceRiskTask, 0, len(items))
	for _, item := range items {
		item.RiskScore = item.BlockedCount*5 + item.BreakerCount*7 + item.ParallelCandidateCount + item.JudgeRequestCount + item.HookRequestCount + int(math.Min(10, math.Round(item.CostUSD*10))) + int(math.Round(float64(item.RequestCount)/2))
		item.DominantDriver = dominantGovernanceDriver(item)
		list = append(list, item)
	}
	sort.Slice(list, func(i, j int) bool {
		if list[i].RiskScore != list[j].RiskScore {
			return list[i].RiskScore > list[j].RiskScore
		}
		if list[i].CostUSD != list[j].CostUSD {
			return list[i].CostUSD > list[j].CostUSD
		}
		return list[i].RequestCount > list[j].RequestCount
	})
	if len(list) > 5 {
		list = list[:5]
	}
	out := []map[string]any{}
	for _, item := range list {
		out = append(out, map[string]any{
			"taskId": item.TaskID, "projectId": item.ProjectID, "title": item.Title, "runtimeSessionId": item.RuntimeSessionID,
			"requestCount": item.RequestCount, "totalTokens": item.TotalTokens, "costUsd": item.CostUSD,
			"blockedCount": item.BlockedCount, "breakerCount": item.BreakerCount, "judgeRequestCount": item.JudgeRequestCount,
			"hookRequestCount": item.HookRequestCount, "parallelCandidateCount": item.ParallelCandidateCount,
			"riskScore": item.RiskScore, "dominantDriver": item.DominantDriver,
			"lastGuardDecision": item.LastGuardDecision, "lastGuardReason": item.LastGuardReason, "lastBreakerReason": item.LastBreakerReason,
			"lastActivityAt": item.LastActivityAt,
		})
	}
	return out
}

func buildGovernanceRecentEvents(audits []governanceAuditRecord, taskByID map[string]governanceTaskRecord) []map[string]any {
	events := []map[string]any{}
	for _, audit := range audits {
		if !isRelevantGovernanceAudit(audit) {
			continue
		}
		eventKind := "guard"
		reason := detailString(audit.Detail, "guardReason", "reason")
		if audit.Action == "breaker_tripped" {
			eventKind = "breaker"
			reason = detailString(audit.Detail, "breakerReason", "reason")
		}
		title := "未关联任务"
		if audit.TaskID != nil {
			if task := taskByID[*audit.TaskID]; task.Title != "" {
				title = task.Title
			} else {
				title = *audit.TaskID
			}
		} else if audit.ProjectID != nil {
			title = *audit.ProjectID
		}
		projectID := ""
		if audit.ProjectID != nil {
			projectID = *audit.ProjectID
		}
		events = append(events, map[string]any{
			"id": audit.ID, "projectId": projectID, "taskId": audit.TaskID, "title": title,
			"runtimeSessionId": audit.SessionID, "eventKind": eventKind, "action": audit.Action,
			"guardDecision": detailString(audit.Detail, "guardDecision"), "reason": reason,
			"occurredAt": formatRuntimeTime(&audit.TS),
		})
		if len(events) == 8 {
			break
		}
	}
	return events
}

func parseDashboardRange(value string) string {
	switch value {
	case "24h", "7d", "30d", "monthly":
		return value
	default:
		return "24h"
	}
}

func dashboardRangeBounds(rangeValue string, now time.Time) (time.Time, time.Time) {
	switch rangeValue {
	case "7d":
		return now.Add(-7 * 24 * time.Hour), now
	case "30d":
		return now.Add(-30 * 24 * time.Hour), now
	case "monthly":
		start := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, time.UTC)
		return start, start.AddDate(0, 1, 0)
	default:
		return now.Add(-24 * time.Hour), now
	}
}

func latestTime(values ...*time.Time) *time.Time {
	var latest *time.Time
	for _, value := range values {
		if value == nil {
			continue
		}
		if latest == nil || value.After(*latest) {
			copyValue := *value
			latest = &copyValue
		}
	}
	return latest
}

func updateRiskLastActivity(item *governanceRiskTask, candidate *time.Time) {
	if candidate == nil {
		return
	}
	if item.lastActivityTime == nil || candidate.After(*item.lastActivityTime) {
		copyValue := *candidate
		item.lastActivityTime = &copyValue
		item.LastActivityAt = formatRuntimeTime(&copyValue)
	}
}

func dominantGovernanceDriver(item *governanceRiskTask) string {
	if item.BreakerCount > 0 {
		return "breaker"
	}
	if item.BlockedCount > 0 {
		return "blocked"
	}
	if item.ParallelCandidateCount >= item.HookRequestCount && item.ParallelCandidateCount >= item.JudgeRequestCount && item.ParallelCandidateCount > 0 {
		return "parallel"
	}
	if item.HookRequestCount >= item.JudgeRequestCount && item.HookRequestCount > 0 {
		return "hook"
	}
	if item.JudgeRequestCount > 0 {
		return "judge"
	}
	return "cost"
}

func isRelevantGovernanceAudit(audit governanceAuditRecord) bool {
	return audit.Action == "breaker_tripped" || strings.Contains(audit.Action, "blocked") ||
		detailString(audit.Detail, "guardDecision", "guardReason", "breakerReason") != nil
}

func isGuardAudit(audit governanceAuditRecord) bool {
	return strings.Contains(audit.Action, "blocked") || detailString(audit.Detail, "guardDecision", "guardReason") != nil
}

func detailString(detail map[string]any, keys ...string) *string {
	for _, key := range keys {
		if value, ok := detail[key].(string); ok {
			return &value
		}
	}
	return nil
}
