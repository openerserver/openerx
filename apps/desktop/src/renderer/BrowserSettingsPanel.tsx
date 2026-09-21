import type { BrowserMode, BrowserPermissionUpdate } from "@openerx/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import "./browser-settings.css";

const modes: { value: BrowserMode; label: string }[] = [
  { value: "auto", label: "自动（推荐）" },
  { value: "connected_chrome", label: "已连接的 Chrome" },
  { value: "managed_chromium", label: "openerx 独立浏览器" },
  { value: "os_accessibility", label: "系统浏览器 · 辅助功能" },
];
export function BrowserSettingsPanel() {
  const client = useQueryClient();
  const [copied, setCopied] = useState(false);
  const [siteHost, setSiteHost] = useState("");
  const state = useQuery({
    queryKey: ["browser-connection"],
    queryFn: () => window.openerx.getBrowserConnectionState(),
    refetchInterval: 3000,
  });
  const sessions = useQuery({
    queryKey: ["browser-sessions"],
    queryFn: () => window.openerx.listBrowserComputerUseSessions(),
    refetchInterval: 3000,
  });
  const save = useMutation({
    mutationFn: (mode: BrowserMode) => window.openerx.updateBrowserMode(mode),
    onSuccess: async (value) => {
      client.setQueryData(["browser-connection"], value);
      await client.invalidateQueries({ queryKey: ["tools", "runtime-readiness"] });
    },
  });
  const setup = useMutation({ mutationFn: () => window.openerx.prepareBrowserExtension() });
  const permissions = useMutation({
    mutationFn: (input: BrowserPermissionUpdate) => window.openerx.updateBrowserPermission(input),
    onSuccess: (value, input) => {
      client.setQueryData(["browser-connection"], value);
      setSiteHost("");
      if (input.action === "disconnect") setup.reset();
    },
  });
  const control = useMutation({
    mutationFn: ({ sessionId, resume }: { sessionId: string; resume: boolean }) =>
      resume
        ? window.openerx.resumeBrowserComputerUseSession({ sessionId })
        : window.openerx.pauseBrowserComputerUseSession({ sessionId }),
    onSuccess: () => client.invalidateQueries({ queryKey: ["browser-sessions"] }),
  });
  const error = state.error || save.error || setup.error || control.error || permissions.error;
  return (
    <section className="tool-settings-section browser-settings" aria-label="浏览器连接设置">
      <div className="tool-settings-heading">
        <div>
          <h3>浏览器控制</h3>
          <p>连接 Chrome 后，任务可以选择已有标签页或新建页面，复用你的登录状态。</p>
        </div>
      </div>
      <label>
        默认浏览器模式{" "}
        <select
          aria-label="默认浏览器模式"
          value={state.data?.mode ?? "auto"}
          disabled={!state.data || save.isPending}
          onChange={(event) => save.mutate(event.target.value as BrowserMode)}
        >
          {modes.map((mode) => (
            <option key={mode.value} value={mode.value}>
              {mode.label}
            </option>
          ))}
        </select>
      </label>
      <p>
        自动模式优先使用已连接的
        Chrome；没有连接时打开独立浏览器。独立浏览器使用临时资料，关闭后清除，不共享 Chrome
        的登录状态。
      </p>
      {save.isSuccess && (
        <p role="status" className="inline-success">
          浏览器模式已保存，下次打开时生效。
        </p>
      )}
      <h4>连接已有 Chrome</h4>
      <p role="status">
        {state.data?.extensionConnected
          ? "扩展已连接 · 可使用已有标签页或新建页面"
          : "扩展尚未连接"}
      </p>
      <button
        type="button"
        disabled={setup.isPending}
        onClick={() => {
          setCopied(false);
          setup.mutate();
        }}
      >
        准备 Chrome 扩展
      </button>
      {setup.data && (
        <div className="browser-extension-setup">
          <ol>
            <li>在 Chrome 地址栏打开 chrome://extensions，开启开发者模式。</li>
            <li>点击「加载已解压的扩展程序」，选择下面的扩展目录。</li>
            <li>点击浏览器扩展图标，粘贴配对码并连接。无需逐个授权标签页。</li>
          </ol>
          <label>
            扩展目录
            <input
              readOnly
              value={setup.data.extensionDirectory}
              aria-label="扩展目录"
              onFocus={(event) => event.currentTarget.select()}
            />
          </label>
          <label>
            配对码
            <input
              readOnly
              type="password"
              value={setup.data.pairingCode}
              aria-label="Chrome 配对码"
              onFocus={(event) => event.currentTarget.select()}
            />
          </label>
          <button
            type="button"
            onClick={() => {
              if (!setup.data) return;
              void navigator.clipboard
                .writeText(setup.data.pairingCode)
                .then(() => setCopied(true))
                .catch(() => setCopied(false));
            }}
          >
            {copied ? "已复制配对码" : "复制配对码"}
          </button>
          <p>
            连接信息会保存在本机，重启后自动重连。首次使用新网站时会询问；切换标签页不会清除网站权限。
          </p>
        </div>
      )}
      <h4>网站访问权限</h4>
      <p>
        已连接的 Chrome
        和独立浏览器共用以下规则。默认在首次使用新网站时询问，允许后可跨站导航；发送、提交和敏感操作仍按各自规则处理。
      </p>
      <label>
        <input
          type="checkbox"
          checked={state.data?.sitePolicy?.allowAllSites ?? false}
          disabled={!state.data || permissions.isPending}
          onChange={(event) =>
            permissions.mutate({ action: "all_sites", allowed: event.target.checked })
          }
        />
        允许所有网站（已阻止的网站除外）
      </label>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          permissions.mutate({ action: "site", host: siteHost, decision: "allow" });
        }}
      >
        <label>
          网站域名
          <input
            aria-label="网站域名"
            placeholder="example.com"
            value={siteHost}
            onChange={(event) => setSiteHost(event.target.value)}
          />
        </label>
        <button type="submit" disabled={!siteHost.trim() || permissions.isPending}>
          允许此网站
        </button>
        <button
          type="button"
          disabled={!siteHost.trim() || permissions.isPending}
          onClick={() => permissions.mutate({ action: "site", host: siteHost, decision: "block" })}
        >
          阻止此网站
        </button>
      </form>
      <p>仅匹配完整域名，子域名分别管理。</p>
      {(["allowedHosts", "blockedHosts"] as const).map((kind) => (
        <div key={kind}>
          <h5>{kind === "allowedHosts" ? "已允许的网站" : "已阻止的网站"}</h5>
          {(state.data?.sitePolicy?.[kind] ?? []).map((host) => (
            <p key={host}>
              {host}{" "}
              <button
                type="button"
                disabled={permissions.isPending}
                onClick={() => permissions.mutate({ action: "site", host, decision: "ask" })}
              >
                移除 {host}
              </button>
            </p>
          ))}
          {!state.data?.sitePolicy?.[kind]?.length && <p>暂无</p>}
        </div>
      ))}
      <button
        type="button"
        disabled={!state.data || permissions.isPending}
        onClick={() => permissions.mutate({ action: "disconnect" })}
      >
        断开浏览器并清除配对
      </button>
      {!!sessions.data?.length && (
        <div>
          <h4>正在控制的会话</h4>
          {sessions.data.map((session) => (
            <p key={session.sessionId}>
              {session.controlPath === "connected_browser_bridge"
                ? "Chrome 任务标签页"
                : session.backend === "managed_chromium"
                  ? "独立浏览器"
                  : "系统浏览器"}{" "}
              ·{" "}
              {session.state === "paused_for_user"
                ? "用户接管中"
                : session.state === "active"
                  ? "运行中"
                  : "已停止"}{" "}
              {["active", "paused_for_user"].includes(session.state) && (
                <button
                  type="button"
                  disabled={control.isPending}
                  onClick={() =>
                    control.mutate({
                      sessionId: session.sessionId,
                      resume: session.state === "paused_for_user",
                    })
                  }
                >
                  {session.state === "paused_for_user" ? "恢复自动操作" : "暂停并接管"}
                </button>
              )}
            </p>
          ))}
        </div>
      )}
      <p>独立浏览器的控制通道随窗口自动建立。完整 CDP 命令未向模型开放，也不开放调试端口。</p>
      {error && (
        <p role="alert" className="inline-error">
          浏览器设置暂时不可用：{error instanceof Error ? error.message : String(error)}
        </p>
      )}
    </section>
  );
}
