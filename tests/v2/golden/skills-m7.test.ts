import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { capabilityRequirement } from "@openerx/tool-sdk";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "../../..");
const regressions = JSON.parse(
  readFileSync(path.join(import.meta.dirname, "regression-map.json"), "utf8"),
) as Record<string, string[]>;
const catalog = JSON.parse(
  readFileSync(path.join(import.meta.dirname, "catalog.json"), "utf8"),
) as { tasks: Array<{ id: string; input: { fixture: string } }> };

describe("M7 Skill Golden Tasks", () => {
  it("keeps explicit, lifecycle and cross-device fixtures linked to executable regressions", () => {
    expect(
      catalog.tasks
        .filter(({ id }) => ["GT-TOOL-07", "GT-TOOL-08", "GT-TOOL-09"].includes(id))
        .map(({ id, input }) => [id, input.fixture]),
    ).toEqual([
      ["GT-TOOL-07", "tool.skill-explicit.v1"],
      ["GT-TOOL-08", "tool.skill-lifecycle.v1"],
      ["GT-TOOL-09", "tool.skill-cross-device.v1"],
    ]);
    for (const id of ["GT-TOOL-07", "GT-TOOL-08", "GT-TOOL-09"]) {
      expect(regressions[id]).toContain("apps/desktop/scripts/e2e-skills.mjs");
      for (const test of regressions[id] ?? [])
        expect(existsSync(path.join(root, test)), test).toBe(true);
    }
  });

  it("keeps Skill resources low risk and every script execution at L5 per call", () => {
    expect(
      capabilityRequirement({
        operation: "skill_read",
        installationId: "00000000-0000-4000-8000-000000000701",
        relativePath: "references/template.md",
        idempotencyKey: "golden-skill-read-0001",
      }),
    ).toMatchObject({ capability: "skill", risk: "L0", approval: "automatic" });
    expect(
      capabilityRequirement({
        operation: "skill_script_execute",
        installationId: "00000000-0000-4000-8000-000000000701",
        relativePath: "scripts/render.mjs",
        args: [],
        timeoutMs: 5_000,
        allowNetwork: false,
        idempotencyKey: "golden-skill-script-0001",
      }),
    ).toMatchObject({ capability: "skill", risk: "L5", approval: "per_call" });
  });
});
