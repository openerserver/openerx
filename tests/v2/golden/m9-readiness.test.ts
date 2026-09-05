import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "../../..");
const status = JSON.parse(
  readFileSync(path.join(import.meta.dirname, "m9-gate-status.json"), "utf8"),
) as {
  localImplementation: { status: string; completedTasks: number; expectedTasks: number };
  externalRelease: {
    status: string;
    userApproval: boolean;
    completedEvidence: string[];
    requiredEvidence: string[];
  };
};

describe("M9 release readiness ledger", () => {
  it("records all local release-foundation tasks as complete", () => {
    expect(status.localImplementation).toEqual({
      status: "complete",
      completedTasks: 8,
      expectedTasks: 8,
    });
  });

  it("keeps desktop signing and explicit approval external", () => {
    expect(status.externalRelease).toMatchObject({
      status: "pending_external",
      userApproval: false,
      completedEvidence: [],
    });
    expect(status.externalRelease.requiredEvidence).toHaveLength(9);
    expect(status.externalRelease.requiredEvidence).toContain(
      "personal-projects-signed-desktop-directory-reconnect-and-permissions",
    );
    expect(status.externalRelease.requiredEvidence.join(" ")).not.toMatch(
      /ios|android|alipay|wechat|merchant|tax/iu,
    );
  });

  it("has release automation inputs without committing credentials", () => {
    expect(readFileSync(path.join(root, ".gitignore"), "utf8")).toMatch(/credentials\.json/u);
    const workflow = readFileSync(path.join(root, ".github/workflows/v2-release.yml"), "utf8");
    expect(workflow).toContain("environment: production-release");
    expect(workflow).toContain("npm run release:gate:v2");
    expect(workflow).not.toMatch(/BEGIN (?:PRIVATE KEY|CERTIFICATE)/u);
  });
});
