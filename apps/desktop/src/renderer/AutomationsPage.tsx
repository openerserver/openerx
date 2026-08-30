import type { AutomationDefinition, AutomationRun, AutomationSchedule } from "@openerx/contracts";
import { ArrowClockwise, Plus, X } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { NavLink, useSearchParams } from "react-router-dom";

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
  active: "运行中",
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
      <header className="automations-header">
        <div>
          <p className="eyebrow">本机调度 · Pi 执行</p>
          <h1>自动化</h1>
          <p>OpenerX 保持运行时，按计划启动任务并保留每次执行结果。</p>
        </div>
        <button type="button" className="primary-button" onClick={openCreate}>
          <Plus size={17} /> 新建自动化
        </button>
      </header>
      <section className="automation-runtime-settings" aria-label="自动化后台运行设置">
        <div>
          <strong>登录 Windows 后自动运行</strong>
          <span>在登录后静默启动到系统托盘，让计划任务自动恢复调度。</span>
        </div>
        <label>
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
          <span>
            {loginStartup.isPending
              ? "正在读取…"
              : loginStartup.data?.supported === false
                ? "当前平台不可用"
                : loginStartup.data?.openAtLogin
                  ? "已开启"
                  : "未开启"}
          </span>
        </label>
      </section>
      {error ? (
        <p className="inline-error" role="alert">
          {error instanceof Error ? error.message : "暂时无法更新自动化，请重试。"}
        </p>
      ) : null}

      {editorMode ? (
        <form
          className="automation-form settings-card"
          onSubmit={(event) => {
            event.preventDefault();
            if (editorMode === "edit") update.mutate();
            else create.mutate();
          }}
        >
          <div className="settings-heading">
            <div>
              <h2>{editorMode === "edit" ? "编辑自动化" : "新建自动化"}</h2>
              <p>高风险操作仍会暂停并等待你确认。</p>
            </div>
            <button type="button" className="icon-button" aria-label="关闭" onClick={closeEditor}>
              <X size={18} />
            </button>
          </div>
          <label>
            <span>名称</span>
            <input value={name} onChange={(event) => setName(event.target.value)} required />
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
          <div className="automation-form-grid">
            <label>
              <span>运行方式</span>
              <select value={kind} onChange={(event) => setKind(event.target.value as typeof kind)}>
                <option value="standalone">每次创建独立任务</option>
                <option value="heartbeat">在同一任务中持续跟进</option>
              </select>
            </label>
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
            <label>
              <span>IANA 时区</span>
              <input value={scheduleTimeZone} readOnly required placeholder="Asia/Shanghai" />
            </label>
            <label>
              <span>启动失败重试</span>
              <select
                value={retryPolicy}
                onChange={(event) => setRetryPolicy(event.target.value as typeof retryPolicy)}
              >
                <option value="none">不自动重试</option>
                <option value="transient_3">瞬时错误重试 3 次</option>
              </select>
            </label>
            <label>
              <span>休眠期间错过执行</span>
              <select
                value={catchUpPolicy}
                onChange={(event) => setCatchUpPolicy(event.target.value as typeof catchUpPolicy)}
              >
                <option value="skip">记录为已错过，不补跑</option>
                <option value="latest_once">唤醒后只补最近一次</option>
              </select>
            </label>
          </div>
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
          <p className="settings-note">
            关闭主窗口后仍会在系统托盘运行；明确退出 OpenerX、电脑休眠或未登录时不会执行。
          </p>
          <section className="automation-preview" aria-live="polite">
            <h3>未来执行时间</h3>
            {currentSchedule && preview.isFetching ? (
              <p className="muted-copy">正在计算执行时间…</p>
            ) : null}
            {preview.error ? (
              <p className="inline-error">
                {preview.error instanceof Error ? preview.error.message : "无法预览执行时间"}
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
          <div className="settings-actions">
            <button
              type="submit"
              className="primary-button"
              disabled={
                create.isPending || update.isPending || preview.isError || currentSchedule === null
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
            <button type="button" onClick={closeEditor}>
              取消
            </button>
          </div>
        </form>
      ) : null}

      <div className="automations-layout">
        <section className="automation-list" aria-label="自动化列表">
          {automations.isPending ? <p className="muted-copy">正在加载自动化…</p> : null}
          {!automations.isPending && (automations.data?.length ?? 0) === 0 ? (
            <div className="automation-empty">
              <ArrowClockwise size={30} />
              <h2>还没有自动化</h2>
              <p>创建日报、项目巡检或持续跟进任务。</p>
              <button type="button" onClick={openCreate}>
                创建第一个自动化
              </button>
            </div>
          ) : null}
          {automations.data?.map((item) => (
            <button
              type="button"
              className={`automation-list-item ${selectedId === item.id ? "selected" : ""}`}
              key={item.id}
              onClick={() => setSelectedId(item.id)}
            >
              <span className={`automation-status automation-status-${item.status}`} />
              <span>
                <strong>{item.name}</strong>
                <small>{scheduleLabel(item)}</small>
              </span>
              <small>{definitionStatus[item.status]}</small>
            </button>
          ))}
        </section>

        <section className="automation-detail" aria-label="自动化详情">
          {selected ? (
            <>
              <header>
                <div>
                  <p className="eyebrow">
                    {selected.kind === "heartbeat" ? "持续跟进" : "独立任务"}
                  </p>
                  <h2>{selected.name}</h2>
                  <p>{scheduleLabel(selected)}</p>
                </div>
                <span className={`status-pill status-${selected.status}`}>
                  {definitionStatus[selected.status]}
                </span>
              </header>
              <div className="automation-detail-actions">
                <button type="button" onClick={() => openEdit(selected)}>
                  编辑
                </button>
                <button
                  type="button"
                  onClick={() => runNow.mutate(selected.id)}
                  disabled={runNow.isPending}
                >
                  <ArrowClockwise size={16} /> 立即运行
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setStatus.mutate({ item: selected, active: selected.status !== "active" })
                  }
                  disabled={setStatus.isPending}
                >
                  {selected.status === "active" ? "暂停" : "恢复"}
                </button>
                <button
                  type="button"
                  className="danger-button"
                  onClick={() => remove.mutate(selected)}
                >
                  删除
                </button>
              </div>
              <section className="automation-prompt">
                <h3>任务描述</h3>
                <p>{selected.prompt}</p>
              </section>
              <dl className="automation-facts">
                <div>
                  <dt>下次执行</dt>
                  <dd>{displayTime(selected.nextRunAt)}</dd>
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
            </>
          ) : (
            <div className="automation-detail-placeholder">
              <ArrowClockwise size={28} />
              <p>选择一个自动化查看配置和运行历史。</p>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
