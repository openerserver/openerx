package web

import (
	"encoding/json"
	"net/http"
	"strings"
	"time"
)

func JSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

func Error(w http.ResponseWriter, status int, message string) {
	JSON(w, status, map[string]any{"error": message})
}

func DecodeJSON(r *http.Request, target any) error {
	decoder := json.NewDecoder(r.Body)
	return decoder.Decode(target)
}

func NormalizeTime(value *time.Time) any {
	if value == nil || value.IsZero() {
		return nil
	}
	return value.UTC().Format(time.RFC3339Nano)
}

func NormalizeDBTime(value string) string {
	if value == "" {
		return value
	}
	if strings.HasSuffix(value, "Z") {
		return value
	}
	if parsed, err := time.Parse(time.RFC3339Nano, value); err == nil {
		return parsed.UTC().Format(time.RFC3339Nano)
	}
	if parsed, err := time.Parse("2006-01-02 15:04:05.999999-07", value); err == nil {
		return parsed.UTC().Format(time.RFC3339Nano)
	}
	if parsed, err := time.Parse("2006-01-02 15:04:05.999999-07:00", value); err == nil {
		return parsed.UTC().Format(time.RFC3339Nano)
	}
	return value
}
