// @vitest-environment jsdom
import { workItemSchema } from "@openerx/contracts";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";
import { RecordedToolActivity } from "../src/renderer/RecordedToolActivity";

afterEach(cleanup);
const timestamp = "2026-10-08T00:00:00.000Z";
const runId = "11111111-1111-4111-8111-111111111111";
const fixture = () =>
  workItemSchema.parse({
    id: runId,
    ownerProfileId: "member",
    conversationId: "22222222-2222-4222-8222-222222222222",
    messageId: "33333333-3333-4333-8333-333333333333",
    title: "报告 · 执行记录",
    status: "completed",
    activeRunId: runId,
    createdAt: timestamp,
    updatedAt: timestamp,
    completedAt: timestamp,
    revision: 2,
    recordedActivity: {
      runId,
      modelRef: "platform/history",
      status: "completed",
      createdAt: timestamp,
      completedAt: timestamp,
      errorCode: null,
      bindings: [
        {
          installationId: "44444444-4444-4444-8444-444444444444",
          name: "report",
          version: "2.0.1",
          source: "enterprise",
          digest: "a".repeat(64),
        },
      ],
      tools: [
        {
          callId: "saved-call",
          name: "openerx_skill_script",
          status: "completed",
          summary: "生成了 report.docx",
          errorCode: null,
          permission: "once",
        },
      ],
    },
  });

test("saved tool summaries show recorded versions, result, approval and timestamps as readonly evidence", () => {
  render(<RecordedToolActivity workItem={fixture()} />);
  expect(screen.getByText("报告 · 执行记录")).toBeTruthy();
  expect(screen.getByText("已保存的执行摘要 · platform/history")).toBeTruthy();
  expect(screen.getByRole("region", { name: "已挂载技能" })).toBeTruthy();
  expect(screen.getByText("report · 2.0.1")).toBeTruthy();
  expect(screen.getByText("生成了 report.docx")).toBeTruthy();
  expect(screen.getByText("已单次批准")).toBeTruthy();
  expect(document.querySelectorAll(`time[datetime='${timestamp}']`)).toHaveLength(2);
  expect(screen.queryAllByRole("button")).toHaveLength(0);
  expect(screen.queryByText(/类型化输入/)).toBeNull();
});

test("historical summaries are escaped and the contract rejects invented runtime metadata", () => {
  const item = fixture();
  item.recordedActivity!.tools[0]!.summary = "<script>alert('history')</script>";
  render(<RecordedToolActivity workItem={item} />);
  expect(screen.getByText("<script>alert('history')</script>")).toBeTruthy();
  expect(document.querySelector("script")).toBeNull();
  expect(() =>
    workItemSchema.parse({
      ...item,
      recordedActivity: { ...item.recordedActivity, piPackageVersion: "invented" },
    }),
  ).toThrow();
});
