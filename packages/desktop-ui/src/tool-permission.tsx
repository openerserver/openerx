import type { PermissionRequest } from "@openerx/contracts";
import type { ReactNode } from "react";

export type ToolPermissionChoice = "once" | "session" | "deny" | "full_access";

// Both desktop editions render the same permission request; hosts own decisions and scope.
export function ToolPermissionPrompt({
  permission,
  pendingCount = 1,
  busy,
  error,
  choice,
  onDecision,
  icon,
  details,
  fullAccess = false,
  session = false,
}: {
  permission: PermissionRequest;
  pendingCount?: number;
  busy: boolean;
  error?: string;
  choice?: ToolPermissionChoice;
  onDecision(choice: ToolPermissionChoice): void;
  icon?: ReactNode;
  details?: ReactNode;
  fullAccess?: boolean;
  session?: boolean;
}) {
  return (
    <>
      <div className="pending-approval-heading" role="alert" aria-atomic="true">
        {icon}
        <div>
          <strong>需要你的允许</strong>
          <p>当前操作正在等待确认{pendingCount > 1 ? ` · 共 ${pendingCount} 项待处理` : ""}</p>
        </div>
      </div>
      <section className="pending-approval-details" aria-label="工具权限确认">
        <strong>{permission.reason}</strong>
        <span>{permission.resource}</span>
        <small>
          {permission.capability} · {permission.risk}
        </small>
        {details}
      </section>
      <footer className="pending-approval-footer">
        {error ? (
          <p className="inline-error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="pending-approval-actions">
          {fullAccess && (
            <button
              type="button"
              disabled={busy}
              title="允许当前待审批操作，并在此对话中不再逐次询问；可在输入框恢复请求审批"
              onClick={() => onDecision("full_access")}
            >
              {busy && choice === "full_access" ? "正在开启完全访问…" : "完全访问"}
            </button>
          )}
          {session && ["L1", "L2", "L3"].includes(permission.risk) && (
            <button type="button" disabled={busy} onClick={() => onDecision("session")}>
              在此对话中允许
            </button>
          )}
          <button type="button" disabled={busy} onClick={() => onDecision("deny")}>
            拒绝
          </button>
          <button
            type="button"
            className="primary-action"
            disabled={busy}
            onClick={() => onDecision("once")}
          >
            {busy && choice !== "full_access" ? "正在处理…" : "仅本次允许"}
          </button>
        </div>
        <p className="pending-approval-scope">
          {fullAccess ? "“完全访问”仅对当前对话生效。" : "本次允许仅适用于上面列出的操作。"}
        </p>
      </footer>
    </>
  );
}
