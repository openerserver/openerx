import { createHash } from "node:crypto";
import type { BrowserSemanticElement } from "@openerx/contracts";

export interface WindowsDefaultBrowser {
  applicationId: string;
  applicationName: string;
  executablePath: string;
  processName: string;
}

export interface WindowsBrowserBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface WindowsBrowserWindow {
  applicationId: string;
  applicationName: string;
  executablePath: string;
  processName: string;
  processId: number;
  windowId: number;
  title: string;
  bounds: WindowsBrowserBounds;
}

export interface WindowsBrowserRawElement {
  sourceNodeId: string;
  role: string;
  name: string;
  value: string | null;
  sensitiveKind: BrowserSemanticElement["sensitiveKind"];
  visible: boolean;
  state: BrowserSemanticElement["state"];
  bounds: BrowserSemanticElement["bounds"];
  actions: BrowserSemanticElement["actions"];
}

export interface WindowsBrowserRawObservation {
  target: WindowsBrowserWindow;
  url: string;
  title: string;
  webAreaBounds: WindowsBrowserBounds;
  elements: WindowsBrowserRawElement[];
}

export interface WindowsBrowserRawCapture {
  target: WindowsBrowserWindow;
  png: Buffer;
}

export type WindowsBrowserInputMonitorMessage = "ready" | "user_input";

function parsedRecord(output: string, errorCode: string): Record<string, unknown> {
  let value: unknown;
  try {
    value = JSON.parse(output);
  } catch {
    throw new Error(errorCode);
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(errorCode);
  return value as Record<string, unknown>;
}

function stringField(value: Record<string, unknown>, key: string, errorCode: string): string {
  const field = value[key];
  if (typeof field !== "string" || !field.trim()) throw new Error(errorCode);
  return field.normalize("NFC");
}

function integerField(value: Record<string, unknown>, key: string, errorCode: string): number {
  const field = value[key];
  if (!Number.isInteger(field) || Number(field) <= 0) throw new Error(errorCode);
  return Number(field);
}

function parseBounds(value: unknown, errorCode: string): WindowsBrowserBounds {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(errorCode);
  const record = value as Record<string, unknown>;
  const fields = ["x", "y", "width", "height"] as const;
  if (fields.some((field) => !Number.isFinite(record[field]))) throw new Error(errorCode);
  const bounds = {
    x: Math.round(Number(record.x)),
    y: Math.round(Number(record.y)),
    width: Math.round(Number(record.width)),
    height: Math.round(Number(record.height)),
  };
  if (bounds.width <= 0 || bounds.height <= 0) throw new Error(errorCode);
  return bounds;
}

function parseWindow(value: unknown): WindowsBrowserWindow {
  const errorCode = "BROWSER_SURFACE_NOT_BOUND";
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(errorCode);
  const record = value as Record<string, unknown>;
  const executablePath = stringField(record, "executablePath", errorCode);
  if (!/\.(?:exe)$/iu.test(executablePath)) throw new Error(errorCode);
  return {
    applicationId: stringField(record, "applicationId", errorCode),
    applicationName: stringField(record, "applicationName", errorCode),
    executablePath,
    processName: stringField(record, "processName", errorCode),
    processId: integerField(record, "processId", errorCode),
    windowId: integerField(record, "windowId", errorCode),
    title: typeof record.title === "string" ? record.title.normalize("NFC") : "",
    bounds: parseBounds(record.bounds, errorCode),
  };
}

function parseElement(value: unknown): WindowsBrowserRawElement {
  const errorCode = "BROWSER_OBSERVATION_MISMATCH";
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(errorCode);
  const record = value as Record<string, unknown>;
  const sourceNodeId = stringField(record, "sourceNodeId", errorCode);
  if (!/^uia_[0-9]{1,6}$/u.test(sourceNodeId)) throw new Error(errorCode);
  const sensitiveKind = String(record.sensitiveKind);
  if (!["none", "password", "payment", "authentication"].includes(sensitiveKind)) {
    throw new Error(errorCode);
  }
  const state = record.state;
  if (!state || typeof state !== "object" || Array.isArray(state)) throw new Error(errorCode);
  const stateRecord = state as Record<string, unknown>;
  const checked = stateRecord.checked;
  const selected = stateRecord.selected;
  const expanded = stateRecord.expanded;
  if (
    typeof stateRecord.disabled !== "boolean" ||
    typeof stateRecord.focused !== "boolean" ||
    typeof stateRecord.editable !== "boolean" ||
    ![null, true, false].includes(checked as null | boolean) ||
    ![null, true, false].includes(selected as null | boolean) ||
    ![null, true, false].includes(expanded as null | boolean)
  ) {
    throw new Error(errorCode);
  }
  const actions = record.actions;
  const validActions = new Set(["focus", "setValue", "invoke", "select", "scroll"]);
  if (
    !Array.isArray(actions) ||
    actions.some((action) => typeof action !== "string" || !validActions.has(action))
  ) {
    throw new Error(errorCode);
  }
  const rawValue = record.value;
  if (rawValue !== null && typeof rawValue !== "string") throw new Error(errorCode);
  if (sensitiveKind !== "none" && rawValue !== null) throw new Error(errorCode);
  return {
    sourceNodeId,
    role: stringField(record, "role", errorCode),
    name: typeof record.name === "string" ? record.name.normalize("NFC") : "",
    value: rawValue === null ? null : rawValue.normalize("NFC"),
    sensitiveKind: sensitiveKind as WindowsBrowserRawElement["sensitiveKind"],
    visible: record.visible === true,
    state: {
      disabled: stateRecord.disabled,
      checked: checked as boolean | null,
      selected: selected as boolean | null,
      expanded: expanded as boolean | null,
      focused: stateRecord.focused,
      editable: stateRecord.editable,
    },
    bounds: parseBounds(record.bounds, errorCode),
    actions: actions as WindowsBrowserRawElement["actions"],
  };
}

export function parseWindowsDefaultBrowser(output: string): WindowsDefaultBrowser {
  const errorCode = "BROWSER_BACKEND_UNAVAILABLE";
  const value = parsedRecord(output, errorCode);
  const executablePath = stringField(value, "executablePath", errorCode);
  const processName = stringField(value, "processName", errorCode).toLocaleLowerCase();
  if (!windowsSystemBrowserExecutableSupported(executablePath)) throw new Error(errorCode);
  if (!["chrome", "msedge"].includes(processName)) throw new Error(errorCode);
  return {
    applicationId: stringField(value, "applicationId", errorCode),
    applicationName: stringField(value, "applicationName", errorCode),
    executablePath,
    processName,
  };
}

export function parseWindowsBrowserWindows(output: string): WindowsBrowserWindow[] {
  let value: unknown;
  try {
    value = JSON.parse(output);
  } catch {
    throw new Error("BROWSER_SURFACE_NOT_BOUND");
  }
  const list = value === null ? [] : Array.isArray(value) ? value : [value];
  const windows = list.map(parseWindow);
  if (new Set(windows.map(({ windowId }) => windowId)).size !== windows.length) {
    throw new Error("BROWSER_SURFACE_NOT_BOUND");
  }
  return windows;
}

export function parseWindowsBrowserObservation(output: string): WindowsBrowserRawObservation {
  const errorCode = "BROWSER_OBSERVATION_MISMATCH";
  const value = parsedRecord(output, errorCode);
  const elementsValue = value.elements;
  if (!Array.isArray(elementsValue) || elementsValue.length > 2_000) throw new Error(errorCode);
  const elements = elementsValue.map(parseElement);
  if (new Set(elements.map(({ sourceNodeId }) => sourceNodeId)).size !== elements.length) {
    throw new Error(errorCode);
  }
  const url = stringField(value, "url", errorCode);
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    throw new Error("BROWSER_NAVIGATION_DENIED");
  }
  if (!["http:", "https:"].includes(parsedUrl.protocol)) {
    throw new Error("BROWSER_NAVIGATION_DENIED");
  }
  return {
    target: parseWindow(value.target),
    url: parsedUrl.href,
    title: typeof value.title === "string" ? value.title.normalize("NFC") : "",
    webAreaBounds: parseBounds(value.webAreaBounds, errorCode),
    elements,
  };
}

