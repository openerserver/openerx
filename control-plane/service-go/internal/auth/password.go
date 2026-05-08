package auth

import "unicode"

func ValidPasswordPolicy(password string) bool {
	if len(password) < 8 {
		return false
	}
	var lower, upper, digit, special bool
	for _, r := range password {
		switch {
		case unicode.IsLower(r):
			lower = true
		case unicode.IsUpper(r):
			upper = true
		case unicode.IsDigit(r):
			digit = true
		default:
			special = true
		}
	}
	return lower && upper && digit && special
}
