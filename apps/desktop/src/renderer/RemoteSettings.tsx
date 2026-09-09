import "./RemoteSettings.css";
import type { RemoteDesktopState } from "@openerx/contracts";
import { ArrowClockwise, Desktop, DeviceMobile, QrCode } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import QRCode from "qrcode";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

function remoteErrorMessage(reason: string): string {
  if (/AUTHENTICATION_REQUIRED|ACCESS_TOKEN|SESSION_REVOKED|SESSION_EXPIRED/.test(reason)) {
    return "请先登录账户，再开启远程控制。手机需要登录同一账户。";
  }
  if (reason.includes("PLATFORM_ENDPOINT_NOT_CONFIGURED")) {
    return "此应用尚未连接账户服务，暂时无法使用远程控制。请配置账户服务后重试。";
  }
  if (reason.includes("REMOTE_NOT_CONFIGURED")) {
    return "当前账户服务尚未启用远程连接。请更新或重启服务后，点击“刷新状态”。";
  }
  if (reason.includes("OS_CREDENTIAL_STORE_UNAVAILABLE")) {
    return "无法使用系统凭证存储。请解锁电脑后重试。";
  }
  if (/REMOTE_DISABLED|REMOTE_HOST_OFFLINE/.test(reason)) {
    return "这台电脑的远程连接未就绪，请开启远程控制并保持电脑联网。";
  }
  if (/CHALLENGE.*EXPIRED|CHALLENGE.*CONSUMED/.test(reason)) {
    return "配对码已过期或已使用，请重新添加设备。";
  }
  return "暂时无法完成远程连接操作，请检查网络和账户服务后重试。";
}

const presenceLabels = {
  online: "在线",
  degraded: "连接不稳定",
  offline: "离线",
  revoked: "访问已撤销",
};

