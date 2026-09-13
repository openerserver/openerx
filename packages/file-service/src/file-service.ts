import { statSync } from "node:fs";
import path from "node:path";
import type {
  Artifact,
  Attachment,
  ContentPreview,
  FileImportDataInput,
  FileScope,
  FileSearchResult,
  OfficeArtifactWriteInput,
  PersonalFile,
  PiImageInput,
  SupportedFileFormat,
  SyncChange,
  SyncConflict,
  SyncConflictResolution,
  SyncOperation,
} from "@openerx/contracts";
import { fileImportDataInputSchema, maxPastedAttachmentBytes } from "@openerx/contracts";
import type { FileRepository, WorkspaceArtifactLink } from "@openerx/storage";
import { ContentStore } from "./content-store";
import { FileServiceError, fileErrorCode } from "./errors";
import { FileScopeBroker } from "./file-scope-broker";
import { detectFileFormat } from "./formats";
import { buildHtmlPreviewBundle, type HtmlResourceSnapshot } from "./html-preview";
import { compileOfficeArtifact, renderOfficeArtifact } from "./office-artifact";
import { MultiFormatParser } from "./parser";

const defaultMaxFileBytes = 50 * 1024 * 1024;
const maxVisionImageBytes = 32 * 1024 * 1024;
const maxVisionImageTotalBytes = 32 * 1024 * 1024;
const visionMediaTypeByFormat = {
  gif: "image/gif",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
} as const;

export class FileAppService {
  readonly #repository: FileRepository;
  readonly #store: ContentStore;
  readonly #broker: FileScopeBroker;
  readonly #parser: MultiFormatParser;
  readonly #maxFileBytes: number;

  constructor(
    repository: FileRepository,
    profileDirectory: string,
    options: { parser?: MultiFormatParser; maxFileBytes?: number } = {},
  ) {
    this.#repository = repository;
    this.#store = new ContentStore(profileDirectory);
    this.#broker = new FileScopeBroker(repository);
    this.#parser = options.parser ?? new MultiFormatParser();
    this.#maxFileBytes = options.maxFileBytes ?? defaultMaxFileBytes;
  }

  close(): void {
    this.#repository.close();
  }

  async importPaths(localPaths: string[], conversationId?: string | null): Promise<PersonalFile[]> {
    const imported: PersonalFile[] = [];
    for (const selectedPath of localPaths) {
      const scope = this.#broker.grant(selectedPath);
      for (const filePath of this.#broker.selectedFiles(scope.id)) {
        const file = await this.#importOne(scope.id, filePath);
        imported.push(file);
        if (conversationId) this.#repository.attach(conversationId, file.id);
      }
    }
    return imported;
  }

