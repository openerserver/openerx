import { useState } from "react";
import { pauseAgent, resumeAgent, injectGuidance, terminateAgent } from "../lib/api";

interface AgentConsoleProps {
  agentRunId: string;
  agentType: string;
  status: string;
}

export function AgentConsole({ agentRunId, agentType, status }: AgentConsoleProps) {
  const [guidance, setGuidance] = useState("");
  const [loading, setLoading] = useState(false);

  const handleAction = async (action: () => Promise<unknown>) => {
    setLoading(true);
    try {
      await action();
    } catch {
      // Error handling
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="border border-slate-700 rounded-lg p-3">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">{agentType}</span>
          <span className="text-xs font-mono text-slate-500">{agentRunId.slice(0, 8)}</span>
        </div>
        <span className={`badge-${status} px-2 py-0.5 rounded text-xs`}>{status}</span>
      </div>

      {/* Control buttons */}
      <div className="flex gap-2 mb-2">
        {status === "running" && (
          <button
            onClick={() => handleAction(() => pauseAgent(agentRunId))}
            disabled={loading}
            className="px-3 py-1 text-xs bg-amber-600/20 text-amber-400 border border-amber-600/30 rounded hover:bg-amber-600/30 disabled:opacity-50"
          >
            Pause
          </button>
        )}
        {status === "paused" && (
          <button
            onClick={() => handleAction(() => resumeAgent(agentRunId))}
            disabled={loading}
            className="px-3 py-1 text-xs bg-green-600/20 text-green-400 border border-green-600/30 rounded hover:bg-green-600/30 disabled:opacity-50"
          >
            Resume
          </button>
        )}
        {(status === "running" || status === "paused") && (
          <button
            onClick={() => handleAction(() => terminateAgent(agentRunId))}
            disabled={loading}
            className="px-3 py-1 text-xs bg-red-600/20 text-red-400 border border-red-600/30 rounded hover:bg-red-600/30 disabled:opacity-50"
          >
            Terminate
          </button>
        )}
      </div>

      {/* Guidance input (only when paused) */}
      {status === "paused" && (
        <div className="flex gap-2">
          <input
            type="text"
            value={guidance}
            onChange={(e) => setGuidance(e.target.value)}
            placeholder="Inject guidance..."
            className="flex-1 px-2 py-1 text-xs bg-slate-800 border border-slate-700 rounded text-slate-200 focus:outline-none focus:border-blue-500"
          />
          <button
            onClick={() => {
              if (guidance.trim()) {
                handleAction(() => injectGuidance(agentRunId, guidance));
                setGuidance("");
              }
            }}
            disabled={loading || !guidance.trim()}
            className="px-3 py-1 text-xs bg-blue-600/20 text-blue-400 border border-blue-600/30 rounded hover:bg-blue-600/30 disabled:opacity-50"
          >
            Send
          </button>
        </div>
      )}
    </div>
  );
}
