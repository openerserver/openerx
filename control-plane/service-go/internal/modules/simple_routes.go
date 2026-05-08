package modules

import (
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"openerx/control-plane/service-go/internal/web"
)

func (api API) EnvRoutes(r chi.Router) {
	r.Get("/", api.listEnvs)
	r.Post("/", api.createEnv)
	r.Patch("/{envId}", api.updateEnv)
	r.Delete("/{envId}", api.deleteByID("environments", "envId"))
}

func (api API) PolicyRoutes(r chi.Router) {
	r.Get("/", api.listPolicyTemplates)
	r.Post("/", api.createPolicyTemplate)
	r.Patch("/{policyId}", api.updatePolicyTemplate)
}

func (api API) PluginRoutes(r chi.Router) {
	r.Get("/", api.listPlugins)
	r.Get("/{pluginId}", api.getPlugin)
	r.Post("/", api.createPlugin)
	r.Patch("/{pluginId}", api.updatePlugin)
}

type envRequest struct {
	ProjectID        string `json:"projectId"`
	Name             string `json:"name"`
	RiskLevel        string `json:"riskLevel"`
	RequiresApproval *bool  `json:"requiresApproval"`
}

func (api API) listEnvs(w http.ResponseWriter, r *http.Request) {
	rows, err := api.DB.Query(r.Context(), `SELECT id, project_id, name, risk_level, requires_approval, created_at FROM environments WHERE ($1::text IS NULL OR project_id=$1) ORDER BY created_at`, nullString(r.URL.Query().Get("projectId")))
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	defer rows.Close()
	items, err := scanEnvRows(rows)
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	web.JSON(w, http.StatusOK, items)
}

func (api API) createEnv(w http.ResponseWriter, r *http.Request) {
	var body envRequest
	if !decodeBody(w, r, &body) {
		return
	}
	id := uuid.NewString()
	risk := body.RiskLevel
	if risk == "" {
		risk = "low"
	}
	requires := boolValue(body.RequiresApproval, false)
	now := time.Now().UTC()
	_, err := api.DB.Exec(r.Context(), `INSERT INTO environments (id, project_id, name, risk_level, requires_approval, created_at) VALUES ($1,$2,$3,$4,$5,$6)`, id, body.ProjectID, body.Name, risk, requires, now)
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	web.JSON(w, http.StatusCreated, map[string]any{"id": id, "projectId": body.ProjectID, "name": body.Name, "riskLevel": risk, "requiresApproval": requires, "createdAt": now.UTC().Format(time.RFC3339Nano)})
}

func (api API) updateEnv(w http.ResponseWriter, r *http.Request) {
	var body envRequest
	if !decodeBody(w, r, &body) {
		return
	}
	_, err := api.DB.Exec(r.Context(), `UPDATE environments SET name=COALESCE($1,name), risk_level=COALESCE($2,risk_level), requires_approval=COALESCE($3,requires_approval) WHERE id=$4`, nullString(body.Name), nullString(body.RiskLevel), body.RequiresApproval, chi.URLParam(r, "envId"))
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	web.JSON(w, http.StatusOK, map[string]any{"id": chi.URLParam(r, "envId")})
}

func scanEnvRows(rows pgx.Rows) ([]map[string]any, error) {
	var items []map[string]any
	for rows.Next() {
		var id, projectID, name, risk string
		var requires bool
		var created time.Time
		if err := rows.Scan(&id, &projectID, &name, &risk, &requires, &created); err != nil {
			return nil, err
		}
		items = append(items, map[string]any{"id": id, "projectId": projectID, "name": name, "riskLevel": risk, "requiresApproval": requires, "createdAt": created.UTC().Format(time.RFC3339Nano)})
	}
	return items, rows.Err()
}

type policyRequest struct {
	ProjectID   string         `json:"projectId"`
	Name        string         `json:"name"`
	Type        string         `json:"type"`
	Description *string        `json:"description"`
	Rules       map[string]any `json:"rules"`
	AppliesTo   string         `json:"appliesTo"`
}

func (api API) listPolicyTemplates(w http.ResponseWriter, r *http.Request) {
	rows, err := api.DB.Query(r.Context(), `SELECT id, project_id, name, type, rules, applies_to, created_at FROM policy_templates WHERE ($1::text IS NULL OR project_id=$1) ORDER BY created_at DESC`, nullString(r.URL.Query().Get("projectId")))
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	defer rows.Close()
	var items []map[string]any
	for rows.Next() {
		var id, projectID, name, policyType, appliesTo string
		var rules []byte
		var created time.Time
		if err := rows.Scan(&id, &projectID, &name, &policyType, &rules, &appliesTo, &created); err != nil {
			web.Error(w, http.StatusInternalServerError, err.Error())
			return
		}
		items = append(items, map[string]any{"id": id, "projectId": projectID, "name": name, "type": policyType, "rules": scanJSONMap(rules), "appliesTo": appliesTo, "createdAt": created.UTC().Format(time.RFC3339Nano)})
	}
	web.JSON(w, http.StatusOK, items)
}

func (api API) createPolicyTemplate(w http.ResponseWriter, r *http.Request) {
	var body policyRequest
	if !decodeBody(w, r, &body) {
		return
	}
	id := uuid.NewString()
	rules, _ := jsonBytes(body.Rules)
	policyType := body.Type
	if policyType == "" {
		policyType = "model"
	}
	appliesTo := body.AppliesTo
	if appliesTo == "" {
		appliesTo = "all"
	}
	now := time.Now().UTC()
	_, err := api.DB.Exec(r.Context(), `INSERT INTO policy_templates (id, project_id, name, type, rules, applies_to, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)`, id, body.ProjectID, body.Name, policyType, rules, appliesTo, now)
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	web.JSON(w, http.StatusCreated, map[string]any{"id": id, "projectId": body.ProjectID, "name": body.Name, "type": policyType, "rules": body.Rules, "appliesTo": appliesTo, "createdAt": now.UTC().Format(time.RFC3339Nano)})
}

