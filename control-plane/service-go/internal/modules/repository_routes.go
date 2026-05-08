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

type repositoryRequest struct {
	Name          *string `json:"name"`
	Provider      *string `json:"provider"`
	RemoteURL     *string `json:"remoteUrl"`
	DefaultBranch *string `json:"defaultBranch"`
	Description   *string `json:"description"`
	Status        *string `json:"status"`
}

func (api API) projectExists(ctx context.Context, projectID string) (bool, error) {
	var id string
	err := api.DB.QueryRow(ctx, `SELECT id FROM projects WHERE id=$1`, projectID).Scan(&id)
	if err == pgx.ErrNoRows {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return true, nil
}

func (api API) listRepositories(w http.ResponseWriter, r *http.Request) {
	api.queryRepositories(w, r, true)
}

func (api API) listAllRepositories(w http.ResponseWriter, r *http.Request) {
	api.queryRepositories(w, r, false)
}

func (api API) queryRepositories(w http.ResponseWriter, r *http.Request, activeOnly bool) {
	projectID := chi.URLParam(r, "projectId")
	rows, err := api.DB.Query(r.Context(), `
		SELECT id, project_id, name, provider, remote_url, default_branch, description, status, created_at, updated_at
		FROM repositories
		WHERE project_id=$1 AND ($2::bool=false OR status='active')
		ORDER BY created_at DESC
	`, projectID, activeOnly)
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	defer rows.Close()
	items := []map[string]any{}
	for rows.Next() {
		item, err := scanRepository(rows)
		if err != nil {
			web.Error(w, http.StatusInternalServerError, err.Error())
			return
		}
		items = append(items, item)
	}
	web.JSON(w, http.StatusOK, map[string]any{"data": items})
}

func (api API) getRepository(w http.ResponseWriter, r *http.Request) {
	item, err := api.loadRepository(r, chi.URLParam(r, "projectId"), chi.URLParam(r, "repoId"))
	if err == pgx.ErrNoRows {
		web.Error(w, http.StatusNotFound, "Repository not found")
		return
	}
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	web.JSON(w, http.StatusOK, item)
}

func (api API) createRepository(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectId")
	user := authpkg.User(r)
	if ok, err := api.projectExists(r.Context(), projectID); err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	} else if !ok {
		web.Error(w, http.StatusNotFound, "Project not found")
		return
	}
	var body repositoryRequest
	if !decodeBody(w, r, &body) {
		return
	}
	if body.Name == nil || *body.Name == "" || body.Provider == nil || *body.Provider == "" || body.RemoteURL == nil || *body.RemoteURL == "" {
		web.Error(w, http.StatusBadRequest, "name, provider and remoteUrl are required")
		return
	}
	if message, err := api.repositoryConflict(r, projectID, "", *body.Name, *body.RemoteURL); err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	} else if message != "" {
		web.Error(w, http.StatusConflict, message)
		return
	}
	defaultBranch := "main"
	if body.DefaultBranch != nil && *body.DefaultBranch != "" {
		defaultBranch = *body.DefaultBranch
	}
	id := uuid.NewString()
	now := time.Now().UTC()
	_, err := api.DB.Exec(r.Context(), `
		INSERT INTO repositories (id, project_id, name, provider, remote_url, default_branch, description, status, created_at, updated_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,'active',$8,$8)
	`, id, projectID, *body.Name, *body.Provider, *body.RemoteURL, defaultBranch, body.Description, now)
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	userID := ""
	if user != nil {
		userID = user.Sub
	}
	_ = api.recordAudit(r.Context(), auditInput{UserID: userID, ProjectID: projectID, EventType: "repository.created", Action: "create_repository", Target: *body.Name, Detail: map[string]any{"repoId": id, "provider": *body.Provider, "remoteUrl": *body.RemoteURL}})
	item, err := api.loadRepository(r, projectID, id)
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	web.JSON(w, http.StatusCreated, item)
}

