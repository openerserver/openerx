import { Button, Space, Typography, message, notification } from "ant-design-vue";
import { h } from "vue";
import type { Router } from "vue-router";
import { type ApiError, toApiError } from "./api";
import {
  buildRuntimeRecoveryNoticeModel,
  type RuntimeRecoveryNoticeContext,
} from "./runtime-recovery-notice";
import { RUNTIME_RECOVERY_ERROR_PREFIX } from "./runtime-recovery-contract";

type RuntimeRecoveryOptions = {
  title?: string;
  context?: RuntimeRecoveryNoticeContext;
  router?: Router;
  onAfterClose?: () => void;
};

function formatDiagnostics(error: ApiError) {
  const diagnostics = error.diagnostics || {};
  const pairs = [
    ["错误代码", error.code],
    ["Provider", diagnostics.providerId],
    ["模型", diagnostics.modelId],
    ["地址", diagnostics.baseURL],
    ["配置来源", diagnostics.source],
    ["配置文件", diagnostics.configPath],
  ].filter((entry): entry is [string, unknown] => Boolean(entry[1]));

  if (pairs.length === 0) {
    return null;
  }

  return h(
    "div",
    {
      style: {
        marginTop: "12px",
        padding: "10px 12px",
        background: "#faf7f2",
        border: "1px solid #e9dcc7",
        borderRadius: "10px",
      },
    },
    pairs.map(([label, value]) =>
      h(
        "div",
        { style: { fontSize: "12px", lineHeight: 1.6, color: "#6b5a45" } },
        [h("strong", { style: { color: "#3e3328", marginRight: "6px" } }, `${label}:`), String(value)],
      ),
    ),
  );
}

function copyDiagnostics(error: ApiError) {
  const payload = JSON.stringify(
    {
      message: error.message,
      code: error.code,
      status: error.status,
      diagnostics: error.diagnostics,
      recoverySuggestions: error.recoverySuggestions,
    },
    null,
    2,
  );

  return navigator.clipboard.writeText(payload).then(() => {
    message.success("诊断信息已复制");
  });
}

export function showRuntimeRecoveryNotice(error: unknown, options: RuntimeRecoveryOptions = {}) {
  const apiError = toApiError(error);
  if (!apiError || !apiError.code?.startsWith(RUNTIME_RECOVERY_ERROR_PREFIX)) {
    return false;
  }

  const key = `runtime-recovery-${Date.now()}`;
  const noticeModel = buildRuntimeRecoveryNoticeModel(apiError, {
    context: options.context,
    title: options.title,
  });
  const suggestions = noticeModel.suggestions;
  const diagnostics = formatDiagnostics(apiError);

  notification.error({
    key,
    message: noticeModel.title,
    duration: 0,
    placement: "topRight",
    description: h("div", { style: { paddingRight: "4px" } }, [
      h(Typography.Text, { style: { display: "block", whiteSpace: "pre-wrap", color: "#4b3f34" } }, () => apiError.message),
      suggestions.length
        ? h(
            "div",
            { style: { marginTop: "12px" } },
            suggestions.map((item) =>
              h(
                "div",
                { style: { fontSize: "12px", lineHeight: 1.6, color: "#6b5a45", marginBottom: "6px" } },
                [
                  h("div", `• ${item.title}`),
                  item.detail
                    ? h("div", { style: { paddingLeft: "12px", color: "#8a775f" } }, item.detail)
                    : null,
                  item.command
                    ? h("div", { style: { paddingLeft: "12px", color: "#8a775f", fontFamily: "monospace" } }, item.command)
                    : null,
                ],
              ),
            ),
          )
        : null,
      diagnostics,
      h(
        Space,
        { style: { marginTop: "14px" } },
        {
          default: () => [
            h(
              Button,
              {
                type: "primary",
                size: "small",
                onClick: () => {
                  notification.close(key);
                  const target = noticeModel.target;
                  if (options.router) {
                    void options.router.push(target);
                  } else {
                    const query = new URLSearchParams(
                      Object.entries(target.query).reduce<Record<string, string>>((acc, [queryKey, value]) => {
                        if (typeof value === "string") {
                          acc[queryKey] = value;
                        }
                        return acc;
                      }, {}),
                    ).toString();
                    window.location.href = `${target.path}${query ? `?${query}` : ""}`;
                  }
                  options.onAfterClose?.();
                },
              },
              { default: () => "去模型设置" },
            ),
            h(
              Button,
              {
                size: "small",
                onClick: () => {
                  void copyDiagnostics(apiError);
                },
              },
              { default: () => "复制诊断" },
            ),
          ],
        },
      ),
    ]),
  });

  return true;
}