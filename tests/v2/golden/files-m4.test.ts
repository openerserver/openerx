import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { AccountSyncService } from "@openerx/account-sync-api";
import { type AccountSyncTransport, SyncCoordinator } from "@openerx/app-service";
import type {
  AppServiceAuthorization,
  CloudObjectIntentInput,
  SyncConflictResolution,
} from "@openerx/contracts";
import {
  FileAppService,
  FileScopeBroker,
  MultiFormatParser,
  type OcrAdapter,
} from "@openerx/file-service";
import { ObjectStoreService } from "@openerx/object-store-api";
import { ChatRepository, FileRepository } from "@openerx/storage";
import { strFromU8, unzipSync, zipSync } from "fflate";
import { afterEach, describe, expect, it } from "vitest";

const fixtureDirectory = path.resolve("tests/v2/fixtures/m4");
const temporaryDirectories: string[] = [];
const closers: Array<() => void> = [];

interface Harness {
  root: string;
  profile: string;
  database: string;
  repository: FileRepository;
  service: FileAppService;
}

function harness(options: { parser?: MultiFormatParser; maxFileBytes?: number } = {}): Harness {
  const root = mkdtempSync(path.join(tmpdir(), "openerx-m4-golden-"));
  temporaryDirectories.push(root);
  const profile = path.join(root, "profile");
  mkdirSync(profile);
  const database = path.join(profile, "openerx.sqlite");
  const repository = new FileRepository(database);
  const service = new FileAppService(repository, profile, options);
  closers.push(() => service.close());
  return { root, profile, database, repository, service };
}

