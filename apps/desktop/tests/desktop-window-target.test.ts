import { describe, expect, it } from "vitest";
import {
  desktopWindowCaptureOptions,
  selectDesktopWindow,
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
});
