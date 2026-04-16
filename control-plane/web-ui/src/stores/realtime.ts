import { defineStore } from "pinia";
import {
  summarizeRealtimeEvent,
  traceTaskDetailRealtime,
} from "../lib/task-detail-realtime-debug";

export interface RealtimeEvent {
  id: string;
  type: string;
  ts: string;
  projectId?: string;
  taskId?: string;
  phaseId?: string;
  sessionId?: string;
  agentRunId?: string;
  data: Record<string, unknown>;
}

const MAX_EVENTS = 500;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

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
    phaseId: typeof payload.phaseId === "string" ? payload.phaseId : undefined,
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
  authToken: string | null;
  subscribedTaskIds: string[];
  subscribedProjectIds: string[];
}

export const useRealtimeStore = defineStore("realtime", {
  state: (): RealtimeState => ({
    connected: false,
    events: [],
    ws: null,
    reconnectEnabled: false,
    reconnectTimer: null,
    authToken: null,
    subscribedTaskIds: [],
    subscribedProjectIds: [],
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
      this.authToken = token;
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
        traceTaskDetailRealtime("ws:open", {
          subscribedTaskIds: [...this.subscribedTaskIds],
          subscribedProjectIds: [...this.subscribedProjectIds],
        });
        this.restoreSubscriptions();
      };

      ws.onmessage = (event) => {
        try {
          const data = normalizeRealtimeEvent(JSON.parse(event.data) as unknown);
          if (!data) {
            return;
          }
          traceTaskDetailRealtime("ws:message", {
            event: summarizeRealtimeEvent(data),
          }, { taskId: data.taskId });
          this.pushEvent(data);
        } catch (error) {
          traceTaskDetailRealtime(
            "ws:message-parse-error",
            {
              error: error instanceof Error ? error.message : String(error),
            },
            { level: "warn" },
          );
        }
      };

      ws.onclose = (closeEvent) => {
        this.connected = false;
        if (this.ws === ws) {
          this.ws = null;
        }
        traceTaskDetailRealtime("ws:close", {
          code: closeEvent.code,
          reason: closeEvent.reason,
          wasClean: closeEvent.wasClean,
          reconnectEnabled: this.reconnectEnabled,
        }, { level: closeEvent.wasClean ? "info" : "warn" });
        if (!this.reconnectEnabled) {
          return;
        }

        this.reconnectTimer = setTimeout(() => {
          this.reconnectTimer = null;
          this.connect(token);
        }, 3000);
      };

      ws.onerror = () => {
        traceTaskDetailRealtime("ws:error", {
          connected: this.connected,
        }, { level: "warn" });
        ws.close();
      };
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
      const alreadySubscribed = this.subscribedTaskIds.includes(taskId);
      if (!taskId || this.subscribedTaskIds.includes(taskId)) {
        if (taskId && this.ws && this.ws.readyState === WebSocket.OPEN) {
          this.ws.send(JSON.stringify({ type: "subscribe_task", taskId }));
        }
        if (taskId) {
          traceTaskDetailRealtime("ws:subscribe-task", {
            taskId,
            alreadySubscribed: true,
            socketState: this.ws?.readyState ?? null,
          }, { taskId });
        }
        return;
      }
      this.subscribedTaskIds = [...this.subscribedTaskIds, taskId];
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: "subscribe_task", taskId }));
      }
      traceTaskDetailRealtime("ws:subscribe-task", {
        taskId,
        alreadySubscribed,
        socketState: this.ws?.readyState ?? null,
      }, { taskId });
    },

    subscribeProject(projectId: string) {
      const alreadySubscribed = this.subscribedProjectIds.includes(projectId);
      if (!projectId) {
        return;
      }
      if (!alreadySubscribed) {
        this.subscribedProjectIds = [...this.subscribedProjectIds, projectId];
      }
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: "subscribe_project", projectId }));
      }
      traceTaskDetailRealtime("ws:subscribe-project", {
        projectId,
        alreadySubscribed,
        socketState: this.ws?.readyState ?? null,
      });
    },

    restoreSubscriptions() {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        return;
      }

      for (const projectId of this.subscribedProjectIds) {
        this.ws.send(JSON.stringify({ type: "subscribe_project", projectId }));
      }

      for (const taskId of this.subscribedTaskIds) {
        this.ws.send(JSON.stringify({ type: "subscribe_task", taskId }));
      }
    },

    pushEvent(event: RealtimeEvent) {
      if (this.events.some((entry) => entry.id === event.id)) {
        traceTaskDetailRealtime("ws:dedupe-event", {
          event: summarizeRealtimeEvent(event),
          totalEvents: this.events.length,
        }, { taskId: event.taskId });
        return;
      }

      this.events = [event, ...this.events].slice(0, MAX_EVENTS);
      traceTaskDetailRealtime("ws:push-event", {
        event: summarizeRealtimeEvent(event),
        totalEvents: this.events.length,
      }, { taskId: event.taskId });
    },
  },
});
