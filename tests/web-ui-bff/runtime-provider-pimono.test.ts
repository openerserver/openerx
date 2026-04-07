/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

const runtimeProviderPiMonoModulePath =
  "../../control-plane/web-ui-bff/src/modules/agent-control/runtime-provider-pimono";
const ensureAgentRunForSessionMock = mock(
  (
    sessionId: string,
    _taskId: string,
    _projectId: string,
    _model?: { providerId: string; modelId: string },
    agentRunId?: string,
  ) => agentRunId ?? sessionId,
);
const ingestParsedEventMock = mock(async () => undefined);
const updateAgentRunStatusMock = mock(() => undefined);

mock.module("../../control-plane/web-ui-bff/src/modules/agent-control/agent-run-registry", () => ({
  ensureAgentRunForSession: ensureAgentRunForSessionMock,
  findAgentRunBySessionId: mock(() => undefined),
  getAgentRun: mock(() => undefined),
  listAgentRuns: mock(() => []),
  recoverAgentRun: mock(() => undefined),
  registerAgentRun: mock(() => undefined),
  updateAgentRunStatus: updateAgentRunStatusMock,
}));

mock.module("../../control-plane/web-ui-bff/src/modules/realtime/sse-aggregator", () => ({
  sseAggregator: {
    ingestParsedEvent: ingestParsedEventMock,
  },
}));

