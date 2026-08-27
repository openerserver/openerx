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
    "  const windows = ObjC.deepUnwrap($.CGWindowListCopyWindowInfo(3, 0));",
    "  const result = windows.flatMap((window) => {",
    "    if (Number(window.kCGWindowLayer) !== 0 || window.kCGWindowIsOnscreen !== true) return [];",
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

function macBrowserAccessibilityPrelude(): string[] {
  return [
    '  ObjC.import("AppKit");',
    '  ObjC.bindFunction("CGWindowListCopyWindowInfo", ["id", ["uint32", "uint32"]]);',
    "  const safe = (callback, fallback) => { try { const value = callback(); return value === undefined ? fallback : value; } catch (_) { return fallback; } };",
    '  const text = (value) => value === null || value === undefined ? "" : String(value);',
    "  const integerBounds = (position, size) => ({ x: Math.round(Number(position[0])), y: Math.round(Number(position[1])), width: Math.round(Number(size[0])), height: Math.round(Number(size[1])) });",
    "  const sameBounds = (left, right) => Math.abs(left.x - right.x) <= 2 && Math.abs(left.y - right.y) <= 2 && Math.abs(left.width - right.width) <= 2 && Math.abs(left.height - right.height) <= 2;",
    "  const attribute = (element, name, fallback = null) => {",
    "    const attributes = safe(() => element.attributes(), []);",
    '    const match = attributes.find((entry) => safe(() => entry.name(), "") === name);',
    "    return match ? safe(() => match.value(), fallback) : fallback;",
    "  };",
    "  const targetFor = (bundleId, processId, windowId) => {",
    "    const windows = ObjC.deepUnwrap($.CGWindowListCopyWindowInfo(3, 0));",
    "    const nativeMatches = windows.filter((window) => Number(window.kCGWindowNumber) === windowId && Number(window.kCGWindowLayer) === 0 && window.kCGWindowIsOnscreen === true);",
    '    if (nativeMatches.length !== 1) throw new Error("BROWSER_SURFACE_NOT_BOUND");',
    "    const nativeWindow = nativeMatches[0];",
    '    if (Number(nativeWindow.kCGWindowOwnerPID) !== processId) throw new Error("BROWSER_SURFACE_MISMATCH");',
    "    const running = $.NSRunningApplication.runningApplicationWithProcessIdentifier(processId);",
    '    if (!running || String(ObjC.unwrap(running.bundleIdentifier) || "") !== bundleId) throw new Error("BROWSER_SURFACE_MISMATCH");',
    "    const raw = nativeWindow.kCGWindowBounds || {};",
    "    const bounds = { x: Math.round(Number(raw.X)), y: Math.round(Number(raw.Y)), width: Math.round(Number(raw.Width)), height: Math.round(Number(raw.Height)) };",
    "    const nativeTitle = text(nativeWindow.kCGWindowName).trim();",
    '    const systemEvents = Application("System Events");',
    "    const processes = systemEvents.applicationProcesses.whose({ unixId: processId })();",
    '    if (processes.length !== 1 || text(processes[0].bundleIdentifier()) !== bundleId) throw new Error("BROWSER_SURFACE_MISMATCH");',
    "    const applicationProcess = processes[0];",
    "    const matchingWindows = applicationProcess.windows().filter((window) => {",
    '      const role = safe(() => window.role(), "");',
    '      const subrole = safe(() => window.subrole(), "");',
    "      const candidateBounds = integerBounds(safe(() => window.position(), [0, 0]), safe(() => window.size(), [0, 0]));",
    '      const candidateTitle = text(safe(() => window.name(), "")).trim();',
    "      const sameTitle = !nativeTitle || candidateTitle === nativeTitle || candidateTitle.startsWith(`${nativeTitle} -`);",
    '      return role === "AXWindow" && subrole === "AXStandardWindow" && sameBounds(bounds, candidateBounds) && sameTitle;',
    "    });",
    '    if (matchingWindows.length !== 1) throw new Error("BROWSER_SURFACE_NOT_BOUND");',
    "    return { systemEvents, applicationProcess, window: matchingWindows[0], bounds, nativeWindow };",
    "  };",
    "  const roleName = (role, subrole) => {",
    '    if (subrole === "AXSearchField") return "searchbox";',
    '    const roles = { AXTextField: "textbox", AXTextArea: "textbox", AXButton: "button", AXLink: "link", AXCheckBox: "checkbox", AXRadioButton: "radio", AXPopUpButton: "combobox", AXComboBox: "combobox", AXHeading: "heading", AXStaticText: "text", AXImage: "image" };',
    '    return roles[role] || "";',
    "  };",
    "  const sensitivity = (role, subrole, name) => {",
    '    if (role === "AXSecureTextField" || subrole === "AXSecureTextField") return "password";',
    '    if (/(card|credit|debit|cvv|cvc|payment|银行卡|信用卡|支付)/i.test(name)) return "payment";',
    '    if (/(password|passcode|one.?time|otp|verification code|密码|验证码|口令)/i.test(name)) return "authentication";',
    '    return "none";',
    "  };",
  ];
}

