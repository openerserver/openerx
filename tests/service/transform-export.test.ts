/// <reference types="bun-types" />

import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SnapshotManifest } from "../../control-plane/service/src/db/migration/metadata";
import { transformExportSnapshot } from "../../control-plane/service/src/db/migration/transform-export";

const tempDirs: string[] = [];

async function createTempDir(prefix: string) {
  const dirPath = await mkdtemp(join(tmpdir(), prefix));
  tempDirs.push(dirPath);
  return dirPath;
}

async function writeJson(filePath: string, payload: unknown) {
  await Bun.write(filePath, `${JSON.stringify(payload, null, 2)}\n`);
}

async function writeJsonLines(filePath: string, rows: unknown[]) {
  await Bun.write(filePath, rows.map((row) => JSON.stringify(row)).join("\n"));
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dirPath) => rm(dirPath, { force: true, recursive: true })),
  );
});

describe("transform export snapshot", () => {
  test("synthesized task nodes no longer mirror business fields into content_json", async () => {
    const inputDir = await createTempDir("transform-export-input-");
    const outputDir = await createTempDir("transform-export-output-");

    const manifest: SnapshotManifest = {
      kind: "sqlite-export",
      generatedAt: "2025-01-01T00:00:00.000Z",
      sourceDatabasePath: "/tmp/openerx.db",
      tables: [
        {
          name: "projects",
          columns: ["id"],
          rowCount: 1,
          primaryKeyColumn: "id",
          fileName: "projects.jsonl",
        },
        {
          name: "tasks",
          columns: [
            "id",
            "project_id",
            "title",
            "prompt",
            "status",
            "session_id",
            "execution_plan",
            "execution_mode",
            "auto_advance_stages",
            "created_at",
          ],
          rowCount: 1,
          primaryKeyColumn: "id",
          fileName: "tasks.jsonl",
        },
      ],
    };

    await writeJson(join(inputDir, "manifest.json"), manifest);
    await writeJsonLines(join(inputDir, "projects.jsonl"), [{ id: "project-1" }]);
    await writeJsonLines(join(inputDir, "tasks.jsonl"), [
      {
        id: "task-1",
        project_id: "project-1",
        title: "Legacy task",
        prompt: "Do work",
        status: "running",
        session_id: "session-1",
        execution_plan: JSON.stringify({ mode: "parallel", candidates: [{ id: "candidate-1" }] }),
        execution_mode: "parallel",
        auto_advance_stages: 1,
        created_at: "2025-01-01T00:00:10.000Z",
      },
    ]);

    await transformExportSnapshot({ inputDir, outputDir });

    const projectTreeNodeRows = await Bun.file(join(outputDir, "project_tree_nodes.jsonl")).text();
    const synthesizedTaskNode = projectTreeNodeRows
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { id: string; content_json?: Record<string, unknown> })
      .find((row) => row.id === "task-1");

    expect(synthesizedTaskNode).toBeDefined();
    expect(synthesizedTaskNode?.content_json).toEqual({});
    expect(synthesizedTaskNode?.content_json).not.toHaveProperty("executionPlan");
    expect(synthesizedTaskNode?.content_json).not.toHaveProperty("executionMode");
    expect(synthesizedTaskNode?.content_json).not.toHaveProperty("autoAdvanceStages");
  });
});
