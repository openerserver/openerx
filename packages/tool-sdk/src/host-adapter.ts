import type { NormalizedToolResult, ToolOperation } from "@openerx/contracts";
import type { CapabilityHost, ToolAdapter, ToolExecutionContext } from "./types";

export class HostCapabilityAdapter implements ToolAdapter {
  readonly operations = ["browser", "browser_computer_use", "desktop", "desktop_control"] as const;
  constructor(
    private readonly host: CapabilityHost,
    private readonly resolveUploadPath?: (fileId: string) => string,
    private readonly ingestDownload?: (
      path: string,
    ) => Promise<{ fileId: string; displayName: string }>,
  ) {}

  async execute(
    operation: ToolOperation,
    context: Pick<ToolExecutionContext, "signal" | "projection">,
  ): Promise<NormalizedToolResult> {
    if (
      operation.operation !== "browser" &&
      operation.operation !== "browser_computer_use" &&
      operation.operation !== "desktop_control" &&
      operation.operation !== "desktop"
    ) {
      throw new Error("HOST_OPERATION_NOT_SUPPORTED");
    }
    if (operation.operation === "browser" && operation.action === "upload") {
      if (!operation.fileId || !this.resolveUploadPath) {
        throw new Error("BROWSER_UPLOAD_FILE_REQUIRED");
      }
      return await this.host.execute(
        { ...operation, path: this.resolveUploadPath(operation.fileId) },
        context.signal,
      );
    }
    const owner = context.projection
      ? {
          conversationId: context.projection.conversationId,
          generationId: context.projection.generationId,
        }
      : undefined;
    const result = owner
      ? await this.host.execute(operation, context.signal, owner)
      : await this.host.execute(operation, context.signal);
    if (operation.operation === "browser" && operation.action === "download") {
      const data = result.data;
      if (!data || typeof data !== "object" || !("path" in data) || typeof data.path !== "string") {
        throw new Error("BROWSER_DOWNLOAD_PATH_MISSING");
      }
      if (!this.ingestDownload) throw new Error("BROWSER_DOWNLOAD_IMPORT_UNAVAILABLE");
      const imported = await this.ingestDownload(data.path);
      const record = data as Record<string, unknown>;
      const { path: _privatePath, ...safeData } = record;
      const mediaType =
        typeof safeData.mediaType === "string" ? safeData.mediaType : "application/octet-stream";
      return {
        ...result,
        content: [
          ...result.content,
          {
            type: "file",
            personalFileId: imported.fileId,
            displayName: imported.displayName,
            mediaType,
          },
        ],
        data: { ...safeData, ...imported },
      };
    }
    return result;
  }
}
