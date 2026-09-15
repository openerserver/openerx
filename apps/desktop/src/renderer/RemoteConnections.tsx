import type { RemoteConnectionRequest } from "@openerx/contracts";
import { ConnectionRequestsPanel } from "@openerx/desktop-ui/connections";
import { useQuery, useQueryClient } from "@tanstack/react-query";

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

function useDecision() {
  const client = useQueryClient();
  return async (requestId: string, decision: "approve" | "reject") => {
    await window.openerx.decideRemoteConnectionRequest({ requestId, decision });
    await Promise.all([
      client.invalidateQueries({ queryKey: ["remote", "connection-requests"] }),
      client.invalidateQueries({ queryKey: ["remote", "state"] }),
    ]);
  };
}
function view(request: RemoteConnectionRequest) {
  return {
    requestId: request.requestId,
    deviceName: request.controllerDevice.name,
    platform: request.controllerDevice.platform,
    createdAt: request.createdAt,
    expiresAt: request.expiresAt,
  };
}

export function RemoteConnectionRequests(): React.JSX.Element {
  const requests = useConnectionRequests();
  const decide = useDecision();
  return (
    <ConnectionRequestsPanel
      requests={requests.pending.map(view)}
      decide={decide}
      error={requests.error ? "暂时无法获取连接申请。" : undefined}
      refresh={() => void requests.refetch()}
    />
  );
}

export function RemoteConnectionNotice({ hidden }: { hidden: boolean }): React.JSX.Element | null {
  const { pending } = useConnectionRequests();
  const decide = useDecision();
  if (hidden || !pending.length) return null;
  return (
    <aside className="remote-connection-notice" aria-label="待确认的手机连接">
      <p role="status">有 {pending.length} 台手机申请连接这台电脑</p>
      <ConnectionRequestsPanel requests={pending.slice(0, 1).map(view)} decide={decide} />
    </aside>
  );
}
