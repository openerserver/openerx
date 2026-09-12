import { z } from "zod";
import { htmlPreviewBundleSchema, htmlPreviewUrlSchema } from "./html-preview";

const entityIdSchema = z.uuid();
const timestampSchema = z.string().refine((value) => !Number.isNaN(Date.parse(value)), {
  message: "Expected an ISO timestamp",
});

export const supportedFileFormatSchema = z.enum([
  "pdf",
  "docx",
  "xls",
  "xlsx",
  "csv",
  "pptx",
  "text",
  "markdown",
  "code",
  "json",
  "yaml",
  "png",
  "jpeg",
  "gif",
  "webp",
  "html",
]);

export const fileParseErrorCodeSchema = z.enum([
  "FILE_UNSUPPORTED",
  "FILE_CORRUPT",
  "FILE_ENCRYPTED",
  "FILE_TOO_LARGE",
  "FILE_SCOPE_REVOKED",
  "FILE_SCOPE_EXPIRED",
  "FILE_PATH_ESCAPE",
  "FILE_SYMLINK_BLOCKED",
  "FILE_NOT_FOUND",
  "FILE_OCR_UNAVAILABLE",
]);

export const fileScopeSchema = z
  .object({
    id: entityIdSchema,
    kind: z.enum(["file", "directory"]),
    displayName: z.string().min(1),
    access: z.enum(["read", "read_write"]),
    expiresAt: timestampSchema.nullable(),
    revokedAt: timestampSchema.nullable(),
    createdAt: timestampSchema,
  })
  .strict();

export const sourceLocatorSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("page"), page: z.number().int().positive() }).strict(),
  z
    .object({
      kind: z.literal("sheet_range"),
      sheet: z.string().min(1),
      range: z.string().min(1),
    })
    .strict(),
  z.object({ kind: z.literal("slide"), slide: z.number().int().positive() }).strict(),
  z
    .object({
      kind: z.literal("text_range"),
      startLine: z.number().int().positive(),
      endLine: z.number().int().positive(),
    })
    .strict(),
  z.object({ kind: z.literal("image_region"), label: z.string().min(1) }).strict(),
]);

export const fileCitationSchema = z
  .object({
    id: entityIdSchema,
    personalFileId: entityIdSchema,
    locator: sourceLocatorSchema,
    excerpt: z.string(),
    confidence: z.number().min(0).max(1),
  })
  .strict();

export const personalFileSchema = z
  .object({
    id: entityIdSchema,
    ownerProfileId: z.string().min(1),
    displayName: z.string().min(1),
    format: supportedFileFormatSchema,
    mediaType: z.string().min(1),
    sizeBytes: z.number().int().nonnegative(),
    checksumSha256: z.string().regex(/^[a-f0-9]{64}$/),
    objectRef: z.string().regex(/^objects\/sha256\/[a-f0-9]{2}\/[a-f0-9]{64}$/),
    sourceScopeId: entityIdSchema.nullable(),
    sourceRelativePath: z.string().min(1),
    parseStatus: z.enum(["pending", "ready", "failed"]),
    parseErrorCode: fileParseErrorCodeSchema.nullable(),
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
    revision: z.number().int().positive(),
  })
  .strict();

export const attachmentSchema = z
  .object({
    id: entityIdSchema,
    conversationId: entityIdSchema,
    messageId: entityIdSchema.nullable(),
    personalFileId: entityIdSchema,
    createdAt: timestampSchema,
  })
  .strict();

export const artifactVersionSchema = z
  .object({
    id: entityIdSchema,
    artifactId: entityIdSchema,
    version: z.number().int().positive(),
    sizeBytes: z.number().int().nonnegative(),
    checksumSha256: z.string().regex(/^[a-f0-9]{64}$/),
    objectRef: z.string().regex(/^objects\/sha256\/[a-f0-9]{2}\/[a-f0-9]{64}$/),
    sourcePersonalFileId: entityIdSchema.nullable(),
    createdAt: timestampSchema,
  })
  .strict();

export const artifactSchema = z
  .object({
    id: entityIdSchema,
    ownerProfileId: z.string().min(1),
    displayName: z.string().min(1),
    format: supportedFileFormatSchema,
    mediaType: z.string().min(1),
    currentVersion: z.number().int().positive(),
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
    revision: z.number().int().positive(),
    versions: z.array(artifactVersionSchema).min(1),
  })
  .strict();

