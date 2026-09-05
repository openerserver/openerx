import type { AutomationRun } from "@openerx/contracts";

export interface AutomationNotificationContent {
  title: string;
  body: string;
}

export function automationNotificationContent(
  run: AutomationRun,
): AutomationNotificationContent | null {
  switch (run.status) {
    case "succeeded":
      return {
        title: "自动化已完成",
        body: "计划任务已完成。点击查看运行记录。",
      };
    case "needs_attention":
      return {
        title: "自动化需要处理",
        body: "后台任务遇到需要确认的操作。点击查看详情。",
      };
    case "failed":
      return {
        title: "自动化运行失败",
        body: run.failureCode
          ? `运行失败：${run.failureCode}。点击查看详情。`
          : "后台任务运行失败。点击查看详情。",
      };
    case "interrupted":
      return {
        title: "自动化已中断",
        body: "后台任务意外中断。点击查看运行记录。",
      };
    case "missed":
      return {
        title: "自动化已错过",
        body: "计划时间内执行主机未能启动任务。点击查看运行记录。",
      };
    default:
      return null;
  }
}
