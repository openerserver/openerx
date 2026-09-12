import type { Artifact, ContentPreview, PersonalFile, WorkItem } from "@openerx/contracts";
import {
  ArrowsInSimple,
  ArrowsOutSimple,
  CaretRight,
  DownloadSimple,
  FileText,
  FolderSimple,
  MagnifyingGlass,
  Paperclip,
  Plus,
  SidebarSimple,
  TerminalWindow,
  X,
} from "@phosphor-icons/react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { type KeyboardEvent, type ReactNode, useEffect, useId, useRef, useState } from "react";
import { NavLink } from "react-router-dom";
import { ArtifactDirectory } from "./ArtifactDirectory";
import "./conversation-results.css";

export interface ResultSelection {
  kind: "artifact" | "personal_file";
  id: string;
}

type Section = "files" | "sources" | "activity";
export type ResultListState = Partial<Record<Section, { loading?: boolean; error?: unknown }>>;
type PreviewMode = "preview" | "source";
const selectionKey = (selection: ResultSelection): string => `${selection.kind}:${selection.id}`;
const fileName = (path: string): string => path.replaceAll("\\", "/").split("/").pop() || path;

const parseLabels: Record<PersonalFile["parseStatus"], string> = {
  pending: "等待解析",
  ready: "已解析",
  failed: "解析失败",
};

