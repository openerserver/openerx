import { cpFetch, createInternalAuthorization } from "../../lib/control-plane-client";
import type { RealtimeEvent, RealtimeEventType } from "../../types/events";
import {
  findAgentRunBySessionId,
  getSessionMessages,
  updateAgentRunStatus,
} from "../agent-control/opencode-adapter";
import { observeGraphWorkspaceDir, onGraphToolExecuted } from "./dag-sync";

// ── SSE Aggregator ─────────────────────────────────────────────────
// Subscribes to OpenCode Runtime SSE events and transforms them into
// standard RealtimeEvent format for WebSocket broadcast.

interface SSEConnection {
  url: string;
  abortController: AbortController | null;
  reconnectAttempts: number;
  maxReconnectAttempts: number;
}

type EventHandler = (event: RealtimeEvent) => void;

const OPENCODE_URL = process.env.OPENCODE_URL || "http://localhost:4096";

class SSEAggregator {
  private connections = new Map<string, SSEConnection>();
  private handlers = new Set<EventHandler>();
  private reconnectDelay = 1000;
  private finalizingAgentRuns = new Set<string>();
  private finalizedAgentRuns = new Set<string>();

  /**
   * Subscribe to the global OpenCode SSE event stream.
   */
  async subscribeGlobal(): Promise<void> {
    const url = `${OPENCODE_URL}/global/event`;
    await this.connect("global", url);
  }

  /**
   * Subscribe to a specific session's SSE stream.
   */
  async subscribeSession(_sessionId: string): Promise<void> {
    await this.subscribeGlobal();
  }

  private async connect(key: string, url: string): Promise<void> {
    if (this.connections.has(key)) return;

    const conn: SSEConnection = {
      url,
      abortController: null,
      reconnectAttempts: 0,
      maxReconnectAttempts: 10,
    };

    this.connections.set(key, conn);
    await this.startSSE(key, conn);
  }

