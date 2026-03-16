import { defineStore } from "pinia";

export interface RealtimeEvent {
  id: string;
  type: string;
  ts: string;
  projectId?: string;
  taskId?: string;
  sessionId?: string;
  agentRunId?: string;
  data: Record<string, unknown>;
}

const MAX_EVENTS = 500;

function normalizeRealtimeEvent(input: unknown): RealtimeEvent | null {
  if (!input || typeof input !== "object") {
    return null;
  }

  const payload = input as Record<string, unknown>;
  if (typeof payload.type !== "string") {
    return null;
  }

  if (payload.type === "subscribed" || payload.type === "error") {
    return null;
  }

  return {
    id: typeof payload.id === "string" && payload.id.length > 0 ? payload.id : crypto.randomUUID(),
    type: payload.type,
    ts:
      typeof payload.ts === "string" && payload.ts.length > 0
        ? payload.ts
        : new Date().toISOString(),
    projectId: typeof payload.projectId === "string" ? payload.projectId : undefined,
    taskId: typeof payload.taskId === "string" ? payload.taskId : undefined,
    sessionId: typeof payload.sessionId === "string" ? payload.sessionId : undefined,
    agentRunId: typeof payload.agentRunId === "string" ? payload.agentRunId : undefined,
    data:
      payload.data && typeof payload.data === "object" && !Array.isArray(payload.data)
        ? (payload.data as Record<string, unknown>)
        : {},
  };
}

interface RealtimeState {
  connected: boolean;
  events: RealtimeEvent[];
  ws: WebSocket | null;
  reconnectEnabled: boolean;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
}

export const useRealtimeStore = defineStore("realtime", {
  state: (): RealtimeState => ({
    connected: false,
    events: [],
    ws: null,
    reconnectEnabled: false,
    reconnectTimer: null,
  }),
  actions: {
    connect(token: string) {
      if (
        this.ws &&
        (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)
      ) {
        return;
      }

      this.reconnectEnabled = true;
      if (this.reconnectTimer) {
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
      }

      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const ws = new WebSocket(
        `${protocol}//${window.location.host}/ws?token=${encodeURIComponent(token)}`,
      );

      this.ws = ws;

      ws.onopen = () => {
        this.connected = true;
        this.ws = ws;
        if (this.reconnectTimer) {
          clearTimeout(this.reconnectTimer);
          this.reconnectTimer = null;
        }
      };

      ws.onmessage = (event) => {
        try {
          const data = normalizeRealtimeEvent(JSON.parse(event.data) as unknown);
          if (!data) {
            return;
          }
          this.events = [data, ...this.events].slice(0, MAX_EVENTS);
        } catch {
          // Malformed message
        }
      };

      ws.onclose = () => {
        this.connected = false;
        if (this.ws === ws) {
          this.ws = null;
        }
        if (!this.reconnectEnabled) {
          return;
        }

        this.reconnectTimer = setTimeout(() => {
          this.reconnectTimer = null;
          this.connect(token);
        }, 3000);
      };

      ws.onerror = () => ws.close();
    },

    disconnect() {
      this.reconnectEnabled = false;
      if (this.reconnectTimer) {
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
      }
      if (this.ws) this.ws.close();
      this.connected = false;
      this.ws = null;
      this.events = [];
    },

    subscribeTask(taskId: string) {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: "subscribe_task", taskId }));
      }
    },

    subscribeProject(projectId: string) {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: "subscribe_project", projectId }));
      }
    },
  },
});