// Tabs use the same keyboard behavior for the section switcher and opened files.
function navigateTabs(event: KeyboardEvent<HTMLElement>): void {
  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
  const tabs = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
  const current = tabs.indexOf(event.target as HTMLButtonElement);
  if (current < 0) return;
  event.preventDefault();
  const next =
    event.key === "Home"
      ? 0
      : event.key === "End"
        ? tabs.length - 1
        : (current + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
  tabs[next]?.focus();
  tabs[next]?.click();
}

export function ConversationResults({
  artifacts,
  files,
  workItems,
  selected,
  onSelect,
  onAddSource,
  onClose,
  renderPreview,
  errorMessage,
  runDescription,
  listState,
  onReload,
}: {
  artifacts: Artifact[];
  files: PersonalFile[];
  workItems: WorkItem[];
  selected: ResultSelection | null;
  onSelect: (selection: ResultSelection | null) => void;
  onAddSource: () => void;
  onClose: () => void;
  renderPreview: (preview: ContentPreview, mode: PreviewMode) => ReactNode;
  errorMessage: (error: unknown, fallback: string) => string;
  runDescription: (workItem: WorkItem) => string;
  listState?: ResultListState;
  onReload: () => void;
}): React.JSX.Element {
  const [section, setSection] = useState<Section>("files");
  const loading = listState?.[section]?.loading ?? false;
  const loadError = listState?.[section]?.error;
  const [search, setSearch] = useState("");
  const [searchCollapsed, setSearchCollapsed] = useState<ReadonlySet<string>>(() => new Set());
  const [wide, setWide] = useState(false);
  const [openTabs, setOpenTabs] = useState<ResultSelection[]>([]);
  const [previewModes, setPreviewModes] = useState<Record<string, PreviewMode>>({});
  const [expandedDirectories, setExpandedDirectories] = useState<ReadonlySet<string>>(
    () => new Set([""]),
  );
  const searchRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const panelId = useId();
  const selectedKey = selected ? selectionKey(selected) : null;
  const previewMode = selectedKey ? (previewModes[selectedKey] ?? "preview") : "preview";
  const artifact =
    selected?.kind === "artifact" ? artifacts.find(({ id }) => id === selected.id) : undefined;
  const source =
    selected?.kind === "personal_file" ? files.find(({ id }) => id === selected.id) : undefined;
  const selectedItem = artifact ?? source;
  const itemFor = (item: ResultSelection): Artifact | PersonalFile | undefined =>
    item.kind === "artifact"
      ? artifacts.find(({ id }) => id === item.id)
      : files.find(({ id }) => id === item.id);
  const visibleTabs = openTabs.filter((item) => itemFor(item));
  const query = search.trim().toLocaleLowerCase();
  const matches = (name: string): boolean => name.toLocaleLowerCase().includes(query);
  const filteredArtifacts = artifacts.filter((item) => matches(item.displayName));
  const filteredFiles = files.filter(
    (item) => matches(item.displayName) || matches(item.sourceRelativePath),
  );

  const preview = useQuery({
    queryKey: [
      "content-preview",
      selected?.kind,
      selected?.id,
      artifact?.currentVersion,
      source?.revision,
    ],
    queryFn: () => {
      if (!selected) throw new Error("No content selected");
      return selected.kind === "artifact"
        ? window.openerx.previewArtifact({ artifactId: selected.id })
        : window.openerx.previewFile({ personalFileId: selected.id });
    },
    enabled: Boolean(selected && selectedItem),
    retry: false,
  });
  const save = useMutation({
    mutationFn: (artifactId: string) => window.openerx.saveArtifact({ artifactId }),
  });

  function showOverview(next: Section = section): void {
    setSection(next);
    onSelect(null);
  }

  function open(item: ResultSelection): void {
    setSection(item.kind === "artifact" ? "files" : "sources");
    setOpenTabs((previous) =>
      previous.some((tab) => selectionKey(tab) === selectionKey(item))
        ? previous
        : [...previous, item],
    );
    onSelect(item);
  }

  function closeTab(item: ResultSelection): void {
    const index = visibleTabs.findIndex((tab) => selectionKey(tab) === selectionKey(item));
    const remaining = visibleTabs.filter((tab) => selectionKey(tab) !== selectionKey(item));
    setOpenTabs(remaining);
    if (selectedKey === selectionKey(item))
      onSelect(remaining[Math.min(index, remaining.length - 1)] ?? null);
    window.requestAnimationFrame(() => {
      const target = panelRef.current?.querySelector<HTMLButtonElement>(
        remaining.length
          ? '.results-open-tabs [role="tab"][aria-selected="true"]'
          : '.results-sections [role="tab"][aria-selected="true"]',
      );
      target?.focus();
    });
  }

  useEffect(() => {
    if (!selected) return;
    setOpenTabs((previous) =>
      previous.some((tab) => selectionKey(tab) === selectionKey(selected))
        ? previous
        : [...previous, selected],
    );
  }, [selected]);

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent): void => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      // A dialog or the composer owns its own keyboard interaction.
      if (
        document.querySelector('[role="dialog"]') ||
        (event.target instanceof HTMLElement &&
          event.target.matches("input, textarea, [contenteditable=true]"))
      )
        return;
      if (selected) {
        onSelect(null);
        panelRef.current
          ?.querySelector<HTMLButtonElement>('[role="tab"][aria-selected="true"]')
          ?.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selected, onSelect]);

  const sections = [
    { id: "files", title: "文件", count: artifacts.length },
    { id: "sources", title: "来源", count: files.length },
    { id: "activity", title: "活动", count: workItems.length },
  ] as const;

  return (
    <aside
      ref={panelRef}
      className={`conversation-rail results-panel ${selected ? "is-preview" : ""} ${wide ? "is-wide" : ""}`}
      aria-label={
        selected ? (selected.kind === "artifact" ? "成果预览" : "来源预览") : "成果与来源"
      }
    >
      <header className="results-header">
        <strong>成果与来源</strong>
        <div className="results-header-actions">
          <button
            type="button"
            aria-label={wide ? "收窄面板" : "加宽面板"}
            title={wide ? "收窄面板" : "加宽面板"}
            aria-pressed={wide}
            onClick={() => setWide((value) => !value)}
          >
            {wide ? <ArrowsInSimple size={16} /> : <ArrowsOutSimple size={16} />}
          </button>
          <button
            type="button"
            aria-label="隐藏成果与来源"
            title="隐藏成果与来源"
            onClick={onClose}
          >
            <X size={17} />
          </button>
        </div>
      </header>
      <div
        className="results-sections"
        role="tablist"
        aria-label="成果面板内容"
        onKeyDown={navigateTabs}
      >
        {sections.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            id={`${panelId}-${item.id}`}
            aria-controls={`${panelId}-content`}
            aria-selected={!selected && section === item.id}
            tabIndex={section === item.id ? 0 : -1}
            onClick={() => {
              setSearch("");
              showOverview(item.id);
            }}
          >
            {item.title}
            <span>{item.count}</span>
          </button>
        ))}
      </div>
      {visibleTabs.length > 0 ? (
        <div
          className="results-open-tabs"
          role="tablist"
          aria-label="已打开的文件"
          onKeyDown={navigateTabs}
        >
          {visibleTabs.map((item, index) => {
            const label = itemFor(item)?.displayName ?? "文件";
            const key = selectionKey(item);
            return (
              <div
                className={`results-open-tab ${selectedKey === key ? "is-active" : ""}`}
                key={key}
              >
                <button
                  type="button"
                  role="tab"
                  id={`${panelId}-open-${index}`}
                  aria-controls={`${panelId}-content`}
                  aria-label={`${item.kind === "artifact" ? "成果" : "来源"} ${label}`}
                  title={`${item.kind === "artifact" ? "成果" : "来源"} · ${label}`}
                  aria-selected={selectedKey === key}
                  tabIndex={selectedKey === key || (!selected && index === 0) ? 0 : -1}
                  onClick={() => open(item)}
                  onKeyDown={(event) => {
                    if (event.key === "Delete") {
                      event.preventDefault();
                      closeTab(item);
                    }
                  }}
                >
                  {item.kind === "artifact" ? <FileText size={14} /> : <Paperclip size={14} />}
                  <span>{fileName(label)}</span>
                  {item.kind === "personal_file" ? (
                    <small className="results-source-badge">来源</small>
                  ) : null}
                </button>
                <button
                  type="button"
                  className="results-tab-close"
                  aria-label={`关闭 ${item.kind === "artifact" ? "成果" : "来源"} ${label}`}
                  title="关闭标签"
                  onClick={() => closeTab(item)}
                >
                  <X size={12} />
                </button>
              </div>
            );
          })}
        </div>
      ) : null}
      <div
        id={`${panelId}-content`}
        className="results-content"
        role="tabpanel"
        aria-labelledby={
          selected
            ? `${panelId}-open-${visibleTabs.findIndex((item) => selectionKey(item) === selectedKey)}`
            : `${panelId}-${section}`
        }
      >
        {selected ? (
          <>
            <div className="results-pathbar">
              <button
                type="button"
                aria-label="返回输出内容"
                title="返回文件列表"
                onClick={() => showOverview(selected.kind === "artifact" ? "files" : "sources")}
              >
                <SidebarSimple size={16} />
              </button>
              <span className="results-origin">
                {selected.kind === "artifact" ? "成果" : "来源"}
              </span>
              <CaretRight size={12} />
              <span className="results-path" title={selectedItem?.displayName}>
                {selectedItem?.displayName ?? "文件不可用"}
              </span>
              {artifact ? <small>v{artifact.currentVersion}</small> : null}
            </div>
            <div className="artifact-preview-toolbar results-preview-toolbar">
              {preview.data?.source != null ? (
                <fieldset className="artifact-preview-modes" aria-label="预览模式">
                  {(["preview", "source"] as const).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      className={previewMode === mode ? "is-active" : ""}
                      aria-pressed={previewMode === mode}
                      onClick={() =>
                        selectedKey &&
                        setPreviewModes((previous) => ({ ...previous, [selectedKey]: mode }))
                      }
                    >
                      {mode === "preview" ? "预览" : "源码"}
                    </button>
                  ))}
                </fieldset>
              ) : (
                <span className="results-format">{selectedItem?.format.toUpperCase()}</span>
              )}
              {artifact ? (
                <button
                  type="button"
                  disabled={save.isPending}
                  onClick={() => save.mutate(artifact.id)}
                >
                  <DownloadSimple size={15} />
                  {save.isPending ? "保存中…" : "下载 / 另存"}
                </button>
              ) : (
                <button type="button" onClick={onAddSource}>
                  管理来源
                </button>
              )}
            </div>
            <section className="artifact-preview-body results-preview-body" aria-live="polite">
              {!selectedItem ? (
                <div className="artifact-preview-state">
                  此文件已不在当前对话中。
                  <button type="button" onClick={() => showOverview()}>
                    返回列表
                  </button>
                </div>
              ) : preview.error ? (
                <div className="artifact-preview-state">
                  <p className="inline-error">
                    {errorMessage(preview.error, "暂时无法预览文件，请重试。")}
                  </p>
                  <button type="button" onClick={() => void preview.refetch()}>
                    重试
                  </button>
                </div>
              ) : preview.data ? (
                renderPreview(preview.data, previewMode)
              ) : (
                <div className="artifact-preview-state">正在准备预览…</div>
              )}
            </section>
            {save.variables === artifact?.id && (save.error || save.data) ? (
              <div className="results-save-status" role="status">
                {save.error
                  ? errorMessage(save.error, "成果保存失败，请重试。")
                  : `已保存 ${save.data?.fileName}`}
              </div>
            ) : null}
          </>
        ) : (
          <>
            {section !== "activity" ? (
              <div className="results-search-row">
                <label className="results-search">
                  <MagnifyingGlass size={15} />
                  <input
                    ref={searchRef}
                    aria-label={section === "files" ? "搜索成果文件" : "搜索来源文件"}
                    placeholder="搜索文件名或路径…"
                    value={search}
                    onChange={(event) => {
                      setSearch(event.target.value);
                      setSearchCollapsed(new Set());
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Escape") {
                        event.preventDefault();
                        setSearch("");
                      }
                    }}
                  />
                  {search ? (
                    <button
                      type="button"
                      aria-label="清除文件搜索"
                      onClick={() => {
                        setSearch("");
                        searchRef.current?.focus();
                      }}
                    >
                      <X size={13} />
                    </button>
                  ) : null}
                </label>
              </div>
            ) : null}
            <div className="results-list-scroll">
              {loadError ? (
                <div className="results-empty" role="alert">
                  <p>{errorMessage(loadError, "文件列表加载失败，请重试。")}</p>
                  <button type="button" onClick={onReload}>
                    重试
                  </button>
                </div>
              ) : loading ? (
                <p className="results-empty" role="status">
                  正在加载…
                </p>
              ) : section === "files" ? (
                <section aria-labelledby="rail-outputs-title">
                  <div className="results-list-heading">
                    <h2 id="rail-outputs-title">输出内容</h2>
                    <span>
                      {query ? `${filteredArtifacts.length} / ` : ""}
                      {artifacts.length} 个文件
                    </span>
                  </div>
                  {artifacts.length === 0 ? (
                    <div className="results-empty">
                      <FolderSimple size={28} />
                      <strong>还没有成果文件</strong>
                      <p>对话中生成的页面、文档和代码会显示在这里。</p>
                    </div>
                  ) : filteredArtifacts.length === 0 ? (
                    <div className="results-empty">
                      <p>没有匹配的文件</p>
                      <button type="button" onClick={() => setSearch("")}>
                        清除搜索
                      </button>
                    </div>
                  ) : (
                    <ArtifactDirectory
                      artifacts={filteredArtifacts}
                      compact
                      expandAll={Boolean(query)}
                      collapsedDirectories={searchCollapsed}
                      expandedDirectories={expandedDirectories}
                      onToggleDirectory={(path) =>
                        (query ? setSearchCollapsed : setExpandedDirectories)((previous) => {
                          const next = new Set(previous);
                          if (next.has(path)) next.delete(path);
                          else next.add(path);
                          return next;
                        })
                      }
                      onSelectArtifact={(id) => open({ kind: "artifact", id })}
                    />
                  )}
                </section>
              ) : section === "sources" ? (
                <section aria-labelledby="rail-sources-title">
                  <div className="results-list-heading">
                    <h2 id="rail-sources-title">来源</h2>
                    <button type="button" aria-label="添加来源" onClick={onAddSource}>
                      <Plus size={14} />
                      添加
                    </button>
                  </div>
                  <p className="results-list-hint">本对话使用的参考文件</p>
                  {files.length === 0 ? (
                    <div className="results-empty">
                      <FileText size={28} />
                      <strong>添加参考资料</strong>
                      <p>连接文件或工作区，为对话提供上下文。</p>
                      <button type="button" onClick={onAddSource}>
                        添加来源
                      </button>
                    </div>
                  ) : filteredFiles.length === 0 ? (
                    <div className="results-empty">
                      <p>没有匹配的来源</p>
                      <button type="button" onClick={() => setSearch("")}>
                        清除搜索
                      </button>
                    </div>
                  ) : (
                    <ul className="results-source-list">
                      {filteredFiles.map((file) => (
                        <li key={file.id}>
                          <button
                            type="button"
                            aria-label={`预览来源 ${file.displayName}`}
                            title={file.displayName}
                            onClick={() => open({ kind: "personal_file", id: file.id })}
                          >
                            <FileText size={16} />
                            <span>{file.displayName}</span>
                            <small className={file.parseStatus === "failed" ? "is-error" : ""}>
                              {parseLabels[file.parseStatus]}
                            </small>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              ) : (
                <section aria-labelledby="rail-runs-title">
                  <div className="results-list-heading">
                    <h2 id="rail-runs-title">本次运行</h2>
                    <span>{workItems.length} 次</span>
                  </div>
                  {workItems.length === 0 ? (
                    <div className="results-empty">
                      <TerminalWindow size={28} />
                      <p>开始对话后，在这里查看运行记录。</p>
                    </div>
                  ) : (
                    <ol className="results-activity-list">
                      {[...workItems]
                        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
                        .map((item) => (
                          <li key={item.id}>
                            <TerminalWindow size={16} />
                            <div>
                              <strong>{item.title}</strong>
                              <span>{runDescription(item)}</span>
                            </div>
                          </li>
                        ))}
                    </ol>
                  )}
                </section>
              )}
            </div>
            <footer className="results-footer">
              {section === "files" ? (
                <>
                  <span>当前对话的成果</span>
                  <NavLink to="/files">
                    全部成果
                    <CaretRight size={12} />
                  </NavLink>
                </>
              ) : section === "sources" ? (
                <>
                  <span>当前对话的上下文</span>
                  <button type="button" onClick={onAddSource}>
                    工作区与附件
                    <CaretRight size={12} />
                  </button>
                </>
              ) : (
                <span>运行记录按时间倒序排列</span>
              )}
            </footer>
          </>
        )}
      </div>
    </aside>
  );
}