func (api API) updateRepository(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectId")
	repoID := chi.URLParam(r, "repoId")
	existing, err := api.loadRepository(r, projectID, repoID)
	if err == pgx.ErrNoRows {
		web.Error(w, http.StatusNotFound, "Repository not found")
		return
	}
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	var body repositoryRequest
	if !decodeBody(w, r, &body) {
		return
	}
	nextName := stringFromAny(existing["name"])
	nextURL := stringFromAny(existing["remoteUrl"])
	if body.Name != nil {
		nextName = *body.Name
	}
	if body.RemoteURL != nil {
		nextURL = *body.RemoteURL
	}
	if message, err := api.repositoryConflict(r, projectID, repoID, nextName, nextURL); err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	} else if message != "" {
		web.Error(w, http.StatusConflict, message)
		return
	}
	now := time.Now().UTC()
	_, err = api.DB.Exec(r.Context(), `
		UPDATE repositories SET
			name=COALESCE($1,name),
			provider=COALESCE($2,provider),
			remote_url=COALESCE($3,remote_url),
			default_branch=COALESCE($4,default_branch),
			description=$5,
			status=COALESCE($6,status),
			updated_at=$7
		WHERE id=$8 AND project_id=$9
	`, body.Name, body.Provider, body.RemoteURL, body.DefaultBranch, body.Description, body.Status, now, repoID, projectID)
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	item, err := api.loadRepository(r, projectID, repoID)
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	web.JSON(w, http.StatusOK, item)
}

func (api API) archiveRepository(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectId")
	repoID := chi.URLParam(r, "repoId")
	item, err := api.loadRepository(r, projectID, repoID)
	if err == pgx.ErrNoRows {
		web.Error(w, http.StatusNotFound, "Repository not found")
		return
	}
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	_, err = api.DB.Exec(r.Context(), `UPDATE repositories SET status='archived', updated_at=$1 WHERE id=$2 AND project_id=$3`, time.Now().UTC(), repoID, projectID)
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	userID := ""
	if user := authpkg.User(r); user != nil {
		userID = user.Sub
	}
	_ = api.recordAudit(r.Context(), auditInput{UserID: userID, ProjectID: projectID, EventType: "repository.archived", Action: "archive_repository", Target: stringFromAny(item["name"]), Detail: map[string]any{"repoId": repoID}})
	web.JSON(w, http.StatusOK, map[string]any{"ok": true})
}

type repositoryScanner interface {
	Scan(dest ...any) error
}

func (api API) loadRepository(r *http.Request, projectID string, repoID string) (map[string]any, error) {
	return scanRepository(api.DB.QueryRow(r.Context(), `
		SELECT id, project_id, name, provider, remote_url, default_branch, description, status, created_at, updated_at
		FROM repositories WHERE project_id=$1 AND id=$2
	`, projectID, repoID))
}

func scanRepository(row repositoryScanner) (map[string]any, error) {
	var id, projectID, name, provider, remoteURL, defaultBranch, status string
	var description *string
	var createdAt, updatedAt time.Time
	if err := row.Scan(&id, &projectID, &name, &provider, &remoteURL, &defaultBranch, &description, &status, &createdAt, &updatedAt); err != nil {
		return nil, err
	}
	return map[string]any{
		"id": id, "projectId": projectID, "name": name, "provider": provider, "remoteUrl": remoteURL,
		"defaultBranch": defaultBranch, "description": description, "status": status,
		"createdAt": formatRuntimeTime(&createdAt), "updatedAt": formatRuntimeTime(&updatedAt),
	}, nil
}

func (api API) repositoryConflict(r *http.Request, projectID string, excludeID string, name string, remoteURL string) (string, error) {
	var id string
	err := api.DB.QueryRow(r.Context(), `SELECT id FROM repositories WHERE project_id=$1 AND name=$2 AND id<>$3 LIMIT 1`, projectID, name, excludeID).Scan(&id)
	if err == nil {
		return "A repository with this name already exists in the project", nil
	}
	if err != pgx.ErrNoRows {
		return "", err
	}
	err = api.DB.QueryRow(r.Context(), `SELECT id FROM repositories WHERE project_id=$1 AND remote_url=$2 AND id<>$3 LIMIT 1`, projectID, remoteURL, excludeID).Scan(&id)
	if err == nil {
		return "A repository with this URL already exists in the project", nil
	}
	if err != pgx.ErrNoRows {
		return "", err
	}
	return "", nil
}
