import type { RealtimeEvent } from "../../types/events";
import type { JWTPayload } from "../../middleware/auth";
import * as jose from "jose";
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
  subscribedTasks: Set<string>;
}

class WSBroadcaster {
  private clients = new Map<string, WSClient>();

  constructor() {
    // Subscribe to all SSE events and broadcast to WS clients
    sseAggregator.onEvent((event) => this.broadcast(event));
  }

  addClient(id: string, client: WSClient): void {
    this.clients.set(id, client);
    console.log(`WS client connected: ${id} (user: ${client.userId})`);
  }

  removeClient(id: string): void {
    this.clients.delete(id);
    console.log(`WS client disconnected: ${id}`);
  }

  /**
   * Subscribe a client to events for a specific task.
   */
  subscribeToTask(clientId: string, taskId: string): void {
    const client = this.clients.get(clientId);
    if (client) {
      client.subscribedTasks.add(taskId);
    }
  }

  /**
   * Broadcast a RealtimeEvent to all relevant clients.
   */
  broadcast(event: RealtimeEvent): void {
    const message = JSON.stringify(event);

    for (const [, client] of this.clients) {
      // Filter by project — only deliver if client has access to the event's project
      if (event.projectId && client.projectIds.size > 0 && !client.projectIds.has(event.projectId)) {
        continue;
      }

      // Filter by task subscription
      if (event.taskId && client.subscribedTasks.size > 0 && !client.subscribedTasks.has(event.taskId)) {
        continue;
      }

      try {
        client.ws.send(message);
      } catch {
        // Client disconnected, will be cleaned up
      }
    }
  }

  /**
   * Send a targeted event to a specific client.
   */
  sendTo(clientId: string, event: RealtimeEvent): void {
    const client = this.clients.get(clientId);
    if (client) {
      try {
        client.ws.send(JSON.stringify(event));
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
      subscribedTasks: new Set(),
    });
    (ws as unknown as Record<string, string>).__clientId = id;
    (ws as unknown as Record<string, string>).__userId = user.sub;
  },

  message(ws: WebSocket, message: string | ArrayBuffer) {
    try {
      const data = JSON.parse(typeof message === "string" ? message : new TextDecoder().decode(message));

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
        ws.send(JSON.stringify({ type: "subscribed", taskId: data.taskId }));
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
