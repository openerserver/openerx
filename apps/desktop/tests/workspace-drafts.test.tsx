// @vitest-environment jsdom
import type { DesktopBridge } from "@openerx/contracts";
import { setDesktopWorkspaceBridge } from "@openerx/desktop-ui/workspace-bridge";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";
import { useWorkspaceComposerDraft } from "../src/renderer/workspace-drafts";

afterEach(() => {
  cleanup();
  setDesktopWorkspaceBridge(null);
});
let lateEdit: (value: string) => void;
function Composer({ target = "new" }: { target?: string }) {
  const { draft, setDraft, pendingFiles, setPendingFiles } = useWorkspaceComposerDraft(target);
  lateEdit = setDraft;
  return (
    <>
      <input
        aria-label="未发送文字"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
      />
      <output aria-label="待发送附件数">{pendingFiles.length}</output>
      <button type="button" onClick={() => setPendingFiles([{ id: "fixture-file" } as never])}>
        加入附件
      </button>
    </>
  );
}
function bridge() {
  return {} as DesktopBridge;
}
function fill() {
  fireEvent.change(screen.getByLabelText("未发送文字"), {
    target: { value: "需要保留的未发送文字" },
  });
  fireEvent.click(screen.getByRole("button", { name: "加入附件" }));
}
test("a revalidated identity restores text and selected files through a replacement bridge", () => {
  const scope = {},
    first = bridge();
  setDesktopWorkspaceBridge(first, scope);
  const view = render(<Composer />);
  fill();
  const oldEdit = lateEdit;
  view.unmount();
  // The verification gate registers its own scope and exposes none of the draft.
  setDesktopWorkspaceBridge(bridge());
  const gate = render(<Composer />);
  expect((screen.getByLabelText("未发送文字") as HTMLInputElement).value).toBe("");
  expect(screen.getByLabelText("待发送附件数").textContent).toBe("0");
  gate.unmount();
  setDesktopWorkspaceBridge(bridge(), scope);
  render(<Composer />);
  oldEdit("晚到的旧回调");
  expect((screen.getByLabelText("未发送文字") as HTMLInputElement).value).toBe(
    "需要保留的未发送文字",
  );
  expect(screen.getByLabelText("待发送附件数").textContent).toBe("1");
});
test("different identities and targets cannot read or overwrite another draft", () => {
  setDesktopWorkspaceBridge(bridge(), {});
  const view = render(<Composer />);
  fill();
  const oldEdit = lateEdit;
  view.unmount();
  setDesktopWorkspaceBridge(bridge(), {});
  const next = render(<Composer />);
  oldEdit("旧账号的文字");
  expect((screen.getByLabelText("未发送文字") as HTMLInputElement).value).toBe("");
  expect(screen.getByLabelText("待发送附件数").textContent).toBe("0");
  fill();
  next.rerender(<Composer target="another-task" />);
  expect((screen.getByLabelText("未发送文字") as HTMLInputElement).value).toBe("");
  expect(screen.getByLabelText("待发送附件数").textContent).toBe("0");
});
test("personal drafts survive page navigation without any host-provided scope", () => {
  window.openerx = bridge();
  const view = render(<Composer />);
  fill();
  view.unmount();
  render(<Composer />);
  expect((screen.getByLabelText("未发送文字") as HTMLInputElement).value).toBe(
    "需要保留的未发送文字",
  );
  expect(screen.getByLabelText("待发送附件数").textContent).toBe("1");
});