function buildFakePiMonoRpcServerScript() {
  return String.raw`
    const { StringDecoder } = require("node:string_decoder");
    const fs = require("node:fs");
    const os = require("node:os");
    const path = require("node:path");

    const namespace = process.argv[1] || "default";
    const decoder = new StringDecoder("utf8");
    let buffer = "";
    let sessionCounter = 1;
    let permissionCounter = 0;

    function buildSessionFile(sessionId) {
      return path.join(os.tmpdir(), "openerx-pimono-" + namespace + "-" + sessionId + ".json");
    }

    function cloneMessages(messages) {
      return JSON.parse(JSON.stringify(Array.isArray(messages) ? messages : []));
    }

    function createSessionRecord(sessionId, base) {
      return {
        sessionId,
        sessionFile: buildSessionFile(sessionId),
        sessionName: (base && base.sessionName) || "",
        selectedModel: (base && base.selectedModel) || { provider: "github-copilot", id: "gpt-5.4" },
        messages: cloneMessages(base && base.messages),
        isStreaming: false,
        pendingPrompt: null,
        pendingUi: null,
      };
    }

    function persistSession(session) {
      fs.writeFileSync(
        session.sessionFile,
        JSON.stringify({
          sessionId: session.sessionId,
          sessionName: session.sessionName,
          selectedModel: session.selectedModel,
          messages: session.messages,
        }),
        "utf8",
      );
    }

    function loadSession(sessionFile) {
      const raw = JSON.parse(fs.readFileSync(sessionFile, "utf8"));
      return {
        sessionId: raw.sessionId,
        sessionFile,
        sessionName: raw.sessionName || "",
        selectedModel: raw.selectedModel || { provider: "github-copilot", id: "gpt-5.4" },
        messages: Array.isArray(raw.messages) ? raw.messages : [],
        isStreaming: false,
        pendingPrompt: null,
        pendingUi: null,
      };
    }

    function nextSessionId() {
      sessionCounter += 1;
      return "rpc-session-" + sessionCounter;
    }

    const initialSessionFile = buildSessionFile("rpc-session-1");
    let currentSession = fs.existsSync(initialSessionFile)
      ? loadSession(initialSessionFile)
      : createSessionRecord("rpc-session-1");
    persistSession(currentSession);

    function write(value) {
      process.stdout.write(JSON.stringify(value) + "\n");
    }

    function assistantUsage() {
      return {
        input: 11,
        output: 7,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 18,
        cost: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          total: 0,
        },
      };
    }

    function buildAssistantMessage(text) {
      return {
        role: "assistant",
        content: [{ type: "text", text }],
        api: "openai-responses",
        provider: currentSession.selectedModel.provider,
        model: currentSession.selectedModel.id,
        usage: assistantUsage(),
        stopReason: "stop",
        responseId: "resp-" + Date.now(),
        timestamp: Date.now(),
      };
    }

    function currentState() {
      return {
        model: currentSession.selectedModel,
        thinkingLevel: "medium",
        isStreaming: currentSession.isStreaming,
        isCompacting: false,
        steeringMode: "all",
        followUpMode: "one-at-a-time",
        sessionFile: currentSession.sessionFile,
        sessionId: currentSession.sessionId,
        sessionName: currentSession.sessionName,
        autoCompactionEnabled: true,
        messageCount: currentSession.messages.length,
        pendingMessageCount: 0,
      };
    }

    function writeAssistantTurn(text, options) {
      const assistant = Object.assign(
        buildAssistantMessage(text),
        (options && options.overrides) || {},
      );
      const startAssistant =
        options && options.clearResponseIdAtStart
          ? Object.assign({}, assistant, { responseId: undefined })
          : assistant;

      write({ type: "message_start", message: startAssistant });
      if (text) {
        write({
          type: "message_update",
          message: startAssistant,
          assistantMessageEvent: {
            type: "text_delta",
            contentIndex: 0,
            delta: text,
            partial: startAssistant,
          },
        });
      }
      currentSession.messages.push(assistant);
      persistSession(currentSession);
      write({ type: "message_end", message: assistant });
      write({ type: "agent_end", messages: [assistant] });
      currentSession.isStreaming = false;
      currentSession.pendingPrompt = null;
      currentSession.pendingUi = null;
    }

    function startPromptTurn(commandType, message) {
      write({ type: "agent_start" });

      const userMessage = { role: "user", content: message, timestamp: Date.now() };
      currentSession.messages.push(userMessage);
      persistSession(currentSession);
      write({ type: "message_end", message: userMessage });

      if (message.includes("__hold__")) {
        currentSession.isStreaming = true;
        currentSession.pendingPrompt = { commandType, message, mode: "hold" };
        persistSession(currentSession);
        write({ id: "req-placeholder", type: "noop" });
      }
    }

    function handlePromptLike(command) {
      write({ type: "agent_start" });

      const userMessage = { role: "user", content: command.message, timestamp: Date.now() };
      currentSession.messages.push(userMessage);
      persistSession(currentSession);
      write({ type: "message_end", message: userMessage });

      if (command.message.includes("__hold__")) {
        currentSession.isStreaming = true;
        currentSession.pendingPrompt = { commandType: command.type, message: command.message, mode: "hold" };
        persistSession(currentSession);
        write({ id: command.id, type: "response", command: command.type, success: true });
        return;
      }

      if (command.message.includes("__permission_confirm__")) {
        currentSession.isStreaming = true;
        currentSession.pendingPrompt = { commandType: command.type, message: command.message, mode: "permission" };
        currentSession.pendingUi = {
          id: "perm-" + (++permissionCounter),
          method: "confirm",
          title: "Allow external action?",
          message: "Need confirmation to continue.",
        };
        persistSession(currentSession);
        write({ id: command.id, type: "response", command: command.type, success: true });
        write({
          type: "extension_ui_request",
          id: currentSession.pendingUi.id,
          method: currentSession.pendingUi.method,
          title: currentSession.pendingUi.title,
          message: currentSession.pendingUi.message,
        });
        return;
      }

      if (command.message.includes("__structured_external_permission__")) {
        currentSession.isStreaming = true;
        currentSession.pendingPrompt = { commandType: command.type, message: command.message, mode: "permission" };
        currentSession.pendingUi = {
          id: "perm-" + (++permissionCounter),
          method: "confirm",
          title: "external_directory",
          message: "openerx-permission:{\"permission\":\"external_directory\",\"filepath\":\"/tmp/structured-demo.txt\",\"parentDir\":\"/tmp\",\"patterns\":[\"/tmp/*\"],\"toolName\":\"read\",\"toolCallId\":\"tool-structured-1\"}",
        };
        persistSession(currentSession);
        write({ id: command.id, type: "response", command: command.type, success: true });
        write({
          type: "extension_ui_request",
          id: currentSession.pendingUi.id,
          method: currentSession.pendingUi.method,
          title: currentSession.pendingUi.title,
          message: currentSession.pendingUi.message,
        });
        return;
      }

      if (command.message.includes("__crash__")) {
        currentSession.isStreaming = true;
        currentSession.pendingPrompt = { commandType: command.type, message: command.message, mode: "crash" };
        persistSession(currentSession);
        write({ id: command.id, type: "response", command: command.type, success: true });
        setTimeout(() => process.exit(91), 25);
        return;
      }

      write({ id: command.id, type: "response", command: command.type, success: true });
      write({
        type: "tool_execution_start",
        toolCallId: "tool-1",
        toolName: "bash",
        args: { command: "echo hi" },
      });
      write({
        type: "tool_execution_end",
        toolCallId: "tool-1",
        toolName: "bash",
        args: { command: "echo hi" },
        result: "ok",
        isError: false,
      });
      writeAssistantTurn("reply:" + command.message, {
        clearResponseIdAtStart: command.message.includes("__late_response_id__"),
      });
    }

    function handleCommand(command) {
      switch (command.type) {
        case "get_state": {
          write({ id: command.id, type: "response", command: "get_state", success: true, data: currentState() });
          return;
        }
        case "set_model": {
          currentSession.selectedModel = { provider: command.provider, id: command.modelId };
          persistSession(currentSession);
          write({ id: command.id, type: "response", command: "set_model", success: true, data: currentSession.selectedModel });
          return;
        }
        case "set_session_name": {
          currentSession.sessionName = command.name;
          persistSession(currentSession);
          write({ id: command.id, type: "response", command: "set_session_name", success: true });
          return;
        }
        case "follow_up":
        case "prompt":
        case "steer": {
          handlePromptLike(command);
          return;
        }
        case "get_messages": {
          write({ id: command.id, type: "response", command: "get_messages", success: true, data: { messages: currentSession.messages } });
          return;
        }
        case "get_fork_messages": {
          const forkMessages = currentSession.messages
            .map((message, index) => {
              const text = Array.isArray(message.content)
                ? message.content
                    .filter((part) => part && part.type === "text")
                    .map((part) => part.text)
                    .join("\n\n")
                : typeof message.content === "string"
                  ? message.content
                  : "";
              return { entryId: "entry-" + index, text };
            })
            .filter((message) => message.text);
          write({ id: command.id, type: "response", command: "get_fork_messages", success: true, data: { messages: forkMessages } });
          return;
        }
        case "get_last_assistant_text": {
          const assistantMessages = currentSession.messages.filter((message) => message.role === "assistant");
          const lastAssistant = assistantMessages[assistantMessages.length - 1] || null;
          const text = Array.isArray(lastAssistant?.content)
            ? lastAssistant.content.filter((part) => part.type === "text").map((part) => part.text).join("\n\n")
            : null;
          write({ id: command.id, type: "response", command: "get_last_assistant_text", success: true, data: { text } });
          return;
        }
        case "new_session": {
          const parent = command.parentSession && fs.existsSync(command.parentSession)
            ? loadSession(command.parentSession)
            : null;
          currentSession = createSessionRecord(nextSessionId(), parent);
          persistSession(currentSession);
          write({ id: command.id, type: "response", command: "new_session", success: true, data: { cancelled: false } });
          return;
        }
        case "switch_session": {
          if (!fs.existsSync(command.sessionPath)) {
            write({ id: command.id, type: "response", command: "switch_session", success: false, error: "session file not found" });
            return;
          }
          currentSession = loadSession(command.sessionPath);
          write({ id: command.id, type: "response", command: "switch_session", success: true, data: { cancelled: false } });
          return;
        }
        case "fork": {
          write({ id: command.id, type: "response", command: "fork", success: true, data: { text: "forked", cancelled: false } });
          return;
        }
        case "abort": {
          write({ id: command.id, type: "response", command: "abort", success: true });
          if (!currentSession.isStreaming) {
            return;
          }

          const pendingMessage = String(currentSession.pendingPrompt?.message || "");

          if (pendingMessage.includes("__stuck_abort__")) {
            currentSession.isStreaming = false;
            currentSession.pendingPrompt = null;
            currentSession.pendingUi = null;
            persistSession(currentSession);
            return;
          }

          if (pendingMessage.includes("__slow_abort__")) {
            currentSession.isStreaming = false;
            currentSession.pendingPrompt = null;
            currentSession.pendingUi = null;
            persistSession(currentSession);

            setTimeout(() => {
              const aborted = buildAssistantMessage("aborted");
              aborted.stopReason = "aborted";
              aborted.errorMessage = "request aborted";
              currentSession.messages.push(aborted);
              persistSession(currentSession);
              write({ type: "message_end", message: aborted });
              write({ type: "agent_end", messages: [aborted] });
            }, 150);
            return;
          }

          currentSession.isStreaming = false;
          const aborted = buildAssistantMessage("aborted");
          aborted.stopReason = "aborted";
          aborted.errorMessage = "request aborted";
          currentSession.messages.push(aborted);
          persistSession(currentSession);
          write({ type: "message_end", message: aborted });
          write({ type: "agent_end", messages: [aborted] });
          currentSession.pendingPrompt = null;
          currentSession.pendingUi = null;
          return;
        }
        case "extension_ui_response": {
          if (!currentSession.pendingUi || currentSession.pendingUi.id !== command.id) {
            return;
          }
          const pendingUi = currentSession.pendingUi;
          currentSession.pendingUi = null;
          currentSession.isStreaming = false;

          if (command.cancelled === true || command.confirmed === false) {
            writeAssistantTurn("permission:rejected");
            return;
          }

          if (pendingUi.method === "confirm") {
            writeAssistantTurn("permission:approved");
            return;
          }

          writeAssistantTurn("permission:" + String(command.value || "approved"));
          return;
        }
        default: {
          write({ id: command.id, type: "response", command: command.type, success: false, error: "unsupported" });
        }
      }
    }

    process.stdin.on("data", (chunk) => {
      buffer += typeof chunk === "string" ? chunk : decoder.write(chunk);
      while (true) {
        const newlineIndex = buffer.indexOf("\n");
        if (newlineIndex < 0) {
          return;
        }
        const line = buffer.slice(0, newlineIndex).replace(/\r$/, "");
        buffer = buffer.slice(newlineIndex + 1);
        if (!line.trim()) {
          continue;
        }
        handleCommand(JSON.parse(line));
      }
    });

    process.stdin.on("end", () => {
      const rest = decoder.end();
      if (rest.trim()) {
        handleCommand(JSON.parse(rest.trim()));
      }
    });
  `;
}

