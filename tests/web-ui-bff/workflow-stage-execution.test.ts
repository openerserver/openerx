/// <reference types="bun-types" />

import { beforeEach, describe, expect, mock, test } from "bun:test";

const cpFetchMock = mock(async () => ({ ok: true, data: {} }));

mock.module("../../control-plane/web-ui-bff/src/lib/control-plane-client", () => ({
  cpFetch: cpFetchMock,
}));

type FetchOptions = { method?: string; body?: unknown; authorization?: string };

function ok(data: unknown = {}) {
  return { ok: true as const, data };
}

async function loadWorkflowStageExecutionModule() {
  return import(
    "../../control-plane/web-ui-bff/src/modules/tasks/workflow-stage-execution?workflow-stage-execution-test"
  );
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
    cpFetchMock.mockImplementation(async (path: string, options?: FetchOptions) => {
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

      return ok({});
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

  test("persistWorkflowStageExecutionOutcome advances to next stage when completion marker exists", async () => {
    cpFetchMock.mockImplementation(async (path: string, options?: FetchOptions) => {
      if (path === "/api/project-tree/tasks/task-2" && !options?.method) {
        return ok({
          id: "task-2",
          title: "Clarify Task",
          prompt: "确认需求边界",
          projectId: "proj-1",
          autoAdvanceStages: true,
        });
      }

      if (!options?.method && path === "/api/tasks/task-2/workflow") {
        return ok({
          data: {
            workflowRun: {
              id: "wf-2",
              templateId: "tpl-2",
              currentStage: "clarify",
              status: "running",
            },
            stages: [
              {
                id: "run-clarify",
                stageKey: "clarify",
                status: "running",
              },
              {
                id: "run-design",
                stageKey: "design",
                status: "pending",
              },
            ],
          },
        });
      }

      if (!options?.method && path === "/api/workflow-templates/tpl-2/stages") {
        return ok({
          data: [
            { id: "tpl-clarify", stageKey: "clarify", name: "需求澄清", orderIndex: 0, enabled: true },
            { id: "tpl-design", stageKey: "design", name: "方案设计", orderIndex: 1, enabled: true },
          ],
        });
      }

      if (options?.method === "POST" && path === "/api/tasks/task-2/workflow/advance") {
        return ok({ ok: true, body: options.body });
      }

      return ok({});
    });

    const { persistWorkflowStageExecutionOutcome } = await loadWorkflowStageExecutionModule();
    const result = await persistWorkflowStageExecutionOutcome({
      taskId: "task-2",
      authorization: "Bearer test",
      resultText: "需求边界已确认，下一阶段可进入方案设计。\n[STAGE_COMPLETE]",
    });

    expect(result.advanced).toBe(true);
    expect(result.nextStageKey).toBe("design");
    expect(cpFetchMock).toHaveBeenCalledWith("/api/tasks/task-2/workflow/advance", {
      method: "POST",
      authorization: "Bearer test",
      body: expect.objectContaining({
        fromStage: "clarify",
        toStage: "design",
        status: "completed",
        artifactsSummaryJson: expect.objectContaining({
          summary: "需求边界已确认，下一阶段可进入方案设计。",
          completionMarked: true,
        }),
      }),
    });
  });

  test("persistWorkflowStageExecutionOutcome creates next stage task from initialTaskDefinition", async () => {
    cpFetchMock.mockImplementation(async (path: string, options?: FetchOptions) => {
      if (!options?.method && path === "/api/tasks/task-3/workflow") {
        return ok({
          data: {
            workflowRun: {
              id: "wf-3",
              templateId: "tpl-3",
              currentStage: "clarify",
              status: "running",
            },
            stages: [
              {
                id: "run-clarify",
                stageKey: "clarify",
                status: "running",
              },
              {
                id: "run-design",
                stageKey: "design",
                status: "pending",
              },
            ],
          },
        });
      }

      if (!options?.method && path === "/api/workflow-templates/tpl-3/stages") {
        return ok({
          data: [
            { id: "tpl-clarify", stageKey: "clarify", name: "需求澄清", mode: "single", orderIndex: 0, enabled: true },
            {
              id: "tpl-design",
              stageKey: "design",
              name: "方案设计",
              mode: "parallel",
              orderIndex: 1,
              enabled: true,
              exitCriteriaJson: ["方案评审通过", "关键接口明确"],
              initialTaskDefinitionJson: {
                version: 1,
                titleTemplate: "{{nextStageName}}：首个任务",
                goalTemplate: "围绕 {{currentTaskTitle}} 产出设计方案",
                instructionTemplate: "请基于上一阶段摘要推进 {{nextStageName}}。",
                doneWhen: ["完成方案草案", "输出接口清单"],
                defaultExecutionMode: "parallel",
                defaultCandidates: [
                  { model: "gpt-5.4", label: "主模型" },
                  { model: "claude-sonnet", label: "对照模型" },
                ],
                contextBindings: {
                  includeProjectBrief: true,
                  includePreviousStageSummary: true,
                  includeCurrentStageExitCriteria: true,
                },
                outputContract: {
                  summaryLabel: "design-summary",
                  artifactKeys: ["solution", "interfaces"],
                  requireStageCompleteMarker: true,
                },
              },
            },
          ],
        });
      }

      if (path === "/api/project-tree/tasks/task-3" && !options?.method) {
        return ok({
          id: "task-3",
          title: "Clarify Task",
          prompt: "请先澄清需求，再进入设计。",
          projectId: "proj-1",
          autoAdvanceStages: true,
          strategy: JSON.stringify({ workflowTemplateId: "tpl-3", scenarioKey: "delivery" }),
          selectedModel: "gpt-4.1",
          repoId: "repo-1",
          workingBranch: "feature/workflow",
          credentialId: "cred-1",
          gitAuthorName: "Alice",
          gitAuthorEmail: "alice@example.com",
          gitCommitterName: "Bot",
          gitCommitterEmail: "bot@example.com",
          result: "上一阶段已经把范围和约束整理完毕。",
        });
      }

      if (path === "/api/tasks/task-3/operating-runtime/mode" && !options?.method) {
        return ok({
          data: {
            collaborationMode: "team",
            autopilotLevel: "L1",
            bossParticipationMode: "advisory",
            selectedTemplateId: "tpl-3",
            scenarioKey: "delivery",
            source: "project-default",
          },
        });
      }

      if (options?.method === "POST" && path === "/api/tasks/task-3/workflow/advance") {
        return ok({ ok: true, body: options.body });
      }

      if (options?.method === "POST" && path === "/api/tasks") {
        return ok({ id: "task-4" });
      }

      if (options?.method === "PATCH" && path === "/api/tasks/task-4") {
        return ok({ ok: true });
      }

      if (options?.method === "PUT" && path === "/api/tasks/task-4/operating-runtime/mode") {
        return ok({ ok: true });
      }

      if (options?.method === "POST" && path === "/api/tasks/task-4/workflow/initialize") {
        return ok({ ok: true });
      }

      return ok({});
    });

    const { persistWorkflowStageExecutionOutcome } = await loadWorkflowStageExecutionModule();
    const result = await persistWorkflowStageExecutionOutcome({
      taskId: "task-3",
      authorization: "Bearer test",
      resultText: "需求边界与约束已确认。\n[STAGE_COMPLETE]",
    });

    expect(result.advanced).toBe(true);
    expect(result.spawnedTaskId).toBe("task-4");
    expect(cpFetchMock).toHaveBeenCalledWith("/api/tasks", {
      method: "POST",
      authorization: "Bearer test",
      body: expect.objectContaining({
        title: "方案设计：首个任务",
        projectId: "proj-1",
        repoId: "repo-1",
        workingBranch: "feature/workflow",
        credentialId: "cred-1",
        selectedModel: "gpt-5.4",
        relationContext: expect.objectContaining({
          spawnedFromTaskId: "task-3",
          metadata: expect.objectContaining({
            source: "workflow-stage-auto-advance",
            fromStageKey: "clarify",
            toStageKey: "design",
          }),
        }),
        prompt: expect.stringContaining("上一阶段摘要：需求边界与约束已确认。"),
      }),
    });
    expect(cpFetchMock).toHaveBeenCalledWith("/api/tasks/task-4/workflow/initialize", {
      method: "POST",
      authorization: "Bearer test",
      body: {
        templateId: "tpl-3",
        currentStage: "design",
      },
    });
    expect(cpFetchMock).toHaveBeenCalledWith("/api/tasks/task-4", {
      method: "PATCH",
      authorization: "Bearer test",
      body: expect.objectContaining({
        executionMode: "parallel",
        executionPlan: expect.stringContaining('"mode":"parallel"'),
        strategy: expect.stringContaining('"executionMode":"parallel"'),
      }),
    });
    expect(cpFetchMock).toHaveBeenCalledWith("/api/tasks/task-4/operating-runtime/mode", {
      method: "PUT",
      authorization: "Bearer test",
      body: expect.objectContaining({
        collaborationMode: "team",
        autopilotLevel: "L1",
        bossParticipationMode: "advisory",
        selectedTemplateId: "tpl-3",
      }),
    });
  });

  test("persistWorkflowStageExecutionOutcome serializes sequential-chain defaultSteps into executionPlan", async () => {
    cpFetchMock.mockImplementation(async (path: string, options?: FetchOptions) => {
      if (!options?.method && path === "/api/tasks/task-5/workflow") {
        return ok({
          data: {
            workflowRun: {
              id: "wf-5",
              templateId: "tpl-5",
              currentStage: "clarify",
              status: "running",
            },
            stages: [
              { id: "run-clarify", stageKey: "clarify", status: "running" },
              { id: "run-design", stageKey: "design", status: "pending" },
            ],
          },
        });
      }

      if (!options?.method && path === "/api/workflow-templates/tpl-5/stages") {
        return ok({
          data: [
            { id: "tpl-clarify", stageKey: "clarify", name: "需求澄清", mode: "single", orderIndex: 0, enabled: true },
            {
              id: "tpl-design",
              stageKey: "design",
              name: "方案设计",
              mode: "sequential-chain",
              orderIndex: 1,
              enabled: true,
              initialTaskDefinitionJson: {
                version: 1,
                titleTemplate: "方案设计：串行任务",
                goalTemplate: "先分析，再收敛设计",
                instructionTemplate: "按照步骤顺序推进",
                defaultExecutionMode: "sequential-chain",
                defaultSteps: [
                  {
                    id: "step-analysis",
                    title: "分析现状",
                    instruction: "先总结约束和已有实现。",
                    model: "gpt-5.4",
                  },
                  {
                    id: "step-design",
                    title: "给出方案",
                    instruction: "输出模块划分和接口设计。",
                    model: "claude-sonnet",
                  },
                ],
              },
            },
          ],
        });
      }

      if (path === "/api/project-tree/tasks/task-5" && !options?.method) {
        return ok({
          id: "task-5",
          title: "Clarify Task",
          prompt: "请先澄清需求，再进入设计。",
          projectId: "proj-1",
          autoAdvanceStages: true,
          strategy: JSON.stringify({ workflowTemplateId: "tpl-5" }),
          selectedModel: "gpt-4.1",
        });
      }

      if (path === "/api/tasks/task-5/operating-runtime/mode" && !options?.method) {
        return ok({
          data: {
            collaborationMode: "team",
            autopilotLevel: "L1",
            bossParticipationMode: "advisory",
            selectedTemplateId: "tpl-5",
            source: "project-default",
          },
        });
      }

      if (options?.method === "POST" && path === "/api/tasks/task-5/workflow/advance") {
        return ok({ ok: true });
      }

      if (options?.method === "POST" && path === "/api/tasks") {
        return ok({ id: "task-6" });
      }

      if (options?.method === "PATCH" && path === "/api/tasks/task-6") {
        return ok({ ok: true });
      }

      if (options?.method === "PUT" && path === "/api/tasks/task-6/operating-runtime/mode") {
        return ok({ ok: true });
      }

      if (options?.method === "POST" && path === "/api/tasks/task-6/workflow/initialize") {
        return ok({ ok: true });
      }

      return ok({});
    });

    const { persistWorkflowStageExecutionOutcome } = await loadWorkflowStageExecutionModule();
    const result = await persistWorkflowStageExecutionOutcome({
      taskId: "task-5",
      authorization: "Bearer test",
      resultText: "澄清完成。\n[STAGE_COMPLETE]",
    });

    expect(result.spawnedTaskId).toBe("task-6");
    expect(cpFetchMock).toHaveBeenCalledWith("/api/tasks/task-6", {
      method: "PATCH",
      authorization: "Bearer test",
      body: expect.objectContaining({
        executionMode: "single",
        executionPlan: expect.stringContaining('"pipelineMetadata":{"requestedMode":"sequential-chain"'),
        strategy: expect.stringContaining('"executionMode":"single"'),
      }),
    });
    const patchCall = cpFetchMock.mock.calls.find(
      ([path, options]) => path === "/api/tasks/task-6" && options?.method === "PATCH",
    );
    expect(patchCall).toBeTruthy();
    expect(String((patchCall?.[1] as FetchOptions & { body?: Record<string, unknown> })?.body?.executionPlan)).toContain('"title":"分析现状"');
    expect(String((patchCall?.[1] as FetchOptions & { body?: Record<string, unknown> })?.body?.executionPlan)).toContain('"instruction":"输出模块划分和接口设计。"');
  });

  test("persistWorkflowStageExecutionOutcome does not advance when autoAdvanceStages is disabled", async () => {
    cpFetchMock.mockImplementation(async (path: string, options?: FetchOptions) => {
      if (path === "/api/project-tree/tasks/task-6" && !options?.method) {
        return ok({
          id: "task-6",
          title: "Clarify Task",
          prompt: "确认需求边界",
          projectId: "proj-1",
          autoAdvanceStages: false,
        });
      }

      if (!options?.method && path === "/api/tasks/task-6/workflow") {
        return ok({
          data: {
            workflowRun: {
              id: "wf-6",
              templateId: "tpl-6",
              currentStage: "clarify",
              status: "running",
            },
            stages: [
              { id: "run-clarify", stageKey: "clarify", status: "running" },
              { id: "run-design", stageKey: "design", status: "pending" },
            ],
          },
        });
      }

      if (!options?.method && path === "/api/workflow-templates/tpl-6/stages") {
        return ok({
          data: [
            { id: "tpl-clarify", stageKey: "clarify", name: "需求澄清", orderIndex: 0, enabled: true },
            { id: "tpl-design", stageKey: "design", name: "方案设计", orderIndex: 1, enabled: true },
          ],
        });
      }

      return ok({});
    });

    const { persistWorkflowStageExecutionOutcome } = await loadWorkflowStageExecutionModule();
    const result = await persistWorkflowStageExecutionOutcome({
      taskId: "task-6",
      authorization: "Bearer test",
      resultText: "需求澄清完成。\n[STAGE_COMPLETE]",
    });

    expect(result.advanced).toBe(false);
    expect(result.nextStageKey).toBeUndefined();
    expect(cpFetchMock).toHaveBeenCalledWith("/api/tasks/task-6/workflow/advance", {
      method: "POST",
      authorization: "Bearer test",
      body: expect.objectContaining({
        fromStage: "clarify",
        status: "running",
      }),
    });
  });
});