import { describe, expect, it } from "vitest";
import { selectDesktopWindow } from "../src/main/desktop-window-target";
import { desktopFixtureTitle, matchesDesktopFixtureCapture } from "./fixtures/desktop-capture";

const title = "openerx E2E openerx-e2e-tools-aB1234";
const capture = {
  isError: false,
  details: { data: { capturedWindow: title, width: 640, height: 480 } },
  content: [{ type: "image", data: "fixture-png", mimeType: "image/png" }],
};

describe("desktop capture E2E target isolation", () => {
  it("selects the requested fixture among duplicate app titles and another test run", () => {
    const requested = desktopFixtureTitle(
      `捕获桌面测试窗口 [PI_TEST_DESKTOP] WINDOW_TITLE=${JSON.stringify(title)}`,
    );
    expect(requested).toBe(title);
    const target = { name: title, id: "fixture" };
    const others = [
      { name: "openerx", id: "development" },
      { name: "openerx", id: "installed" },
      { name: "openerx E2E openerx-e2e-tools-other", id: "another-run" },
    ];
    expect(selectDesktopWindow([...others, target], requested ?? "")).toBe(target);
    expect(selectDesktopWindow(others, requested ?? "")).toBeNull();
    expect(selectDesktopWindow(others, "openerx")).toBeNull();
    expect(selectDesktopWindow([target, { ...target, id: "duplicate" }], title)).toBeNull();
  });

  it.each([
    "[PI_TEST_DESKTOP]",
    'WINDOW_TITLE="openerx"',
    'WINDOW_TITLE="UWA"',
    "WINDOW_TITLE=null",
    "WINDOW_TITLE=42",
    "WINDOW_TITLE={",
  ])("rejects an unspecified or generic target: %s", (prompt) => {
    expect(desktopFixtureTitle(prompt)).toBeNull();
  });

  it("requires an image from the requested fixture, not merely a success message", () => {
    expect(matchesDesktopFixtureCapture(capture, title)).toBe(true);
    expect(matchesDesktopFixtureCapture(capture, "openerx E2E another-run")).toBe(false);
    expect(matchesDesktopFixtureCapture({ ...capture, isError: true }, title)).toBe(false);
    expect(
      matchesDesktopFixtureCapture(
        { ...capture, content: [{ type: "text", text: "已捕获目标应用窗口" }] },
        title,
      ),
    ).toBe(false);
    expect(
      matchesDesktopFixtureCapture({ ...capture, content: [{ type: "image", data: "" }] }, title),
    ).toBe(false);
    expect(matchesDesktopFixtureCapture({ ...capture, details: {} }, title)).toBe(false);
    expect(matchesDesktopFixtureCapture(null, title)).toBe(false);
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects unusable capture dimensions: %s",
    (size) => {
      for (const dimension of ["width", "height"]) {
        expect(
          matchesDesktopFixtureCapture(
            { ...capture, details: { data: { ...capture.details.data, [dimension]: size } } },
            title,
          ),
        ).toBe(false);
      }
    },
  );
});
