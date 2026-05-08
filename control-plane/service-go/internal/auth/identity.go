package auth

import (
	"regexp"
	"strings"
)

var phonePattern = regexp.MustCompile(`^\+[1-9]\d{7,14}$`)

func NormalizeInternationalPhoneNumber(value string) string {
	normalized := strings.NewReplacer(" ", "", "\t", "", "\n", "", "(", "", ")", "", ".", "", "-", "").Replace(strings.TrimSpace(value))
	if !phonePattern.MatchString(normalized) {
		return ""
	}
	return normalized
}

func NormalizeAuthIdentifier(value string) string {
	if phone := NormalizeInternationalPhoneNumber(value); phone != "" {
		return phone
	}
	return strings.ToLower(strings.TrimSpace(value))
}

func GeneratedUsernameFromPhone(phoneNumber, userID string) string {
	digits := strings.TrimPrefix(phoneNumber, "+")
	prefix := userID
	if len(prefix) > 8 {
		prefix = prefix[:8]
	}
	return "phone_" + digits + "_" + prefix
}
