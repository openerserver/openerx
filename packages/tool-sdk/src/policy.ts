import { createHash } from "node:crypto";
import {
  BROKERED_BASH_DENY_NETWORK_POLICY_ID,
  type CapabilityScope,
  type ToolOperation,
} from "@openerx/contracts";
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
        approval: "automatic",
      };
    case "structured_data":
      return {
        capability: "builtin.structured_data",
        risk: "L0",
        resourceType: "builtin",
        resource: "structured-data",
        actions: ["execute"],
        reason: "执行确定性结构化数据处理",
        approval: "automatic",
      };
    case "web_search":
      return {
        capability: "web.search",
        risk: "L2",
        resourceType: "domain",
        resource: "search.openerx.platform",
        actions: ["search"],
        reason: `搜索 Web：${operation.query.slice(0, 160)}`,
        approval: "automatic",
      };
    case "image_generate":
      return {
        capability: "image.generate",
        risk: "L2",
        resourceType: "server",
        resource: "image-generation.openerx.platform",
        actions: ["create"],
        reason: `生成图片：${operation.prompt.slice(0, 160)}`,
        approval: "automatic",
      };
    case "shell_execute":
      return {
        capability: "shell",
        risk: operation.workspaceGrantId ? (operation.allowNetwork ? "L4" : "L3") : "L5",
        resourceType: "workspace",
        resource: operation.workspaceGrantId ?? operation.cwd ?? "missing-workspace",
        actions: operation.allowNetwork ? ["execute", "external_write"] : ["execute"],
        reason: `在 ${operation.workspaceGrantId ?? operation.cwd ?? "未知工作区"} 执行 ${operation.command}`,
        approval: operation.workspaceGrantId ? "automatic" : "per_call",
      };
    case "shell_command_execute": {
      const networkDenied = operation.networkPolicyId === BROKERED_BASH_DENY_NETWORK_POLICY_ID;
      const risk = !networkDenied
        ? "L4"
        : operation.executionProfile === "workspace_write"
          ? "L3"
          : "L2";
      return {
        capability: "shell",
        risk,
        resourceType: "workspace",
        resource: operation.activeExecutionGrantId,
        actions: networkDenied ? ["execute"] : ["execute", "external_write"],
        reason: `在已冻结工作区执行 Brokered Bash：${operation.command.slice(0, 500)}`,
        approval:
          operation.executionOrigin === "remote_attended" &&
          operation.executionProfile === "workspace_write"
            ? "per_call"
            : "automatic",
      };
    }
    case "workspace_list":
    case "workspace_search":
    case "workspace_read":
    case "workspace_instructions":
    case "workspace_diff":
    case "workspace_changes":
    case "workspace_change_set_review":
      return {
        capability: "workspace",
        risk: "L0",
        resourceType: "workspace",
        resource: operation.workspaceGrantId,
        actions: [operation.operation === "workspace_search" ? "search" : "read"],
        reason: `读取已授权工作区：${operation.operation}`,
        approval: "automatic",
      };
    case "workspace_apply_patch":
    case "workspace_undo":
    case "workspace_change_set_discard":
      return {
        capability: "workspace",
        risk: "L3",
        resourceType: "workspace",
        resource: operation.workspaceGrantId,
        actions: ["patch"],
        reason: `修改已授权工作区：${operation.operation}`,
        approval: "automatic",
      };
    case "workspace_change_set_apply":
    case "workspace_change_set_undo":
      return {
        capability: "workspace",
        risk: "L3",
        resourceType: "workspace",
        resource: operation.workspaceGrantId,
        actions: ["patch"],
        reason: `应用已审阅的隔离工作区变更：${operation.workspaceChangeSetId}`,
        approval: "per_call",
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
        approval: "automatic",
      };
    case "browser": {
      const action = operation.action;
      const risk =
        action === "submit" || action === "upload"
          ? "L4"
          : action === "download"
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
        approval: action === "submit" || action === "upload" ? "per_call" : "automatic",
      };
    }
    case "browser_computer_use": {
      const request = operation.request;
      const action = request.action;
      const highImpact = action === "submit" || action === "upload" || action === "download";
      const readOnly = action === "observe" || action === "detach";
      return {
        capability: "browser",
        risk: highImpact ? "L4" : readOnly ? "L2" : "L3",
        resourceType: action === "open" ? "domain" : "server",
        resource: action === "open" ? urlResource(request.url) : request.sessionId,
        actions: [
          action === "open"
            ? "navigate"
            : action === "observe"
              ? "capture"
              : action === "detach" || action === "close"
                ? "stop"
                : action === "upload"
                  ? "upload"
                  : action === "download"
                    ? "download"
                    : action === "submit"
                      ? "external_write"
                      : "interact",
        ],
        reason: `系统浏览器 computer-use 操作：${action}`,
        approval: highImpact ? "per_call" : readOnly ? "automatic" : "scope",
      };
    }
    case "desktop": {
      const highImpact = ["submit", "send", "delete", "purchase"].includes(operation.action);
      const target = operation.bundleId
        ? `${operation.application} (${operation.bundleId})`
        : operation.application;
      return {
        capability: "desktop",
        risk: highImpact ? "L5" : operation.action === "screenshot" ? "L2" : "L3",
        resourceType: "application",
        resource: operation.bundleId ?? operation.application,
        actions: [
          operation.action === "screenshot" ? "capture" : highImpact ? "high_impact" : "interact",
        ],
        reason: `控制桌面应用 ${target}：${operation.action}`,
        approval: highImpact ? "per_call" : "scope",
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
              ? operation.annotations.readOnlyHint
                ? "L0"
                : operation.annotations.destructiveHint
                  ? "L5"
                  : "L4"
              : operation.operation === "mcp_disconnect" && operation.clearCredentials
                ? "L4"
                : operation.operation === "mcp_disconnect"
                  ? "L0"
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
        approval:
          operation.operation === "mcp_connect" ||
          (operation.operation === "mcp_call" && !operation.annotations.readOnlyHint) ||
          (operation.operation === "mcp_disconnect" && operation.clearCredentials)
            ? "per_call"
            : "automatic",
      };
    case "skill_read":
      return {
        capability: "skill",
        risk: "L0",
        resourceType: "skill",
        resource: `${operation.installationId}:${operation.relativePath}`,
        actions: ["read"],
        reason: `读取已安装 Skill 资源：${operation.relativePath}`,
        approval: "automatic",
      };
    case "skill_script_execute":
      return {
        capability: "skill",
        risk: "L5",
        resourceType: "skill",
        resource: `${operation.installationId}:${operation.relativePath}`,
        actions: operation.allowNetwork ? ["execute", "external_write"] : ["execute"],
        reason: `执行 Skill 脚本：${operation.relativePath}`,
        approval: "per_call",
      };
    case "memory_search":
    case "memory_list":
      return {
        capability: "builtin.structured_data",
        risk: "L0",
        resourceType: "builtin",
        resource: "personal-memory",
        actions: [operation.operation === "memory_search" ? "search" : "read"],
        reason: "读取用户已启用的长期记忆",
        approval: "automatic",
      };
    case "memory_upsert":
    case "memory_forget":
      return {
        capability: "builtin.structured_data",
        risk: "L1",
        resourceType: "builtin",
        resource: "personal-memory",
        actions: ["create"],
        reason: operation.operation === "memory_upsert" ? "保存长期记忆" : "删除长期记忆",
        approval: "automatic",
      };
  }
}

