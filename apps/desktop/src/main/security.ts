import path from "node:path";
import type { BrowserWindowConstructorOptions } from "electron";

export const appProtocol = "openerx";

export function createWindowOptions(preloadPath: string): BrowserWindowConstructorOptions {
  return {
    width: 1240,
    height: 820,
    minWidth: 920,
    minHeight: 640,
    show: false,
    backgroundColor: "#f7f7f5",
    webPreferences: {
      preload: preloadPath,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webviewTag: false,
      spellcheck: true,
    },
  };
}

export function isTrustedExternalUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    return url.protocol === "https:";
  } catch {
    return false;
  }
}

export function resolveRendererAssetPath(
  rendererRoot: string,
  requestUrl: string,
): string | undefined {
  try {
    const url = new URL(requestUrl);
    if (
      url.protocol !== `${appProtocol}:` ||
      url.hostname !== "renderer" ||
      url.username !== "" ||
      url.password !== "" ||
      url.port !== ""
    ) {
      return undefined;
    }

    const relativePath = decodeURIComponent(url.pathname).replace(/^[/\\]+/, "");
    if (relativePath.includes("\0")) {
      return undefined;
    }

    const normalizedRoot = path.resolve(rendererRoot);
    const candidate = path.resolve(normalizedRoot, relativePath || "index.html");
    const comparableRoot =
      process.platform === "win32" ? normalizedRoot.toLowerCase() : normalizedRoot;
    const comparableCandidate = process.platform === "win32" ? candidate.toLowerCase() : candidate;
    if (
      comparableCandidate !== comparableRoot &&
      !comparableCandidate.startsWith(`${comparableRoot}${path.sep}`)
    ) {
      return undefined;
    }

    return candidate;
  } catch {
    return undefined;
  }
}
