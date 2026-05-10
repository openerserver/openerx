package modules

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	authpkg "openerx/control-plane/service-go/internal/auth"
	"openerx/control-plane/service-go/internal/web"
)

type codeOwnerRequest struct {
	ProjectID        string `json:"projectId"`
	PathPattern      string `json:"pathPattern"`
	OwnerType        string `json:"ownerType"`
	OwnerRef         string `json:"ownerRef"`
	RiskLevel        string `json:"riskLevel"`
	RequiresApproval *bool  `json:"requiresApproval"`
}

type resolveCodeOwnersRequest struct {
	ProjectID string   `json:"projectId"`
	Paths     []string `json:"paths"`
}

type codeOwnerRecord struct {
	ID               string
	ProjectID        string
	PathPattern      string
	OwnerType        string
	OwnerRef         string
	RiskLevel        string
	RequiresApproval bool
	CreatedByUserID  *string
	CreatedAt        time.Time
	UpdatedAt        time.Time
}

func (api API) CodeOwnerRoutes(r chi.Router) {
	r.Get("/", api.listCodeOwners)
	r.Post("/", api.createCodeOwner)
	r.Post("/resolve", api.resolveCodeOwners)
	r.Patch("/{ownerId}", api.updateCodeOwner)
	r.Delete("/{ownerId}", api.deleteCodeOwner)
}

func (api API) listCodeOwners(w http.ResponseWriter, r *http.Request) {
	projectID := r.URL.Query().Get("projectId")
	if projectID == "" {
		web.Error(w, http.StatusBadRequest, "projectId is required")
		return
	}
	if ok, err := api.ensureProjectAccess(r, projectID, "developer"); err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	} else if !ok {
		web.Error(w, http.StatusForbidden, "Insufficient project permissions")
		return
	}
	rows, err := api.DB.Query(r.Context(), `
		SELECT id, project_id, path_pattern, owner_type, owner_ref, risk_level,
		       requires_approval, created_by_user_id, created_at, updated_at
		FROM code_owners
		WHERE project_id=$1
		ORDER BY path_pattern ASC, owner_type ASC, owner_ref ASC
	`, projectID)
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	defer rows.Close()
	items, err := scanCodeOwnerRows(rows)
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	web.JSON(w, http.StatusOK, map[string]any{"data": items})
}

func (api API) createCodeOwner(w http.ResponseWriter, r *http.Request) {
	var body codeOwnerRequest
	if !decodeBody(w, r, &body) {
		return
	}
	if ok, err := api.ensureProjectAccess(r, body.ProjectID, "project_admin"); err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	} else if !ok {
		web.Error(w, http.StatusForbidden, "Project admin permission required")
		return
	}
	normalized, err := normalizeCodeOwnerRequest(body)
	if err != nil {
		web.Error(w, http.StatusBadRequest, err.Error())
		return
	}
	id := uuid.NewString()
	now := time.Now().UTC()
	user := authpkg.User(r)
	_, err = api.DB.Exec(r.Context(), `
		INSERT INTO code_owners (
			id, project_id, path_pattern, owner_type, owner_ref, risk_level,
			requires_approval, created_by_user_id, created_at, updated_at
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9)
	`, id, normalized.ProjectID, normalized.PathPattern, normalized.OwnerType, normalized.OwnerRef, normalized.RiskLevel, boolValue(normalized.RequiresApproval, true), user.Sub, now)
	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" {
			web.Error(w, http.StatusConflict, "Code owner rule already exists")
			return
		}
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	_ = api.recordAudit(r.Context(), auditInput{
		UserID: user.Sub, ProjectID: normalized.ProjectID, EventType: "code_owner",
		Action: "create", Target: id, RiskLevel: normalized.RiskLevel,
		Detail: map[string]any{"pathPattern": normalized.PathPattern, "ownerType": normalized.OwnerType, "ownerRef": normalized.OwnerRef, "requiresApproval": boolValue(normalized.RequiresApproval, true)},
	})
	item, err := api.loadCodeOwner(r, id)
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	web.JSON(w, http.StatusCreated, map[string]any{"data": publicCodeOwner(item)})
}

