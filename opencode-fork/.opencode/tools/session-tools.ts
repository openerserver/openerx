import { type Plugin, tool } from "@opencode-ai/plugin";

// ── Session Tools ─────────────────────────────────────────────────
//
// Provides tools for listing, reading, searching, and analyzing
// OpenCode session history. Agents use these to reference previous
// conversations, learn from past decisions, and continue work.
//
// Clean-room equivalent of oh-my-openagent's session tools.
// ───────────────────────────────────────────────────────────────────

type UnknownRecord = Record<string, unknown>;

interface SessionRecord extends UnknownRecord {
  id?: string;
  title?: string;
  subject?: string;
  createdAt?: number | string;
  created_at?: number | string;
  updatedAt?: number | string;
  updated_at?: number | string;
  parentID?: string;
  parent_id?: string;
  tokensUsed?: number;
  tokens_used?: number;
  cost?: number;
  model?: string;
  modelUsed?: string;
}

interface ToolCallRecord extends UnknownRecord {
  name?: string;
  function?: { name?: string };
}

interface MessageRecord extends UnknownRecord {
  id?: string;
  role?: string;
  content?: unknown;
  toolCalls?: ToolCallRecord[];
  tool_calls?: ToolCallRecord[];
  createdAt?: number | string;
  created_at?: number | string;
  tokens?: number;
  tokensUsed?: number;
}

interface SearchResult {
  sessionId: string;
  sessionTitle: string;
  matchingMessages: Array<{
    role: string;
    snippet: string;
    createdAt: unknown;
  }>;
}

interface SessionSummaryStats {
  userMessages: number;
  assistantMessages: number;
  totalTokens: number;
  firstQuery: string;
  lastResponse: string;
}

function asRecord(value: unknown): UnknownRecord | null {
  return value && typeof value === "object" ? (value as UnknownRecord) : null;
}

function asSessionRecord(value: unknown): SessionRecord | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }
  return record as SessionRecord;
}

function asMessageRecord(value: unknown): MessageRecord | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }
  return record as MessageRecord;
}

function extractDataList<T>(data: unknown, mapper: (value: unknown) => T | null): T[] {
  const values = Array.isArray(data)
    ? data
    : data && typeof data === "object"
      ? Object.values(data as UnknownRecord)
      : [];

  return values.flatMap((value) => {
    const mapped = mapper(value);
    return mapped ? [mapped] : [];
  });
}

function getSessionList(data: unknown): SessionRecord[] {
  return extractDataList(data, asSessionRecord);
}

function getMessageList(data: unknown): MessageRecord[] {
  return extractDataList(data, asMessageRecord);
}

function getTimestamp(record: {
  createdAt?: number | string;
  created_at?: number | string;
}): number {
  const value = record.createdAt ?? record.created_at ?? 0;
  return typeof value === "number" ? value : Number.parseInt(String(value), 10) || 0;
}

function sortByCreatedDesc<T extends { createdAt?: number | string; created_at?: number | string }>(
  items: T[],
): T[] {
  return [...items].sort((a, b) => getTimestamp(b) - getTimestamp(a));
}

function sortByCreatedAsc<T extends { createdAt?: number | string; created_at?: number | string }>(
  items: T[],
): T[] {
  return [...items].sort((a, b) => getTimestamp(a) - getTimestamp(b));
}

function getSessionId(session: SessionRecord): string {
  return typeof session.id === "string" ? session.id : "unknown";
}

function getSessionTitle(session: SessionRecord): string {
  if (typeof session.title === "string" && session.title.length > 0) {
    return session.title;
  }
  if (typeof session.subject === "string" && session.subject.length > 0) {
    return session.subject;
  }
  return "(untitled)";
}

function getToolCalls(message: MessageRecord): ToolCallRecord[] {
  if (Array.isArray(message.toolCalls)) {
    return message.toolCalls;
  }
  if (Array.isArray(message.tool_calls)) {
    return message.tool_calls;
  }
  return [];
}

function summarizeSessionRecord(session: SessionRecord) {
  return {
    id: getSessionId(session),
    title: getSessionTitle(session),
    createdAt: session.createdAt ?? session.created_at,
    updatedAt: session.updatedAt ?? session.updated_at,
    parentId: session.parentID ?? session.parent_id ?? null,
    tokensUsed: session.tokensUsed ?? session.tokens_used ?? 0,
    cost: session.cost ?? 0,
    modelUsed: session.model ?? session.modelUsed ?? "unknown",
  };
}

function summarizeMessageRecord(message: MessageRecord) {
  return {
    id: message.id,
    role: message.role,
    content: truncateContent(extractContent(message), 2000),
    toolCalls: getToolCalls(message),
    createdAt: message.createdAt ?? message.created_at,
    tokens: message.tokens ?? message.tokensUsed ?? 0,
  };
}

