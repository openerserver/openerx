import type { RemoteConnectionRequest } from "@openerx/contracts";
import { DeviceMobile } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

function useConnectionRequests() {
  const account = useQuery({
    queryKey: ["account", "state"],
    queryFn: () => window.openerx.getAccountState(),
  });
  const signedIn = account.data?.status === "signed_in";
  const query = useQuery({
    queryKey: [
      "remote",
      "connection-requests",
      account.data?.account?.accountId,
      account.data?.session?.device.deviceId,
    ],
    queryFn: () => window.openerx.listRemoteConnectionRequests(),
    enabled: signedIn,
    refetchInterval: 3_000,
    refetchIntervalInBackground: true,
    retry: false,
  });
  return {
    ...query,
    pending: signedIn
      ? (query.data ?? []).filter(
          (request) => request.status === "pending" && Date.parse(request.expiresAt) > Date.now(),
        )
      : [],
  };
}

function ConnectionRequest({ request }: { request: RemoteConnectionRequest }): React.JSX.Element {
  const queryClient = useQueryClient();
  const decision = useMutation({
    mutationFn: (value: "approve" | "reject") =>
      window.openerx.decideRemoteConnectionRequest({
        requestId: request.requestId,
        decision: value,
      }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["remote", "connection-requests"] }),
        queryClient.invalidateQueries({ queryKey: ["remote", "state"] }),
      ]);
    },
  });
  return (
    <div className="remote-connection-request">
      <div className="remote-connection-device">
        <DeviceMobile size={24} aria-hidden="true" />
        <div>
          <strong>{request.controllerDevice.name}</strong>
          <span>
            {request.controllerDevice.platform === "ios" ? "iOS" : "Android"} · 设备{" "}
            {request.controllerDevice.deviceId.slice(0, 8)}
          </span>
          <span>申请于 {new Date(request.createdAt).toLocaleTimeString()} · 等待本机确认</span>
        </div>
      </div>
      <p>允许后，这台手机可远程发起和管理本机任务，具体操作仍按本机权限执行。</p>
      <div className="settings-actions">
        <button
          type="button"
          onClick={() => decision.mutate("reject")}
          disabled={decision.isPending}
        >
          拒绝
        </button>
        <button
          type="button"
          className="primary-action"
          onClick={() => decision.mutate("approve")}
          disabled={decision.isPending}
        >
          {decision.isPending ? "正在处理…" : "允许此手机"}
        </button>
      </div>
      {decision.error ? (
        <p className="inline-error" role="alert">
          未能处理申请，请刷新后重试。
        </p>
      ) : null}
    </div>
  );
}

export function RemoteConnectionRequests(): React.JSX.Element {
  const requests = useConnectionRequests();
  return (
    <section className="remote-connection-requests" aria-label="手机连接申请">
      <strong>手机连接申请</strong>
      {requests.pending.length ? (
        requests.pending.map((request) => (
          <ConnectionRequest key={request.requestId} request={request} />
        ))
      ) : (
        <p>在手机上登录同一账户，选择这台电脑并申请连接。首次允许后，授权有效期内可自动重连。</p>
      )}
      {requests.error ? (
        <p className="inline-error" role="alert">
          暂时无法获取连接申请。
          <button type="button" onClick={() => void requests.refetch()}>
            重试
          </button>
        </p>
      ) : null}
    </section>
  );
}

export function RemoteConnectionNotice({ hidden }: { hidden: boolean }): React.JSX.Element | null {
  const { pending } = useConnectionRequests();
  const request = pending[0];
  if (hidden || !request) return null;
  return (
    <aside className="remote-connection-notice" aria-label="待确认的手机连接">
      <p role="status">有 {pending.length} 台手机申请连接这台电脑</p>
      <ConnectionRequest key={request.requestId} request={request} />
    </aside>
  );
}
