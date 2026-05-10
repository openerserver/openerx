package modules

import "testing"

func TestValidateTaskBoundaryRejectsUnsafePath(t *testing.T) {
	err := validateTaskBoundary(taskBoundaryRequest{
		AllowedPaths: []string{"apps/web/**", "../secrets/**"},
		RuntimeLevel: 2,
	})
	if err == nil {
		t.Fatal("expected unsafe path to be rejected")
	}
}

func TestValidateTaskBoundaryAcceptsMVPBoundary(t *testing.T) {
	err := validateTaskBoundary(taskBoundaryRequest{
		AllowedPaths:     []string{"apps/web/features/listing/**", "packages/ui/**"},
		BlockedPaths:     []string{"infra/**", "services/payment/**"},
		AcceptanceChecks: []string{"unit tests pass", "preview opens"},
		RuntimeLevel:     2,
		RiskLevel:        "medium",
	})
	if err != nil {
		t.Fatalf("expected valid boundary, got %v", err)
	}
}

func TestCommitStepPreviewStatusMapsRuntimeStates(t *testing.T) {
	cases := map[string]string{
		"queued":   "queued",
		"prepared": "queued",
		"starting": "starting",
		"running":  "running",
		"failed":   "failed",
		"expired":  "stopped",
	}
	for input, expected := range cases {
		if actual := commitStepPreviewStatus(input); actual != expected {
			t.Fatalf("runtime status %q mapped to %q, expected %q", input, actual, expected)
		}
	}
}

func TestDefaultBranchNameIsStableAndScoped(t *testing.T) {
	got := defaultBranchName("1234567890abcdef", "user-abcdef123456")
	want := "codex/task-12345678/user-abc"
	if got != want {
		t.Fatalf("default branch = %q, want %q", got, want)
	}
}
