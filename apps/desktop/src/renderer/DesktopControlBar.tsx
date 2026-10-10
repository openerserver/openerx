import type { DesktopControlCommand, DesktopControlSession } from "@openerx/contracts";
import { desktopWorkspaceBridge } from "@openerx/desktop-ui/workspace-bridge";
import { useEffect, useRef, useState } from "react";
import "./desktop-control.css";

export function DesktopControlBar() {
  const [sessions, setSessions] = useState<DesktopControlSession[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<Set<string>>(() => new Set());
  const mounted = useRef(false);
  const mutationEpoch = useRef(0);
  const latestCommand = useRef(0);
  const sessionCommands = useRef(new Map<string, number>());
  const stoppedSessions = useRef(new Set<string>());
  useEffect(() => {
    mounted.current = true;
    const list = desktopWorkspaceBridge()?.listDesktopControlSessions;
    if (!list)
      return () => {
        mounted.current = false;
      };
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      const epoch = mutationEpoch.current;
      try {
        const current = await list();
        if (!cancelled && epoch === mutationEpoch.current)
          setSessions(
            current.filter(
              (s) => s.state !== "stopped" && !stoppedSessions.current.has(s.sessionId),
            ),
          );
      } catch {
        /* The supervisor may be restarting. Keep the last control visible. */
      }
      if (!cancelled) timer = setTimeout(() => void refresh(), 750);
    };
    void refresh();
    return () => {
      cancelled = true;
      mounted.current = false;
      clearTimeout(timer);
    };
  }, []);
  const control = async (command: DesktopControlCommand) => {
    const commandId = ++latestCommand.current;
    sessionCommands.current.set(command.sessionId, commandId);
    mutationEpoch.current++;
    const previousSession = sessions.find((session) => session.sessionId === command.sessionId);
    const current = () =>
      mounted.current && sessionCommands.current.get(command.sessionId) === commandId;
    setPending((previous) => {
      const next = new Set(previous);
      if (command.action === "stop") next.delete(command.sessionId);
      else next.add(command.sessionId);
      return next;
    });
    if (command.action === "stop") {
      stoppedSessions.current.add(command.sessionId);
      setSessions((previous) => previous.filter((s) => s.sessionId !== command.sessionId));
    }
    setError(null);
    try {
      const bridge = desktopWorkspaceBridge();
      if (!bridge.controlDesktopSession) throw new Error("DESKTOP_HELPER_UNAVAILABLE");
      const result = await bridge.controlDesktopSession(command);
      if (!current()) return;
      if (command.action === "stop" && result.state !== "stopped")
        throw new Error("DESKTOP_STOP_UNCONFIRMED");
      mutationEpoch.current++;
      if (result.state === "stopped") stoppedSessions.current.add(result.sessionId);
      setSessions((previous) =>
        stoppedSessions.current.has(result.sessionId)
          ? previous.filter((s) => s.sessionId !== result.sessionId)
          : previous.map((s) => (s.sessionId === result.sessionId ? result : s)),
      );
    } catch (error) {
      if (!current()) return;
      mutationEpoch.current++;
      if (command.action === "stop") {
        stoppedSessions.current.delete(command.sessionId);
        if (previousSession)
          setSessions((previous) => [
            ...previous.filter((s) => s.sessionId !== command.sessionId),
            previousSession,
          ]);
      }
      if (latestCommand.current === commandId)
        setError(
          command.action === "stop"
            ? "无法停止控制。请重试停止，或关闭应用以结束本次控制。"
            : error instanceof Error &&
                error.message.includes("DESKTOP_FOREGROUND_SELECTION_TIMEOUT")
              ? "未等到目标窗口。本次恢复已结束，请重新发起桌面操作并按提示切换到目标窗口。"
              : "无法恢复控制。请确认目标窗口可见、桌面已解锁，或停止本次控制。",
        );
    } finally {
      if (current())
        setPending((previous) => {
          const next = new Set(previous);
          next.delete(command.sessionId);
          return next;
        });
    }
  };
  if (!sessions.length && !error) return null;
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
                ? session.reason === "DESKTOP_AWAITING_TARGET_FOREGROUND"
                  ? `请在 10 秒内切换到“${session.windowTitle}”窗口，松开鼠标和键盘后等待继续。Ctrl+Alt+Shift+F12 可停止控制`
                  : session.reason === "DESKTOP_TARGET_NOT_FRONTMOST"
                    ? "Windows 未允许激活目标窗口，请在 30 秒内点击恢复；必要时按提示切换到目标窗口"
                    : "请确认目标窗口，恢复后重新观察"
                : "使用鼠标或键盘即可接管"}
            </small>
          </div>
          <button
            type="button"
            disabled={pending.has(session.sessionId)}
            onClick={() =>
              void control({
                sessionId: session.sessionId,
                action: session.state === "paused" ? "resume" : "pause",
              })
            }
          >
            {pending.has(session.sessionId)
              ? "处理中…"
              : session.state === "paused"
                ? "恢复"
                : "暂停"}
          </button>
          <button
            type="button"
            onClick={() => void control({ sessionId: session.sessionId, action: "stop" })}
          >
            停止控制
          </button>
        </div>
      ))}
      {error ? (
        <div>
          <p role="alert">{error}</p>
          {!sessions.length ? (
            <button type="button" onClick={() => setError(null)}>
              关闭提示
            </button>
          ) : null}
        </div>
      ) : null}
    </aside>
  );
}
