import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { ChatRepository, FileRepository, MemoryRepository } from "@openerx/storage";
import { strFromU8, unzipSync } from "fflate";
import { afterEach, describe, expect, it } from "vitest";
import { DiagnosticsService, PerformanceBudgetTracker, PersonalDataExporter } from "../src";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function temporaryRoot(): string {
  const root = mkdtempSync(path.join(tmpdir(), "openerx-observability-"));
  roots.push(root);
  return root;
}

describe("M8 observability boundary", () => {
  it("redacts credentials, content fields and local paths before preview or export", () => {
    const root = temporaryRoot();
    let clock = 100;
    const tracker = new PerformanceBudgetTracker(
      0,
      () => clock,
      () => 128 * 1024 * 1024,
    );
    clock = 320;
    tracker.markAppServiceReady();
    clock = 450;
    tracker.markDesktopInteractive();
    const diagnostics = new DiagnosticsService(
      path.join(root, "diagnostics.jsonl"),
      tracker,
      () => new Date("2026-08-26T08:00:00.000Z"),
    );
    diagnostics.record({
      source: "app_service",
      level: "warning",
      code: "service.restarting",
      attributes: {
        reason: "failed at /Users/alice/private/workspace",
        prompt: "private conversation text",
        authorization: "Bearer top-secret-token",
        nested: { apiKey: "sk-12345678901234567890", safe: "kept" },
      },
    });

    const preview = diagnostics.preview();
    expect(preview).toMatchObject({ health: "ready", eventCount: 1, restartCount: 1 });
    expect(preview.performance.every(({ status }) => status === "pass")).toBe(true);
    const output = path.join(root, "bundle.json");
    diagnostics.export(output, { platform: "darwin", profilePath: root });
    const serialized = readFileSync(output, "utf8");
    expect(serialized).not.toContain("private conversation text");
    expect(serialized).not.toContain("top-secret-token");
    expect(serialized).not.toContain("sk-12345678901234567890");
    expect(serialized).not.toContain("/Users/alice");
    expect(serialized).not.toContain(root);
    expect(serialized).toContain("[REDACTED]");
    expect(serialized).toContain("[LOCAL_PATH]");
  });

  it("bounds persisted diagnostics and exported events", () => {
    const root = temporaryRoot();
    const logPath = path.join(root, "diagnostics.jsonl");
    const tracker = new PerformanceBudgetTracker(
      0,
      () => 10,
      () => 128 * 1024 * 1024,
    );
    const diagnostics = new DiagnosticsService(logPath, tracker);
    for (let index = 0; index < 1_100; index += 1) {
      diagnostics.record({
        source: "desktop",
        level: "info",
        code: "bounded.event",
        attributes: { index, detail: "x".repeat(2_500) },
      });
    }
    expect(statSync(logPath).size).toBeLessThanOrEqual(1024 * 1024);
    expect(diagnostics.preview().eventCount).toBeLessThanOrEqual(1_000);
  });

  it("exports personal content separately and excludes server-owned billing state", () => {
    const root = temporaryRoot();
    const databasePath = path.join(root, "openerx-v2.sqlite");
    const chat = new ChatRepository(databasePath);
    const draft = chat.createGeneration({
      text: "M8 personal export fixture",
      idempotencyKey: "m8-export-1",
    });
    chat.appendPiEvent(draft.receipt.assistantMessageId, {
      eventId: crypto.randomUUID(),
      sequence: 1,
      occurredAt: "2026-08-26T08:00:00.000Z",
      type: "completed",
    });
    chat.close();
    const memories = new MemoryRepository(databasePath);
    memories.updateSettings({ memoriesEnabled: true });
    for (const [index, content] of ["用户偏好中文。", "用户偏好简体中文。"].entries()) {
      memories.upsert({
        kind: "preference",
        content,
        idempotencyKey: `m8-memory-export-${index}`,
      });
    }
    expect(memories.nextSemanticClusterBatch()).not.toBeNull();
    memories.close();
    const objectRef = `objects/sha256/aa/${"a".repeat(64)}`;
    const objectPath = path.join(root, objectRef);
    mkdirSync(path.dirname(objectPath), { recursive: true });
    writeFileSync(objectPath, "binary export fixture");
    const files = new FileRepository(databasePath);
    const scope = files.createScope({ kind: "file", displayName: "fixture.txt", rootPath: root });
    const file = files.upsertPersonalFile({
      displayName: "fixture.txt",
      format: "text",
      mediaType: "text/plain",
      sizeBytes: 21,
      checksumSha256: "a".repeat(64),
      objectRef,
      sourceScopeId: scope.id,
      sourceRelativePath: "fixture.txt",
    });
    files.completeParse(file.id, { text: "binary export fixture", citations: [] });
    files.close();

    const exporter = new PersonalDataExporter(
      databasePath,
      () => new Date("2026-08-26T08:30:00.000Z"),
    );
    expect(exporter.summary()).toMatchObject({ conversations: 1, messages: 2, files: 1 });
    const output = path.join(root, "personal.zip");
    const result = exporter.export(output);
    const dataFile = unzipSync(readFileSync(output))["data.json"];
    if (!dataFile) throw new Error("Personal export data.json missing");
    const payload = JSON.parse(strFromU8(dataFile)) as Record<string, unknown>;
    expect(result).toMatchObject({ kind: "personal_data", fileName: "personal.zip" });
    expect(JSON.stringify(payload)).toContain("M8 personal export fixture");
    expect(payload.scope).toMatchObject({
      localProfile: true,
      binaryObjectsIncluded: true,
      serverBillingIncluded: false,
    });
    expect(JSON.stringify(payload)).not.toContain("objectRef");
    expect(JSON.stringify(payload)).not.toContain("credentialRef");
    expect(payload.memorySemanticClusterState).toEqual([
      expect.objectContaining({ nextPairIndex: 0, completedCycles: 0, revision: 1 }),
    ]);
    const exportedObject = Object.entries(unzipSync(readFileSync(output))).find(([name]) =>
      name.startsWith("files/"),
    )?.[1];
    expect(exportedObject ? strFromU8(exportedObject) : null).toBe("binary export fixture");
  });
});
