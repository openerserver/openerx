import type { DesktopControlCommand, DesktopControlSession } from "@openerx/contracts";
import { useEffect, useState } from "react";
import "./desktop-control.css";

export function DesktopControlBar() {
  const [sessions, setSessions] = useState<DesktopControlSession[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  useEffect(() => {
    const list = window.openerx?.listDesktopControlSessions;
    if (!list) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      try {
        const current = await list();
        if (!cancelled) setSessions(current.filter((s) => s.state !== "stopped"));
      } catch {
        /* The supervisor may be restarting. Keep the last control visible. */
      }
      if (!cancelled) timer = setTimeout(() => void refresh(), 750);
    };
    void refresh();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, []);
  const control = async (command: DesktopControlCommand) => {
    setPending(true);
    setError(null);
    try {
      const result = await window.openerx.controlDesktopSession?.(command);
      if (result)
        setSessions((previous) =>
          previous
            .map((s) => (s.sessionId === result.sessionId ? result : s))
            .filter((s) => s.state !== "stopped"),
        );
    } catch {
      setError("无法恢复控制。请确认目标窗口可见、桌面已解锁，或停止本次控制。");
    } finally {
      setPending(false);
    }
  };
  if (!sessions.length) return null;
  return (
    <aside className="desktop-control-bar" aria-label="Windows 桌面控制">
      {sessions.map((session) => (
        <div className="desktop-control-row" key={session.sessionId}>
          <div aria-live="polite">
            <strong>
              {session.state === "paused" ? "桌面控制已暂停" : "正在控制桌面"} ·{" "}
              {session.application}
            </strong>
            <span>{session.windowTitle}</span>
            <small>
              {session.state === "paused"
                ? session.reason === "DESKTOP_TARGET_NOT_FRONTMOST"
                  ? "Windows 未允许激活目标窗口，请在 30 秒内点击恢复以继续"
                  : "请确认目标窗口，恢复后重新观察"
                : "使用鼠标或键盘即可接管"}
            </small>
          </div>
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              void control({
                sessionId: session.sessionId,
                action: session.state === "paused" ? "resume" : "pause",
              })
            }
          >
            {session.state === "paused" ? "恢复" : "暂停"}
          </button>
          <button
            type="button"
            onClick={() => void control({ sessionId: session.sessionId, action: "stop" })}
          >
            停止控制
          </button>
        </div>
      ))}
      {error ? <p role="alert">{error}</p> : null}
    </aside>
  );
}
