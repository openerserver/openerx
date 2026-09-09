import AppKit
import ApplicationServices
import CoreGraphics
import Foundation

struct BrowserFailure: Error {
  let code: String
}

struct Bounds {
  let x: Int
  let y: Int
  let width: Int
  let height: Int

  var dictionary: [String: Any] {
    ["x": x, "y": y, "width": width, "height": height]
  }

  func matches(_ other: Bounds, tolerance: Int = 2) -> Bool {
    abs(x - other.x) <= tolerance && abs(y - other.y) <= tolerance
      && abs(width - other.width) <= tolerance && abs(height - other.height) <= tolerance
  }

  func contains(_ other: Bounds, tolerance: Int = 2) -> Bool {
    other.x >= x && other.y >= y && other.x + other.width <= x + width + tolerance
      && other.y + other.height <= y + height + tolerance
  }
}

struct NativeWindow {
  let applicationName: String
  let bundleId: String
  let processId: pid_t
  let windowId: CGWindowID
  let title: String
  let bounds: Bounds

  var dictionary: [String: Any] {
    [
      "applicationName": applicationName,
      "bundleId": bundleId,
      "processId": Int(processId),
      "windowId": Int(windowId),
      "title": title,
      "bounds": bounds.dictionary,
    ]
  }
}

func fail(_ code: String) throws -> Never {
  throw BrowserFailure(code: code)
}

func argument(_ values: [String], _ index: Int) throws -> String {
  guard values.indices.contains(index) else { try fail("BROWSER_OBSERVATION_MISMATCH") }
  return values[index]
}

func integerArgument(_ values: [String], _ index: Int) throws -> Int {
  guard let value = Int(try argument(values, index)) else {
    try fail("BROWSER_OBSERVATION_MISMATCH")
  }
  return value
}

func output(_ value: Any) throws {
  let data = try JSONSerialization.data(withJSONObject: value, options: [.sortedKeys])
  guard let text = String(data: data, encoding: .utf8) else {
    try fail("BROWSER_OBSERVATION_MISMATCH")
  }
  print(text)
}

func axValue(_ element: AXUIElement, _ attribute: String) -> CFTypeRef? {
  var value: CFTypeRef?
  guard AXUIElementCopyAttributeValue(element, attribute as CFString, &value) == .success else {
    return nil
  }
  return value
}

func axString(_ element: AXUIElement, _ attribute: String) -> String? {
  if let value = axValue(element, attribute) as? String { return value }
  if let value = axValue(element, attribute) as? URL { return value.absoluteString }
  return nil
}

func axBool(_ element: AXUIElement, _ attribute: String) -> Bool? {
  if let value = axValue(element, attribute) as? Bool { return value }
  if let value = axValue(element, attribute) as? NSNumber { return value.boolValue }
  return nil
}

func axDouble(_ element: AXUIElement, _ attribute: String) -> Double? {
  if let value = axValue(element, attribute) as? NSNumber { return value.doubleValue }
  return nil
}

func axRange(_ element: AXUIElement, _ attribute: String) -> CFRange? {
  guard let value = axValue(element, attribute), CFGetTypeID(value) == AXValueGetTypeID() else {
    return nil
  }
  var range = CFRange()
  guard AXValueGetValue(value as! AXValue, .cfRange, &range) else { return nil }
  return range
}

func axElements(_ element: AXUIElement, _ attribute: String) -> [AXUIElement] {
  guard let value = axValue(element, attribute), CFGetTypeID(value) == CFArrayGetTypeID() else {
    return []
  }
  let array = unsafeBitCast(value, to: CFArray.self)
  return (0..<CFArrayGetCount(array)).compactMap { index in
    guard let pointer = CFArrayGetValueAtIndex(array, index) else { return nil }
    let candidate = Unmanaged<AnyObject>.fromOpaque(pointer).takeUnretainedValue()
    guard CFGetTypeID(candidate) == AXUIElementGetTypeID() else { return nil }
    return unsafeBitCast(candidate, to: AXUIElement.self)
  }
}

func axElement(_ element: AXUIElement, _ attribute: String) -> AXUIElement? {
  guard let value = axValue(element, attribute) else { return nil }
  guard CFGetTypeID(value) == AXUIElementGetTypeID() else { return nil }
  return unsafeBitCast(value, to: AXUIElement.self)
}

func axBounds(_ element: AXUIElement) -> Bounds? {
  guard
    let positionValue = axValue(element, kAXPositionAttribute),
    let sizeValue = axValue(element, kAXSizeAttribute),
    CFGetTypeID(positionValue) == AXValueGetTypeID(),
    CFGetTypeID(sizeValue) == AXValueGetTypeID()
  else { return nil }
  var point = CGPoint.zero
  var size = CGSize.zero
  guard
    AXValueGetValue(positionValue as! AXValue, .cgPoint, &point),
    AXValueGetValue(sizeValue as! AXValue, .cgSize, &size)
  else { return nil }
  return Bounds(
    x: Int(point.x.rounded()),
    y: Int(point.y.rounded()),
    width: Int(size.width.rounded()),
    height: Int(size.height.rounded())
  )
}

func setBounds(_ element: AXUIElement, _ bounds: Bounds) throws {
  var point = CGPoint(x: bounds.x, y: bounds.y)
  var size = CGSize(width: bounds.width, height: bounds.height)
  guard
    let pointValue = AXValueCreate(.cgPoint, &point),
    let sizeValue = AXValueCreate(.cgSize, &size)
  else { try fail("BROWSER_SURFACE_NOT_BOUND") }
  for _ in 0..<4 {
    guard AXUIElementSetAttributeValue(element, kAXSizeAttribute as CFString, sizeValue) == .success
    else { try fail("BROWSER_SURFACE_NOT_BOUND") }
    Thread.sleep(forTimeInterval: 0.08)
    guard AXUIElementSetAttributeValue(element, kAXPositionAttribute as CFString, pointValue) == .success
    else { try fail("BROWSER_SURFACE_NOT_BOUND") }
    Thread.sleep(forTimeInterval: 0.08)
    if axBounds(element)?.matches(bounds) == true { return }
  }
  try fail("BROWSER_SURFACE_NOT_BOUND")
}

