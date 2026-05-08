package modules

import (
	"net/http"

	"github.com/jackc/pgx/v5/pgxpool"

	"openerx/control-plane/service-go/internal/auth"
	"openerx/control-plane/service-go/internal/web"
)

type API struct {
	DB   *pgxpool.Pool
	Auth auth.Service
}

func RouteNotFound(w http.ResponseWriter, r *http.Request) {
	web.JSON(w, http.StatusNotFound, map[string]any{
		"error":  "Route not found",
		"method": r.Method,
		"path":   r.URL.Path,
	})
}
