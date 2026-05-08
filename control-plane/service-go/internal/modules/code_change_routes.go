package modules

import (
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"openerx/control-plane/service-go/internal/web"
)

type codeChangeRequest struct {
	TaskID            string  `json:"taskId"`
	RepoID            *string `json:"repoId"`
	AgentRunID        *string `json:"agentRunId"`
	ChangeSource      string  `json:"changeSource"`
	CommitSha         *string `json:"commitSha"`
	CommitAuthorName  *string `json:"commitAuthorName"`
	CommitAuthorEmail *string `json:"commitAuthorEmail"`
	CommitMessage     *string `json:"commitMessage"`
	BranchName        *string `json:"branchName"`
	Summary           *string `json:"summary"`
	Files             []struct {
		FilePath   string  `json:"filePath"`
		ChangeType string  `json:"changeType"`
		OldPath    *string `json:"oldPath"`
		Insertions int     `json:"insertions"`
		Deletions  int     `json:"deletions"`
	} `json:"files"`
}

func (api API) CodeChangeRoutes(r chi.Router) {
	r.Post("/", api.createCodeChange)
}

func (api API) createCodeChange(w http.ResponseWriter, r *http.Request) {
	var body codeChangeRequest
	if !decodeBody(w, r, &body) {
		return
	}
	if body.TaskID == "" || body.ChangeSource == "" {
		web.Error(w, http.StatusBadRequest, "taskId and changeSource are required")
		return
	}
	var projectID string
	if err := api.DB.QueryRow(r.Context(), `SELECT project_id FROM tasks WHERE id=$1`, body.TaskID).Scan(&projectID); err != nil {
		web.Error(w, http.StatusNotFound, "Task not found")
		return
	}
	id := uuid.NewString()
	now := time.Now().UTC()
	tx, err := api.DB.Begin(r.Context())
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	defer tx.Rollback(r.Context())
	_, err = tx.Exec(r.Context(), `
		INSERT INTO code_changes (
			id, task_id, repo_id, agent_run_id, change_source, commit_sha, commit_author_name,
			commit_author_email, commit_message, branch_name, summary, created_at
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
	`, id, body.TaskID, body.RepoID, body.AgentRunID, body.ChangeSource, body.CommitSha, body.CommitAuthorName, body.CommitAuthorEmail, body.CommitMessage, body.BranchName, body.Summary, now)
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	for _, file := range body.Files {
		_, err = tx.Exec(r.Context(), `
			INSERT INTO file_changes (id, change_id, file_path, change_type, old_path, insertions, deletions)
			VALUES ($1,$2,$3,$4,$5,$6,$7)
		`, uuid.NewString(), id, file.FilePath, file.ChangeType, file.OldPath, file.Insertions, file.Deletions)
		if err != nil {
			web.Error(w, http.StatusInternalServerError, err.Error())
			return
		}
	}
	if err := tx.Commit(r.Context()); err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	_ = api.insertTaskDomainEvent(r.Context(), projectID, body.TaskID, nil, nil, nil, "code.change.recorded", map[string]any{"changeId": id})
	web.JSON(w, http.StatusCreated, map[string]any{"id": id, "fileCount": len(body.Files)})
}

func (api API) listTaskCodeChanges(w http.ResponseWriter, r *http.Request) {
	taskID := chi.URLParam(r, "taskId")
	rows, err := api.DB.Query(r.Context(), `
		SELECT id, task_id, repo_id, agent_run_id, change_source, commit_sha, commit_author_name,
		       commit_author_email, commit_message, branch_name, summary, created_at
		FROM code_changes
		WHERE task_id=$1
		ORDER BY created_at DESC
	`, taskID)
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	defer rows.Close()
	items := []map[string]any{}
	for rows.Next() {
		var id, taskID, changeSource string
		var repoID, agentRunID, commitSha, commitAuthorName, commitAuthorEmail, commitMessage, branchName, summary *string
		var created time.Time
		if err := rows.Scan(&id, &taskID, &repoID, &agentRunID, &changeSource, &commitSha, &commitAuthorName, &commitAuthorEmail, &commitMessage, &branchName, &summary, &created); err != nil {
			web.Error(w, http.StatusInternalServerError, err.Error())
			return
		}
		items = append(items, map[string]any{
			"id": id, "taskId": taskID, "repoId": repoID, "agentRunId": agentRunID, "changeSource": changeSource,
			"commitSha": commitSha, "commitAuthorName": commitAuthorName, "commitAuthorEmail": commitAuthorEmail,
			"commitMessage": commitMessage, "branchName": branchName, "summary": summary,
			"createdAt": created.UTC().Format(time.RFC3339Nano),
		})
	}
	if err := rows.Err(); err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	web.JSON(w, http.StatusOK, map[string]any{"data": items})
}

func (api API) listTaskFileChanges(w http.ResponseWriter, r *http.Request) {
	taskID := chi.URLParam(r, "taskId")
	changeID := chi.URLParam(r, "changeId")
	var exists string
	if err := api.DB.QueryRow(r.Context(), `SELECT id FROM code_changes WHERE id=$1 AND task_id=$2`, changeID, taskID).Scan(&exists); err != nil {
		web.Error(w, http.StatusNotFound, "Code change not found")
		return
	}
	rows, err := api.DB.Query(r.Context(), `
		SELECT id, change_id, file_path, change_type, old_path, insertions, deletions
		FROM file_changes
		WHERE change_id=$1
		ORDER BY file_path
	`, changeID)
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	defer rows.Close()
	items := []map[string]any{}
	for rows.Next() {
		var id, changeID, filePath, changeType string
		var oldPath *string
		var insertions, deletions int
		if err := rows.Scan(&id, &changeID, &filePath, &changeType, &oldPath, &insertions, &deletions); err != nil {
			web.Error(w, http.StatusInternalServerError, err.Error())
			return
		}
		items = append(items, map[string]any{
			"id": id, "changeId": changeID, "filePath": filePath, "changeType": changeType,
			"oldPath": oldPath, "insertions": insertions, "deletions": deletions,
		})
	}
	web.JSON(w, http.StatusOK, map[string]any{"data": items})
}
