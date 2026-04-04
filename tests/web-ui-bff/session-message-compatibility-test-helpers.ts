import { expect } from "bun:test";

export function expectNoPublicTraceRequests(requestPaths: string[]) {
  expect(requestPaths.some((path) => path.includes("/execution-trace"))).toBe(false);
  expect(requestPaths.some((path) => path.includes("/timeline-view"))).toBe(false);
}

export function expectLineageMessagesRequest(
  requestPaths: string[],
  taskId: string,
  sessionId: string,
  includeLineage = true,
) {
  const suffix = includeLineage ? "?includeLineage=true" : "";
  expect(requestPaths).toContain(`/api/tasks/${taskId}/sessions/${sessionId}/messages${suffix}`);
}

export function expectCanonicalSessionMessageRequests(
  requestPaths: string[],
  taskId: string,
  sessionIds: string[],
) {
  for (const sessionId of sessionIds) {
    expect(requestPaths).toContain(
      `/api/tasks/${taskId}/sessions/${encodeURIComponent(`task-session:${taskId}:${sessionId}`)}/messages`,
    );
  }
}

export function expectRuntimeMessageReads(
  runtimeFetchMock: { mock: { calls: Array<[RequestInfo | URL, RequestInit | undefined]> } },
  sessionIds: string[],
) {
  const requestedUrls = runtimeFetchMock.mock.calls.map(([input]) => String(input));
  for (const sessionId of sessionIds) {
    expect(
      requestedUrls.some((url) => url.endsWith(`/session/${sessionId}/message?limit=200`)),
    ).toBe(true);
  }
}

export function expectNoRuntimeMessageReads(
  runtimeFetchMock: { mock: { calls: Array<[RequestInfo | URL, RequestInit | undefined]> } },
) {
  expect(runtimeFetchMock.mock.calls).toHaveLength(0);
}

export function expectSessionMessageReaderCalls(
  getSessionMessagesMock: { mock: { calls: Array<unknown[]> } },
  sessionIds: string[],
) {
  const calledSessionIds = getSessionMessagesMock.mock.calls.map(([sessionId]) => sessionId);
  expect(calledSessionIds).toEqual(expect.arrayContaining(sessionIds));
}