func nativeWindow(processId: pid_t, windowId: CGWindowID) throws -> NativeWindow {
  guard
    let rows = CGWindowListCopyWindowInfo(
      [.optionAll, .excludeDesktopElements],
      kCGNullWindowID
    ) as? [[String: Any]]
  else { try fail("BROWSER_SURFACE_NOT_BOUND") }
  let matches = rows.filter { row in
    (row[kCGWindowNumber as String] as? NSNumber)?.uint32Value == windowId
      && (row[kCGWindowOwnerPID as String] as? NSNumber)?.int32Value == processId
      && (row[kCGWindowLayer as String] as? NSNumber)?.intValue == 0
  }
  guard matches.count == 1, let row = matches.first else {
    try fail("BROWSER_SURFACE_NOT_BOUND")
  }
  let boundsDictionary = row[kCGWindowBounds as String] as! CFDictionary
  guard
    let rectangle = CGRect(dictionaryRepresentation: boundsDictionary),
    rectangle.width >= 1,
    rectangle.height >= 1,
    let running = NSRunningApplication(processIdentifier: processId),
    let bundleId = running.bundleIdentifier
  else { try fail("BROWSER_SURFACE_MISMATCH") }
  return NativeWindow(
    applicationName: (row[kCGWindowOwnerName as String] as? String) ?? "",
    bundleId: bundleId,
    processId: processId,
    windowId: windowId,
    title: (row[kCGWindowName as String] as? String) ?? "",
    bounds: Bounds(
      x: Int(rectangle.origin.x.rounded()),
      y: Int(rectangle.origin.y.rounded()),
      width: Int(rectangle.width.rounded()),
      height: Int(rectangle.height.rounded())
    )
  )
}

func application(_ processId: pid_t) throws -> AXUIElement {
  guard AXIsProcessTrusted() else { try fail("BROWSER_BRIDGE_AUTHORIZATION_REQUIRED") }
  let app = AXUIElementCreateApplication(processId)
  // Chromium exposes page nodes on demand to accessibility clients.
  // Request that tree before observing a newly created browser window.
  _ = AXUIElementSetAttributeValue(app, "AXManualAccessibility" as CFString, kCFBooleanTrue)
  return app
}

func applicationWindows(_ app: AXUIElement) -> [AXUIElement] {
  let declared = axElements(app, kAXWindowsAttribute)
  if !declared.isEmpty { return declared }
  return axElements(app, kAXChildrenAttribute).filter {
    axString($0, kAXRoleAttribute) == kAXWindowRole
  }
}

func exactWindow(_ native: NativeWindow) throws -> (AXUIElement, AXUIElement) {
  let app = try application(native.processId)
  var candidates = applicationWindows(app)
  if candidates.isEmpty, let focused = axElement(app, kAXFocusedWindowAttribute) {
    candidates = [focused]
  }
  let matches = candidates.filter { window in
    axString(window, kAXRoleAttribute) == kAXWindowRole
      && axString(window, kAXSubroleAttribute) == kAXStandardWindowSubrole
      && axBounds(window)?.matches(native.bounds) == true
  }
  guard matches.count == 1, let window = matches.first else {
    try fail("BROWSER_SURFACE_NOT_BOUND")
  }
  return (app, window)
}

func activate(_ native: NativeWindow, _ window: AXUIElement) throws {
  guard AXUIElementPerformAction(window, kAXRaiseAction as CFString) == .success else {
    try fail("BROWSER_SURFACE_NOT_BOUND")
  }
  guard let running = NSRunningApplication(processIdentifier: native.processId) else {
    try fail("BROWSER_SURFACE_MISMATCH")
  }
  _ = running.activate(options: [])
  Thread.sleep(forTimeInterval: 0.08)
  guard NSWorkspace.shared.frontmostApplication?.processIdentifier == native.processId else {
    try fail("BROWSER_SURFACE_NOT_BOUND")
  }
}

final class BrowserInputMonitorContext {
  let processId: pid_t
  let windowId: CGWindowID
  let runLoop: CFRunLoop
  var eventTap: CFMachPort?
  var reported = false

  init(processId: pid_t, windowId: CGWindowID, runLoop: CFRunLoop) {
    self.processId = processId
    self.windowId = windowId
    self.runLoop = runLoop
  }
}

func topmostWindow(at point: CGPoint) -> (pid_t, CGWindowID)? {
  guard
    let rows = CGWindowListCopyWindowInfo(
      [.optionOnScreenOnly, .excludeDesktopElements],
      kCGNullWindowID
    ) as? [[String: Any]]
  else { return nil }
  for row in rows {
    guard (row[kCGWindowLayer as String] as? NSNumber)?.intValue == 0,
      ((row[kCGWindowAlpha as String] as? NSNumber)?.doubleValue ?? 1) > 0,
      let processId = (row[kCGWindowOwnerPID as String] as? NSNumber)?.int32Value,
      let windowId = (row[kCGWindowNumber as String] as? NSNumber)?.uint32Value,
      let rawBounds = row[kCGWindowBounds as String],
      let bounds = CGRect(dictionaryRepresentation: rawBounds as! CFDictionary),
      bounds.contains(point)
    else { continue }
    return (processId, windowId)
  }
  return nil
}