const officeThemeSchema = z
  .object({
    accentColor: z
      .string()
      .regex(/^#[A-Fa-f0-9]{6}$/)
      .default("#2563EB"),
    backgroundColor: z
      .string()
      .regex(/^#[A-Fa-f0-9]{6}$/)
      .default("#FFFFFF"),
  })
  .strict();

const officePageSchema = z
  .object({
    heading: z.string().trim().min(1).max(300).optional(),
    paragraphs: z.array(z.string().trim().min(1).max(2_000)).max(30).default([]),
    bullets: z.array(z.string().trim().min(1).max(500)).max(20).default([]),
    footer: z.string().trim().min(1).max(200).optional(),
  })
  .strict();

export const officeCellValueSchema = z.union([
  z.string().max(2_000),
  z.number().finite(),
  z.boolean(),
  z.null(),
]);

const officeFormulaSchema = z
  .string()
  .trim()
  .min(1)
  .max(1_000)
  .refine(
    (value) =>
      !value.includes("|") &&
      !value.includes("[") &&
      !value.includes("]") &&
      !Array.from(value).some((character) => character.charCodeAt(0) < 32),
    "External workbook and DDE formula syntax is not allowed",
  )
  .refine(
    (value) => !/(?:https?|ftp|file):/iu.test(value),
    "Formula network and file URLs are not allowed",
  )
  .refine(
    (value) =>
      !/\b(?:CALL|EXEC|FILTERXML|HYPERLINK|REGISTER(?:\.ID)?|RTD|SHELL|WEBSERVICE)\s*\(/iu.test(
        value,
      ),
    "Formula functions with external side effects are not allowed",
  );

export const officeCellSchema = z.union([
  officeCellValueSchema,
  z
    .object({
      value: officeCellValueSchema,
      formula: officeFormulaSchema.optional(),
    })
    .strict(),
]);

const officeSheetSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1)
      .max(31)
      .refine((value) => !/[:\\/?*[\]]/.test(value), "Invalid worksheet name"),
    rows: z.array(z.array(officeCellSchema).max(20)).min(1).max(60),
    headerRows: z.number().int().min(0).max(10).default(1),
  })
  .strict();

const officeSlideSchema = z
  .object({
    title: z.string().trim().min(1).max(300),
    subtitle: z.string().trim().min(1).max(500).optional(),
    body: z.string().trim().min(1).max(2_000).optional(),
    bullets: z.array(z.string().trim().min(1).max(500)).max(12).default([]),
  })
  .strict();

export const officeArtifactSpecSchema = z.discriminatedUnion("format", [
  z
    .object({
      format: z.literal("docx"),
      title: z.string().trim().min(1).max(300),
      pages: z.array(officePageSchema).min(1).max(100),
      theme: officeThemeSchema.default({
        accentColor: "#2563EB",
        backgroundColor: "#FFFFFF",
      }),
    })
    .strict(),
  z
    .object({
      format: z.literal("pdf"),
      title: z.string().trim().min(1).max(300),
      pages: z.array(officePageSchema).min(1).max(100),
      theme: officeThemeSchema.default({
        accentColor: "#2563EB",
        backgroundColor: "#FFFFFF",
      }),
    })
    .strict(),
  z
    .object({
      format: z.literal("xlsx"),
      title: z.string().trim().min(1).max(300),
      sheets: z.array(officeSheetSchema).min(1).max(50),
      theme: officeThemeSchema.default({
        accentColor: "#2563EB",
        backgroundColor: "#FFFFFF",
      }),
    })
    .strict()
    .superRefine((value, context) => {
      const names = new Set<string>();
      for (const [index, sheet] of value.sheets.entries()) {
        const normalized = sheet.name.toLocaleLowerCase();
        if (names.has(normalized)) {
          context.addIssue({
            code: "custom",
            path: ["sheets", index, "name"],
            message: "Worksheet names must be unique",
          });
        }
        names.add(normalized);
      }
    }),
  z
    .object({
      format: z.literal("pptx"),
      title: z.string().trim().min(1).max(300),
      slides: z.array(officeSlideSchema).min(1).max(100),
      theme: officeThemeSchema.default({
        accentColor: "#2563EB",
        backgroundColor: "#FFFFFF",
      }),
    })
    .strict(),
]);

export const officeArtifactWriteInputSchema = z
  .object({
    artifactId: entityIdSchema.optional(),
    displayName: z.string().trim().min(1).max(240),
    purpose: z.enum(["deliverable", "intermediate"]).optional(),
    spec: officeArtifactSpecSchema,
  })
  .strict();

export const renderedSurfaceSchema = z
  .object({
    kind: z.enum(["page", "sheet", "slide"]),
    index: z.number().int().positive(),
    label: z.string().min(1).max(200),
    imageDataUrl: z
      .string()
      .max(5_000_000)
      .refine((value) => value.startsWith("data:image/svg+xml;base64,"), {
        message: "Expected an SVG image data URL",
      }),
    modelImageDataUrl: z
      .string()
      .max(10_000_000)
      .refine((value) => value.startsWith("data:image/png;base64,"), {
        message: "Expected a PNG image data URL",
      })
      .optional(),
  })
  .strict();

