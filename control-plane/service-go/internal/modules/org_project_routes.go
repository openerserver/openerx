package modules

import (
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	authpkg "openerx/control-plane/service-go/internal/auth"
	"openerx/control-plane/service-go/internal/web"
)

type createOrgRequest struct {
	Name string `json:"name"`
	Slug string `json:"slug"`
}

type createProjectRequest struct {
	OrgID       string         `json:"orgId"`
	Name        string         `json:"name"`
	Slug        string         `json:"slug"`
	Description *string        `json:"description"`
	Settings    map[string]any `json:"settings"`
}

type updateProjectRequest struct {
	Name        *string        `json:"name"`
	Description *string        `json:"description"`
	Settings    map[string]any `json:"settings"`
}

type addProjectMemberRequest struct {
	UserID string `json:"userId"`
	Role   string `json:"role"`
}

type updateProjectMemberRequest struct {
	Role string `json:"role"`
}

func (api API) OrgRoutes(r chi.Router) {
	r.Get("/", api.listOrgs)
	r.With(func(next http.Handler) http.Handler { return requireRole("org_admin", next) }).Post("/", api.createOrg)
	r.Get("/{orgId}", api.getOrg)
}

func (api API) ProjectRoutes(r chi.Router) {
	r.Get("/", api.listProjects)
	r.Get("/overview", api.projectOverview)
	r.With(func(next http.Handler) http.Handler { return requireRole("org_admin", next) }).Post("/", api.createProject)
	r.Get("/{projectId}", api.getProject)
	r.Patch("/{projectId}", api.updateProject)
	r.Delete("/{projectId}", api.deleteProject)
	r.Get("/{projectId}/members", api.listProjectMembers)
	r.Post("/{projectId}/members", api.addProjectMember)
	r.Patch("/{projectId}/members/{userId}", api.updateProjectMember)
	r.Delete("/{projectId}/members/{userId}", api.deleteProjectMember)
	r.Get("/{projectId}/tree", api.projectTree)
	r.Get("/{projectId}/tree/{nodeId}", api.projectTreeNode)
	r.Get("/{projectId}/tree/{nodeId}/children", api.projectTreeChildren)
	r.Post("/{projectId}/tree/{nodeId}/children", api.createProjectTreeChild)
	r.Get("/{projectId}/tree/{nodeId}/ancestors", api.projectTreeAncestors)
	r.Get("/{projectId}/tree/{nodeId}/links", api.projectTreeLinks)
	r.Post("/{projectId}/tree/{nodeId}/links", api.createProjectTreeLink)
	r.Get("/{projectId}/links", api.projectLinks)
	r.Delete("/{projectId}/links/{linkId}", api.deleteProjectTreeLink)
	r.Post("/{projectId}/runtime-usage-ledgers/sync", api.syncRuntimeUsageLedger)
	r.Get("/{projectId}/runtime-usage-ledgers", api.listRuntimeUsageLedgers)
	r.Get("/{projectId}/runtime-usage-ledgers/{ledgerId}", api.getRuntimeUsageLedger)
	r.Get("/{projectId}/runtime-usage-baselines", api.getRuntimeUsageBaseline)
	r.Get("/{projectId}/credentials", api.listCredentials)
	r.Post("/{projectId}/credentials", api.createCredential)
	r.Get("/{projectId}/credentials/{credentialId}", api.getCredential)
	r.Patch("/{projectId}/credentials/{credentialId}", api.updateCredential)
	r.Delete("/{projectId}/credentials/{credentialId}", api.deleteCredential)
	r.Get("/{projectId}/repositories", api.listRepositories)
	r.Get("/{projectId}/repositories/all", api.listAllRepositories)
	r.Post("/{projectId}/repositories", api.createRepository)
	r.Get("/{projectId}/repositories/{repoId}", api.getRepository)
	r.Patch("/{projectId}/repositories/{repoId}", api.updateRepository)
	r.Delete("/{projectId}/repositories/{repoId}", api.archiveRepository)
}

