import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { PiMemoryClusterFrame } from "@openerx/contracts";
import { MemoryRepository } from "@openerx/storage";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type MemoryClusterRequest,
  MemoryConsolidationScheduler,
  PiMemoryClusterer,
} from "../src/memory-consolidation-scheduler";
import type { PiHostClient } from "../src/pi-host-client";

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
  it("uses a server-deduplicated platform request for semantic clustering", async () => {
    const clusterMemories = vi.fn(async (frame: PiMemoryClusterFrame) => ({
      kind: "pi.memory.cluster-result" as const,
      requestId: frame.requestId,
      ok: true as const,
      output: { proposals: [] },
      usageRecords: [],
    }));
    const clusterer = new PiMemoryClusterer(
      { clusterMemories } as unknown as PiHostClient,
      async () => ({
        authorization: {
          accountId: randomUUID(),
          accessToken: "t".repeat(32),
          accessTokenExpiresAt: "2026-08-31T00:00:00.000Z",
          platformBaseUrl: "https://platform.example.test",
        },
      }),
    );
    const runId = randomUUID();
    await expect(
      clusterer.cluster({
        batchKey: "7-3",
        run: {
          id: runId,
          ownerProfileId: "local-default",
          reason: "daily",
          status: "completed",
          activeCount: 2,
          expiredCount: 0,
          repairedCount: 0,
          lastErrorCode: null,
          startedAt: "2026-08-30T00:00:00.000Z",
          updatedAt: "2026-08-30T00:00:01.000Z",
          completedAt: "2026-08-30T00:00:01.000Z",
        },
        memories: [
          { id: randomUUID(), kind: "preference", content: "用户希望先给结论。" },
          { id: randomUUID(), kind: "preference", content: "用户偏好结论优先。" },
        ],
      }),
    ).resolves.toEqual({ proposals: [] });
    expect(clusterMemories).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "pi.memory.cluster",
        thinkingLevel: "medium",
        platform: expect.objectContaining({
          selectedModelRef: "platform/auto",
          requestDedupeKey: `memory-cluster:${runId}:7-3`,
        }),
      }),
    );
  });

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

  it("stages bounded historical semantic proposals after deterministic consolidation", async () => {
    const repository = new MemoryRepository(databasePath());
    repository.updateSettings({ memoriesEnabled: true });
    const left = repository.upsert({
      kind: "preference",
      content: "用户希望先给结论。",
      idempotencyKey: "memory-cluster-scheduler-0001",
    });
    const right = repository.upsert({
      kind: "preference",
      content: "用户偏好结论优先。",
      idempotencyKey: "memory-cluster-scheduler-0002",
    });
    const cluster = vi.fn(async () => ({
      proposals: [
        {
          relation: "duplicate" as const,
          leftMemoryId: left.id,
          rightMemoryId: right.id,
          confidence: 0.93,
        },
      ],
    }));
    const scheduler = new MemoryConsolidationScheduler({
      repository,
      clusterer: { cluster },
    });

    await expect(scheduler.tick()).resolves.toMatchObject({ status: "completed" });
    expect(cluster).toHaveBeenCalledWith(
      expect.objectContaining({
        memories: expect.arrayContaining([
          expect.objectContaining({ id: left.id }),
          expect.objectContaining({ id: right.id }),
        ]),
      }),
    );
    expect(repository.listMergeReviews()).toEqual([
      expect.objectContaining({
        relation: "duplicate",
        proposalMemoryId: expect.any(String),
        status: "pending",
      }),
    ]);
    repository.close();
  });

  it("advances two persisted block pairs per run without repeating a completed cycle", async () => {
    const repository = new MemoryRepository(databasePath());
    repository.updateSettings({ memoriesEnabled: true });
    for (let index = 0; index < 45; index += 1) {
      repository.upsert({
        kind: "preference",
        content: `用户偏好编号 ${index}。`,
        idempotencyKey: `memory-cluster-batch-${index}-0001`,
      });
    }
    const cluster = vi.fn(async (_request: MemoryClusterRequest) => ({ proposals: [] }));
    const scheduler = new MemoryConsolidationScheduler({
      repository,
      clusterer: { cluster },
    });

    await expect(scheduler.tick()).resolves.toMatchObject({ status: "completed" });
    expect(cluster).toHaveBeenCalledTimes(2);
    expect(cluster.mock.calls.map(([request]) => request.memories.length)).toEqual([20, 40]);
    expect(repository.nextSemanticClusterBatch()).toMatchObject({
      cursor: 2,
      pairCount: 6,
      stateRevision: 3,
    });
    repository.close();
  });

  it("keeps a completed deterministic run when optional semantic clustering fails", async () => {
    const repository = new MemoryRepository(databasePath());
    repository.updateSettings({ memoriesEnabled: true });
    for (const [index, content] of ["用户偏好中文。", "用户偏好简体中文。"].entries()) {
      repository.upsert({
        kind: "preference",
        content,
        idempotencyKey: `memory-cluster-failure-${index}-0001`,
      });
    }
    const onError = vi.fn();
    const scheduler = new MemoryConsolidationScheduler({
      repository,
      clusterer: { cluster: async () => Promise.reject(new Error("MODEL_OFFLINE")) },
      onError,
    });

    await expect(scheduler.tick()).resolves.toMatchObject({ status: "completed" });
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ message: "MODEL_OFFLINE" }),
      expect.objectContaining({ status: "completed" }),
    );
    expect(repository.listConsolidationRuns()).toEqual([
      expect.objectContaining({ status: "completed", lastErrorCode: null }),
    ]);
    expect(repository.nextSemanticClusterBatch()).toMatchObject({
      cursor: 0,
      stateRevision: 1,
    });
    repository.close();
  });
});

import { randomUUID } from "node:crypto";
