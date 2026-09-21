// @vitest-environment jsdom
import type { Artifact, ContentPreview, PersonalFile } from "@openerx/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConversationResults, type ResultSelection } from "../src/renderer/ConversationResults";

const timestamp = "2026-09-11T08:00:00.000Z";
const artifact = (id: string, displayName: string): Artifact => ({
  id,
  displayName,
  ownerProfileId: "local-default",
  format: "html",
  mediaType: "text/html",
  currentVersion: 1,
  versions: [],
  createdAt: timestamp,
  updatedAt: timestamp,
  revision: 1,
});
const artifacts = [
  artifact("a", "index.html"),
  artifact("b", "pages/index.html"),
  artifact("c", "assets/js/app.js"),
];
const source: PersonalFile = {
  id: "a",
  displayName: "index.html",
  ownerProfileId: "local-default",
  format: "html",
  mediaType: "text/html",
  sizeBytes: 100,
  checksumSha256: "a".repeat(64),
  objectRef: `objects/sha256/aa/${"a".repeat(64)}`,
  sourceScopeId: null,
  sourceRelativePath: "reference/index.html",
  parseStatus: "failed",
  parseErrorCode: "FILE_CORRUPT",
  createdAt: timestamp,
  updatedAt: timestamp,
  revision: 1,
};
const previewData = (id: string): ContentPreview => ({
  objectKind: "artifact",
  objectId: id,
  displayName: artifacts.find((item) => item.id === id)?.displayName ?? "index.html",
  format: "html",
  source: `source-${id}`,
  parsedText: `preview-${id}`,
  imageDataUrl: null,
  renderedSurfaces: [],
  citations: [],
});
const bridge = { previewArtifact: vi.fn(), previewFile: vi.fn(), saveArtifact: vi.fn() };
const addSource = vi.fn();

