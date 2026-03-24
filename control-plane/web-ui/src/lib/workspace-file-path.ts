const WORKSPACE_ROOT_PREFIX = "/Users/wanglei/Downloads/phones-cloud/openerx/";

const ROOT_LEVEL_FILE_NAMES = new Set([
  "Dockerfile",
  "Makefile",
  "README",
  "README.md",
  "LICENSE",
  ".env",
  ".gitignore",
  ".npmrc",
  ".nvmrc",
  ".editorconfig",
]);

function isLikelyWorkspaceFileName(segment: string): boolean {
  if (!segment || /[\\:*?"<>|\n\r]/u.test(segment)) {
    return false;
  }

  if (ROOT_LEVEL_FILE_NAMES.has(segment)) {
    return true;
  }

  return /^[^\s./][^/]*\.[A-Za-z0-9._-]+$/u.test(segment);
}

export function normalizeWorkspaceFilePath(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  const normalized = value.trim().replace(/^['"`]|['"`]$/gu, "");
  if (!normalized || normalized.includes("\n")) {
    return undefined;
  }

  const relative = normalized.startsWith(WORKSPACE_ROOT_PREFIX)
    ? normalized.slice(WORKSPACE_ROOT_PREFIX.length)
    : normalized;

  if (
    !relative ||
    relative.startsWith("/") ||
    relative.includes("://") ||
    /[\\:*?"<>|]/u.test(relative)
  ) {
    return undefined;
  }

  const segments = relative.split("/").filter(Boolean);
  if (!segments.length) {
    return undefined;
  }

  if (
    segments.some((segment) => segment === "." || segment === ".." || /[\\:*?"<>|]/u.test(segment))
  ) {
    return undefined;
  }

  const lastSegment = segments[segments.length - 1] ?? "";
  return isLikelyWorkspaceFileName(lastSegment) ? relative : undefined;
}
