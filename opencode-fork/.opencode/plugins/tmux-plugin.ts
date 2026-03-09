import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { type Plugin, tool } from "@opencode-ai/plugin";

// ── Tmux Integration Plugin ───────────────────────────────────────
//
// Provides interactive terminal management via tmux.
// Agents can spin up persistent terminal sessions, run commands,
// read output, send keystrokes, and manage REPL/debugger sessions.
//
// Clean-room equivalent of oh-my-openagent's tmux integration.
// ───────────────────────────────────────────────────────────────────

// ── Types ──────────────────────────────────────────────────────────

interface TmuxSession {
  name: string;
  createdAt: number;
  purpose: string;
  lastCommand: string;
}

// ── Session Registry ───────────────────────────────────────────────

const tmuxSessions = new Map<string, TmuxSession>();

function sanitizeSessionName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, "_").substring(0, 64);
}

function sanitizeInput(input: string): string {
  // Block dangerous patterns while allowing normal terminal usage
  const blocked = [
    /rm\s+-rf\s+\/(?:\s|$)/, // rm -rf /
    /mkfs\./, // filesystem format
    /dd\s+if=.*of=\/dev\//, // raw disk write
    /:(){ :\|:& };:/, // fork bomb
  ];
  for (const pattern of blocked) {
    if (pattern.test(input)) {
      throw new Error("Blocked: potentially destructive command detected");
    }
  }
  return input;
}

// ── Plugin Export ──────────────────────────────────────────────────

