/// <reference types="bun-types" />

import { beforeEach, describe, expect, mock, test } from "bun:test";
import { createControlPlaneClientModuleMock } from "./control-plane-client-mock";

const cpFetchMock = mock((async (..._args: unknown[]) => ({
  ok: true,
  status: 200,
  data: {},
})) as (...args: unknown[]) => Promise<{ ok: boolean; status: number; data: unknown }>);

mock.module("../../control-plane/web-ui-bff/src/lib/control-plane-client", () =>
  createControlPlaneClientModuleMock({
    cpFetch: cpFetchMock as never,
  }),
);

type FetchOptions = { method?: string; body?: unknown; authorization?: string };

function ok(data: unknown = {}) {
  return { ok: true as const, status: 200, data };
}

async function loadWorkflowStageExecutionModule() {
  return import("../../control-plane/web-ui-bff/src/modules/tasks/workflow-stage-execution");
}

beforeEach(() => {
  cpFetchMock.mockReset();
});

describe("workflow-stage-execution", () => {
  test("buildStageArtifactSummary trims output and detects completion marker", async () => {
    const { buildStageArtifactSummary } = await loadWorkflowStageExecutionModule();

    const summary = buildStageArtifactSummary(
      "已完成 clarify 阶段，需求边界与验收口径已确认。\n\n[STAGE_COMPLETE]",
    );

    expect(summary).toMatchObject({
      summary: "已完成 clarify 阶段，需求边界与验收口径已确认。",
      completionMarked: true,
      source: "assistant-output",
    });
    expect(summary?.excerpt.includes("[STAGE_COMPLETE]")).toBe(false);
  });

  test("buildWorkflowExecutionPromptSnapshot returns stage goal, completed outputs and pending stages", async () => {
    cpFetchMock.mockImplementation(async (...args: unknown[]) => {
      const [path, options] = args as [string, FetchOptions | undefined];
      if (!options?.method && path === "/api/tasks/task-1/workflow") {
        return ok({
          data: {
            workflowRun: {
              id: "wf-1",
              templateId: "tpl-1",
              currentStage: "design",
              status: "running",
            },
            stages: [
              {
                id: "stage-clarify",
                stageKey: "clarify",
                status: "completed",
                artifactsSummaryJson: {
                  summary: "需求与范围已确认。",
                },
              },
              {
                id: "stage-design",
                stageKey: "design",
                status: "running",
              },
              {
                id: "stage-implement",
                stageKey: "implement",
                status: "pending",
              },
            ],
          },
        });
      }

      if (!options?.method && path === "/api/workflow-templates/tpl-1/stages") {
        return ok({
          data: [
            {
              id: "tpl-clarify",
              stageKey: "clarify",
              name: "需求澄清",
              orderIndex: 0,
              enabled: true,
              exitCriteriaJson: ["需求范围确认", "关键约束明确"],
            },
            {
              id: "tpl-design",
              stageKey: "design",
              name: "方案设计",
              orderIndex: 1,
              enabled: true,
              exitCriteriaJson: ["接口方案明确", "模块边界确定"],
            },
            {
              id: "tpl-implement",
              stageKey: "implement",
              name: "实现开发",
              orderIndex: 2,
              enabled: true,
            },
          ],
        });
      }

      return { ok: true, status: 200, data: {} };
    });

    const { buildWorkflowExecutionPromptSnapshot } = await loadWorkflowStageExecutionModule();
    const snapshot = await buildWorkflowExecutionPromptSnapshot("task-1", "Bearer test");

    expect(snapshot).toMatchObject({
      workflowStatus: "running",
      currentStageKey: "design",
      currentStageLabel: "方案设计",
      currentStageStatus: "running",
      currentStageExitCriteria: ["接口方案明确", "模块边界确定"],
      completedStageOutputs: ["clarify：需求与范围已确认。"],
      pendingStageLabels: ["实现开发"],
    });
  });
});
