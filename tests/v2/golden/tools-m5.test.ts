import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { capabilityRequirement } from "@openerx/tool-sdk";
import { describe, expect, it } from "vitest";

interface GoldenTask {
  id: string;
  category: string;
  input: { fixture: string };
}

const root = path.resolve(import.meta.dirname, "../../..");
const catalog = JSON.parse(
  readFileSync(path.join(import.meta.dirname, "catalog.json"), "utf8"),
) as { tasks: GoldenTask[] };
const toolTasks = catalog.tasks.filter(({ category }) => category === "tool");

describe("M5 Tool Golden Tasks", () => {
  it("freezes GT-TOOL-01 through 10 while keeping Skill cases in M7", () => {
    expect(toolTasks.map(({ id }) => id)).toEqual(
      Array.from({ length: 10 }, (_, index) => `GT-TOOL-${String(index + 1).padStart(2, "0")}`),
    );
    expect(toolTasks.slice(6, 9).map(({ input }) => input.fixture)).toEqual([
      "tool.skill-explicit.v1",
      "tool.skill-lifecycle.v1",
      "tool.skill-cross-device.v1",
    ]);
  });

  it("enforces the M5 risk and exact per-call approval boundary", () => {
    expect(
      capabilityRequirement({
        operation: "web_search",
        query: "current protocol",
        idempotencyKey: "golden-web-0001",
      }),
    ).toMatchObject({ capability: "web.search", risk: "L2", forcePerCallApproval: false });
    expect(
      capabilityRequirement({
        operation: "shell_execute",
        cwd: "/workspace",
        command: "node",
        args: [],
        timeoutMs: 1_000,
        background: false,
        allowNetwork: false,
        idempotencyKey: "golden-shell-0001",
      }),
    ).toMatchObject({ capability: "shell", risk: "L5", forcePerCallApproval: true });
    for (const action of ["submit", "send", "delete", "purchase"] as const) {
      expect(
        capabilityRequirement({
          operation: "desktop",
          action,
          application: "fixture",
          idempotencyKey: `golden-desktop-${action}`,
        }),
      ).toMatchObject({ risk: "L5", forcePerCallApproval: true });
    }
    expect(
      capabilityRequirement({
        operation: "image_generate",
        prompt: "fixture",
        aspectRatio: "1:1",
        count: 1,
        idempotencyKey: "golden-image-0001",
      }),
    ).toMatchObject({ capability: "image.generate", risk: "L2" });
  });

  it("keeps M5 evidence and recognizes the later M7 Skill evidence", () => {
    for (const number of [1, 2, 3, 4, 5, 6, 10]) {
      const id = `GT-TOOL-${String(number).padStart(2, "0")}`;
      const evidence = path.join(root, "docs/v2/evidence/golden/local-implementation", `${id}.md`);
      expect(existsSync(evidence), id).toBe(true);
      expect(readFileSync(evidence, "utf8")).toContain("M5 local checkpoint");
    }
    for (const number of [7, 8, 9]) {
      const id = `GT-TOOL-${String(number).padStart(2, "0")}`;
      const evidence = path.join(root, "docs/v2/evidence/golden/local-implementation", `${id}.md`);
      expect(existsSync(evidence), `${id} M7 evidence`).toBe(true);
      expect(readFileSync(evidence, "utf8")).toContain("M7 local checkpoint");
    }
  });
});