func exactWindowHasKeyboardFocus(processId: pid_t, windowId: CGWindowID) -> Bool {
  guard NSWorkspace.shared.frontmostApplication?.processIdentifier == processId,
    let native = try? nativeWindow(processId: processId, windowId: windowId),
    let (app, targetWindow) = try? exactWindow(native),
    let focusedWindow = axElement(app, kAXFocusedWindowAttribute)
  else { return false }
  return CFEqual(focusedWindow, targetWindow)
}

func browserInputEventCallback(
  proxy _: CGEventTapProxy,
  type: CGEventType,
  event: CGEvent,
  userInfo: UnsafeMutableRawPointer?
) -> Unmanaged<CGEvent>? {
  guard let userInfo else { return Unmanaged.passUnretained(event) }
  let context = Unmanaged<BrowserInputMonitorContext>
    .fromOpaque(userInfo).takeUnretainedValue()
  if type == .tapDisabledByTimeout || type == .tapDisabledByUserInput {
    if let eventTap = context.eventTap { CGEvent.tapEnable(tap: eventTap, enable: true) }
    return Unmanaged.passUnretained(event)
  }
  if context.reported { return Unmanaged.passUnretained(event) }

  let belongsToTarget: Bool
  switch type {
  case .leftMouseDown, .rightMouseDown, .otherMouseDown, .scrollWheel:
    let target = topmostWindow(at: event.location)
    belongsToTarget = target?.0 == context.processId && target?.1 == context.windowId
  case .keyDown, .flagsChanged:
    belongsToTarget = exactWindowHasKeyboardFocus(
      processId: context.processId,
      windowId: context.windowId
    )
  default:
    belongsToTarget = false
  }
  if belongsToTarget {
    context.reported = true
    FileHandle.standardOutput.write(Data("user_input\n".utf8))
    CFRunLoopStop(context.runLoop)
  }
  return Unmanaged.passUnretained(event)
}

func monitorUserInput(_ native: NativeWindow) throws {
  _ = try exactWindow(native)
  let eventTypes: [CGEventType] = [
    .leftMouseDown, .rightMouseDown, .otherMouseDown, .scrollWheel, .keyDown, .flagsChanged,
  ]
  let mask = eventTypes.reduce(CGEventMask(0)) {
    $0 | (CGEventMask(1) << $1.rawValue)
  }
  guard let runLoop = CFRunLoopGetCurrent() else {
    try fail("BROWSER_BACKEND_UNAVAILABLE")
  }
  let context = BrowserInputMonitorContext(
    processId: native.processId,
    windowId: native.windowId,
    runLoop: runLoop
  )
  guard let eventTap = CGEvent.tapCreate(
    tap: .cgSessionEventTap,
    place: .headInsertEventTap,
    options: .listenOnly,
    eventsOfInterest: mask,
    callback: browserInputEventCallback,
    userInfo: Unmanaged.passUnretained(context).toOpaque()
  ), let source = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, eventTap, 0)
  else { try fail("BROWSER_BRIDGE_AUTHORIZATION_REQUIRED") }
  context.eventTap = eventTap
  CFRunLoopAddSource(runLoop, source, .commonModes)
  CGEvent.tapEnable(tap: eventTap, enable: true)
  FileHandle.standardOutput.write(Data("ready\n".utf8))
  CFRunLoopRun()
  CFRunLoopRemoveSource(runLoop, source, .commonModes)
  if !context.reported { try fail("BROWSER_BACKEND_UNAVAILABLE") }
}

func elementAtPosition(_ app: AXUIElement, x: Int, y: Int) -> AXUIElement? {
  var element: AXUIElement?
  guard AXUIElementCopyElementAtPosition(app, Float(x), Float(y), &element) == .success else {
    return nil
  }
  return element
}

func interactiveElement(_ app: AXUIElement, x: Int, y: Int) -> AXUIElement? {
  var candidate = elementAtPosition(app, x: x, y: y)
  for _ in 0..<8 {
    guard let element = candidate else { return nil }
    let role = axString(element, kAXRoleAttribute) ?? ""
    let subrole = axString(element, kAXSubroleAttribute) ?? ""
    let editable = [kAXTextFieldRole, kAXTextAreaRole, kAXComboBoxRole, "AXSecureTextField"]
      .contains(role) || subrole == "AXSearchField"
    if editable || actionNames(element).contains(kAXPressAction) { return element }
    candidate = axElement(element, kAXParentAttribute)
  }
  return nil
}

func descendants(_ root: AXUIElement, maximum: Int = 5_000) -> [AXUIElement] {
  var result: [AXUIElement] = []
  func visit(_ element: AXUIElement, depth: Int) {
    if result.count >= maximum || depth > 80 { return }
    for child in axElements(element, kAXChildrenAttribute) {
      if result.count >= maximum { return }
      result.append(child)
      visit(child, depth: depth + 1)
    }
  }
  visit(root, depth: 0)
  return result
}

func roleName(_ role: String, _ subrole: String) -> String? {
  if subrole == "AXSearchField" { return "searchbox" }
  return [
    kAXTextFieldRole: "textbox",
    kAXTextAreaRole: "textbox",
    kAXButtonRole: "button",
    "AXLink": "link",
    kAXCheckBoxRole: "checkbox",
    kAXRadioButtonRole: "radio",
    kAXPopUpButtonRole: "combobox",
    kAXComboBoxRole: "combobox",
    kAXHeadingRole: "heading",
    kAXStaticTextRole: "text",
    kAXImageRole: "image",
  ][role]
}

func textValue(_ value: CFTypeRef?) -> String? {
  if let value = value as? String { return value }
  if let value = value as? NSNumber { return value.stringValue }
  if let value = value as? URL { return value.absoluteString }
  return nil
}

