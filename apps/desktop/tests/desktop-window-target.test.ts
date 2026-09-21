import { describe, expect, it } from "vitest";
import {
  desktopWindowCaptureOptions,
  selectDesktopWindow,
  selectDesktopWindowByNativeId,
} from "../src/main/desktop-window-target";

describe("desktop window targeting", () => {
  it("requests window sources only and selects the named application window", () => {
    expect(desktopWindowCaptureOptions().types).toEqual(["window"]);
    const sensitive = { name: "Passwords — sensitive-marker", id: "side-window" };
    const target = { name: "Notes — project", id: "target-window" };
    expect(selectDesktopWindow([sensitive, target], "Notes")).toBe(target);
    expect(selectDesktopWindow([sensitive], "Notes")).toBeNull();
    expect(selectDesktopWindow([{ name: "A", id: "short-title" }], "Mail")).toBeNull();
  });

  it("fails closed when an application label matches more than one window", () => {
    expect(
      selectDesktopWindow(
        [
          { name: "Notes — work", id: "work" },
          { name: "Notes — private", id: "private" },
        ],
        "Notes",
      ),
    ).toBeNull();
  });

  it("selects one exact CGWindowID instead of guessing from document titles", () => {
    const work = { name: "Quarterly plan", id: "window:410:0" };
    const privateWindow = { name: "Passwords", id: "window:411:0" };
    expect(selectDesktopWindowByNativeId([work, privateWindow], 410)).toBe(work);
    expect(selectDesktopWindowByNativeId([work, privateWindow], 999)).toBeNull();
    expect(selectDesktopWindowByNativeId([work, { ...work, name: "duplicate" }], 410)).toBeNull();
  });
});
