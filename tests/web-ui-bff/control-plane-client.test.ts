/// <reference types="bun-types" />

import { expect, mock, test } from "bun:test";

let clientImportCounter = 0;

async function loadControlPlaneClient() {
  clientImportCounter += 1;
  return import(
    `../../control-plane/web-ui-bff/src/lib/control-plane-client?control-plane-client-test=${clientImportCounter}`
  );
}

test("cpFetch clears timeout timers after fetch failures", async () => {
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  const originalFetch = globalThis.fetch;
  const timerToken = { kind: "timer" } as unknown as ReturnType<typeof setTimeout>;
  const setTimeoutMock = mock(() => timerToken);
  const clearTimeoutMock = mock(() => {});
  const fetchMock = mock(async () => {
    throw new Error("control plane offline");
  });

  globalThis.setTimeout = setTimeoutMock as typeof setTimeout;
  globalThis.clearTimeout = clearTimeoutMock as typeof clearTimeout;
  globalThis.fetch = fetchMock as typeof fetch;

  try {
    const { cpFetch } = await loadControlPlaneClient();
    const result = await cpFetch("/api/tasks");

    expect(result.ok).toBe(false);
    expect(result.status).toBe(502);
    expect(clearTimeoutMock).toHaveBeenCalledWith(timerToken);
  } finally {
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
    globalThis.fetch = originalFetch;
    mock.restore();
  }
});