import type { AssistantMessage, Context } from "@earendil-works/pi-ai";
import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai/providers/faux";
import { ModelRuntime } from "@openerx/pi-host";
import { startPiHostProcess } from "@openerx/pi-host/host";

function contentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter(
      (part): part is { type: "text"; text: string } =>
        typeof part === "object" &&
        part !== null &&
        "type" in part &&
        part.type === "text" &&
        "text" in part &&
        typeof part.text === "string",
    )
    .map(({ text }) => text)
    .join("");
}

function responseFor(context: Context): AssistantMessage {
  const userMessages = context.messages.filter(({ role }) => role === "user");
  const latestUser = contentText(userMessages.at(-1)?.content);
  if (latestUser.includes("法国的首都")) return fauxAssistantMessage("巴黎。");
  if (latestUser.includes("代码块") && latestUser.includes("表格")) {
    return fauxAssistantMessage(
      [
        "```ts",
        'const client = "OpenerX";',
        "```",
        "",
        "| 项目 | 状态 | 版本 |",
        "| --- | --- | --- |",
        "| Pi AgentSession | ready | 0.84.3 |",
      ].join("\n"),
    );
  }
  if (latestUser.includes("2000 字") || latestUser.includes("[PI_TEST_SLOW]")) {
    return fauxAssistantMessage(
      `长响应开始。${"这是用于验证停止后不再追加内容的固定段落。".repeat(80)}`,
    );
  }
  if (userMessages.length >= 2) {
    return fauxAssistantMessage(
      `这是第 ${userMessages.length} 轮回答。当前 Pi 上下文共有 ${context.messages.length} 条消息。`,
    );
  }
  return fauxAssistantMessage(`Pi AgentSession 已收到：${latestUser}`);
}

const parentPort = process.parentPort;
if (!parentPort) throw new Error("Pi E2E Host requires an Electron parent port");

const modelRuntime = await ModelRuntime.create({ modelsPath: null, refreshOnCreate: false });
const faux = fauxProvider({ tokensPerSecond: 1_000, tokenSize: { min: 2, max: 6 } });
modelRuntime.registerNativeProvider(faux.provider);
faux.setResponses(Array.from({ length: 100 }, () => responseFor));
startPiHostProcess(parentPort, { modelRuntime, model: faux.getModel() });
