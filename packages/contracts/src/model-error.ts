import { z } from "zod";

const failures = {
  MODEL_AUTHENTICATION_FAILED: [
    "authentication",
    false,
    "模型 API Key 无效或已失效，请在模型设置中更新密钥。",
  ],
  MODEL_PERMISSION_DENIED: [
    "permission",
    false,
    "当前 API Key 没有调用此模型的权限，请检查供应商授权。",
  ],
  MODEL_QUOTA_EXCEEDED: ["quota", false, "模型账户额度不足，请检查供应商余额或用量上限。"],
  MODEL_RATE_LIMITED: ["rate_limit", true, "模型请求受到限流，请稍后重试或降低并发。"],
  MODEL_REQUEST_TIMEOUT: ["timeout", true, "模型请求超时，请稍后重试。"],
  MODEL_NETWORK_ERROR: ["network", true, "连接模型服务失败，请检查网络和模型服务地址。"],
  MODEL_SERVER_ERROR: ["server", true, "模型供应商服务异常，请稍后重试。"],
  MODEL_CONTEXT_LIMIT_REACHED: [
    "context_limit",
    false,
    "上下文超过模型限制，请缩短对话或切换到更大上下文的模型。",
  ],
  MODEL_OUTPUT_LIMIT_REACHED: [
    "output_limit",
    false,
    "模型输出达到长度上限，请分段生成或提高输出上限。",
  ],
  MODEL_RESPONSE_INVALID: [
    "response",
    false,
    "模型返回的内容或工具调用格式无效，请检查模型兼容性。",
  ],
  MODEL_REQUEST_INVALID: ["request", false, "模型不接受当前请求参数，请检查模型配置与能力设置。"],
  MODEL_NOT_FOUND: ["configuration", false, "模型或接口不存在，请检查模型名称和服务地址。"],
  MODEL_CONFIGURATION_INVALID: [
    "configuration",
    false,
    "模型配置不可用，请检查服务地址、密钥和能力设置。",
  ],
  MODEL_CAPABILITY_UNSUPPORTED: [
    "capability",
    false,
    "当前模型不支持本次请求所需的能力，请选择支持相应输入和工具的模型。",
  ],
  MODEL_CONTENT_FILTERED: ["content_filter", false, "模型供应商拒绝了本次内容，请调整请求后再试。"],
  MODEL_REQUEST_ABORTED: ["cancelled", false, "本次模型调用已取消。"],
  MODEL_PROVIDER_FAILURE: [
    "unknown",
    false,
    "模型调用失败，未获得可确认的具体原因，请检查模型服务状态。",
  ],
} as const;

export type ModelErrorCode = keyof typeof failures;
export const modelErrorCodeSchema = z.enum(
  Object.keys(failures) as [ModelErrorCode, ...ModelErrorCode[]],
);
export const modelFailureSchema = z
  .object({
    code: modelErrorCodeSchema,
    category: z.enum([
      "authentication",
      "permission",
      "quota",
      "rate_limit",
      "timeout",
      "network",
      "server",
      "context_limit",
      "output_limit",
      "response",
      "request",
      "configuration",
      "capability",
      "content_filter",
      "cancelled",
      "unknown",
    ]),
    retryable: z.boolean(),
    httpStatus: z.number().int().min(100).max(599).nullable(),
  })
  .strict();
export type ModelFailure = z.infer<typeof modelFailureSchema>;

export function modelFailureMessage(code: string): string | undefined {
  return Object.hasOwn(failures, code) ? failures[code as ModelErrorCode][2] : undefined;
}