func (api API) listOrgs(w http.ResponseWriter, r *http.Request) {
	user := authpkg.User(r)
	var rows pgx.Rows
	var err error
	if user.Role == "platform_admin" || user.Role == "org_admin" {
		rows, err = api.DB.Query(r.Context(), `SELECT id, name, slug, created_at FROM organizations ORDER BY created_at`)
	} else {
		rows, err = api.DB.Query(r.Context(), `
			SELECT DISTINCT o.id, o.name, o.slug, o.created_at
			FROM organizations o
			INNER JOIN projects p ON p.org_id=o.id
			INNER JOIN project_roles pr ON pr.project_id=p.id
			WHERE pr.user_id=$1
			ORDER BY o.created_at
		`, user.Sub)
	}
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	defer rows.Close()
	items, err := scanOrgRows(rows)
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	web.JSON(w, http.StatusOK, items)
}

func (api API) createOrg(w http.ResponseWriter, r *http.Request) {
	var body createOrgRequest
	if !decodeBody(w, r, &body) {
		return
	}
	id := uuid.NewString()
	createdAt := time.Now().UTC()
	_, err := api.DB.Exec(r.Context(), `INSERT INTO organizations (id, name, slug, created_at) VALUES ($1,$2,$3,$4)`, id, body.Name, body.Slug, createdAt)
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	web.JSON(w, http.StatusCreated, map[string]any{"id": id, "name": body.Name, "slug": body.Slug, "createdAt": createdAt.Format(time.RFC3339Nano)})
}

func (api API) getOrg(w http.ResponseWriter, r *http.Request) {
	rows, err := api.DB.Query(r.Context(), `SELECT id, name, slug, created_at FROM organizations WHERE id=$1`, chi.URLParam(r, "orgId"))
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	defer rows.Close()
	items, err := scanOrgRows(rows)
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	if len(items) == 0 {
		web.Error(w, http.StatusNotFound, "Organization not found")
		return
	}
	web.JSON(w, http.StatusOK, items[0])
}

func (api API) listProjects(w http.ResponseWriter, r *http.Request) {
	user := authpkg.User(r)
	orgID := r.URL.Query().Get("orgId")
	whereOrg := nullString(orgID)
	var rows pgx.Rows
	var err error
	if user.Role == "platform_admin" || user.Role == "org_admin" {
		rows, err = api.DB.Query(r.Context(), `
			SELECT id, org_id, name, slug, description, settings, status, created_at, updated_at
			FROM projects
			WHERE ($1::text IS NULL OR org_id=$1)
			ORDER BY created_at
		`, whereOrg)
	} else {
		rows, err = api.DB.Query(r.Context(), `
			SELECT p.id, p.org_id, p.name, p.slug, p.description, p.settings, p.status, p.created_at, p.updated_at
			FROM projects p
			INNER JOIN project_roles pr ON pr.project_id=p.id
			WHERE pr.user_id=$1 AND ($2::text IS NULL OR p.org_id=$2)
			ORDER BY p.created_at
		`, user.Sub, whereOrg)
	}
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	defer rows.Close()
	items, err := scanProjectRows(rows)
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	web.JSON(w, http.StatusOK, items)
}

