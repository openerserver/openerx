import { z } from "zod";

export const htmlPreviewProtocol = "openerx-preview";
export const maxHtmlPreviewBytes = 50 * 1024 * 1024;
export const maxHtmlPreviewResources = 256;

// These are URL paths in a saved website, never host filesystem paths.
export const htmlPreviewPathSchema = z
  .string()
  .min(1)
  .max(4096)
  .refine(
    (value) =>
      !/[\\:]/u.test(value) &&
      [...value].every((character) => character.charCodeAt(0) >= 32) &&
      value.split("/").every((segment) => segment && segment !== "." && segment !== ".."),
    "Expected a relative website path",
  );

export const htmlPreviewBundleSchema = z
  .object({
    entryPath: htmlPreviewPathSchema,
    resources: z
      .array(
        z
          .object({
            relativePath: htmlPreviewPathSchema,
            bytesBase64: z.string().max(Math.ceil(maxHtmlPreviewBytes / 3) * 4),
          })
          .strict(),
      )
      .min(1)
      .max(maxHtmlPreviewResources),
  })
  .strict();

export const htmlPreviewUrlSchema = z.string().refine((value) => {
  try {
    const url = new URL(value);
    return (
      url.protocol === `${htmlPreviewProtocol}:` &&
      /^[a-f0-9]{32}$/u.test(url.hostname) &&
      !url.username &&
      !url.password &&
      !url.port
    );
  } catch {
    return false;
  }
}, "Expected an isolated website preview URL");

const webMediaTypes: Record<string, string> = {
  html: "text/html; charset=utf-8",
  htm: "text/html; charset=utf-8",
  css: "text/css; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  mjs: "text/javascript; charset=utf-8",
  json: "application/json; charset=utf-8",
  svg: "image/svg+xml",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  ico: "image/x-icon",
  woff: "font/woff",
  woff2: "font/woff2",
  ttf: "font/ttf",
  otf: "font/otf",
};

export function htmlPreviewMediaType(relativePath: string): string | undefined {
  const extension = relativePath.split("/").at(-1)?.split(".").at(-1)?.toLowerCase() ?? "";
  return Object.hasOwn(webMediaTypes, extension) ? webMediaTypes[extension] : undefined;
}

export type HtmlPreviewBundle = z.infer<typeof htmlPreviewBundleSchema>;
