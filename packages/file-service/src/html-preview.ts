import {
  type HtmlPreviewBundle,
  htmlPreviewMediaType,
  htmlPreviewPathSchema,
  maxHtmlPreviewBytes,
  maxHtmlPreviewResources,
} from "@openerx/contracts";
import type { ContentStore } from "./content-store";
import { FileServiceError } from "./errors";

export interface HtmlResourceSnapshot {
  relativePath: string;
  objectRef: string;
  sizeBytes: number;
}

export function buildHtmlPreviewBundle(
  entry: HtmlResourceSnapshot,
  siblings: HtmlResourceSnapshot[],
  store: ContentStore,
): HtmlPreviewBundle {
  const resources = new Map<string, HtmlResourceSnapshot>();
  for (const resource of [...siblings, entry]) {
    const parsed = htmlPreviewPathSchema.safeParse(resource.relativePath.replaceAll("\\", "/"));
    if (!parsed.success || !htmlPreviewMediaType(parsed.data)) continue;
    resources.set(parsed.data, { ...resource, relativePath: parsed.data });
  }
  const entryPath = htmlPreviewPathSchema.parse(entry.relativePath.replaceAll("\\", "/"));
  if (
    resources.size > maxHtmlPreviewResources ||
    [...resources.values()].reduce((sum, resource) => sum + resource.sizeBytes, 0) >
      maxHtmlPreviewBytes
  )
    throw new FileServiceError("FILE_TOO_LARGE", "Website preview exceeds the resource limit");
  // Serve the stored versions, so preview never reads arbitrary live workspace files.
  let totalBytes = 0;
  return {
    entryPath,
    resources: [...resources.values()].map((resource) => {
      const bytes = store.read(resource.objectRef);
      totalBytes += bytes.byteLength;
      if (totalBytes > maxHtmlPreviewBytes) throw new FileServiceError("FILE_TOO_LARGE");
      return { relativePath: resource.relativePath, bytesBase64: bytes.toString("base64") };
    }),
  };
}
