import type { ApiError } from "./api";
import type { RecoverySuggestion } from "./recovery-suggestions";
import type { SettingsRouteTarget } from "./settings-deep-link";
import { buildRuntimeRecoverySettingsTarget } from "./runtime-recovery-link";

export const RUNTIME_RECOVERY_CONTEXTS = {
  taskCreateExecute: "task-create-execute",
  taskExecute: "task-execute",
  taskContinue: "task-continue",
} as const;

export type RuntimeRecoveryNoticeContext =
  (typeof RUNTIME_RECOVERY_CONTEXTS)[keyof typeof RUNTIME_RECOVERY_CONTEXTS];

const RUNTIME_RECOVERY_NOTICE_TITLES: Record<RuntimeRecoveryNoticeContext, string> = {
  [RUNTIME_RECOVERY_CONTEXTS.taskCreateExecute]: "任务已创建，但暂时无法启动",
  [RUNTIME_RECOVERY_CONTEXTS.taskExecute]: "当前任务暂时无法执行",
  [RUNTIME_RECOVERY_CONTEXTS.taskContinue]: "当前分支暂时无法续跑",
};

export type RuntimeRecoveryNoticeModel = {
  title: string;
  target: SettingsRouteTarget;
  suggestions: RecoverySuggestion[];
};

type RuntimeRecoveryNoticeError = Pick<ApiError, "code" | "diagnostics" | "recoverySuggestions">;

export function getRuntimeRecoveryNoticeTitle(context?: RuntimeRecoveryNoticeContext) {
  if (!context) {
    return "模型执行暂不可用";
  }

  return RUNTIME_RECOVERY_NOTICE_TITLES[context] || "模型执行暂不可用";
}

export function buildRuntimeRecoveryNoticeModel(
  error: RuntimeRecoveryNoticeError,
  options?: { context?: RuntimeRecoveryNoticeContext; title?: string },
): RuntimeRecoveryNoticeModel {
  return {
    title: options?.title || getRuntimeRecoveryNoticeTitle(options?.context),
    target: buildRuntimeRecoverySettingsTarget(error),
    suggestions: error.recoverySuggestions || [],
  };
}