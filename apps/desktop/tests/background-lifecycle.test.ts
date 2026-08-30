import { describe, expect, it } from "vitest";
import {
  keepsAutomationRuntimeAliveAfterWindowClose,
  shouldHideMainWindowOnClose,
} from "../src/main/background-lifecycle";

describe("desktop background lifecycle", () => {
  it("keeps the Windows automation runtime alive when the main window closes", () => {
    expect(keepsAutomationRuntimeAliveAfterWindowClose("win32")).toBe(true);
    expect(shouldHideMainWindowOnClose("win32", false)).toBe(true);
  });

  it("allows an explicit quit to close the Windows window and stop the runtime", () => {
    expect(shouldHideMainWindowOnClose("win32", true)).toBe(false);
  });

  it("preserves the existing lifecycle on other platforms", () => {
    expect(keepsAutomationRuntimeAliveAfterWindowClose("darwin")).toBe(false);
    expect(keepsAutomationRuntimeAliveAfterWindowClose("linux")).toBe(false);
    expect(shouldHideMainWindowOnClose("darwin", false)).toBe(false);
  });
});