export function parseWindowsBrowserCapture(output: string): WindowsBrowserRawCapture {
  const errorCode = "BROWSER_OBSERVATION_REQUIRED";
  const value = parsedRecord(output, errorCode);
  const pngBase64 = stringField(value, "pngBase64", errorCode);
  if (!/^[A-Za-z0-9+/]+={0,2}$/u.test(pngBase64)) throw new Error(errorCode);
  const png = Buffer.from(pngBase64, "base64");
  if (
    png.length < 8 ||
    png.length > 16 * 1_024 * 1_024 ||
    !png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  ) {
    throw new Error(errorCode);
  }
  return { target: parseWindow(value.target), png };
}

export function parseWindowsBrowserInputMonitorLine(
  value: string,
): WindowsBrowserInputMonitorMessage {
  const normalized = value.trim();
  if (normalized === "ready" || normalized === "user_input") return normalized;
  throw new Error("BROWSER_OBSERVATION_MISMATCH");
}

export function windowsSystemBrowserExecutableSupported(executablePath: string): boolean {
  return /(?:^|[\\/])(?:msedge|chrome)\.exe$/iu.test(executablePath.trim());
}

export function windowsBrowserNativeKey(value: string): string | null {
  const normalized = value.toLocaleLowerCase().replaceAll(/[-_ ]/gu, "");
  const canonical = normalized === "return" ? "enter" : normalized;
  return new Set([
    "backspace",
    "delete",
    "down",
    "end",
    "enter",
    "home",
    "left",
    "pagedown",
    "pageup",
    "right",
    "space",
    "tab",
    "up",
  ]).has(canonical)
    ? canonical
    : null;
}

export function windowsBrowserScrollPayload(
  direction: "up" | "down" | "left" | "right",
  distance: "small" | "medium" | "viewport" | "edge",
): string {
  return `${direction}:${distance}`;
}

export function selectNewWindowsBrowserWindow(
  before: readonly WindowsBrowserWindow[],
  after: readonly WindowsBrowserWindow[],
): WindowsBrowserWindow {
  const existing = new Set(before.map(({ windowId }) => windowId));
  const created = after.filter(({ windowId }) => !existing.has(windowId));
  if (created.length !== 1) throw new Error("BROWSER_SURFACE_NOT_BOUND");
  return created[0] as WindowsBrowserWindow;
}

export function windowsBrowserPageRevision(observation: WindowsBrowserRawObservation): string {
  return createHash("sha256")
    .update(
      JSON.stringify([
        observation.target.windowId,
        observation.target.bounds,
        observation.url,
        observation.title,
        observation.webAreaBounds,
        observation.elements.map((element) => [
          element.sourceNodeId,
          element.role,
          element.name,
          element.value,
          element.state,
          element.bounds,
          element.actions,
        ]),
      ]),
    )
    .digest("hex");
}

export function windowsBrowserObservationStabilityKey(
  observation: WindowsBrowserRawObservation,
): string {
  return JSON.stringify([
    observation.target.processId,
    observation.target.windowId,
    observation.target.bounds,
    observation.url,
    observation.webAreaBounds,
  ]);
}
