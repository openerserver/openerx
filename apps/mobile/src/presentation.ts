import type { DecryptedRemoteEvent } from "./remote-controller";

const errorMessages: Record<string, string> = {
  CHALLENGE_CODE_INVALID: "验证码不正确，请重新输入。",
  CHALLENGE_EXPIRED: "验证码已过期，请重新发送。",
  CHALLENGE_NOT_FOUND: "验证码已失效，请重新发送。",
  CHALLENGE_ALREADY_USED: "验证码已使用，请重新发送。",
  BYOK_API_KEY_REQUIRED: "电脑尚未配置可用模型，请在电脑的“设置 → 模型”中配置后重试。",
  BYOK_NOT_CONFIGURED: "请先在电脑的“设置 → 模型”中配置模型。",
  PLATFORM_MODEL_NOT_FOUND: "电脑上的模型不可用，请检查电脑的模型设置后重试。",
  MODEL_UNAVAILABLE: "模型暂时不可用，请稍后重试或在电脑上切换模型。",
  ACCESS_TOKEN_INVALID: "登录正在恢复，请稍后重试。若持续失败，请退出后重新登录。",
  ACCESS_TOKEN_EXPIRED: "登录已过期，请重新登录。",
  DEVICE_SESSION_REVOKED: "此手机的登录已被撤销，请重新登录。",
  SESSION_CHANGED: "登录状态已改变，请重新登录。",
  SESSION_REFRESH_FAILED: "暂时无法恢复登录，请检查网络后重试。",
  REMOTE_HOST_OFFLINE: "电脑已离线，请保持电脑开机并打开 openerx。",
  REMOTE_HOST_NOT_SELECTED: "请先在“电脑”页连接一台电脑。",
  REMOTE_PAIRING_NOT_ACTIVE: "此手机的授权已失效，请重新申请连接。",
  REMOTE_BASE_REVISION_CONFLICT: "任务状态已更新，请查看最新内容后重试。",
  REMOTE_COMMAND_TIMEOUT: "电脑尚未确认操作。请先查看任务状态，避免重复提交。",
  REMOTE_COMMAND_OUTCOME_UNKNOWN: "操作结果尚未确认，请到电脑检查后再决定是否重试。",
  REMOTE_PAIRING_QR_INVALID: "这不是有效的 openerx 配对码，请扫描电脑上显示的二维码。",
  ACCOUNT_SCOPE_VIOLATION: "手机与电脑需要登录同一个账户。",
  REMOTE_REAUTHENTICATION_REQUIRED: "未完成身份验证，此次审批没有提交。",
  REMOTE_PERMISSION_EXPIRED: "此项审批已过期，请查看电脑上的最新状态。",
  NetworkError: "网络连接失败，请检查网络后重试。",
};

export function mobileErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error ?? "");
  const code = message.split(":", 1)[0] ?? "";
  if (errorMessages[code]) return errorMessages[code];
  if (/network|fetch|timeout|网络/iu.test(message))
    return "连接暂时不可用，请检查网络和电脑状态后重试。";
  if (/CHALLENGE.*(EXPIRED|USED|CONSUMED)/u.test(code)) return "验证码已失效，请重新发送。";
  return "操作未完成，请稍后重试；若持续失败，请在电脑上检查。";
}

export type TaskStatus = "running" | "waiting" | "completed" | "failed" | "stopped";
export interface MobileMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  status: TaskStatus;
  reason?: string;
  cancellationRequested?: boolean;
}
export interface MobileTask {
  id: string;
  hostDeviceId: string;
  title: string;
  updatedAt: string;
  status: TaskStatus;
  messages: MobileMessage[];
  activeMessageId: string | null;
}

export function taskStatusLabel(status: TaskStatus): string {
  return {
    running: "正在执行",
    waiting: "等待审批",
    completed: "已完成",
    failed: "未完成",
    stopped: "已停止",
  }[status];
}

export function mergeRemoteEvents(
  current: DecryptedRemoteEvent[],
  next: DecryptedRemoteEvent[],
): DecryptedRemoteEvent[] {
  const events = new Map(current.map((event) => [event.envelope.eventId, event]));
  for (const event of next) events.set(event.envelope.eventId, event);
  return [...events.values()].slice(-1_000);
}

