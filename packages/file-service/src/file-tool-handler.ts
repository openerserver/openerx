import type { NormalizedToolResult, PiFileToolRequestFrame } from "@openerx/contracts";
import type { FileAppService } from "./file-service";

// Personal and enterprise runs provide their own explicit attachment set. The
// parser, binary Office compiler and immutable artifact writer remain shared.
export async function executeAttachedFileTool(
  files: FileAppService,
  request: PiFileToolRequestFrame["request"],
  context: {
    allowedFileIds: ReadonlySet<string>;
    allowedArtifactIds?: ReadonlySet<string>;
    signal: AbortSignal;
    imageInput?: boolean;
    ensureParsedFile?: (id: string) => Promise<unknown>;
  },
): Promise<unknown> {
  context.signal.throwIfAborted();
  switch (request.operation) {
    case "list":
      return [...context.allowedFileIds].map((id) => files.readParsedFile(id).file);
    case "search":
      return files.search(request.input.query, [...context.allowedFileIds]);
    case "read":
      if (!context.allowedFileIds.has(request.input.personalFileId))
        throw new Error("FILE_NOT_ATTACHED");
      await context.ensureParsedFile?.(request.input.personalFileId);
      context.signal.throwIfAborted();
      return files.readParsedFile(request.input.personalFileId);
    case "artifact.write":
    case "artifact.office.write": {
      const input = request.input;
      if (
        input.artifactId &&
        context.allowedArtifactIds &&
        !context.allowedArtifactIds.has(input.artifactId)
      )
        throw new Error("ARTIFACT_NOT_ATTACHED");
      if (request.operation === "artifact.office.write") {
        const artifact = files.writeOfficeArtifact(request.input);
        return {
          artifact,
          preview: files.previewArtifact(artifact.id, {
            includeModelImages: context.imageInput !== false,
          }),
        };
      }
      const textInput = request.input;
      const bytesBase64 = Buffer.from(textInput.content, "utf8").toString("base64");
      return textInput.artifactId
        ? files.addArtifactVersion({ ...textInput, artifactId: textInput.artifactId, bytesBase64 })
        : files.createArtifact({ ...textInput, bytesBase64 });
    }
  }
}

function withoutPreviewMedia(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutPreviewMedia);
  if (!value || typeof value !== "object") return value;
  const output: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (/^(bytesBase64|imageDataUrl|modelImageDataUrl)$/u.test(key)) continue;
    output[key] = withoutPreviewMedia(entry);
  }
  return output;
}

export function normalizeFileToolResult(
  request: PiFileToolRequestFrame["request"],
  result: unknown,
  durationMs: number,
): NormalizedToolResult {
  const record = result && typeof result === "object" ? (result as Record<string, unknown>) : null;
  const artifact =
    record?.artifact && typeof record.artifact === "object"
      ? (record.artifact as Record<string, unknown>)
      : record;
  const artifactId = typeof artifact?.id === "string" ? artifact.id : null;
  const count = Array.isArray(result) ? result.length : null;
  const summary =
    request.operation === "list"
      ? `已列出 ${count ?? 0} 个附件`
      : request.operation === "search"
        ? `已找到 ${count ?? 0} 条文件结果`
        : request.operation === "read"
          ? "已读取附件内容"
          : artifactId
            ? `已写入成果 ${artifactId}`
            : "文件工具已完成";
  const data = withoutPreviewMedia(result);
  return {
    summary,
    content: [
      { type: "text", text: (JSON.stringify(data) ?? summary).slice(0, 1_000_000) },
      ...(artifactId ? [{ type: "artifact" as const, artifactId }] : []),
    ],
    data,
    sources: [],
    artifacts: artifactId ? [artifactId] : [],
    sideEffectCommitted:
      request.operation === "artifact.write" || request.operation === "artifact.office.write",
    durationMs,
  };
}