function configurePiMonoRpcEnv(options?: { pauseSettlementTimeoutMs?: number }) {
  process.env.PI_MONO_RPC_COMMAND = process.execPath;
  process.env.PI_MONO_RPC_ARGS = JSON.stringify([
    "-e",
    buildFakePiMonoRpcServerScript(),
    `ns-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  ]);
  process.env.PI_MONO_RPC_CWD = undefined;

  if (options?.pauseSettlementTimeoutMs !== undefined) {
    process.env.PI_MONO_PAUSE_SETTLEMENT_TIMEOUT_MS = String(options.pauseSettlementTimeoutMs);
  } else {
    process.env.PI_MONO_PAUSE_SETTLEMENT_TIMEOUT_MS = undefined;
  }
}

async function shutdownPiMonoProvider() {
  const module = await import(runtimeProviderPiMonoModulePath);
  await module.__shutdownPiMonoRuntimeForTests();
}

async function waitForMockCalls(target: number) {
  const startedAt = Date.now();
  while (ingestParsedEventMock.mock.calls.length < target) {
    if (Date.now() - startedAt > 2_000) {
      throw new Error(
        `Timed out waiting for realtime bridge calls: got ${ingestParsedEventMock.mock.calls.length}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

async function waitForCondition(predicate: () => Promise<boolean> | boolean, timeoutMs = 3_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
  throw new Error("Timed out waiting for condition");
}

function extractAssistantTexts(messages: unknown) {
  if (!Array.isArray(messages)) {
    return [];
  }

  return messages
    .filter((message) => {
      const info =
        message && typeof message === "object"
          ? ((message as Record<string, unknown>).info as Record<string, unknown> | undefined)
          : undefined;
      return info?.role === "assistant";
    })
    .map((message) => {
      const parts =
        message && typeof message === "object"
          ? ((message as Record<string, unknown>).parts as
              | Array<Record<string, unknown>>
              | undefined)
          : undefined;
      return Array.isArray(parts)
        ? parts
            .filter((part) => part?.type === "text" && typeof part.text === "string")
            .map((part) => String(part.text))
            .join("\n\n")
        : "";
    })
    .filter(Boolean);
}

async function waitForAssistantText(sessionId: string, matcher: (texts: string[]) => boolean) {
  const { piMonoRuntimeProvider } = await import(runtimeProviderPiMonoModulePath);
  let lastTexts: string[] = [];

  await waitForCondition(async () => {
    const messages = await piMonoRuntimeProvider.getSessionMessages(sessionId);
    if (!messages.ok) {
      return false;
    }
    lastTexts = extractAssistantTexts(messages.data);
    return matcher(lastTexts);
  }, 4_000);

  return lastTexts;
}

async function waitForPermissionCount(expectedCount: number) {
  const { piMonoRuntimeProvider } = await import(runtimeProviderPiMonoModulePath);
  await waitForCondition(async () => {
    const permissions = await piMonoRuntimeProvider.listRuntimePermissions();
    return (
      permissions.ok && Array.isArray(permissions.data) && permissions.data.length === expectedCount
    );
  }, 4_000);
}

beforeEach(() => {
  ensureAgentRunForSessionMock.mockClear();
  ingestParsedEventMock.mockClear();
  updateAgentRunStatusMock.mockClear();
  process.env.PI_MONO_PAUSE_SETTLEMENT_TIMEOUT_MS = undefined;
});

afterEach(async () => {
  await shutdownPiMonoProvider();
  process.env.PI_MONO_RPC_COMMAND = undefined;
  process.env.PI_MONO_RPC_ARGS = undefined;
  process.env.PI_MONO_RPC_CWD = undefined;
  process.env.PI_MONO_PAUSE_SETTLEMENT_TIMEOUT_MS = undefined;
});

describe("pi-mono runtime provider", () => {
  test("default Bun launcher targets the pi-mono workspace root", async () => {
    process.env.PI_MONO_RPC_COMMAND = undefined;
    process.env.PI_MONO_RPC_ARGS = undefined;
    process.env.PI_MONO_RPC_CWD = undefined;

    const module = await import(runtimeProviderPiMonoModulePath);
    const config = module.__readPiMonoRpcConfigForTests();

    expect(config.command).toBe("bun");
    expect(config.cwd.replace(/\\/g, "/")).toEndWith("/pi-mono");
    expect(config.args.slice(0, 5)).toEqual([
      "run",
      "--bun",
      "packages/coding-agent/src/cli.ts",
      "--mode",
      "rpc",
    ]);
  });

  test("default Bun launcher keeps args aligned when cwd is overridden", async () => {
    process.env.PI_MONO_RPC_COMMAND = undefined;
    process.env.PI_MONO_RPC_ARGS = undefined;
    process.env.PI_MONO_RPC_CWD = "/Users/wanglei/Downloads/phones-cloud/openerx/pi-mono/packages/coding-agent";

    const module = await import(runtimeProviderPiMonoModulePath);
    const config = module.__readPiMonoRpcConfigForTests();

    expect(config.command).toBe("bun");
    expect(config.cwd.replace(/\\/g, "/")).toEndWith("/pi-mono/packages/coding-agent");
    expect(config.args.slice(0, 5)).toEqual(["run", "--bun", "src/cli.ts", "--mode", "rpc"]);
  });

  test("createSession starts an RPC process and exposes normalized session messages", async () => {
    configurePiMonoRpcEnv();

    const { piMonoRuntimeProvider } = await import(runtimeProviderPiMonoModulePath);
    const result = await piMonoRuntimeProvider.createSession("task-1", "proj-1", "hello world", {
      model: { providerId: "github-copilot", modelId: "gpt-5.4" },
    });

    expect(result.ok).toBe(true);
    expect(result.sessionId).toBe("rpc-session-1");
    expect(result.agentRunId).toBe("rpc-session-1");
    expect(ensureAgentRunForSessionMock).toHaveBeenCalledWith(
      "rpc-session-1",
      "task-1",
      "proj-1",
      { providerId: "github-copilot", modelId: "gpt-5.4" },
      "rpc-session-1",
    );

    await waitForMockCalls(10);

    const emittedTypes = ingestParsedEventMock.mock.calls.map((call) => call[0]);
    expect(emittedTypes).toEqual(
      expect.arrayContaining([
        "session.created",
        "session.status",
        "message.updated",
        "message.part.updated",
        "tool.execute.before",
        "tool.execute.after",
        "session.updated",
        "session.idle",
      ]),
    );

    const assistantMessageEvent = ingestParsedEventMock.mock.calls.find(
      (call) =>
        call[0] === "message.updated" &&
        typeof call[1] === "object" &&
        call[1] &&
        typeof (call[1] as Record<string, unknown>).info === "object" &&
        ((call[1] as Record<string, unknown>).info as Record<string, unknown>).role === "assistant",
    );
    expect(assistantMessageEvent?.[1]).toEqual(
      expect.objectContaining({
        sessionId: "rpc-session-1",
        info: expect.objectContaining({
          role: "assistant",
          finish: "stop",
          sessionID: "rpc-session-1",
        }),
      }),
    );

    const assistantMessageId = (
      (assistantMessageEvent?.[1] as Record<string, unknown>)?.info as Record<string, unknown>
    )?.id;
    const assistantDeltaEvent = ingestParsedEventMock.mock.calls.find(
      (call) => call[0] === "message.part.updated",
    );
    expect(assistantDeltaEvent?.[1]).toEqual(
      expect.objectContaining({
        sessionId: "rpc-session-1",
        delta: "reply:hello world",
        part: expect.objectContaining({
          type: "text",
          messageID: assistantMessageId,
          text: "reply:hello world",
        }),
      }),
    );

    const sessions = await piMonoRuntimeProvider.listSessions();
    expect(sessions.ok).toBe(true);
    expect(Array.isArray(sessions.data)).toBe(true);
    expect(sessions.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "rpc-session-1",
          sessionID: "rpc-session-1",
          taskId: "task-1",
          projectId: "proj-1",
        }),
      ]),
    );

    const messages = await piMonoRuntimeProvider.getSessionMessages("rpc-session-1");
    expect(messages.ok).toBe(true);
    expect(messages.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          info: expect.objectContaining({ role: "user" }),
          parts: [expect.objectContaining({ type: "text", text: "hello world" })],
        }),
        expect.objectContaining({
          info: expect.objectContaining({ role: "assistant" }),
          parts: [expect.objectContaining({ type: "text", text: "reply:hello world" })],
        }),
      ]),
    );

    const terminateResult = await piMonoRuntimeProvider.terminateAgent("rpc-session-1");
    expect(terminateResult.ok).toBe(true);
  });

  test("keeps assistant message ids stable when responseId appears after stream start", async () => {
    configurePiMonoRpcEnv();

    const { piMonoRuntimeProvider } = await import(runtimeProviderPiMonoModulePath);
    const result = await piMonoRuntimeProvider.createSession(
      "task-1",
      "proj-1",
      "hello __late_response_id__",
      {
        model: { providerId: "github-copilot", modelId: "gpt-5.4" },
      },
    );

    expect(result.ok).toBe(true);

    await waitForMockCalls(10);

    const assistantUpdateIds = ingestParsedEventMock.mock.calls
      .filter(
        (call) =>
          call[0] === "message.updated" &&
          typeof call[1] === "object" &&
          call[1] &&
          typeof (call[1] as Record<string, unknown>).info === "object" &&
          ((call[1] as Record<string, unknown>).info as Record<string, unknown>).role ===
            "assistant",
      )
      .map((call) => {
        const payload = call[1] as Record<string, unknown>;
        const info = payload.info as Record<string, unknown> | undefined;
        return typeof info?.id === "string" ? info.id : "";
      })
      .filter((value) => value.length > 0);

    expect(assistantUpdateIds.length).toBeGreaterThanOrEqual(2);
    expect(new Set(assistantUpdateIds).size).toBe(1);

    const assistantMessageId = assistantUpdateIds[0];
    const assistantDeltaEvent = ingestParsedEventMock.mock.calls.find(
      (call) => call[0] === "message.part.updated",
    );
    expect(assistantDeltaEvent?.[1]).toEqual(
      expect.objectContaining({
        sessionId: "rpc-session-1",
        part: expect.objectContaining({
          type: "text",
          messageID: assistantMessageId,
        }),
      }),
    );

    const messages = await piMonoRuntimeProvider.getSessionMessages("rpc-session-1");
    expect(messages.ok).toBe(true);

    const assistantMessages = Array.isArray(messages.data)
      ? messages.data.filter((message) => {
          const record = message as Record<string, unknown>;
          const info = record.info as Record<string, unknown> | undefined;
          return info?.role === "assistant";
        })
      : [];

    expect(assistantMessages).toHaveLength(1);
    expect(assistantMessages[0]).toEqual(
      expect.objectContaining({
        info: expect.objectContaining({
          id: assistantMessageId,
          role: "assistant",
        }),
      }),
    );
  });

  test("runDetachedPrompt waits for idle and returns the assistant text", async () => {
    configurePiMonoRpcEnv();

    const { piMonoRuntimeProvider } = await import(runtimeProviderPiMonoModulePath);
    const result = await piMonoRuntimeProvider.runDetachedPrompt("detached title", "explain this", {
      timeoutMs: 2_000,
      model: { providerId: "github-copilot", modelId: "gpt-5.4" },
    });

    expect(result.ok).toBe(true);
    expect(result.sessionId).toBe("rpc-session-1");
    expect(result.text).toBe("reply:explain this");
    expect(result.completed).toBe(true);
    expect(result.tokenUsed).toBe(18);
    expect(result.model).toEqual({ providerId: "github-copilot", modelId: "gpt-5.4" });

    const sessions = await piMonoRuntimeProvider.listSessions();
    expect(sessions.ok).toBe(true);
    expect(sessions.data).toEqual([]);
  });

  test("pauseAgent queues guidance and resumeAgent continues on the recovered session", async () => {
    configurePiMonoRpcEnv();

    const { piMonoRuntimeProvider } = await import(runtimeProviderPiMonoModulePath);
    const created = await piMonoRuntimeProvider.createSession(
      "task-pause",
      "proj-1",
      "__hold__ initial run",
      {
        model: { providerId: "github-copilot", modelId: "gpt-5.4" },
      },
    );

    expect(created.ok).toBe(true);
    expect(created.agentRunId).toBe("rpc-session-1");

    const pauseResult = await piMonoRuntimeProvider.pauseAgent(String(created.agentRunId));
    expect(pauseResult.ok).toBe(true);

    const guidanceResult = await piMonoRuntimeProvider.injectGuidance(
      String(created.agentRunId),
      "Only return the short resumed answer.",
      "noReply",
    );
    expect(guidanceResult.ok).toBe(true);

    const resumeResult = await piMonoRuntimeProvider.resumeAgent(String(created.agentRunId));
    expect(resumeResult.ok).toBe(true);

    const assistantTexts = await waitForAssistantText(String(created.sessionId), (texts) =>
      texts.some((text) => text.includes("Only return the short resumed answer.")),
    );
    expect(assistantTexts.some((text) => text.includes("Resume execution."))).toBe(true);
    expect(
      assistantTexts.some((text) => text.includes("Only return the short resumed answer.")),
    ).toBe(true);

    const emittedTypes = ingestParsedEventMock.mock.calls.map((call) => call[0]);
    expect(emittedTypes).not.toContain("session.error");
  });

  test("continueSession waits for in-flight pause settlement before sending the next prompt", async () => {
    configurePiMonoRpcEnv({ pauseSettlementTimeoutMs: 1_000 });

    const { piMonoRuntimeProvider } = await import(runtimeProviderPiMonoModulePath);
    const created = await piMonoRuntimeProvider.createSession(
      "task-pause-race",
      "proj-1",
      "__hold__ __slow_abort__ initial run",
      {
        model: { providerId: "github-copilot", modelId: "gpt-5.4" },
      },
    );

    expect(created.ok).toBe(true);

    const pausePromise = piMonoRuntimeProvider.pauseAgent(String(created.agentRunId));
    await waitForCondition(
      () => updateAgentRunStatusMock.mock.calls.some((call) => call[1] === "paused"),
      1_000,
    );

    const startedAt = Date.now();
    const continuePromise = piMonoRuntimeProvider.continueSession(
      String(created.sessionId),
      "prompt after delayed pause",
    );

    const [pauseResult, continueResult] = await Promise.all([pausePromise, continuePromise]);
    const elapsedMs = Date.now() - startedAt;

    expect(pauseResult.ok).toBe(true);
    expect(continueResult.ok).toBe(true);
    expect(elapsedMs).toBeGreaterThanOrEqual(100);

    const assistantTexts = await waitForAssistantText(String(created.sessionId), (texts) =>
      texts.includes("reply:prompt after delayed pause"),
    );
    expect(assistantTexts).toContain("reply:prompt after delayed pause");
  });

  test("bridges extension UI requests into runtime permission requests and replies", async () => {
    configurePiMonoRpcEnv();

    const { piMonoRuntimeProvider } = await import(runtimeProviderPiMonoModulePath);
    const created = await piMonoRuntimeProvider.createSession(
      "task-permission",
      "proj-1",
      "__permission_confirm__",
    );

    expect(created.ok).toBe(true);

    await waitForPermissionCount(1);

    const permissions = await piMonoRuntimeProvider.listRuntimePermissions();
    expect(permissions.ok).toBe(true);
    expect(permissions.data).toEqual([
      expect.objectContaining({
        id: "perm-1",
        sessionID: "rpc-session-1",
        permission: "runtime_confirmation",
        metadata: expect.objectContaining({
          method: "confirm",
          source: "pi-mono-extension-ui",
          title: "Allow external action?",
        }),
      }),
    ]);

    const approvalStatusEvent = ingestParsedEventMock.mock.calls.find(
      (call) =>
        call[0] === "session.status" &&
        typeof call[1] === "object" &&
        call[1] &&
        typeof (call[1] as Record<string, unknown>).info === "object" &&
        ((call[1] as Record<string, unknown>).info as Record<string, unknown>).type ===
          "paused-approval",
    );
    expect(approvalStatusEvent).toBeTruthy();

    const replyResult = await piMonoRuntimeProvider.replyRuntimePermission("perm-1", {
      reply: "once",
    });
    expect(replyResult.ok).toBe(true);

    await waitForPermissionCount(0);
    const assistantTexts = await waitForAssistantText(String(created.sessionId), (texts) =>
      texts.includes("permission:approved"),
    );
    expect(assistantTexts).toContain("permission:approved");
  });

  test("maps structured external_directory approvals and auto-approves later requests after always", async () => {
    configurePiMonoRpcEnv();

    const { piMonoRuntimeProvider } = await import(runtimeProviderPiMonoModulePath);
    const created = await piMonoRuntimeProvider.createSession(
      "task-structured-permission",
      "proj-1",
      "__structured_external_permission__",
    );

    expect(created.ok).toBe(true);

    await waitForPermissionCount(1);

    const permissions = await piMonoRuntimeProvider.listRuntimePermissions();
    expect(permissions.ok).toBe(true);
    expect(permissions.data).toEqual([
      expect.objectContaining({
        id: "perm-1",
        sessionID: "rpc-session-1",
        permission: "external_directory",
        patterns: ["/tmp/*"],
        metadata: expect.objectContaining({
          filepath: "/tmp/structured-demo.txt",
          parentDir: "/tmp",
          toolName: "read",
          toolCallId: "tool-structured-1",
        }),
      }),
    ]);

    const replyResult = await piMonoRuntimeProvider.replyRuntimePermission("perm-1", {
      reply: "always",
    });
    expect(replyResult.ok).toBe(true);

    await waitForPermissionCount(0);
    const firstAssistantTexts = await waitForAssistantText(String(created.sessionId), (texts) =>
      texts.includes("permission:approved"),
    );
    expect(firstAssistantTexts).toContain("permission:approved");

    const continueResult = await piMonoRuntimeProvider.continueSession(
      String(created.sessionId),
      "__structured_external_permission__ repeat",
    );
    expect(continueResult.ok).toBe(true);

    const secondAssistantTexts = await waitForAssistantText(String(created.sessionId), (texts) => {
      const approvedCount = texts.filter((text) => text === "permission:approved").length;
      return approvedCount >= 2;
    });
    expect(secondAssistantTexts.filter((text) => text === "permission:approved").length).toBe(
      2,
    );

    const secondPermissions = await piMonoRuntimeProvider.listRuntimePermissions();
    expect(secondPermissions.ok).toBe(true);
    expect(secondPermissions.data).toEqual([]);
  });

  test("pauseAgent fails when abort never settles within the configured timeout", async () => {
    configurePiMonoRpcEnv({ pauseSettlementTimeoutMs: 60 });

    const { piMonoRuntimeProvider } = await import(runtimeProviderPiMonoModulePath);
    const created = await piMonoRuntimeProvider.createSession(
      "task-stuck-abort",
      "proj-1",
      "__hold__ __stuck_abort__ initial run",
    );

    expect(created.ok).toBe(true);

    const pauseResult = await piMonoRuntimeProvider.pauseAgent(String(created.agentRunId));

    expect(pauseResult.ok).toBe(false);
    expect(pauseResult.error).toContain("pi-mono pause did not settle");
  });

  test("recovers a crashed pi-mono child process by reloading the session file before resume", async () => {
    configurePiMonoRpcEnv();

    const { piMonoRuntimeProvider } = await import(runtimeProviderPiMonoModulePath);
    const created = await piMonoRuntimeProvider.createSession(
      "task-crash",
      "proj-1",
      "hello world",
    );

    expect(created.ok).toBe(true);

    const initialAssistantTexts = await waitForAssistantText(String(created.sessionId), (texts) =>
      texts.includes("reply:hello world"),
    );
    expect(initialAssistantTexts).toContain("reply:hello world");

    const continueResult = await piMonoRuntimeProvider.continueSession(
      String(created.sessionId),
      "__crash__",
    );
    expect(continueResult.ok).toBe(true);

    await waitForCondition(async () => {
      const sessions = await piMonoRuntimeProvider.listSessions();
      if (!sessions.ok || !Array.isArray(sessions.data)) {
        return false;
      }
      return sessions.data.some(
        (session) =>
          session &&
          typeof session === "object" &&
          (session as Record<string, unknown>).id === "rpc-session-1" &&
          (session as Record<string, unknown>).status === "paused",
      );
    }, 4_000);

    const recoveredMessages = await piMonoRuntimeProvider.getSessionMessages(
      String(created.sessionId),
    );
    expect(recoveredMessages.ok).toBe(true);
    expect(extractAssistantTexts(recoveredMessages.data)).toContain("reply:hello world");

    const resumeResult = await piMonoRuntimeProvider.resumeAgent(String(created.agentRunId));
    expect(resumeResult.ok).toBe(true);

    const assistantTexts = await waitForAssistantText(String(created.sessionId), (texts) =>
      texts.some((text) => text.includes("Resume execution.")),
    );
    expect(assistantTexts.some((text) => text.includes("Resume execution."))).toBe(true);
  });
});
