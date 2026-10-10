import type { WindowsSandboxSetupResult } from "@openerx/contracts";
import { desktopWorkspaceBridge } from "@openerx/desktop-ui/workspace-bridge";
import { useRef, useState } from "react";

export const windowsSandboxReasonLabels: Record<string, string> = {
  MANAGED_CODEX_RUNTIME_UNAVAILABLE: "应用内 Windows 沙箱运行时缺失，请更新或重新安装应用",
  MANAGED_CODEX_RUNTIME_INTEGRITY_FAILED: "应用内 Windows 沙箱运行时校验失败，请重新安装应用",
  SHELL_WINDOWS_CODEX_EXECUTABLE_MISSING: "Windows 沙箱运行时缺失，请更新或重新安装应用",
  SHELL_WINDOWS_CODEX_SANDBOX_UNAVAILABLE: "Windows 沙箱尚不可用，可尝试初始化",
  SHELL_WINDOWS_CODEX_MXC_UNAVAILABLE: "当前系统不支持 MXC 沙箱",
  SHELL_WINDOWS_CODEX_SETUP_REQUIRED: "Windows 沙箱需要初始化",
  SHELL_WINDOWS_CODEX_POLICY_DENIED: "系统策略禁止沙箱运行，请联系管理员检查策略",
  SHELL_WINDOWS_CODEX_PROBE_TIMEOUT: "Windows 沙箱检测超时，请重试",
  SHELL_WINDOWS_CODEX_LOGON_DENIED: "Windows 沙箱账户无法登录，可尝试重新初始化",
  SHELL_WINDOWS_CODEX_NETWORK_POLICY_CONFLICT: "Windows 沙箱网络策略冲突",
  SHELL_WINDOWS_CODEX_COMMAND_PROTOCOL_UNSUPPORTED:
    "Windows 沙箱命令协议不兼容，请更新或重新安装应用",
  SHELL_WINDOWS_CODEX_PROTOCOL_CHECK_FAILED: "Codex 命令协议检测失败",
  SHELL_WINDOWS_CODEX_APP_SERVER_DISCONNECTED: "Codex 沙箱服务已断开，请重试",
  SHELL_WINDOWS_CODEX_APP_SERVER_TIMEOUT: "Codex 沙箱服务响应超时，请重试",
};

const setupReasons = new Set([
  "SHELL_WINDOWS_CODEX_SETUP_REQUIRED",
  "SHELL_WINDOWS_CODEX_LOGON_DENIED",
  "SHELL_WINDOWS_CODEX_SANDBOX_UNAVAILABLE",
]);

export function WindowsSandboxSetup({
  reason,
  refresh,
}: {
  reason: string | null;
  refresh: () => Promise<unknown>;
}): React.JSX.Element | null {
  const running = useRef(false);
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<WindowsSandboxSetupResult | null>(null);
  const [error, setError] = useState(false);
  const [refreshFailed, setRefreshFailed] = useState(false);

  async function start(): Promise<void> {
    if (running.current) return;
    running.current = true;
    setPending(true);
    setResult(null);
    setError(false);
    setRefreshFailed(false);
    try {
      setResult(await desktopWorkspaceBridge().startWindowsSandboxSetup());
    } catch {
      setError(true);
    } finally {
      try {
        await refresh();
      } catch {
        setRefreshFailed(true);
      }
      running.current = false;
      setPending(false);
    }
  }

  if (!setupReasons.has(reason ?? "") && !result && !error && !pending) return null;
  return (
    <section className="settings-stack" aria-label="Windows 沙箱初始化">
      {setupReasons.has(reason ?? "") ? (
        <>
          <p>点击后开始初始化，系统可能请求管理员授权。完成后会重新检查工具状态。</p>
          <button type="button" disabled={pending} onClick={() => void start()}>
            {pending ? "正在初始化 Windows 沙箱…" : "初始化 Windows 沙箱"}
          </button>
        </>
      ) : null}
      {result ? (
        <>
          <p className={result.success ? "inline-success" : "inline-error"} role="status">
            {result.success
              ? "Windows 沙箱初始化已完成。"
              : `Windows 沙箱初始化未完成。${windowsSandboxReasonLabels[result.reason ?? ""] ?? "请检查系统提示后重试。"}`}
          </p>
          {result.details.length ? (
            <ul>
              {[...new Set(result.details)].map((detail) => (
                <li key={detail}>{detail}</li>
              ))}
            </ul>
          ) : null}
        </>
      ) : null}
      {error ? (
        <p className="inline-error" role="alert">
          无法初始化 Windows 沙箱，请稍后重试。
        </p>
      ) : null}
      {refreshFailed ? (
        <p className="inline-error" role="alert">
          初始化后未能刷新工具状态，请重新检测。
        </p>
      ) : null}
    </section>
  );
}
