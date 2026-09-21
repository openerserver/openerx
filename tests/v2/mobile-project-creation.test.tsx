// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { afterEach, expect, test, vi } from "vitest";
import { ProjectCreator } from "../../apps/mobile/src/ProjectCreator";

vi.mock("expo-crypto", () => ({ randomUUID: () => crypto.randomUUID() }));
// The mobile workspace pins its own React; the DOM renderer uses the root copy.
vi.mock("../../apps/mobile/node_modules/react/index.js", () => import("react"));
vi.mock("react-native", async () => {
  const { createElement } = await import("react");
  const box = ({ children }: { children?: React.ReactNode }) =>
    createElement("div", null, children);
  return {
    KeyboardAvoidingView: box,
    SafeAreaView: box,
    ScrollView: box,
    Text: box,
    View: box,
    Platform: { OS: "ios" },
    StyleSheet: { create: (value: unknown) => value },
    Modal: ({ visible, children }: { visible: boolean; children: React.ReactNode }) =>
      visible ? createElement("div", { role: "dialog" }, children) : null,
    Pressable: ({
      children,
      accessibilityLabel,
      disabled,
      onPress,
    }: {
      children?: React.ReactNode;
      accessibilityLabel: string;
      disabled?: boolean;
      onPress(): void;
    }) =>
      createElement(
        "button",
        { "aria-label": accessibilityLabel, disabled, onClick: onPress },
        children,
      ),
    TextInput: ({
      accessibilityLabel,
      value,
      onChangeText,
      editable,
      maxLength,
      multiline,
    }: {
      accessibilityLabel: string;
      value: string;
      onChangeText(value: string): void;
      editable: boolean;
      maxLength: number;
      multiline?: boolean;
    }) =>
      createElement(multiline ? "textarea" : "input", {
        "aria-label": accessibilityLabel,
        value,
        disabled: !editable,
        maxLength,
        onChange: (event: React.ChangeEvent<HTMLInputElement>) => onChangeText(event.target.value),
      }),
  };
});
afterEach(cleanup);

test("mobile project form waits for confirmation and reuses the operation after a lost reply", async () => {
  const onCreate = vi
    .fn()
    .mockRejectedValueOnce(new Error("REMOTE_COMMAND_TIMEOUT"))
    .mockResolvedValue(undefined);
  render(React.createElement(ProjectCreator, { disabled: false, hostName: "测试电脑", onCreate }));
  fireEvent.click(screen.getByRole("button", { name: "新建项目" }));
  const submit = () => screen.getByRole("button", { name: "创建项目" }) as HTMLButtonElement;
  expect(submit().disabled).toBe(true);
  fireEvent.change(screen.getByLabelText("项目名称"), { target: { value: "  手机项目  " } });
  fireEvent.change(screen.getByLabelText("项目说明（选填）"), {
    target: { value: "先检查再修改。" },
  });
  fireEvent.click(submit());
  await waitFor(() => expect(screen.getByText(/电脑尚未确认操作/)).toBeTruthy());
  expect(screen.getByRole("dialog")).toBeTruthy();
  expect((screen.getByLabelText("项目名称") as HTMLInputElement).value).toBe("  手机项目  ");
  fireEvent.click(submit());
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(onCreate).toHaveBeenCalledTimes(2);
  expect(onCreate.mock.calls[1]).toEqual(onCreate.mock.calls[0]);
  expect(onCreate.mock.calls[0]?.[0]).toMatchObject({
    kind: "project.create",
    name: "手机项目",
    instructions: "先检查再修改。",
  });
});

test("mobile project form disables offline creation and suppresses double submission", async () => {
  let finish!: () => void;
  const onCreate = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const view = render(
    React.createElement(ProjectCreator, { disabled: true, hostName: "测试电脑", onCreate }),
  );
  expect((screen.getByRole("button", { name: "新建项目" }) as HTMLButtonElement).disabled).toBe(
    true,
  );
  view.rerender(
    React.createElement(ProjectCreator, { disabled: false, hostName: "测试电脑", onCreate }),
  );
  fireEvent.click(screen.getByRole("button", { name: "新建项目" }));
  fireEvent.change(screen.getByLabelText("项目名称"), { target: { value: "项目" } });
  const button = screen.getByRole("button", { name: "创建项目" });
  fireEvent.click(button);
  fireEvent.click(button);
  expect(onCreate).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("dialog")).toBeTruthy();
  finish();
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
});