func (api API) projectOverview(w http.ResponseWriter, r *http.Request) {
	rows, err := api.DB.Query(r.Context(), `
		SELECT p.id, p.org_id, p.name, p.slug, p.description, p.settings, p.status, p.created_at, p.updated_at,
		       COUNT(DISTINCT t.id) FILTER (WHERE t.lifecycle_status='active') AS running_tasks,
		       COUNT(DISTINCT ts.id) FILTER (WHERE ts.execution_status='running' AND ts.archived_at IS NULL) AS active_sessions,
		       COUNT(DISTINCT t.id) FILTER (WHERE t.strategy_json #>> '{_goCompat,executionMode}' = 'parallel') AS parallel_tasks,
		       COUNT(DISTINCT tv.id) AS recent_timeline_items
		FROM projects p
		LEFT JOIN tasks t ON t.project_id=p.id
		LEFT JOIN task_sessions ts ON ts.project_id=p.id
		LEFT JOIN task_timeline_views tv ON tv.project_id=p.id AND tv.created_at >= NOW() - INTERVAL '24 hours'
		GROUP BY p.id
		ORDER BY p.created_at
	`)
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	defer rows.Close()
	items := []map[string]any{}
	summary := map[string]int{"runningTaskCount": 0, "activeSessionCount": 0, "parallelTaskCount": 0, "recentTimelineItemCount": 0}
	for rows.Next() {
		var id, orgID, name, slug, status string
		var description *string
		var settings []byte
		var created, updated time.Time
		var running, sessions, parallel, timeline int
		if err := rows.Scan(&id, &orgID, &name, &slug, &description, &settings, &status, &created, &updated, &running, &sessions, &parallel, &timeline); err != nil {
			web.Error(w, http.StatusInternalServerError, err.Error())
			return
		}
		summary["runningTaskCount"] += running
		summary["activeSessionCount"] += sessions
		summary["parallelTaskCount"] += parallel
		summary["recentTimelineItemCount"] += timeline
		items = append(items, map[string]any{
			"id": id, "orgId": orgID, "name": name, "slug": slug, "description": description, "settings": scanJSONMap(settings),
			"status": status, "createdAt": created.UTC().Format(time.RFC3339Nano), "updatedAt": updated.UTC().Format(time.RFC3339Nano),
			"lastActivityAt": updated.UTC().Format(time.RFC3339Nano),
			"runningTasks":   running, "activeSessionCount": sessions, "parallelTaskCount": parallel,
			"recentTimelineItemCount": timeline, "failedTasksToday": 0,
		})
	}
	if err := rows.Err(); err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	web.JSON(w, http.StatusOK, map[string]any{"data": items, "summary": summary})
}

