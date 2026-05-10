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

func TestContributorLevelRiskAndRuntimePolicy(t *testing.T) {
	if !contributorCanAcceptRisk("L1", "low") {
		t.Fatal("L1 should accept low risk tasks")
	}
	if contributorCanAcceptRisk("L1", "medium") {
		t.Fatal("L1 should not accept medium risk tasks")
	}
	if !contributorCanAcceptRisk("L3", "high") {
		t.Fatal("L3 should accept high risk tasks")
	}
	if contributorCanAcceptRisk("L4", "critical") {
		t.Fatal("critical tasks should require L5")
	}
	if !contributorCanUseRuntimeLevel("L2", 3) {
		t.Fatal("L2 should use runtime level 3")
	}
	if contributorCanUseRuntimeLevel("L2", 4) {
		t.Fatal("L2 should not use runtime level 4")
	}
}

func TestCodeOwnerPatternMatches(t *testing.T) {
	cases := []struct {
		pattern string
		path    string
		want    bool
	}{
		{"services/payments/**", "services/payments/checkout.ts", true},
		{"services/payments/**", "services/payment/checkout.ts", false},
		{"packages/ui/*", "packages/ui/Button.tsx", true},
		{"packages/ui/*", "packages/ui/forms/Input.tsx", false},
		{"infra/nginx.conf", "infra/nginx.conf", true},
		{"*", "anything.go", true},
	}
	for _, tc := range cases {
		if got := codeOwnerPatternMatches(tc.pattern, tc.path); got != tc.want {
			t.Fatalf("pattern %q path %q got %v want %v", tc.pattern, tc.path, got, tc.want)
		}
	}
}

func TestRiskRankOrdering(t *testing.T) {
	if compareRisk("critical", "high") <= 0 {
		t.Fatal("critical should rank above high")
	}
	if compareRisk("low", "medium") >= 0 {
		t.Fatal("low should rank below medium")
	}
}

func TestRuntimeSchedulerMVPPolicy(t *testing.T) {
	if !runtimeSchedulerSupportsLevel(1) || !runtimeSchedulerSupportsLevel(2) {
		t.Fatal("MVP scheduler should support levels 1 and 2")
	}
	if runtimeSchedulerSupportsLevel(3) {
		t.Fatal("MVP scheduler should not support level 3 yet")
	}
	if err := validateLocalPreviewTargetURL("http://127.0.0.1:5173/preview"); err != nil {
		t.Fatalf("expected localhost target URL to pass, got %v", err)
	}
	if err := validateLocalPreviewTargetURL("https://example.com/preview"); err == nil {
		t.Fatal("expected non-local target URL to be rejected")
	}
	if err := validateLocalPreviewTargetURL("file:///tmp/demo"); err == nil {
		t.Fatal("expected non-http target URL to be rejected")
	}
}