  private async startSSE(key: string, conn: SSEConnection): Promise<void> {
    try {
      conn.abortController = new AbortController();
      const response = await fetch(conn.url, {
        headers: { Accept: "text/event-stream" },
        signal: conn.abortController.signal,
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

            let eventType = "message";
            const dataLines: string[] = [];

            for (const line of lines) {
              if (line.startsWith("event:")) {
                eventType = line.slice(6).trim();
              } else if (line.startsWith("data:")) {
                dataLines.push(line.slice(5).trim());
              } else if (line === "" && dataLines.length > 0) {
                // End of event
                this.handleSSEEvent(eventType, dataLines.join("\n"));
                eventType = "message";
                dataLines.length = 0;
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
    const delay = this.reconnectDelay * 2 ** (conn.reconnectAttempts - 1);
    console.log(`SSE ${key}: reconnecting in ${delay}ms (attempt ${conn.reconnectAttempts})`);

    setTimeout(() => this.startSSE(key, conn), delay);
  }

  private handleSSEEvent(type: string, data: string): void {
    try {
      const parsed = JSON.parse(data);
      const workspaceDirectory =
        typeof parsed === "object" && parsed && "directory" in parsed
          ? String(parsed.directory || "")
          : "";
      observeGraphWorkspaceDir(workspaceDirectory);
      const payload =
        typeof parsed === "object" && parsed && "payload" in parsed
          ? (parsed.payload as Record<string, unknown>)
          : null;

      const event = payload
        ? this.transformEvent(String(payload.type || type), {
            ...(typeof parsed === "object" && parsed ? parsed : {}),
            ...(typeof payload.properties === "object" && payload.properties
              ? payload.properties
              : {}),
            rawType: payload.type,
          })
        : this.transformEvent(type, parsed as Record<string, unknown>);

      if (event) {
        this.emit(event);
        if (event.type === "session.error") {
          this.maybeEmitAuthError(event);
        }
        void this.maybeFinalizeRun(event);
      }

      // Trigger DAG sync for task_graph_* tool calls
      this.maybeSyncDag(type, payload, parsed as Record<string, unknown>, workspaceDirectory);
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
      "message.part.updated": "message.updated",
      "tool.execute.before": "tool.execute.before",
      "tool.execute.after": "tool.execute.after",
    };

    const mappedType = eventTypeMap[type];
    if (!mappedType) return null;

    const sessionId = this.extractSessionId(type, data);
    const run = sessionId ? findAgentRunBySessionId(sessionId) : undefined;

    return {
      id: crypto.randomUUID(),
      type: mappedType,
      ts: new Date().toISOString(),
      sessionId,
      taskId: run?.taskId,
      projectId: run?.projectId,
      agentRunId: run?.agentRunId,
      data,
    };
  }

  private emit(event: RealtimeEvent): void {
    for (const handler of this.handlers) {
      handler(event);
    }
  }

  /**
   * Detect provider-level auth errors (e.g. Copilot 403) and surface
   * them as an explicit agent.auth-error event so the frontend can act
   * immediately instead of waiting for a completion that will never arrive.
   */
  private maybeEmitAuthError(event: RealtimeEvent): void {
    const error =
      typeof event.data.error === "object" && event.data.error
        ? (event.data.error as Record<string, unknown>)
        : undefined;
    if (!error) return;

    const errorData =
      typeof error.data === "object" && error.data
        ? (error.data as Record<string, unknown>)
        : undefined;

    const statusCode = errorData?.statusCode;
    const isAuthError =
      statusCode === 401 ||
      statusCode === 403 ||
      (typeof errorData?.message === "string" &&
        /reauthenticate|unauthorized|auth/i.test(errorData.message as string));

    if (!isAuthError) return;

    const { sessionId, taskId, projectId, agentRunId } = event;

    console.warn(
      `Provider auth error detected (status=${statusCode}) for session ${sessionId}`,
    );

    this.emit({
      id: crypto.randomUUID(),
      type: "agent.auth-error",
      ts: new Date().toISOString(),
      sessionId,
      taskId,
      projectId,
      agentRunId,
      data: {
        statusCode,
        message: errorData?.message ?? error.name ?? "Provider authentication failed",
        provider: (errorData?.metadata as Record<string, unknown>)?.url ?? undefined,
        isRetryable: errorData?.isRetryable ?? false,
      },
    });

    // Mark the agent run as failed so the system stops waiting for completion
    if (agentRunId) {
      updateAgentRunStatus(agentRunId, "failed");
    }
  }

  private isCompletionSignal(event: RealtimeEvent): boolean {
    if (!event.sessionId || !event.agentRunId || !event.taskId || !event.projectId) {
      return false;
    }

    if (event.type === "session.idle") {
      return true;
    }

    const info =
      typeof event.data.info === "object" && event.data.info
        ? (event.data.info as Record<string, unknown>)
        : undefined;
    const time =
      typeof info?.time === "object" && info.time
        ? (info.time as Record<string, unknown>)
        : undefined;
    const completed = time?.completed;

    if (event.type === "session.updated") {
      return typeof completed === "number" || typeof completed === "string";
    }

    if (event.type === "message.updated") {
      const finish = typeof info?.finish === "string" ? info.finish : undefined;
      return (
        info?.role === "assistant" &&
        finish === "stop" &&
        (typeof completed === "number" || typeof completed === "string")
      );
    }

    return false;
  }

  private async maybeFinalizeRun(event: RealtimeEvent): Promise<void> {
    if (
      !this.isCompletionSignal(event) ||
      !event.agentRunId ||
      !event.sessionId ||
      !event.taskId ||
      !event.projectId
    ) {
      return;
    }

    const run = findAgentRunBySessionId(event.sessionId);
    if (!run || run.status !== "running") {
      return;
    }

    if (this.finalizedAgentRuns.has(event.agentRunId)) {
      return;
    }

    if (this.finalizingAgentRuns.has(event.agentRunId)) {
      return;
    }

    this.finalizingAgentRuns.add(event.agentRunId);

    try {
      const authorization = await createInternalAuthorization();
      const assistantResult = await this.getLatestAssistantResult(
        event.sessionId,
        event.type === "session.idle" ? 20000 : 8000,
      );

      if (event.type === "session.idle" && !assistantResult.completed) {
        return;
      }

      const resultText = assistantResult.text;
      const taskUpdate = await cpFetch(`/api/tasks/${encodeURIComponent(event.taskId)}`, {
        method: "PATCH",
        authorization,
        body: {
          status: "completed",
          sessionId: event.sessionId,
          agentRunId: event.agentRunId,
          ...(resultText ? { result: resultText } : {}),
        },
      });

      if (!taskUpdate.ok) {
        throw new Error(`Task completion sync failed: ${taskUpdate.status}`);
      }

      updateAgentRunStatus(event.agentRunId, "completed");
      this.finalizedAgentRuns.add(event.agentRunId);

      this.emit({
        id: crypto.randomUUID(),
        type: "agent.completed",
        ts: new Date().toISOString(),
        sessionId: event.sessionId,
        taskId: event.taskId,
        projectId: event.projectId,
        agentRunId: event.agentRunId,
        data: {
          sourceEvent: event.type,
          ...(resultText ? { result: resultText } : {}),
        },
      });

      this.emit({
        id: crypto.randomUUID(),
        type: "task.completed",
        ts: new Date().toISOString(),
        sessionId: event.sessionId,
        taskId: event.taskId,
        projectId: event.projectId,
        agentRunId: event.agentRunId,
        data: {
          status: "completed",
          sourceEvent: event.type,
          ...(resultText ? { result: resultText } : {}),
        },
      });
    } catch (error) {
      console.error(`Failed to finalize agent run ${event.agentRunId}:`, error);
    } finally {
      this.finalizingAgentRuns.delete(event.agentRunId);
    }
  }

  private async getLatestAssistantResult(
    sessionId: string,
    timeoutMs: number,
  ): Promise<{ text?: string; completed: boolean }> {
    const deadline = Date.now() + timeoutMs;
    let fallbackText: string | undefined;

    while (Date.now() < deadline) {
      const messagesResult = await getSessionMessages(sessionId);
      if (!messagesResult.ok || !Array.isArray(messagesResult.data)) {
        return { text: fallbackText, completed: false };
      }

      for (let index = messagesResult.data.length - 1; index >= 0; index--) {
        const message = messagesResult.data[index];
        if (!message || typeof message !== "object") {
          continue;
        }

        const info =
          "info" in message && typeof message.info === "object" && message.info
            ? (message.info as Record<string, unknown>)
            : undefined;
        if (info?.role !== "assistant") {
          continue;
        }

        const parts = Array.isArray((message as { parts?: unknown }).parts)
          ? ((message as { parts: unknown[] }).parts as Record<string, unknown>[])
          : [];
        const text = parts
          .filter((part) => part.type === "text" && typeof part.text === "string")
          .map((part) => String(part.text).trim())
          .filter(Boolean)
          .join("\n\n");

        if (text) {
          fallbackText = text;
        }

        const time =
          typeof info?.time === "object" && info.time
            ? (info.time as Record<string, unknown>)
            : undefined;
        const completed = time?.completed;
        if (text && (typeof completed === "number" || typeof completed === "string")) {
          return { text, completed: true };
        }

        break;
      }

      await new Promise((resolve) => setTimeout(resolve, 250));
    }

    return { text: fallbackText, completed: false };
  }

  private extractSessionId(type: string, data: Record<string, unknown>): string | undefined {
    if (typeof data.sessionId === "string") return data.sessionId;
    if (typeof data.sessionID === "string") return data.sessionID;

    const info =
      typeof data.info === "object" && data.info
        ? (data.info as Record<string, unknown>)
        : undefined;
    if (type.startsWith("session.") && typeof info?.id === "string") {
      return info.id;
    }
    if (typeof info?.sessionID === "string") {
      return info.sessionID;
    }

    const part =
      typeof data.part === "object" && data.part
        ? (data.part as Record<string, unknown>)
        : undefined;
    if (typeof part?.sessionID === "string") {
      return part.sessionID;
    }

    return undefined;
  }

  private maybeSyncDag(
    type: string,
    payload: Record<string, unknown> | null,
    parsed: Record<string, unknown>,
    workspaceDirectory?: string,
  ): void {
    const eventType = payload ? String(payload.type || type) : type;
    if (eventType !== "tool.execute.after") return;

    const props =
      (typeof payload?.properties === "object" && payload.properties
        ? (payload.properties as Record<string, unknown>)
        : parsed) || {};
    const toolName = String(props.toolName || props.name || "");
    if (!toolName.startsWith("task_graph_")) return;

    const toolResult = String(props.result || props.output || "{}");
    const sessionId = this.extractSessionId(payload ?? parsed);
    void onGraphToolExecuted(toolName, toolResult, workspaceDirectory, sessionId);
  }

  onEvent(handler: EventHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  disconnect(key: string): void {
    const conn = this.connections.get(key);
    if (conn) {
      conn.abortController?.abort();
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