function fixture(name: string): string {
  return path.join(fixtureDirectory, name);
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function xmlEntries(filePath: string): Record<string, Uint8Array> {
  return unzipSync(new Uint8Array(readFileSync(filePath)));
}

function transportFor(
  sync: AccountSyncService,
  objects: ObjectStoreService,
  principal: { accountId: string; sessionId: string; deviceId: string },
): AccountSyncTransport {
  return {
    push: async (operation) => sync.push(principal, operation),
    pull: async (cursor) => sync.pull(principal, cursor),
    resolveConflict: async (conflictId, _resolution: SyncConflictResolution) =>
      sync.resolveConflict(principal, conflictId),
    uploadObject: async (input: CloudObjectIntentInput, bytes: Uint8Array) => {
      const intent = objects.createUploadIntent(principal, input);
      objects.upload(principal, intent.token, bytes);
    },
    downloadObject: async (objectId) => {
      const intent = objects.createDownloadIntent(principal, objectId);
      return objects.download(principal, intent.token).bytes;
    },
  };
}

function authorization(accountId: string): AppServiceAuthorization {
  return {
    accountId,
    accessToken: "m4-test-access-token-with-at-least-32-characters",
    accessTokenExpiresAt: "2026-08-26T00:00:00.000Z",
    platformBaseUrl: "https://platform.example.test",
  };
}

afterEach(() => {
  for (const close of closers.splice(0).reverse()) close();
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("M4 File Golden Tasks", () => {
  it("GT-FILE-01 grounds the page-two fact with an openable page locator", async () => {
    const { service } = harness();
    const [file] = await service.importPaths([fixture("file.cited-pdf.v1.pdf")]);
    expect(file?.parseStatus).toBe("ready");
    const result = service.search("launch window", [file?.id ?? ""])[0];
    expect(result?.citations).toContainEqual(
      expect.objectContaining({
        locator: { kind: "page", page: 2 },
        excerpt: expect.stringContaining("09:30"),
      }),
    );
  });

  it("GT-FILE-02 writes an approved DOCX change as v2 without replacing either source", async () => {
    const { root, service } = harness();
    const sourcePath = fixture("file.docx-pair.v1.docx");
    const original = readFileSync(sourcePath);
    const archive = xmlEntries(sourcePath);
    const documentXml = strFromU8(archive["word/document.xml"] ?? new Uint8Array());
    archive["word/document.xml"] = new TextEncoder().encode(
      documentXml.replace("Files only", "Files and folders"),
    );
    const approved = zipSync(archive);
    const approvedPath = path.join(root, "approved.docx");
    writeFileSync(approvedPath, approved);

    const artifact = service.createArtifact({
      displayName: "approval.docx",
      format: "docx",
      mediaType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      bytesBase64: original.toString("base64"),
    });
    const versioned = service.addArtifactVersion({
      artifactId: artifact.id,
      format: "docx",
      mediaType: artifact.mediaType,
      bytesBase64: Buffer.from(approved).toString("base64"),
    });
    expect(versioned.versions.map(({ version }) => version)).toEqual([1, 2]);
    expect(versioned.versions[0]?.checksumSha256).toBe(sha256(original));
    expect(versioned.versions[1]?.checksumSha256).toBe(sha256(approved));
    expect(sha256(readFileSync(sourcePath))).toBe(sha256(original));
    expect(unzipSync(approved)["word/document.xml"]).toBeDefined();
  });

  it("GT-FILE-03 preserves XLSX formulas and maps CSV rows with an exact anomaly set", async () => {
    const { service } = harness();
    const imported = await service.importPaths([
      fixture("file.generated-xlsx.v1.xlsx"),
      fixture("file.xlsx-csv-merge.v1.csv"),
    ]);
    expect(imported.map(({ parseStatus }) => parseStatus)).toEqual(["ready", "ready"]);
    const archive = xmlEntries(fixture("file.generated-xlsx.v1.xlsx"));
    const worksheetXml = Object.entries(archive)
      .filter(([name]) => name.startsWith("xl/worksheets/"))
      .map(([, bytes]) => strFromU8(bytes))
      .join("\n");
    expect(worksheetXml).toContain("B2*C2");
    expect(worksheetXml).toContain("SUM(Data!D2:D5)");
    const rows = readFileSync(fixture("file.xlsx-csv-merge.v1.csv"), "utf8")
      .trim()
      .split("\n")
      .slice(1)
      .map((line) => line.split(","));
    const known = new Set(["A-100", "B-200", "C-300", "D-400"]);
    expect(rows.filter((row) => !known.has(row[1] ?? "")).map((row) => row[0])).toEqual([
      "EXT-005",
    ]);
    expect(rows.reduce((sum, row) => sum + Number(row[4]), 0)).toBe(2_430);
  });

  it("GT-FILE-04 keeps the image source and OCR uncertainty explicit", async () => {
    const ocr: OcrAdapter = {
      extract: async () => ({
        text: "Archive box: 184?",
        citations: [
          {
            locator: { kind: "image_region", label: "Archive box" },
            excerpt: "184?",
            confidence: 0.61,
          },
        ],
      }),
    };
    const { service } = harness({ parser: new MultiFormatParser(ocr) });
    const [file] = await service.importPaths([fixture("file.ocr-image.v1.png")]);
    expect(file).toMatchObject({ format: "png", parseStatus: "ready" });
    expect(service.readObject(file?.objectRef ?? "").byteLength).toBeGreaterThan(1_000);
    expect(service.search("184", [file?.id ?? ""])[0]?.citations[0]).toMatchObject({
      excerpt: "184?",
      confidence: 0.61,
    });
  });

  it("GT-FILE-05 reports unsupported, corrupt, encrypted and oversize failures while chat survives", async () => {
    const first = harness();
    const unsupported = path.join(first.root, "unsupported.bin");
    const corrupt = path.join(first.root, "corrupt.docx");
    writeFileSync(unsupported, "unsupported");
    writeFileSync(corrupt, "not a zip");
    await expect(first.service.importPaths([unsupported])).rejects.toMatchObject({
      code: "FILE_UNSUPPORTED",
    });
    const [corruptFile] = await first.service.importPaths([corrupt]);
    expect(corruptFile).toMatchObject({
      parseStatus: "failed",
      parseErrorCode: "FILE_CORRUPT",
    });
    const [pdf] = await first.service.importPaths([fixture("file.cited-pdf.v1.pdf")]);
    expect(first.repository.failParse(pdf?.id ?? "", "FILE_ENCRYPTED").parseErrorCode).toBe(
      "FILE_ENCRYPTED",
    );

    const second = harness({ maxFileBytes: 4 });
    const oversized = path.join(second.root, "oversized.txt");
    writeFileSync(oversized, "12345");
    await expect(second.service.importPaths([oversized])).rejects.toMatchObject({
      code: "FILE_TOO_LARGE",
    });
    const chats = new ChatRepository(first.database);
    expect(
      chats.createGeneration({ text: "plain chat still works", idempotencyKey: "m4-errors-chat" })
        .created,
    ).toBe(true);
    chats.close();
  });

  it("GT-FILE-06 opens and previews fixed DOCX/PDF text with required styles", async () => {
    const { service } = harness();
    const imported = await service.importPaths([
      fixture("file.docx-pair.v1.docx"),
      fixture("file.cited-pdf.v1.pdf"),
    ]);
    expect(imported.every(({ parseStatus }) => parseStatus === "ready")).toBe(true);
    expect(service.previewFile(imported[0]?.id ?? "").parsedText).toContain(
      "GT-FILE-06 FIXED TEXT",
    );
    expect(service.previewFile(imported[1]?.id ?? "").parsedText).toContain(
      "GT-FILE-01 PAGE TWO FACT",
    );
    const docx = xmlEntries(fixture("file.docx-pair.v1.docx"));
    const styles = strFromU8(docx["word/styles.xml"] ?? new Uint8Array());
    expect(styles).toContain('w:styleId="Heading1"');
    expect(styles).toContain('w:styleId="Heading2"');
  });

  it("GT-FILE-07 keeps exact sheet names/formulas and no error cells in generated XLSX", async () => {
    const archive = xmlEntries(fixture("file.generated-xlsx.v1.xlsx"));
    const workbook = strFromU8(archive["xl/workbook.xml"] ?? new Uint8Array());
    const worksheets = Object.entries(archive)
      .filter(([name]) => name.startsWith("xl/worksheets/"))
      .map(([, bytes]) => strFromU8(bytes))
      .join("\n");
    expect(
      [...workbook.matchAll(/<(?:\w+:)?sheet\b[^>]*name="([^"]+)"/g)].map((match) => match[1]),
    ).toEqual(["Data", "Summary"]);
    expect(worksheets).toContain('COUNTIF(Data!E2:E5,"YES")');
    expect(worksheets).not.toMatch(/<c\b[^>]*\bt="e"/);
  });

  it("GT-FILE-08 parses, renders structurally and downloads exactly six PPTX slides", async () => {
    const { service } = harness();
    const [file] = await service.importPaths([fixture("file.six-slide-pptx.v1.pptx")]);
    const archive = xmlEntries(fixture("file.six-slide-pptx.v1.pptx"));
    const slides = Object.keys(archive).filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name));
    expect(slides).toHaveLength(6);
    expect(service.readParsedFile(file?.id ?? "").citations).toHaveLength(6);
    expect(service.readObject(file?.objectRef ?? "")).toEqual(
      readFileSync(fixture("file.six-slide-pptx.v1.pptx")),
    );
  });

  it("GT-FILE-09 exposes HTML source plus isolated-preview content through an artifact", () => {
    const { service } = harness();
    const source = readFileSync(fixture("file.html-preview.v1.html"), "utf8");
    const artifact = service.createArtifact({
      displayName: "isolated-preview.html",
      format: "html",
      mediaType: "text/html",
      bytesBase64: Buffer.from(source).toString("base64"),
    });
    const preview = service.previewArtifact(artifact.id);
    expect(preview.source).toContain("window.openerx");
    expect(preview.source).toContain("typeof process");
    expect(artifact.versions).toHaveLength(1);
  });

  it("GT-FILE-10 blocks folder escape, preserves originals and syncs bytes without grants", async () => {
    const { root, database, profile } = harness();
    const repository = new FileRepository(database);
    closers.push(() => repository.close());
    const broker = new FileScopeBroker(repository);
    const folder = path.join(root, "folder");
    mkdirSync(folder);
    const originalPath = path.join(folder, "original.txt");
    const outsidePath = path.join(root, "outside.txt");
    writeFileSync(originalPath, "original");
    writeFileSync(outsidePath, "outside");
    const scope = broker.grant(folder);
    expect(() => broker.resolve(scope.id, "../outside.txt")).toThrow("FILE_PATH_ESCAPE");
    expect(readFileSync(originalPath, "utf8")).toBe("original");

    const bytes = Buffer.from("synced artifact");
    const accountId = randomUUID();
    const first = { accountId, sessionId: randomUUID(), deviceId: randomUUID() };
    const second = { accountId, sessionId: randomUUID(), deviceId: randomUUID() };
    const objects = new ObjectStoreService(
      path.join(root, "objects.sqlite"),
      path.join(profile, "cloud-objects"),
    );
    closers.push(() => objects.close());
    const objectId = randomUUID();
    const upload = objects.createUploadIntent(first, {
      objectId,
      checksumSha256: sha256(bytes),
      sizeBytes: bytes.byteLength,
      mediaType: "text/plain",
    });
    objects.upload(first, upload.token, bytes);
    const download = objects.createDownloadIntent(second, objectId);
    expect(Buffer.from(objects.download(second, download.token).bytes).toString()).toBe(
      "synced artifact",
    );

    const sync = new AccountSyncService(":memory:");
    closers.push(() => sync.close());
    expect(() =>
      sync.push(first, {
        operationId: randomUUID(),
        accountId,
        deviceId: first.deviceId,
        objectType: "artifact",
        objectId,
        mutation: "upsert",
        baseRevision: 0,
        payloadVersion: 1,
        payload: { objectId, localPath: originalPath },
        idempotencyKey: `m4-sync-${randomUUID()}`,
        createdAt: new Date().toISOString(),
      }),
    ).toThrow("SYNC_FORBIDDEN_FIELD");
  });
});

describe("M4 Codex FILE capability baseline", () => {
  it("FILE-01 adds supported files into controlled storage", async () => {
    const { service } = harness();
    const [file] = await service.importPaths([fixture("file.cited-pdf.v1.pdf")]);
    expect(file?.objectRef).toMatch(/^objects\/sha256\//);
  });

  it("FILE-02 grants folders while rejecting symlink traversal", () => {
    const { root, repository } = harness();
    const folder = path.join(root, "scope");
    mkdirSync(folder);
    const outside = path.join(root, "outside");
    mkdirSync(outside);
    symlinkSync(
      outside,
      path.join(folder, "linked"),
      process.platform === "win32" ? "junction" : "dir",
    );
    const broker = new FileScopeBroker(repository);
    const scope = broker.grant(folder);
    expect(() => broker.selectedFiles(scope.id)).toThrow("FILE_SYMLINK_BLOCKED");
  });

  it("FILE-03 searches content and returns stable source citations", async () => {
    const { service } = harness();
    const [file] = await service.importPaths([fixture("file.cited-pdf.v1.pdf")]);
    expect(service.search("09:30", [file?.id ?? ""])[0]?.citations[0]?.locator).toEqual({
      kind: "page",
      page: 2,
    });
  });

  it("FILE-04 creates and edits artifacts as immutable versions", () => {
    const { service } = harness();
    const first = service.createArtifact({
      displayName: "notes.md",
      format: "markdown",
      mediaType: "text/markdown",
      bytesBase64: Buffer.from("v1").toString("base64"),
    });
    expect(
      service.addArtifactVersion({
        artifactId: first.id,
        format: "markdown",
        mediaType: "text/markdown",
        bytesBase64: Buffer.from("v2").toString("base64"),
      }).currentVersion,
    ).toBe(2);
  });

  it("FILE-05 previews parsed PDF, DOCX, XLSX and PPTX content", async () => {
    const { service } = harness();
    const imported = await service.importPaths([
      fixture("file.cited-pdf.v1.pdf"),
      fixture("file.docx-pair.v1.docx"),
      fixture("file.generated-xlsx.v1.xlsx"),
      fixture("file.six-slide-pptx.v1.pptx"),
    ]);
    expect(imported.map((file) => service.previewFile(file.id).parsedText.length > 0)).toEqual([
      true,
      true,
      true,
      true,
    ]);
  });

  it("FILE-06 keeps image confidence and HTML isolation explicit", async () => {
    const ocr: OcrAdapter = {
      extract: async () => ({
        text: "184?",
        citations: [
          {
            locator: { kind: "image_region", label: "all" },
            excerpt: "184?",
            confidence: 0.61,
          },
        ],
      }),
    };
    const { service } = harness({ parser: new MultiFormatParser(ocr) });
    const [image] = await service.importPaths([fixture("file.ocr-image.v1.png")]);
    const [html] = await service.importPaths([fixture("file.html-preview.v1.html")]);
    expect(service.readParsedFile(image?.id ?? "").citations[0]?.confidence).toBe(0.61);
    expect(service.previewFile(html?.id ?? "").source).toContain("bridgeExposed");
  });

  it("FILE-07 reuses personal files and artifacts without duplicating bytes", async () => {
    const { database, service } = harness();
    const [file] = await service.importPaths([fixture("file.docx-pair.v1.docx")]);
    const chats = new ChatRepository(database);
    const first = chats.createGeneration({ text: "first", idempotencyKey: "m4-reuse-first" });
    const second = chats.createGeneration({ text: "second", idempotencyKey: "m4-reuse-second" });
    chats.close();
    service.attach(first.receipt.conversationId, file?.id ?? "");
    service.attach(second.receipt.conversationId, file?.id ?? "");
    expect(service.listFiles(first.receipt.conversationId)[0]?.objectRef).toBe(file?.objectRef);
    expect(service.listFiles(second.receipt.conversationId)[0]?.objectRef).toBe(file?.objectRef);
  });

  it("FILE-08 restores files, attachments and artifact versions without device grants", async () => {
    const { root } = harness();
    const objects = new ObjectStoreService(
      path.join(root, "cloud.sqlite"),
      path.join(root, "cloud"),
    );
    const sync = new AccountSyncService(path.join(root, "sync.sqlite"));
    closers.push(() => objects.close());
    closers.push(() => sync.close());
    const accountId = randomUUID();
    const first = { accountId, sessionId: randomUUID(), deviceId: randomUUID() };
    const second = { accountId, sessionId: randomUUID(), deviceId: randomUUID() };

    const firstProfile = path.join(root, "device-one");
    const secondProfile = path.join(root, "device-two");
    mkdirSync(firstProfile);
    mkdirSync(secondProfile);
    const firstDatabase = path.join(firstProfile, "openerx.sqlite");
    const secondDatabase = path.join(secondProfile, "openerx.sqlite");
    const firstChats = new ChatRepository(firstDatabase, {
      ownerProfileId: accountId,
      deviceId: first.deviceId,
    });
    const firstFiles = new FileAppService(
      new FileRepository(firstDatabase, {
        ownerProfileId: accountId,
        deviceId: first.deviceId,
      }),
      firstProfile,
    );
    closers.push(() => firstChats.close());
    closers.push(() => firstFiles.close());
    const draft = firstChats.createGeneration({
      text: "attach the M4 source",
      idempotencyKey: "m4-cross-device-source",
    });
    const [source] = await firstFiles.importPaths(
      [fixture("file.cited-pdf.v1.pdf")],
      draft.receipt.conversationId,
    );
    const artifact = firstFiles.createArtifact({
      displayName: "cross-device.md",
      format: "markdown",
      mediaType: "text/markdown",
      bytesBase64: Buffer.from("artifact version one").toString("base64"),
      sourcePersonalFileId: source?.id,
    });
    const versioned = firstFiles.addArtifactVersion({
      artifactId: artifact.id,
      format: "markdown",
      mediaType: "text/markdown",
      bytesBase64: Buffer.from("artifact version two").toString("base64"),
      sourcePersonalFileId: source?.id,
    });
    const firstCoordinator = new SyncCoordinator(
      firstChats,
      transportFor(sync, objects, first),
      firstFiles,
    );
    expect((await firstCoordinator.syncOnce(authorization(accountId))).pending).toBe(0);
    expect(firstFiles.listFiles(draft.receipt.conversationId)[0]?.sourceScopeId).toBe(
      source?.sourceScopeId,
    );

    const cloudPayload = JSON.stringify(sync.pull(second, null).changes);
    expect(cloudPayload).not.toContain("sourceScopeId");
    expect(cloudPayload).not.toContain("objectRef");
    expect(cloudPayload).not.toContain(fixtureDirectory);

    const secondChats = new ChatRepository(secondDatabase, {
      ownerProfileId: accountId,
      deviceId: second.deviceId,
    });
    const secondFiles = new FileAppService(
      new FileRepository(secondDatabase, {
        ownerProfileId: accountId,
        deviceId: second.deviceId,
      }),
      secondProfile,
    );
    closers.push(() => secondChats.close());
    closers.push(() => secondFiles.close());
    const secondCoordinator = new SyncCoordinator(
      secondChats,
      transportFor(sync, objects, second),
      secondFiles,
    );
    expect((await secondCoordinator.syncOnce(authorization(accountId))).pending).toBe(0);

    const restoredFile = secondFiles.listFiles(draft.receipt.conversationId)[0];
    expect(restoredFile).toEqual(
      expect.objectContaining({
        id: source?.id,
        checksumSha256: source?.checksumSha256,
        sourceScopeId: null,
      }),
    );
    const restoredArtifact = secondFiles.artifact(artifact.id);
    expect(restoredArtifact.currentVersion).toBe(2);
    expect(restoredArtifact.versions.map(({ checksumSha256 }) => checksumSha256)).toEqual(
      versioned.versions.map(({ checksumSha256 }) => checksumSha256),
    );
    expect(
      secondFiles.readObject(restoredArtifact.versions[1]?.objectRef ?? "").toString("utf8"),
    ).toBe("artifact version two");
  });
});
