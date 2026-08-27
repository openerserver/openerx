export interface MacDesktopAutomationResult {
  application: string;
  bundleId: string;
  processId: number;
  window: { x: number; y: number; width: number; height: number };
}

export interface MacDesktopCaptureTarget {
  application: string;
  bundleId: string;
  processId: number;
  windowId: number;
  windowTitle: string;
}

const keyCodes: Readonly<Record<string, number>> = {
  backspace: 51,
  delete: 117,
  down: 125,
  end: 119,
  enter: 36,
  escape: 53,
  home: 115,
  left: 123,
  pagedown: 121,
  pageup: 116,
  return: 36,
  right: 124,
  space: 49,
  tab: 48,
  up: 126,
};

export function macDesktopKeyCode(value: string): number {
  const key = value.trim().toLocaleLowerCase().replaceAll(/[-_ ]/gu, "");
  const code = keyCodes[key];
  if (code === undefined) throw new Error("DESKTOP_KEY_UNSUPPORTED");
  return code;
}

export function parseMacDesktopAutomationResult(output: string): MacDesktopAutomationResult {
  const [application, bundleId, processId, x, y, width, height, ...extra] = output
    .trim()
    .split("\t");
  const numbers = [processId, x, y, width, height].map(Number);
  if (
    !application ||
    !bundleId ||
    extra.length > 0 ||
    numbers.some((value) => !Number.isInteger(value)) ||
    (numbers[0] ?? 0) <= 0 ||
    (numbers[3] ?? 0) <= 0 ||
    (numbers[4] ?? 0) <= 0
  ) {
    throw new Error("DESKTOP_AUTOMATION_RESULT_INVALID");
  }
  return {
    application,
    bundleId,
    processId: numbers[0] ?? 0,
    window: {
      x: numbers[1] ?? 0,
      y: numbers[2] ?? 0,
      width: numbers[3] ?? 0,
      height: numbers[4] ?? 0,
    },
  };
}

export function parseMacDesktopCaptureTarget(output: string): MacDesktopCaptureTarget {
  let candidate: unknown;
  try {
    candidate = JSON.parse(output.trim());
  } catch {
    throw new Error("DESKTOP_CAPTURE_TARGET_INVALID");
  }
  if (!candidate || typeof candidate !== "object") {
    throw new Error("DESKTOP_CAPTURE_TARGET_INVALID");
  }
  const value = candidate as Record<string, unknown>;
  if (
    typeof value.application !== "string" ||
    !value.application.trim() ||
    typeof value.bundleId !== "string" ||
    !value.bundleId.trim() ||
    !Number.isInteger(value.processId) ||
    (value.processId as number) <= 0 ||
    !Number.isInteger(value.windowId) ||
    (value.windowId as number) <= 0 ||
    typeof value.windowTitle !== "string" ||
    !value.windowTitle.trim()
  ) {
    throw new Error("DESKTOP_CAPTURE_TARGET_INVALID");
  }
  return {
    application: value.application.trim().normalize("NFC"),
    bundleId: value.bundleId.trim(),
    processId: value.processId as number,
    windowId: value.windowId as number,
    windowTitle: value.windowTitle.trim().normalize("NFC"),
  };
}

export function macDesktopCaptureTargetScript(): string {
  return [
    "function run(argv) {",
    '  ObjC.import("AppKit");',
    '  ObjC.bindFunction("CGWindowListCopyWindowInfo", ["id", ["uint32", "uint32"]]);',
    '  const expectedBundleId = String(argv[0] || "");',
    "  const expectedWindowId = Number(argv[1] || 0);",
    '  if (!/^[A-Za-z0-9][A-Za-z0-9.-]+$/.test(expectedBundleId)) throw new Error("DESKTOP_BUNDLE_ID_INVALID");',
    '  if (!Number.isInteger(expectedWindowId) || expectedWindowId < 0) throw new Error("DESKTOP_WINDOW_ID_INVALID");',
    "  const windows = ObjC.deepUnwrap($.CGWindowListCopyWindowInfo(3, 0));",
    "  const matches = windows.flatMap((window) => {",
    "    if (Number(window.kCGWindowLayer) !== 0 || window.kCGWindowIsOnscreen !== true) return [];",
    "    const processId = Number(window.kCGWindowOwnerPID);",
    "    const application = $.NSRunningApplication.runningApplicationWithProcessIdentifier(processId);",
    "    if (!application) return [];",
    '    const bundleId = String(ObjC.unwrap(application.bundleIdentifier) || "");',
    "    if (bundleId !== expectedBundleId) return [];",
    "    if (expectedWindowId > 0 && Number(window.kCGWindowNumber) !== expectedWindowId) return [];",
    "    const bounds = window.kCGWindowBounds || {};",
    '    const windowTitle = String(window.kCGWindowName || "").trim();',
    "    if (!windowTitle || Number(bounds.Width) < 1 || Number(bounds.Height) < 1) return [];",
    '    return [{ application: String(window.kCGWindowOwnerName || "").trim(), bundleId, processId, windowId: Number(window.kCGWindowNumber), windowTitle }];',
    "  });",
    '  if (matches.length === 0) throw new Error(expectedWindowId > 0 ? "DESKTOP_TARGET_WINDOW_CHANGED" : "DESKTOP_TARGET_WINDOW_NOT_FOUND");',
    "  const processIds = [...new Set(matches.map(({ processId }) => processId))];",
    '  if (processIds.length !== 1) throw new Error("DESKTOP_TARGET_PROCESS_AMBIGUOUS");',
    "  return JSON.stringify(matches[0]);",
    "}",
  ].join("\n");
}

