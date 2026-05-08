package auth

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"openerx/control-plane/service-go/internal/web"
)

type contextKey string

const userContextKey contextKey = "user"

type ProjectClaim struct {
	ID   string `json:"id"`
	Role string `json:"role"`
}

type Claims struct {
	Sub      string         `json:"sub"`
	Org      string         `json:"org"`
	Projects []ProjectClaim `json:"projects"`
	Role     string         `json:"role"`
	TV       *int           `json:"tv,omitempty"`
	jwt.RegisteredClaims
}

type Service struct {
	Secret []byte
	DB     *pgxpool.Pool
}

func New(secret string, db *pgxpool.Pool) Service {
	return Service{Secret: []byte(secret), DB: db}
}

func (s Service) Sign(payload Claims, ttl time.Duration) (string, error) {
	now := time.Now()
	payload.IssuedAt = jwt.NewNumericDate(now)
	payload.ExpiresAt = jwt.NewNumericDate(now.Add(ttl))
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, payload)
	return token.SignedString(s.Secret)
}

func (s Service) Verify(tokenString string) (*Claims, error) {
	token, err := jwt.ParseWithClaims(tokenString, &Claims{}, func(token *jwt.Token) (any, error) {
		if token.Method != jwt.SigningMethodHS256 {
			return nil, errors.New("unexpected signing method")
		}
		return s.Secret, nil
	})
	if err != nil {
		return nil, err
	}
	claims, ok := token.Claims.(*Claims)
	if !ok || !token.Valid {
		return nil, errors.New("invalid token")
	}
	return claims, nil
}

func (s Service) Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		authorization := r.Header.Get("Authorization")
		if !strings.HasPrefix(authorization, "Bearer ") {
			web.Error(w, http.StatusUnauthorized, "Missing or invalid authorization header")
			return
		}

		claims, err := s.Verify(strings.TrimPrefix(authorization, "Bearer "))
		if err != nil {
			web.Error(w, http.StatusUnauthorized, "Invalid or expired token")
			return
		}

		if !strings.HasPrefix(claims.Sub, "system:") {
			var status string
			var tokenVersion int
			err := s.DB.QueryRow(r.Context(), `SELECT account_status, token_version FROM users WHERE id=$1`, claims.Sub).Scan(&status, &tokenVersion)
			if err != nil || status != "active" {
				web.Error(w, http.StatusUnauthorized, "Account is disabled or unavailable")
				return
			}
			if claims.TV != nil && *claims.TV != tokenVersion {
				web.Error(w, http.StatusUnauthorized, "Session expired, please login again")
				return
			}
		}

		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), userContextKey, claims)))
	})
}

func User(r *http.Request) *Claims {
	value, _ := r.Context().Value(userContextKey).(*Claims)
	return value
}

var roleHierarchy = map[string]int{
	"platform_admin": 5,
	"org_admin":      4,
	"project_admin":  3,
	"developer":      2,
	"viewer":         1,
}

func RequireRole(minRole string, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		user := User(r)
		if user == nil {
			web.Error(w, http.StatusUnauthorized, "Authentication required")
			return
		}
		if roleHierarchy[user.Role] < roleHierarchy[minRole] {
			web.JSON(w, http.StatusForbidden, map[string]any{
				"error":    "Insufficient permissions",
				"required": minRole,
				"current":  user.Role,
			})
			return
		}
		next.ServeHTTP(w, r)
	})
}

func HasProjectRole(user *Claims, projectID string, minRole string) bool {
	if user == nil {
		return false
	}
	if roleHierarchy[user.Role] >= roleHierarchy["org_admin"] {
		return true
	}
	for _, project := range user.Projects {
		if project.ID == projectID && roleHierarchy[project.Role] >= roleHierarchy[minRole] {
			return true
		}
	}
	return false
}

func RequireProjectRole(projectID string, minRole string, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		user := User(r)
		if user == nil {
			web.Error(w, http.StatusUnauthorized, "Authentication required")
			return
		}
		if !HasProjectRole(user, projectID, minRole) {
			if !userHasAnyProject(user, projectID) && roleHierarchy[user.Role] < roleHierarchy["org_admin"] {
				web.Error(w, http.StatusForbidden, "No access to this project")
				return
			}
			web.JSON(w, http.StatusForbidden, map[string]any{
				"error":    "Insufficient project permissions",
				"required": minRole,
				"current":  projectRole(user, projectID),
			})
			return
		}
		next.ServeHTTP(w, r)
	})
}

func userHasAnyProject(user *Claims, projectID string) bool {
	return projectRole(user, projectID) != ""
}

func projectRole(user *Claims, projectID string) string {
	for _, project := range user.Projects {
		if project.ID == projectID {
			return project.Role
		}
	}
	return ""
}