func (api API) updateCodeOwner(w http.ResponseWriter, r *http.Request) {
	ownerID := chi.URLParam(r, "ownerId")
	existing, err := api.loadCodeOwner(r, ownerID)
	if errors.Is(err, pgx.ErrNoRows) {
		web.Error(w, http.StatusNotFound, "Code owner rule not found")
		return
	}
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	if ok, err := api.ensureProjectAccess(r, existing.ProjectID, "project_admin"); err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	} else if !ok {
		web.Error(w, http.StatusForbidden, "Project admin permission required")
		return
	}
	var body codeOwnerRequest
	if !decodeBody(w, r, &body) {
		return
	}
	next := codeOwnerRequest{
		ProjectID:        existing.ProjectID,
		PathPattern:      existing.PathPattern,
		OwnerType:        existing.OwnerType,
		OwnerRef:         existing.OwnerRef,
		RiskLevel:        existing.RiskLevel,
		RequiresApproval: &existing.RequiresApproval,
	}
	mergeCodeOwnerRequest(&next, body)
	normalized, err := normalizeCodeOwnerRequest(next)
	if err != nil {
		web.Error(w, http.StatusBadRequest, err.Error())
		return
	}
	now := time.Now().UTC()
	_, err = api.DB.Exec(r.Context(), `
		UPDATE code_owners
		SET path_pattern=$1, owner_type=$2, owner_ref=$3, risk_level=$4,
		    requires_approval=$5, updated_at=$6
		WHERE id=$7
	`, normalized.PathPattern, normalized.OwnerType, normalized.OwnerRef, normalized.RiskLevel, boolValue(normalized.RequiresApproval, true), now, ownerID)
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	user := authpkg.User(r)
	_ = api.recordAudit(r.Context(), auditInput{
		UserID: user.Sub, ProjectID: existing.ProjectID, EventType: "code_owner",
		Action: "update", Target: ownerID, RiskLevel: normalized.RiskLevel,
		Detail: map[string]any{"pathPattern": normalized.PathPattern, "ownerType": normalized.OwnerType, "ownerRef": normalized.OwnerRef, "requiresApproval": boolValue(normalized.RequiresApproval, true)},
	})
	updated, err := api.loadCodeOwner(r, ownerID)
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	web.JSON(w, http.StatusOK, map[string]any{"data": publicCodeOwner(updated)})
}

func (api API) deleteCodeOwner(w http.ResponseWriter, r *http.Request) {
	ownerID := chi.URLParam(r, "ownerId")
	existing, err := api.loadCodeOwner(r, ownerID)
	if errors.Is(err, pgx.ErrNoRows) {
		web.Error(w, http.StatusNotFound, "Code owner rule not found")
		return
	}
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	if ok, err := api.ensureProjectAccess(r, existing.ProjectID, "project_admin"); err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	} else if !ok {
		web.Error(w, http.StatusForbidden, "Project admin permission required")
		return
	}
	_, err = api.DB.Exec(r.Context(), `DELETE FROM code_owners WHERE id=$1`, ownerID)
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	user := authpkg.User(r)
	_ = api.recordAudit(r.Context(), auditInput{
		UserID: user.Sub, ProjectID: existing.ProjectID, EventType: "code_owner",
		Action: "delete", Target: ownerID, RiskLevel: existing.RiskLevel,
		Detail: map[string]any{"pathPattern": existing.PathPattern, "ownerType": existing.OwnerType, "ownerRef": existing.OwnerRef},
	})
	web.JSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (api API) resolveCodeOwners(w http.ResponseWriter, r *http.Request) {
	var body resolveCodeOwnersRequest
	if !decodeBody(w, r, &body) {
		return
	}
	if body.ProjectID == "" || len(body.Paths) == 0 {
		web.Error(w, http.StatusBadRequest, "projectId and paths are required")
		return
	}
	if ok, err := api.ensureProjectAccess(r, body.ProjectID, "developer"); err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	} else if !ok {
		web.Error(w, http.StatusForbidden, "Insufficient project permissions")
		return
	}
	owners, err := api.loadCodeOwnersForProject(r, body.ProjectID)
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	results := []map[string]any{}
	overallRisk := "low"
	approvalRequired := false
	for _, filePath := range body.Paths {
		matches := []map[string]any{}
		for _, owner := range owners {
			if codeOwnerPatternMatches(owner.PathPattern, filePath) {
				matches = append(matches, publicCodeOwner(owner))
				if compareRisk(owner.RiskLevel, overallRisk) > 0 {
					overallRisk = owner.RiskLevel
				}
				approvalRequired = approvalRequired || owner.RequiresApproval
			}
		}
		results = append(results, map[string]any{"path": filePath, "owners": matches})
	}
	web.JSON(w, http.StatusOK, map[string]any{"data": results, "overallRisk": overallRisk, "approvalRequired": approvalRequired})
}

func (api API) ensureProjectAccess(r *http.Request, projectID string, minRole string) (bool, error) {
	user := authpkg.User(r)
	if projectID == "" {
		return false, nil
	}
	var id string
	err := api.DB.QueryRow(r.Context(), `SELECT id FROM projects WHERE id=$1`, projectID).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return authpkg.HasProjectRole(user, projectID, minRole), nil
}

func (api API) loadCodeOwner(r *http.Request, ownerID string) (codeOwnerRecord, error) {
	return scanCodeOwner(api.DB.QueryRow(r.Context(), `
		SELECT id, project_id, path_pattern, owner_type, owner_ref, risk_level,
		       requires_approval, created_by_user_id, created_at, updated_at
		FROM code_owners
		WHERE id=$1
	`, ownerID))
}

func (api API) loadCodeOwnersForProject(r *http.Request, projectID string) ([]codeOwnerRecord, error) {
	return api.loadCodeOwnersForProjectContext(r.Context(), projectID)
}

