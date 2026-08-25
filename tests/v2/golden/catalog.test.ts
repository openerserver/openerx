import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

interface GoldenTask {
  id: string;
  category: string;
  gate: "hard" | "quality";
  input: { fixture: string; prompt: string };
  expected: string[];
}

interface GoldenCatalog {
  catalogVersion: string;
  platforms: string[];
  evidencePathTemplate: string;
  tasks: GoldenTask[];
}

const catalogPath = path.resolve(import.meta.dirname, "catalog.json");
const catalog = JSON.parse(readFileSync(catalogPath, "utf8")) as GoldenCatalog;

describe("V2 golden task catalog", () => {
  it("freezes exactly ten tasks in each product category", () => {
    expect(catalog.tasks).toHaveLength(50);
    expect(new Set(catalog.tasks.map(({ id }) => id)).size).toBe(50);

    for (const category of ["chat", "file", "account", "billing", "tool"]) {
      expect(catalog.tasks.filter((task) => task.category === category)).toHaveLength(10);
    }
  });

  it("gives every task a fixed input, expected result and evidence destination", () => {
    expect(catalog.catalogVersion).toMatch(/^\d{4}-\d{2}-\d{2}\.v\d+$/);
    expect(catalog.platforms).toEqual(["windows-x64", "macos-arm64", "macos-x64"]);
    expect(catalog.evidencePathTemplate).toContain("{platform}");
    expect(catalog.evidencePathTemplate).toContain("{taskId}");

    for (const task of catalog.tasks) {
      expect(task.id).toMatch(/^GT-(CHAT|FILE|ACCOUNT|BILLING|TOOL)-\d{2}$/);
      expect(task.input.fixture).toMatch(/\.v\d+$/);
      expect(task.input.prompt.length).toBeGreaterThan(5);
      expect(task.expected.length).toBeGreaterThanOrEqual(2);
      expect(["hard", "quality"]).toContain(task.gate);
    }
  });
});
