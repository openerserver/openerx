package modules

import (
	"testing"

	authpkg "openerx/control-plane/service-go/internal/auth"
)

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

func TestMarketplaceEligibilityExplainsBlockedTasks(t *testing.T) {
	profile := contributorProfile{UserID: "u1", Level: "L2", Status: "active", ActiveTaskQuota: 1, DailyTaskQuota: 2}
	if eligible, reason := marketplaceEligibility(profile, "medium", 3, 0, 0); !eligible || reason != "" {
		t.Fatalf("expected eligible L2 task, got eligible=%v reason=%q", eligible, reason)
	}
	if eligible, reason := marketplaceEligibility(profile, "high", 3, 0, 0); eligible || reason == "" {
		t.Fatalf("expected high risk block, got eligible=%v reason=%q", eligible, reason)
	}
	if eligible, reason := marketplaceEligibility(profile, "medium", 3, 1, 0); eligible || reason != "Contributor active task quota exceeded" {
		t.Fatalf("expected quota block, got eligible=%v reason=%q", eligible, reason)
	}
}

func TestAssignmentSettlementDelta(t *testing.T) {
	accepted, err := assignmentSettlementDelta("accepted", nil)
	if err != nil {
		t.Fatalf("accepted delta returned error: %v", err)
	}
	if accepted.Status != "completed" || accepted.CompletedDelta != 1 || accepted.Reputation != 5 {
		t.Fatalf("unexpected accepted delta: %+v", accepted)
	}
	custom := -2.5
	rejected, err := assignmentSettlementDelta("rejected", &custom)
	if err != nil {
		t.Fatalf("rejected delta returned error: %v", err)
	}
	if rejected.Status != "released" || rejected.RejectedDelta != 1 || rejected.RiskDelta != 1 || rejected.Reputation != -2.5 {
		t.Fatalf("unexpected rejected delta: %+v", rejected)
	}
	if _, err := assignmentSettlementDelta("maybe", nil); err == nil {
		t.Fatal("expected invalid outcome to fail")
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

func TestCommitStepOwnerPolicyRequiresApproval(t *testing.T) {
	files := []commitStepFileChange{{FilePath: "services/payments/checkout.ts", Insertions: 12, Deletions: 3}}
	owners := []codeOwnerRecord{{
		ID: "owner-1", PathPattern: "services/payments/**", OwnerType: "user", OwnerRef: "maintainer-1",
		RiskLevel: "high", RequiresApproval: true,
	}}
	violations, risk, approvalRequired := commitStepOwnerViolations(files, owners, "low")
	if risk != "high" {
		t.Fatalf("risk = %q, want high", risk)
	}
	if !approvalRequired {
		t.Fatal("expected owner approval to be required")
	}
	if len(violations) != 1 {
		t.Fatalf("violations = %d, want 1", len(violations))
	}
}

func TestCommitStepOwnerApprovalBypassIsScoped(t *testing.T) {
	user := &authpkg.Claims{
		Sub:      "developer-1",
		Projects: []authpkg.ProjectClaim{{ID: "project-1", Role: "developer"}},
		Role:     "developer",
	}
	profile := contributorProfile{UserID: "developer-1", Level: "L3", Status: "active"}
	otherOwner := []codeOwnerRecord{{ID: "owner-1", OwnerType: "user", OwnerRef: "maintainer-1"}}
	if userCanBypassCommitOwnerApproval(user, "project-1", profile, otherOwner) {
		t.Fatal("non-owner L3 contributor should not bypass owner approval")
	}
	selfOwner := []codeOwnerRecord{{ID: "owner-2", OwnerType: "user", OwnerRef: "developer-1"}}
	if !userCanBypassCommitOwnerApproval(user, "project-1", profile, selfOwner) {
		t.Fatal("matching user owner should bypass owner approval")
	}
	profile.Level = "L4"
	if !userCanBypassCommitOwnerApproval(user, "project-1", profile, otherOwner) {
		t.Fatal("L4 module maintainer should bypass owner approval")
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