export function RemoteSettings({ accountId }: { accountId: string | null }): React.JSX.Element {
  const queryClient = useQueryClient();
  const queryKey = ["remote", "state", accountId];
  const remote = useQuery({
    queryKey,
    queryFn: () => window.openerx.getRemoteState(),
    enabled: Boolean(accountId),
    retry: false,
    refetchInterval: (query) => (query.state.data?.enabled ? 5_000 : false),
  });
  const [qr, setQr] = useState<{ challengeId: string; dataUrl: string } | null>(null);
  const [qrError, setQrError] = useState(false);
  const [expired, setExpired] = useState(false);
  const challenge = useMutation({
    mutationFn: () => window.openerx.createRemotePairingChallenge(),
    onMutate: () => {
      setQr(null);
      setQrError(false);
    },
  });
  const enable = useMutation({
    mutationFn: (enabled: boolean) => window.openerx.setRemoteEnabled({ enabled }),
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey });
      challenge.reset();
      setQr(null);
      setQrError(false);
    },
    onSuccess: (state: RemoteDesktopState) => queryClient.setQueryData(queryKey, state),
    onError: () => queryClient.invalidateQueries({ queryKey }),
  });
  const revoke = useMutation({
    mutationFn: (pairingId: string) => window.openerx.revokeRemotePairing({ pairingId }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
  });
  const state = remote.data;
  const enabled = Boolean(state?.enabled);
  const activePairings = state?.pairings.filter(({ status }) => status === "active") ?? [];
  const busy = enable.isPending || challenge.isPending || revoke.isPending;

  useEffect(() => {
    const value = challenge.data;
    setQr(null);
    setQrError(false);
    if (!value || !enabled) return;
    const remaining = Date.parse(value.expiresAt) - Date.now();
    setExpired(remaining <= 0);
    if (remaining <= 0) return;
    let active = true;
    const timer = setTimeout(() => {
      setExpired(true);
      setQr(null);
    }, remaining);
    const pairingUrl = `openerx://remote/pair?payload=${encodeURIComponent(JSON.stringify(value))}`;
    void QRCode.toDataURL(pairingUrl, {
      width: 220,
      margin: 1,
      errorCorrectionLevel: "M",
      color: { dark: "#232823", light: "#ffffff" },
    }).then(
      (dataUrl) => {
        if (active) setQr({ challengeId: value.challengeId, dataUrl });
      },
      () => {
        if (active) setQrError(true);
      },
    );
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [challenge.data, enabled]);

  const reason = !accountId
    ? "AUTHENTICATION_REQUIRED"
    : ((remote.error ?? enable.error ?? challenge.error ?? revoke.error)?.message ?? state?.reason);
  const presence = state?.host?.presence ?? "offline";
  return (
    <section className="settings-card settings-stack remote-settings" aria-label="手机远程控制">
      <div className="settings-heading">
        <div>
          <h2>远程连接</h2>
          <p>从手机发起任务、查看进展和处理审批，任务与文件始终在这台电脑上运行。</p>
        </div>
        {accountId ? (
          <button
            type="button"
            onClick={() => {
              enable.reset();
              challenge.reset();
              revoke.reset();
              setQr(null);
              setQrError(false);
              void remote.refetch();
            }}
            disabled={busy || remote.isFetching}
          >
            <ArrowClockwise size={16} /> 刷新状态
          </button>
        ) : null}
      </div>
      <div className="remote-control-row">
        <div>
          <strong id="remote-control-label">允许远程控制这台电脑</strong>
          <p id="remote-control-description">仅限同一账户下，经过你扫码配对授权的手机。</p>
        </div>
        <div className="remote-toggle-control">
          <span role="status">
            {enable.isPending
              ? "正在更新…"
              : accountId && remote.isPending
                ? "正在检查…"
                : state?.available
                  ? enabled
                    ? "已开启"
                    : "未开启"
                  : "未就绪"}
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={enabled}
            aria-labelledby="remote-control-label"
            aria-describedby="remote-control-description"
            className="remote-control-switch"
            disabled={
              busy || !accountId || !state?.available || remote.isPending || Boolean(remote.error)
            }
            onClick={() => enable.mutate(!enabled)}
          >
            <span />
          </button>
        </div>
      </div>
      {reason ? (
        <div className="remote-setup-notice" role="alert">
          <p>{remoteErrorMessage(reason)}</p>
          {reason === "AUTHENTICATION_REQUIRED" ? (
            <Link to="/settings/account?section=account">前往账户设置</Link>
          ) : null}
        </div>
      ) : null}
      {enabled ? (
        <div className="remote-status-row">
          <Desktop size={18} />
          <strong>{state?.host?.displayName ?? "这台电脑"}</strong>
          <span className={`remote-presence presence-${presence}`}>{presenceLabels[presence]}</span>
          <span>{activePairings.length} 台手机已配对</span>
          <button
            type="button"
            onClick={() => challenge.mutate()}
            disabled={busy || !state?.available || Boolean(remote.error)}
          >
            <QrCode size={16} /> {challenge.isPending ? "正在生成…" : "添加设备"}
          </button>
        </div>
      ) : null}
      {enabled && challenge.data && !challenge.isPending ? (
        expired ? (
          <p className="remote-setup-notice" role="status">
            配对码已过期，请点击“添加设备”生成新码。
          </p>
        ) : qr?.challengeId === challenge.data.challengeId ? (
          <div className="remote-pairing-panel">
            <img src={qr.dataUrl} alt="远程连接一次性配对二维码" />
            <div>
              <strong>用手机客户端 扫码连接</strong>
              <p>在手机上登录同一账户，扫描二维码并确认连接。</p>
              <span>有效期至 {new Date(challenge.data.expiresAt).toLocaleTimeString()}</span>
            </div>
          </div>
        ) : null
      ) : null}
      {qrError ? <p role="alert">配对二维码生成失败，请点击“添加设备”重试。</p> : null}
      {activePairings.map((pairing) => (
        <div className="device-card" key={pairing.pairingId}>
          <div>
            <strong>
              <DeviceMobile size={16} /> 已授权手机 {pairing.controllerDeviceId.slice(0, 8)}
            </strong>
            <span>配对于 {new Date(pairing.createdAt).toLocaleString()}</span>
          </div>
          <button type="button" onClick={() => revoke.mutate(pairing.pairingId)} disabled={busy}>
            撤销配对
          </button>
        </div>
      ))}
      <div className="remote-connection-guide">
        <strong>连接手机</strong>
        <ol>
          <li>在这台电脑上登录账户，开启远程控制。</li>
          <li>点击“添加设备”，用登录同一账户的手机客户端 扫码并确认。</li>
          <li>保持这台电脑联网、处于唤醒状态，并让桌面应用持续运行。</li>
        </ol>
        <p>远程指令仍遵循这台电脑上的工具权限和审批设置。可随时关闭远程控制或撤销设备配对。</p>
      </div>
    </section>
  );
}
