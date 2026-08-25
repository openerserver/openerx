import * as jose from "jose";
import type { JWTPayload } from "../../middleware/auth";
import type { RealtimeEvent } from "../../types/events";
import { summarizeRealtimeEvent, traceServerRealtime } from "./realtime-debug";
import { sseAggregator } from "./sse-aggregator";

// ── WebSocket Broadcaster ──────────────────────────────────────────
// Maintains connected WebSocket clients and broadcasts RealtimeEvents.

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || "openerx-dev-secret-change-in-production",
);

interface WSClient {
  ws: WebSocket & { send: (data: string) => void };
  userId: string;
  projectIds: Set<string>;
  subscribedProjects: Set<string>;
  subscribedTasks: Set<string>;
}

function canClientAccessEventProject(client: WSClient, event: RealtimeEvent) {
  return !(
    event.projectId &&
    client.projectIds.size > 0 &&
    !client.projectIds.has(event.projectId)
  );
}

function isProjectSubscribed(client: WSClient, event: RealtimeEvent) {
  return Boolean(
    event.projectId &&
      client.subscribedProjects.size > 0 &&
      client.subscribedProjects.has(event.projectId),
  );
}

function isTaskFilteredOut(client: WSClient, event: RealtimeEvent) {
  return Boolean(
    event.taskId && client.subscribedTasks.size > 0 && !client.subscribedTasks.has(event.taskId),
  );
}

function requiresExplicitMatch(client: WSClient) {
  return client.subscribedProjects.size > 0 || client.subscribedTasks.size > 0;
}

function explainBroadcastDecision(client: WSClient, event: RealtimeEvent) {
  if (!canClientAccessEventProject(client, event)) {
    return { allowed: false, reason: "project-access-denied" } as const;
  }

  if (isProjectSubscribed(client, event)) {
    return { allowed: true, reason: "project-subscribed" } as const;
  }

  if (isTaskFilteredOut(client, event)) {
    return { allowed: false, reason: "task-filtered-out" } as const;
  }

  if (requiresExplicitMatch(client) && !event.projectId && !event.taskId) {
    return { allowed: false, reason: "explicit-match-required" } as const;
  }

  return { allowed: true, reason: "default-allowed" } as const;
}

function summarizeClient(clientId: string, client: WSClient) {
  return {
    clientId,
    userId: client.userId,
    projectScopeCount: client.projectIds.size,
    subscribedProjectCount: client.subscribedProjects.size,
    subscribedTaskCount: client.subscribedTasks.size,
    subscribedProjects: Array.from(client.subscribedProjects),
    subscribedTasks: Array.from(client.subscribedTasks),
  };
}

function sendMessageToClient(client: WSClient, message: string) {
  try {
    client.ws.send(message);
  } catch {
    // Client disconnected, will be cleaned up
  }
}

class WSBroadcaster {
  private clients = new Map<string, WSClient>();

  constructor() {
    // Subscribe to all SSE events and broadcast to WS clients
    sseAggregator.onEvent((event) => this.broadcast(event));
    void sseAggregator.subscribeGlobal();
  }

  addClient(id: string, client: WSClient): void {
    this.clients.set(id, client);
    console.log(`WS client connected: ${id} (user: ${client.userId})`);
    traceServerRealtime("ws:client-connected", summarizeClient(id, client));
  }

  removeClient(id: string): void {
    const client = this.clients.get(id);
    this.clients.delete(id);
    console.log(`WS client disconnected: ${id}`);
    if (client) {
      traceServerRealtime("ws:client-disconnected", summarizeClient(id, client));
    }
  }

  /**
   * Subscribe a client to events for a specific task.
   */
  subscribeToTask(clientId: string, taskId: string): void {
    const client = this.clients.get(clientId);
    if (client) {
      client.subscribedTasks.add(taskId);
      traceServerRealtime("ws:subscribe-task", {
        ...summarizeClient(clientId, client),
        taskId,
      });
    }
  }

  subscribeToProject(clientId: string, projectId: string): void {
    const client = this.clients.get(clientId);
    if (client) {
      client.subscribedProjects.add(projectId);
      traceServerRealtime("ws:subscribe-project", {
        ...summarizeClient(clientId, client),
        projectId,
      });
    }
  }

