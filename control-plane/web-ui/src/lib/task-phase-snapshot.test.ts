import { describe, expect, it } from "vitest";

import { buildTaskPhaseSnapshotMessages } from "./task-phase-snapshot";

function createMessage(overrides: Record<string, unknown>) {
  return {
    id: "message-default",
    role: "assistant",
    createdAt: "2026-04-18T12:00:00.000Z",
    ...overrides,
  };
}

function createPhase(overrides: Record<string, unknown> = {}) {
  return {
    id: "phase-1",
    phaseKind: "single",
    ...overrides,
  } as any;
}

describe("buildTaskPhaseSnapshotMessages", () => {
  it("preserves mainline group message order instead of resorting by createdAt", () => {
    const messages = buildTaskPhaseSnapshotMessages({
      phases: [
        {
          phase: createPhase({ phaseKind: "single" }),
          messageGroups: [
            {
              phaseRole: "mainline",
              phaseItemIndex: 0,
              messages: [
                createMessage({
                  id: "user-prompt",
                  role: "user",
                  createdAt: "2026-04-18T12:00:05.000Z",
                  text: "用户问题",
                }),
                createMessage({
                  id: "assistant-reply",
                  role: "assistant",
                  createdAt: "2026-04-18T12:00:00.000Z",
                  text: "模型回复",
                }),
              ],
            },
          ],
        },
      ],
    });

    expect(messages.map((message) => (message as { id: string }).id)).toEqual([
      "user-prompt",
      "assistant-reply",
    ]);
  });

  it("selects the first candidate prompt by candidate order instead of earliest createdAt", () => {
    const messages = buildTaskPhaseSnapshotMessages({
      phases: [
        {
          phase: createPhase({ phaseKind: "parallel" }),
          messageGroups: [
            {
              phaseRole: "candidate",
              candidateIndex: 1,
              title: "候选 B",
              messages: [
                createMessage({
                  id: "candidate-b-user",
                  role: "user",
                  createdAt: "2026-04-18T12:00:00.000Z",
                  text: "候选 B prompt",
                }),
              ],
            },
            {
              phaseRole: "candidate",
              candidateIndex: 0,
              title: "候选 A",
              messages: [
                createMessage({
                  id: "candidate-a-user",
                  role: "user",
                  createdAt: "2026-04-18T12:00:03.000Z",
                  text: "候选 A prompt",
                }),
              ],
            },
          ],
        },
      ],
    });

    expect(messages.map((message) => (message as { id: string }).id)).toEqual([
      "candidate-a-user",
    ]);
  });
});