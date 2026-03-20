/// <reference types="bun-types" />

import { afterEach, describe, expect, mock, test } from "bun:test";

mock.restore();

let adapterImportCounter = 0;

async function loadOpencodeAdapter() {
  adapterImportCounter += 1;
  return import(
    `../../control-plane/web-ui-bff/src/modules/agent-control/opencode-adapter?opencode-adapter-test=${adapterImportCounter}`
  );
}

afterEach(() => {
  mock.restore();
});

describe("extractAssistantResultFromMessages", () => {
  test("marks assistant messages with embedded errors as failed", async () => {
    const { extractAssistantResultFromMessages } = await loadOpencodeAdapter();
    const result = extractAssistantResultFromMessages([
      {
        info: {
          role: "assistant",
          error: {
            name: "MessageAbortedError",
            data: {
              message: "The operation was aborted.",
            },
          },
          time: {
            created: 1773406563485,
            completed: 1773406563502,
          },
          tokens: {
            input: 10,
            output: 0,
            reasoning: 0,
          },
        },
        parts: [],
      },
    ]);

    expect(result.completed).toBe(false);
    expect(result.failed).toBe(true);
    expect(result.error).toBe("The operation was aborted.");
    expect(result.tokenUsed).toBe(10);
  });

  test("still reports completed assistant messages with text as completed", async () => {
    const { extractAssistantResultFromMessages } = await loadOpencodeAdapter();
    const result = extractAssistantResultFromMessages([
      {
        info: {
          role: "assistant",
          time: {
            created: 1773406563485,
            completed: 1773406563502,
          },
        },
        parts: [
          {
            type: "text",
            text: "done",
          },
        ],
      },
    ]);

    expect(result.completed).toBe(true);
    expect(result.failed).toBe(false);
    expect(result.text).toBe("done");
  });
});