export function macDesktopAutomationScript(): string {
  return [
    "on run argv",
    "set expectedBundleId to item 1 of argv",
    "set expectedProcessId to item 2 of argv",
    "set expectedWindowName to item 3 of argv",
    "set actionName to item 4 of argv",
    "set actionPayload to item 5 of argv",
    "set captureX to item 6 of argv as integer",
    "set captureY to item 7 of argv as integer",
    "set captureWidth to item 8 of argv as integer",
    "set captureHeight to item 9 of argv as integer",
    'tell application "System Events"',
    "set matches to every application process whose unix id is (expectedProcessId as integer)",
    'if (count of matches) is 0 then error "DESKTOP_TARGET_PROCESS_NOT_FOUND"',
    'if (count of matches) is not 1 then error "DESKTOP_TARGET_PROCESS_AMBIGUOUS"',
    "set targetProcess to item 1 of matches",
    'if (bundle identifier of targetProcess as text) is not expectedBundleId then error "DESKTOP_TARGET_IDENTITY_MISMATCH"',
    "set frontmost of targetProcess to true",
    "delay 0.2",
    'if frontmost of targetProcess is not true then error "DESKTOP_TARGET_NOT_FRONTMOST"',
    'if (count of windows of targetProcess) is 0 then error "DESKTOP_TARGET_WINDOW_NOT_FOUND"',
    "set targetWindow to front window of targetProcess",
    "set actualWindowName to name of targetWindow as text",
    'if expectedWindowName is not "" and actualWindowName is not expectedWindowName then error "DESKTOP_TARGET_WINDOW_CHANGED"',
    "set windowPosition to position of targetWindow",
    "set windowSize to size of targetWindow",
    "set windowX to item 1 of windowPosition as integer",
    "set windowY to item 2 of windowPosition as integer",
    "set windowWidth to item 1 of windowSize as integer",
    "set windowHeight to item 2 of windowSize as integer",
    'if actionName is "type" then',
    "try",
    'set focusedElement to value of attribute "AXFocusedUIElement" of targetProcess',
    'set value of attribute "AXSelectedText" of focusedElement to actionPayload',
    "on error",
    'error "DESKTOP_TARGET_NOT_EDITABLE"',
    "end try",
    'else if actionName is "key" then',
    "key code (actionPayload as integer)",
    "else",
    'if captureWidth < 1 or captureHeight < 1 then error "DESKTOP_CAPTURE_DIMENSIONS_INVALID"',
    'if captureX < 0 or captureY < 0 or captureX is greater than or equal to captureWidth or captureY is greater than or equal to captureHeight then error "DESKTOP_COORDINATES_OUTSIDE_CAPTURE"',
    "set targetX to windowX + (captureX * windowWidth div captureWidth)",
    "set targetY to windowY + (captureY * windowHeight div captureHeight)",
    'if targetX < windowX or targetY < windowY or targetX is greater than or equal to (windowX + windowWidth) or targetY is greater than or equal to (windowY + windowHeight) then error "DESKTOP_COORDINATES_OUTSIDE_TARGET_WINDOW"',
    "click at {targetX, targetY}",
    "delay 0.1",
    "end if",
    "set processName to name of targetProcess as text",
    "set processBundleId to bundle identifier of targetProcess as text",
    "set processId to unix id of targetProcess as text",
    "end tell",
    "return processName & tab & processBundleId & tab & processId & tab & (windowX as text) & tab & (windowY as text) & tab & (windowWidth as text) & tab & (windowHeight as text)",
    "end run",
  ].join("\n");
}

export function macDesktopAutomationError(error: unknown): Error {
  const candidate = error as { message?: unknown; stderr?: unknown; stdout?: unknown };
  const details = [candidate.message, candidate.stderr, candidate.stdout]
    .filter((value): value is string => typeof value === "string")
    .join("\n");
  const code = /\bDESKTOP_[A-Z0-9_]{2,80}\b/u.exec(details)?.[0];
  return new Error(code ?? "DESKTOP_AUTOMATION_FAILED");
}
