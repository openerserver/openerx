import { describe, expect, it } from "vitest";
import {
  normalizeRecoverySuggestion,
  normalizeRecoverySuggestions,
  RECOVERY_SUGGESTION_KINDS,
} from "./recovery-suggestions";

describe("normalizeRecoverySuggestion", () => {
  it("converts legacy string suggestions into structured objects", () => {
    expect(normalizeRecoverySuggestion("检查模型服务", 2)).toEqual({
      id: "legacy-2",
      kind: RECOVERY_SUGGESTION_KINDS.check,
      title: "检查模型服务",
    });
  });

  it("keeps structured suggestions intact", () => {
    expect(
      normalizeRecoverySuggestion({
        id: "verify-provider",
        kind: RECOVERY_SUGGESTION_KINDS.config,
        title: "核对 Provider 配置",
        detail: "检查 baseURL",
      }),
    ).toEqual({
      id: "verify-provider",
      kind: RECOVERY_SUGGESTION_KINDS.config,
      title: "核对 Provider 配置",
      detail: "检查 baseURL",
    });
  });
});

describe("normalizeRecoverySuggestions", () => {
  it("filters invalid values and normalizes mixed suggestion arrays", () => {
    expect(
      normalizeRecoverySuggestions([
        "先检查服务",
        {
          id: "run-auth-login",
          kind: RECOVERY_SUGGESTION_KINDS.command,
          title: "重新登录",
          command: "opencode auth login",
        },
        "",
      ]),
    ).toEqual([
      {
        id: "legacy-0",
        kind: RECOVERY_SUGGESTION_KINDS.check,
        title: "先检查服务",
      },
      {
        id: "run-auth-login",
        kind: RECOVERY_SUGGESTION_KINDS.command,
        title: "重新登录",
        command: "opencode auth login",
      },
    ]);
  });
});