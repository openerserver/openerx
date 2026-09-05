import { randomUUID } from "node:crypto";
import {
  automaticModelRef,
  type ModelGatewayRequestDto,
  safeErrorMessage,
} from "@openerx/contracts";
import { createDeepSeekModelExecutorFromEnv } from "@openerx/model-gateway";

const accountId = randomUUID();
const conversationId = randomUUID();
const assistantMessageId = randomUUID();
const tool = {
  name: "openerx_shell",
  description: "Run one argv-based command in the approved workspace.",
  parameters: {
    type: "object",
    properties: {
      cwd: { type: "string" },
      command: { type: "string" },
      args: { type: "array", items: { type: "string" } },
    },
    required: ["cwd", "command", "args"],
    additionalProperties: false,
  },
};

function request(
  requestDedupeKey: string,
  context: ModelGatewayRequestDto["context"],
): ModelGatewayRequestDto {
  return {
    accountId,
    conversationId,
    messageId: assistantMessageId,
    selectedModelRef: automaticModelRef,
    approvedFallbackModelRef: null,
    requestDedupeKey,
    requirements: { functionCalling: true },
    context,
  };
}

try {
  const executor = createDeepSeekModelExecutorFromEnv();
  const firstDeltas: string[] = [];
  const first = await executor.stream(
    request(`deepseek-tool-smoke-first-${randomUUID()}`, {
      systemPrompt:
        "You are a tool-call protocol test. Call openerx_shell exactly once before answering.",
      messages: [
        {
          role: "user",
          content:
            'Call openerx_shell with cwd "/workspace", command "ls", and args ["-la"]. Do not answer until its result is available.',
          timestamp: Date.now(),
        },
      ],
      tools: [tool],
    }),
    (delta) => firstDeltas.push(delta),
    undefined,
  );
  if (first.text !== firstDeltas.join("")) {
    throw new Error("DEEPSEEK_TOOL_SMOKE_FIRST_STREAM_MISMATCH");
  }
  if (first.finishReason !== "tool_calls" || first.toolCalls?.length !== 1) {
    throw new Error("DEEPSEEK_TOOL_SMOKE_NATIVE_CALL_MISSING");
  }
  const toolCall = first.toolCalls[0];
  if (toolCall?.name !== tool.name) throw new Error("DEEPSEEK_TOOL_SMOKE_NAME_MISMATCH");
  if (`${first.text}${firstDeltas.join("")}`.includes("DSML")) {
    throw new Error("DEEPSEEK_TOOL_SMOKE_PROTOCOL_LEAK");
  }

  const secondDeltas: string[] = [];
  const second = await executor.stream(
    request(`deepseek-tool-smoke-second-${randomUUID()}`, {
      systemPrompt:
        "You are a tool-call protocol test. After receiving OPENERX_TOOL_RESULT_OK, reply exactly: 工具续跑成功. Do not call another tool.",
      messages: [
        {
          role: "user",
          content:
            'Call openerx_shell with cwd "/workspace", command "ls", and args ["-la"]. Do not answer until its result is available.',
          timestamp: Date.now() - 2,
        },
        {
          role: "assistant",
          content: [
            ...(first.text ? [{ type: "text", text: first.text }] : []),
            {
              type: "toolCall",
              id: toolCall.id,
              name: toolCall.name,
              arguments: toolCall.arguments,
            },
          ],
          timestamp: Date.now() - 1,
        },
        {
          role: "toolResult",
          toolCallId: toolCall.id,
          toolName: toolCall.name,
          content: [{ type: "text", text: "OPENERX_TOOL_RESULT_OK" }],
          isError: false,
          timestamp: Date.now(),
        },
      ],
      tools: [tool],
    }),
    (delta) => secondDeltas.push(delta),
    undefined,
  );
  if (second.text !== secondDeltas.join("")) {
    throw new Error("DEEPSEEK_TOOL_SMOKE_SECOND_STREAM_MISMATCH");
  }
  if (second.toolCalls && second.toolCalls.length > 0) {
    throw new Error("DEEPSEEK_TOOL_SMOKE_UNEXPECTED_SECOND_CALL");
  }
  if (!second.text.includes("工具续跑成功") || second.text.includes("DSML")) {
    throw new Error("DEEPSEEK_TOOL_SMOKE_CONTINUATION_INVALID");
  }

  process.stdout.write(
    `${JSON.stringify(
      {
        ok: true,
        effectiveModelRef: second.effectiveModelRef,
        first: {
          finishReason: first.finishReason,
          toolCallName: toolCall.name,
          protocolLeak: false,
          usage: first.usage,
        },
        continuation: {
          text: second.text,
          toolCalls: second.toolCalls?.length ?? 0,
          usage: second.usage,
        },
      },
      null,
      2,
    )}\n`,
  );
} catch (error) {
  process.stderr.write(`${safeErrorMessage(error, "DeepSeek tool smoke test failed")}\n`);
  process.exitCode = 1;
}
