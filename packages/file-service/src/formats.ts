import path from "node:path";
import type { SupportedFileFormat } from "@openerx/contracts";
import { FileServiceError } from "./errors";

const formats: Record<string, { format: SupportedFileFormat; mediaType: string }> = {
  ".pdf": { format: "pdf", mediaType: "application/pdf" },
  ".docx": {
    format: "docx",
    mediaType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  },
  ".xlsx": {
    format: "xlsx",
    mediaType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  },
  ".csv": { format: "csv", mediaType: "text/csv" },
  ".pptx": {
    format: "pptx",
    mediaType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  },
  ".txt": { format: "text", mediaType: "text/plain" },
  ".md": { format: "markdown", mediaType: "text/markdown" },
  ".markdown": { format: "markdown", mediaType: "text/markdown" },
  ".json": { format: "json", mediaType: "application/json" },
  ".yaml": { format: "yaml", mediaType: "application/yaml" },
  ".yml": { format: "yaml", mediaType: "application/yaml" },
  ".png": { format: "png", mediaType: "image/png" },
  ".jpg": { format: "jpeg", mediaType: "image/jpeg" },
  ".jpeg": { format: "jpeg", mediaType: "image/jpeg" },
  ".gif": { format: "gif", mediaType: "image/gif" },
  ".webp": { format: "webp", mediaType: "image/webp" },
  ".html": { format: "html", mediaType: "text/html" },
  ".htm": { format: "html", mediaType: "text/html" },
};

const codeExtensions = new Set([
  ".c",
  ".cpp",
  ".css",
  ".go",
  ".java",
  ".js",
  ".jsx",
  ".kt",
  ".m",
  ".php",
  ".py",
  ".rb",
  ".rs",
  ".sh",
  ".sql",
  ".swift",
  ".ts",
  ".tsx",
  ".vue",
  ".xml",
]);

export function detectFileFormat(filePath: string): {
  format: SupportedFileFormat;
  mediaType: string;
} {
  const extension = path.extname(filePath).toLocaleLowerCase();
  const known = formats[extension];
  if (known) return known;
  if (codeExtensions.has(extension)) return { format: "code", mediaType: "text/plain" };
  throw new FileServiceError("FILE_UNSUPPORTED", `Unsupported file extension: ${extension}`);
}
