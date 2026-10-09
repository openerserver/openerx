import type { PermissionRequest, WorkItem } from "@openerx/contracts";
import { ToolPermissionPrompt } from "@openerx/desktop-ui/tool-permission";
import { desktopWorkspaceBridge } from "@openerx/desktop-ui/workspace-bridge";
import { ShieldWarning } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type RefObject, useEffect, useRef } from "react";
import { createPortal } from "react-dom";

const pendingPermissionsKey = ["tools", "pending-permissions"] as const;
type Decision = "once" | "session" | "deny" | "full_access";

// A manual popover lives in the browser's top layer, outside clipping and stacking
// contexts. It remains non-modal so the user can still read the chat or change mode.
function ApprovalSurface({
  anchorRef,
  children,
}: {
  anchorRef: RefObject<HTMLFormElement | null>;
  children: React.ReactNode;
}): React.JSX.Element {
  const surfaceRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const surface = surfaceRef.current;
    const anchor = anchorRef.current;
    if (!surface) return;
    const position = (): void => {
      const rect = anchor?.getBoundingClientRect();
      const width = Math.min(rect?.width || 680, window.innerWidth - 24);
      const left = Math.max(12, Math.min(rect?.left ?? 12, window.innerWidth - width - 12));
      const bottom = rect && rect.top >= 280 ? window.innerHeight - rect.top + 10 : 12;
      surface.style.left = `${left}px`;
      surface.style.bottom = `${bottom}px`;
      surface.style.width = `${width}px`;
      surface.style.maxHeight = `${Math.min(480, window.innerHeight - bottom - 12)}px`;
    };
    position();
    if (typeof surface.showPopover === "function") surface.showPopover();
    else surface.removeAttribute("popover");
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(position);
    if (anchor) observer?.observe(anchor);
    // Side rails and sidebar toggles can move the composer without resizing it.
    if (anchor?.parentElement) observer?.observe(anchor.parentElement);
    window.addEventListener("resize", position);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", position);
      if (typeof surface.hidePopover === "function" && surface.matches(":popover-open")) {
        surface.hidePopover();
      }
    };
  }, [anchorRef]);
  return createPortal(
    <section
      ref={surfaceRef}
      popover="manual"
      className="pending-tool-approval"
      aria-label="待处理的工具授权"
    >
      {children}
    </section>,
    document.body,
  );
}

function ApprovalRequest({
  permission,
  conversationId,
  pendingCount,
  conversationWorkItemIds,
}: {
  permission: PermissionRequest;
  conversationId: string;
  pendingCount: number;
  conversationWorkItemIds: Set<string>;
}): React.JSX.Element {
  const queryClient = useQueryClient();
  const submitting = useRef(false);
  const decision = useMutation({
    mutationFn: async (choice: Decision) =>
      choice === "full_access"
        ? desktopWorkspaceBridge().setToolPermissionMode({ conversationId, mode: "full_access" })
        : desktopWorkspaceBridge().resolvePermission({
            permissionRequestId: permission.id,
            payloadDigest: permission.payloadDigest,
            decision: choice,
          }),
    onSuccess: async (result, choice) => {
      if ("mode" in result) {
        queryClient.setQueryData(["tools", "permission-mode", conversationId], result);
      }
      queryClient.setQueryData<PermissionRequest[]>(pendingPermissionsKey, (current) =>
        current?.filter((candidate) =>
          choice === "full_access"
            ? !conversationWorkItemIds.has(candidate.workItemId)
            : candidate.id !== permission.id,
        ),
      );
      await queryClient.invalidateQueries({
        queryKey: ["tools"],
        predicate: (query) => query.queryKey[1] !== "permission-mode",
      });
    },
    onSettled: () => {
      submitting.current = false;
    },
  });
  const choose = (choice: Decision): void => {
    if (submitting.current) return;
    submitting.current = true;
    decision.mutate(choice);
  };
  return (
    <ToolPermissionPrompt
      permission={permission}
      pendingCount={pendingCount}
      busy={decision.isPending}
      choice={decision.variables}
      error={decision.error ? "权限设置失败，请重试。" : undefined}
      onDecision={choose}
      fullAccess
      session
      icon={<ShieldWarning size={22} aria-hidden="true" />}
    />
  );
}

export function PendingToolApproval({
  conversationId,
  workItems,
  anchorRef,
}: {
  conversationId: string;
  workItems: WorkItem[];
  anchorRef: RefObject<HTMLFormElement | null>;
}): React.JSX.Element | null {
  const permissions = useQuery({
    queryKey: pendingPermissionsKey,
    queryFn: () => desktopWorkspaceBridge().listPermissionRequests({ status: "pending" }),
  });
  const selectedId = useRef<string | null>(null);
  const activeWorkItems = new Map(
    workItems
      .filter(
        (item) =>
          item.conversationId === conversationId &&
          ["running", "waiting_for_permission"].includes(item.status),
      )
      .map((item) => [item.id, item]),
  );
  const pending = (permissions.data ?? [])
    .filter(
      (permission) =>
        permission.status === "pending" &&
        activeWorkItems.get(permission.workItemId)?.activeRunId === permission.runId,
    )
    .sort((a, b) => a.requestedAt.localeCompare(b.requestedAt) || a.id.localeCompare(b.id));
  const permission = pending.find(({ id }) => id === selectedId.current) ?? pending[0];
  selectedId.current = permission?.id ?? null;
  if (!permission) {
    if (!permissions.error || !workItems.some((item) => item.status === "waiting_for_permission")) {
      return null;
    }
    return (
      <ApprovalSurface anchorRef={anchorRef}>
        <div className="pending-approval-footer">
          <p role="alert">有操作正在等待授权，但暂时无法读取。请重试。</p>
          <button
            type="button"
            disabled={permissions.isFetching}
            onClick={() => void permissions.refetch()}
          >
            重新加载权限请求
          </button>
        </div>
      </ApprovalSurface>
    );
  }
  return (
    <ApprovalSurface anchorRef={anchorRef}>
      <ApprovalRequest
        key={permission.id}
        permission={permission}
        conversationId={conversationId}
        pendingCount={pending.length}
        conversationWorkItemIds={new Set(activeWorkItems.keys())}
      />
    </ApprovalSurface>
  );
}
