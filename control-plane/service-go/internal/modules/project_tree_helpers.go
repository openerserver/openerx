package modules

import (
	"context"
	"encoding/json"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"openerx/control-plane/service-go/internal/web"
)

func scanOrgRows(rows pgx.Rows) ([]map[string]any, error) {
	var items []map[string]any
	for rows.Next() {
		var id, name, slug string
		var created time.Time
		if err := rows.Scan(&id, &name, &slug, &created); err != nil {
			return nil, err
		}
		items = append(items, map[string]any{"id": id, "name": name, "slug": slug, "createdAt": created.UTC().Format(time.RFC3339Nano)})
	}
	return items, rows.Err()
}

func scanProjectRows(rows pgx.Rows) ([]map[string]any, error) {
	var items []map[string]any
	for rows.Next() {
		var id, orgID, name, slug, status string
		var description *string
		var settings []byte
		var created, updated time.Time
		if err := rows.Scan(&id, &orgID, &name, &slug, &description, &settings, &status, &created, &updated); err != nil {
			return nil, err
		}
		items = append(items, map[string]any{
			"id": id, "orgId": orgID, "name": name, "slug": slug, "description": description, "settings": scanJSONMap(settings),
			"status": status, "createdAt": created.UTC().Format(time.RFC3339Nano), "updatedAt": updated.UTC().Format(time.RFC3339Nano),
		})
	}
	return items, rows.Err()
}

func (api API) ensureProjectRoot(ctx context.Context, projectID string) error {
	rootID := "project_root:" + projectID
	_, err := api.DB.Exec(ctx, `
		INSERT INTO project_tree_nodes (id, project_id, parent_id, path, depth, node_type, content_text, created_at, updated_at)
		VALUES ($1,$2,NULL,$3::ltree,0,'project_root','Project Root',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
		ON CONFLICT (id) DO NOTHING
	`, rootID, projectID, "project_"+safeLtree(projectID))
	if err != nil {
		return err
	}
	_, err = api.DB.Exec(ctx, `
		INSERT INTO project_tree_branches (id, project_id, branch_name, head_node_id, is_default, created_at, updated_at)
		VALUES ($1,$2,'main',$3,true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
		ON CONFLICT DO NOTHING
	`, "project_branch:main:"+projectID, projectID, rootID)
	return err
}

func safeLtree(value string) string {
	out := make([]rune, 0, len(value))
	for _, r := range value {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '_' {
			out = append(out, r)
		} else {
			out = append(out, '_')
		}
	}
	return string(out)
}

func (api API) projectTree(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectId")
	_ = api.ensureProjectRoot(r.Context(), projectID)
	rows, err := api.DB.Query(r.Context(), `
		SELECT id, project_id, parent_id, path::text, depth, node_type, role, content_text, content_json, ref_type, ref_id,
		       token_count, runtime_session_id, runtime_message_id, branch_name, is_active, superseded_by, created_at, updated_at, archived_at
		FROM project_tree_nodes
		WHERE project_id=$1
		ORDER BY depth, created_at
	`, projectID)
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	defer rows.Close()
	items, err := scanTreeRows(rows)
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	web.JSON(w, http.StatusOK, map[string]any{"data": items})
}

func (api API) projectTreeNode(w http.ResponseWriter, r *http.Request) {
	api.treeQuery(w, r, `AND id=$2`, chi.URLParam(r, "nodeId"), false)
}

func (api API) projectTreeChildren(w http.ResponseWriter, r *http.Request) {
	api.treeQuery(w, r, `AND parent_id=$2`, chi.URLParam(r, "nodeId"), true)
}

