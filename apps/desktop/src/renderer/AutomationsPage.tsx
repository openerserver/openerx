import type { AutomationDefinition, AutomationRun, AutomationSchedule } from "@openerx/contracts";
import {
  ArrowClockwise,
  CaretRight,
  ClockCountdown,
  MagnifyingGlass,
  Pause,
  PencilSimple,
  Play,
  Plus,
  Trash,
  X,
} from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { NavLink, useSearchParams } from "react-router-dom";
import { desktopBrand } from "../../../../packages/branding/src/index";

function displayTime(value: string | null): string {
  if (!value) return "没有后续计划";
  return new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(
    new Date(value),
  );
}

function localDateTimeInput(value: string): string {
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

function defaultStartAtInput(): string {
  const next = new Date(Date.now() + 60 * 60_000);
  next.setSeconds(0, 0);
  return localDateTimeInput(next.toISOString());
}

function scheduleDraft(
  frequency: "once" | "daily" | "weekly",
  startAt: string,
  timezone: string,
): AutomationSchedule | null {
  const instantMs = Date.parse(startAt);
  if (Number.isNaN(instantMs)) return null;
  const instant = new Date(instantMs).toISOString();
  return frequency === "once"
    ? { mode: "once", expression: instant, timezone, startAt: instant }
    : {
        mode: "rrule",
        expression: frequency === "weekly" ? "FREQ=WEEKLY" : "FREQ=DAILY",
        timezone,
        startAt: instant,
      };
}

function scheduleLabel(item: AutomationDefinition): string {
  if (item.schedule.mode === "once") return `一次 · ${displayTime(item.schedule.expression)}`;
  const frequency = item.schedule.expression.includes("FREQ=WEEKLY") ? "每周" : "每天";
  return `${frequency} · ${displayTime(item.schedule.startAt)} 起`;
}

const definitionStatus: Record<AutomationDefinition["status"], string> = {
  active: "已启用",
  paused: "已暂停",
  disabled_by_system: "需要处理",
  deleted: "已删除",
};

const runStatus: Record<AutomationRun["status"], string> = {
  scheduled: "等待执行",
  claimed: "正在启动",
  starting: "正在启动",
  running: "执行中",
  succeeded: "已完成",
  failed: "失败",
  cancelled: "已取消",
  missed: "已错过",
  needs_attention: "需要处理",
  interrupted: "已中断",
  retry_scheduled: "等待重试",
  skipped_overlap: "任务重叠，已跳过",
};

type AutomationFilter = "all" | "active" | "paused" | "attention";
const automationFilters: Array<{ id: AutomationFilter; label: string }> = [
  { id: "all", label: "全部" },
  { id: "active", label: "已启用" },
  { id: "paused", label: "已暂停" },
  { id: "attention", label: "需处理" },
];

export function AutomationsPage({
  defaultModelRef,
}: {
  defaultModelRef: string;
}): React.JSX.Element {
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const [editorMode, setEditorMode] = useState<"create" | "edit" | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingRevision, setEditingRevision] = useState<number | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(() => searchParams.get("automation"));
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<AutomationFilter>("all");
  const [name, setName] = useState("");
  const [prompt, setPrompt] = useState("");
  const [kind, setKind] = useState<"standalone" | "heartbeat">("standalone");
  const [targetConversationId, setTargetConversationId] = useState("");
  const [editorModelRef, setEditorModelRef] = useState(defaultModelRef);
  const [retryPolicy, setRetryPolicy] = useState<"none" | "transient_3">("none");
  const [catchUpPolicy, setCatchUpPolicy] = useState<"skip" | "latest_once">("skip");
  const [frequency, setFrequency] = useState<"once" | "daily" | "weekly">("daily");
  const [startAt, setStartAt] = useState(defaultStartAtInput);
  const localTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const [scheduleTimeZone, setScheduleTimeZone] = useState(localTimeZone);

  useEffect(() => {
    const linkedAutomationId = searchParams.get("automation");
    if (linkedAutomationId) setSelectedId(linkedAutomationId);
  }, [searchParams]);

  const automations = useQuery({
    queryKey: ["automations"],
    queryFn: () => window.openerx.listAutomations(),
    refetchInterval: 30_000,
  });
  const loginStartup = useQuery({
    queryKey: ["desktop-login-startup"],
    queryFn: () => window.openerx.getLoginStartupSettings(),
  });
  const conversations = useQuery({
    queryKey: ["chat", "list", false],
    queryFn: () => window.openerx.listConversations(),
  });
  const selected = automations.data?.find(({ id }) => id === selectedId) ?? null;
  const filteredAutomations = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLocaleLowerCase();
    return (automations.data ?? []).filter((item) => {
      const statusMatches =
        statusFilter === "all" ||
        (statusFilter === "attention"
          ? item.status === "disabled_by_system"
          : item.status === statusFilter);
      const queryMatches =
        !normalizedQuery ||
        item.name.toLocaleLowerCase().includes(normalizedQuery) ||
        item.prompt.toLocaleLowerCase().includes(normalizedQuery);
      return statusMatches && queryMatches;
    });
  }, [automations.data, searchQuery, statusFilter]);
  const runs = useQuery({
    queryKey: ["automations", selectedId, "runs"],
    queryFn: () => window.openerx.listAutomationRuns({ automationId: String(selectedId) }),
    enabled: selectedId !== null,
    refetchInterval: selectedId ? 10_000 : false,
  });
  const currentSchedule = scheduleDraft(frequency, startAt, scheduleTimeZone);
  const preview = useQuery({
    queryKey: ["automations", "schedule-preview", currentSchedule],
    queryFn: () => {
      const schedule = scheduleDraft(frequency, startAt, scheduleTimeZone);
      if (!schedule) return Promise.resolve({ occurrences: [] });
      return window.openerx.previewAutomationSchedule({ schedule, count: 5 });
    },
    enabled: editorMode !== null && currentSchedule !== null,
    staleTime: 60_000,
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["automations"] });
  const closeEditor = (): void => {
    setEditorMode(null);
    setEditingId(null);
    setEditingRevision(null);
  };
  const openCreate = (): void => {
    setEditorMode("create");
    setEditingId(null);
    setEditingRevision(null);
    setName("");
    setPrompt("");
    setKind("standalone");
    setTargetConversationId("");
    setFrequency("daily");
    setStartAt(defaultStartAtInput());
    setScheduleTimeZone(localTimeZone);
    setEditorModelRef(defaultModelRef);
    setRetryPolicy("none");
    setCatchUpPolicy("skip");
  };
  const openEdit = (item: AutomationDefinition): void => {
    setEditorMode("edit");
    setEditingId(item.id);
    setEditingRevision(item.revision);
    setName(item.name);
    setPrompt(item.prompt);
    setKind(item.kind);
    setTargetConversationId(item.target.conversationId ?? "");
    setFrequency(
      item.schedule.mode === "once"
        ? "once"
        : item.schedule.expression.includes("FREQ=WEEKLY")
          ? "weekly"
          : "daily",
    );
    setStartAt(localDateTimeInput(item.schedule.startAt));
    setScheduleTimeZone(item.schedule.timezone);
    setEditorModelRef(item.execution.modelRef);
    setRetryPolicy(item.execution.retryPolicy);
    setCatchUpPolicy(item.execution.catchUpPolicy);
  };
  const create = useMutation({
    mutationFn: () => {
      const schedule = scheduleDraft(frequency, startAt, scheduleTimeZone);
      if (!schedule) throw new Error("AUTOMATION_TIME_INVALID");
      return window.openerx.createAutomation({
        name,
        prompt,
        kind,
        execution: { modelRef: editorModelRef, retryPolicy, catchUpPolicy },
        ...(kind === "heartbeat"
          ? {
              target: {
                conversationId: targetConversationId,
                branchId: null,
                workspaceGrantIds: [],
              },
            }
          : {}),
        schedule,
      });
    },
    onSuccess: async (item) => {
      closeEditor();
      setSelectedId(item.id);
      await refresh();
    },
  });
  const update = useMutation({
    mutationFn: () => {
      const schedule = scheduleDraft(frequency, startAt, scheduleTimeZone);
      if (!schedule) throw new Error("AUTOMATION_TIME_INVALID");
      if (!editingId || !editingRevision) throw new Error("AUTOMATION_NOT_FOUND");
      return window.openerx.updateAutomation({
        automationId: editingId,
        revision: editingRevision,
        changes: {
          name,
          prompt,
          kind,
          schedule,
          target: {
            conversationId: kind === "heartbeat" ? targetConversationId : null,
            branchId: null,
            workspaceGrantIds: [],
          },
          execution: { modelRef: editorModelRef, retryPolicy, catchUpPolicy },
        },
      });
    },
    onSuccess: async (item) => {
      closeEditor();
      setSelectedId(item.id);
      await refresh();
    },
  });
  const setStatus = useMutation({
    mutationFn: ({ item, active }: { item: AutomationDefinition; active: boolean }) =>
      active
        ? window.openerx.resumeAutomation({ automationId: item.id, revision: item.revision })
        : window.openerx.pauseAutomation({ automationId: item.id, revision: item.revision }),
    onSuccess: refresh,
  });
  const runNow = useMutation({
    mutationFn: (automationId: string) => window.openerx.runAutomationNow({ automationId }),
    onSuccess: async () => {
      await refresh();
      await queryClient.invalidateQueries({ queryKey: ["automations", selectedId, "runs"] });
    },
  });
  const remove = useMutation({
    mutationFn: (item: AutomationDefinition) =>
      window.openerx.deleteAutomation({ automationId: item.id, revision: item.revision }),
    onSuccess: async () => {
      setSelectedId(null);
      await refresh();
    },
  });
  const updateLoginStartup = useMutation({
    mutationFn: (openAtLogin: boolean) =>
      window.openerx.updateLoginStartupSettings({ openAtLogin }),
    onSuccess: (settings) => {
      queryClient.setQueryData(["desktop-login-startup"], settings);
    },
  });
  const error =
    create.error ??
    update.error ??
    setStatus.error ??
    runNow.error ??
    remove.error ??
    updateLoginStartup.error ??
    loginStartup.error ??
    automations.error;

  return (
    <main className="automations-page">
      <div className="automations-topbar">
        <div />
        <button type="button" className="automation-create-button" onClick={openCreate}>
          <Plus size={15} weight="bold" />
          新建自动化
        </button>
      </div>

      <div className="automations-content">
        <header className="automations-header">
          <h1>自动化</h1>
          <p>按计划启动任务、持续跟进工作，或监测重要变化</p>
        </header>
        <label className="automation-search">
          <MagnifyingGlass size={19} aria-hidden="true" />
          <input
            type="search"
            aria-label="搜索自动化"
            placeholder="搜索自动化"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
          />
          {searchQuery ? (
            <button type="button" aria-label="清除搜索" onClick={() => setSearchQuery("")}>
              <X size={14} />
            </button>
          ) : null}
        </label>
        <nav className="automation-filters" aria-label="筛选自动化">
          {automationFilters.map((filter) => (
            <button
              type="button"
              key={filter.id}
              className={statusFilter === filter.id ? "is-active" : ""}
              aria-pressed={statusFilter === filter.id}
              onClick={() => setStatusFilter(filter.id)}
            >
              {filter.label}
            </button>
          ))}
        </nav>
        {error ? (
          <p className="inline-error automation-inline-error" role="alert">
            {error instanceof Error ? error.message : "暂时无法更新自动化，请重试。"}
          </p>
        ) : null}

        <section className="automation-list" aria-label="自动化列表">
          {automations.isPending ? (
            <div className="automation-loading" aria-live="polite">
              <ArrowClockwise size={18} className="automation-spin" /> 正在加载自动化…
            </div>
          ) : null}
          {!automations.isPending && (automations.data?.length ?? 0) === 0 ? (
            <div className="automation-empty">
              <span className="automation-empty-icon">
                <ClockCountdown size={24} />
              </span>
              <h2>还没有自动化</h2>
              <p>创建日报、项目巡检或持续跟进任务。</p>
              <button type="button" onClick={openCreate}>
                创建第一个自动化
              </button>
            </div>
          ) : null}
          {!automations.isPending &&
          (automations.data?.length ?? 0) > 0 &&
          filteredAutomations.length === 0 ? (
            <div className="automation-empty automation-empty-compact">
              <h2>没有匹配的自动化</h2>
              <p>换个关键词或筛选条件试试。</p>
            </div>
          ) : null}
          {filteredAutomations.map((item) => (
            <button
              type="button"
              className="automation-list-item"
              key={item.id}
              onClick={() => setSelectedId(item.id)}
            >
              <span className={`automation-status automation-status-${item.status}`} />
              <span className="automation-list-copy">
                <span className="automation-list-title">
                  <strong>{item.name}</strong>
                  <small>{definitionStatus[item.status]}</small>
                </span>
                <span>
                  {scheduleLabel(item)} · 下次运行 {displayTime(item.nextRunAt)}
                </span>
                <small>{item.prompt}</small>
              </span>
              <CaretRight size={17} className="automation-row-caret" />
            </button>
          ))}
        </section>

        <section className="automation-runtime-settings" aria-label="自动化后台运行设置">
          <span className="automation-runtime-icon">
            <ClockCountdown size={18} />
          </span>
          <div>
            <strong>后台运行</strong>
            <span>登录 Windows 后静默启动，让计划任务保持调度。</span>
          </div>
          <label className="automation-switch">
            <input
              type="checkbox"
              aria-label="登录 Windows 后自动运行"
              checked={loginStartup.data?.openAtLogin ?? false}
              disabled={
                loginStartup.isPending ||
                loginStartup.data?.supported === false ||
                updateLoginStartup.isPending
              }
              onChange={(event) => updateLoginStartup.mutate(event.target.checked)}
            />
            <span aria-hidden="true" />
            <small>
              {loginStartup.isPending
                ? "正在读取…"
                : loginStartup.data?.supported === false
                  ? "当前平台不可用"
                  : loginStartup.data?.openAtLogin
                    ? "已开启"
                    : "未开启"}
            </small>
          </label>
        </section>
      </div>

      {editorMode || selected ? (
        <div className="automation-drawer-backdrop">
          {editorMode ? (
            <aside
              className="automation-drawer automation-editor-drawer"
              role="dialog"
              aria-modal="true"
            >
              <form
                className="automation-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (editorMode === "edit") update.mutate();
                  else create.mutate();
                }}
              >
                <header className="automation-drawer-header">
                  <div>
                    <h2>{editorMode === "edit" ? "编辑自动化" : "新建自动化"}</h2>
                    <p>设置任务内容和运行节奏</p>
                  </div>
                  <button
                    type="button"
                    className="icon-button"
                    aria-label="关闭"
                    onClick={closeEditor}
                  >
                    <X size={18} />
                  </button>
                </header>
                <div className="automation-form-body">
                  <section className="automation-form-section">
                    <h3>任务</h3>
                    <label>
                      <span>名称</span>
                      <input
                        value={name}
                        onChange={(event) => setName(event.target.value)}
                        required
                      />
                    </label>
                    <label>
                      <span>任务描述</span>
                      <textarea
                        value={prompt}
                        onChange={(event) => setPrompt(event.target.value)}
                        rows={5}
                        required
                        placeholder="例如：检查当前项目的变更，运行测试并生成简短日报"
                      />
                    </label>
                    <label>
                      <span>运行方式</span>
                      <select
                        value={kind}
                        onChange={(event) => setKind(event.target.value as typeof kind)}
                      >
                        <option value="standalone">每次创建独立任务</option>
                        <option value="heartbeat">在同一任务中持续跟进</option>
                      </select>
                    </label>
                    {kind === "heartbeat" ? (
                      <label>
                        <span>持续跟进的任务</span>
                        <select
                          value={targetConversationId}
                          onChange={(event) => setTargetConversationId(event.target.value)}
                          required
                        >
                          <option value="">请选择任务</option>
                          {conversations.data?.map((conversation) => (
                            <option value={conversation.id} key={conversation.id}>
                              {conversation.title}
                            </option>
                          ))}
                        </select>
                      </label>
                    ) : null}
                  </section>
                  <section className="automation-form-section">
                    <h3>计划</h3>
                    <div className="automation-form-grid">
                      <label>
                        <span>频率</span>
                        <select
                          value={frequency}
                          onChange={(event) => setFrequency(event.target.value as typeof frequency)}
                        >
                          <option value="once">仅一次</option>
                          <option value="daily">每天</option>
                          <option value="weekly">每周</option>
                        </select>
                      </label>
                      <label>
                        <span>首次执行</span>
                        <input
                          type="datetime-local"
                          value={startAt}
                          onChange={(event) => setStartAt(event.target.value)}
                          required
                        />
                      </label>
                    </div>
                    <label>
                      <span>IANA 时区</span>
                      <input
                        value={scheduleTimeZone}
                        readOnly
                        required
                        placeholder="Asia/Shanghai"
                      />
                    </label>
                  </section>
                  <section className="automation-form-section">
                    <h3>执行设置</h3>
                    <label>
                      <span>使用模型</span>
                      <input
                        value={editorModelRef}
                        onChange={(event) => setEditorModelRef(event.target.value)}
                        required
                      />
                    </label>
                    <div className="automation-form-grid">
                      <label>
                        <span>启动失败重试</span>
                        <select
                          value={retryPolicy}
                          onChange={(event) =>
                            setRetryPolicy(event.target.value as typeof retryPolicy)
                          }
                        >
                          <option value="none">不自动重试</option>
                          <option value="transient_3">瞬时错误重试 3 次</option>
                        </select>
                      </label>
                      <label>
                        <span>休眠期间错过执行</span>
                        <select
                          value={catchUpPolicy}
                          onChange={(event) =>
                            setCatchUpPolicy(event.target.value as typeof catchUpPolicy)
                          }
                        >
                          <option value="skip">记录为已错过，不补跑</option>
                          <option value="latest_once">唤醒后只补最近一次</option>
                        </select>
                      </label>
                    </div>
                    <p className="settings-note">
                      高风险操作仍会暂停并等待确认；明确退出 {desktopBrand.productName}
                      、电脑休眠或未登录时不会执行。
                    </p>
                  </section>
                  <section className="automation-preview" aria-live="polite">
                    <h3>未来执行时间</h3>
                    {currentSchedule && preview.isFetching ? (
                      <p className="muted-copy">正在计算执行时间…</p>
                    ) : null}
                    {preview.error ? (
                      <p className="inline-error">
                        {preview.error instanceof Error
                          ? preview.error.message
                          : "无法预览执行时间"}
                      </p>
                    ) : null}
                    {!currentSchedule ? <p className="muted-copy">请选择有效的执行时间。</p> : null}
                    {preview.data?.occurrences.length ? (
                      <ol>
                        {preview.data.occurrences.map((occurrence) => (
                          <li key={occurrence}>{displayTime(occurrence)}</li>
                        ))}
                      </ol>
                    ) : currentSchedule && !preview.isFetching && !preview.error ? (
                      <p className="muted-copy">当前规则没有未来执行时间。</p>
                    ) : null}
                  </section>
                </div>
                <footer className="automation-form-actions">
                  <button type="button" onClick={closeEditor}>
                    取消
                  </button>
                  <button
                    type="submit"
                    className="automation-primary-action"
                    disabled={
                      create.isPending ||
                      update.isPending ||
                      preview.isError ||
                      currentSchedule === null
                    }
                  >
                    {editorMode === "edit"
                      ? update.isPending
                        ? "正在保存…"
                        : "保存修改"
                      : create.isPending
                        ? "正在创建…"
                        : "创建自动化"}
                  </button>
                </footer>
              </form>
            </aside>
          ) : selected ? (
            <aside className="automation-drawer automation-detail" role="dialog" aria-modal="true">
              <header className="automation-drawer-header">
                <div>
                  <span className="automation-detail-kicker">
                    {selected.kind === "heartbeat" ? "持续跟进" : "独立任务"}
                  </span>
                  <h2>{selected.name}</h2>
                  <p>{scheduleLabel(selected)}</p>
                </div>
                <button
                  type="button"
                  className="icon-button"
                  aria-label="关闭"
                  onClick={() => setSelectedId(null)}
                >
                  <X size={18} />
                </button>
              </header>
              <div className="automation-detail-body">
                <div className="automation-detail-status-row">
                  <span className={`automation-status automation-status-${selected.status}`} />
                  <strong>{definitionStatus[selected.status]}</strong>
                  <span>下次运行 {displayTime(selected.nextRunAt)}</span>
                </div>
                <div className="automation-detail-actions">
                  <button type="button" onClick={() => openEdit(selected)}>
                    <PencilSimple size={15} /> 编辑
                  </button>
                  <button
                    type="button"
                    onClick={() => runNow.mutate(selected.id)}
                    disabled={runNow.isPending}
                  >
                    <Play size={15} /> 立即运行
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setStatus.mutate({ item: selected, active: selected.status !== "active" })
                    }
                    disabled={setStatus.isPending}
                  >
                    {selected.status === "active" ? <Pause size={15} /> : <Play size={15} />}
                    {selected.status === "active" ? "暂停" : "恢复"}
                  </button>
                  <button
                    type="button"
                    className="danger-button"
                    onClick={() => remove.mutate(selected)}
                  >
                    <Trash size={15} /> 删除
                  </button>
                </div>
                <section className="automation-prompt">
                  <h3>任务描述</h3>
                  <p>{selected.prompt}</p>
                </section>
                <dl className="automation-facts">
                  <div>
                    <dt>运行方式</dt>
                    <dd>{selected.kind === "heartbeat" ? "持续跟进" : "独立任务"}</dd>
                  </div>
                  <div>
                    <dt>模型</dt>
                    <dd>{selected.execution.modelRef}</dd>
                  </div>
                  <div>
                    <dt>时区</dt>
                    <dd>{selected.schedule.timezone}</dd>
                  </div>
                  <div>
                    <dt>错过执行</dt>
                    <dd>
                      {selected.execution.catchUpPolicy === "latest_once"
                        ? "唤醒后补最近一次"
                        : "记录并跳过"}
                    </dd>
                  </div>
                </dl>
                <section className="automation-runs">
                  <h3>运行历史</h3>
                  {runs.isPending ? <p className="muted-copy">正在读取运行历史…</p> : null}
                  {runs.data?.map((run) => (
                    <article key={run.id}>
                      <span className={`automation-run-status run-${run.status}`}>
                        {runStatus[run.status]}
                      </span>
                      <div>
                        <strong>{displayTime(run.scheduledFor)}</strong>
                        <small>
                          {run.trigger === "manual" ? "手动运行" : "计划运行"}
                          {run.failureCode ? ` · ${run.failureCode}` : ""}
                        </small>
                      </div>
                      {run.conversationId ? (
                        <NavLink to={`/chat/${run.conversationId}`}>查看任务</NavLink>
                      ) : null}
                    </article>
                  ))}
                  {!runs.isPending && (runs.data?.length ?? 0) === 0 ? (
                    <p className="muted-copy">尚无运行记录。</p>
                  ) : null}
                </section>
              </div>
            </aside>
          ) : null}
        </div>
      ) : null}
    </main>
  );
}
