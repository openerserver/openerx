import { describe, expect, it } from "vitest";

import {
  buildConversationItemsWithParallelRuns,
  buildParallelConversationItems,
} from "../../control-plane/web-ui/src/lib/task-detail-parallel-conversation";

describe("task detail parallel conversation anchoring", () => {
  it("keeps a completed historical parallel card ahead of later single-turn replies from the adopted session", () => {
    const baseConversationItems = [
      {
        key: "user-parallel",
        role: "user",
        text: "先并行试一下",
        createdAt: "2026-03-22T10:00:00.000Z",
        toolCalls: [],
        raw: null,
      },
      {
        key: "assistant-adopted",
        role: "assistant",
        text: "这是采纳后的主线结果",
        createdAt: "2026-03-22T10:00:30.000Z",
        toolCalls: [],
        raw: null,
      },
      {
        key: "user-single",
        role: "user",
        text: "现在单次执行",
        createdAt: "2026-03-22T11:00:00.000Z",
        toolCalls: [],
        raw: null,
      },
      {
        key: "assistant-single",
        role: "assistant",
        text: "展示一下 main.c 文件",
        createdAt: "2026-03-22T11:00:30.000Z",
        toolCalls: [],
        raw: null,
      },
    ];

    const parallelConversationItems = buildParallelConversationItems({
      visibleParallelRuns: [
        {
          parallelRunId: "task-session:parallel-1",
          startedAt: "2026-03-22T10:00:10.000Z",
          finishedAt: "2026-03-22T10:00:20.000Z",
          winnerCandidateIndex: 0,
          candidateSessions: [
            {
              label: "候选 A",
              sessionId: "ses-a",
              status: "completed",
              startedAt: "2026-03-22T10:00:10.000Z",
              finishedAt: "2026-03-22T10:00:20.000Z",
            },
            {
              label: "候选 B",
              sessionId: "ses-b",
              status: "completed",
              startedAt: "2026-03-22T10:00:11.000Z",
              finishedAt: "2026-03-22T10:00:20.000Z",
            },
          ],
        },
      ],
      currentParallelRunId: "task-session:parallel-1",
      taskStatus: "completed",
      baseConversationItems,
      parallelCandidateItems: {
        "ses-a": [
          {
            key: "ses-a-user-old",
            role: "user",
            text: "先并行试一下",
            createdAt: "2026-03-22T10:00:10.500Z",
            toolCalls: [],
            raw: null,
            isStreaming: false,
          },
          {
            key: "ses-a-assistant-old",
            role: "assistant",
            text: "旧候选结果 A",
            createdAt: "2026-03-22T10:00:15.000Z",
            toolCalls: [],
            raw: null,
            isStreaming: false,
          },
          {
            key: "ses-a-user-new-single",
            role: "user",
            text: "现在单次执行",
            createdAt: "2026-03-22T11:00:00.000Z",
            toolCalls: [],
            raw: null,
            isStreaming: false,
          },
          {
            key: "ses-a-assistant-new-single",
            role: "assistant",
            text: "展示一下 main.c 文件",
            createdAt: "2026-03-22T11:00:30.000Z",
            toolCalls: [],
            raw: null,
            isStreaming: false,
          },
        ],
        "ses-b": [
          {
            key: "ses-b-user-old",
            role: "user",
            text: "先并行试一下",
            createdAt: "2026-03-22T10:00:11.000Z",
            toolCalls: [],
            raw: null,
            isStreaming: false,
          },
          {
            key: "ses-b-assistant-old",
            role: "assistant",
            text: "旧候选结果 B",
            createdAt: "2026-03-22T10:00:16.000Z",
            toolCalls: [],
            raw: null,
            isStreaming: false,
          },
        ],
      },
      parallelCandidateSettledReply: {
        "ses-a": true,
        "ses-b": true,
      },
      parallelCandidateTraceStates: {},
    });

    const conversationItems = buildConversationItemsWithParallelRuns({
      baseConversationItems,
      parallelConversationItems,
    });

    expect(
      conversationItems.map((item) => ({
        role: item.role,
        text:
          item.role === "parallel"
            ? item.candidates?.[0]?.label ?? ""
            : "text" in item && typeof item.text === "string"
              ? item.text
              : "",
      })),
    ).toEqual([
      { role: "user", text: "先并行试一下" },
      { role: "parallel", text: "候选 A" },
      { role: "assistant", text: "这是采纳后的主线结果" },
      { role: "user", text: "现在单次执行" },
      { role: "assistant", text: "展示一下 main.c 文件" },
    ]);
  });
});