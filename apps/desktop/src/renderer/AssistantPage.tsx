import type {
  AutomationDefinition,
  ConversationSummary,
  PermissionRequest,
  WorkItem,
} from "@openerx/contracts";
import {
  ArrowRight,
  Bell,
  ChatCircle,
  CheckCircle,
  ClockCountdown,
  FolderSimple,
  Lightning,
  Sparkle,
  WarningCircle,
} from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { desktopBrand } from "../../../../packages/branding/src/index";

type AssistantState = "running" | "ready" | "attention" | "blocked" | "unavailable";

interface AssistantActivity {
  state: AssistantState;
  attentionCount: number;
  blockedItems: WorkItem[];
  readyItems: WorkItem[];
  runningItems: WorkItem[];
}

interface AssistantPageProps {
  companionEnabled: boolean;
  onCompanionEnabledChange: (enabled: boolean) => void;
}

const dateTimeFormatter = new Intl.DateTimeFormat("zh-CN", {
  month: "numeric",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

const assistantLastSeenStorageKey = "openerx.assistant.lastSeenAt";
const firstVisitLookbackMs = 24 * 60 * 60 * 1_000;
const assistantRefreshIntervalMs = 5_000;

function readAssistantLastSeenAt(): number {
  try {
    const storedValue = window.localStorage.getItem(assistantLastSeenStorageKey);
    if (storedValue) {
      const parsedValue = Date.parse(storedValue);
      if (Number.isFinite(parsedValue)) return parsedValue;
    }
  } catch {
    // Fall back to a short lookback when local storage is unavailable.
  }
  return Date.now() - firstVisitLookbackMs;
}

function markAssistantSeen(): void {
  try {
    window.localStorage.setItem(assistantLastSeenStorageKey, new Date().toISOString());
  } catch {
    // The current view still works when local storage is unavailable.
  }
}

function formatDateTime(value: string | null): string {
  if (!value) return "暂无安排";
  return dateTimeFormatter.format(new Date(value));
}

function updatedToday(value: string): boolean {
  const date = new Date(value);
  const now = new Date();
  return (
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  );
}

function assistantStateLabel(state: AssistantState): string {
  if (state === "unavailable") return "暂时离线";
  if (state === "blocked") return "遇到问题";
  if (state === "attention") return "需要关注";
  if (state === "running") return "处理中";
  return "已就绪";
}

function workItemStatusLabel(status: WorkItem["status"]): string {
  const labels: Record<WorkItem["status"], string> = {
    queued: "已排队",
    running: "正在处理",
    cancelling: "正在停止",
    waiting_for_user: "等待你的回复",
    waiting_for_permission: "等待权限确认",
    completed: "已完成",
    failed: "执行失败",
    interrupted: "已中断",
    cancelled: "已取消",
  };
  return labels[status];
}

function deriveAssistantActivity(
  workItems: WorkItem[],
  pendingPermissions: PermissionRequest[],
  activityCutoff: number,
  hasError: boolean,
  automationNeedsAttention = 0,
): AssistantActivity {
  const attentionIds = new Set(
    workItems
      .filter(({ status }) => ["waiting_for_user", "waiting_for_permission"].includes(status))
      .map(({ id }) => id),
  );
  for (const permission of pendingPermissions) attentionIds.add(permission.workItemId);

  const isNewTerminalItem = ({ updatedAt }: WorkItem): boolean =>
    Date.parse(updatedAt) > activityCutoff;
  const blockedItems = workItems.filter(
    (item) => ["failed", "interrupted"].includes(item.status) && isNewTerminalItem(item),
  );
  const readyItems = workItems.filter(
    (item) => item.status === "completed" && isNewTerminalItem(item),
  );
  const runningItems = workItems.filter(({ status }) =>
    ["queued", "running", "cancelling"].includes(status),
  );

  const state =
    attentionIds.size > 0
      ? "attention"
      : blockedItems.length > 0 || automationNeedsAttention > 0
        ? "blocked"
        : hasError
          ? "unavailable"
          : readyItems.length > 0
            ? "ready"
            : runningItems.length > 0
              ? "running"
              : "ready";

  return {
    state,
    attentionCount: attentionIds.size,
    blockedItems,
    readyItems,
    runningItems,
  };
}

function WatchRow({
  automation,
  onOpen,
}: {
  automation: AutomationDefinition;
  onOpen: () => void;
}): React.JSX.Element {
  return (
    <button type="button" className="assistant-watch-row" onClick={onOpen}>
      <span className={`assistant-watch-icon status-${automation.status}`} aria-hidden="true">
        <ClockCountdown size={18} weight="regular" />
      </span>
      <span className="assistant-watch-copy">
        <strong>{automation.name}</strong>
        <small>
          {automation.status === "active"
            ? `下次运行 · ${formatDateTime(automation.nextRunAt)}`
            : automation.status === "paused"
              ? "已暂停"
              : "需要重新启用"}
        </small>
      </span>
      <ArrowRight size={16} aria-hidden="true" />
    </button>
  );
}

function ConversationRow({
  conversation,
  onOpen,
}: {
  conversation: ConversationSummary;
  onOpen: () => void;
}): React.JSX.Element {
  return (
    <button type="button" className="assistant-watch-row" onClick={onOpen}>
      <span className="assistant-watch-icon status-conversation" aria-hidden="true">
        <ChatCircle size={18} weight="regular" />
      </span>
      <span className="assistant-watch-copy">
        <strong>{conversation.title}</strong>
        <small>{conversation.lastMessagePreview || "继续这段对话"}</small>
      </span>
      <ArrowRight size={16} aria-hidden="true" />
    </button>
  );
}

function WorkItemRow({
  workItem,
  onOpen,
}: {
  workItem: WorkItem;
  onOpen: () => void;
}): React.JSX.Element {
  return (
    <button type="button" className="assistant-watch-row" onClick={onOpen}>
      <span className={`assistant-watch-icon status-${workItem.status}`} aria-hidden="true">
        {workItem.status === "failed" || workItem.status === "interrupted" ? (
          <WarningCircle size={18} weight="regular" />
        ) : workItem.status === "completed" ? (
          <CheckCircle size={18} weight="regular" />
        ) : (
          <Lightning size={18} weight="regular" />
        )}
      </span>
      <span className="assistant-watch-copy">
        <strong>{workItem.title}</strong>
        <small>{workItemStatusLabel(workItem.status)}</small>
      </span>
      <ArrowRight size={16} aria-hidden="true" />
    </button>
  );
}

export function AssistantPage({
  companionEnabled,
  onCompanionEnabledChange,
}: AssistantPageProps): React.JSX.Element {
  const navigate = useNavigate();
  const [activityCutoff] = useState(readAssistantLastSeenAt);
  const automations = useQuery({
    queryKey: ["automations"],
    queryFn: () => window.openerx.listAutomations(),
    refetchInterval: assistantRefreshIntervalMs,
  });
  const conversations = useQuery({
    queryKey: ["chat", "list", false],
    queryFn: () => window.openerx.listConversations({ includeArchived: false }),
    refetchInterval: assistantRefreshIntervalMs,
  });
  const workItems = useQuery({
    queryKey: ["work-items", "assistant"],
    queryFn: () => window.openerx.listWorkItems({ limit: 50 }),
    refetchInterval: assistantRefreshIntervalMs,
  });
  const pendingPermissions = useQuery({
    queryKey: ["permissions", "pending"],
    queryFn: () => window.openerx.listPermissionRequests({ status: "pending" }),
    refetchInterval: assistantRefreshIntervalMs,
  });

  useEffect(() => {
    if (
      !workItems.isPending &&
      !pendingPermissions.isPending &&
      !workItems.error &&
      !pendingPermissions.error
    ) {
      markAssistantSeen();
    }
  }, [
    pendingPermissions.error,
    pendingPermissions.isPending,
    workItems.error,
    workItems.isPending,
  ]);

  const visibleAutomations = useMemo(
    () =>
      [...(automations.data ?? [])]
        .filter(({ status }) => status !== "deleted")
        .sort((left, right) => {
          const statusOrder: Record<AutomationDefinition["status"], number> = {
            active: 0,
            disabled_by_system: 1,
            paused: 2,
            deleted: 3,
          };
          if (left.status !== right.status) {
            return statusOrder[left.status] - statusOrder[right.status];
          }
          return (left.nextRunAt ?? "").localeCompare(right.nextRunAt ?? "");
        }),
    [automations.data],
  );
  const activeAutomations = visibleAutomations.filter(({ status }) => status === "active");
  const pausedAutomations = visibleAutomations.filter(({ status }) => status === "paused");
  const disabledAutomations = visibleAutomations.filter(
    ({ status }) => status === "disabled_by_system",
  );
  const recentConversations = [...(conversations.data ?? [])]
    .filter(({ archivedAt }) => archivedAt === null)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  const todayConversationCount = recentConversations.filter(({ updatedAt }) =>
    updatedToday(updatedAt),
  ).length;
  const sortedWorkItems = [...(workItems.data ?? [])].sort((left, right) =>
    right.updatedAt.localeCompare(left.updatedAt),
  );
  const nextAutomation = activeAutomations.find(({ nextRunAt }) => nextRunAt !== null) ?? null;
  const statusUnavailable = Boolean(
    workItems.error || pendingPermissions.error || automations.error || conversations.error,
  );
  const activity = deriveAssistantActivity(
    sortedWorkItems,
    pendingPermissions.data ?? [],
    activityCutoff,
    statusUnavailable,
    disabledAutomations.length,
  );
  const state = activity.state;
  const heroCopy =
    state === "unavailable"
      ? "部分工作状态暂时无法同步。你可以重新连接，我会从最新进度继续。"
      : state === "blocked"
        ? `有 ${activity.blockedItems.length + disabledAutomations.length} 项遇到问题。我把它们留在最前面。`
        : state === "attention"
          ? `有 ${activity.attentionCount} 项工作正等你确认。`
          : state === "running"
            ? `有 ${activity.runningItems.length} 个任务正在进行，我会继续替你盯住。`
            : activity.readyItems.length > 0
              ? `有 ${activity.readyItems.length} 项新结果已经完成，等你回来查看。`
              : activeAutomations.length > 0
                ? `今天有 ${activeAutomations.length} 个自动化由我照看。你可以去忙更重要的事。`
                : pausedAutomations.length > 0
                  ? `目前有 ${pausedAutomations.length} 个自动化暂停，需要时可以重新开启。`
                  : "我已经待命。建立第一个自动化后，我会替你持续盯住进展。";

  const retryAll = (): void => {
    void Promise.all([
      automations.refetch(),
      conversations.refetch(),
      workItems.refetch(),
      pendingPermissions.refetch(),
    ]);
  };

  return (
    <main className="assistant-page" aria-label="助手">
      <header className="assistant-page-header">
        <div>
          <span className="assistant-eyebrow">
            <Sparkle size={14} weight="fill" aria-hidden="true" /> {desktopBrand.assistantTitle}
          </span>
          <h1>你好，我是{desktopBrand.assistantName}</h1>
          <p>把后台工作变成一眼就懂的状态，在需要你时再轻轻提醒。</p>
        </div>
        <button
          type="button"
          className="assistant-header-action"
          onClick={() => navigate("/chat/new")}
        >
          开始对话 <ArrowRight size={16} aria-hidden="true" />
        </button>
      </header>

      <section
        className={`assistant-hero assistant-state-${state}`}
        aria-label={`${desktopBrand.assistantName}状态`}
      >
        <div className="assistant-hero-copy">
          <span className="assistant-status-pill">
            <span aria-hidden="true" /> {assistantStateLabel(state)}
          </span>
          <h2 aria-live="polite">{heroCopy}</h2>
          <p>
            {desktopBrand.assistantName}
            会汇总自动化和最近对话的进展；开启伴随模式后，它会常驻工作区右下角。
          </p>
          <div className="assistant-hero-actions">
            <button
              type="button"
              className="primary-action"
              onClick={() => onCompanionEnabledChange(!companionEnabled)}
            >
              {companionEnabled ? "收起伴随模式" : "开启伴随模式"}
            </button>
            <button type="button" onClick={() => navigate("/automations")}>
              查看自动化
            </button>
          </div>
        </div>
        <div className="assistant-mascot-stage" aria-hidden="true">
          <span className="assistant-mascot-halo" />
          {desktopBrand.assistantImageDataUrl ? (
            <img src={desktopBrand.assistantImageDataUrl} alt="" />
          ) : (
            <div className="assistant-mascot-fallback">
              <Sparkle size={62} weight="fill" aria-hidden="true" />
              <strong>{desktopBrand.markText}</strong>
            </div>
          )}
          <span className="assistant-mascot-caption">
            {statusUnavailable ? (
              <WarningCircle size={15} weight="fill" />
            ) : (
              <CheckCircle size={15} weight="fill" />
            )}
            {statusUnavailable ? " 状态待重试" : " 状态已同步"}
          </span>
        </div>
      </section>

      <section className="assistant-pulse" aria-label="今日工作脉搏">
        <article>
          <span>进行中的任务</span>
          <strong>{activity.runningItems.length}</strong>
          <small>{activity.runningItems.length > 0 ? "我会持续盯住" : "当前没有运行任务"}</small>
        </article>
        <article>
          <span>待你确认</span>
          <strong>{activity.attentionCount}</strong>
          <small>
            {activity.attentionCount > 0
              ? `${activity.attentionCount} 项需要你介入`
              : todayConversationCount > 0
                ? `今日 ${todayConversationCount} 段活跃对话`
                : "目前不需要你介入"}
          </small>
        </article>
        <article>
          <span>下一次行动</span>
          <strong className="assistant-next-run">
            {nextAutomation ? formatDateTime(nextAutomation.nextRunAt) : "暂无安排"}
          </strong>
          <small>{nextAutomation?.name ?? `${desktopBrand.assistantName}正在待命`}</small>
        </article>
      </section>

      <section className="assistant-dashboard-grid">
        <article className="assistant-panel assistant-watch-panel">
          <header>
            <div>
              <span className="assistant-panel-kicker">WORK PULSE</span>
              <h2>{desktopBrand.assistantName}正在关注</h2>
            </div>
            <button type="button" onClick={() => navigate("/automations")}>
              全部动态
            </button>
          </header>
          {automations.isPending ||
          conversations.isPending ||
          workItems.isPending ||
          pendingPermissions.isPending ? (
            <p className="assistant-panel-message">正在整理你的工作动态…</p>
          ) : null}
          {statusUnavailable ? (
            <div className="assistant-sync-error" role="status">
              <WarningCircle size={18} aria-hidden="true" />
              <span>有些动态暂时无法读取。</span>
              <button type="button" onClick={retryAll}>
                重新同步
              </button>
            </div>
          ) : null}
          {!automations.isPending &&
          !conversations.isPending &&
          !workItems.isPending &&
          !pendingPermissions.isPending &&
          !statusUnavailable &&
          sortedWorkItems.length === 0 &&
          visibleAutomations.length === 0 &&
          recentConversations.length === 0 ? (
            <div className="assistant-empty-watch">
              <Lightning size={24} weight="duotone" aria-hidden="true" />
              <strong>还没有需要关注的动态</strong>
              <p>创建自动化或开始对话后，{desktopBrand.assistantName}会在这里替你归拢进展。</p>
              <button type="button" onClick={() => navigate("/automations")}>
                创建自动化
              </button>
            </div>
          ) : null}
          <div className="assistant-watch-list">
            {sortedWorkItems.slice(0, 3).map((workItem) => (
              <WorkItemRow
                key={workItem.id}
                workItem={workItem}
                onOpen={() => navigate(`/chat/${workItem.conversationId}`)}
              />
            ))}
            {visibleAutomations
              .slice(0, Math.max(0, 3 - sortedWorkItems.length))
              .map((automation) => (
                <WatchRow
                  key={automation.id}
                  automation={automation}
                  onOpen={() =>
                    navigate(`/automations?automation=${encodeURIComponent(automation.id)}`)
                  }
                />
              ))}
            {recentConversations
              .slice(0, Math.max(0, 3 - sortedWorkItems.length - visibleAutomations.length))
              .map((conversation) => (
                <ConversationRow
                  key={conversation.id}
                  conversation={conversation}
                  onOpen={() => navigate(`/chat/${conversation.id}`)}
                />
              ))}
          </div>
        </article>

        <div className="assistant-side-stack">
          <article className="assistant-panel assistant-quick-panel">
            <span className="assistant-panel-kicker">QUICK START</span>
            <h2>我能马上帮你</h2>
            <button type="button" onClick={() => navigate("/chat/new")}>
              <ChatCircle size={18} />
              <span>
                <strong>开始一个任务</strong>
                <small>把目标告诉{desktopBrand.assistantName}</small>
              </span>
              <ArrowRight size={16} />
            </button>
            <button type="button" onClick={() => navigate("/automations")}>
              <ClockCountdown size={18} />
              <span>
                <strong>安排自动化</strong>
                <small>让工作按时发生</small>
              </span>
              <ArrowRight size={16} />
            </button>
            <button type="button" onClick={() => navigate("/files")}>
              <FolderSimple size={18} />
              <span>
                <strong>查看个人文件</strong>
                <small>继续处理已有资料</small>
              </span>
              <ArrowRight size={16} />
            </button>
          </article>

          <article className="assistant-panel assistant-preferences-panel">
            <span className="assistant-panel-kicker">COMPANION</span>
            <h2>陪伴设置</h2>
            <label>
              <span>
                <Bell size={18} />
                <span>
                  <strong>伴随模式</strong>
                  <small>常驻工作区，显示重要状态</small>
                </span>
              </span>
              <input
                type="checkbox"
                checked={companionEnabled}
                onChange={(event) => onCompanionEnabledChange(event.target.checked)}
              />
            </label>
            <p className="assistant-preference-note">
              <WarningCircle size={17} /> 待确认与异常事项会优先显示；设置仅保存在此设备。
            </p>
          </article>
        </div>
      </section>

      <section className="assistant-status-language" aria-label="助手状态说明">
        <div>
          <span className="status-running" />
          <strong>处理中</strong>
          <small>任务正在运行</small>
        </div>
        <div>
          <span className="status-attention" />
          <strong>待你确认</strong>
          <small>需要批准或选择</small>
        </div>
        <div>
          <span className="status-ready" />
          <strong>已就绪</strong>
          <small>有新的完成结果</small>
        </div>
        <div>
          <span className="status-blocked" />
          <strong>遇到问题</strong>
          <small>任务失败或被阻塞</small>
        </div>
      </section>
    </main>
  );
}

export function AssistantCompanion({ onOpen }: { onOpen: () => void }): React.JSX.Element {
  const automations = useQuery({
    queryKey: ["automations"],
    queryFn: () => window.openerx.listAutomations(),
    refetchInterval: assistantRefreshIntervalMs,
  });
  const workItems = useQuery({
    queryKey: ["work-items", "assistant"],
    queryFn: () => window.openerx.listWorkItems({ limit: 50 }),
    refetchInterval: assistantRefreshIntervalMs,
  });
  const pendingPermissions = useQuery({
    queryKey: ["permissions", "pending"],
    queryFn: () => window.openerx.listPermissionRequests({ status: "pending" }),
    refetchInterval: assistantRefreshIntervalMs,
  });
  const disabledAutomationCount = (automations.data ?? []).filter(
    ({ status }) => status === "disabled_by_system",
  ).length;
  const activity = deriveAssistantActivity(
    workItems.data ?? [],
    pendingPermissions.data ?? [],
    readAssistantLastSeenAt(),
    Boolean(workItems.error || pendingPermissions.error || automations.error),
    disabledAutomationCount,
  );
  const state = activity.state;
  const stateCount =
    state === "attention"
      ? activity.attentionCount
      : state === "blocked"
        ? activity.blockedItems.length + disabledAutomationCount
        : state === "running"
          ? activity.runningItems.length
          : activity.readyItems.length;
  const speech =
    state === "unavailable"
      ? "状态暂时无法同步。"
      : state === "attention"
        ? `有 ${stateCount} 项需要你确认。`
        : state === "blocked"
          ? `有 ${stateCount || 1} 项遇到问题。`
          : state === "running"
            ? `${stateCount} 个任务正在进行。`
            : stateCount > 0
              ? "有新的完成结果。"
              : "我在，随时帮你接住下一步。";
  return (
    <button
      type="button"
      className="assistant-companion"
      onClick={onOpen}
      aria-label="打开助手"
      aria-describedby="assistant-companion-status"
    >
      <span
        id="assistant-companion-status"
        className="assistant-companion-speech"
        aria-live="polite"
      >
        {speech}
      </span>
      <span className="assistant-companion-avatar">
        {desktopBrand.assistantImageDataUrl ? (
          <img src={desktopBrand.assistantImageDataUrl} alt="" />
        ) : (
          <div className="assistant-avatar-fallback" aria-hidden="true">
            {desktopBrand.markText}
          </div>
        )}
        <span className={`assistant-companion-state state-${state}`} aria-hidden="true" />
      </span>
    </button>
  );
}
