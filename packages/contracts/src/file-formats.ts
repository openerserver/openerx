import type { SupportedFileFormat } from "./file";

// File selection and parsing must agree on the same set of extensions.
export const supportedFileTypes: readonly {
  format: SupportedFileFormat;
  mediaType: string;
  extensions: readonly string[];
}[] = [
  { format: "pdf", mediaType: "application/pdf", extensions: ["pdf"] },
  {
    format: "docx",
    mediaType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    extensions: ["docx"],
  },
  { format: "xls", mediaType: "application/vnd.ms-excel", extensions: ["xls"] },
  {
    format: "xlsx",
    mediaType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    extensions: ["xlsx"],
  },
  { format: "csv", mediaType: "text/csv", extensions: ["csv"] },
  { format: "csv", mediaType: "text/tab-separated-values", extensions: ["tsv"] },
  {
    format: "pptx",
    mediaType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    extensions: ["pptx"],
  },
  { format: "text", mediaType: "text/plain", extensions: ["txt"] },
  { format: "markdown", mediaType: "text/markdown", extensions: ["md", "markdown"] },
  { format: "json", mediaType: "application/json", extensions: ["json"] },
  { format: "yaml", mediaType: "application/yaml", extensions: ["yaml", "yml"] },
  { format: "png", mediaType: "image/png", extensions: ["png"] },
  { format: "jpeg", mediaType: "image/jpeg", extensions: ["jpg", "jpeg"] },
  { format: "gif", mediaType: "image/gif", extensions: ["gif"] },
  { format: "webp", mediaType: "image/webp", extensions: ["webp"] },
  { format: "html", mediaType: "text/html", extensions: ["html", "htm"] },
  { format: "code", mediaType: "image/svg+xml", extensions: ["svg"] },
  { format: "code", mediaType: "text/javascript", extensions: ["mjs"] },
  {
    format: "code",
    mediaType: "text/plain",
    extensions: [
      "c",
      "cpp",
      "css",
      "go",
      "java",
      "js",
      "jsx",
      "kt",
      "m",
      "php",
      "py",
      "rb",
      "rs",
      "sh",
      "sql",
      "swift",
      "ts",
      "tsx",
      "vue",
      "xml",
    ],
  },
];

export const supportedFileExtensions = supportedFileTypes.flatMap(({ extensions }) => extensions);