export function macBrowserObservationScript(): string {
  return [
    "function run(argv) {",
    ...macBrowserAccessibilityPrelude(),
    '  const bundleId = String(argv[0] || "");',
    "  const processId = Number(argv[1] || 0);",
    "  const windowId = Number(argv[2] || 0);",
    "  const target = targetFor(bundleId, processId, windowId);",
    "  const contents = safe(() => target.window.entireContents(), []);",
    "  const webAreas = contents.flatMap((element, index) => {",
    '    if (safe(() => element.role(), "") !== "AXWebArea") return [];',
    "    const bounds = integerBounds(safe(() => element.position(), [0, 0]), safe(() => element.size(), [0, 0]));",
    "    if (bounds.width < 1 || bounds.height < 1) return [];",
    "    return [{ element, index, bounds, area: bounds.width * bounds.height }];",
    "  }).sort((left, right) => right.area - left.area);",
    '  if (webAreas.length === 0) throw new Error("BROWSER_OBSERVATION_REQUIRED");',
    "  const webArea = webAreas[0];",
    "  const inside = (bounds) => bounds.x >= webArea.bounds.x && bounds.y >= webArea.bounds.y && bounds.x + bounds.width <= webArea.bounds.x + webArea.bounds.width + 2 && bounds.y + bounds.height <= webArea.bounds.y + webArea.bounds.height + 2;",
    "  const elements = contents.flatMap((element, index) => {",
    '    const rawRole = safe(() => element.role(), "");',
    '    const rawSubrole = safe(() => element.subrole(), "");',
    "    const role = roleName(rawRole, rawSubrole);",
    "    if (!role) return [];",
    "    const absolute = integerBounds(safe(() => element.position(), [0, 0]), safe(() => element.size(), [0, 0]));",
    "    if (absolute.width < 1 || absolute.height < 1 || !inside(absolute)) return [];",
    "    const rawValue = safe(() => element.value(), null);",
    '    const title = text(safe(() => element.title(), ""));',
    '    const description = text(safe(() => element.description(), ""));',
    '    const valueText = rawValue === null ? "" : text(rawValue);',
    '    const name = (title || description || (role === "text" ? valueText : "") || role).slice(0, 2000);',
    "    const sensitiveKind = sensitivity(rawRole, rawSubrole, name);",
    "    const rawActions = safe(() => element.actions().map((action) => action.name()), []);",
    '    const editable = ["AXTextField", "AXTextArea", "AXComboBox", "AXSecureTextField"].includes(rawRole) || rawSubrole === "AXSearchField";',
    "    const actions = [];",
    '    if (editable || rawActions.includes("AXPress")) actions.push("focus");',
    '    if (editable && sensitiveKind === "none") actions.push("setValue");',
    '    if (rawActions.includes("AXPress")) actions.push("invoke");',
    '    if (["AXPopUpButton", "AXComboBox"].includes(rawRole)) actions.push("select");',
    '    const checkedValue = attribute(element, "AXValue", null);',
    '    return [{ sourceNodeId: `ax_${index}`, role, name: name.slice(0, 500), value: sensitiveKind === "none" && rawValue !== null ? valueText.slice(0, 2000) : null, sensitiveKind, visible: true, state: { disabled: safe(() => element.enabled(), true) === false, checked: role === "checkbox" || role === "radio" ? Boolean(checkedValue) : null, selected: attribute(element, "AXSelected", null), expanded: attribute(element, "AXExpanded", null), focused: Boolean(attribute(element, "AXFocused", false)), editable }, bounds: { x: absolute.x - webArea.bounds.x, y: absolute.y - webArea.bounds.y, width: absolute.width, height: absolute.height }, actions }];',
    "  }).slice(0, 2000);",
    '  const documentUrl = text(attribute(target.window, "AXDocument", attribute(webArea.element, "AXURL", "")));',
    '  if (!/^https?:\\/\\//i.test(documentUrl)) throw new Error("BROWSER_NAVIGATION_DENIED");',
    '  const title = text(safe(() => target.window.name(), target.nativeWindow.kCGWindowName || ""));',
    "  const result = { target: { applicationName: text(target.nativeWindow.kCGWindowOwnerName).trim(), bundleId, processId, windowId, title, bounds: target.bounds }, url: documentUrl, title, webAreaBounds: webArea.bounds, elements };",
    "  return JSON.stringify(result);",
    "}",
  ].join("\n");
}

