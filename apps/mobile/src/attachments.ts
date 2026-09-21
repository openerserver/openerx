import {
  maxPastedAttachmentBytes,
  pastedFileInputSchema,
  type RemoteAttachment,
  supportedFileTypes,
} from "@openerx/contracts";
import type { MobileApi } from "./mobile-api";

export interface PendingAttachment {
  id: string;
  uri: string;
  displayName: string;
  sizeBytes: number;
  mediaType: string;
}
export type UploadStatus = "reading" | "uploading" | "uploaded" | "failed";

export function attachmentDraft(input: Omit<PendingAttachment, "mediaType">): PendingAttachment {
  const displayName = pastedFileInputSchema.shape.displayName.parse(input.displayName);
  const extension = displayName.split(".").at(-1)?.toLowerCase() ?? "";
  const format = supportedFileTypes.find((type) => type.extensions.includes(extension));
  if (!format) throw new Error("FILE_UNSUPPORTED");
  if (
    !Number.isSafeInteger(input.sizeBytes) ||
    input.sizeBytes < 0 ||
    input.sizeBytes > maxPastedAttachmentBytes
  )
    throw new Error("FILE_TOO_LARGE");
  return { ...input, displayName, mediaType: format.mediaType };
}

export function validateAttachmentBatch(files: PendingAttachment[]): void {
  if (files.length > 10) throw new Error("FILE_COUNT_LIMIT");
  if (files.reduce((total, file) => total + file.sizeBytes, 0) > maxPastedAttachmentBytes)
    throw new Error("FILE_TOO_LARGE");
  for (const file of files) attachmentDraft(file);
}

export class MobileAttachmentUploader {
  readonly #uploaded = new Map<string, RemoteAttachment>();
  constructor(
    private readonly api: Pick<MobileApi, "uploadObject">,
    private readonly accountId: string,
    private readonly token: () => string,
    private readonly read: (uri: string) => Promise<Uint8Array>,
    private readonly checksum: (bytes: Uint8Array) => Promise<string>,
  ) {}

  async upload(
    files: PendingAttachment[],
    progress: (id: string, status: UploadStatus) => void,
  ): Promise<RemoteAttachment[]> {
    validateAttachmentBatch(files);
    const result: RemoteAttachment[] = [];
    for (const file of files) {
      try {
        let attachment = this.#uploaded.get(file.id);
        if (!attachment) {
          progress(file.id, "reading");
          const bytes = await this.read(file.uri);
          if (bytes.byteLength !== file.sizeBytes) throw new Error("FILE_CHANGED");
          attachment = {
            objectId: file.id,
            displayName: file.displayName,
            mediaType: file.mediaType,
            sizeBytes: bytes.byteLength,
            checksumSha256: await this.checksum(bytes),
          };
          progress(file.id, "uploading");
          const { displayName: _name, ...intent } = attachment;
          const uploaded = await this.api.uploadObject(this.token(), intent, bytes);
          if (uploaded.accountId !== this.accountId) throw new Error("ACCOUNT_SCOPE_VIOLATION");
          this.#uploaded.set(file.id, attachment);
        }
        progress(file.id, "uploaded");
        result.push(attachment);
      } catch (error) {
        progress(file.id, "failed");
        throw error;
      }
    }
    return result;
  }

  forget(files: PendingAttachment[]): void {
    for (const file of files) this.#uploaded.delete(file.id);
  }
}
