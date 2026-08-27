import { createHash } from "node:crypto";
import type { BrowserSemanticElement } from "@openerx/contracts";

export interface MacDefaultBrowser {
  applicationName: string;
  bundleId: string;
  applicationPath: string;
}

export interface MacBrowserBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface MacBrowserWindow {
  applicationName: string;
  bundleId: string;
  processId: number;
  windowId: number;
  title: string;
  bounds: MacBrowserBounds;
}

export interface MacBrowserRawElement {
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

export interface MacBrowserRawObservation {
  target: MacBrowserWindow;
  url: string;
  title: string;
  webAreaBounds: MacBrowserBounds;
  elements: MacBrowserRawElement[];
}

export type MacBrowserInputMonitorMessage = "ready" | "user_input";

export function parseMacBrowserInputMonitorLine(value: string): MacBrowserInputMonitorMessage {
  const normalized = value.trim();
  if (normalized === "ready" || normalized === "user_input") return normalized;
  throw new Error("BROWSER_OBSERVATION_MISMATCH");
}

export function macSystemBrowserBundleSupported(bundleId: string): boolean {
  return [
    "com.apple.Safari",
    "com.apple.SafariTechnologyPreview",
    "com.brave.Browser",
    "com.google.Chrome",
    "com.google.Chrome.beta",
    "com.google.Chrome.canary",
    "com.microsoft.edgemac",
    "org.chromium.Chromium",
  ].includes(bundleId);
}

const macBrowserNativeKeys = new Set([
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
  "up",
]);

export function macBrowserNativeKey(value: string): string | null {
  const normalized = value.toLocaleLowerCase().replaceAll(/[-_ ]/gu, "");
  const canonical = normalized === "return" ? "enter" : normalized;
  return macBrowserNativeKeys.has(canonical) ? canonical : null;
}

export function macBrowserScrollPayload(
  direction: "up" | "down" | "left" | "right",
  distance: "small" | "medium" | "viewport" | "edge",
): string {
  return `${direction}:${distance}`;
}

function parsedRecord(output: string, errorCode: string): Record<string, unknown> {
  let value: unknown;
  try {
    value = JSON.parse(output.trim());
  } catch {
    throw new Error(errorCode);
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(errorCode);
  return value as Record<string, unknown>;
}

function stringField(value: Record<string, unknown>, key: string, errorCode: string): string {
  const field = value[key];
  if (typeof field !== "string" || !field.trim()) throw new Error(errorCode);
  return field.trim().normalize("NFC");
}

function integerField(value: Record<string, unknown>, key: string, errorCode: string): number {
  const field = value[key];
  if (!Number.isInteger(field)) throw new Error(errorCode);
  return field as number;
}

function parseBounds(value: unknown, errorCode: string): MacBrowserBounds {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(errorCode);
  const record = value as Record<string, unknown>;
  const bounds = {
    x: integerField(record, "x", errorCode),
    y: integerField(record, "y", errorCode),
    width: integerField(record, "width", errorCode),
    height: integerField(record, "height", errorCode),
  };
  if (bounds.width <= 0 || bounds.height <= 0) throw new Error(errorCode);
  return bounds;
}

function parseWindow(value: unknown): MacBrowserWindow {
  const errorCode = "BROWSER_SURFACE_MISMATCH";
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(errorCode);
  const record = value as Record<string, unknown>;
  const processId = integerField(record, "processId", errorCode);
  const windowId = integerField(record, "windowId", errorCode);
  if (processId <= 0 || windowId <= 0) throw new Error(errorCode);
  const title = record.title;
  if (typeof title !== "string") throw new Error(errorCode);
  return {
    applicationName: stringField(record, "applicationName", errorCode),
    bundleId: stringField(record, "bundleId", errorCode),
    processId,
    windowId,
    title: title.trim().normalize("NFC"),
    bounds: parseBounds(record.bounds, errorCode),
  };
}

export function parseMacDefaultBrowser(output: string): MacDefaultBrowser {
  const errorCode = "BROWSER_BACKEND_UNAVAILABLE";
  const value = parsedRecord(output, errorCode);
  const bundleId = stringField(value, "bundleId", errorCode);
  if (!/^[A-Za-z0-9][A-Za-z0-9.-]{2,199}$/u.test(bundleId)) throw new Error(errorCode);
  const applicationPath = stringField(value, "applicationPath", errorCode);
  if (!applicationPath.startsWith("/") || !applicationPath.endsWith(".app")) {
    throw new Error(errorCode);
  }
  return {
    applicationName: stringField(value, "applicationName", errorCode),
    bundleId,
    applicationPath,
  };
}

export function parseMacBrowserWindows(output: string): MacBrowserWindow[] {
  let value: unknown;
  try {
    value = JSON.parse(output.trim());
  } catch {
    throw new Error("BROWSER_SURFACE_MISMATCH");
  }
  if (!Array.isArray(value)) throw new Error("BROWSER_SURFACE_MISMATCH");
  const windows = value.map(parseWindow);
  if (new Set(windows.map(({ windowId }) => windowId)).size !== windows.length) {
    throw new Error("BROWSER_SURFACE_MISMATCH");
  }
  return windows;
}

function parseRawElement(value: unknown): MacBrowserRawElement {
  const errorCode = "BROWSER_OBSERVATION_MISMATCH";
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(errorCode);
  const record = value as Record<string, unknown>;
  const sourceNodeId = stringField(record, "sourceNodeId", errorCode);
  if (!/^ax_[0-9]{1,6}$/u.test(sourceNodeId)) throw new Error(errorCode);
  const sensitiveKind = record.sensitiveKind;
  if (!["none", "password", "payment", "authentication"].includes(String(sensitiveKind))) {
    throw new Error(errorCode);
  }
  const state = record.state;
  if (!state || typeof state !== "object" || Array.isArray(state)) throw new Error(errorCode);
  const stateRecord = state as Record<string, unknown>;
  const actions = record.actions;
  if (!Array.isArray(actions)) throw new Error(errorCode);
  const validActions = new Set(["focus", "setValue", "invoke", "select", "scroll"]);
  if (actions.some((action) => typeof action !== "string" || !validActions.has(action))) {
    throw new Error(errorCode);
  }
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
  const rawValue = record.value;
  if (rawValue !== null && typeof rawValue !== "string") throw new Error(errorCode);
  if (sensitiveKind !== "none" && rawValue !== null) throw new Error(errorCode);
  return {
    sourceNodeId,
    role: stringField(record, "role", errorCode),
    name: typeof record.name === "string" ? record.name.normalize("NFC") : "",
    value: rawValue === null ? null : rawValue.normalize("NFC"),
    sensitiveKind: sensitiveKind as MacBrowserRawElement["sensitiveKind"],
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
    actions: actions as MacBrowserRawElement["actions"],
  };
}

export function parseMacBrowserObservation(output: string): MacBrowserRawObservation {
  const errorCode = "BROWSER_OBSERVATION_MISMATCH";
  const value = parsedRecord(output, errorCode);
  const elementsValue = value.elements;
  if (!Array.isArray(elementsValue) || elementsValue.length > 2_000) throw new Error(errorCode);
  const elements = elementsValue.map(parseRawElement);
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
  const title = value.title;
  if (typeof title !== "string") throw new Error(errorCode);
  return {
    target: parseWindow(value.target),
    url: parsedUrl.href,
    title: title.normalize("NFC"),
    webAreaBounds: parseBounds(value.webAreaBounds, errorCode),
    elements,
  };
}

export function selectNewMacBrowserWindow(
  before: readonly MacBrowserWindow[],
  after: readonly MacBrowserWindow[],
): MacBrowserWindow {
  const previousIds = new Set(before.map(({ windowId }) => windowId));
  const created = after.filter(({ windowId }) => !previousIds.has(windowId));
  if (created.length !== 1) throw new Error("BROWSER_SURFACE_NOT_BOUND");
  return created[0] as MacBrowserWindow;
}

function boundsOverlap(left: MacBrowserBounds, right: MacBrowserBounds): boolean {
  return (
    Math.abs(left.x - right.x) <= 2 &&
    Math.abs(left.y - right.y) <= 2 &&
    Math.abs(left.width - right.width) <= 2 &&
    Math.abs(left.height - right.height) <= 2
  );
}

export function isolatedMacBrowserWindowBounds(
  created: MacBrowserWindow,
  occupied: readonly MacBrowserWindow[],
): MacBrowserBounds {
  for (let attempt = 1; attempt <= 20; attempt += 1) {
    const inset = attempt * 12;
    const candidate = {
      x: created.bounds.x + inset,
      y: created.bounds.y + inset,
      width: created.bounds.width - inset * 2,
      height: created.bounds.height - inset * 2,
    };
    if (candidate.width < 400 || candidate.height < 300) break;
    if (!occupied.some(({ bounds }) => boundsOverlap(candidate, bounds))) return candidate;
  }
  throw new Error("BROWSER_SURFACE_NOT_BOUND");
}

export function macBrowserPageRevision(observation: MacBrowserRawObservation): string {
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

export function macBrowserObservationStabilityKey(observation: MacBrowserRawObservation): string {
  return JSON.stringify([
    observation.target.processId,
    observation.target.windowId,
    observation.target.bounds,
    observation.url,
    observation.webAreaBounds,
  ]);
}

export function maskBrowserBitmap(
  input: Buffer,
  width: number,
  height: number,
  rectangles: readonly BrowserSemanticElement["bounds"][],
): Buffer {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new Error("BROWSER_CAPTURE_DIMENSIONS_INVALID");
  }
  if (input.length !== width * height * 4) throw new Error("BROWSER_CAPTURE_BITMAP_INVALID");
  const output = Buffer.from(input);
  for (const rectangle of rectangles) {
    const left = Math.max(0, Math.floor(rectangle.x));
    const top = Math.max(0, Math.floor(rectangle.y));
    const right = Math.min(width, Math.ceil(rectangle.x + rectangle.width));
    const bottom = Math.min(height, Math.ceil(rectangle.y + rectangle.height));
    for (let y = top; y < bottom; y += 1) {
      for (let x = left; x < right; x += 1) {
        const offset = (y * width + x) * 4;
        output[offset] = 0;
        output[offset + 1] = 0;
        output[offset + 2] = 0;
        output[offset + 3] = 255;
      }
    }
  }
  return output;
}

export function macDefaultBrowserScript(): string {
  return [
    "function run() {",
    '  ObjC.import("AppKit");',
    '  const url = $.NSURL.URLWithString("https://www.openerx.local/");',
    "  const applicationUrl = $.NSWorkspace.sharedWorkspace.URLForApplicationToOpenURL(url);",
    '  if (!applicationUrl) throw new Error("BROWSER_BACKEND_UNAVAILABLE");',
    "  const bundle = $.NSBundle.bundleWithURL(applicationUrl);",
    '  if (!bundle) throw new Error("BROWSER_BACKEND_UNAVAILABLE");',
    '  const bundleId = String(ObjC.unwrap(bundle.bundleIdentifier) || "");',
    '  const displayName = ObjC.unwrap(bundle.objectForInfoDictionaryKey("CFBundleDisplayName"));',
    '  const bundleName = ObjC.unwrap(bundle.objectForInfoDictionaryKey("CFBundleName"));',
    '  const applicationPath = String(ObjC.unwrap(applicationUrl.path) || "");',
    '  const applicationName = String(displayName || bundleName || applicationPath.split("/").pop().replace(/\\.app$/, ""));',
    "  return JSON.stringify({ applicationName, bundleId, applicationPath });",
    "}",
  ].join("\n");
}

export function macBrowserWindowsScript(): string {
  return [
    "function run(argv) {",
    '  ObjC.import("AppKit");',
    '  ObjC.bindFunction("CGWindowListCopyWindowInfo", ["id", ["uint32", "uint32"]]);',
    '  const bundleId = String(argv[0] || "");',
    '  if (!/^[A-Za-z0-9][A-Za-z0-9.-]+$/.test(bundleId)) throw new Error("BROWSER_BUNDLE_ID_INVALID");',
    "  const windows = ObjC.deepUnwrap($.CGWindowListCopyWindowInfo(16, 0));",
    "  const result = windows.flatMap((window) => {",
    "    if (Number(window.kCGWindowLayer) !== 0) return [];",
    "    const processId = Number(window.kCGWindowOwnerPID);",
    "    const application = $.NSRunningApplication.runningApplicationWithProcessIdentifier(processId);",
    "    if (!application) return [];",
    '    const actualBundleId = String(ObjC.unwrap(application.bundleIdentifier) || "");',
    "    if (actualBundleId !== bundleId) return [];",
    "    const raw = window.kCGWindowBounds || {};",
    "    const bounds = { x: Math.round(Number(raw.X)), y: Math.round(Number(raw.Y)), width: Math.round(Number(raw.Width)), height: Math.round(Number(raw.Height)) };",
    "    if (bounds.width < 400 || bounds.height < 300) return [];",
    '    return [{ applicationName: String(window.kCGWindowOwnerName || "").trim(), bundleId, processId, windowId: Number(window.kCGWindowNumber), title: String(window.kCGWindowName || "").trim(), bounds }];',
    "  });",
    "  return JSON.stringify(result);",
    "}",
  ].join("\n");
}

export function macBrowserCreateWindowScript(): string {
  return [
    "on run argv",
    "set expectedBundleId to item 1 of argv",
    'tell application "System Events"',
    "set matches to every application process whose bundle identifier is expectedBundleId",
    'if (count of matches) is not 1 then error "BROWSER_TARGET_PROCESS_AMBIGUOUS"',
    "set targetProcess to item 1 of matches",
    "set frontmost of targetProcess to true",
    "delay 0.25",
    'keystroke "n" using command down',
    "end tell",
    'return "created"',
    "end run",
  ].join("\n");
}

export function macBrowserNavigateWindowScript(): string {
  return [
    "function run(argv) {",
    '  ObjC.import("AppKit");',
    '  ObjC.bindFunction("CGWindowListCopyWindowInfo", ["id", ["uint32", "uint32"]]);',
    '  const bundleId = String(argv[0] || "");',
    "  const processId = Number(argv[1] || 0);",
    "  const windowId = Number(argv[2] || 0);",
    "  const expected = { x: Number(argv[3]), y: Number(argv[4]), width: Number(argv[5]), height: Number(argv[6]) };",
    '  const url = String(argv[7] || "");',
    '  if (!/^https?:\\/\\//i.test(url)) throw new Error("BROWSER_NAVIGATION_DENIED");',
    "  const sameBounds = (left, right) => Math.abs(Number(left.x) - Number(right.x)) <= 2 && Math.abs(Number(left.y) - Number(right.y)) <= 2 && Math.abs(Number(left.width) - Number(right.width)) <= 2 && Math.abs(Number(left.height) - Number(right.height)) <= 2;",
    "  const nativeMatches = ObjC.deepUnwrap($.CGWindowListCopyWindowInfo(16, 0)).filter((window) => Number(window.kCGWindowNumber) === windowId && Number(window.kCGWindowOwnerPID) === processId && Number(window.kCGWindowLayer) === 0);",
    '  if (nativeMatches.length !== 1) throw new Error("BROWSER_SURFACE_NOT_BOUND");',
    "  const raw = nativeMatches[0].kCGWindowBounds || {};",
    "  const nativeBounds = { x: Math.round(Number(raw.X)), y: Math.round(Number(raw.Y)), width: Math.round(Number(raw.Width)), height: Math.round(Number(raw.Height)) };",
    '  if (!sameBounds(nativeBounds, expected)) throw new Error("BROWSER_SURFACE_MISMATCH");',
    "  const running = $.NSRunningApplication.runningApplicationWithProcessIdentifier(processId);",
    '  if (!running || String(ObjC.unwrap(running.bundleIdentifier) || "") !== bundleId) throw new Error("BROWSER_SURFACE_MISMATCH");',
    "  const browser = Application(bundleId);",
    "  const windows = browser.windows();",
    '  if (windows.length < 1) throw new Error("BROWSER_SURFACE_NOT_BOUND");',
    '  if (!sameBounds(windows[0].bounds(), expected)) throw new Error("BROWSER_SURFACE_NOT_BOUND");',
    '  if (["com.apple.Safari", "com.apple.SafariTechnologyPreview"].includes(bundleId)) {',
    "    windows[0].currentTab().url = url;",
    '  } else if (["com.brave.Browser", "com.google.Chrome", "com.google.Chrome.beta", "com.google.Chrome.canary", "com.microsoft.edgemac", "org.chromium.Chromium"].includes(bundleId)) {',
    "    windows[0].activeTab().url = url;",
    "  } else {",
    '    throw new Error("BROWSER_BACKEND_UNAVAILABLE");',
    "  }",
    '  return "navigating";',
    "}",
  ].join("\n");
}