function macBrowserAppleScriptTargetPrelude(): string[] {
  return [
    "set expectedBundleId to item 1 of argv",
    "set expectedProcessId to item 2 of argv as integer",
    "set expectedTitle to item 3 of argv",
    "set expectedX to item 4 of argv as integer",
    "set expectedY to item 5 of argv as integer",
    "set expectedWidth to item 6 of argv as integer",
    "set expectedHeight to item 7 of argv as integer",
    'tell application "System Events"',
    "set processMatches to every application process whose unix id is expectedProcessId",
    'if (count of processMatches) is not 1 then error "BROWSER_SURFACE_NOT_BOUND"',
    "set targetProcess to item 1 of processMatches",
    'if (bundle identifier of targetProcess as text) is not expectedBundleId then error "BROWSER_SURFACE_MISMATCH"',
    "set targetWindows to {}",
    "repeat with candidateWindow in windows of targetProcess",
    "try",
    'if (role of candidateWindow as text) is "AXWindow" and (subrole of candidateWindow as text) is "AXStandardWindow" then',
    "set candidatePosition to position of candidateWindow",
    "set candidateSize to size of candidateWindow",
    "set candidateX to item 1 of candidatePosition as integer",
    "set candidateY to item 2 of candidatePosition as integer",
    "set candidateWidth to item 1 of candidateSize as integer",
    "set candidateHeight to item 2 of candidateSize as integer",
    "set candidateTitle to name of candidateWindow as text",
    'set titleMatches to expectedTitle is "" or candidateTitle is expectedTitle or candidateTitle starts with (expectedTitle & " -")',
    "set boundsMatch to candidateX is greater than or equal to (expectedX - 2) and candidateX is less than or equal to (expectedX + 2) and candidateY is greater than or equal to (expectedY - 2) and candidateY is less than or equal to (expectedY + 2) and candidateWidth is greater than or equal to (expectedWidth - 2) and candidateWidth is less than or equal to (expectedWidth + 2) and candidateHeight is greater than or equal to (expectedHeight - 2) and candidateHeight is less than or equal to (expectedHeight + 2)",
    "if titleMatches and boundsMatch then set end of targetWindows to candidateWindow",
    "end if",
    "end try",
    "end repeat",
    'if (count of targetWindows) is not 1 then error "BROWSER_SURFACE_NOT_BOUND"',
    "set targetWindow to item 1 of targetWindows",
    'perform action "AXRaise" of targetWindow',
    "set frontmost of targetProcess to true",
    "delay 0.2",
  ];
}

export function macBrowserSemanticActionScript(): string {
  return [
    "on run argv",
    ...macBrowserAppleScriptTargetPrelude(),
    "set sourceIndex to item 8 of argv as integer",
    "set actionName to item 9 of argv",
    "set actionPayload to item 10 of argv",
    "set expectedElementX to item 11 of argv as integer",
    "set expectedElementY to item 12 of argv as integer",
    "set expectedElementWidth to item 13 of argv as integer",
    "set expectedElementHeight to item 14 of argv as integer",
    "set allElements to entire contents of targetWindow",
    'if sourceIndex < 0 or sourceIndex is greater than or equal to (count of allElements) then error "BROWSER_ELEMENT_NOT_FOUND"',
    "set targetElement to item (sourceIndex + 1) of allElements",
    "set elementPosition to position of targetElement",
    "set elementSize to size of targetElement",
    "set elementX to item 1 of elementPosition as integer",
    "set elementY to item 2 of elementPosition as integer",
    "set elementWidth to item 1 of elementSize as integer",
    "set elementHeight to item 2 of elementSize as integer",
    "set elementMatches to elementX is greater than or equal to (expectedElementX - 3) and elementX is less than or equal to (expectedElementX + 3) and elementY is greater than or equal to (expectedElementY - 3) and elementY is less than or equal to (expectedElementY + 3) and elementWidth is greater than or equal to (expectedElementWidth - 3) and elementWidth is less than or equal to (expectedElementWidth + 3) and elementHeight is greater than or equal to (expectedElementHeight - 3) and elementHeight is less than or equal to (expectedElementHeight + 3)",
    'if elementMatches is not true then error "BROWSER_OBSERVATION_MISMATCH"',
    "try",
    'if actionName is "focus" then',
    'set value of attribute "AXFocused" of targetElement to true',
    'else if actionName is "setValue" then',
    'set value of attribute "AXValue" of targetElement to actionPayload',
    'else if actionName is "invoke" or actionName is "click" or actionName is "submit" then',
    'perform action "AXPress" of targetElement',
    'else if actionName is "select" then',
    'set value of attribute "AXValue" of targetElement to actionPayload',
    "else",
    'return "unsupported"',
    "end if",
    "on error",
    'return "unsupported"',
    "end try",
    "end tell",
    'return "performed"',
    "end run",
  ].join("\n");
}