  /**
   * Broadcast a RealtimeEvent to all relevant clients.
   */
  broadcast(event: RealtimeEvent): void {
    const message = JSON.stringify(event);
    const reasons: Record<string, number> = {};
    let deliveredCount = 0;

    for (const [clientId, client] of this.clients) {
      const decision = explainBroadcastDecision(client, event);
      reasons[decision.reason] = (reasons[decision.reason] ?? 0) + 1;
      traceServerRealtime("ws:broadcast-decision", {
        ...summarizeRealtimeEvent(event),
        ...summarizeClient(clientId, client),
        allowed: decision.allowed,
        reason: decision.reason,
      });
      if (!decision.allowed) {
        continue;
      }
      sendMessageToClient(client, message);
      deliveredCount += 1;
    }

    traceServerRealtime("ws:broadcast-summary", {
      ...summarizeRealtimeEvent(event),
      clientCount: this.clients.size,
      deliveredCount,
      reasons,
    });
  }

  /**
   * Send a targeted event to a specific client.
   */
  sendTo(clientId: string, event: RealtimeEvent): void {
    const client = this.clients.get(clientId);
    if (client) {
      try {
        client.ws.send(JSON.stringify(event));
        traceServerRealtime("ws:send-targeted", {
          ...summarizeRealtimeEvent(event),
          ...summarizeClient(clientId, client),
        });
      } catch {
        // Client disconnected
      }
    }
  }

  getClient(id: string): WSClient | undefined {
    return this.clients.get(id);
  }

  getClientCount(): number {
    return this.clients.size;
  }
}

export const wsBroadcaster = new WSBroadcaster();

/**
 * Verify JWT from WebSocket query string and return payload, or null if invalid.
 */
async function verifyWSToken(url: string): Promise<JWTPayload | null> {
  try {
    const parsed = new URL(url, "http://localhost");
    const token = parsed.searchParams.get("token");
    if (!token) return null;
    const { payload } = await jose.jwtVerify(token, JWT_SECRET);
    return payload as unknown as JWTPayload;
  } catch {
    return null;
  }
}

/**
 * Bun WebSocket handler for the /ws endpoint.
 */
export const websocketHandler = {
  async open(ws: WebSocket) {
    // Verify token passed as ?token=xxx on upgrade
    const url = (ws as unknown as Record<string, unknown>).data as string | undefined;
    const user = url ? await verifyWSToken(url) : null;

    if (!user) {
      ws.close(4401, "Unauthorized");
      return;
    }

    const id = crypto.randomUUID();
    const projectIds = new Set((user.projects || []).map((p) => p.id));

    wsBroadcaster.addClient(id, {
      ws: ws as WSClient["ws"],
      userId: user.sub,
      projectIds,
      subscribedProjects: new Set(),
      subscribedTasks: new Set(),
    });
    (ws as unknown as Record<string, string>).__clientId = id;
    (ws as unknown as Record<string, string>).__userId = user.sub;
  },

  message(ws: WebSocket, message: string | ArrayBuffer) {
    try {
      const data = JSON.parse(
        typeof message === "string" ? message : new TextDecoder().decode(message),
      );

      const clientId = (ws as unknown as Record<string, string>).__clientId;
      if (!clientId) return;

      const client = wsBroadcaster.getClient(clientId);

      // Handle client commands
      if (data.type === "subscribe_task" && typeof data.taskId === "string") {
        // Verify project access: if client has scoped projects, the task's project
        // must be in the allowed set. If projectId is provided in the message,
        // check it; otherwise allow (will be filtered at broadcast time).
        if (data.projectId && client?.projectIds.size && !client.projectIds.has(data.projectId)) {
          ws.send(JSON.stringify({ type: "error", error: "No access to this project" }));
          return;
        }
        wsBroadcaster.subscribeToTask(clientId, data.taskId);
        traceServerRealtime("ws:client-message", {
          clientId,
          action: "subscribe_task",
          taskId: data.taskId,
          projectId: typeof data.projectId === "string" ? data.projectId : undefined,
        });
        ws.send(JSON.stringify({ type: "subscribed", taskId: data.taskId }));
        return;
      }

      if (data.type === "subscribe_project" && typeof data.projectId === "string") {
        if (client?.projectIds.size && !client.projectIds.has(data.projectId)) {
          ws.send(JSON.stringify({ type: "error", error: "No access to this project" }));
          return;
        }
        wsBroadcaster.subscribeToProject(clientId, data.projectId);
        traceServerRealtime("ws:client-message", {
          clientId,
          action: "subscribe_project",
          projectId: data.projectId,
        });
        ws.send(JSON.stringify({ type: "subscribed", projectId: data.projectId }));
      }
    } catch {
      // Malformed message
    }
  },

  close(ws: WebSocket) {
    const clientId = (ws as unknown as Record<string, string>).__clientId;
    if (clientId) {
      wsBroadcaster.removeClient(clientId);
    }
  },
};