describe("opencode adapter resilience", () => {
  test("normalizes direct provider model ids before sending prompt_async", async () => {
    const fetchMock = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/session") && init?.method === "POST") {
        return new Response(JSON.stringify({ id: "session-1" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url.endsWith("/session/session-1/prompt_async") && init?.method === "POST") {
        return new Response(null, { status: 204 });
      }
      if (url.endsWith("/session/session-1/message?limit=200") && init?.method === "GET") {
        return new Response(JSON.stringify([{ info: { role: "user" }, parts: [] }]), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      return new Response("not found", { status: 404 });
    });
    globalThis.fetch = fetchMock as typeof fetch;

    const { createSession } = await loadOpencodeAdapter();
    const result = await createSession("task-1", "proj-1", "hello", {
      model: {
        providerId: "anthropic",
        modelId: "anthropic/claude-sonnet-4-20250514",
      },
    });

    expect(result.ok).toBe(true);
    const promptCall = fetchMock.mock.calls[1];
    const body = JSON.parse(String(promptCall?.[1]?.body)) as {
      model?: { providerID?: string; modelID?: string };
    };
    expect(body.model).toEqual({
      providerID: "anthropic",
      modelID: "claude-sonnet-4-20250514",
    });
  });

  test("does not forward the platform placeholder execution agent to runtime", async () => {
    const fetchMock = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/session") && init?.method === "POST") {
        return new Response(JSON.stringify({ id: "session-1" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url.endsWith("/session/session-1/prompt_async") && init?.method === "POST") {
        return new Response(null, { status: 204 });
      }
      if (url.endsWith("/session/session-1/message?limit=200") && init?.method === "GET") {
        return new Response(JSON.stringify([{ info: { role: "user" }, parts: [] }]), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      return new Response("not found", { status: 404 });
    });
    globalThis.fetch = fetchMock as typeof fetch;

    const { createSession } = await loadOpencodeAdapter();
    const result = await createSession("task-1", "proj-1", "hello");

    expect(result.ok).toBe(true);
    const promptCall = fetchMock.mock.calls[1];
    const body = JSON.parse(String(promptCall?.[1]?.body)) as {
      agent?: string;
    };
    expect(body.agent).toBeUndefined();
  });

  test("retries createSession prompt when runtime accepts but does not persist messages", async () => {
    let promptAttempts = 0;
    const fetchMock = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/session") && init?.method === "POST") {
        return new Response(JSON.stringify({ id: "session-1" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url.endsWith("/session/session-1/prompt_async") && init?.method === "POST") {
        promptAttempts += 1;
        return new Response(null, { status: 204 });
      }
      if (url.endsWith("/session/session-1/message?limit=200") && init?.method === "GET") {
        if (promptAttempts < 2) {
          return new Response(JSON.stringify([]), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }

        return new Response(JSON.stringify([{ info: { role: "user" }, parts: [] }]), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      return new Response("not found", { status: 404 });
    });
    globalThis.fetch = fetchMock as typeof fetch;

    const { createSession } = await loadOpencodeAdapter();
    const result = await createSession("task-1", "proj-1", "hello", {
      model: {
        providerId: "github-copilot",
        modelId: "gpt-4o",
      },
    });

    expect(result.ok).toBe(true);
    expect(promptAttempts).toBe(2);
  });

  test("retries continueSession prompt when message count does not advance", async () => {
    let promptAttempts = 0;
    const fetchMock = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/session/session-1/prompt_async") && init?.method === "POST") {
        promptAttempts += 1;
        return new Response(null, { status: 204 });
      }
      if (url.endsWith("/session/session-1/message?limit=200") && init?.method === "GET") {
        if (promptAttempts < 2) {
          return new Response(JSON.stringify([{ info: { role: "user" }, parts: [] }]), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }

        return new Response(
          JSON.stringify([
            { info: { role: "user" }, parts: [] },
            { info: { role: "user" }, parts: [] },
          ]),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        );
      }

      return new Response("not found", { status: 404 });
    });
    globalThis.fetch = fetchMock as typeof fetch;

    const { continueSession } = await loadOpencodeAdapter();
    const result = await continueSession("session-1", "hello", {
      model: {
        providerId: "github-copilot",
        modelId: "gpt-4o",
      },
    });

    expect(result.ok).toBe(true);
    expect(promptAttempts).toBe(2);
  });

  test("keeps session-read circuit breaker scoped away from write operations", async () => {
    const fetchMock = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/session?limit=20")) {
        throw new Error("runtime unavailable");
      }
      if (url.includes("/session/source-session/fork") && init?.method === "POST") {
        return new Response(JSON.stringify({ id: "forked-session" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      return new Response("not found", { status: 404 });
    });
    globalThis.fetch = fetchMock as typeof fetch;

    const { forkSession, listSessions } = await loadOpencodeAdapter();

    const first = await listSessions();
    const second = await listSessions();
    const write = await forkSession("source-session");

    expect(first.ok).toBe(false);
    expect(second.ok).toBe(false);
    expect(write.ok).toBe(true);
    expect(write.sessionId).toBe("forked-session");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  test("fast-fails repeated session reads after the threshold is reached", async () => {
    const fetchMock = mock(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/session?limit=20")) {
        throw new Error("runtime unavailable");
      }

      return new Response("not found", { status: 404 });
    });
    globalThis.fetch = fetchMock as typeof fetch;

    const { listSessions } = await loadOpencodeAdapter();

    await listSessions();
    await listSessions();
    const third = await listSessions();

    expect(third.ok).toBe(false);
    expect(third.error).toContain("circuit breaker open");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test("still confirms prompt persistence after the shared session-read circuit is open", async () => {
    let listReadAttempts = 0;
    const fetchMock = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/session?limit=20")) {
        listReadAttempts += 1;
        throw new Error("runtime unavailable");
      }
      if (url.endsWith("/session") && init?.method === "POST") {
        return new Response(JSON.stringify({ id: "session-1" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url.endsWith("/session/session-1/prompt_async") && init?.method === "POST") {
        return new Response(null, { status: 204 });
      }
      if (url.endsWith("/session/session-1/message?limit=200") && init?.method === "GET") {
        return new Response(JSON.stringify([{ info: { role: "user" }, parts: [] }]), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      return new Response("not found", { status: 404 });
    });
    globalThis.fetch = fetchMock as typeof fetch;

    const { createSession, listSessions } = await loadOpencodeAdapter();

    await listSessions();
    await listSessions();
    const breakerState = await listSessions();
    const result = await createSession("task-1", "proj-1", "hello");

    expect(listReadAttempts).toBe(2);
    expect(breakerState.ok).toBe(false);
    expect(breakerState.error).toContain("circuit breaker open");
    expect(result.ok).toBe(true);
  });

  test("clears opcall timeout timers after fetch failures", async () => {
    const originalSetTimeout = globalThis.setTimeout;
    const originalClearTimeout = globalThis.clearTimeout;
    const timerToken = { kind: "timer" } as unknown as ReturnType<typeof setTimeout>;
    const setTimeoutMock = mock(() => timerToken);
    const clearTimeoutMock = mock(() => {});
    const fetchMock = mock(async () => {
      throw new Error("network down");
    });

    globalThis.setTimeout = setTimeoutMock as typeof setTimeout;
    globalThis.clearTimeout = clearTimeoutMock as typeof clearTimeout;
    globalThis.fetch = fetchMock as typeof fetch;

    try {
      const { forkSession } = await loadOpencodeAdapter();
      const result = await forkSession("source-session");

      expect(result.ok).toBe(false);
      expect(clearTimeoutMock).toHaveBeenCalledWith(timerToken);
    } finally {
      globalThis.setTimeout = originalSetTimeout;
      globalThis.clearTimeout = originalClearTimeout;
    }
  });
});