export const personalFileSyncPayloadSchema = personalFileSchema
  .omit({ objectRef: true, sourceScopeId: true, sourceRelativePath: true })
  .extend({
    cloudObjectId: entityIdSchema,
    parsedText: z.string(),
    citations: z.array(fileCitationSchema.omit({ personalFileId: true })),
  })
  .strict();

export const attachmentSyncPayloadSchema = attachmentSchema;

export const artifactSyncPayloadSchema = artifactSchema.omit({ versions: true }).strict();

export const artifactVersionSyncPayloadSchema = artifactVersionSchema
  .omit({ objectRef: true })
  .extend({ cloudObjectId: entityIdSchema })
  .strict();

export const fileSearchResultSchema = z
  .object({
    file: personalFileSchema,
    citations: z.array(fileCitationSchema),
  })
  .strict();

export const contentPreviewSchema = z
  .object({
    objectKind: z.enum(["personal_file", "artifact"]),
    objectId: entityIdSchema,
    displayName: z.string().min(1),
    format: supportedFileFormatSchema,
    source: z.string().nullable(),
    htmlBundle: htmlPreviewBundleSchema.optional(),
    htmlPreviewUrl: htmlPreviewUrlSchema.optional(),
    imageDataUrl: z
      .string()
      .max(45_000_000)
      .refine(
        (value) =>
          [
            "data:image/gif;base64,",
            "data:image/jpeg;base64,",
            "data:image/png;base64,",
            "data:image/webp;base64,",
          ].some((prefix) => value.startsWith(prefix)),
        { message: "Expected a supported image data URL" },
      )
      .nullable()
      .default(null),
    renderedSurfaces: z.array(renderedSurfaceSchema).max(200).default([]),
    parsedText: z.string(),
    citations: z.array(fileCitationSchema),
  })
  .strict();

export const fileImportPrivilegedInputSchema = z
  .object({
    localPaths: z.array(z.string().min(1)).min(1).max(100),
    conversationId: entityIdSchema.nullable().optional(),
  })
  .strict();
export const maxPastedAttachmentBytes = 50 * 1024 * 1024;
export const maxPastedAttachmentCount = 100;
const maxPastedBase64Length = Math.ceil(maxPastedAttachmentBytes / 3) * 4;
export const pastedFileInputSchema = z
  .object({
    displayName: z
      .string()
      .trim()
      .min(1)
      .max(240)
      .refine(
        (name) =>
          !/[\\/]/u.test(name) &&
          Array.from(name).every((char) => char.charCodeAt(0) >= 32) &&
          name !== "." &&
          name !== "..",
        "Expected a file name without a path",
      ),
    bytesBase64: z.string().max(maxPastedBase64Length),
  })
  .strict();
export const fileImportDataInputSchema = z
  .object({
    files: z.array(pastedFileInputSchema).min(1).max(maxPastedAttachmentCount),
    conversationId: entityIdSchema.nullable().optional(),
  })
  .strict()
  .refine(
    // Each separately encoded file may add its own base64 padding.
    ({ files }) =>
      files.reduce((total, file) => total + file.bytesBase64.length, 0) <=
      maxPastedBase64Length + (files.length - 1) * 4,
    "FILE_TOO_LARGE",
  );
export const fileListInputSchema = z
  .object({ conversationId: entityIdSchema.nullable().optional() })
  .strict();
export const fileChooseInputSchema = z
  .object({ conversationId: entityIdSchema.nullable().optional() })
  .strict();
export const fileSearchInputSchema = z
  .object({ query: z.string().trim().min(1).max(500), fileIds: z.array(entityIdSchema).optional() })
  .strict();
export const fileRevokeScopeInputSchema = z.object({ scopeId: entityIdSchema }).strict();
export const filePreviewInputSchema = z.object({ personalFileId: entityIdSchema }).strict();
export const fileAttachInputSchema = z
  .object({ conversationId: entityIdSchema, personalFileId: entityIdSchema })
  .strict();
export const artifactCreateInputSchema = z
  .object({
    displayName: z.string().trim().min(1).max(240),
    format: supportedFileFormatSchema,
    mediaType: z.string().min(1),
    bytesBase64: z.string().min(1),
    sourcePersonalFileId: entityIdSchema.nullable().optional(),
  })
  .strict();
export const artifactNewVersionInputSchema = artifactCreateInputSchema
  .omit({ displayName: true })
  .extend({ artifactId: entityIdSchema })
  .strict();
export const artifactListInputSchema = z
  .object({ conversationId: entityIdSchema.optional() })
  .strict();