function mount(options: { empty?: boolean; loadError?: Error; onReload?: () => void } = {}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  function Harness() {
    const [selected, onSelect] = useState<ResultSelection | null>(null);
    return (
      <>
        <textarea aria-label="消息草稿" />
        <ConversationResults
          artifacts={options.empty ? [] : artifacts}
          files={options.empty ? [] : [source]}
          workItems={[]}
          selected={selected}
          onSelect={onSelect}
          onAddSource={addSource}
          onClose={vi.fn()}
          listState={{ files: { error: options.loadError } }}
          onReload={options.onReload ?? vi.fn()}
          runDescription={(item) => item.title}
          errorMessage={(_error, fallback) => fallback}
          renderPreview={(data, mode) => (
            <pre>{mode === "preview" ? data.parsedText : data.source}</pre>
          )}
        />
      </>
    );
  }
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <Harness />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(window, { openerx: bridge });
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
    window.setTimeout(() => callback(0), 0),
  );
  bridge.previewArtifact.mockImplementation(({ artifactId }) =>
    Promise.resolve(previewData(artifactId)),
  );
  bridge.previewFile.mockResolvedValue({
    ...previewData("a"),
    objectKind: "personal_file",
    parsedText: "reference-preview",
  });
  bridge.saveArtifact.mockResolvedValue(null);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("conversation result workspace", () => {
  it("finds deeply nested files and restores the folder state after clearing search", async () => {
    mount();
    const user = userEvent.setup();
    expect(screen.queryByRole("button", { name: "预览 assets/js/app.js" })).toBeNull();
    await user.type(screen.getByRole("textbox", { name: "搜索成果文件" }), "APP.JS");
    expect(screen.getByRole("button", { name: "预览 assets/js/app.js" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "目录 assets" }));
    expect(screen.queryByRole("button", { name: "预览 assets/js/app.js" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "目录 assets" }));
    expect(screen.getByRole("button", { name: "预览 assets/js/app.js" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "预览 index.html" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "清除文件搜索" }));
    expect(screen.queryByRole("button", { name: "预览 assets/js/app.js" })).toBeNull();
    expect(screen.getByRole("button", { name: "目录 assets" }).getAttribute("aria-expanded")).toBe(
      "false",
    );
  });

  it("keeps separate file tabs and their preview modes, and selects a neighbor when closed", async () => {
    mount();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "预览 index.html" }));
    await user.click(await screen.findByRole("button", { name: "源码" }));
    expect(await screen.findByText("source-a")).toBeTruthy();
    await user.click(screen.getByRole("tab", { name: /^文件/ }));
    await user.click(screen.getByRole("button", { name: "目录 pages" }));
    await user.click(screen.getByRole("button", { name: "预览 pages/index.html" }));
    expect(await screen.findByText("preview-b")).toBeTruthy();
    await user.click(screen.getByRole("tab", { name: "成果 index.html" }));
    expect(await screen.findByText("source-a")).toBeTruthy();
    expect(
      within(screen.getByRole("tablist", { name: "已打开的文件" })).getAllByRole("tab"),
    ).toHaveLength(2);
    await user.click(screen.getByRole("button", { name: "关闭 成果 index.html" }));
    expect(await screen.findByText("preview-b")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "关闭 成果 pages/index.html" }));
    expect(screen.getByRole("heading", { name: "输出内容" })).toBeTruthy();
    expect(screen.queryByRole("tablist", { name: "已打开的文件" })).toBeNull();
  });

  it("previews a source independently of an output with the same id and name", async () => {
    mount();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "预览 index.html" }));
    expect(await screen.findByText("preview-a")).toBeTruthy();
    await user.click(screen.getByRole("tab", { name: /^来源/ }));
    expect(screen.getByText("解析失败")).toBeTruthy();
    await user.type(screen.getByRole("textbox", { name: "搜索来源文件" }), "reference/");
    await user.click(screen.getByRole("button", { name: "预览来源 index.html" }));
    expect(await screen.findByText("reference-preview")).toBeTruthy();
    expect(bridge.previewFile).toHaveBeenCalledWith({ personalFileId: "a" });
    expect(addSource).not.toHaveBeenCalled();
    expect(screen.getByRole("tab", { name: "成果 index.html" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "来源 index.html" })).toBeTruthy();
  });

  it("keeps the preview open when Escape is pressed in the composer and supports tab arrow keys", async () => {
    mount();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "预览 index.html" }));
    await user.click(screen.getByRole("textbox", { name: "消息草稿" }));
    await user.keyboard("{Escape}");
    expect(screen.getByRole("complementary", { name: "成果预览" })).toBeTruthy();
    await user.click(screen.getByRole("tab", { name: /^文件/ }));
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("heading", { name: "来源" })).toBeTruthy();
    await user.keyboard("{End}");
    expect(screen.getByRole("heading", { name: "本次运行" })).toBeTruthy();
  });

  it("recovers from a failed preview without closing its tab", async () => {
    bridge.previewArtifact.mockRejectedValueOnce(new Error("unavailable"));
    mount();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "预览 index.html" }));
    await user.click(await screen.findByRole("button", { name: "重试" }));
    expect(await screen.findByText("preview-a")).toBeTruthy();
    expect(screen.getAllByRole("tab", { name: "成果 index.html" })).toHaveLength(1);
    expect(bridge.previewArtifact).toHaveBeenCalledTimes(2);
  });

  it("distinguishes an empty list from a load error", async () => {
    const onReload = vi.fn();
    mount({ empty: true, loadError: new Error("unavailable"), onReload });
    expect(screen.queryByText("还没有成果文件")).toBeNull();
    await userEvent.setup().click(screen.getByRole("button", { name: "重试" }));
    await waitFor(() => expect(onReload).toHaveBeenCalledOnce());
    cleanup();
    mount({ empty: true });
    expect(screen.getByText("还没有成果文件")).toBeTruthy();
  });
});
