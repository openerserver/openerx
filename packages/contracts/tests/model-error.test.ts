import { describe, expect, it } from "vitest";
import { classifyModelError, modelFailureMessage, modelFailureSchema } from "../src";

describe("safe model error classification", () => {
  it.each([
    ["DEEPSEEK_API_ERROR:401:invalid_api_key:secret", "MODEL_AUTHENTICATION_FAILED", false],
    ["403 permission denied", "MODEL_PERMISSION_DENIED", false],
    ["429 insufficient_quota", "MODEL_QUOTA_EXCEEDED", false],
    ["HTTP 429 too many requests", "MODEL_RATE_LIMITED", true],
    ["DEEPSEEK_REQUEST_TIMEOUT", "MODEL_REQUEST_TIMEOUT", true],
    ["PLATFORM_HTTP_503", "MODEL_SERVER_ERROR", true],
    ["DEEPSEEK_API_ERROR:400:context_length_exceeded", "MODEL_CONTEXT_LIMIT_REACHED", false],
    ["MODEL_OUTPUT_LIMIT_REACHED", "MODEL_OUTPUT_LIMIT_REACHED", false],
    ["MODEL_STREAM_TERMINAL_EVENT_MISSING", "MODEL_RESPONSE_INVALID", false],
    ["DEEPSEEK_RESPONSE_INVALID_JSON:200", "MODEL_RESPONSE_INVALID", false],
    ["Provider finish_reason: content_filter", "MODEL_CONTENT_FILTERED", false],
    ["404 model_not_found", "MODEL_NOT_FOUND", false],
    ["422 invalid_request", "MODEL_REQUEST_INVALID", false],
    ["fetch failed ECONNRESET", "MODEL_NETWORK_ERROR", true],
    ["BYOK_REDIRECT_FORBIDDEN", "MODEL_CONFIGURATION_INVALID", false],
    ["unknown provider failure", "MODEL_PROVIDER_FAILURE", false],
  ])("classifies %s without returning provider text", (error, code, retryable) => {
    const failure = classifyModelError(error);
    expect(failure).toMatchObject({ code, retryable });
    expect(modelFailureSchema.safeParse(failure).success).toBe(true);
    expect(modelFailureMessage(failure.code)).toBeTruthy();
    expect(JSON.stringify(failure)).not.toContain("secret");
  });

  it("keeps user cancellation distinct from timeouts and recognizes structured HTTP errors", () => {
    expect(classifyModelError(new Error("timeout"), { cancelled: true })).toMatchObject({
      category: "cancelled",
      retryable: false,
    });
    expect(
      classifyModelError({ status: 401, message: "unrecognized localized error" }),
    ).toMatchObject({ code: "MODEL_AUTHENTICATION_FAILED", httpStatus: 401 });
    expect(classifyModelError("invalid_json", { httpStatus: 502 })).toMatchObject({
      code: "MODEL_SERVER_ERROR",
      httpStatus: 502,
    });
    expect(modelFailureMessage("toString")).toBeUndefined();
    expect(
      classifyModelError({ code: "MODEL_CAPABILITY_UNSUPPORTED", message: "fixture" }).code,
    ).toBe("MODEL_CAPABILITY_UNSUPPORTED");
    expect(
      classifyModelError(new DOMException("The operation was aborted", "AbortError")).category,
    ).toBe("cancelled");
  });
});