/** Only returns fixed classifications; provider text and credentials never leave this function. */
export function classifyModelError(
  error: unknown,
  options: { httpStatus?: number | null; cancelled?: boolean } = {},
): ModelFailure {
  const candidate = error && typeof error === "object" ? (error as Record<string, unknown>) : {};
  const message =
    typeof error === "string"
      ? error
      : typeof candidate.message === "string"
        ? candidate.message
        : "";
  const text = `${typeof candidate.code === "string" ? candidate.code : ""} ${message}`.slice(
    0,
    16_000,
  );
  const status =
    options.httpStatus ??
    (typeof candidate.status === "number" ? candidate.status : undefined) ??
    Number(
      text.match(
        /(?:API_ERROR:|HTTP[_ :]|CONNECTION_FAILED:|status[=: ]+|^\s*)([45]\d\d)\b/iu,
      )?.[1],
    );
  const httpStatus = Number.isInteger(status) && status >= 100 && status <= 599 ? status : null;
  const known =
    typeof candidate.code === "string" && Object.hasOwn(failures, candidate.code)
      ? candidate.code
      : (message.split(":", 1)[0] ?? "");
  let code: ModelErrorCode;
  if (
    options.cancelled ||
    candidate.name === "AbortError" ||
    /^(?:MODEL_REQUEST_ABORTED|AbortError)$/u.test(known)
  )
    code = "MODEL_REQUEST_ABORTED";
  else if (Object.hasOwn(failures, known)) code = known as ModelErrorCode;
  else if (
    /insufficient[_ ]quota|quota[_ ]exceeded|insufficient[_ ](?:balance|funds)|credit[_ ]balance|billing[_ ]hard[_ ]limit|余额不足|额度不足/iu.test(
      text,
    ) ||
    httpStatus === 402
  )
    code = "MODEL_QUOTA_EXCEEDED";
  else if (
    httpStatus === 401 ||
    /invalid[_ ]api[_ -]?key|incorrect[_ ]api[_ -]?key|api[_ ]key[_ ]invalid|authentication[_ ](?:failed|error)|unauthorized/iu.test(
      text,
    )
  )
    code = "MODEL_AUTHENTICATION_FAILED";
  else if (httpStatus === 403 || /permission[_ ]denied|access[_ ]denied/iu.test(text))
    code = "MODEL_PERMISSION_DENIED";
  else if (httpStatus === 429 || /rate[_ ]limit|too many requests/iu.test(text))
    code = "MODEL_RATE_LIMITED";
  else if (
    /context[_ ](?:length|window|limit)|maximum context|too many (?:input )?tokens|prompt is too long|上下文.*(?:过长|超限)/iu.test(
      text,
    )
  )
    code = "MODEL_CONTEXT_LIMIT_REACHED";
  else if (/OUTPUT_(?:LIMIT_REACHED|TRUNCATED)|max[_ ]tokens.*(?:exceed|limit)/iu.test(text))
    code = "MODEL_OUTPUT_LIMIT_REACHED";
  else if (/content[_ ]filter|content[_ ]policy|safety[_ ]filter/iu.test(text))
    code = "MODEL_CONTENT_FILTERED";
  else if (httpStatus === 408 || httpStatus === 504 || /timeout|timed out|ETIMEDOUT/iu.test(text))
    code = "MODEL_REQUEST_TIMEOUT";
  else if (
    (httpStatus !== null && httpStatus >= 500) ||
    /overloaded|insufficient_system_resource/iu.test(text)
  )
    code = "MODEL_SERVER_ERROR";
  else if (httpStatus === 404 || /model[_ ]not[_ ]found/iu.test(text)) code = "MODEL_NOT_FOUND";
  else if (
    /BYOK_(?:REDIRECT|REQUEST_TARGET)_FORBIDDEN|BYOK_NOT_CONFIGURED|DEEPSEEK_MODEL_INVALID|No model selected|No models available/iu.test(
      text,
    )
  )
    code = "MODEL_CONFIGURATION_INVALID";
  else if (
    /RESPONSE_.*(?:INVALID|MISSING)|STREAM_.*(?:MISSING|MISMATCH|TOO_LARGE)|TOOL_CALLS_MISSING|TOOL_.*(?:INVALID|UNSUPPORTED)|INVALID_JSON|unexpected.*(?:JSON|token)|finish_reason|PI_EMPTY_RESPONSE/iu.test(
      text,
    )
  )
    code = "MODEL_RESPONSE_INVALID";
  else if (
    httpStatus === 400 ||
    httpStatus === 422 ||
    /invalid[_ ]request|unsupported[_ ]parameter/iu.test(text)
  )
    code = "MODEL_REQUEST_INVALID";
  else if (
    /NETWORK_ERROR|network_error|ECONN(?:RESET|REFUSED)|ENOTFOUND|EAI_AGAIN|fetch failed|connection error|socket|network/iu.test(
      text,
    )
  )
    code = "MODEL_NETWORK_ERROR";
  else code = "MODEL_PROVIDER_FAILURE";
  const [category, retryable] = failures[code];
  return { code, category, retryable, httpStatus };
}