function messageStatus(value: unknown): TaskStatus {
  if (value === "completed") return "completed";
  if (value === "failed" || value === "interrupted") return "failed";
  if (value === "stopped" || value === "cancelled") return "stopped";
  return "running";
}

export function remoteTasks(events: DecryptedRemoteEvent[]): MobileTask[] {
  const tasks = new Map<string, MobileTask>();
  for (const { envelope, payload } of events) {
    const id = envelope.conversationId;
    if (!id) continue;
    const task = tasks.get(id) ?? {
      id,
      hostDeviceId: envelope.hostDeviceId,
      title: "电脑任务",
      updatedAt: envelope.occurredAt,
      status: "running",
      messages: [],
      activeMessageId: null,
    };
    if (typeof payload.title === "string") task.title = payload.title;
    task.updatedAt = envelope.occurredAt;
    const user = payload.userMessage as { id?: string; text?: string } | undefined;
    if (user?.id && typeof user.text === "string" && !task.messages.some((m) => m.id === user.id)) {
      const message: MobileMessage = {
        id: user.id,
        role: "user",
        text: user.text,
        status: "completed",
      };
      const assistantIndex = task.messages.findIndex((m) => m.id === payload.assistantMessageId);
      if (assistantIndex < 0) task.messages.push(message);
      else task.messages.splice(assistantIndex, 0, message);
      if (task.title === "电脑任务") task.title = user.text.slice(0, 60);
    }
    const snapshot = payload.message as
      | {
          id?: string;
          role?: string;
          text?: string;
          status?: string;
          reason?: string;
          cancellationRequested?: boolean;
        }
      | undefined;
    const messageId =
      snapshot?.id ?? (typeof payload.messageId === "string" ? payload.messageId : null);
    if (messageId && (snapshot || envelope.kind.startsWith("message."))) {
      let message = task.messages.find((m) => m.id === messageId);
      if (!message) {
        message = {
          id: messageId,
          role: snapshot?.role === "user" ? "user" : "assistant",
          text: "",
          status: "running",
        };
        task.messages.push(message);
      }
      if (typeof snapshot?.text === "string") message.text = snapshot.text;
      else if (envelope.kind === "message.delta" && typeof payload.delta === "string")
        message.text += payload.delta;
      if (envelope.kind === "message.cancelling" || snapshot?.cancellationRequested)
        message.cancellationRequested = true;
      if (snapshot?.status) message.status = messageStatus(snapshot.status);
      else if (envelope.kind !== "message.delta")
        message.status = messageStatus(envelope.kind.replace("message.", ""));
      if (
        message.cancellationRequested &&
        (snapshot?.status === "interrupted" || envelope.kind === "message.interrupted")
      )
        message.status = "stopped";
      if (typeof payload.reason === "string") message.reason = payload.reason;
      else if (snapshot?.reason) message.reason = snapshot.reason;
    }
    if (envelope.kind === "attention.requested") task.status = "waiting";
    if (envelope.kind === "attention.resolved" || envelope.kind === "attention.expired")
      task.status = "running";
    const lastAssistant = task.messages.filter((m) => m.role === "assistant").at(-1);
    if (lastAssistant) {
      if (lastAssistant.status !== "running" || task.status !== "waiting")
        task.status = lastAssistant.status;
      task.activeMessageId = lastAssistant.status === "running" ? lastAssistant.id : null;
    }
    tasks.set(id, task);
  }
  return [...tasks.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function pendingAttention(
  events: DecryptedRemoteEvent[],
  now = Date.now(),
): DecryptedRemoteEvent[] {
  const resolved = new Set(
    events
      .filter(({ envelope }) => ["attention.resolved", "attention.expired"].includes(envelope.kind))
      .map(({ payload }) => payload.permissionRequestId),
  );
  return events.filter(
    ({ envelope, payload }) =>
      envelope.kind === "attention.requested" &&
      !resolved.has(payload.permissionRequestId) &&
      (typeof payload.expiresAt !== "string" || Date.parse(payload.expiresAt) > now),
  );
}
