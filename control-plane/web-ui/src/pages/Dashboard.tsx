import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useRealtimeStore } from "../stores/realtime";
import { listApprovals } from "../lib/api";
import { ApprovalPanel } from "../components/ApprovalPanel";

export function Dashboard() {
  const events = useRealtimeStore((s) => s.events);
  const [approvals, setApprovals] = useState<unknown[]>([]);

  useEffect(() => {
    listApprovals("pending").then(setApprovals).catch(() => {});
  }, []);

  // Derive active tasks from events
  const activeTasks = events
    .filter((e) => e.type === "task.created" || e.type === "task.node.updated")
    .reduce(
      (acc, e) => {
        if (e.taskId && !acc.has(e.taskId)) {
          acc.set(e.taskId, {
            taskId: e.taskId,
            lastEvent: e.type,
            lastUpdate: e.ts,
          });
        }
        return acc;
      },
      new Map<string, { taskId: string; lastEvent: string; lastUpdate: string }>(),
    );

  // Recent agent events
  const agentEvents = events
    .filter((e) => e.type.startsWith("agent."))
    .slice(0, 10);

  return (
    <div className="p-6 space-y-6">
      <h2 className="text-2xl font-bold">Dashboard</h2>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Active Tasks */}
        <div className="bg-slate-900 rounded-xl border border-slate-800 p-4">
          <h3 className="text-sm font-medium text-slate-400 mb-3">Active Tasks</h3>
          {activeTasks.size === 0 ? (
            <p className="text-slate-600 text-sm">No active tasks</p>
          ) : (
            <ul className="space-y-2">
              {Array.from(activeTasks.values()).map((task) => (
                <li key={task.taskId}>
                  <Link
                    to={`/tasks/${task.taskId}`}
                    className="block px-3 py-2 bg-slate-800 rounded-lg hover:bg-slate-700 transition-colors"
                  >
                    <span className="text-sm text-blue-400 font-mono">
                      {task.taskId.slice(0, 8)}...
                    </span>
                    <span className="text-xs text-slate-500 ml-2">{task.lastEvent}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Agent Activity */}
        <div className="bg-slate-900 rounded-xl border border-slate-800 p-4">
          <h3 className="text-sm font-medium text-slate-400 mb-3">Agent Activity</h3>
          {agentEvents.length === 0 ? (
            <p className="text-slate-600 text-sm">No recent agent activity</p>
          ) : (
            <ul className="space-y-2">
              {agentEvents.map((event) => (
                <li key={event.id} className="flex items-center gap-2 text-sm">
                  <span className={`badge-${event.type.split(".")[1]} px-2 py-0.5 rounded text-xs`}>
                    {event.type.split(".")[1]}
                  </span>
                  <span className="text-slate-400 font-mono text-xs">
                    {event.agentRunId?.slice(0, 8)}
                  </span>
                  <span className="text-slate-600 text-xs ml-auto">
                    {new Date(event.ts).toLocaleTimeString()}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Pending Approvals */}
        <div className="bg-slate-900 rounded-xl border border-slate-800 p-4">
          <h3 className="text-sm font-medium text-slate-400 mb-3">
            Pending Approvals ({Array.isArray(approvals) ? approvals.length : 0})
          </h3>
          <ApprovalPanel approvals={Array.isArray(approvals) ? approvals : []} />
        </div>
      </div>

      {/* Event Stream */}
      <div className="bg-slate-900 rounded-xl border border-slate-800 p-4">
        <h3 className="text-sm font-medium text-slate-400 mb-3">Event Stream</h3>
        <div className="max-h-64 overflow-y-auto space-y-1">
          {events.slice(0, 50).map((event) => (
            <div key={event.id} className="flex items-center gap-3 text-xs py-1 border-b border-slate-800/50">
              <span className="text-slate-600 w-20 shrink-0">
                {new Date(event.ts).toLocaleTimeString()}
              </span>
              <span className="text-blue-400 w-40 shrink-0 font-mono">{event.type}</span>
              <span className="text-slate-500 truncate">
                {JSON.stringify(event.data).slice(0, 100)}
              </span>
            </div>
          ))}
          {events.length === 0 && (
            <p className="text-slate-600 text-sm">Waiting for events...</p>
          )}
        </div>
      </div>
    </div>
  );
}
