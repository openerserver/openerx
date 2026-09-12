import path from "node:path";
import { type SupportedFileFormat, supportedFileTypes } from "@openerx/contracts";
import { FileServiceError } from "./errors";

const formats = new Map<string, { format: SupportedFileFormat; mediaType: string }>(
  supportedFileTypes.flatMap(({ format, mediaType, extensions }) =>
    extensions.map((extension) => [`.${extension}`, { format, mediaType }] as const),
  ),
);

export function detectFileFormat(filePath: string): {
  format: SupportedFileFormat;
  mediaType: string;
} {
  const extension = path.extname(filePath).toLowerCase();
  const known = formats.get(extension);
  if (known) return known;
  throw new FileServiceError("FILE_UNSUPPORTED", `Unsupported file extension: ${extension}`);
}
