import type { FileParseErrorCode } from "@openerx/contracts";

export class FileServiceError extends Error {
  readonly code: FileParseErrorCode;

  constructor(code: FileParseErrorCode, message: string = code) {
    super(message);
    this.name = "FileServiceError";
    this.code = code;
  }
}

export function fileErrorCode(error: unknown): FileParseErrorCode {
  return error instanceof FileServiceError ? error.code : "FILE_CORRUPT";
}
