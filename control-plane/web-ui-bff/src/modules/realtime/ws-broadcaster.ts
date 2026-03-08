import type { RealtimeEvent } from "../../types/events";
import { sseAggregator } from "./sse-aggregator";

// ── WebSocket Broadcaster ──────────────────────────────────────────
// Maintains connected WebSocket clients and broadcasts RealtimeEvents.

interface WSClient {
  ws: WebSocket & { send: (data: string) => void };
  userId: string;
  projectId?: string;
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
      // Filter by project if client has project scope
      if (event.projectId && client.projectId && event.projectId !== client.projectId) {
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

  getClientCount(): number {
    return this.clients.size;
  }
}

export const wsBroadcaster = new WSBroadcaster();

/**
 * Bun WebSocket handler for the /ws endpoint.
 */
export const websocketHandler = {
  open(ws: WebSocket) {
    const id = crypto.randomUUID();
    // In production, extract userId from auth token in upgrade headers
    wsBroadcaster.addClient(id, {
      ws: ws as WSClient["ws"],
      userId: "anonymous",
      subscribedTasks: new Set(),
    });
    (ws as unknown as Record<string, string>).__clientId = id;
  },

  message(ws: WebSocket, message: string | ArrayBuffer) {
    try {
      const data = JSON.parse(typeof message === "string" ? message : new TextDecoder().decode(message));

      const clientId = (ws as unknown as Record<string, string>).__clientId;
      if (!clientId) return;

      // Handle client commands
      if (data.type === "subscribe_task" && data.taskId) {
        wsBroadcaster.subscribeToTask(clientId, data.taskId);
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
