import type { AutomaticMemoryCreatedEvent } from "@openerx/contracts";

export interface MemoryNotificationContent {
  title: string;
  body: string;
}

export function memoryNotificationContent(
  event: AutomaticMemoryCreatedEvent,
): MemoryNotificationContent {
  const count = event.memories.length;
  return {
    title: "已生成长期记忆",
    body: `后台新增 ${count} 条长期记忆。点击查看或撤销。`,
  };
}
