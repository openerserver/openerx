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

interface RealtimeState {
  connected: boolean;
  events: RealtimeEvent[];
  ws: WebSocket | null;
}

export const useRealtimeStore = defineStore("realtime", {
  state: (): RealtimeState => ({
    connected: false,
    events: [],
    ws: null,
  }),
  actions: {
    connect(token: string) {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) return;

      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const ws = new WebSocket(
        `${protocol}//${window.location.host}/ws?token=${encodeURIComponent(token)}`,
      );

      ws.onopen = () => {
        this.connected = true;
        this.ws = ws;
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data) as RealtimeEvent;
          this.events = [data, ...this.events].slice(0, MAX_EVENTS);
        } catch {
          // Malformed message
        }
      };

      ws.onclose = () => {
        this.connected = false;
        this.ws = null;
        // Auto-reconnect after 3s
        setTimeout(() => {
          this.connect(token);
        }, 3000);
      };

      ws.onerror = () => ws.close();
    },

    disconnect() {
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
  },
});