func (api API) updatePolicyTemplate(w http.ResponseWriter, r *http.Request) {
	var body policyRequest
	if !decodeBody(w, r, &body) {
		return
	}
	rules, _ := jsonBytes(body.Rules)
	_, err := api.DB.Exec(r.Context(), `UPDATE policy_templates SET name=COALESCE($1,name), description=COALESCE($2,description), rules=COALESCE($3,rules) WHERE id=$4`, nullString(body.Name), body.Description, rules, chi.URLParam(r, "policyId"))
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	web.JSON(w, http.StatusOK, map[string]any{"id": chi.URLParam(r, "policyId")})
}

type pluginRequest struct {
	Name           string   `json:"name"`
	DisplayName    string   `json:"displayName"`
	Version        string   `json:"version"`
	PluginPath     string   `json:"pluginPath"`
	Source         string   `json:"source"`
	Status         string   `json:"status"`
	Description    *string  `json:"description"`
	Capabilities   []string `json:"capabilities"`
	LastVerifiedAt *string  `json:"lastVerifiedAt"`
}

func (api API) listPlugins(w http.ResponseWriter, r *http.Request) {
	rows, err := api.DB.Query(r.Context(), `SELECT id, name, display_name, version, plugin_path, source, status, description, capabilities, last_verified_at, created_at, updated_at FROM plugins ORDER BY created_at DESC`)
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	defer rows.Close()
	items, err := scanPluginRows(rows)
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	web.JSON(w, http.StatusOK, map[string]any{"data": items})
}

func (api API) getPlugin(w http.ResponseWriter, r *http.Request) {
	rows, err := api.DB.Query(r.Context(), `SELECT id, name, display_name, version, plugin_path, source, status, description, capabilities, last_verified_at, created_at, updated_at FROM plugins WHERE id=$1`, chi.URLParam(r, "pluginId"))
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	defer rows.Close()
	items, err := scanPluginRows(rows)
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	if len(items) == 0 {
		web.Error(w, http.StatusNotFound, "Plugin not found")
		return
	}
	web.JSON(w, http.StatusOK, items[0])
}

func (api API) createPlugin(w http.ResponseWriter, r *http.Request) {
	var body pluginRequest
	if !decodeBody(w, r, &body) {
		return
	}
	id := uuid.NewString()
	status := body.Status
	if status == "" {
		status = "enabled"
	}
	source := body.Source
	if source == "" {
		source = "local"
	}
	displayName := body.DisplayName
	if displayName == "" {
		displayName = body.Name
	}
	capabilities, _ := jsonBytes(body.Capabilities)
	now := time.Now().UTC()
	_, err := api.DB.Exec(r.Context(), `INSERT INTO plugins (id, name, display_name, version, plugin_path, source, status, description, capabilities, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10)`, id, body.Name, displayName, body.Version, body.PluginPath, source, status, body.Description, capabilities, now)
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	item, _ := loadPluginByID(api, r, id)
	web.JSON(w, http.StatusCreated, item)
}

func (api API) updatePlugin(w http.ResponseWriter, r *http.Request) {
	var body pluginRequest
	if !decodeBody(w, r, &body) {
		return
	}
	verified := parseOptionalRuntimeTime(body.LastVerifiedAt)
	now := time.Now().UTC()
	_, err := api.DB.Exec(r.Context(), `UPDATE plugins SET status=COALESCE($1,status), version=COALESCE($2,version), last_verified_at=COALESCE($3,last_verified_at), updated_at=$4 WHERE id=$5`, nullString(body.Status), nullString(body.Version), verified, now, chi.URLParam(r, "pluginId"))
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	item, _ := loadPluginByID(api, r, chi.URLParam(r, "pluginId"))
	web.JSON(w, http.StatusOK, item)
}

func scanPluginRows(rows pgx.Rows) ([]map[string]any, error) {
	var items []map[string]any
	for rows.Next() {
		var id, name, displayName, path, source, status string
		var version, description *string
		var capabilities []byte
		var verified *time.Time
		var created, updated time.Time
		if err := rows.Scan(&id, &name, &displayName, &version, &path, &source, &status, &description, &capabilities, &verified, &created, &updated); err != nil {
			return nil, err
		}
		items = append(items, map[string]any{"id": id, "name": name, "displayName": displayName, "version": version, "pluginPath": path, "source": source, "status": status, "description": description, "capabilities": scanJSONAnyDefault(capabilities, []any{}), "lastVerifiedAt": web.NormalizeTime(verified), "createdAt": created.UTC().Format(time.RFC3339Nano), "updatedAt": updated.UTC().Format(time.RFC3339Nano)})
	}
	return items, rows.Err()
}

func loadPluginByID(api API, r *http.Request, id string) (map[string]any, error) {
	rows, err := api.DB.Query(r.Context(), `SELECT id, name, display_name, version, plugin_path, source, status, description, capabilities, last_verified_at, created_at, updated_at FROM plugins WHERE id=$1`, id)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items, err := scanPluginRows(rows)
	if err != nil || len(items) == 0 {
		return nil, err
	}
	return items[0], nil
}

func (api API) deleteByID(table string, param string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		_, err := api.DB.Exec(r.Context(), `DELETE FROM `+table+` WHERE id=$1`, chi.URLParam(r, param))
		if err != nil {
			web.Error(w, http.StatusInternalServerError, err.Error())
			return
		}
		web.JSON(w, http.StatusOK, map[string]any{"ok": true})
	}
}
