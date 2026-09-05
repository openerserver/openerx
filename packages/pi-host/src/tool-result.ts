import { type NormalizedToolResult, normalizedToolResultSchema } from "@openerx/contracts";

export type PiToolContent =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string };

function safeDetails(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(safeDetails);
  if (!value || typeof value !== "object") return value;
  const result: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (
      /^(bytesBase64|imageDataUrl|modelImageDataUrl|objectRef|sourceRelativePath|path|absolutePath)$/u.test(
        key,
      )
    ) {
      continue;
    }
    result[key] = safeDetails(entry);
  }
  return result;
}

export function productToolResult(value: unknown): {
  content: PiToolContent[];
  details: unknown;
} {
  const result = normalizedToolResultSchema.parse(value);
  const content = result.content.flatMap((part): PiToolContent[] => {
    switch (part.type) {
      case "text":
      case "image":
        return [part];
      case "file":
        return [
          {
            type: "text",
            text: `File: ${part.displayName} (${part.mediaType}, id ${part.personalFileId})`,
          },
        ];
      case "artifact":
        return [{ type: "text", text: `Artifact: ${part.artifactId}` }];
      case "source":
        return [{ type: "text", text: `Source: ${part.source.title} — ${part.source.url}` }];
      case "diff": {
        const maximumPatchLength = 990_000;
        const patch = part.patch.slice(0, maximumPatchLength);
        const truncated = patch.length < part.patch.length ? "\n[diff truncated]" : "";
        return [
          {
            type: "text",
            text: `Unified diff for ${part.relativePath} (change ${part.workspaceChangeId}):\n${patch}${truncated}`,
          },
        ];
      }
      default:
        return [];
    }
  });
  return {
    content: content.length > 0 ? content : [{ type: "text", text: result.summary }],
    details: {
      summary: result.summary,
      data: safeDetails(result.data),
      sources: result.sources,
      artifacts: result.artifacts,
      durationMs: result.durationMs,
      sideEffectCommitted: result.sideEffectCommitted,
    },
  };
}

export function genericToolResult(value: unknown): {
  content: PiToolContent[];
  details: unknown;
} {
  const details = safeDetails(value);
  const artifactId =
    details && typeof details === "object" && "id" in details && typeof details.id === "string"
      ? details.id
      : null;
  return {
    content: [
      {
        type: "text",
        text: artifactId
          ? `Result id: ${artifactId}\n${JSON.stringify(details)}`
          : JSON.stringify(details),
      },
    ],
    details,
  };
}

export function officeArtifactToolResult(value: unknown): {
  content: PiToolContent[];
  details: unknown;
} {
  const record = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const artifact =
    record.artifact && typeof record.artifact === "object"
      ? (record.artifact as Record<string, unknown>)
      : {};
  const preview =
    record.preview && typeof record.preview === "object"
      ? (record.preview as Record<string, unknown>)
      : {};
  const surfaces = Array.isArray(preview.renderedSurfaces) ? preview.renderedSurfaces : [];
  const imageContent = surfaces.flatMap((surface): PiToolContent[] => {
    if (!surface || typeof surface !== "object") return [];
    const imageDataUrl = (surface as Record<string, unknown>).modelImageDataUrl;
    if (typeof imageDataUrl !== "string") return [];
    const match = /^data:([^;,]+);base64,(.+)$/u.exec(imageDataUrl);
    if (!match?.[1] || !match[2]) return [];
    return [{ type: "image", mimeType: match[1], data: match[2] }];
  });
  const id = typeof artifact.id === "string" ? artifact.id : "unknown";
  const version = typeof artifact.currentVersion === "number" ? artifact.currentVersion : 1;
  const labels = surfaces
    .map((surface) =>
      surface && typeof surface === "object" && typeof surface.label === "string"
        ? surface.label
        : null,
    )
    .filter(Boolean);
  return {
    content: [
      {
        type: "text",
        text: `Artifact ${id} v${version} created with ${surfaces.length} visual-review surface(s): ${labels.join(", ")}. Inspect every image before reporting completion.`,
      },
      ...imageContent,
    ],
    details: safeDetails(value),
  };
}

export function isNormalizedToolResult(value: unknown): value is NormalizedToolResult {
  return normalizedToolResultSchema.safeParse(value).success;
}