func sensitivity(role: String, subrole: String, name: String) -> String {
  if role == "AXSecureTextField" || subrole == "AXSecureTextField" { return "password" }
  if name.range(
    of: "card|credit|debit|cvv|cvc|payment|银行卡|信用卡|支付",
    options: [.regularExpression, .caseInsensitive]
  ) != nil { return "payment" }
  if name.range(
    of: "password|passcode|one.?time|otp|verification code|密码|验证码|口令",
    options: [.regularExpression, .caseInsensitive]
  ) != nil { return "authentication" }
  return "none"
}

func actionNames(_ element: AXUIElement) -> [String] {
  var names: CFArray?
  guard AXUIElementCopyActionNames(element, &names) == .success else { return [] }
  return (names as? [String]) ?? []
}

func semanticName(_ element: AXUIElement, mappedRole: String) -> String {
  let rawValue = textValue(axValue(element, kAXValueAttribute))
  let title = axString(element, kAXTitleAttribute) ?? ""
  let description = axString(element, kAXDescriptionAttribute) ?? ""
  return String(
    (
      title.isEmpty
        ? (description.isEmpty ? (mappedRole == "text" ? rawValue ?? mappedRole : mappedRole) : description)
        : title
    ).prefix(500)
  )
}

func semanticElement(
  _ element: AXUIElement,
  index: Int,
  webBounds: Bounds
) -> [String: Any]? {
  let role = axString(element, kAXRoleAttribute) ?? ""
  let subrole = axString(element, kAXSubroleAttribute) ?? ""
  guard let mappedRole = roleName(role, subrole), let absolute = axBounds(element) else {
    return nil
  }
  guard absolute.width > 0, absolute.height > 0, webBounds.contains(absolute) else { return nil }
  let rawValue = textValue(axValue(element, kAXValueAttribute))
  let name = semanticName(element, mappedRole: mappedRole)
  let sensitive = sensitivity(role: role, subrole: subrole, name: name)
  let editable = [kAXTextFieldRole, kAXTextAreaRole, kAXComboBoxRole, "AXSecureTextField"].contains(role)
    || subrole == "AXSearchField"
  let nativeActions = actionNames(element)
  var actions: [String] = []
  if editable || nativeActions.contains(kAXPressAction) { actions.append("focus") }
  if editable && sensitive == "none" { actions.append("setValue") }
  if nativeActions.contains(kAXPressAction) { actions.append("invoke") }
  if [kAXPopUpButtonRole, kAXComboBoxRole].contains(role) { actions.append("select") }
  let checked: Any = [kAXCheckBoxRole, kAXRadioButtonRole].contains(role)
    ? (axBool(element, kAXValueAttribute) ?? false) : NSNull()
  let selected: Any = axBool(element, kAXSelectedAttribute).map { $0 as Any } ?? NSNull()
  let expanded: Any = axBool(element, kAXExpandedAttribute).map { $0 as Any } ?? NSNull()
  return [
    "sourceNodeId": "ax_\(index)",
    "role": mappedRole,
    "name": name,
    "value": sensitive == "none" ? (rawValue.map { String($0.prefix(2_000)) } ?? NSNull()) : NSNull(),
    "sensitiveKind": sensitive,
    "visible": true,
    "state": [
      "disabled": !(axBool(element, kAXEnabledAttribute) ?? true),
      "checked": checked,
      "selected": selected,
      "expanded": expanded,
      "focused": (axBool(element, kAXFocusedAttribute) ?? false) as Bool,
      "editable": editable,
    ],
    "bounds": [
      "x": absolute.x - webBounds.x,
      "y": absolute.y - webBounds.y,
      "width": absolute.width,
      "height": absolute.height,
    ],
    "actions": actions,
  ]
}

func observe(_ native: NativeWindow) throws -> [String: Any] {
  let (_, window) = try exactWindow(native)
  let contents = descendants(window)
  let webAreas = contents.enumerated().compactMap { index, element -> (Int, AXUIElement, Bounds)? in
    guard axString(element, kAXRoleAttribute) == "AXWebArea", let bounds = axBounds(element) else {
      return nil
    }
    return (index, element, bounds)
  }.sorted { left, right in
    left.2.width * left.2.height > right.2.width * right.2.height
  }
  guard let webArea = webAreas.first else { try fail("BROWSER_OBSERVATION_REQUIRED") }
  let elements = contents.enumerated().compactMap { index, element in
    semanticElement(element, index: index, webBounds: webArea.2)
  }
  let document = axString(window, kAXDocumentAttribute)
    ?? textValue(axValue(webArea.1, kAXURLAttribute))
    ?? ""
  guard let url = URL(string: document), ["http", "https"].contains(url.scheme?.lowercased() ?? "")
  else { try fail("BROWSER_NAVIGATION_DENIED") }
  let title = axString(window, kAXTitleAttribute) ?? native.title
  return [
    "target": [
      "applicationName": native.applicationName,
      "bundleId": native.bundleId,
      "processId": Int(native.processId),
      "windowId": Int(native.windowId),
      "title": title,
      "bounds": native.bounds.dictionary,
    ],
    "url": url.absoluteString,
    "title": title,
    "webAreaBounds": webArea.2.dictionary,
    "elements": elements,
  ]
}

func decodePayload(_ value: String) throws -> String {
  guard let data = Data(base64Encoded: value), let text = String(data: data, encoding: .utf8) else {
    try fail("BROWSER_OBSERVATION_MISMATCH")
  }
  return text
}

func setAttribute(_ element: AXUIElement, _ name: String, _ value: CFTypeRef) -> Bool {
  AXUIElementSetAttributeValue(element, name as CFString, value) == .success
}

func setRange(_ element: AXUIElement, _ name: String, _ range: CFRange) -> Bool {
  var mutableRange = range
  guard let value = AXValueCreate(.cfRange, &mutableRange) else { return false }
  return setAttribute(element, name, value)
}

