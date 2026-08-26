import type { AssistantMessage, Context } from "@earendil-works/pi-ai";
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai/providers/faux";
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
  let lastUserIndex = -1;
  for (let index = context.messages.length - 1; index >= 0; index -= 1) {
    if (context.messages[index]?.role === "user") {
      lastUserIndex = index;
      break;
    }
  }
  const toolResults = context.messages
    .slice(lastUserIndex + 1)
    .filter(({ role }) => role === "toolResult");
  if (latestUser.includes("[PI_TEST_SKILL]") || latestUser.includes("[PI_TEST_SKILL_AUTO]")) {
    const automatic = latestUser.includes("[PI_TEST_SKILL_AUTO]");
    const skillContext = automatic ? `${latestUser}\n${context.systemPrompt}` : latestUser;
    const skillName = automatic
      ? skillContext.match(/<name>([^<]+)<\/name>/)?.[1]
      : skillContext.match(/<skill name="([^"]+)"/)?.[1];
    const skillFile = automatic
      ? skillContext.match(/<location>([^<]+\/SKILL\.md)<\/location>/)?.[1]
      : skillContext.match(/location="([^"]+\/SKILL\.md)"/)?.[1];
    if (!skillName || !skillFile) return fauxAssistantMessage("Skill 没有通过 Pi 原生展开。");
    if (automatic && toolResults.length === 0) {
      return fauxAssistantMessage(
        fauxToolCall("read", { path: skillFile }, { id: "skill-read-instructions" }),
        { stopReason: "toolUse" },
      );
    }
    if (toolResults.length === (automatic ? 1 : 0)) {
      return fauxAssistantMessage(
        fauxToolCall(
          "read",
          { path: `${skillFile.slice(0, -"SKILL.md".length)}references/template.md` },
          { id: "skill-read-reference" },
        ),
        { stopReason: "toolUse" },
      );
    }
    if (toolResults.length === (automatic ? 2 : 1)) {
      return fauxAssistantMessage(
        fauxToolCall(
          "openerx_skill_script",
          {
            skill: skillName,
            script: "scripts/render.mjs",
            args: ["M7 E2E report"],
            timeoutMs: 5_000,
            allowNetwork: false,
          },
          { id: "skill-run-script" },
        ),
        { stopReason: "toolUse" },
      );
    }
    return fauxAssistantMessage(
      `Skill ${skillName} 已通过 Pi 渐进加载，并经 Broker 完成脚本：${contentText(toolResults.at(-1)?.content)}`,
    );
  }
  if (latestUser.includes("[PI_TEST_BROWSER]")) {
    const url = latestUser.match(/https?:\/\/\S+/)?.[0];
    const uploadFileId = latestUser.match(/FILE_ID=([0-9a-f-]+)/)?.[1];
    if (!url) return fauxAssistantMessage("缺少测试 URL。");
    if (toolResults.length === 0) {
      return fauxAssistantMessage(
        fauxToolCall("openerx_browser", { action: "open", url }, { id: "browser-open" }),
        { stopReason: "toolUse" },
      );
    }
    const first = JSON.parse(contentText(toolResults[0]?.content)) as {
      data?: { sessionId?: string; partition?: string };
    };
    const sessionId = first.data?.sessionId;
    if (!sessionId) return fauxAssistantMessage("隔离浏览器没有返回 Session。");
    if (toolResults.length === 1) {
      return fauxAssistantMessage(
        fauxToolCall(
          "openerx_browser",
          { action: "type", sessionId, selector: "#name", text: "OpenerX M5" },
          { id: "browser-type" },
        ),
        { stopReason: "toolUse" },
      );
    }
    if (toolResults.length === 2) {
      return fauxAssistantMessage(
        fauxToolCall(
          "openerx_browser",
          { action: "screenshot", sessionId },
          { id: "browser-screenshot" },
        ),
        { stopReason: "toolUse" },
      );
    }
    if (toolResults.length === 3) {
      return fauxAssistantMessage(
        fauxToolCall(
          "openerx_browser",
          { action: "upload", sessionId, selector: "#upload", fileId: uploadFileId },
          { id: "browser-upload" },
        ),
        { stopReason: "toolUse" },
      );
    }
    if (toolResults.length === 4) {
      return fauxAssistantMessage(
        fauxToolCall(
          "openerx_browser",
          { action: "download", sessionId, selector: "#download" },
          { id: "browser-download" },
        ),
        { stopReason: "toolUse" },
      );
    }
    if (toolResults.length === 5) {
      return fauxAssistantMessage(
        fauxToolCall("openerx_browser", { action: "close", sessionId }, { id: "browser-close" }),
        { stopReason: "toolUse" },
      );
    }
    return fauxAssistantMessage(
      `隔离浏览器工具完成；独立分区 ${first.data?.partition ?? "unknown"}。`,
    );
  }
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
    const repetitions = latestUser.includes("崩溃恢复") ? 800 : 80;
    return fauxAssistantMessage(
      `长响应开始。${"这是用于验证停止后不再追加内容的固定段落。".repeat(repetitions)}`,
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
