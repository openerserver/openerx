import { open, readFile, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
const WORKSPACE_ROOT = resolve(MODULE_DIR, "../../../../../");
const DEFAULT_PREVIEW_BYTES = 64 * 1024;
const MAX_FULL_PREVIEW_BYTES = 1024 * 1024;

const querySchema = z.object({
  path: z.string().min(1).max(1024),
  full: z.coerce.boolean().optional(),
});

function normalizeRequestedPath(inputPath: string) {
  const trimmed = inputPath.trim();
  const normalized = trimmed.replace(/^\/Users\/wanglei\/Downloads\/phones-cloud\/openerx\//, "");
  if (!normalized || normalized.startsWith("/") || normalized.includes("\0")) {
    return null;
  }

  const absolutePath = resolve(WORKSPACE_ROOT, normalized);
  if (absolutePath !== WORKSPACE_ROOT && !absolutePath.startsWith(`${WORKSPACE_ROOT}/`)) {
    return null;
  }

  return {
    relativePath: normalized,
    absolutePath,
  };
}

export const workspaceFileRoutes = new Hono();

workspaceFileRoutes.get("/content", zValidator("query", querySchema), async (c) => {
  const { path, full } = c.req.valid("query");
  const normalized = normalizeRequestedPath(path);
  if (!normalized) {
    return c.json({ error: "Invalid file path" }, 400);
  }

  try {
    const metadata = await stat(normalized.absolutePath);
    if (!metadata.isFile()) {
      return c.json({ error: "File not found" }, 404);
    }

    if (full && metadata.size > MAX_FULL_PREVIEW_BYTES) {
      return c.json(
        { error: "File is too large to expand", maxBytes: MAX_FULL_PREVIEW_BYTES },
        413,
      );
    }

    let content: string;
    let truncated = false;

    if (full || metadata.size <= DEFAULT_PREVIEW_BYTES) {
      content = await readFile(normalized.absolutePath, "utf8");
    } else {
      const handle = await open(normalized.absolutePath, "r");
      try {
        const buffer = new Uint8Array(DEFAULT_PREVIEW_BYTES);
        const result = await handle.read(buffer, 0, DEFAULT_PREVIEW_BYTES, 0);
        content = Buffer.from(buffer.subarray(0, result.bytesRead)).toString("utf8");
        truncated = metadata.size > result.bytesRead;
      } finally {
        await handle.close();
      }
    }

    return c.json({
      path: normalized.relativePath,
      content,
      size: metadata.size,
      truncated,
      previewBytes: truncated ? Buffer.byteLength(content, "utf8") : metadata.size,
      canExpand: metadata.size <= MAX_FULL_PREVIEW_BYTES,
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
      return c.json({ error: "File not found" }, 404);
    }

    return c.json({ error: error instanceof Error ? error.message : "Failed to read file" }, 500);
  }
});