func (api API) createProjectTreeChild(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectId")
	parentID := chi.URLParam(r, "nodeId")
	var body struct {
		ID               string         `json:"id"`
		NodeType         string         `json:"nodeType"`
		Role             *string        `json:"role"`
		ContentText      *string        `json:"contentText"`
		ContentJSON      map[string]any `json:"contentJson"`
		TokenCount       *int           `json:"tokenCount"`
		RuntimeSessionID *string        `json:"runtimeSessionId"`
		RuntimeMessageID *string        `json:"runtimeMessageId"`
		BranchName       *string        `json:"branchName"`
		IsActive         *bool          `json:"isActive"`
		ArchivedAt       *time.Time     `json:"archivedAt"`
	}
	if !decodeBody(w, r, &body) {
		return
	}
	if body.NodeType == "" {
		web.Error(w, http.StatusBadRequest, "nodeType is required")
		return
	}
	nodeID := body.ID
	if nodeID == "" {
		nodeID = uuid.NewString()
	}
	var parentPath string
	var parentDepth int
	if err := api.DB.QueryRow(r.Context(), `SELECT path::text, depth FROM project_tree_nodes WHERE project_id=$1 AND id=$2`, projectID, parentID).Scan(&parentPath, &parentDepth); err != nil {
		web.Error(w, http.StatusNotFound, "Parent node not found")
		return
	}
	contentJSON, _ := jsonBytes(body.ContentJSON)
	isActive := boolValue(body.IsActive, true)
	now := time.Now().UTC()
	_, err := api.DB.Exec(r.Context(), `
		INSERT INTO project_tree_nodes (
			id, project_id, parent_id, path, depth, node_type, role, content_text, content_json,
			token_count, runtime_session_id, runtime_message_id, branch_name, is_active, created_at, updated_at, archived_at
		) VALUES ($1,$2,$3,$4::ltree,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$15,$16)
		ON CONFLICT (id) DO NOTHING
	`, nodeID, projectID, parentID, parentPath+"."+safeLtree(body.NodeType)+"_"+safeLtree(nodeID), parentDepth+1, body.NodeType, body.Role, body.ContentText, contentJSON, body.TokenCount, body.RuntimeSessionID, body.RuntimeMessageID, body.BranchName, isActive, now, body.ArchivedAt)
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	rows, err := api.DB.Query(r.Context(), `
		SELECT id, project_id, parent_id, path::text, depth, node_type, role, content_text, content_json, ref_type, ref_id,
		       token_count, runtime_session_id, runtime_message_id, branch_name, is_active, superseded_by, created_at, updated_at, archived_at
		FROM project_tree_nodes
		WHERE project_id=$1 AND id=$2
	`, projectID, nodeID)
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	defer rows.Close()
	items, err := scanTreeRows(rows)
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	if len(items) == 0 {
		web.Error(w, http.StatusNotFound, "Tree node not found")
		return
	}
	web.JSON(w, http.StatusCreated, items[0])
}

func (api API) projectTreeAncestors(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectId")
	nodeID := chi.URLParam(r, "nodeId")
	var path string
	if err := api.DB.QueryRow(r.Context(), `SELECT path::text FROM project_tree_nodes WHERE project_id=$1 AND id=$2`, projectID, nodeID).Scan(&path); err != nil {
		web.Error(w, http.StatusNotFound, "Tree node not found")
		return
	}
	rows, err := api.DB.Query(r.Context(), `
		SELECT id, project_id, parent_id, path::text, depth, node_type, role, content_text, content_json, ref_type, ref_id,
		       token_count, runtime_session_id, runtime_message_id, branch_name, is_active, superseded_by, created_at, updated_at, archived_at
		FROM project_tree_nodes
		WHERE project_id=$1 AND path @> $2::ltree
		ORDER BY depth, created_at
	`, projectID, path)
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	defer rows.Close()
	items, err := scanTreeRows(rows)
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	web.JSON(w, http.StatusOK, map[string]any{"data": items})
}

func (api API) projectTreeLinks(w http.ResponseWriter, r *http.Request) {
	nodeID := chi.URLParam(r, "nodeId")
	rows, err := api.DB.Query(r.Context(), `
		SELECT id, source_node_id, source_project_id, target_node_id, target_project_id, link_type, metadata, bidirectional, created_by, created_at
		FROM project_tree_links
		WHERE source_node_id=$1 OR target_node_id=$1
		ORDER BY created_at DESC
	`, nodeID)
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	defer rows.Close()
	items, err := scanLinkRows(rows, nodeID)
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	web.JSON(w, http.StatusOK, map[string]any{"data": items})
}

func (api API) projectLinks(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectId")
	rows, err := api.DB.Query(r.Context(), `
		SELECT id, source_node_id, source_project_id, target_node_id, target_project_id, link_type, metadata, bidirectional, created_by, created_at
		FROM project_tree_links
		WHERE source_project_id=$1 OR target_project_id=$1
		ORDER BY created_at DESC
	`, projectID)
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	defer rows.Close()
	items, err := scanLinkRows(rows, "")
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	web.JSON(w, http.StatusOK, map[string]any{"data": items})
}

func (api API) createProjectTreeLink(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectId")
	nodeID := chi.URLParam(r, "nodeId")
	var body struct {
		TargetNodeID    string         `json:"targetNodeId"`
		TargetProjectID string         `json:"targetProjectId"`
		LinkType        string         `json:"linkType"`
		Metadata        map[string]any `json:"metadata"`
		Bidirectional   *bool          `json:"bidirectional"`
	}
	if !decodeBody(w, r, &body) {
		return
	}
	targetProjectID := body.TargetProjectID
	if targetProjectID == "" {
		targetProjectID = projectID
	}
	metadata, _ := jsonBytes(body.Metadata)
	id := uuid.NewString()
	now := time.Now().UTC()
	_, err := api.DB.Exec(r.Context(), `
		INSERT INTO project_tree_links (id, source_node_id, source_project_id, target_node_id, target_project_id, link_type, metadata, bidirectional, created_by, created_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
	`, id, nodeID, projectID, body.TargetNodeID, targetProjectID, body.LinkType, metadata, boolValue(body.Bidirectional, false), nil, now)
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	web.JSON(w, http.StatusCreated, map[string]any{
		"id": id, "sourceNodeId": nodeID, "sourceProjectId": projectID, "targetNodeId": body.TargetNodeID,
		"targetProjectId": targetProjectID, "linkType": body.LinkType, "metadata": body.Metadata,
		"bidirectional": boolValue(body.Bidirectional, false), "createdAt": now.Format(time.RFC3339Nano),
	})
}