function buildSnippet(content: string, query: string): string {
  const idx = content.toLowerCase().indexOf(query);
  const start = Math.max(0, idx - 100);
  const end = Math.min(content.length, idx + query.length + 100);
  return `${start > 0 ? "..." : ""}${content.substring(start, end)}${end < content.length ? "..." : ""}`;
}

function updateSummaryStats(
  stats: SessionSummaryStats,
  message: MessageRecord,
  content: string,
): void {
  if (message.role === "user") {
    stats.userMessages++;
    if (!stats.firstQuery) {
      stats.firstQuery = truncateContent(content, 200);
    }
  } else if (message.role === "assistant") {
    stats.assistantMessages++;
    stats.lastResponse = truncateContent(content, 200);
  }

  stats.totalTokens += message.tokens ?? message.tokensUsed ?? 0;
}

function collectToolNames(message: MessageRecord, toolsUsed: Set<string>): void {
  for (const toolCall of getToolCalls(message)) {
    const toolName = toolCall.name ?? toolCall.function?.name;
    if (toolName) {
      toolsUsed.add(toolName);
    }
  }
}

function collectReferencedFiles(content: string, filesReferenced: Set<string>): void {
  const fileMatches = content.match(/(?:^|\s)([\w./\\-]+\.\w{1,10})(?:\s|$|:|,)/gm);
  if (!fileMatches) {
    return;
  }

  for (const match of fileMatches) {
    const cleaned = match.trim().replace(/[,:]/g, "");
    if (cleaned.includes("/") || cleaned.includes(".")) {
      filesReferenced.add(cleaned);
    }
  }
}

function getPartContent(part: unknown): string {
  if (typeof part === "string") {
    return part;
  }

  const record = asRecord(part);
  if (!record) {
    return "";
  }

  if (record.type === "text" && typeof record.text === "string") {
    return record.text;
  }
  if (record.type === "tool_use") {
    return `[tool: ${String(record.name ?? "unknown")}]`;
  }
  if (record.type === "tool_result") {
    return `[tool_result: ${String(record.content ?? "")}]`;
  }

  return "";
}

async function searchSession(
  client: Parameters<Plugin>[0]["client"],
  session: SessionRecord,
  query: string,
): Promise<SearchResult | null> {
  const sessionId = getSessionId(session);
  if (sessionId === "unknown") {
    return null;
  }

  const messages = await client.session.messages({
    path: { id: sessionId },
  });

  if (!messages?.data) {
    return null;
  }

  const msgList = getMessageList(messages.data);
  const matchingMessages = msgList
    .filter((message) => extractContent(message).toLowerCase().includes(query))
    .slice(0, 3)
    .map((message) => ({
      role: message.role ?? "unknown",
      snippet: buildSnippet(extractContent(message), query),
      createdAt: message.createdAt ?? message.created_at,
    }));

  if (matchingMessages.length === 0) {
    return null;
  }

  return {
    sessionId,
    sessionTitle: getSessionTitle(session),
    matchingMessages,
  };
}

function summarizeMessages(msgList: MessageRecord[]) {
  const stats: SessionSummaryStats = {
    userMessages: 0,
    assistantMessages: 0,
    totalTokens: 0,
    firstQuery: "",
    lastResponse: "",
  };
  const toolsUsed = new Set<string>();
  const filesReferenced = new Set<string>();

  for (const message of msgList) {
    const content = extractContent(message);
    updateSummaryStats(stats, message, content);
    collectToolNames(message, toolsUsed);
    collectReferencedFiles(content, filesReferenced);
  }

  return {
    messageCount: msgList.length,
    userMessages: stats.userMessages,
    assistantMessages: stats.assistantMessages,
    totalTokens: stats.totalTokens,
    toolsUsed: Array.from(toolsUsed),
    filesReferenced: Array.from(filesReferenced).slice(0, 30),
    firstQuery: stats.firstQuery,
    lastResponse: stats.lastResponse,
  };
}

function buildContinuePayload(msgList: MessageRecord[]) {
  const sorted = sortByCreatedAsc(msgList);
  const recentMessages = sorted.slice(-6).map((message) => ({
    role: message.role ?? "unknown",
    content: truncateContent(extractContent(message), 1500),
    createdAt: message.createdAt ?? message.created_at,
  }));

  const allContent = sorted.map((message) => extractContent(message)).join("\n");
  const todoPattern =
    /(?:TODO|FIXME|PENDING|NEXT|remaining|still need|not yet|incomplete)[:\s].{10,100}/gi;
  const pendingItems = [...allContent.matchAll(todoPattern)].map((match) => match[0]).slice(0, 10);

  return {
    totalMessages: msgList.length,
    recentMessages,
    pendingItems,
  };
}