func (api API) createProject(w http.ResponseWriter, r *http.Request) {
	user := authpkg.User(r)
	var body createProjectRequest
	if !decodeBody(w, r, &body) {
		return
	}
	id := uuid.NewString()
	now := time.Now().UTC()
	settings, _ := jsonBytes(body.Settings)
	_, err := api.DB.Exec(r.Context(), `
		INSERT INTO projects (id, org_id, name, slug, description, settings, created_at, updated_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$7)
	`, id, body.OrgID, body.Name, body.Slug, body.Description, settings, now)
	if err != nil {
		if strings.Contains(err.Error(), "idx_projects_org_slug") {
			web.Error(w, http.StatusConflict, "A project with this slug already exists in the organization")
			return
		}
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	_, _ = api.DB.Exec(r.Context(), `INSERT INTO project_roles (id, project_id, user_id, role) VALUES ($1,$2,$3,'project_admin') ON CONFLICT DO NOTHING`, uuid.NewString(), id, user.Sub)
	_ = api.ensureProjectRoot(r.Context(), id)
	web.JSON(w, http.StatusCreated, map[string]any{"id": id, "rootNodeId": "project_root:" + id, "orgId": body.OrgID, "name": body.Name, "slug": body.Slug, "description": body.Description, "settings": body.Settings, "createdAt": now.Format(time.RFC3339Nano)})
}

func (api API) getProject(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectId")
	if !authpkg.HasProjectRole(authpkg.User(r), projectID, "viewer") {
		web.Error(w, http.StatusNotFound, "Project not found or access denied")
		return
	}
	rows, err := api.DB.Query(r.Context(), `
		SELECT id, org_id, name, slug, description, settings, status, created_at, updated_at
		FROM projects WHERE id=$1
	`, projectID)
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	defer rows.Close()
	items, err := scanProjectRows(rows)
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	if len(items) == 0 {
		web.Error(w, http.StatusNotFound, "Project not found or access denied")
		return
	}
	web.JSON(w, http.StatusOK, items[0])
}

func (api API) updateProject(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectId")
	if !authpkg.HasProjectRole(authpkg.User(r), projectID, "project_admin") {
		web.Error(w, http.StatusForbidden, "Insufficient project permissions")
		return
	}
	var body updateProjectRequest
	if !decodeBody(w, r, &body) {
		return
	}
	settings, _ := jsonBytes(body.Settings)
	_, err := api.DB.Exec(r.Context(), `
		UPDATE projects SET name=COALESCE($1, name), description=COALESCE($2, description), settings=COALESCE($3, settings), updated_at=$4
		WHERE id=$5
	`, body.Name, body.Description, settings, time.Now().UTC(), projectID)
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	api.getProject(w, r)
}

func (api API) deleteProject(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectId")
	if authpkg.User(r).Role != "org_admin" && authpkg.User(r).Role != "platform_admin" {
		web.JSON(w, http.StatusForbidden, map[string]any{"error": "Insufficient permissions", "required": "org_admin", "current": authpkg.User(r).Role})
		return
	}
	_, err := api.DB.Exec(r.Context(), `DELETE FROM projects WHERE id=$1`, projectID)
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	web.JSON(w, http.StatusOK, map[string]any{"ok": true, "id": projectID, "deletedTaskCount": 0})
}

func (api API) listProjectMembers(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectId")
	rows, err := api.DB.Query(r.Context(), `
		SELECT pr.user_id, pr.project_id, pr.role, u.username, u.display_name, u.role, u.created_at
		FROM project_roles pr
		INNER JOIN users u ON u.id=pr.user_id
		WHERE pr.project_id=$1
	`, projectID)
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	defer rows.Close()
	var items []map[string]any
	for rows.Next() {
		var userID, pid, role, username, displayName, globalRole string
		var created time.Time
		if err := rows.Scan(&userID, &pid, &role, &username, &displayName, &globalRole, &created); err != nil {
			web.Error(w, http.StatusInternalServerError, err.Error())
			return
		}
		items = append(items, map[string]any{"userId": userID, "projectId": pid, "role": role, "username": username, "displayName": displayName, "globalRole": globalRole, "createdAt": created.UTC().Format(time.RFC3339Nano)})
	}
	web.JSON(w, http.StatusOK, items)
}

func (api API) addProjectMember(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectId")
	var body addProjectMemberRequest
	if !decodeBody(w, r, &body) {
		return
	}
	_, err := api.DB.Exec(r.Context(), `INSERT INTO project_roles (id, project_id, user_id, role) VALUES ($1,$2,$3,$4)`, uuid.NewString(), projectID, body.UserID, body.Role)
	if err != nil {
		web.Error(w, http.StatusConflict, "User is already a project member")
		return
	}
	web.JSON(w, http.StatusCreated, map[string]any{"userId": body.UserID, "projectId": projectID, "role": body.Role})
}

func (api API) updateProjectMember(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectId")
	userID := chi.URLParam(r, "userId")
	var body updateProjectMemberRequest
	if !decodeBody(w, r, &body) {
		return
	}
	_, err := api.DB.Exec(r.Context(), `UPDATE project_roles SET role=$1 WHERE project_id=$2 AND user_id=$3`, body.Role, projectID, userID)
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	web.JSON(w, http.StatusOK, map[string]any{"userId": userID, "projectId": projectID, "role": body.Role})
}

func (api API) deleteProjectMember(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectId")
	userID := chi.URLParam(r, "userId")
	_, err := api.DB.Exec(r.Context(), `DELETE FROM project_roles WHERE project_id=$1 AND user_id=$2`, projectID, userID)
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	web.JSON(w, http.StatusOK, map[string]any{"ok": true})
}