func primaryWebArea(_ contents: [AXUIElement], matching expected: Bounds) -> AXUIElement? {
  let matches = contents.filter {
    axString($0, kAXRoleAttribute) == "AXWebArea"
      && axBounds($0)?.matches(expected, tolerance: 3) == true
  }
  return matches.count == 1 ? matches.first : nil
}

func focusedElementInside(_ app: AXUIElement, webBounds: Bounds) -> AXUIElement? {
  guard let focused = axElement(app, kAXFocusedUIElementAttribute),
    let bounds = axBounds(focused), webBounds.contains(bounds)
  else { return nil }
  return focused
}

func focusedEditableElement(_ app: AXUIElement, webBounds: Bounds) throws -> AXUIElement? {
  guard let focused = focusedElementInside(app, webBounds: webBounds) else { return nil }
  let role = axString(focused, kAXRoleAttribute) ?? ""
  let subrole = axString(focused, kAXSubroleAttribute) ?? ""
  let editable = [kAXTextFieldRole, kAXTextAreaRole, kAXComboBoxRole, "AXSecureTextField"]
    .contains(role) || subrole == "AXSearchField"
  guard editable else { return nil }
  let name = semanticName(focused, mappedRole: roleName(role, subrole) ?? "")
  guard sensitivity(role: role, subrole: subrole, name: name) == "none" else {
    try fail("BROWSER_USER_TAKEOVER_REQUIRED")
  }
  return focused
}

func performTextKey(_ element: AXUIElement, key: String) -> Bool {
  guard let value = textValue(axValue(element, kAXValueAttribute)) else { return false }
  let text = value as NSString
  let selected = axRange(element, kAXSelectedTextRangeAttribute)
    ?? CFRange(location: text.length, length: 0)
  guard selected.location >= 0, selected.length >= 0,
    selected.location + selected.length <= text.length
  else { return false }

  if ["left", "right", "home", "end"].contains(key) {
    let location: Int
    switch key {
    case "home":
      location = 0
    case "end":
      location = text.length
    case "left":
      if selected.length > 0 {
        location = selected.location
      } else if selected.location > 0 {
        location = text.rangeOfComposedCharacterSequence(at: selected.location - 1).location
      } else {
        location = 0
      }
    default:
      if selected.length > 0 {
        location = selected.location + selected.length
      } else if selected.location < text.length {
        let range = text.rangeOfComposedCharacterSequence(at: selected.location)
        location = range.location + range.length
      } else {
        location = text.length
      }
    }
    return setRange(element, kAXSelectedTextRangeAttribute, CFRange(location: location, length: 0))
  }

  let replacement: String
  let replacedRange: NSRange
  switch key {
  case "space":
    replacement = " "
    replacedRange = NSRange(location: selected.location, length: selected.length)
  case "backspace":
    replacement = ""
    if selected.length > 0 {
      replacedRange = NSRange(location: selected.location, length: selected.length)
    } else if selected.location > 0 {
      replacedRange = text.rangeOfComposedCharacterSequence(at: selected.location - 1)
    } else {
      return true
    }
  case "delete":
    replacement = ""
    if selected.length > 0 {
      replacedRange = NSRange(location: selected.location, length: selected.length)
    } else if selected.location < text.length {
      replacedRange = text.rangeOfComposedCharacterSequence(at: selected.location)
    } else {
      return true
    }
  default:
    return false
  }
  let updated = text.replacingCharacters(in: replacedRange, with: replacement)
  guard setAttribute(element, kAXValueAttribute, updated as CFString) else { return false }
  let location = replacedRange.location + (replacement as NSString).length
  _ = setRange(element, kAXSelectedTextRangeAttribute, CFRange(location: location, length: 0))
  return true
}

func mainScrollBar(
  contents: [AXUIElement],
  webArea: AXUIElement,
  direction: String
) -> AXUIElement? {
  let attribute = ["up", "down"].contains(direction)
    ? kAXVerticalScrollBarAttribute : kAXHorizontalScrollBarAttribute
  var ancestor: AXUIElement? = webArea
  for _ in 0..<12 {
    guard let candidate = ancestor else { break }
    if let scrollBar = axElement(candidate, attribute) { return scrollBar }
    ancestor = axElement(candidate, kAXParentAttribute)
  }
  let orientation = ["up", "down"].contains(direction)
    ? kAXVerticalOrientationValue : kAXHorizontalOrientationValue
  let matches = contents.filter {
    axString($0, kAXRoleAttribute) == kAXScrollBarRole
      && axString($0, kAXOrientationAttribute) == orientation
  }
  return matches.count == 1 ? matches.first : nil
}

func performScrollToVisible(
  contents: [AXUIElement],
  webArea: AXUIElement,
  direction: String
) -> Bool {
  guard let webBounds = axBounds(webArea) else { return false }
  let vertical = ["up", "down"].contains(direction)
  let increasing = ["down", "right"].contains(direction)
  let candidates = contents.enumerated().compactMap { index, element -> (Int, AXUIElement, Bounds, Bool)? in
    guard element !== webArea, actionNames(element).contains("AXScrollToVisible"),
      let bounds = axBounds(element)
    else { return nil }
    let clipped: Bool
    let atEdge: Bool
    if vertical {
      clipped = bounds.height <= 1
      atEdge = increasing
        ? bounds.y + bounds.height >= webBounds.y + webBounds.height - 2
        : bounds.y <= webBounds.y + 2
    } else {
      clipped = bounds.width <= 1
      atEdge = increasing
        ? bounds.x + bounds.width >= webBounds.x + webBounds.width - 2
        : bounds.x <= webBounds.x + 2
    }
    return atEdge ? (index, element, bounds, clipped) : nil
  }.sorted { left, right in
    if left.3 != right.3 { return left.3 && !right.3 }
    return increasing ? left.0 > right.0 : left.0 < right.0
  }
  guard let target = candidates.first else { return false }
  guard AXUIElementPerformAction(target.1, "AXScrollToVisible" as CFString) == .success else {
    return false
  }
  Thread.sleep(forTimeInterval: 0.2)
  guard let after = axBounds(target.1) else { return false }
  return !target.2.matches(after, tolerance: 1)
}

