import type { RealtimeEvent, RealtimeEventType } from "../../types/events";

// ── SSE Aggregator ─────────────────────────────────────────────────
// Subscribes to OpenCode Runtime SSE events and transforms them into
// standard RealtimeEvent format for WebSocket broadcast.

interface SSEConnection {
  url: string;
  eventSource: EventSource | null;
  reconnectAttempts: number;
  maxReconnectAttempts: number;
}

type EventHandler = (event: RealtimeEvent) => void;

const OPENCODE_URL = process.env.OPENCODE_URL || "http://localhost:4096";

class SSEAggregator {
  private connections = new Map<string, SSEConnection>();
  private handlers = new Set<EventHandler>();
  private reconnectDelay = 1000;

  /**
   * Subscribe to the global OpenCode SSE event stream.
   */
  async subscribeGlobal(): Promise<void> {
    const url = `${OPENCODE_URL}/api/event`;
    await this.connect("global", url);
  }

  /**
   * Subscribe to a specific session's SSE stream.
   */
  async subscribeSession(sessionId: string): Promise<void> {
    const url = `${OPENCODE_URL}/api/session/${sessionId}/event`;
    await this.connect(`session:${sessionId}`, url);
  }

  private async connect(key: string, url: string): Promise<void> {
    if (this.connections.has(key)) return;

    const conn: SSEConnection = {
      url,
      eventSource: null,
      reconnectAttempts: 0,
      maxReconnectAttempts: 10,
    };

    this.connections.set(key, conn);
    await this.startSSE(key, conn);
  }

  private async startSSE(key: string, conn: SSEConnection): Promise<void> {
    try {
      const response = await fetch(conn.url, {
        headers: { Accept: "text/event-stream" },
      });

      if (!response.ok || !response.body) {
        throw new Error(`SSE connection failed: ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      conn.reconnectAttempts = 0;

      const read = async () => {
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() || "";

            let eventType = "";
            let data = "";

            for (const line of lines) {
              if (line.startsWith("event:")) {
                eventType = line.slice(6).trim();
              } else if (line.startsWith("data:")) {
                data = line.slice(5).trim();
              } else if (line === "" && data) {
                // End of event
                this.handleSSEEvent(eventType, data);
                eventType = "";
                data = "";
              }
            }
          }
        } catch {
          // Connection lost, try reconnect
          this.scheduleReconnect(key, conn);
        }
      };

      read();
    } catch {
      this.scheduleReconnect(key, conn);
    }
  }

  private scheduleReconnect(key: string, conn: SSEConnection): void {
    if (conn.reconnectAttempts >= conn.maxReconnectAttempts) {
      console.error(`SSE ${key}: max reconnect attempts reached`);
      this.connections.delete(key);
      return;
    }

    conn.reconnectAttempts++;
    const delay = this.reconnectDelay * Math.pow(2, conn.reconnectAttempts - 1);
    console.log(`SSE ${key}: reconnecting in ${delay}ms (attempt ${conn.reconnectAttempts})`);

    setTimeout(() => this.startSSE(key, conn), delay);
  }

  private handleSSEEvent(type: string, data: string): void {
    try {
      const parsed = JSON.parse(data);
      const event = this.transformEvent(type, parsed);
      if (event) {
        for (const handler of this.handlers) {
          handler(event);
        }
      }
    } catch {
      // Malformed event, skip
    }
  }

  /**
   * Transform an OpenCode SSE event into a standard RealtimeEvent.
   */
  private transformEvent(type: string, data: Record<string, unknown>): RealtimeEvent | null {
    const eventTypeMap: Record<string, RealtimeEventType> = {
      "session.created": "session.created",
      "session.updated": "session.updated",
      "session.idle": "session.idle",
      "session.error": "session.error",
      "message.updated": "message.updated",
      "tool.execute.before": "tool.execute.before",
      "tool.execute.after": "tool.execute.after",
    };

    const mappedType = eventTypeMap[type];
    if (!mappedType) return null;

    return {
      id: crypto.randomUUID(),
      type: mappedType,
      ts: new Date().toISOString(),
      sessionId: data.sessionId as string | undefined,
      taskId: data.taskId as string | undefined,
      data,
    };
  }

  onEvent(handler: EventHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  disconnect(key: string): void {
    const conn = this.connections.get(key);
    if (conn) {
      conn.eventSource?.close();
      this.connections.delete(key);
    }
  }

  disconnectAll(): void {
    for (const [key] of this.connections) {
      this.disconnect(key);
    }
  }
}

export const sseAggregator = new SSEAggregator();
