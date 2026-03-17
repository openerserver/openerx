import { describe, expect, it } from "vitest";
import { RECOVERY_SUGGESTION_KINDS } from "./recovery-suggestions";
import { RUNTIME_RECOVERY_ERROR_CODES } from "./runtime-recovery-contract";
import {
  RUNTIME_RECOVERY_CONTEXTS,
  buildRuntimeRecoveryNoticeModel,
  getRuntimeRecoveryNoticeTitle,
} from "./runtime-recovery-notice";
import { SETTINGS_SECTIONS, SETTINGS_TAB_MODELS } from "./settings-deep-link";

describe("getRuntimeRecoveryNoticeTitle", () => {
  it("returns page-specific titles for supported contexts", () => {
    expect(getRuntimeRecoveryNoticeTitle(RUNTIME_RECOVERY_CONTEXTS.taskCreateExecute)).toBe(
      "任务已创建，但暂时无法启动",
    );
    expect(getRuntimeRecoveryNoticeTitle(RUNTIME_RECOVERY_CONTEXTS.taskExecute)).toBe(
      "当前任务暂时无法执行",
    );
    expect(getRuntimeRecoveryNoticeTitle(RUNTIME_RECOVERY_CONTEXTS.taskContinue)).toBe(
      "当前分支暂时无法续跑",
    );
  });

  it("falls back to generic title", () => {
    expect(getRuntimeRecoveryNoticeTitle()).toBe("模型执行暂不可用");
  });
});

describe("buildRuntimeRecoveryNoticeModel", () => {
  it("combines title, target and suggestions for task execution", () => {
    const model = buildRuntimeRecoveryNoticeModel(
      {
        code: RUNTIME_RECOVERY_ERROR_CODES.providerNotConfigured,
        diagnostics: {
          providerId: "qwen-local",
        },
        recoverySuggestions: [
          {
            id: "add-provider",
            kind: RECOVERY_SUGGESTION_KINDS.config,
            title: "先添加 Provider",
          },
          {
            id: "retry-task",
            kind: RECOVERY_SUGGESTION_KINDS.check,
            title: "再重新执行任务",
          },
        ],
      },
      { context: RUNTIME_RECOVERY_CONTEXTS.taskExecute },
    );

    expect(model.title).toBe("当前任务暂时无法执行");
    expect(model.suggestions).toEqual([
      {
        id: "add-provider",
        kind: RECOVERY_SUGGESTION_KINDS.config,
        title: "先添加 Provider",
      },
      {
        id: "retry-task",
        kind: RECOVERY_SUGGESTION_KINDS.check,
        title: "再重新执行任务",
      },
    ]);
    expect(model.target).toEqual({
      path: "/settings",
      query: {
        tab: SETTINGS_TAB_MODELS,
        section: SETTINGS_SECTIONS.providerAdd,
        provider: "qwen-local",
      },
    });
  });

  it("supports explicit title overrides", () => {
    const model = buildRuntimeRecoveryNoticeModel(
      {
        code: RUNTIME_RECOVERY_ERROR_CODES.providerAuthRequired,
        diagnostics: {
          providerId: "github-copilot",
        },
        recoverySuggestions: [],
      },
      {
        context: RUNTIME_RECOVERY_CONTEXTS.taskContinue,
        title: "自定义恢复标题",
      },
    );

    expect(model.title).toBe("自定义恢复标题");
  });
});