func performScroll(
  contents: [AXUIElement],
  webArea: AXUIElement,
  payload: String
) -> Bool {
  let parts = payload.split(separator: ":", omittingEmptySubsequences: false).map(String.init)
  guard parts.count == 2 else { return false }
  let direction = parts[0]
  let distance = parts[1]
  guard ["up", "down", "left", "right"].contains(direction),
    ["small", "medium", "viewport", "edge"].contains(distance)
  else { return false }
  guard let scrollBar = mainScrollBar(contents: contents, webArea: webArea, direction: direction),
    axBool(scrollBar, kAXEnabledAttribute) != false,
    let before = axDouble(scrollBar, kAXValueAttribute),
    let minimum = axDouble(scrollBar, kAXMinValueAttribute),
    let maximum = axDouble(scrollBar, kAXMaxValueAttribute),
    maximum > minimum
  else {
    return performScrollToVisible(contents: contents, webArea: webArea, direction: direction)
  }
  let increasing = ["down", "right"].contains(direction)
  let fraction: Double = switch distance {
  case "small": 0.1
  case "medium": 0.35
  case "viewport": 0.8
  default: 1
  }
  let desired = distance == "edge"
    ? (increasing ? maximum : minimum)
    : min(maximum, max(minimum, before + (increasing ? 1 : -1) * (maximum - minimum) * fraction))
  if abs(desired - before) < 0.000_001 { return true }
  guard setAttribute(scrollBar, kAXValueAttribute, NSNumber(value: desired)) else { return false }
  Thread.sleep(forTimeInterval: 0.12)
  guard let after = axDouble(scrollBar, kAXValueAttribute) else { return false }
  return increasing ? after > before : after < before
}

func performMenuShortcut(
  _ app: AXUIElement,
  character: String,
  virtualKey: Int
) -> Bool {
  guard let menuBar = axElement(app, kAXMenuBarAttribute) else { return false }
  let candidates = descendants(menuBar, maximum: 2_000).filter { element in
    guard axString(element, kAXRoleAttribute) == kAXMenuItemRole,
      axBool(element, kAXEnabledAttribute) != false
    else { return false }
    let modifiers = (axValue(element, kAXMenuItemCmdModifiersAttribute) as? NSNumber)?.intValue ?? 0
    guard modifiers == 0 else { return false }
    let commandCharacter = (axString(element, kAXMenuItemCmdCharAttribute) ?? "").lowercased()
    let commandVirtualKey = (axValue(element, kAXMenuItemCmdVirtualKeyAttribute) as? NSNumber)?.intValue
    return commandCharacter == character.lowercased() || commandVirtualKey == virtualKey
  }
  guard candidates.count == 1,
    AXUIElementPerformAction(candidates[0], kAXPressAction as CFString) == .success
  else { return false }
  Thread.sleep(forTimeInterval: 0.3)
  return true
}

func performNamedKey(
  app: AXUIElement,
  contents: [AXUIElement],
  webArea: AXUIElement,
  webBounds: Bounds,
  key: String
) throws -> Bool {
  guard [
    "backspace", "delete", "down", "end", "enter", "home", "left", "pagedown",
    "pageup", "right", "space", "up",
  ].contains(key) else { return false }
  if let editable = try focusedEditableElement(app, webBounds: webBounds) {
    if key == "enter" {
      if AXUIElementPerformAction(editable, kAXConfirmAction as CFString) == .success { return true }
      return AXUIElementPerformAction(editable, kAXPressAction as CFString) == .success
    }
    if ["backspace", "delete", "home", "left", "right", "space", "end"].contains(key) {
      return performTextKey(editable, key: key)
    }
    return false
  }
  if key == "enter", let focused = focusedElementInside(app, webBounds: webBounds) {
    let role = axString(focused, kAXRoleAttribute) ?? ""
    let subrole = axString(focused, kAXSubroleAttribute) ?? ""
    let name = semanticName(focused, mappedRole: roleName(role, subrole) ?? "")
    guard sensitivity(role: role, subrole: subrole, name: name) == "none" else {
      try fail("BROWSER_USER_TAKEOVER_REQUIRED")
    }
    if AXUIElementPerformAction(focused, kAXConfirmAction as CFString) == .success { return true }
    return AXUIElementPerformAction(focused, kAXPressAction as CFString) == .success
  }
  let scrollPayload: String = switch key {
  case "up": "up:small"
  case "down": "down:small"
  case "left": "left:small"
  case "right": "right:small"
  case "pageup": "up:viewport"
  case "pagedown", "space": "down:viewport"
  case "home": "up:edge"
  case "end": "down:edge"
  default: ""
  }
  return !scrollPayload.isEmpty
    && performScroll(contents: contents, webArea: webArea, payload: scrollPayload)
}