export function macBrowserNativeActionScript(): string {
  return [
    "on run argv",
    ...macBrowserAppleScriptTargetPrelude(),
    "set actionName to item 8 of argv",
    "set actionPayload to item 9 of argv",
    "set pointX to item 10 of argv as integer",
    "set pointY to item 11 of argv as integer",
    "set webX to item 12 of argv as integer",
    "set webY to item 13 of argv as integer",
    "set webWidth to item 14 of argv as integer",
    "set webHeight to item 15 of argv as integer",
    "set hasPoint to pointX is greater than or equal to webX and pointY is greater than or equal to webY and pointX is less than (webX + webWidth) and pointY is less than (webY + webHeight)",
    'if actionName is "focus" or actionName is "click" or actionName is "invoke" or actionName is "submit" then',
    'if hasPoint is not true then return "unsupported"',
    "click at {pointX, pointY}",
    'else if actionName is "setValue" or actionName is "type" then',
    "if hasPoint then click at {pointX, pointY}",
    "delay 0.1",
    'set focusedElement to value of attribute "AXFocusedUIElement" of targetProcess',
    "set focusedPosition to position of focusedElement",
    "set focusedSize to size of focusedElement",
    "set focusedX to item 1 of focusedPosition as integer",
    "set focusedY to item 2 of focusedPosition as integer",
    "set focusedWidth to item 1 of focusedSize as integer",
    "set focusedHeight to item 2 of focusedSize as integer",
    "set focusedInsideWeb to focusedX is greater than or equal to webX and focusedY is greater than or equal to webY and (focusedX + focusedWidth) is less than or equal to (webX + webWidth + 2) and (focusedY + focusedHeight) is less than or equal to (webY + webHeight + 2)",
    'if focusedInsideWeb is not true then error "BROWSER_ELEMENT_NOT_INTERACTABLE"',
    'if actionName is "setValue" then keystroke "a" using command down',
    'set value of attribute "AXSelectedText" of focusedElement to actionPayload',
    'else if actionName is "key" then',
    "key code (actionPayload as integer)",
    'else if actionName is "scroll" then',
    "if hasPoint then click at {pointX, pointY}",
    "key code (actionPayload as integer)",
    'else if actionName is "back" then',
    'keystroke "[" using command down',
    'else if actionName is "forward" then',
    'keystroke "]" using command down',
    'else if actionName is "reload" then',
    'keystroke "r" using command down',
    'else if actionName is "select" then',
    'if hasPoint is not true then return "unsupported"',
    "click at {pointX, pointY}",
    "delay 0.1",
    "keystroke actionPayload",
    "key code 36",
    "else",
    'return "unsupported"',
    "end if",
    "end tell",
    'return "performed"',
    "end run",
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
    'keystroke "n" using command down',
    "end tell",
    'return "created"',
    "end run",
  ].join("\n");
}

export function macBrowserNavigateWindowScript(): string {
  return [
    "on run argv",
    ...macBrowserAppleScriptTargetPrelude(),
    "set targetUrl to item 8 of argv",
    'if targetUrl does not start with "https://" and targetUrl does not start with "http://" then error "BROWSER_NAVIGATION_DENIED"',
    'keystroke "l" using command down',
    "delay 0.1",
    'set focusedElement to value of attribute "AXFocusedUIElement" of targetProcess',
    'set value of attribute "AXSelectedText" of focusedElement to targetUrl',
    "delay 0.1",
    "key code 36",
    "end tell",
    'return "navigating"',
    "end run",
  ].join("\n");
}

export function macBrowserCloseWindowScript(): string {
  return [
    "on run argv",
    ...macBrowserAppleScriptTargetPrelude(),
    'set closeButtons to every button of targetWindow whose subrole is "AXCloseButton"',
    'if (count of closeButtons) is not 1 then error "BROWSER_ACTION_NOT_SUPPORTED"',
    'perform action "AXPress" of item 1 of closeButtons',
    "end tell",
    'return "closed"',
    "end run",
  ].join("\n");
}