  async importData(input: FileImportDataInput): Promise<PersonalFile[]> {
    const { files, conversationId } = fileImportDataInputSchema.parse(input);
    // Validate the complete batch before storing anything, including unsupported extensions.
    const drafts = files.map(({ displayName, bytesBase64 }) => {
      const detected = detectFileFormat(displayName);
      const bytes = decodeBase64(bytesBase64);
      this.#assertSize(bytes.byteLength);
      return { displayName, bytes, ...detected };
    });
    if (
      drafts.reduce((total, { bytes }) => total + bytes.byteLength, 0) > maxPastedAttachmentBytes
    ) {
      throw new FileServiceError("FILE_TOO_LARGE");
    }
    const imported: PersonalFile[] = [];
    for (const { displayName, bytes, format, mediaType } of drafts) {
      const stored = this.#store.putBytes(bytes);
      const file = this.#repository.upsertPersonalFile({
        displayName,
        format,
        mediaType,
        sizeBytes: bytes.byteLength,
        checksumSha256: stored.checksumSha256,
        objectRef: stored.objectRef,
        sourceScopeId: null,
        sourceRelativePath: displayName,
      });
      const parsed = await this.#parseImportedFile(file, stored.absolutePath);
      if (conversationId) this.attach(conversationId, parsed.id);
      imported.push(parsed);
    }
    return imported;
  }

  listFiles(conversationId?: string | null): PersonalFile[] {
    return this.#repository.listFiles(conversationId);
  }

  attachments(conversationId: string): Attachment[] {
    return this.#repository.attachments(conversationId);
  }

  search(query: string, fileIds?: string[]): FileSearchResult[] {
    return this.#repository.search(query, fileIds);
  }

  attachedFiles(conversationId: string): PersonalFile[] {
    return this.#repository
      .attachedFileIds(conversationId)
      .map((personalFileId) => this.#repository.personalFile(personalFileId));
  }

  attachedFilesForMessages(conversationId: string, messageIds: string[]): PersonalFile[] {
    return this.#repository
      .attachedFileIdsForMessages(conversationId, messageIds)
      .map((personalFileId) => this.#repository.personalFile(personalFileId));
  }

  modelImages(conversationId: string): PiImageInput[] {
    return this.#modelImages(this.#repository.attachedFileIds(conversationId));
  }

  modelImagesForMessage(messageId: string): PiImageInput[] {
    return this.#modelImages(this.#repository.attachedFileIdsForMessage(messageId));
  }

  #modelImages(personalFileIds: string[]): PiImageInput[] {
    let totalBytes = 0;
    return personalFileIds.flatMap((personalFileId) => {
      const file = this.#repository.personalFile(personalFileId);
      const mimeType = visionMediaTypeByFormat[file.format as keyof typeof visionMediaTypeByFormat];
      if (!mimeType) return [];
      const bytes = this.#store.read(file.objectRef);
      if (bytes.byteLength > maxVisionImageBytes) throw new FileServiceError("FILE_TOO_LARGE");
      totalBytes += bytes.byteLength;
      if (totalBytes > maxVisionImageTotalBytes) throw new FileServiceError("FILE_TOO_LARGE");
      return [
        {
          personalFileId: file.id,
          displayName: file.displayName,
          data: bytes.toString("base64"),
          mimeType,
        },
      ];
    });
  }

  readParsedFile(personalFileId: string): {
    file: PersonalFile;
    text: string;
    citations: ReturnType<FileRepository["citations"]>;
  } {
    return {
      file: this.#repository.personalFile(personalFileId),
      text: this.#repository.parsedText(personalFileId),
      citations: this.#repository.citations(personalFileId),
    };
  }

  previewFile(
    personalFileId: string,
    options: { includeModelImages?: boolean; includeHtmlResources?: boolean } = {},
  ): ContentPreview {
    const parsed = this.readParsedFile(personalFileId);
    const source = isTextPreviewFormat(parsed.file.format)
      ? this.#store.read(parsed.file.objectRef).toString("utf8")
      : null;
    const imageMediaType =
      visionMediaTypeByFormat[parsed.file.format as keyof typeof visionMediaTypeByFormat];
    const imageDataUrl =
      imageMediaType && parsed.file.sizeBytes <= maxVisionImageBytes
        ? `data:${imageMediaType};base64,${this.#store.read(parsed.file.objectRef).toString("base64")}`
        : null;
    return {
      objectKind: "personal_file",
      objectId: parsed.file.id,
      displayName: parsed.file.displayName,
      format: parsed.file.format,
      source,
      ...(parsed.file.format === "html" && options.includeHtmlResources
        ? {
            htmlBundle: buildHtmlPreviewBundle(
              { ...parsed.file, relativePath: parsed.file.sourceRelativePath },
              parsed.file.sourceScopeId
                ? this.#repository
                    .listFiles()
                    .reverse()
                    .filter((file) => file.sourceScopeId === parsed.file.sourceScopeId)
                    .map((file) => ({ ...file, relativePath: file.sourceRelativePath }))
                : [],
              this.#store,
            ),
          }
        : {}),
      imageDataUrl,
      renderedSurfaces:
        renderOfficeArtifact(this.#store.read(parsed.file.objectRef), parsed.file.format, options)
          ?.renderedSurfaces ?? [],
      parsedText: parsed.text,
      citations: parsed.citations,
    };
  }

  revokeScope(scopeId: string): FileScope {
    return this.#repository.revokeScope(scopeId);
  }

  attach(
    conversationId: string,
    personalFileId: string,
    messageId: string | null = null,
  ): Attachment {
    return this.#repository.attach(conversationId, personalFileId, messageId);
  }

  createArtifact(input: {
    displayName: string;
    format: SupportedFileFormat;
    mediaType: string;
    bytesBase64: string;
    sourcePersonalFileId?: string | null;
  }): Artifact {
    const bytes = decodeBase64(input.bytesBase64);
    this.#assertSize(bytes.byteLength);
    const stored = this.#store.putBytes(bytes);
    return this.#repository.createArtifact({
      displayName: input.displayName,
      format: input.format,
      mediaType: input.mediaType,
      version: { ...stored, sourcePersonalFileId: input.sourcePersonalFileId },
    });
  }

  addArtifactVersion(input: {
    artifactId: string;
    format: SupportedFileFormat;
    mediaType: string;
    bytesBase64: string;
    sourcePersonalFileId?: string | null;
  }): Artifact {
    const artifact = this.#repository.artifact(input.artifactId);
    if (artifact.format !== input.format || artifact.mediaType !== input.mediaType) {
      throw new FileServiceError("FILE_UNSUPPORTED", "Artifact version format cannot change");
    }
    const bytes = decodeBase64(input.bytesBase64);
    this.#assertSize(bytes.byteLength);
    const stored = this.#store.putBytes(bytes);
    return this.#repository.addArtifactVersion(input.artifactId, {
      ...stored,
      sourcePersonalFileId: input.sourcePersonalFileId,
    });
  }

  writeOfficeArtifact(input: OfficeArtifactWriteInput): Artifact {
    const compiled = compileOfficeArtifact(input.spec, { includeModelImages: false });
    this.#assertSize(compiled.bytes.byteLength);
    const artifact = input.artifactId
      ? this.addArtifactVersion({
          artifactId: input.artifactId,
          format: compiled.format,
          mediaType: compiled.mediaType,
          bytesBase64: compiled.bytes.toString("base64"),
        })
      : this.createArtifact({
          displayName: ensureOfficeExtension(input.displayName, compiled.format),
          format: compiled.format,
          mediaType: compiled.mediaType,
          bytesBase64: compiled.bytes.toString("base64"),
        });
    return artifact;
  }

  listArtifacts(): Artifact[] {
    return this.#repository.listArtifacts();
  }

  workspaceArtifactLinks(conversationId?: string): WorkspaceArtifactLink[] {
    return this.#repository.workspaceArtifactLinks(conversationId);
  }

  captureWorkspaceArtifact(
    input: Omit<WorkspaceArtifactLink, "artifactId"> & { bytes: Buffer },
  ): Artifact {
    const format = detectFileFormat(input.relativePath);
    this.#assertSize(input.bytes.byteLength);
    return this.#repository.captureWorkspaceArtifact({
      conversationId: input.conversationId,
      workspaceRootPath: input.workspaceRootPath,
      relativePath: input.relativePath,
      sourceRevision: input.sourceRevision,
      ...format,
      version: this.#store.putBytes(input.bytes),
    });
  }

  deleteArtifacts(artifactIds: string[]): number {
    const objectRefs = this.#repository.deleteArtifacts(artifactIds);
    for (const objectRef of objectRefs) {
      if (this.#repository.objectReferenceCount(objectRef) === 0) this.#store.remove(objectRef);
    }
    return artifactIds.length;
  }

  artifact(id: string): Artifact {
    return this.#repository.artifact(id);
  }

  previewArtifact(
    id: string,
    options: { includeModelImages?: boolean; includeHtmlResources?: boolean } = {},
  ): ContentPreview {
    const artifact = this.#repository.artifact(id);
    const version = artifact.versions.find(({ version }) => version === artifact.currentVersion);
    if (!version) throw new Error("ARTIFACT_VERSION_NOT_FOUND");
    const source = isTextPreviewFormat(artifact.format)
      ? this.#store.read(version.objectRef).toString("utf8")
      : null;
    const rendered = renderOfficeArtifact(
      this.#store.read(version.objectRef),
      artifact.format,
      options,
    );
    const imageMediaType =
      visionMediaTypeByFormat[artifact.format as keyof typeof visionMediaTypeByFormat];
    return {
      objectKind: "artifact",
      objectId: artifact.id,
      displayName: artifact.displayName,
      format: artifact.format,
      source,
      ...(artifact.format === "html" && options.includeHtmlResources
        ? { htmlBundle: this.#artifactHtmlBundle(artifact) }
        : {}),
      imageDataUrl:
        imageMediaType && version.sizeBytes <= maxVisionImageBytes
          ? `data:${imageMediaType};base64,${this.#store.read(version.objectRef).toString("base64")}`
          : null,
      renderedSurfaces: rendered?.renderedSurfaces ?? [],
      parsedText: rendered?.parsedText ?? source ?? "",
      citations: [],
    };
  }

  #artifactHtmlBundle(artifact: Artifact) {
    const links = this.#repository.workspaceArtifactLinks();
    const entryLink = links.find((link) => link.artifactId === artifact.id);
    const snapshot = (item: Artifact, relativePath: string): HtmlResourceSnapshot => {
      const version = item.versions.find((version) => version.version === item.currentVersion);
      if (!version) throw new Error("ARTIFACT_VERSION_NOT_FOUND");
      return { relativePath, objectRef: version.objectRef, sizeBytes: version.sizeBytes };
    };
    return buildHtmlPreviewBundle(
      snapshot(
        artifact,
        entryLink?.relativePath ??
          (/\.html?$/iu.test(artifact.displayName)
            ? path.basename(artifact.displayName.replaceAll("\\", "/"))
            : "index.html"),
      ),
      entryLink
        ? links
            .filter(
              (link) =>
                link.conversationId === entryLink.conversationId &&
                link.workspaceRootPath === entryLink.workspaceRootPath,
            )
            .map((link) => snapshot(this.#repository.artifact(link.artifactId), link.relativePath))
        : [],
      this.#store,
    );
  }

  exportArtifact(
    artifactId: string,
    destinationPath: string,
  ): {
    artifactId: string;
    fileName: string;
    version: number;
  } {
    const artifact = this.#repository.artifact(artifactId);
    const version = artifact.versions.find(({ version }) => version === artifact.currentVersion);
    if (!version) throw new Error("ARTIFACT_VERSION_NOT_FOUND");
    const exported = this.#broker.exportSelectedPath(
      destinationPath,
      this.#store.resolve(version.objectRef),
    );
    return {
      artifactId,
      fileName: path.basename(exported),
      version: version.version,
    };
  }

  readObject(objectRef: string): Buffer {
    return this.#store.read(objectRef);
  }

  resolvePersonalFilePath(personalFileId: string): string {
    const file = this.#repository.personalFile(personalFileId);
    return this.#store.resolve(file.objectRef);
  }

  async prepareSyncPush(
    operation: SyncOperation,
    upload: (
      descriptor: {
        objectId: string;
        checksumSha256: string;
        sizeBytes: number;
        mediaType: string;
      },
      bytes: Uint8Array,
    ) => Promise<void>,
  ): Promise<void> {
    const object = this.#repository.syncObject(operation);
    if (!object) return;
    const { objectRef, ...descriptor } = object;
    await upload(descriptor, this.#store.read(objectRef));
  }

  async applySyncPull(
    changes: SyncChange[],
    download: (objectId: string) => Promise<Uint8Array>,
  ): Promise<void> {
    const fileObjectTypes = new Set([
      "personal_file",
      "attachment",
      "artifact",
      "artifact_version",
    ]);
    for (const change of changes) {
      if (!fileObjectTypes.has(change.objectType)) continue;
      let objectRef: string | undefined;
      if (
        !change.tombstone &&
        (change.objectType === "personal_file" || change.objectType === "artifact_version")
      ) {
        const bytes = await download(change.objectId);
        const stored = this.#store.putBytes(bytes);
        const expected = change.payload?.checksumSha256;
        const expectedSize = change.payload?.sizeBytes;
        if (stored.checksumSha256 !== expected || stored.sizeBytes !== expectedSize) {
          throw new FileServiceError("FILE_CORRUPT", "Cloud object metadata does not match bytes");
        }
        objectRef = stored.objectRef;
      }
      this.#repository.applySyncChange(change, objectRef);
    }
  }

  async applySyncConflict(
    conflict: SyncConflict,
    resolution: SyncConflictResolution,
    download: (objectId: string) => Promise<Uint8Array>,
  ): Promise<void> {
    if (resolution !== "cloud") return;
    await this.applySyncPull(
      [
        {
          cursor: "cursor:0",
          accountId: conflict.accountId,
          objectType: conflict.objectType,
          objectId: conflict.objectId,
          revision: Math.max(1, conflict.serverRevision),
          tombstone: conflict.serverPayload === null,
          payloadVersion: 1,
          payload: conflict.serverPayload,
          operationId: conflict.operationId,
          changedAt: conflict.resolvedAt ?? conflict.createdAt,
          retainUntil: null,
        },
      ],
      download,
    );
  }

  async #importOne(scopeId: string, filePath: string): Promise<PersonalFile> {
    const { format, mediaType } = detectFileFormat(filePath);
    const sizeBytes = statSync(filePath).size;
    this.#assertSize(sizeBytes);
    const stored = this.#store.putFile(filePath);
    const scope = this.#broker.assertActive(scopeId);
    const sourceRelativePath =
      scope.kind === "directory"
        ? path.relative(scope.rootPath, filePath)
        : path.basename(filePath);
    const file = this.#repository.upsertPersonalFile({
      displayName: path.basename(filePath),
      format,
      mediaType,
      sizeBytes,
      checksumSha256: stored.checksumSha256,
      objectRef: stored.objectRef,
      sourceScopeId: scopeId,
      sourceRelativePath,
    });
    return await this.#parseImportedFile(file, stored.absolutePath);
  }

  async #parseImportedFile(file: PersonalFile, absolutePath: string): Promise<PersonalFile> {
    if (file.parseStatus !== "pending") return file;
    try {
      const parsed = await this.#parser.parse(absolutePath, file.format);
      return this.#repository.completeParse(file.id, parsed);
    } catch (error) {
      return this.#repository.failParse(file.id, fileErrorCode(error));
    }
  }

  #assertSize(sizeBytes: number): void {
    if (sizeBytes > this.#maxFileBytes) throw new FileServiceError("FILE_TOO_LARGE");
  }
}

function isTextPreviewFormat(format: SupportedFileFormat): boolean {
  return ["text", "markdown", "code", "json", "yaml", "csv", "html"].includes(format);
}

function decodeBase64(value: string): Buffer {
  const normalized = value.replace(/\s+/g, "");
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(normalized) || normalized.length % 4 !== 0) {
    throw new FileServiceError("FILE_CORRUPT", "Invalid base64 artifact payload");
  }
  return Buffer.from(normalized, "base64");
}

function ensureOfficeExtension(
  displayName: string,
  format: "docx" | "xlsx" | "pptx" | "pdf",
): string {
  return displayName.toLocaleLowerCase().endsWith(`.${format}`)
    ? displayName
    : `${displayName}.${format}`;
}
