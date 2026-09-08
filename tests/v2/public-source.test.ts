import { describe, expect, it } from "vitest";
import { assertVersionPolicy } from "../../scripts/check-builtin-skill-versions.mjs";
import {
  githubPullRequestTestMergeSha,
  publicContentViolations,
  publicIdentityViolations,
  publicPathViolation,
} from "../../scripts/check-public-source.mjs";

describe("public source release guards", () => {
  it("recognizes only the runner's verified temporary pull-request merge", () => {
    const base = "a".repeat(40);
    const head = "b".repeat(40);
    const merge = "c".repeat(40);
    const environment = {
      GITHUB_ACTIONS: "true",
      GITHUB_EVENT_NAME: "pull_request",
      GITHUB_REF: "refs/pull/9/merge",
      GITHUB_SHA: merge,
    };
    const event = {
      number: 9,
      pull_request: { number: 9, base: { sha: base }, head: { sha: head } },
    };
    const commit = `tree ${"d".repeat(40)}\nparent ${base}\nparent ${head}\nauthor Contributor <person@example.com> 1 +0000\n\nMerge fixture`;
    expect(githubPullRequestTestMergeSha(environment, event, merge, commit)).toBe(merge);
    // The normal identity guard stays strict, including for ordinary merge commits.
    expect(publicIdentityViolations(commit)).toEqual(["personal-commit-email"]);
    for (const override of [
      { GITHUB_ACTIONS: "false" },
      { GITHUB_EVENT_NAME: "push" },
      { GITHUB_EVENT_NAME: "pull_request_target" },
      { GITHUB_REF: "refs/heads/main" },
      { GITHUB_REF: "refs/pull/9/head" },
      { GITHUB_REF: "refs/pull/10/merge" },
      { GITHUB_SHA: head },
    ]) {
      expect(
        githubPullRequestTestMergeSha({ ...environment, ...override }, event, merge, commit),
      ).toBeNull();
    }
    expect(githubPullRequestTestMergeSha(environment, null, merge, commit)).toBeNull();
    expect(githubPullRequestTestMergeSha(environment, event, head, commit)).toBeNull();
    expect(
      githubPullRequestTestMergeSha(environment, { ...event, number: 10 }, merge, commit),
    ).toBeNull();
    expect(
      githubPullRequestTestMergeSha(
        environment,
        event,
        merge,
        `parent ${head}\nparent ${base}\n\nMerge fixture`,
      ),
    ).toBeNull();
    expect(
      githubPullRequestTestMergeSha(environment, event, merge, `parent ${base}\n\nMerge fixture`),
    ).toBeNull();
    expect(
      githubPullRequestTestMergeSha(
        environment,
        event,
        merge,
        `parent ${base}\nparent ${head}\nparent ${merge}\n\nMerge fixture`,
      ),
    ).toBeNull();
  });

  it.each([
    "v1-backup/file.ts",
    "apps/mobile/app.ts",
    "deliverables/report.md",
    "brands/logo.png",
    ".env.production",
    "nested/.env",
    "profile.sqlite-wal",
    "release.pfx",
    "apps/desktop/out/OpenERX.exe",
    ".gitmodules",
    "design-qa.md",
    "docs/archive/internal-plan.md",
    "docs/v2/07-migration-and-delivery-contract.md",
  ])("rejects private path %s", (file) => {
    expect(publicPathViolation(file)).not.toBeNull();
  });
  it.each([
    ".env.example",
    ".env.test.example",
    "packages/branding/src/index.ts",
    "LICENSE",
    "tests/fixtures/image.png",
  ])("allows source path %s", (file) => {
    expect(publicPathViolation(file)).toBeNull();
  });
  it("flags high-confidence credentials without printing their values", () => {
    expect(publicContentViolations(`ghp_${"a".repeat(40)}`)).toEqual(["github-token"]);
    expect(
      publicContentViolations(`${["-----BEGIN", "PRIVATE KEY-----"].join(" ")}\n${"A".repeat(64)}`),
    ).toEqual(["private-key"]);
    expect(publicContentViolations("sk-replace-with-your-key")).toEqual([]);
  });
  it("rejects personal paths but permits documented placeholders and API routes", () => {
    expect(
      publicContentViolations(["C:", "Users", "private-person", "project"].join("\\")),
    ).toContain("personal-home-directory");
    expect(publicContentViolations(["", "Users", "private-person", "project"].join("/"))).toContain(
      "personal-home-directory",
    );
    expect(
      publicContentViolations("C:/Users/example/project /Users/alice/fixture /users/123"),
    ).toEqual([]);
  });
  it("requires privacy-safe author and committer metadata", () => {
    expect(publicIdentityViolations("author Contributor <person@example.com> 1 +0000")).toEqual([
      "personal-commit-email",
    ]);
    expect(
      publicIdentityViolations("author OpenERX Contributors <noreply@openerx.invalid> 1 +0000"),
    ).toEqual([]);
    expect(
      publicIdentityViolations(
        "committer Contributor <123+fixture@users.noreply.github.com> 1 +0000",
      ),
    ).toEqual([]);
  });
  it("requires content changes to increment the numeric Skill version, including branded Skills", () => {
    const snapshot = (version: string, checksum: string) => ({
      skills: [{ installationId: "fixture", name: "fixture", version, checksum }],
    });
    const base = snapshot("1.0.1", "old");
    expect(() => assertVersionPolicy(base, snapshot("1.0.2-openerx", "new"))).not.toThrow();
    expect(() => assertVersionPolicy(base, snapshot("1.0.1-openerx", "new"))).toThrow(
      "NOT_INCREMENTED",
    );
    expect(() => assertVersionPolicy(base, snapshot("0.9.9-openerx", "old"))).toThrow("regressed");
    expect(() => assertVersionPolicy(base, snapshot("01.0.2", "new"))).toThrow("INVALID");
  });
});
