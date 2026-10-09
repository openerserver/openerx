import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { HostToolAvailability } from "@openerx/contracts";
import type { ToolAdapter } from "@openerx/tool-sdk";
import { ToolCredentialVault } from "./credential-vault";
import { ElectronToolCapabilityHost } from "./tool-capability-host";

const running = new Set<ToolAdapter>();
let activeOwner: symbol | null = null;

function isolatedHost() {
  const directory = mkdtempSync(path.join(tmpdir(), "openerx-desktop-task-"));
  try {
    // This host never receives a personal profile or credential store. Each run
    // has its own capture registry and Windows session/observation references.
    const host = new ElectronToolCapabilityHost(
      directory,
      new ToolCredentialVault(path.join(directory, "credentials.bin")),
    );
    return { host, remove: () => rmSync(directory, { recursive: true, force: true }) };
  } catch (error) {
    rmSync(directory, { recursive: true, force: true });
    throw error;
  }
}

/** Native control reused behind a task-owned lifetime and trusted execution owner. */
export function createScopedDesktopTools(runId: string): ToolAdapter {
  const identity = Symbol(runId);
  const stop = new AbortController();
  const pending = new Set<Promise<unknown>>();
  let resource: ReturnType<typeof isolatedHost> | undefined;
  let closed = false;
  let cleanup: Promise<void> | undefined;
  const tools: ToolAdapter = {
    operations: ["desktop", "desktop_control"],
    async execute(operation, context) {
      if (closed) throw new Error("DESKTOP_CANCELLED");
      const signal = AbortSignal.any([context.signal, stop.signal]);
      signal.throwIfAborted();
      if (operation.operation !== "desktop" && operation.operation !== "desktop_control")
        throw new Error("DESKTOP_OPERATION_NOT_SUPPORTED");
      if (!context.projection || context.projection.generationId !== runId)
        throw new Error("DESKTOP_CONTEXT_OUT_OF_SCOPE");
      // Desktop observation and input share one machine. Keep other enterprise
      // runs from changing it between an observation and its following action.
      if (activeOwner !== null && activeOwner !== identity) throw new Error("DESKTOP_CONTROL_BUSY");
      resource ??= isolatedHost();
      activeOwner = identity;
      const result = resource.host.execute(operation, signal, {
        conversationId: runId,
        generationId: runId,
      });
      pending.add(result);
      try {
        const value = await result;
        signal.throwIfAborted();
        return value;
      } finally {
        pending.delete(result);
      }
    },
    stopAll() {
      if (cleanup) return cleanup;
      closed = true;
      stop.abort(new Error("DESKTOP_CANCELLED"));
      resource?.host.stopDesktopControl();
      resource?.host.close();
      cleanup = (async () => {
        try {
          await Promise.allSettled([...pending]);
        } finally {
          resource?.remove();
          if (activeOwner === identity) activeOwner = null;
          running.delete(tools);
        }
      })();
      return cleanup;
    },
  };
  running.add(tools);
  return tools;
}

/** Probe actual native permissions/helper readiness without opening a personal profile. */
export async function getScopedDesktopToolAvailability(): Promise<HostToolAvailability> {
  const resource = isolatedHost();
  try {
    const state = await resource.host.availability();
    return {
      availableToolNames: state.availableToolNames.filter((name) => name === "openerx_desktop"),
      unavailableReasons: Object.fromEntries(
        Object.entries(state.unavailableReasons).filter(([name]) =>
          name.startsWith("openerx_desktop"),
        ),
      ),
      ...(state.missingPermissions?.openerx_desktop
        ? { missingPermissions: { openerx_desktop: state.missingPermissions.openerx_desktop } }
        : {}),
    };
  } finally {
    resource.host.close();
    resource.remove();
  }
}

export async function stopScopedDesktopTools(): Promise<void> {
  await Promise.allSettled([...running].map((tools) => tools.stopAll?.()));
}