func (api API) deleteProjectTreeLink(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectId")
	linkID := chi.URLParam(r, "linkId")
	tag, err := api.DB.Exec(r.Context(), `
		DELETE FROM project_tree_links
		WHERE id=$1 AND (source_project_id=$2 OR target_project_id=$2)
	`, linkID, projectID)
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	if tag.RowsAffected() == 0 {
		web.Error(w, http.StatusNotFound, "Project tree link not found")
		return
	}
	web.JSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (api API) treeQuery(w http.ResponseWriter, r *http.Request, extra string, arg string, wrapped bool) {
	projectID := chi.URLParam(r, "projectId")
	rows, err := api.DB.Query(r.Context(), `
		SELECT id, project_id, parent_id, path::text, depth, node_type, role, content_text, content_json, ref_type, ref_id,
		       token_count, runtime_session_id, runtime_message_id, branch_name, is_active, superseded_by, created_at, updated_at, archived_at
		FROM project_tree_nodes
		WHERE project_id=$1 `+extra+`
		ORDER BY depth, created_at
	`, projectID, arg)
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	defer rows.Close()
	items, err := scanTreeRows(rows)
	if err != nil {
		web.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	if wrapped {
		web.JSON(w, http.StatusOK, map[string]any{"data": items})
		return
	}
	if len(items) == 0 {
		web.Error(w, http.StatusNotFound, "Tree node not found")
		return
	}
	web.JSON(w, http.StatusOK, items[0])
}

func scanTreeRows(rows pgx.Rows) ([]map[string]any, error) {
	var items []map[string]any
	for rows.Next() {
		var id, projectID, path, nodeType string
		var parentID, role, contentText, refType, refID, runtimeSessionID, runtimeMessageID, branchName, supersededBy *string
		var depth int
		var contentJSON []byte
		var tokenCount *int
		var isActive bool
		var created, updated time.Time
		var archived *time.Time
		if err := rows.Scan(&id, &projectID, &parentID, &path, &depth, &nodeType, &role, &contentText, &contentJSON, &refType, &refID, &tokenCount, &runtimeSessionID, &runtimeMessageID, &branchName, &isActive, &supersededBy, &created, &updated, &archived); err != nil {
			return nil, err
		}
		items = append(items, map[string]any{
			"id": id, "projectId": projectID, "parentId": parentID, "path": path, "depth": depth, "nodeType": nodeType,
			"role": role, "contentText": contentText, "contentJson": scanJSONMap(contentJSON), "refType": refType, "refId": refID,
			"tokenCount": tokenCount, "runtimeSessionId": runtimeSessionID, "runtimeMessageId": runtimeMessageID, "branchName": branchName,
			"isActive": isActive, "supersededBy": supersededBy, "createdAt": created.UTC().Format(time.RFC3339Nano),
			"updatedAt": updated.UTC().Format(time.RFC3339Nano), "archivedAt": web.NormalizeTime(archived),
		})
	}
	return items, rows.Err()
}

func (api API) ProjectTreeRoutes(r chi.Router) {
	r.Get("/tasks", api.listProjectTreeTasks)
	r.Get("/tasks/{taskId}", api.getProjectTreeTask)
}

func scanLinkRows(rows pgx.Rows, focusNodeID string) ([]map[string]any, error) {
	items := []map[string]any{}
	for rows.Next() {
		var id, sourceNodeID, sourceProjectID, targetNodeID, targetProjectID, linkType string
		var metadata []byte
		var bidirectional bool
		var createdBy *string
		var created time.Time
		if err := rows.Scan(&id, &sourceNodeID, &sourceProjectID, &targetNodeID, &targetProjectID, &linkType, &metadata, &bidirectional, &createdBy, &created); err != nil {
			return nil, err
		}
		direction := "incoming"
		if sourceNodeID == focusNodeID {
			direction = "outgoing"
			if targetNodeID == focusNodeID {
				direction = "self"
			}
		}
		var meta map[string]any
		if len(metadata) > 0 {
			_ = json.Unmarshal(metadata, &meta)
		}
		items = append(items, map[string]any{
			"id": id, "sourceNodeId": sourceNodeID, "sourceProjectId": sourceProjectID, "targetNodeId": targetNodeID,
			"targetProjectId": targetProjectID, "linkType": linkType, "metadata": meta, "bidirectional": bidirectional,
			"createdBy": createdBy, "createdAt": created.UTC().Format(time.RFC3339Nano), "direction": direction,
		})
	}
	return items, rows.Err()
}
