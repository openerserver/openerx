import { defineStore } from "pinia";
import { type ProjectTreeEventFeedItemRecord, getProjectTreeEvents } from "../lib/api";

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

const BACKFILL_PAGE_SIZE = 200;
const MAX_BACKFILL_PAGES = 5;

interface ProjectEventCursor {
  after: string;
  afterId?: string;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function readMessageText(message: Record<string, unknown> | null): string | undefined {
  if (!message) {
    return undefined;
  }

  const parts = message.parts;
  if (!Array.isArray(parts)) {
    return undefined;
  }

  const texts = parts
    .map((part) => asRecord(part))
    .filter((part): part is Record<string, unknown> => Boolean(part))
    .filter((part) => {
      const type = asString(part.type);
      return !type || type === "text";
    })
    .map((part) => asString(part.text) ?? asString(part.content))
    .filter((part): part is string => Boolean(part));

  return texts.length > 0 ? texts.join("\n") : undefined;
}

function mapProjectFeedEventType(eventType: string): string {
  if (eventType.startsWith("session.message.")) {
    return "message.updated";
  }
  return eventType;
}

function buildRealtimeDataFromProjectFeed(
  eventType: string,
  payload: Record<string, unknown>,
  createdAt: string,
) {
  const message = asRecord(payload.message);
  const info = asRecord(message?.info);
  const text = asString(payload.text) ?? asString(payload.contentText) ?? readMessageText(message);
  const messageId =
    asString(payload.messageId) ?? asString(payload.runtimeMessageId) ?? asString(info?.id);
  const role = asString(payload.role) ?? asString(info?.role);
  const agent = asString(payload.agent) ?? asString(info?.agent);
  const completedAt = asString(payload.completedAt) ?? asString(asRecord(info?.time)?.completed);

  const nextData: Record<string, unknown> = {
    ...payload,
    rawType: mapProjectFeedEventType(eventType),
    projectTreeEventType: eventType,
    projectTreeBackfill: true,
  };

  if (messageId || role || agent || createdAt || completedAt) {
    nextData.info = {
      id: messageId,
      role,
      agent,
      time: {
        created: createdAt,
        completed: completedAt,
      },
    };
  }

  if (messageId && text) {
    nextData.part = {
      type: "text",
      text,
      messageID: messageId,
    };
    nextData.delta = text;
  }

  return nextData;
}

function normalizeProjectFeedEvent(item: ProjectTreeEventFeedItemRecord): RealtimeEvent {
  const payload = asRecord(item.payload) ?? {};
  const mappedType = mapProjectFeedEventType(item.eventType);
  return {
    id: `project-tree:${item.id}`,
    type: mappedType,
    ts: item.createdAt,
    projectId: item.projectId,
    taskId: item.taskId ?? asString(payload.taskId),
    sessionId:
      item.runtimeSessionId ?? asString(payload.runtimeSessionId) ?? asString(payload.sessionId),
    agentRunId: asString(payload.agentRunId),
    data: buildRealtimeDataFromProjectFeed(item.eventType, payload, item.createdAt),
  };
}

function mergeProjectCursor(
  current: ProjectEventCursor | undefined,
  next: ProjectEventCursor,
): ProjectEventCursor {
  if (!current) {
    return next;
  }

  const currentTime = Date.parse(current.after);
  const nextTime = Date.parse(next.after);
  if (Number.isFinite(nextTime) && Number.isFinite(currentTime)) {
    if (nextTime > currentTime) {
      return next;
    }
    if (nextTime < currentTime) {
      return current;
    }
  } else if (next.after > current.after) {
    return next;
  } else if (next.after < current.after) {
    return current;
  }

  if (next.afterId && (!current.afterId || next.afterId > current.afterId)) {
    return next;
  }

  return current;
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
  projectEventCursors: Record<string, ProjectEventCursor>;
  backfillingProjectIds: string[];
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
    projectEventCursors: {},
    backfillingProjectIds: [],
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
        this.restoreSubscriptions();
        void this.backfillSubscribedProjects();
      };

      ws.onmessage = (event) => {
        try {
          const data = normalizeRealtimeEvent(JSON.parse(event.data) as unknown);
          if (!data) {
            return;
          }
          this.pushEvent(data);
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
      this.backfillingProjectIds = [];
    },

    subscribeTask(taskId: string) {
      if (!taskId || this.subscribedTaskIds.includes(taskId)) {
        if (taskId && this.ws && this.ws.readyState === WebSocket.OPEN) {
          this.ws.send(JSON.stringify({ type: "subscribe_task", taskId }));
        }
        return;
      }
      this.subscribedTaskIds = [...this.subscribedTaskIds, taskId];
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: "subscribe_task", taskId }));
      }
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
      if (this.connected) {
        void this.backfillProject(projectId);
      }
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
        this.updateProjectCursorFromEvent(event);
        return;
      }

      this.events = [event, ...this.events].slice(0, MAX_EVENTS);
      this.updateProjectCursorFromEvent(event);
    },

    updateProjectCursorFromEvent(event: RealtimeEvent) {
      if (!event.projectId || !event.ts) {
        return;
      }

      const projectTreeEventId =
        typeof event.data.projectTreeEventId === "string"
          ? event.data.projectTreeEventId
          : event.id.startsWith("project-tree:")
            ? event.id.slice("project-tree:".length)
            : undefined;

      this.projectEventCursors = {
        ...this.projectEventCursors,
        [event.projectId]: mergeProjectCursor(this.projectEventCursors[event.projectId], {
          after: event.ts,
          ...(projectTreeEventId ? { afterId: projectTreeEventId } : {}),
        }),
      };
    },

    async backfillSubscribedProjects() {
      for (const projectId of this.subscribedProjectIds) {
        await this.backfillProject(projectId);
      }
    },

    async backfillProject(projectId: string) {
      if (!projectId || !this.authToken || this.backfillingProjectIds.includes(projectId)) {
        return;
      }

      this.backfillingProjectIds = [...this.backfillingProjectIds, projectId];

      try {
        let pageCount = 0;
        while (pageCount < MAX_BACKFILL_PAGES) {
          const cursor = this.projectEventCursors[projectId];
          const response = await getProjectTreeEvents(projectId, {
            after: cursor?.after,
            afterId: cursor?.afterId,
            limit: BACKFILL_PAGE_SIZE,
          });

          if (!Array.isArray(response.items) || response.items.length === 0) {
            break;
          }

          for (const item of response.items) {
            const event = normalizeProjectFeedEvent(item);
            event.data.projectTreeEventId = item.id;
            this.pushEvent(event);
          }

          pageCount += 1;
          if (!response.hasMore) {
            break;
          }

          const nextCursor = response.nextCursor;
          if (!nextCursor) {
            break;
          }

          this.projectEventCursors = {
            ...this.projectEventCursors,
            [projectId]: mergeProjectCursor(this.projectEventCursors[projectId], nextCursor),
          };
        }
      } catch {
        // Keep websocket flow alive even if backfill fails.
      } finally {
        this.backfillingProjectIds = this.backfillingProjectIds.filter((id) => id !== projectId);
      }
    },
  },
});