func (api API) loadCodeOwnersForProjectContext(ctx context.Context, projectID string) ([]codeOwnerRecord, error) {
	rows, err := api.DB.Query(ctx, `
		SELECT id, project_id, path_pattern, owner_type, owner_ref, risk_level,
		       requires_approval, created_by_user_id, created_at, updated_at
		FROM code_owners
		WHERE project_id=$1
		ORDER BY length(path_pattern) DESC, updated_at DESC
	`, projectID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanCodeOwnerRecords(rows)
}

func scanCodeOwnerRows(rows pgx.Rows) ([]map[string]any, error) {
	records, err := scanCodeOwnerRecords(rows)
	if err != nil {
		return nil, err
	}
	items := make([]map[string]any, 0, len(records))
	for _, record := range records {
		items = append(items, publicCodeOwner(record))
	}
	return items, nil
}

func scanCodeOwnerRecords(rows pgx.Rows) ([]codeOwnerRecord, error) {
	items := []codeOwnerRecord{}
	for rows.Next() {
		item, err := scanCodeOwner(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func scanCodeOwner(row pgx.Row) (codeOwnerRecord, error) {
	var item codeOwnerRecord
	err := row.Scan(
		&item.ID, &item.ProjectID, &item.PathPattern, &item.OwnerType, &item.OwnerRef,
		&item.RiskLevel, &item.RequiresApproval, &item.CreatedByUserID, &item.CreatedAt, &item.UpdatedAt,
	)
	return item, err
}

func publicCodeOwner(item codeOwnerRecord) map[string]any {
	return map[string]any{
		"id": item.ID, "projectId": item.ProjectID, "pathPattern": item.PathPattern,
		"ownerType": item.OwnerType, "ownerRef": item.OwnerRef, "riskLevel": item.RiskLevel,
		"requiresApproval": item.RequiresApproval, "createdByUserId": item.CreatedByUserID,
		"createdAt": formatRuntimeTime(&item.CreatedAt), "updatedAt": formatRuntimeTime(&item.UpdatedAt),
	}
}

func normalizeCodeOwnerRequest(body codeOwnerRequest) (codeOwnerRequest, error) {
	body.ProjectID = strings.TrimSpace(body.ProjectID)
	body.PathPattern = strings.TrimSpace(body.PathPattern)
	body.OwnerType = strings.TrimSpace(body.OwnerType)
	body.OwnerRef = strings.TrimSpace(body.OwnerRef)
	if body.OwnerType == "" {
		body.OwnerType = "role"
	}
	if body.RiskLevel == "" {
		body.RiskLevel = "low"
	}
	if body.ProjectID == "" || body.PathPattern == "" || body.OwnerRef == "" {
		return body, errors.New("projectId, pathPattern and ownerRef are required")
	}
	if err := validatePathPattern(body.PathPattern); err != nil {
		return body, err
	}
	if !validOwnerType(body.OwnerType) {
		return body, errors.New("Invalid ownerType")
	}
	if !validRiskLevel(body.RiskLevel) {
		return body, errors.New("Invalid riskLevel")
	}
	return body, nil
}

func mergeCodeOwnerRequest(target *codeOwnerRequest, patch codeOwnerRequest) {
	if patch.ProjectID != "" {
		target.ProjectID = patch.ProjectID
	}
	if patch.PathPattern != "" {
		target.PathPattern = patch.PathPattern
	}
	if patch.OwnerType != "" {
		target.OwnerType = patch.OwnerType
	}
	if patch.OwnerRef != "" {
		target.OwnerRef = patch.OwnerRef
	}
	if patch.RiskLevel != "" {
		target.RiskLevel = patch.RiskLevel
	}
	if patch.RequiresApproval != nil {
		target.RequiresApproval = patch.RequiresApproval
	}
}

func validOwnerType(value string) bool {
	return value == "user" || value == "role" || value == "team"
}

func codeOwnerPatternMatches(pattern string, filePath string) bool {
	pattern = strings.TrimPrefix(strings.TrimSpace(pattern), "./")
	filePath = strings.TrimPrefix(strings.TrimSpace(filePath), "./")
	if pattern == "" || filePath == "" {
		return false
	}
	if pattern == "*" || pattern == "**" {
		return true
	}
	if strings.HasSuffix(pattern, "/**") {
		prefix := strings.TrimSuffix(pattern, "/**")
		return filePath == prefix || strings.HasPrefix(filePath, prefix+"/")
	}
	if strings.HasSuffix(pattern, "/*") {
		prefix := strings.TrimSuffix(pattern, "/*")
		if !strings.HasPrefix(filePath, prefix+"/") {
			return false
		}
		return !strings.Contains(strings.TrimPrefix(filePath, prefix+"/"), "/")
	}
	return pattern == filePath
}

func compareRisk(left string, right string) int {
	return riskRank(left) - riskRank(right)
}

func riskRank(value string) int {
	switch value {
	case "low":
		return 1
	case "medium":
		return 2
	case "high":
		return 3
	case "critical":
		return 4
	default:
		return 0
	}
}
