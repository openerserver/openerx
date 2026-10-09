import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { NormalizedToolResult } from "@openerx/contracts";
import type { ToolAdapter } from "@openerx/tool-sdk";
import { BrowserSitePermissions, browserSiteHost } from "./browser-site-permissions";
import { ManagedChromiumDriver } from "./managed-chromium-driver";
import { SystemDefaultBrowserAdapter } from "./system-default-browser-adapter";

/** A task-owned managed browser. Never opens a system browser, bridge or saved profile. */
export function createScopedManagedBrowserTools(
  generationId: string,
  options: { show?: boolean; title?: string } = {},
): ToolAdapter {
  const directory = mkdtempSync(path.join(tmpdir(), "openerx-browser-task-"));
  try {
    const permissions = new BrowserSitePermissions(directory, async () => "deny");
    const driver = new ManagedChromiumDriver(permissions, options.show ?? true, options.title);
    const browser = new SystemDefaultBrowserAdapter(driver, undefined, undefined, null, driver);
    const stop = new AbortController();
    let closed = false;
    let cleanup: Promise<void> | undefined;
    return {
      operations: ["browser_computer_use"],
      async execute(operation, context): Promise<NormalizedToolResult> {
        if (closed) throw new Error("BROWSER_CANCELLED");
        const signal = AbortSignal.any([context.signal, stop.signal]);
        signal.throwIfAborted();
        if (context.projection && context.projection.generationId !== generationId)
          throw new Error("BROWSER_CONTEXT_OUT_OF_SCOPE");
        if (operation.operation !== "browser_computer_use")
          throw new Error("BROWSER_ACTION_NOT_SUPPORTED");
        const request = operation.request;
        if (request.action === "contexts") {
          const data = { managedSessions: driver.contexts(generationId), contexts: [] };
          return {
            summary: "当前工作独立浏览器",
            content: [{ type: "text", text: JSON.stringify(data) }],
            data,
            sources: [],
            artifacts: [],
            sideEffectCommitted: false,
            durationMs: 0,
          };
        }
        if (
          request.action === "open" &&
          (request.browserContextRef ||
            (request.requestedBackend && request.requestedBackend !== "managed_chromium"))
        )
          throw new Error("BROWSER_CONTEXT_OUT_OF_SCOPE");
        if (
          "sessionId" in request &&
          !browser.descriptors().some((session) => session.sessionId === request.sessionId)
        )
          throw new Error("BROWSER_CONTEXT_OUT_OF_SCOPE");
        // The caller has already obtained the Broker decision for this exact operation.
        // Unexpected cross-site redirects/links still encounter a deny-only site prompt.
        if (request.action === "open" || request.action === "navigate")
          permissions.update({
            action: "site",
            host: browserSiteHost(request.url),
            decision: "allow",
          });
        return await browser.execute(
          request.action === "open"
            ? { ...request, requestedBackend: "managed_chromium" }
            : request,
          signal,
          generationId,
        );
      },
      stopAll() {
        closed = true;
        stop.abort(new Error("BROWSER_CANCELLED"));
        cleanup ??= (async () => {
          try {
            await browser.releaseGeneration(generationId);
          } finally {
            driver.close();
            permissions.release(generationId);
            rmSync(directory, { recursive: true, force: true });
          }
        })();
        return cleanup;
      },
    };
  } catch (error) {
    rmSync(directory, { recursive: true, force: true });
    throw error;
  }
}
