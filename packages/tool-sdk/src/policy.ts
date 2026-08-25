import { createHash } from "node:crypto";
import type { CapabilityScope, ToolOperation } from "@openerx/contracts";
import { riskAtMost } from "@openerx/domain";
import type { CapabilityRequirement } from "./types";

function urlResource(value: string | undefined): string {
  if (!value) return "about:blank";
  try {
    const url = new URL(value);
    if (url.protocol === "file:") return url.pathname;
    return url.hostname.toLowerCase();
  } catch {
    return value;
  }
}

export function capabilityRequirement(operation: ToolOperation): CapabilityRequirement {
  switch (operation.operation) {
    case "compute":
      return {
        capability: "builtin.compute",
        risk: "L0",
        resourceType: "builtin",
        resource: "calculator",
        actions: ["execute"],
        reason: "执行确定性本地计算",
        forcePerCallApproval: false,
      };
    case "structured_data":
      return {
        capability: "builtin.structured_data",
        risk: "L0",
        resourceType: "builtin",
        resource: "structured-data",
        actions: ["execute"],
        reason: "执行确定性结构化数据处理",
        forcePerCallApproval: false,
      };
    case "web_search":
      return {
        capability: "web.search",
        risk: "L2",
        resourceType: "domain",
        resource: "search.openerx.platform",
        actions: ["search"],
        reason: `搜索 Web：${operation.query.slice(0, 160)}`,
        forcePerCallApproval: false,
      };
    case "image_generate":
      return {
        capability: "web.search",
        risk: "L2",
        resourceType: "server",
        resource: "image-generation.openerx.platform",
        actions: ["create"],
        reason: `生成图片：${operation.prompt.slice(0, 160)}`,
        forcePerCallApproval: false,
      };
    case "shell_execute":
      return {
        capability: "shell",
        risk: "L5",
        resourceType: "workspace",
        resource: operation.cwd,
        actions: operation.allowNetwork ? ["execute", "external_write"] : ["execute"],
        reason: `在 ${operation.cwd} 执行 ${operation.command}`,
        forcePerCallApproval: true,
      };
    case "shell_status":
    case "shell_input":
    case "shell_stop":
      return {
        capability: "shell",
        risk: "L0",
        resourceType: "workspace",
        resource: operation.processId,
        actions: [
          operation.operation === "shell_status"
            ? "read"
            : operation.operation === "shell_input"
              ? "input"
              : "stop",
        ],
        reason: `管理 Shell 进程 ${operation.processId}`,
        forcePerCallApproval: false,
      };
    case "browser": {
      const action = operation.action;
      const risk =
        action === "submit"
          ? "L4"
          : action === "upload" || action === "download"
            ? "L3"
            : action === "close"
              ? "L0"
              : "L2";
      return {
        capability: "browser",
        risk,
        resourceType:
          action === "open" || action === "navigate"
            ? "domain"
            : action === "upload"
              ? "path"
              : "server",
        resource:
          action === "open" || action === "navigate"
            ? urlResource(operation.url)
            : action === "upload"
              ? (operation.fileId ?? "missing-file-id")
              : (operation.sessionId ?? "new-session"),
        actions: [
          action === "open" || action === "navigate"
            ? "navigate"
            : action === "screenshot"
              ? "capture"
              : action === "upload"
                ? "upload"
                : action === "download"
                  ? "download"
                  : action === "submit"
                    ? "external_write"
                    : "interact",
        ],
        reason: `隔离浏览器操作：${action}`,
        forcePerCallApproval: action === "submit",
      };
    }
    case "desktop": {
      const highImpact = ["submit", "send", "delete", "purchase"].includes(operation.action);
      return {
        capability: "desktop",
        risk: highImpact ? "L5" : operation.action === "screenshot" ? "L2" : "L5",
        resourceType: "application",
        resource: operation.application,
        actions: [
          operation.action === "screenshot" ? "capture" : highImpact ? "high_impact" : "interact",
        ],
        reason: `控制桌面应用 ${operation.application}：${operation.action}`,
        forcePerCallApproval: highImpact || operation.action !== "screenshot",
      };
    }
    case "mcp_connect":
    case "mcp_list_tools":
    case "mcp_call":
    case "mcp_disconnect":
      return {
        capability: "mcp",
        risk:
          operation.operation === "mcp_connect"
            ? "L5"
            : operation.operation === "mcp_call"
              ? "L4"
              : operation.operation === "mcp_disconnect"
                ? "L3"
                : "L2",
        resourceType: "server",
        resource: operation.serverId,
        actions: [
          operation.operation === "mcp_call"
            ? "invoke"
            : operation.operation === "mcp_disconnect"
              ? "stop"
              : "connect",
        ],
        reason: `MCP 操作：${operation.operation}`,
        forcePerCallApproval:
          operation.operation === "mcp_connect" || operation.operation === "mcp_call",
      };
  }
}

export function scopeAllows(scope: CapabilityScope, requirement: CapabilityRequirement): boolean {
  if (scope.revokedAt) return false;
  if (scope.expiresAt && Date.parse(scope.expiresAt) <= Date.now()) return false;
  if (scope.capability !== requirement.capability) return false;
  if (scope.resourceType !== requirement.resourceType || scope.resource !== requirement.resource)
    return false;
  if (!riskAtMost(requirement.risk, scope.maxRisk)) return false;
  return requirement.actions.every((action) => scope.actions.includes(action));
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function operationDigest(operation: ToolOperation): string {
  return createHash("sha256").update(canonical(operation)).digest("hex");
}

export function summarizeOperation(operation: ToolOperation): { input: string; target: string } {
  switch (operation.operation) {
    case "compute":
      return { input: operation.expression.slice(0, 500), target: "calculator" };
    case "structured_data":
      return {
        input: `${operation.action} ${operation.rows.length} rows`,
        target: operation.fields.join(", "),
      };
    case "web_search":
      return { input: operation.query, target: operation.domains?.join(", ") ?? "Web" };
    case "image_generate":
      return {
        input: operation.prompt.slice(0, 2_000),
        target: `${operation.aspectRatio} · ${operation.count} 张`,
      };
    case "shell_execute":
      return {
        input: [operation.command, ...operation.args].join(" ").slice(0, 2_000),
        target: operation.cwd,
      };
    case "shell_status":
    case "shell_input":
    case "shell_stop":
      return { input: operation.operation, target: operation.processId };
    case "browser":
      return {
        input: `${operation.action}${operation.selector ? ` ${operation.selector}` : ""}`,
        target: operation.url ?? operation.sessionId ?? "new-session",
      };
    case "desktop":
      return { input: operation.action, target: operation.application };
    case "mcp_connect":
    case "mcp_list_tools":
    case "mcp_disconnect":
      return { input: operation.operation, target: operation.serverId };
    case "mcp_call":
      return { input: operation.tool, target: operation.serverId };
  }
}
