import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { useRealtimeStore } from "../stores/realtime";
import { getTask } from "../lib/api";
import { AgentConsole } from "../components/AgentConsole";
import { TaskGraph } from "../components/TaskGraph";

export function TaskDetail() {
  const { taskId } = useParams<{ taskId: string }>();
  const { subscribeTask, events } = useRealtimeStore();
  const [task, setTask] = useState<unknown>(null);

  useEffect(() => {
    if (taskId) {
      subscribeTask(taskId);
      getTask(taskId).then(setTask).catch(() => {});
    }
  }, [taskId, subscribeTask]);

  // Filter events for this task
  const taskEvents = events.filter((e) => e.taskId === taskId);
  const agentEvents = taskEvents.filter((e) => e.type.startsWith("agent."));

  // Extract agent runs from events
  const agentRuns = new Map<string, { id: string; status: string; type: string }>();
  for (const event of agentEvents) {
    if (event.agentRunId) {
      agentRuns.set(event.agentRunId, {
        id: event.agentRunId,
        status: event.type.split(".")[1],
        type: (event.data.agentType as string) || "unknown",
      });
    }
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">
          Task <span className="text-blue-400 font-mono">{taskId?.slice(0, 8)}</span>
        </h2>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {/* Task Graph */}
        <div className="bg-slate-900 rounded-xl border border-slate-800 p-4">
          <h3 className="text-sm font-medium text-slate-400 mb-3">Task Graph</h3>
          <div className="h-96">
            <TaskGraph taskId={taskId || ""} events={taskEvents} />
          </div>
        </div>

        {/* Agent Console */}
        <div className="bg-slate-900 rounded-xl border border-slate-800 p-4">
          <h3 className="text-sm font-medium text-slate-400 mb-3">Agent Control</h3>
          <div className="space-y-3">
            {Array.from(agentRuns.values()).map((run) => (
              <AgentConsole
                key={run.id}
                agentRunId={run.id}
                agentType={run.type}
                status={run.status}
              />
            ))}
            {agentRuns.size === 0 && (
              <p className="text-slate-600 text-sm">No active agent runs</p>
            )}
          </div>
        </div>
      </div>

      {/* Task Event Log */}
      <div className="bg-slate-900 rounded-xl border border-slate-800 p-4">
        <h3 className="text-sm font-medium text-slate-400 mb-3">Task Events</h3>
        <div className="max-h-48 overflow-y-auto space-y-1">
          {taskEvents.slice(0, 30).map((event) => (
            <div key={event.id} className="flex items-center gap-3 text-xs py-1 border-b border-slate-800/50">
              <span className="text-slate-600 w-20 shrink-0">
                {new Date(event.ts).toLocaleTimeString()}
              </span>
              <span className="text-blue-400 w-44 shrink-0 font-mono">{event.type}</span>
              <span className="text-slate-500 truncate">
                {JSON.stringify(event.data).slice(0, 80)}
              </span>
            </div>
          ))}
          {taskEvents.length === 0 && (
            <p className="text-slate-600 text-sm">No events for this task yet</p>
          )}
        </div>
      </div>
    </div>
  );
}
