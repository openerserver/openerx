import { spawnSync } from "node:child_process";
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

  it("keeps native signing, stores and explicit approval external", () => {
    expect(status.externalRelease).toMatchObject({
      status: "pending_external",
      userApproval: false,
      completedEvidence: [],
    });
    expect(status.externalRelease.requiredEvidence).toHaveLength(13);
    expect(status.externalRelease.requiredEvidence).toContain(
      "personal-projects-signed-cross-device-directory-reconnect-and-remote",
    );
  });

  it("keeps local release validation available and blocks unapproved publishing", () => {
    expect(readFileSync(path.join(root, ".gitignore"), "utf8")).toMatch(/credentials\.json/u);
    const gate = path.join(root, "scripts/m9/check-release-readiness.mjs");
    const local = spawnSync(process.execPath, [gate, "--mode", "local"], {
      cwd: root,
      encoding: "utf8",
    });
    expect(local.error).toBeUndefined();
    expect(local.status).toBe(0);
    const publish = spawnSync(process.execPath, [gate, "--mode", "publish"], {
      cwd: root,
      encoding: "utf8",
    });
    expect(publish.error).toBeUndefined();
    expect(publish.status).toBe(1);
    expect(publish.stderr).toContain("explicit user release approval is missing");
  });
});
