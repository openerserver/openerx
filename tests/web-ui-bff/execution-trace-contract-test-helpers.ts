import { expect } from "bun:test";

export function expectNoLegacyTimelineReadSource(payload: {
  timelineMeta?: { readSource?: string | null } | null;
}) {
  expect(payload.timelineMeta?.readSource).not.toBe("legacy-project-tree-events");
  expect(payload.timelineMeta?.readSource).not.toBe("conversation-table+legacy-fallback");
}

export function expectNoPromptBackfillSegment(
  payload: { segments?: Array<{ type?: string; content?: string | null }> | null },
  promptText: string,
) {
  expect(
    payload.segments?.some(
      (segment) => segment.type === "user-input" && segment.content === promptText,
    ) ?? false,
  ).toBe(false);
}

export function expectServiceTimelineNotRequested(
  cpFetchMock: { mock: { calls: Array<[string, ...unknown[]]> } },
  taskId: string,
  sessionId: string,
  includeLineage = true,
) {
  const suffix = includeLineage ? "?includeLineage=true" : "";
  expect(
    cpFetchMock.mock.calls.some(
      ([path]) =>
        path === `/api/tasks/${taskId}/branches/${sessionId}/timeline${suffix}`,
    ),
  ).toBe(false);
}