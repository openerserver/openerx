import { useEffect, useRef, useState } from "react";

export interface ConnectionRequestView {
  requestId: string;
  deviceName: string;
  platform: string;
  createdAt: string;
  expiresAt: string;
}

function Request({
  request,
  decide,
}: {
  request: ConnectionRequestView;
  decide: (requestId: string, decision: "approve" | "reject") => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const submitting = useRef(false);
  const submit = async (decision: "approve" | "reject") => {
    if (submitting.current || Date.parse(request.expiresAt) <= Date.now()) return;
    submitting.current = true;
    setBusy(true);
    setError(false);
    try {
      await decide(request.requestId, decision);
    } catch {
      setError(true);
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  };
  return (
    <div className="remote-connection-request">
      <div className="remote-connection-device">
        <div>
          <strong>{request.deviceName}</strong>
          <span>
            {request.platform === "ios" ? "iOS" : "Android"} · 申请于{" "}
            {new Date(request.createdAt).toLocaleTimeString()} · 等待本机确认
          </span>
        </div>
      </div>
      <p>允许后，这台手机可远程发起和管理本机任务，具体操作仍按本机权限执行。</p>
      <div className="settings-actions">
        <button type="button" disabled={busy} onClick={() => void submit("reject")}>
          拒绝
        </button>
        <button
          type="button"
          className="primary-action"
          disabled={busy}
          onClick={() => void submit("approve")}
        >
          {busy ? "正在处理…" : "允许此手机"}
        </button>
      </div>
      {error ? (
        <p className="inline-error" role="alert">
          未能处理申请，请刷新后重试。
        </p>
      ) : null}
    </div>
  );
}

/** Authentication and transport remain with the edition adapter. Rendering never grants access. */
export function ConnectionRequestsPanel({
  requests,
  decide,
  error,
  refresh,
}: {
  requests: readonly ConnectionRequestView[];
  decide: (requestId: string, decision: "approve" | "reject") => Promise<void>;
  error?: string;
  refresh?: () => void;
}) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    setNow(Date.now());
    if (!requests.length) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [requests]);
  const pending = requests.filter((r) => Date.parse(r.expiresAt) > now);
  return (
    <section className="remote-connection-requests" aria-label="手机连接申请">
      <strong>手机连接申请</strong>
      {pending.length ? (
        pending.map((request) => (
          <Request key={request.requestId} request={request} decide={decide} />
        ))
      ) : (
        <p>在手机上登录同一账号，选择这台电脑并申请连接。允许后可在授权有效期内自动重连。</p>
      )}
      {error ? (
        <p className="inline-error" role="alert">
          {error}{" "}
          {refresh ? (
            <button type="button" onClick={refresh}>
              重试
            </button>
          ) : null}
        </p>
      ) : null}
    </section>
  );
}