export const SessionToolsPlugin: Plugin = async ({ client }) => {
  return {
    tool: {
      session_list: tool({
        description:
          "List all OpenCode sessions with their IDs, creation times, and token usage. Useful for finding previous conversations to reference or continue.",
        args: {
          limit: tool.schema.number("Maximum number of sessions to return (default: 20, max: 100)"),
        },
        async execute({ limit }) {
          try {
            const sessions = await client.session.list();

            if (!sessions?.data) {
              return JSON.stringify({ sessions: [], note: "No sessions found or SDK unavailable" });
            }

            const sessionList = getSessionList(sessions.data);
            const sorted = sortByCreatedDesc(sessionList).slice(0, Math.min(limit || 20, 100));
            const result = sorted.map(summarizeSessionRecord);

            return JSON.stringify({
              sessions: result,
              total: sessionList.length,
              showing: result.length,
            });
          } catch (e) {
            return JSON.stringify({ error: `Failed to list sessions: ${e}` });
          }
        },
      }),

      session_read: tool({
        description:
          "Read the full message history of a specific session. Returns all messages (user + assistant + tool calls) in chronological order.",
        args: {
          sessionId: tool.schema.string("Session ID to read messages from"),
          lastN: tool.schema.number("Only return the last N messages (optional — omit for all)"),
        },
        async execute({ sessionId, lastN }) {
          try {
            const messages = await client.session.messages({
              path: { id: sessionId },
            });

            if (!messages?.data) {
              return JSON.stringify({
                error: `Session '${sessionId}' not found or has no messages`,
              });
            }

            const msgList = getMessageList(messages.data);
            const sorted = sortByCreatedAsc(msgList);

            const selected = lastN ? sorted.slice(-lastN) : sorted;
            const result = selected.map(summarizeMessageRecord);

            return JSON.stringify({
              sessionId,
              messages: result,
              totalMessages: msgList.length,
              showing: result.length,
            });
          } catch (e) {
            return JSON.stringify({ error: `Failed to read session: ${e}` });
          }
        },
      }),

      session_search: tool({
        description:
          "Search across session histories for specific content, patterns, or topics. Helps find relevant past work, decisions, or code discussions.",
        args: {
          query: tool.schema.string("Search query — will match against message content"),
          maxSessions: tool.schema.number("Maximum number of sessions to search (default: 10)"),
        },
        async execute({ query, maxSessions }) {
          try {
            const sessions = await client.session.list();

            if (!sessions?.data) {
              return JSON.stringify({ results: [], note: "No sessions available" });
            }

            const sessionList = getSessionList(sessions.data);
            const searchLimit = Math.min(maxSessions || 10, 30);
            const queryLower = query.toLowerCase();
            const matches: SearchResult[] = [];
            const recentSessions = sortByCreatedDesc(sessionList).slice(0, searchLimit);

            for (const session of recentSessions) {
              try {
                const match = await searchSession(client, session, queryLower);
                if (match) {
                  matches.push(match);
                }
              } catch {
                // Skip inaccessible sessions
              }
            }

            return JSON.stringify({
              query,
              results: matches,
              sessionsSearched: recentSessions.length,
              matchCount: matches.length,
            });
          } catch (e) {
            return JSON.stringify({ error: `Session search failed: ${e}` });
          }
        },
      }),

      session_summary: tool({
        description:
          "Generate a summary of a session — key decisions made, files modified, tools used, and outcomes. Great for review or handoff.",
        args: {
          sessionId: tool.schema.string("Session ID to summarize"),
        },
        async execute({ sessionId }) {
          try {
            const messages = await client.session.messages({
              path: { id: sessionId },
            });

            if (!messages?.data) {
              return JSON.stringify({ error: `Session '${sessionId}' not found` });
            }

            const msgList = getMessageList(messages.data);
            const summary = summarizeMessages(msgList);

            return JSON.stringify({
              sessionId,
              ...summary,
            });
          } catch (e) {
            return JSON.stringify({ error: `Failed to summarize session: ${e}` });
          }
        },
      }),

      session_continue: tool({
        description:
          "Get the context needed to continue work from a previous session. Returns the last few messages and any pending tasks or unresolved items.",
        args: {
          sessionId: tool.schema.string("Session ID to continue from"),
        },
        async execute({ sessionId }) {
          try {
            const messages = await client.session.messages({
              path: { id: sessionId },
            });

            if (!messages?.data) {
              return JSON.stringify({ error: `Session '${sessionId}' not found` });
            }

            const msgList = getMessageList(messages.data);
            const continuation = buildContinuePayload(msgList);

            return JSON.stringify({
              sessionId,
              ...continuation,
              hint: "Review recent messages to understand context, then continue the work.",
            });
          } catch (e) {
            return JSON.stringify({ error: `Failed to load session context: ${e}` });
          }
        },
      }),
    },
  };
};

// ── Utility Functions ──────────────────────────────────────────────

function extractContent(message: MessageRecord): string {
  if (typeof message.content === "string") return message.content;
  if (Array.isArray(message.content)) {
    return message.content.map(getPartContent).join("\n");
  }
  return String(message.content || "");
}

function truncateContent(content: string, maxLen: number): string {
  if (content.length <= maxLen) return content;
  return `${content.substring(0, maxLen)}... (${content.length - maxLen} chars truncated)`;
}

export default SessionToolsPlugin;
