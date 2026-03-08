import { useState } from "react";
import { resolveApproval } from "../lib/api";

interface ApprovalPanelProps {
  approvals: unknown[];
}

interface ApprovalItem {
  id: string;
  taskId: string;
  actionType: string;
  riskLevel: string;
  requestDetail: Record<string, unknown>;
  expiresAt: string;
}

export function ApprovalPanel({ approvals }: ApprovalPanelProps) {
  const [loading, setLoading] = useState<string | null>(null);

  const handleResolve = async (ticketId: string, action: "approve" | "reject") => {
    setLoading(ticketId);
    try {
      await resolveApproval(ticketId, action);
    } catch {
      // Error handling
    } finally {
      setLoading(null);
    }
  };

  if (!approvals.length) {
    return <p className="text-slate-600 text-sm">No pending approvals</p>;
  }

  return (
    <div className="space-y-2">
      {(approvals as ApprovalItem[]).map((ticket) => (
        <div key={ticket.id} className="border border-slate-700 rounded-lg p-3">
          <div className="flex items-center gap-2 mb-1">
            <span
              className={`px-2 py-0.5 rounded text-xs ${
                ticket.riskLevel === "critical"
                  ? "bg-red-500/20 text-red-400"
                  : ticket.riskLevel === "high"
                    ? "bg-orange-500/20 text-orange-400"
                    : "bg-amber-500/20 text-amber-400"
              }`}
            >
              {ticket.riskLevel}
            </span>
            <span className="text-xs text-slate-400">{ticket.actionType}</span>
          </div>

          <p className="text-xs text-slate-500 mb-2 truncate">
            Task: {ticket.taskId?.slice(0, 8)} — {JSON.stringify(ticket.requestDetail).slice(0, 60)}
          </p>

          <div className="flex gap-2">
            <button
              onClick={() => handleResolve(ticket.id, "approve")}
              disabled={loading === ticket.id}
              className="px-3 py-1 text-xs bg-green-600/20 text-green-400 border border-green-600/30 rounded hover:bg-green-600/30 disabled:opacity-50"
            >
              Approve
            </button>
            <button
              onClick={() => handleResolve(ticket.id, "reject")}
              disabled={loading === ticket.id}
              className="px-3 py-1 text-xs bg-red-600/20 text-red-400 border border-red-600/30 rounded hover:bg-red-600/30 disabled:opacity-50"
            >
              Reject
            </button>
          </div>

          <p className="text-[10px] text-slate-600 mt-1">
            Expires: {new Date(ticket.expiresAt).toLocaleString()}
          </p>
        </div>
      ))}
    </div>
  );
}
