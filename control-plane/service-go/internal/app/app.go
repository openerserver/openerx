package app

import (
	"context"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"openerx/control-plane/service-go/internal/auth"
	"openerx/control-plane/service-go/internal/config"
	"openerx/control-plane/service-go/internal/modules"
	"openerx/control-plane/service-go/internal/web"
)

func New(cfg config.Config, pool *pgxpool.Pool) http.Handler {
	r := chi.NewRouter()
	authService := auth.New(cfg.JWTSecret, pool)
	api := modules.API{DB: pool, Auth: authService}

	r.Get("/health", health)
	r.Get("/health/live", health)
	r.Get("/health/ready", func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
		defer cancel()
		var id string
		if err := pool.QueryRow(ctx, `SELECT id FROM users ORDER BY id LIMIT 1`).Scan(&id); err != nil {
			web.JSON(w, http.StatusServiceUnavailable, map[string]any{
				"status":  "error",
				"service": "opener-x-control-plane",
				"error":   err.Error(),
			})
			return
		}
		health(w, r)
	})

	r.Route("/api/auth", api.AuthRoutes)

	r.Group(func(protected chi.Router) {
		protected.Use(authService.Middleware)
		protected.Route("/api/users", api.UserRoutes)
		protected.Route("/api/orgs", api.OrgRoutes)
		protected.Route("/api/projects", api.ProjectRoutes)
		protected.Route("/api/project-tree", api.ProjectTreeRoutes)
		protected.Route("/api/audit", api.AuditRoutes)
		protected.Route("/api/envs", api.EnvRoutes)
		protected.Route("/api/policies", api.PolicyRoutes)
		protected.Route("/api/plugins", api.PluginRoutes)
		protected.Route("/api/tasks", api.TaskRoutes)
		protected.Route("/api/approvals", api.ApprovalRoutes)
		protected.Route("/api/governance", api.GovernanceRoutes)
		protected.Route("/api/agent-runs", api.AgentRunRoutes)
		protected.Route("/api/dashboard", api.DashboardRoutes)
		protected.Route("/api/code-changes", api.CodeChangeRoutes)
		protected.Route("/api/commit-runtimes", api.CommitRuntimeRoutes)
		protected.Route("/api/workflow-templates", api.WorkflowTemplateRoutes)
		protected.Route("/api/cost", api.CostRoutes)
		protected.Route("/api/role-agents", api.RoleAgentRoutes)
		protected.Route("/api/workbench", api.WorkbenchRoutes)

		protected.HandleFunc("/api/*", modules.RouteNotFound)
	})

	return web.Middleware(cfg, r)
}

func health(w http.ResponseWriter, _ *http.Request) {
	web.JSON(w, http.StatusOK, map[string]any{"status": "ok", "service": "opener-x-control-plane"})
}