export function hasUncertainExternalSideEffect(operation: ToolOperation): boolean {
  switch (operation.operation) {
    case "image_generate":
    case "shell_execute":
    case "shell_input":
    case "skill_script_execute":
    case "mcp_connect":
    case "mcp_call":
    case "mcp_disconnect":
      return operation.operation === "mcp_call" ? !operation.annotations.readOnlyHint : true;
    case "shell_command_execute":
      return (
        operation.executionProfile === "workspace_write" ||
        operation.networkPolicyId !== BROKERED_BASH_DENY_NETWORK_POLICY_ID
      );
    case "browser":
      return operation.action !== "screenshot";
    case "browser_computer_use":
      return operation.request.action !== "observe" && operation.request.action !== "detach";
    case "desktop":
      return operation.action !== "screenshot";
    case "compute":
    case "structured_data":
    case "web_search":
    case "shell_status":
    case "shell_stop":
    case "mcp_list_tools":
    case "skill_read":
    case "workspace_list":
    case "workspace_search":
    case "workspace_read":
    case "workspace_instructions":
    case "workspace_diff":
    case "workspace_changes":
    case "workspace_change_set_review":
    case "memory_search":
    case "memory_list":
    case "memory_upsert":
    case "memory_forget":
      return false;
    case "workspace_apply_patch":
    case "workspace_undo":
    case "workspace_change_set_apply":
    case "workspace_change_set_discard":
    case "workspace_change_set_undo":
      return true;
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
        target: operation.workspaceGrantId
          ? `${operation.workspaceGrantId}:${operation.relativeCwd ?? "."}`
          : (operation.cwd ?? "missing-workspace"),
      };
    case "shell_command_execute":
      return {
        input: operation.command.slice(0, 2_000),
        target: `${operation.activeExecutionGrantId} +${operation.additionalExecutionGrantIds.length} (${operation.executionProfile})`,
      };
    case "workspace_list":
    case "workspace_search":
    case "workspace_read":
    case "workspace_instructions":
      return {
        input: operation.operation === "workspace_search" ? operation.query : operation.operation,
        target: `${operation.workspaceGrantId}:${operation.relativePath}`,
      };
    case "workspace_apply_patch":
      return {
        input: `${operation.replacements.length} replacements`,
        target: `${operation.workspaceGrantId}:${operation.relativePath}`,
      };
    case "workspace_diff":
    case "workspace_undo":
      return { input: operation.operation, target: operation.workspaceChangeId };
    case "workspace_changes":
      return { input: `last ${operation.limit} changes`, target: operation.workspaceGrantId };
    case "workspace_change_set_review":
    case "workspace_change_set_apply":
    case "workspace_change_set_discard":
    case "workspace_change_set_undo":
      return { input: operation.operation, target: operation.workspaceChangeSetId };
    case "shell_status":
    case "shell_input":
    case "shell_stop":
      return { input: operation.operation, target: operation.processId };
    case "browser":
      return {
        input: `${operation.action}${operation.selector ? ` ${operation.selector}` : ""}`,
        target: operation.url ?? operation.sessionId ?? "new-session",
      };
    case "browser_computer_use":
      return {
        input: `${operation.request.contractVersion}:${operation.request.action}`,
        target:
          operation.request.action === "open" ? operation.request.url : operation.request.sessionId,
      };
    case "desktop":
      return {
        input:
          operation.x === undefined || operation.y === undefined
            ? operation.action === "type"
              ? `type ${operation.text?.length ?? 0} chars`
              : operation.action === "key"
                ? `key ${operation.key ?? "missing"}`
                : operation.action
            : `${operation.action} (${operation.x}, ${operation.y}) capture=${operation.captureId ?? "missing"}`,
        target: operation.bundleId
          ? `${operation.application} (${operation.bundleId})`
          : operation.application,
      };
    case "mcp_connect":
    case "mcp_list_tools":
    case "mcp_disconnect":
      return { input: operation.operation, target: operation.serverId };
    case "mcp_call":
      return { input: operation.tool, target: operation.serverId };
    case "skill_read":
      return { input: "read", target: `${operation.installationId}:${operation.relativePath}` };
    case "skill_script_execute":
      return {
        input: operation.args.join(" ").slice(0, 2_000),
        target: `${operation.installationId}:${operation.relativePath}`,
      };
    case "memory_search":
      return { input: operation.query, target: "personal-memory" };
    case "memory_list":
      return { input: operation.kind ?? "all", target: "personal-memory" };
    case "memory_upsert":
      return { input: operation.content.slice(0, 2_000), target: operation.kind };
    case "memory_forget":
      return { input: "forget", target: operation.memoryId };
  }
}
