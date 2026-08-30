import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { MemoryRepository } from "@openerx/storage";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryConsolidationScheduler } from "../src/memory-consolidation-scheduler";

const directories: string[] = [];

function databasePath(): string {
  const directory = mkdtempSync(path.join(tmpdir(), "openerx-memory-consolidation-"));
  directories.push(directory);
  return path.join(directory, "openerx.sqlite");
}

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("MemoryConsolidationScheduler", () => {
  it("persists completed runs and respects both time and active-memory triggers", async () => {
    let now = "2026-08-30T00:00:00.000Z";
    const repository = new MemoryRepository(databasePath(), { now: () => now });
    repository.updateSettings({ memoriesEnabled: true });
    repository.upsert({
      kind: "profile",
      content: "用户常驻上海。",
      idempotencyKey: "memory-consolidation-scheduler-0001",
    });
    repository.upsert({
      kind: "preference",
      content: "用户偏好中文回复。",
      idempotencyKey: "memory-consolidation-scheduler-0002",
    });
    const changed = vi.fn();
    const scheduler = new MemoryConsolidationScheduler({
      repository,
      consolidationIntervalMs: 60_000,
      activeLimit: 1,
      onRunChanged: changed,
    });

    await expect(scheduler.tick()).resolves.toMatchObject({
      reason: "active_limit",
      status: "completed",
    });
    expect(changed).toHaveBeenNthCalledWith(1, expect.objectContaining({ status: "running" }));
    expect(changed).toHaveBeenNthCalledWith(2, expect.objectContaining({ status: "completed" }));

    now = "2026-08-30T00:00:30.000Z";
    await expect(scheduler.tick()).resolves.toBeNull();
    now = "2026-08-30T00:01:01.000Z";
    await expect(scheduler.tick()).resolves.toMatchObject({ status: "completed" });
    expect(repository.listConsolidationRuns()).toHaveLength(2);
    repository.close();
  });
});