func run(_ values: [String]) throws {
  let command = try argument(values, 0)
  let processId = pid_t(try integerArgument(values, 1))
  let windowId = CGWindowID(try integerArgument(values, 2))
  let native = try nativeWindow(processId: processId, windowId: windowId)

  #if DEBUG
  if command == "diagnose" {
    _ = NSRunningApplication(processIdentifier: processId)?.activate(options: [])
    Thread.sleep(forTimeInterval: 0.2)
    let app = try application(processId)
    var rawWindows: CFTypeRef?
    let windowsError = AXUIElementCopyAttributeValue(
      app,
      kAXWindowsAttribute as CFString,
      &rawWindows
    )
    var rawFocusedWindow: CFTypeRef?
    let focusedWindowError = AXUIElementCopyAttributeValue(
      app,
      kAXFocusedWindowAttribute as CFString,
      &rawFocusedWindow
    )
    let windows = applicationWindows(app)
    try output([
      "nativeBounds": native.bounds.dictionary,
      "windowsError": windowsError.rawValue,
      "windowsType": rawWindows.map { CFGetTypeID($0) } ?? 0,
      "arrayType": CFArrayGetTypeID(),
      "rawWindowCount": rawWindows.map {
        CFArrayGetCount(unsafeBitCast($0, to: CFArray.self))
      } ?? 0,
      "focusedWindowError": focusedWindowError.rawValue,
      "focusedWindowBounds": rawFocusedWindow.flatMap {
        guard CFGetTypeID($0) == AXUIElementGetTypeID() else { return nil }
        return axBounds(unsafeBitCast($0, to: AXUIElement.self))?.dictionary
      } ?? [:],
      "windows": windows.map { window in
        [
          "role": axString(window, kAXRoleAttribute) ?? "",
          "subrole": axString(window, kAXSubroleAttribute) ?? "",
          "bounds": axBounds(window)?.dictionary ?? [:],
        ] as [String: Any]
      },
    ])
    return
  }
  if command == "diagnose-focused" {
    let app = try application(processId)
    guard let focused = axElement(app, kAXFocusedUIElementAttribute) else {
      try fail("BROWSER_ELEMENT_NOT_INTERACTABLE")
    }
    try output([
      "role": axString(focused, kAXRoleAttribute) ?? "",
      "subrole": axString(focused, kAXSubroleAttribute) ?? "",
      "actions": actionNames(focused),
      "bounds": axBounds(focused)?.dictionary ?? [:],
    ])
    return
  }
  if command == "diagnose-scroll" {
    let (_, window) = try exactWindow(native)
    let contents = descendants(window)
    let webAreas = contents.filter {
      axString($0, kAXRoleAttribute) == "AXWebArea" && axBounds($0) != nil
    }.sorted {
      let left = axBounds($0)!
      let right = axBounds($1)!
      return left.width * left.height > right.width * right.height
    }
    guard let webArea = webAreas.first else { try fail("BROWSER_OBSERVATION_REQUIRED") }
    func attributeNames(_ element: AXUIElement) -> [String] {
      var names: CFArray?
      guard AXUIElementCopyAttributeNames(element, &names) == .success else { return [] }
      return (names as? [String]) ?? []
    }
    var ancestors: [[String: Any]] = []
    var ancestor: AXUIElement? = webArea
    for _ in 0..<12 {
      guard let candidate = ancestor else { break }
      ancestors.append([
        "role": axString(candidate, kAXRoleAttribute) ?? "",
        "subrole": axString(candidate, kAXSubroleAttribute) ?? "",
        "bounds": axBounds(candidate)?.dictionary ?? [:],
        "actions": actionNames(candidate),
        "attributes": attributeNames(candidate),
      ])
      ancestor = axElement(candidate, kAXParentAttribute)
    }
    let scrollBars = contents.filter {
      axString($0, kAXRoleAttribute) == kAXScrollBarRole
    }.map { element in
      [
        "bounds": axBounds(element)?.dictionary ?? [:],
        "orientation": axString(element, kAXOrientationAttribute) ?? "",
        "value": axDouble(element, kAXValueAttribute) ?? -1,
        "minimum": axDouble(element, kAXMinValueAttribute) ?? -1,
        "maximum": axDouble(element, kAXMaxValueAttribute) ?? -1,
        "actions": actionNames(element),
        "attributes": attributeNames(element),
      ] as [String: Any]
    }
    let scrollTargets = contents.compactMap { element -> [String: Any]? in
      guard actionNames(element).contains("AXScrollToVisible"), let bounds = axBounds(element)
      else { return nil }
      return [
        "role": axString(element, kAXRoleAttribute) ?? "",
        "bounds": bounds.dictionary,
      ]
    }
    try output([
      "ancestors": ancestors,
      "scrollBars": scrollBars,
      "scrollTargets": Array(scrollTargets.prefix(100)),
      "scrollTargetCount": scrollTargets.count,
    ])
    return
  }
  #endif

  if command == "isolate" {
    let (_, window) = try exactWindow(native)
    let bounds = Bounds(
      x: try integerArgument(values, 3),
      y: try integerArgument(values, 4),
      width: try integerArgument(values, 5),
      height: try integerArgument(values, 6)
    )
    guard bounds.width >= 400, bounds.height >= 300 else { try fail("BROWSER_SURFACE_NOT_BOUND") }
    try setBounds(window, bounds)
    print("isolated")
    return
  }

  if command == "observe" {
    try output(observe(native))
    return
  }

  if command == "verify" {
    _ = try exactWindow(native)
    print("verified")
    return
  }

  if command == "monitor-user-input" {
    try monitorUserInput(native)
    return
  }

  let (app, window) = try exactWindow(native)
  try activate(native, window)

  if command == "create-window" {
    print(performMenuShortcut(app, character: "n", virtualKey: 45)
      ? "performed" : "unsupported")
    return
  }

  if command == "close" {
    guard let closeButton = axElement(window, kAXCloseButtonAttribute),
      AXUIElementPerformAction(closeButton, kAXPressAction as CFString) == .success
    else { try fail("BROWSER_ACTION_NOT_SUPPORTED") }
    print("closed")
    return
  }

  let contents = descendants(window)
  if command == "semantic" {
    let sourceIndex = try integerArgument(values, 3)
    let action = try argument(values, 4)
    let payload = try decodePayload(argument(values, 5))
    let expectedRole = try argument(values, 6)
    let expectedName = try decodePayload(argument(values, 7))
    let expected = Bounds(
      x: try integerArgument(values, 8),
      y: try integerArgument(values, 9),
      width: try integerArgument(values, 10),
      height: try integerArgument(values, 11)
    )
    let matches = contents.filter { candidate in
      let role = axString(candidate, kAXRoleAttribute) ?? ""
      let subrole = axString(candidate, kAXSubroleAttribute) ?? ""
      guard let mappedRole = roleName(role, subrole), mappedRole == expectedRole else {
        return false
      }
      return semanticName(candidate, mappedRole: mappedRole) == expectedName
        && axBounds(candidate)?.matches(expected, tolerance: 3) == true
    }
    guard matches.count == 1, let element = matches.first else {
      try fail(contents.indices.contains(sourceIndex)
        ? "BROWSER_OBSERVATION_MISMATCH" : "BROWSER_ELEMENT_NOT_FOUND")
    }
    let role = axString(element, kAXRoleAttribute) ?? ""
    let subrole = axString(element, kAXSubroleAttribute) ?? ""
    let name = axString(element, kAXTitleAttribute) ?? axString(element, kAXDescriptionAttribute) ?? ""
    guard sensitivity(role: role, subrole: subrole, name: name) == "none" else {
      try fail("BROWSER_USER_TAKEOVER_REQUIRED")
    }
    let success: Bool
    switch action {
    case "focus":
      success = setAttribute(element, kAXFocusedAttribute, kCFBooleanTrue)
    case "setValue", "select":
      _ = setAttribute(element, kAXFocusedAttribute, kCFBooleanTrue)
      success = setAttribute(element, kAXValueAttribute, payload as CFString)
    case "invoke", "click", "submit":
      success = AXUIElementPerformAction(element, kAXPressAction as CFString) == .success
    default:
      print("unsupported")
      return
    }
    print(success ? "performed" : "unsupported")
    return
  }

  if command == "native" {
    let action = try argument(values, 3)
    let payload = try decodePayload(argument(values, 4))
    let pointX = try integerArgument(values, 5)
    let pointY = try integerArgument(values, 6)
    let webBounds = Bounds(
      x: try integerArgument(values, 7),
      y: try integerArgument(values, 8),
      width: try integerArgument(values, 9),
      height: try integerArgument(values, 10)
    )
    let pointInside = pointX >= webBounds.x && pointY >= webBounds.y
      && pointX < webBounds.x + webBounds.width && pointY < webBounds.y + webBounds.height
    let pointTarget = pointInside ? interactiveElement(app, x: pointX, y: pointY) : nil
    if ["back", "forward", "reload"].contains(action) {
      let shortcut: (String, Int) = switch action {
      case "back": ("[", 33)
      case "forward": ("]", 30)
      default: ("r", 15)
      }
      print(performMenuShortcut(app, character: shortcut.0, virtualKey: shortcut.1)
        ? "performed" : "unsupported")
      return
    }
    if action == "scroll" {
      guard let webArea = primaryWebArea(contents, matching: webBounds) else {
        print("unsupported")
        return
      }
      print(performScroll(contents: contents, webArea: webArea, payload: payload)
        ? "performed" : "unsupported")
      return
    }
    if action == "key" {
      guard let webArea = primaryWebArea(contents, matching: webBounds), !payload.isEmpty else {
        print("unsupported")
        return
      }
      print(try performNamedKey(
        app: app,
        contents: contents,
        webArea: webArea,
        webBounds: webBounds,
        key: payload
      ) ? "performed" : "unsupported")
      return
    }
    if ["focus", "click", "invoke", "submit"].contains(action) {
      guard let target = pointTarget, let targetBounds = axBounds(target),
        webBounds.contains(targetBounds)
      else { print("unsupported"); return }
      let role = axString(target, kAXRoleAttribute) ?? ""
      let subrole = axString(target, kAXSubroleAttribute) ?? ""
      let mappedRole = roleName(role, subrole) ?? ""
      let name = semanticName(target, mappedRole: mappedRole)
      guard sensitivity(role: role, subrole: subrole, name: name) == "none" else {
        try fail("BROWSER_USER_TAKEOVER_REQUIRED")
      }
      let focused = setAttribute(target, kAXFocusedAttribute, kCFBooleanTrue)
      let pressed = action == "focus"
        ? false : AXUIElementPerformAction(target, kAXPressAction as CFString) == .success
      print(focused || pressed ? "performed" : "unsupported")
      return
    }
    if action == "setValue" || action == "type" {
      let target = pointTarget ?? axElement(app, kAXFocusedUIElementAttribute)
      guard let target, let targetBounds = axBounds(target), webBounds.contains(targetBounds)
      else { try fail("BROWSER_ELEMENT_NOT_INTERACTABLE") }
      let role = axString(target, kAXRoleAttribute) ?? ""
      let subrole = axString(target, kAXSubroleAttribute) ?? ""
      let mappedRole = roleName(role, subrole) ?? ""
      let name = semanticName(target, mappedRole: mappedRole)
      guard sensitivity(role: role, subrole: subrole, name: name) == "none" else {
        try fail("BROWSER_USER_TAKEOVER_REQUIRED")
      }
      _ = setAttribute(target, kAXFocusedAttribute, kCFBooleanTrue)
      let applied = setAttribute(target, kAXSelectedTextAttribute, payload as CFString)
        || setAttribute(target, kAXValueAttribute, payload as CFString)
      print(applied ? "performed" : "unsupported")
      return
    }
    print("unsupported")
    return
  }

  try fail("BROWSER_ACTION_NOT_SUPPORTED")
}

do {
  try run(Array(CommandLine.arguments.dropFirst()))
} catch let error as BrowserFailure {
  fputs("\(error.code)\n", stderr)
  exit(1)
} catch {
  fputs("BROWSER_OBSERVATION_MISMATCH\n", stderr)
  exit(1)
}
