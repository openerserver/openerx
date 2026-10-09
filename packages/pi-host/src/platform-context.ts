import type { Context } from "@earendil-works/pi-ai";
import { type ModelGatewayResponse, modelProviderStateSchema } from "@openerx/contracts";

const statePrefix = "openerx-responses-state-v1:";
type ProviderState = NonNullable<ModelGatewayResponse["providerState"]>;

export function encodePlatformState(state: ProviderState): string {
  return statePrefix + JSON.stringify(modelProviderStateSchema.parse(state));
}

export function decodePlatformState(signature: string): ProviderState | undefined {
  if (!signature.startsWith(statePrefix)) return undefined;
  return modelProviderStateSchema.parse(JSON.parse(signature.slice(statePrefix.length)));
}

/** Stable model input, independent of Pi's persisted session/diagnostic metadata. */
export function projectPlatformContext(context: Context, structuredOutput = false) {
  return {
    ...(context.systemPrompt === undefined ? {} : { systemPrompt: context.systemPrompt }),
    // Failed turns may contain partial arguments or leaked provider protocol text.
    // Retry from the last valid turn, as Pi's built-in providers do, without
    // changing the persisted transcript used to explain the failure to the user.
    messages: context.messages
      .filter(
        (message) =>
          message.role !== "assistant" ||
          (message.stopReason !== "error" && message.stopReason !== "aborted"),
      )
      .map((message) => {
        let providerState: ProviderState | undefined;
        const content =
          typeof message.content === "string"
            ? message.content
            : message.content.flatMap<Record<string, unknown>>((part) => {
                if (part.type === "thinking" && part.thinkingSignature) {
                  const state = decodePlatformState(part.thinkingSignature);
                  if (state) {
                    if (message.role !== "assistant" || providerState) {
                      throw new Error("MODEL_REQUEST_INVALID");
                    }
                    providerState = state;
                    return [];
                  }
                }
                switch (part.type) {
                  case "text":
                    return [{ type: part.type, text: part.text }];
                  case "image":
                    return [{ type: part.type, data: part.data, mimeType: part.mimeType }];
                  case "toolCall":
                    return [
                      { type: part.type, id: part.id, name: part.name, arguments: part.arguments },
                    ];
                  case "thinking":
                    return [
                      {
                        type: part.type,
                        thinking: part.thinking,
                        ...(part.thinkingSignature === undefined
                          ? {}
                          : { thinkingSignature: part.thinkingSignature }),
                        ...(part.redacted === undefined ? {} : { redacted: part.redacted }),
                      },
                    ];
                  default:
                    throw new Error("MODEL_CAPABILITY_UNSUPPORTED");
                }
              });
        return {
          role: message.role,
          content,
          ...(providerState ? { providerState } : {}),
          ...(message.role === "toolResult"
            ? {
                toolCallId: message.toolCallId,
                toolName: message.toolName,
                isError: message.isError,
              }
            : {}),
        };
      }),
    ...(context.tools === undefined
      ? {}
      : {
          tools: context.tools.map((tool) => {
            // Required constraints must survive projection and capability selection.
            if (
              tool.constrainedSampling &&
              (tool.constrainedSampling.type === "grammar" ||
                (tool.constrainedSampling.strict === "require" && !structuredOutput))
            ) {
              throw new Error("MODEL_CAPABILITY_UNSUPPORTED");
            }
            return {
              name: tool.name,
              description: tool.description,
              parameters: tool.parameters,
              ...(structuredOutput && tool.constrainedSampling
                ? { constrainedSampling: tool.constrainedSampling }
                : {}),
            };
          }),
        }),
  };
}
