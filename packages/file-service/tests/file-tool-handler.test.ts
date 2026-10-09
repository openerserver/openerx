import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { type officeArtifactWriteInputSchema, piFileToolOperationSchema } from "@openerx/contracts";
import { FileRepository } from "@openerx/storage";
import { afterEach, expect, test, vi } from "vitest";
import type { z } from "zod";
import { executeAttachedFileTool, FileAppService, normalizeFileToolResult } from "../src";

const closers: Array<() => void> = [];
const officeRequest = (input: z.input<typeof officeArtifactWriteInputSchema>) =>
  piFileToolOperationSchema.parse({ operation: "artifact.office.write", input });
afterEach(() => {
  for (const close of closers.splice(0)) close();
});
function fixture() {
  const directory = mkdtempSync(path.join(tmpdir(), "openerx-file-tools-"));
  const files = new FileAppService(new FileRepository(":memory:"), directory);
  closers.push(() => {
    files.close();
    rmSync(directory, { recursive: true, force: true });
  });
  return files;
}
test("shared file tools only read and search explicitly allowed attachments", async () => {
  const files = fixture();
  const imported = await files.importData({
    files: [
      { displayName: "current.csv", bytesBase64: Buffer.from("amount\n60").toString("base64") },
      {
        displayName: "other.csv",
        bytesBase64: Buffer.from("PRIVATE_OTHER\n900").toString("base64"),
      },
    ],
  });
  const allowedFileIds = new Set([imported[0]!.id]);
  const ensureParsedFile = vi.fn(async () => {});
  const context = { allowedFileIds, signal: new AbortController().signal, ensureParsedFile };
  expect(
    await executeAttachedFileTool(files, { operation: "list", input: {} }, context),
  ).toMatchObject([{ id: imported[0]!.id }]);
  expect(
    await executeAttachedFileTool(
      files,
      { operation: "search", input: { query: "PRIVATE_OTHER" } },
      context,
    ),
  ).toEqual([]);
  await expect(
    executeAttachedFileTool(
      files,
      { operation: "read", input: { personalFileId: imported[1]!.id } },
      context,
    ),
  ).rejects.toThrow("FILE_NOT_ATTACHED");
  expect(ensureParsedFile).not.toHaveBeenCalled();
  expect(
    await executeAttachedFileTool(
      files,
      { operation: "read", input: { personalFileId: imported[0]!.id } },
      context,
    ),
  ).toMatchObject({ text: expect.stringContaining("60") });
});
test("shared Office writes preserve immutable versions and reject editing an artifact outside the task", async () => {
  const files = fixture(),
    allowedArtifactIds = new Set<string>();
  const context = {
    allowedFileIds: new Set<string>(),
    allowedArtifactIds,
    signal: new AbortController().signal,
    imageInput: false,
  };
  const first = (await executeAttachedFileTool(
    files,
    officeRequest({
      displayName: "report.docx",
      spec: { format: "docx", title: "Report", pages: [{ paragraphs: ["VERSION_ONE"] }] },
    }),
    context,
  )) as {
    artifact: ReturnType<FileAppService["artifact"]>;
    preview: ReturnType<FileAppService["previewArtifact"]>;
  };
  expect(first.preview.parsedText).toContain("VERSION_ONE");
  expect(first.preview.renderedSurfaces[0]?.imageDataUrl).toMatch(/^data:image\/svg/);
  expect(first.preview.renderedSurfaces[0]?.modelImageDataUrl).toBeUndefined();
  const bytes = files.readObject(first.artifact.versions[0]!.objectRef);
  expect(bytes.subarray(0, 2).toString()).toBe("PK");
  await expect(
    executeAttachedFileTool(
      files,
      officeRequest({
        artifactId: first.artifact.id,
        displayName: "report.docx",
        spec: { format: "docx", title: "Report", pages: [{ paragraphs: ["VERSION_TWO"] }] },
      }),
      context,
    ),
  ).rejects.toThrow("ARTIFACT_NOT_ATTACHED");
  allowedArtifactIds.add(first.artifact.id);
  const second = (await executeAttachedFileTool(
    files,
    officeRequest({
      artifactId: first.artifact.id,
      displayName: "report.docx",
      spec: { format: "docx", title: "Report", pages: [{ paragraphs: ["VERSION_TWO"] }] },
    }),
    context,
  )) as typeof first;
  expect(second.artifact.currentVersion).toBe(2);
  expect(files.readObject(first.artifact.versions[0]!.objectRef)).toEqual(bytes);
  expect(
    files.previewArtifact(first.artifact.id, { version: 1, includeModelImages: false }).parsedText,
  ).toContain("VERSION_ONE");
  const normalized = normalizeFileToolResult(
    officeRequest({
      displayName: "report.docx",
      spec: { format: "docx", title: "Report", pages: [{}] },
    }),
    first,
    1,
  );
  expect(JSON.stringify(normalized)).not.toContain("data:image/");
  expect(normalized.artifacts).toEqual([first.artifact.id]);
  expect(normalized.sideEffectCommitted).toBe(true);
});
test("a cancelled file operation does not produce an artifact", async () => {
  const files = fixture(),
    controller = new AbortController();
  controller.abort();
  await expect(
    executeAttachedFileTool(
      files,
      {
        operation: "artifact.write",
        input: {
          displayName: "report.txt",
          format: "text",
          mediaType: "text/plain",
          content: "never write",
        },
      },
      {
        allowedFileIds: new Set(),
        signal: controller.signal,
      },
    ),
  ).rejects.toThrow();
  expect(files.listArtifacts()).toEqual([]);
});
