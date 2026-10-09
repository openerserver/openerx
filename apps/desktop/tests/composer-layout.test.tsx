// @vitest-environment jsdom

import { ComposerSelect } from "@openerx/desktop-ui/workspace";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { composerMenuPosition } from "../../../packages/desktop-ui/src/composer-menu-position";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

test.each([
  { width: 920, height: 640, anchor: { left: 668, top: 572, bottom: 604, width: 126 } },
  { width: 613, height: 427, anchor: { left: 492, top: 18, bottom: 50, width: 104 } },
  { width: 200, height: 180, anchor: { left: 12, top: 72, bottom: 104, width: 170 } },
])(
  "keeps the full menu inside $width × $height instead of extending the page",
  ({ width, height, anchor }) => {
    const position = composerMenuPosition(
      anchor,
      { width: 320, height: 1100 },
      { left: 0, top: 0, width, height },
    );
    const menuWidth = Math.min(320, position.maxWidth);
    expect(position.left).toBeGreaterThanOrEqual(8);
    expect(position.left + menuWidth).toBeLessThanOrEqual(width - 8);
    expect(position.top).toBeGreaterThanOrEqual(8);
    expect(position.top + position.maxHeight).toBeLessThanOrEqual(height - 8);
    expect(position.minWidth).toBeLessThanOrEqual(position.maxWidth);
    expect(position.maxHeight).toBeLessThanOrEqual(320);
  },
);

test("opens below a trigger near the top and follows the visible viewport during zoom", () => {
  const position = composerMenuPosition(
    { left: 580, top: 90, bottom: 122, width: 120 },
    { width: 320, height: 250 },
    { left: 120, top: 72, width: 600, height: 420 },
  );
  expect(position.placement).toBe("below");
  expect(position.top).toBe(130);
  expect(position.left + position.maxWidth).toBeLessThanOrEqual(712);
});

test("portals outside clipped composer containers, repositions on resize, and retains keyboard navigation", async () => {
  let viewportWidth = 920;
  vi.spyOn(window, "innerWidth", "get").mockImplementation(() => viewportWidth);
  vi.spyOn(window, "innerHeight", "get").mockReturnValue(640);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
    this: HTMLElement,
  ) {
    if (this.classList.contains("composer-select-trigger")) {
      return {
        left: 668,
        right: 794,
        top: 572,
        bottom: 604,
        width: 126,
        height: 32,
        x: 668,
        y: 572,
        toJSON: () => ({}),
      };
    }
    return {
      left: 0,
      right: 320,
      top: 0,
      bottom: 360,
      width: 320,
      height: 360,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    };
  });
  vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(1100);
  const change = vi.fn();
  const view = render(
    <div style={{ overflow: "hidden", width: 280 }}>
      <ComposerSelect
        ariaLabel="选择 Skill"
        label="自动 Skill"
        value="auto"
        onChange={change}
        options={[
          { value: "auto", label: "自动 Skill" },
          { value: "blocked", label: "未授权 Skill", disabled: true },
          { value: "documents", label: "文档", description: "创建、编辑 DOCX 文档，并预览版式。" },
        ]}
      />
      <button type="button">发送消息</button>
    </div>,
  );
  const trigger = screen.getByRole("button", { name: "选择 Skill菜单" });
  fireEvent.keyDown(trigger, { key: "ArrowDown" });
  const menu = screen.getByRole("listbox", { name: "选择 Skill" });
  expect(view.container.contains(menu)).toBe(false);
  expect(menu.style.left).toBe("592px");
  expect(menu.style.maxHeight).toBe("320px");
  const first = within(menu).getByRole("option", { name: "自动 Skill" });
  const last = within(menu).getByRole("option", { name: /文档/ });
  await waitFor(() => expect(document.activeElement).toBe(first));
  fireEvent.keyDown(first, { key: "ArrowDown" });
  expect(document.activeElement).toBe(last);
  fireEvent.pointerDown(last);
  expect(screen.getByRole("listbox")).toBe(menu);
  viewportWidth = 613;
  fireEvent(window, new Event("resize"));
  expect(menu.style.left).toBe("285px");
  fireEvent.keyDown(last, { key: "Tab" });
  expect(screen.queryByRole("listbox")).toBeNull();
  await waitFor(() =>
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "发送消息" })),
  );
  expect(change).not.toHaveBeenCalled();
  fireEvent.click(trigger);
  fireEvent.keyDown(
    within(screen.getByRole("listbox")).getByRole("option", { name: "自动 Skill" }),
    { key: "Escape" },
  );
  await waitFor(() => expect(document.activeElement).toBe(trigger));
});
