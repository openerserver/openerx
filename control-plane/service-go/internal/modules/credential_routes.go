package modules

import (
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	authpkg "openerx/control-plane/service-go/internal/auth"
	"openerx/control-plane/service-go/internal/web"
)

type credentialRequest struct {
	Label          *string `json:"label"`
	Provider       *string `json:"provider"`
	CredentialType *string `json:"credentialType"`
	SecretRef      *string `json:"secretRef"`
	GitAuthorName  *string `json:"gitAuthorName"`
	GitAuthorEmail *string `json:"gitAuthorEmail"`
	Scope          *string `json:"scope"`
	IsDefault      *bool   `json:"isDefault"`
	RepoID         *string `json:"repoId"`
}

func (api API) listCredentials(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectId")
	rows, err := api.DB.Query(r.Context(), `
		SELECT id, project_id, repo_id, label, provider, credential_type, git_author_name, git_author_email,
		       scope, is_default, status, created_at, updated_at
		FROM repository_credentials
		WHERE project_id=$1
		ORDER BY created_at ASC
	`, projectID)
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	defer rows.Close()
	items, err := scanCredentialRows(rows, false)
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	web.JSON(w, http.StatusOK, map[string]any{"data": items})
}

func (api API) createCredential(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectId")
	user := authpkg.User(r)
	var projectExists string
	if err := api.DB.QueryRow(r.Context(), `SELECT id FROM projects WHERE id=$1`, projectID).Scan(&projectExists); err != nil {
		web.Error(w, http.StatusNotFound, "Project not found")
		return
	}
	if !authpkg.HasProjectRole(user, projectID, "project_admin") {
		web.Error(w, http.StatusNotFound, "Project not found or access denied")
		return
	}
	var body credentialRequest
	if !decodeBody(w, r, &body) {
		return
	}
	if body.Label == nil || body.Provider == nil || body.CredentialType == nil || body.SecretRef == nil {
		web.Error(w, http.StatusBadRequest, "label, provider, credentialType and secretRef are required")
		return
	}
	scope := stringPtr("project")
	if body.Scope != nil {
		scope = body.Scope
	}
	isDefault := boolValue(body.IsDefault, false)
	if isDefault {
		_, _ = api.DB.Exec(r.Context(), `UPDATE repository_credentials SET is_default=false, updated_at=$1 WHERE project_id=$2 AND COALESCE(repo_id,'')=COALESCE($3,'') AND scope=$4 AND status='active'`, time.Now().UTC(), projectID, body.RepoID, *scope)
	}
	id := uuid.NewString()
	now := time.Now().UTC()
	_, err := api.DB.Exec(r.Context(), `
		INSERT INTO repository_credentials (
			id, project_id, repo_id, label, provider, credential_type, secret_ref,
			git_author_name, git_author_email, scope, is_default, status, created_at, updated_at
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'active',$12,$12)
	`, id, projectID, body.RepoID, body.Label, body.Provider, body.CredentialType, body.SecretRef, body.GitAuthorName, body.GitAuthorEmail, scope, isDefault, now)
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	_ = api.recordAudit(r.Context(), auditInput{UserID: user.Sub, ProjectID: projectID, EventType: "credential.created", Action: "create", Target: id, Detail: map[string]any{"label": *body.Label}, RiskLevel: "low", CredentialID: id})
	web.JSON(w, http.StatusCreated, map[string]any{"id": id, "label": *body.Label, "status": "active"})
}

func (api API) getCredential(w http.ResponseWriter, r *http.Request) {
	api.credentialByID(w, r, true)
}

func (api API) updateCredential(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectId")
	credentialID := chi.URLParam(r, "credentialId")
	user := authpkg.User(r)
	var body credentialRequest
	if !decodeBody(w, r, &body) {
		return
	}
	if body.IsDefault != nil && *body.IsDefault {
		_, _ = api.DB.Exec(r.Context(), `UPDATE repository_credentials SET is_default=false, updated_at=$1 WHERE project_id=$2 AND id<>$3 AND status='active'`, time.Now().UTC(), projectID, credentialID)
	}
	_, err := api.DB.Exec(r.Context(), `
		UPDATE repository_credentials
		SET label=COALESCE($1,label), git_author_name=COALESCE($2,git_author_name), git_author_email=COALESCE($3,git_author_email),
		    is_default=COALESCE($4,is_default), updated_at=$5
		WHERE id=$6 AND project_id=$7
	`, body.Label, body.GitAuthorName, body.GitAuthorEmail, body.IsDefault, time.Now().UTC(), credentialID, projectID)
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	_ = api.recordAudit(r.Context(), auditInput{UserID: user.Sub, ProjectID: projectID, EventType: "credential.updated", Action: "update", Target: credentialID, Detail: map[string]any{}, RiskLevel: "low", CredentialID: credentialID})
	api.credentialByID(w, r, true)
}

func (api API) deleteCredential(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectId")
	credentialID := chi.URLParam(r, "credentialId")
	user := authpkg.User(r)
	tag, err := api.DB.Exec(r.Context(), `
		UPDATE repository_credentials SET status='revoked', is_default=false, updated_at=$1
		WHERE id=$2 AND project_id=$3
	`, time.Now().UTC(), credentialID, projectID)
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	if tag.RowsAffected() == 0 {
		web.Error(w, http.StatusNotFound, "Credential not found")
		return
	}
	_ = api.recordAudit(r.Context(), auditInput{UserID: user.Sub, ProjectID: projectID, EventType: "credential.revoked", Action: "revoke", Target: credentialID, Detail: map[string]any{}, RiskLevel: "medium", CredentialID: credentialID})
	web.JSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (api API) credentialByID(w http.ResponseWriter, r *http.Request, masked bool) {
	projectID := chi.URLParam(r, "projectId")
	credentialID := chi.URLParam(r, "credentialId")
	rows, err := api.DB.Query(r.Context(), `
		SELECT id, project_id, repo_id, label, provider, credential_type, git_author_name, git_author_email,
		       scope, is_default, status, created_at, updated_at
		FROM repository_credentials
		WHERE id=$1 AND project_id=$2
	`, credentialID, projectID)
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	defer rows.Close()
	items, err := scanCredentialRows(rows, masked)
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	if len(items) == 0 {
		web.Error(w, http.StatusNotFound, "Credential not found")
		return
	}
	web.JSON(w, http.StatusOK, items[0])
}

func scanCredentialRows(rows interface {
	Next() bool
	Scan(dest ...any) error
	Err() error
}, masked bool) ([]map[string]any, error) {
	items := []map[string]any{}
	for rows.Next() {
		var id, projectID, label, provider, credentialType, scope, status string
		var repoID, gitAuthorName, gitAuthorEmail *string
		var isDefault bool
		var created, updated time.Time
		if err := rows.Scan(&id, &projectID, &repoID, &label, &provider, &credentialType, &gitAuthorName, &gitAuthorEmail, &scope, &isDefault, &status, &created, &updated); err != nil {
			return nil, err
		}
		item := map[string]any{
			"id": id, "projectId": projectID, "repoId": repoID, "label": label, "provider": provider,
			"credentialType": credentialType, "gitAuthorName": gitAuthorName, "gitAuthorEmail": gitAuthorEmail,
			"scope": scope, "isDefault": isDefault, "status": status,
			"createdAt": created.UTC().Format(time.RFC3339Nano), "updatedAt": updated.UTC().Format(time.RFC3339Nano),
		}
		if masked {
			item["secretRefMasked"] = "***"
		}
		items = append(items, item)
	}
	return items, rows.Err()
}
