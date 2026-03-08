import { type Plugin, tool } from "@opencode-ai/plugin";

// ── Session Tools ─────────────────────────────────────────────────
//
// Provides tools for listing, reading, searching, and analyzing
// OpenCode session history. Agents use these to reference previous
// conversations, learn from past decisions, and continue work.
//
// Clean-room equivalent of oh-my-openagent's session tools.
// ───────────────────────────────────────────────────────────────────

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

            const sessionList = Object.values(sessions.data);

            // Sort by creation time descending
            const sorted = sessionList
              .sort((a: any, b: any) => {
                const tA = a.createdAt || a.created_at || 0;
                const tB = b.createdAt || b.created_at || 0;
                return tB - tA;
              })
              .slice(0, Math.min(limit || 20, 100));

            const result = sorted.map((s: any) => ({
              id: s.id,
              title: s.title || s.subject || "(untitled)",
              createdAt: s.createdAt || s.created_at,
              updatedAt: s.updatedAt || s.updated_at,
              parentId: s.parentID || s.parent_id || null,
              tokensUsed: s.tokensUsed || s.tokens_used || 0,
              cost: s.cost || 0,
              modelUsed: s.model || s.modelUsed || "unknown",
            }));

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
              return JSON.stringify({ error: `Session '${sessionId}' not found or has no messages` });
            }

            const msgList = Array.isArray(messages.data)
              ? messages.data
              : Object.values(messages.data);

            // Sort chronologically
            const sorted = msgList.sort((a: any, b: any) => {
              const tA = a.createdAt || a.created_at || 0;
              const tB = b.createdAt || b.created_at || 0;
              return tA - tB;
            });

            const selected = lastN ? sorted.slice(-lastN) : sorted;

            const result = selected.map((m: any) => ({
              id: m.id,
              role: m.role,
              content: truncateContent(extractContent(m), 2000),
              toolCalls: m.toolCalls || m.tool_calls || [],
              createdAt: m.createdAt || m.created_at,
              tokens: m.tokens || m.tokensUsed || 0,
            }));

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

            const sessionList = Object.values(sessions.data);
            const searchLimit = Math.min(maxSessions || 10, 30);
            const queryLower = query.toLowerCase();
            const matches: Array<{
              sessionId: string;
              sessionTitle: string;
              matchingMessages: Array<{
                role: string;
                snippet: string;
                createdAt: unknown;
              }>;
            }> = [];

            // Search through recent sessions
            const recentSessions = sessionList
              .sort((a: any, b: any) => {
                const tA = a.createdAt || a.created_at || 0;
                const tB = b.createdAt || b.created_at || 0;
                return tB - tA;
              })
              .slice(0, searchLimit);

            for (const session of recentSessions) {
              try {
                const messages = await client.session.messages({
                  path: { id: (session as any).id },
                });

                if (!messages?.data) continue;

                const msgList = Array.isArray(messages.data)
                  ? messages.data
                  : Object.values(messages.data);

                const matchingMsgs = msgList.filter((m: any) => {
                  const content = extractContent(m).toLowerCase();
                  return content.includes(queryLower);
                });

                if (matchingMsgs.length > 0) {
                  matches.push({
                    sessionId: (session as any).id,
                    sessionTitle: (session as any).title || (session as any).subject || "(untitled)",
                    matchingMessages: matchingMsgs.slice(0, 3).map((m: any) => {
                      const content = extractContent(m);
                      const idx = content.toLowerCase().indexOf(queryLower);
                      const start = Math.max(0, idx - 100);
                      const end = Math.min(content.length, idx + query.length + 100);
                      return {
                        role: m.role,
                        snippet: (start > 0 ? "..." : "") + content.substring(start, end) + (end < content.length ? "..." : ""),
                        createdAt: m.createdAt || m.created_at,
                      };
                    }),
                  });
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

            const msgList = Array.isArray(messages.data)
              ? messages.data
              : Object.values(messages.data);

            // Analyze messages
            let userMsgCount = 0;
            let assistantMsgCount = 0;
            const toolsUsed = new Set<string>();
            const filesReferenced = new Set<string>();
            let totalTokens = 0;
            let firstUserMessage = "";
            let lastAssistantMessage = "";

            for (const m of msgList as any[]) {
              if (m.role === "user") {
                userMsgCount++;
                if (!firstUserMessage) {
                  firstUserMessage = truncateContent(extractContent(m), 200);
                }
              } else if (m.role === "assistant") {
                assistantMsgCount++;
                lastAssistantMessage = truncateContent(extractContent(m), 200);
              }

              totalTokens += m.tokens || m.tokensUsed || 0;

              // Extract tool calls
              const calls = m.toolCalls || m.tool_calls || [];
              for (const tc of calls) {
                const toolName = tc.name || tc.function?.name;
                if (toolName) toolsUsed.add(toolName);
              }

              // Extract file references
              const content = extractContent(m);
              const fileMatches = content.match(/(?:^|\s)([\w./\\-]+\.\w{1,10})(?:\s|$|:|,)/gm);
              if (fileMatches) {
                for (const fm of fileMatches) {
                  const cleaned = fm.trim().replace(/[,:]/g, "");
                  if (cleaned.includes("/") || cleaned.includes(".")) {
                    filesReferenced.add(cleaned);
                  }
                }
              }
            }

            return JSON.stringify({
              sessionId,
              messageCount: msgList.length,
              userMessages: userMsgCount,
              assistantMessages: assistantMsgCount,
              totalTokens,
              toolsUsed: Array.from(toolsUsed),
              filesReferenced: Array.from(filesReferenced).slice(0, 30),
              firstQuery: firstUserMessage,
              lastResponse: lastAssistantMessage,
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

            const msgList = Array.isArray(messages.data)
              ? messages.data
              : Object.values(messages.data);

            // Sort chronologically and get last messages
            const sorted = msgList.sort((a: any, b: any) => {
              const tA = a.createdAt || a.created_at || 0;
              const tB = b.createdAt || b.created_at || 0;
              return tA - tB;
            });

            const recentMessages = sorted.slice(-6).map((m: any) => ({
              role: m.role,
              content: truncateContent(extractContent(m), 1500),
              createdAt: m.createdAt || m.created_at,
            }));

            // Look for TODO items or pending work indicators
            const allContent = sorted.map((m: any) => extractContent(m)).join("\n");
            const todoPattern = /(?:TODO|FIXME|PENDING|NEXT|remaining|still need|not yet|incomplete)[:\s].{10,100}/gi;
            const pendingItems = [...allContent.matchAll(todoPattern)].map((m) => m[0]).slice(0, 10);

            return JSON.stringify({
              sessionId,
              totalMessages: msgList.length,
              recentMessages,
              pendingItems,
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

function extractContent(message: any): string {
  if (typeof message.content === "string") return message.content;
  if (Array.isArray(message.content)) {
    return message.content
      .map((p: any) => {
        if (typeof p === "string") return p;
        if (p.type === "text") return p.text;
        if (p.type === "tool_use") return `[tool: ${p.name}]`;
        if (p.type === "tool_result") return `[tool_result: ${p.content || ""}]`;
        return "";
      })
      .join("\n");
  }
  return String(message.content || "");
}

function truncateContent(content: string, maxLen: number): string {
  if (content.length <= maxLen) return content;
  return content.substring(0, maxLen) + `... (${content.length - maxLen} chars truncated)`;
}

export default SessionToolsPlugin;