export const artifactGetInputSchema = z.object({ artifactId: entityIdSchema }).strict();
export const artifactPreviewInputSchema = artifactGetInputSchema;
export const artifactExportPrivilegedInputSchema = artifactGetInputSchema
  .extend({ destinationPath: z.string().min(1) })
  .strict();
export const artifactExportResultSchema = z
  .object({
    artifactId: entityIdSchema,
    fileName: z.string().min(1),
    version: z.number().int().positive(),
  })
  .strict();

export const cloudObjectIntentInputSchema = z
  .object({
    objectId: entityIdSchema,
    checksumSha256: z.string().regex(/^[a-f0-9]{64}$/),
    sizeBytes: z
      .number()
      .int()
      .nonnegative()
      .max(50 * 1024 * 1024),
    mediaType: z.string().min(1).max(200),
  })
  .strict();
export const cloudObjectDescriptorSchema = cloudObjectIntentInputSchema
  .extend({
    accountId: entityIdSchema,
    createdAt: timestampSchema,
  })
  .strict();
export const cloudObjectTransferIntentSchema = z
  .object({
    token: z.string().regex(/^[a-f0-9]{64}$/),
    operation: z.enum(["upload", "download"]),
    objectId: entityIdSchema,
    expiresAt: timestampSchema,
  })
  .strict();

export type SupportedFileFormat = z.infer<typeof supportedFileFormatSchema>;
export type FileParseErrorCode = z.infer<typeof fileParseErrorCodeSchema>;
export type FileScope = z.infer<typeof fileScopeSchema>;
export type SourceLocator = z.infer<typeof sourceLocatorSchema>;
export type FileCitation = z.infer<typeof fileCitationSchema>;
export type PersonalFile = z.infer<typeof personalFileSchema>;
export type PastedFileInput = z.infer<typeof pastedFileInputSchema>;
export type FileImportDataInput = z.infer<typeof fileImportDataInputSchema>;
export type Attachment = z.infer<typeof attachmentSchema>;
export type ArtifactVersion = z.infer<typeof artifactVersionSchema>;
export type Artifact = z.infer<typeof artifactSchema>;
export type FileSearchResult = z.infer<typeof fileSearchResultSchema>;
export type ContentPreview = z.infer<typeof contentPreviewSchema>;
export type CloudObjectIntentInput = z.infer<typeof cloudObjectIntentInputSchema>;
export type CloudObjectDescriptor = z.infer<typeof cloudObjectDescriptorSchema>;
export type CloudObjectTransferIntent = z.infer<typeof cloudObjectTransferIntentSchema>;
export type PersonalFileSyncPayload = z.infer<typeof personalFileSyncPayloadSchema>;
export type AttachmentSyncPayload = z.infer<typeof attachmentSyncPayloadSchema>;
export type ArtifactSyncPayload = z.infer<typeof artifactSyncPayloadSchema>;
export type ArtifactVersionSyncPayload = z.infer<typeof artifactVersionSyncPayloadSchema>;
export type ArtifactExportResult = z.infer<typeof artifactExportResultSchema>;
export type OfficeCellValue = z.infer<typeof officeCellValueSchema>;
export type OfficeCell = z.infer<typeof officeCellSchema>;
export type OfficeArtifactSpec = z.infer<typeof officeArtifactSpecSchema>;
export type OfficeArtifactWriteInput = z.infer<typeof officeArtifactWriteInputSchema>;
export type RenderedSurface = z.infer<typeof renderedSurfaceSchema>;

export interface FileBridge {
  importPastedFiles(input: FileImportDataInput): Promise<PersonalFile[]>;
  chooseFiles(input?: z.input<typeof fileChooseInputSchema>): Promise<PersonalFile[]>;
  chooseDirectory(input?: z.input<typeof fileChooseInputSchema>): Promise<PersonalFile[]>;
  listFiles(input?: z.input<typeof fileListInputSchema>): Promise<PersonalFile[]>;
  searchFiles(input: z.input<typeof fileSearchInputSchema>): Promise<FileSearchResult[]>;
  previewFile(input: z.input<typeof filePreviewInputSchema>): Promise<ContentPreview>;
  revokeFileScope(input: z.input<typeof fileRevokeScopeInputSchema>): Promise<FileScope>;
  attachFile(input: z.input<typeof fileAttachInputSchema>): Promise<Attachment>;
  listArtifacts(input?: z.input<typeof artifactListInputSchema>): Promise<Artifact[]>;
  getArtifact(input: z.input<typeof artifactGetInputSchema>): Promise<Artifact>;
  previewArtifact(input: z.input<typeof artifactPreviewInputSchema>): Promise<ContentPreview>;
  saveArtifact(input: z.input<typeof artifactGetInputSchema>): Promise<ArtifactExportResult | null>;
}