export const TmuxPlugin: Plugin = async ({ $, directory }) => {
  // Check tmux availability
  let tmuxAvailable = false;
  try {
    await $`which tmux`;
    tmuxAvailable = true;
  } catch {
    // tmux not installed
  }

  return {
    tool: {
      tmux_create_session: tool({
        description:
          "Create a new tmux session for persistent interactive terminal work (REPL, debugger, long-running process). Returns the session name for subsequent commands.",
        args: {
          name: tool.schema.string(
            "Session name (alphanumeric, dash, underscore). E.g. 'debug-server', 'python-repl'",
          ),
          purpose: tool.schema.string("Description of what this session is for"),
          startCommand: tool.schema.string(
            "Optional initial command to run in the session (e.g. 'python3', 'node --inspect')",
          ),
          workingDir: tool.schema.string(
            "Working directory path (optional, defaults to project root)",
          ),
        },
        async execute({ name, purpose, startCommand, workingDir }) {
          if (!tmuxAvailable) {
            return JSON.stringify({
              error:
                "tmux is not installed. Install with: brew install tmux (macOS) or apt install tmux (Linux)",
            });
          }

          const sessionName = sanitizeSessionName(`openerx-${name}`);
          const cwd = workingDir || directory;

          if (tmuxSessions.has(sessionName)) {
            return JSON.stringify({
              error: `Session '${sessionName}' already exists. Use tmux_send_keys to interact with it.`,
            });
          }

          try {
            // Create detached session
            if (startCommand) {
              const safeCmd = sanitizeInput(startCommand);
              await $`tmux new-session -d -s ${sessionName} -c ${cwd} ${safeCmd}`;
            } else {
              await $`tmux new-session -d -s ${sessionName} -c ${cwd}`;
            }

            tmuxSessions.set(sessionName, {
              name: sessionName,
              createdAt: Date.now(),
              purpose,
              lastCommand: startCommand || "(shell)",
            });

            return JSON.stringify({
              session: sessionName,
              purpose,
              workingDir: cwd,
              startCommand: startCommand || "(interactive shell)",
              hint: "Use tmux_send_keys to send input and tmux_read_output to capture results.",
            });
          } catch (e) {
            return JSON.stringify({ error: `Failed to create tmux session: ${e}` });
          }
        },
      }),

      tmux_send_keys: tool({
        description:
          "Send keystrokes or a command to an existing tmux session. Use this to interact with REPLs, debuggers, or any interactive terminal.",
        args: {
          session: tool.schema.string("Tmux session name (from tmux_create_session)"),
          keys: tool.schema.string(
            "Keys or command to send. For Enter press, append newline via 'Enter' flag.",
          ),
          pressEnter: tool.schema.boolean(
            "If true, append Enter keystroke after the keys (default: true)",
          ),
        },
        async execute({ session, keys, pressEnter }) {
          if (!tmuxAvailable) {
            return JSON.stringify({ error: "tmux is not installed" });
          }

          const safeKeys = sanitizeInput(keys);
          const doEnter = pressEnter !== false; // default true

          try {
            if (doEnter) {
              await $`tmux send-keys -t ${session} ${safeKeys} Enter`;
            } else {
              await $`tmux send-keys -t ${session} ${safeKeys}`;
            }

            // Brief pause to let the command start executing
            await new Promise((resolve) => setTimeout(resolve, 300));

            // Capture current pane content
            const output = await $`tmux capture-pane -t ${session} -p -S -30`;
            const outputStr = String(output).trim();

            // Update registry
            const entry = tmuxSessions.get(session);
            if (entry) {
              entry.lastCommand = safeKeys;
            }

            return JSON.stringify({
              session,
              sent: safeKeys,
              enterPressed: doEnter,
              recentOutput: outputStr.split("\n").slice(-30).join("\n"),
            });
          } catch (e) {
            return JSON.stringify({ error: `Failed to send keys: ${e}` });
          }
        },
      }),

      tmux_read_output: tool({
        description:
          "Read the current visible output from a tmux session pane. Use to check command results, REPL output, debugger state, etc.",
        args: {
          session: tool.schema.string("Tmux session name"),
          lines: tool.schema.number(
            "Number of lines to capture from scrollback (default: 50, max: 500)",
          ),
        },
        async execute({ session, lines }) {
          if (!tmuxAvailable) {
            return JSON.stringify({ error: "tmux is not installed" });
          }

          const lineCount = Math.min(Math.max(lines || 50, 1), 500);

          try {
            const output = await $`tmux capture-pane -t ${session} -p -S -${lineCount}`;
            const outputStr = String(output).trim();

            return JSON.stringify({
              session,
              linesCaptured: lineCount,
              output: outputStr,
            });
          } catch (e) {
            return JSON.stringify({ error: `Failed to read output: ${e}` });
          }
        },
      }),

      tmux_list_sessions: tool({
        description: "List all active OpenerX tmux sessions with their status and purpose",
        args: {},
        async execute() {
          if (!tmuxAvailable) {
            return JSON.stringify({ error: "tmux is not installed" });
          }

          try {
            const rawList =
              await $`tmux list-sessions -F '#{session_name}:#{session_created}:#{session_windows}:#{session_attached}' 2>/dev/null || true`;
            const rawStr = String(rawList).trim();

            if (!rawStr) {
              return JSON.stringify({ sessions: [], note: "No active tmux sessions" });
            }

            const sessions = rawStr
              .split("\n")
              .filter((line) => line.startsWith("openerx-"))
              .map((line) => {
                const [name, created, windows, attached] = line.split(":");
                if (!name) {
                  return null;
                }

                const meta = tmuxSessions.get(name);
                return {
                  name,
                  created: created
                    ? new Date(Number.parseInt(created) * 1000).toISOString()
                    : "unknown",
                  windows: Number.parseInt(windows || "1"),
                  attached: attached === "1",
                  purpose: meta?.purpose || "unknown",
                  lastCommand: meta?.lastCommand || "unknown",
                };
              })
              .filter((session): session is NonNullable<typeof session> => session !== null);

            return JSON.stringify({ sessions, total: sessions.length });
          } catch (e) {
            return JSON.stringify({ error: `Failed to list sessions: ${e}` });
          }
        },
      }),

      tmux_kill_session: tool({
        description: "Terminate a tmux session and clean up",
        args: {
          session: tool.schema.string("Tmux session name to terminate"),
        },
        async execute({ session }) {
          if (!tmuxAvailable) {
            return JSON.stringify({ error: "tmux is not installed" });
          }

          try {
            await $`tmux kill-session -t ${session}`;
            tmuxSessions.delete(session);

            return JSON.stringify({
              session,
              status: "terminated",
            });
          } catch (e) {
            return JSON.stringify({ error: `Failed to kill session: ${e}` });
          }
        },
      }),

      tmux_send_special: tool({
        description:
          "Send special key sequences to a tmux session (Ctrl-C, Ctrl-D, Ctrl-Z, arrow keys, etc.)",
        args: {
          session: tool.schema.string("Tmux session name"),
          key: tool.schema.string(
            "Special key: 'ctrl-c' | 'ctrl-d' | 'ctrl-z' | 'ctrl-l' | 'escape' | 'tab' | 'up' | 'down' | 'left' | 'right'",
          ),
        },
        async execute({ session, key }) {
          if (!tmuxAvailable) {
            return JSON.stringify({ error: "tmux is not installed" });
          }

          const keyMap: Record<string, string> = {
            "ctrl-c": "C-c",
            "ctrl-d": "C-d",
            "ctrl-z": "C-z",
            "ctrl-l": "C-l",
            escape: "Escape",
            tab: "Tab",
            up: "Up",
            down: "Down",
            left: "Left",
            right: "Right",
          };

          const tmuxKey = keyMap[key.toLowerCase()];
          if (!tmuxKey) {
            return JSON.stringify({
              error: `Unknown key: ${key}. Supported: ${Object.keys(keyMap).join(", ")}`,
            });
          }

          try {
            await $`tmux send-keys -t ${session} ${tmuxKey}`;
            await new Promise((resolve) => setTimeout(resolve, 200));

            const output = await $`tmux capture-pane -t ${session} -p -S -10`;

            return JSON.stringify({
              session,
              keySent: key,
              recentOutput: String(output).trim(),
            });
          } catch (e) {
            return JSON.stringify({ error: `Failed to send special key: ${e}` });
          }
        },
      }),
    },
  };
};

export default TmuxPlugin;
