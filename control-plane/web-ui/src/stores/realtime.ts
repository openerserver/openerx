import { create } from "zustand";

// ── Realtime Store ─────────────────────────────────────────────────
// Manages WebSocket connection and event stream from the BFF.

interface RealtimeEvent {
  id: string;
  type: string;
  ts: string;
  projectId?: string;
  taskId?: string;
  sessionId?: string;
  agentRunId?: string;
  data: Record<string, unknown>;
}

interface RealtimeState {
  connected: boolean;
  events: RealtimeEvent[];
  ws: WebSocket | null;
  connect: (token: string) => void;
  disconnect: () => void;
  subscribeTask: (taskId: string) => void;
}

const MAX_EVENTS = 500;

export const useRealtimeStore = create<RealtimeState>()((set, get) => ({
  connected: false,
  events: [],
  ws: null,

  connect(token: string) {
    const existing = get().ws;
    if (existing && existing.readyState === WebSocket.OPEN) return;

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws?token=${encodeURIComponent(token)}`);

    ws.onopen = () => set({ connected: true, ws });

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as RealtimeEvent;
        set((state) => ({
          events: [data, ...state.events].slice(0, MAX_EVENTS),
        }));
      } catch {
        // Malformed message
      }
    };

    ws.onclose = () => {
      set({ connected: false, ws: null });
      // Auto-reconnect after 3s
      setTimeout(() => {
        const { token } = { token }; // capture
        if (token) get().connect(token);
      }, 3000);
    };

    ws.onerror = () => ws.close();
  },

  disconnect() {
    const ws = get().ws;
    if (ws) ws.close();
    set({ connected: false, ws: null, events: [] });
  },

  subscribeTask(taskId: string) {
    const ws = get().ws;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "subscribe_task", taskId }));
    }
  },
}));
