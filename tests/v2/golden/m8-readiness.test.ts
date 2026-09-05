import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "../../..");
const catalog = JSON.parse(
  readFileSync(path.join(import.meta.dirname, "catalog.json"), "utf8"),
) as {
  tasks: Array<{ id: string }>;
};
const status = JSON.parse(
  readFileSync(path.join(import.meta.dirname, "m8-gate-status.json"), "utf8"),
) as {
  localImplementation: { status: string; catalogTasks: number; evidenceRecords: number };
  externalBeta: {
    status: string;
    targetUsers: { completed: number };
    completedEvidence: string[];
    requiredEvidence: string[];
  };
  performanceBudgets: Record<string, string | number>;
};

describe("M8 Personal Beta readiness ledger", () => {
  it("has a local implementation evidence record for every frozen Golden task", () => {
    expect(catalog.tasks).toHaveLength(50);
    for (const { id } of catalog.tasks) {
      expect(
        existsSync(path.join(root, "docs/v2/evidence/golden/local-implementation", `${id}.md`)),
        id,
      ).toBe(true);
    }
    expect(status.localImplementation).toMatchObject({
      status: "complete",
      catalogTasks: 50,
      evidenceRecords: 50,
    });
  });

  it("keeps real-user and cross-platform Beta evidence pending instead of simulating approval", () => {
    expect(status.externalBeta.status).toBe("pending_external");
    expect(status.externalBeta.targetUsers.completed).toBe(0);
    expect(status.externalBeta.completedEvidence).toEqual([]);
    expect(status.externalBeta.requiredEvidence).toHaveLength(5);
    expect(status.externalBeta.requiredEvidence).toContain(
      "personal-projects-signed-desktop-directory-reconnect-and-permissions",
    );
    expect(status.performanceBudgets).toMatchObject({
      status: "provisional_local",
      desktopInteractiveMs: 5_000,
      appServiceReadyMs: 5_000,
      idleRssMiB: 512,
    });
  });
});
