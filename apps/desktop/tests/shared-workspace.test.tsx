// @vitest-environment jsdom

import {
  ComposerSelect,
  WorkspaceComposerFrame,
  WorkspaceContentPreview,
  WorkspaceEmptyState,
  WorkspaceHeader,
  WorkspaceInspector,
  WorkspaceMarkdown,
  WorkspaceMessage,
  WorkspaceShell,
  WorkspaceSidebar,
  WorkspaceTextarea,
  WorkspaceThread,
} from "@openerx/desktop-ui/workspace";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createRef, type FormEvent, type KeyboardEvent } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("shared personal and enterprise workspace", () => {
  it("renders the same workspace hierarchy without reading personal account or task APIs", () => {
    const originalBridge = Object.getOwnPropertyDescriptor(window, "openerx");
    const personalReads = {
      getAccountState: vi.fn(),
      getModelServiceSettings: vi.fn(),
      listModels: vi.fn(),
      listConversations: vi.fn(),
      listProjects: vi.fn(),
      getConversation: vi.fn(),
    };
    Object.defineProperty(window, "openerx", { configurable: true, value: personalReads });
    const shellRef = createRef<HTMLDivElement>();
    const threadRef = createRef<HTMLElement>();
    const formRef = createRef<HTMLFormElement>();
    try {
      render(
        <WorkspaceShell ref={shellRef} aria-label="当前工作空间">
          <WorkspaceSidebar
            aria-label="任务侧栏"
            header={<button type="button">新任务</button>}
            footer={<button type="button">设置</button>}
          >
            <nav aria-label="主导航">
              <button type="button" aria-current="page">
                当前任务
              </button>
            </nav>
          </WorkspaceSidebar>
          <main>
            <WorkspaceHeader>
              <h1>当前任务</h1>
            </WorkspaceHeader>
            <WorkspaceThread ref={threadRef} aria-label="对话消息">
              <WorkspaceMessage kind="user" aria-label="用户消息">
                请整理这份材料。
              </WorkspaceMessage>
              <WorkspaceMessage kind="assistant" aria-label="助手消息">
                <WorkspaceMarkdown text="已完成 **材料整理**。" />
              </WorkspaceMessage>
              <WorkspaceMessage kind="system" aria-label="系统消息">
                已连接工作空间。
              </WorkspaceMessage>
            </WorkspaceThread>
            <WorkspaceComposerFrame ref={formRef} aria-label="消息输入">
              <WorkspaceTextarea aria-label="发送消息" defaultValue="继续整理" />
            </WorkspaceComposerFrame>
          </main>
          <WorkspaceInspector aria-label="文件与成果">
            <WorkspaceContentPreview
              ariaLabel="任务文件预览"
              previewMode="preview"
              preview={{
                displayName: "任务材料.txt",
                format: "text",
                source: null,
                parsedText: "当前任务文件",
                imageDataUrl: null,
                renderedSurfaces: [],
              }}
            />
          </WorkspaceInspector>
        </WorkspaceShell>,
      );
      expect(shellRef.current).toBe(screen.getByLabelText("当前工作空间"));
      expect(threadRef.current).toBe(screen.getByRole("region", { name: "对话消息" }));
      expect(formRef.current).toBe(screen.getByRole("form", { name: "消息输入" }));
      expect(screen.getByRole("complementary", { name: "任务侧栏" })).toBeTruthy();
      expect(screen.getByRole("complementary", { name: "文件与成果" })).toBeTruthy();
      const messages = within(screen.getByRole("region", { name: "对话消息" }));
      expect(messages.getByRole("article", { name: "用户消息" }).textContent).toBe(
        "请整理这份材料。",
      );
      expect(
        messages.getByRole("article", { name: "助手消息" }).querySelector("strong")?.textContent,
      ).toBe("材料整理");
      expect(messages.getByRole("article", { name: "系统消息" }).textContent).toBe(
        "已连接工作空间。",
      );
      for (const read of Object.values(personalReads)) expect(read).not.toHaveBeenCalled();
    } finally {
      if (originalBridge) Object.defineProperty(window, "openerx", originalBridge);
      else Reflect.deleteProperty(window, "openerx");
    }
  });

  it("submits plain Enter while retaining Shift+Enter, IME and modified keys for editing", () => {
    const submit = vi.fn((event: FormEvent<HTMLFormElement>) => event.preventDefault());
    const view = render(
      <WorkspaceComposerFrame aria-label="消息输入" onSubmit={submit}>
        <WorkspaceTextarea aria-label="发送消息" defaultValue="输入中的草稿" />
        <button type="submit">发送</button>
      </WorkspaceComposerFrame>,
    );
    const composer = screen.getByRole("textbox", { name: "发送消息" });
    for (const input of [
      { shiftKey: true },
      { altKey: true },
      { ctrlKey: true },
      { metaKey: true },
      { repeat: true },
      { isComposing: true },
      { keyCode: 229 },
    ]) {
      fireEvent.keyDown(composer, { key: "Enter", ...input });
      expect(submit).not.toHaveBeenCalled();
    }
    fireEvent.keyDown(composer, { key: "Enter" });
    expect(submit).toHaveBeenCalledTimes(1);
    expect((composer as HTMLTextAreaElement).value).toBe("输入中的草稿");
    const handled = vi.fn((event: KeyboardEvent<HTMLTextAreaElement>) => event.preventDefault());
    view.rerender(
      <WorkspaceComposerFrame aria-label="消息输入" onSubmit={submit}>
        <WorkspaceTextarea aria-label="发送消息" onKeyDown={handled} />
        <button type="submit">发送</button>
      </WorkspaceComposerFrame>,
    );
    fireEvent.keyDown(screen.getByRole("textbox", { name: "发送消息" }), { key: "Enter" });
    expect(handled).toHaveBeenCalledOnce();
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it.each(["disabled", "readOnly"] as const)(
    "cannot submit an %s composer or open a busy model menu",
    (state) => {
      const submit = vi.fn((event: FormEvent<HTMLFormElement>) => event.preventDefault());
      const change = vi.fn();
      render(
        <WorkspaceComposerFrame onSubmit={submit} aria-busy="true">
          <WorkspaceTextarea aria-label="发送消息" {...{ [state]: true }} defaultValue="保留草稿" />
          <ComposerSelect
            ariaLabel="模型"
            label="企业模型"
            value="enterprise/model"
            options={[{ value: "enterprise/model", label: "企业模型" }]}
            onChange={change}
            disabled
          />
          <button type="submit">发送</button>
        </WorkspaceComposerFrame>,
      );
      const composer = screen.getByRole("textbox", { name: "发送消息" });
      fireEvent.keyDown(composer, { key: "Enter" });
      fireEvent.click(screen.getByRole("button", { name: "模型菜单" }));
      expect(submit).not.toHaveBeenCalled();
      expect(change).not.toHaveBeenCalled();
      expect(screen.queryByRole("listbox", { name: "模型" })).toBeNull();
      expect((composer as HTMLTextAreaElement).value).toBe("保留草稿");
      expect((composer as HTMLTextAreaElement)[state]).toBe(true);
    },
  );

  it.each(["missing", "disabled"] as const)(
    "keeps Enter from bypassing an %s submit action while preserving an editable draft",
    (state) => {
      const submit = vi.fn((event: FormEvent<HTMLFormElement>) => event.preventDefault());
      render(
        <WorkspaceComposerFrame onSubmit={submit}>
          <WorkspaceTextarea aria-label="发送消息" defaultValue="等待模型就绪" />
          {state === "disabled" ? (
            <button type="submit" disabled>
              发送
            </button>
          ) : null}
        </WorkspaceComposerFrame>,
      );
      const composer = screen.getByRole("textbox", { name: "发送消息" });
      fireEvent.keyDown(composer, { key: "Enter" });
      expect(submit).not.toHaveBeenCalled();
      expect((composer as HTMLTextAreaElement).value).toBe("等待模型就绪");
      expect((composer as HTMLTextAreaElement).disabled).toBe(false);
    },
  );

  it("keeps model authority controlled and supports keyboard, Escape and outside menu dismissal", async () => {
    const change = vi.fn();
    const opened = vi.fn();
    const options = [
      { value: "selected", label: "当前模型" },
      { value: "blocked", label: "无权使用的模型", disabled: true },
      { value: "available", label: "可用模型" },
    ];
    const selector = (value: string) => (
      <ComposerSelect
        ariaLabel="模型"
        label="模型"
        value={value}
        options={options}
        onChange={change}
        onOpen={opened}
      />
    );
    const view = render(
      <div>
        {selector("selected")}
        <button type="button">面板外按钮</button>
      </div>,
    );
    const trigger = screen.getByRole("button", { name: "模型菜单" });
    const option = (name: string) =>
      within(screen.getByRole("listbox", { name: "模型" })).getByRole("option", { name });
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    await waitFor(() => expect(document.activeElement).toBe(option("当前模型")));
    fireEvent.click(option("无权使用的模型"));
    expect(change).not.toHaveBeenCalled();
    fireEvent.keyDown(option("当前模型"), { key: "ArrowDown" });
    expect(document.activeElement).toBe(option("可用模型"));
    fireEvent.click(option("可用模型"));
    expect(change).toHaveBeenCalledExactlyOnceWith("available");
    expect((screen.getByRole("combobox", { name: "模型" }) as HTMLSelectElement).value).toBe(
      "selected",
    );
    expect(screen.queryByRole("listbox", { name: "模型" })).toBeNull();
    view.rerender(
      <div>
        {selector("available")}
        <button type="button">面板外按钮</button>
      </div>,
    );
    expect((screen.getByRole("combobox", { name: "模型" }) as HTMLSelectElement).value).toBe(
      "available",
    );
    fireEvent.click(trigger);
    const active = option("可用模型");
    expect(active.getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(active, { key: "Escape" });
    expect(screen.queryByRole("listbox", { name: "模型" })).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(trigger));
    fireEvent.click(trigger);
    fireEvent.pointerDown(screen.getByRole("button", { name: "面板外按钮" }));
    expect(screen.queryByRole("listbox", { name: "模型" })).toBeNull();
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(opened).toHaveBeenCalledTimes(3);
    expect(change).toHaveBeenCalledTimes(1);
  });

  it("renders GFM and copyable code while blocking message HTML and unsafe links", () => {
    const copy = vi.fn();
    const text = [
      "<script>window.sharedWorkspaceInjected = true</script>",
      "<img src=x onerror='window.sharedWorkspaceInjected = true'>",
      "",
      "[危险链接](javascript:alert(1)) [参考资料](https://example.test/reference)",
      "",
      "| 项目 | 状态 |",
      "| --- | --- |",
      "| 文件 | 已完成 |",
      "",
      "```js",
      "const answer = 42;",
      "```",
    ].join("\n");
    const view = render(<WorkspaceMarkdown text={text} onCopy={copy} />);
    expect(view.container.querySelector("script, img")).toBeNull();
    expect(screen.getByRole("table")).toBeTruthy();
    expect(screen.getByRole("link", { name: "参考资料" }).getAttribute("href")).toBe(
      "https://example.test/reference",
    );
    expect(view.container.querySelector('a[href^="javascript:"]')).toBeNull();
    expect(view.container.querySelector("pre code")?.textContent?.trim()).toBe(
      "const answer = 42;",
    );
    fireEvent.click(screen.getByRole("button", { name: /复制/ }));
    expect(copy).toHaveBeenCalledWith(expect.stringMatching(/^const answer = 42;/));
  });

  it("lets each edition supply its own empty state and actions", () => {
    const start = vi.fn();
    render(
      <WorkspaceEmptyState
        eyebrow="企业 A"
        title="今天想完成什么？"
        description="使用企业授权的模型与 Skill。"
      >
        <button type="button" onClick={start}>
          整理材料
        </button>
      </WorkspaceEmptyState>,
    );
    expect(screen.getByRole("heading", { name: "今天想完成什么？" })).toBeTruthy();
    expect(screen.getByText("企业 A")).toBeTruthy();
    expect(screen.getByText("使用企业授权的模型与 Skill。")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "整理材料" }));
    expect(start).toHaveBeenCalledOnce();
  });

  it("renders every Office surface and switches to source without dropping the inspector context", () => {
    const imageDataUrl =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1cAAAAASUVORK5CYII=";
    const preview = {
      displayName: "企业报告.pptx",
      format: "pptx",
      source: "presentation source",
      parsedText: "解析文本不能代替幻灯片预览",
      imageDataUrl: null,
      renderedSurfaces: [
        { kind: "slide", index: 0, label: "第 1 页", imageDataUrl },
        { kind: "slide", index: 1, label: "第 2 页", imageDataUrl },
      ],
    };
    const view = render(
      <WorkspaceContentPreview ariaLabel="报告预览" preview={preview} previewMode="preview" />,
    );
    const surfaces = within(screen.getByRole("region", { name: "报告预览" })).getAllByRole("img");
    expect(surfaces.map((surface) => surface.getAttribute("alt"))).toEqual([
      "企业报告.pptx 第 1 页",
      "企业报告.pptx 第 2 页",
    ]);
    expect(surfaces.every((surface) => surface.getAttribute("src") === imageDataUrl)).toBe(true);
    expect(screen.queryByText(preview.parsedText)).toBeNull();
    view.rerender(
      <WorkspaceContentPreview ariaLabel="报告预览" preview={preview} previewMode="source" />,
    );
    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.getByText(preview.source)).toBeTruthy();
  });

  it("keeps inline HTML isolated from the desktop bridge and renders source as text", () => {
    const preview = {
      displayName: "任务页面.html",
      format: "html",
      source: "<script>parent.openerx.sendMessage({text: 'untrusted'})</script>",
      parsedText: "任务页面",
      imageDataUrl: null,
      renderedSurfaces: [],
    };
    const view = render(
      <WorkspaceContentPreview ariaLabel="页面预览" preview={preview} previewMode="preview" />,
    );
    const iframe = screen.getByTitle("HTML 隔离预览");
    expect(iframe.getAttribute("srcdoc")).toBe(preview.source);
    expect(iframe.getAttribute("sandbox")).toBe("allow-scripts");
    expect(iframe.getAttribute("sandbox")).not.toContain("allow-same-origin");
    expect(iframe.getAttribute("referrerpolicy")).toBe("no-referrer");
    view.rerender(
      <WorkspaceContentPreview ariaLabel="页面预览" preview={preview} previewMode="source" />,
    );
    expect(screen.queryByTitle("HTML 隔离预览")).toBeNull();
    expect(view.container.querySelector("script")).toBeNull();
    expect(screen.getByText(preview.source)).toBeTruthy();
    const htmlPreviewUrl = "http://127.0.0.1:4231/preview/fixture/index.html";
    view.rerender(
      <WorkspaceContentPreview
        ariaLabel="页面预览"
        preview={{ ...preview, htmlPreviewUrl }}
        previewMode="preview"
      />,
    );
    const hosted = screen.getByTitle("HTML 隔离预览");
    expect(hosted.getAttribute("src")).toBe(htmlPreviewUrl);
    expect(hosted.getAttribute("srcdoc")).toBeNull();
    expect(hosted.getAttribute("sandbox")).toBe("allow-scripts allow-same-origin");
  });

  it("uses the same safe Markdown presentation in result previews", () => {
    const view = render(
      <WorkspaceContentPreview
        ariaLabel="报告预览"
        previewMode="preview"
        preview={{
          displayName: "任务报告.md",
          format: "markdown",
          source: null,
          parsedText:
            "**任务完成**\n\n[参考资料](https://example.test/reference) [危险链接](javascript:alert(1))\n\n<script>parent.openerx.listConversations()</script>",
          imageDataUrl: null,
          renderedSurfaces: [],
        }}
      />,
    );
    expect(view.container.querySelector("strong")?.textContent).toBe("任务完成");
    expect(screen.getByRole("link", { name: "参考资料" }).getAttribute("href")).toBe(
      "https://example.test/reference",
    );
    expect(view.container.querySelector('script, a[href^="javascript:"]')).toBeNull();
    expect(view.container.querySelector("iframe")).toBeNull();
  });

  it.each(["text", "code"])(
    "keeps readable %s source visible when parsed content is unavailable",
    (format) => {
      const source = "const availableSource = 42;";
      render(
        <WorkspaceContentPreview
          ariaLabel="原文件预览"
          previewMode="preview"
          preview={{
            displayName: "原始材料.txt",
            format,
            source,
            parsedText: "",
            imageDataUrl: null,
            renderedSurfaces: [],
          }}
        />,
      );
      expect(screen.getByText(source)).toBeTruthy();
      expect(screen.queryByText("没有可提取的文字。")).toBeNull();
    },
  );

  it("renders Markdown from its readable source when the parse cache is empty", () => {
    render(
      <WorkspaceContentPreview
        ariaLabel="原报告预览"
        previewMode="preview"
        preview={{
          displayName: "原始报告.md",
          format: "markdown",
          source: "# 原始报告\n\n**已保存的内容**",
          parsedText: "",
          imageDataUrl: null,
          renderedSurfaces: [],
        }}
      />,
    );
    expect(screen.getByRole("heading", { name: "原始报告", level: 1 })).toBeTruthy();
    expect(screen.getByText("已保存的内容").tagName).toBe("STRONG");
  });

  it.each(["text", "code", "markdown"])(
    "explains absent %s preview content in both visual and source modes",
    (format) => {
      const preview = {
        displayName: "无法提取的材料",
        format,
        source: null,
        parsedText: "",
        imageDataUrl: null,
        renderedSurfaces: [],
      };
      const view = render(
        <WorkspaceContentPreview ariaLabel="文件预览" previewMode="preview" preview={preview} />,
      );
      expect(screen.getByText("没有可提取的文字。")).toBeTruthy();
      view.rerender(
        <WorkspaceContentPreview ariaLabel="文件预览" previewMode="source" preview={preview} />,
      );
      expect(screen.getByText("没有可提取的文字。")).toBeTruthy();
    },
  );
});
