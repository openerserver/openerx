import { createHash, randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  attachmentDraft,
  MobileAttachmentUploader,
  validateAttachmentBatch,
} from "../../apps/mobile/src/attachments";

const checksum = async (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
describe("mobile attachment transfer", () => {
  it("reuses successful uploads after a partial failure and preserves remaining files for retry", async () => {
    const accountId = randomUUID();
    const bytes = new TextEncoder().encode("phone file");
    const files = ["one.txt", "two.txt"].map((displayName) =>
      attachmentDraft({ id: randomUUID(), uri: displayName, displayName, sizeBytes: bytes.length }),
    );
    const uploadObject = vi
      .fn()
      .mockImplementationOnce(async (_token, input) => ({ ...input, accountId }))
      .mockRejectedValueOnce(new Error("network offline"))
      .mockImplementation(async (_token, input) => ({ ...input, accountId }));
    const uploader = new MobileAttachmentUploader(
      { uploadObject },
      accountId,
      () => "token",
      async () => bytes,
      checksum,
    );
    const progress = vi.fn();
    await expect(uploader.upload(files, progress)).rejects.toThrow("network offline");
    expect(progress).toHaveBeenCalledWith(files[1]?.id, "failed");
    const uploaded = await uploader.upload(files, progress);
    expect(uploadObject).toHaveBeenCalledTimes(3);
    expect(uploaded.map((file) => file.objectId)).toEqual(files.map((file) => file.id));
    expect(uploaded[0]?.checksumSha256).toBe(await checksum(bytes));
  });
  it("rejects changed bytes and cross-account upload receipts", async () => {
    const file = attachmentDraft({
      id: randomUUID(),
      uri: "file:///test.txt",
      displayName: "test.txt",
      sizeBytes: 3,
    });
    const uploadObject = vi.fn(async (_token, input) => ({ ...input, accountId: randomUUID() }));
    const changed = new MobileAttachmentUploader(
      { uploadObject },
      randomUUID(),
      () => "token",
      async () => new Uint8Array(2),
      checksum,
    );
    await expect(changed.upload([file], () => undefined)).rejects.toThrow("FILE_CHANGED");
    expect(uploadObject).not.toHaveBeenCalled();
    const foreign = new MobileAttachmentUploader(
      { uploadObject },
      randomUUID(),
      () => "token",
      async () => new Uint8Array(3),
      checksum,
    );
    await expect(foreign.upload([file], () => undefined)).rejects.toThrow(
      "ACCOUNT_SCOPE_VIOLATION",
    );
  });
  it("checks file type, count, paths and aggregate size before uploading", () => {
    const draft = {
      id: randomUUID(),
      uri: "file:///report.txt",
      displayName: "report.txt",
      sizeBytes: 30 * 1024 * 1024,
    };
    expect(() => attachmentDraft({ ...draft, displayName: "../secret.txt" })).toThrow();
    expect(() => attachmentDraft({ ...draft, displayName: "archive.zip" })).toThrow(
      "FILE_UNSUPPORTED",
    );
    expect(() => validateAttachmentBatch([attachmentDraft(draft), attachmentDraft(draft)])).toThrow(
      "FILE_TOO_LARGE",
    );
    expect(() =>
      validateAttachmentBatch(
        Array.from({ length: 11 }, () => attachmentDraft({ ...draft, sizeBytes: 1 })),
      ),
    ).toThrow("FILE_COUNT_LIMIT");
  });
});
