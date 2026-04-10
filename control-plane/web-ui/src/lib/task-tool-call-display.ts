export interface ToolCallDisplayItem {
  kind: string;
  label: string;
  stateLabel: string;
  headline?: string;
  description?: string;
  command?: string;
  filePath?: string;
  inputPreview?: string;
  outputPreview?: string;
}

export interface ToolCallSummaryView {
  primary: string;
  secondary?: string;
  status?: string;
}

type ToolCallActionDefinition = {
  key: string;
  label: string;
  unit: string;
  weight: number;
  preferDistinctFiles?: boolean;
};

type ToolCallActionBucket = ToolCallActionDefinition & {
  count: number;
  filePaths: Set<string>;
  commandSamples: string[];
  labelSamples: string[];
};

const FILE_ACTION_DEFINITIONS: Record<string, ToolCallActionDefinition> = {
  read: {
    key: "read",
    label: "读取",
    unit: "个文件",
    weight: 10,
    preferDistinctFiles: true,
  },
  read_file: {
    key: "read",
    label: "读取",
    unit: "个文件",
    weight: 10,
    preferDistinctFiles: true,
  },
  create_file: {
    key: "create",
    label: "创建",
    unit: "个文件",
    weight: 20,
    preferDistinctFiles: true,
  },
  write: {
    key: "write",
    label: "写入",
    unit: "个文件",
    weight: 25,
    preferDistinctFiles: true,
  },
  apply_patch: {
    key: "edit",
    label: "修改",
    unit: "个文件",
    weight: 30,
    preferDistinctFiles: true,
  },
  str_replace: {
    key: "edit",
    label: "修改",
    unit: "个文件",
    weight: 30,
    preferDistinctFiles: true,
  },
  insert: {
    key: "edit",
    label: "修改",
    unit: "个文件",
    weight: 30,
    preferDistinctFiles: true,
  },
  delete: {
    key: "delete",
    label: "删除",
    unit: "个文件",
    weight: 40,
    preferDistinctFiles: true,
  },
};

const SEARCH_TOOL_KINDS = new Set([
  "file_search",
  "grep_search",
  "semantic_search",
  "find_text",
  "search_code",
  "github_repo",
  "fetch_webpage",
  "vscode_listcodeusages",
]);

const COMMAND_TOOL_KINDS = new Set(["bash", "run_in_terminal", "run_task", "create_and_run_task"]);

const BROWSER_TOOL_KINDS = new Set([
  "open_browser_page",
  "navigate_page",
  "read_page",
  "click_element",
  "type_in_page",
  "hover_element",
  "drag_element",
  "handle_dialog",
  "run_playwright_code",
  "screenshot_page",
]);

const STATUS_PRIORITY = ["失败", "执行中", "待执行", "处理中", "完成"];

function normalizeToolKind(kind: string | undefined) {
  return (kind || "tool").trim().toLowerCase();
}

function uniquePush(target: string[], value: string | undefined) {
  const nextValue = value?.trim();
  if (!nextValue || target.includes(nextValue)) {
    return;
  }
  target.push(nextValue);
}

function compactText(value: string | undefined, maxLength = 56) {
  const text = value?.replace(/\s+/g, " ").trim();
  if (!text) {
    return undefined;
  }
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength - 1)}...`;
}

function compactWorkspacePath(path: string) {
  const segments = path.split("/").filter(Boolean);
  if (segments.length <= 2) {
    return path;
  }
  return segments.slice(-2).join("/");
}

function baseName(path: string | undefined) {
  const value = path?.trim();
  if (!value) {
    return undefined;
  }

  const segments = value.split("/").filter(Boolean);
  return segments[segments.length - 1] || value;
}

function parseToolInputPreview(inputPreview?: string) {
  const fields = new Map<string, string>();
  if (!inputPreview) {
    return fields;
  }

  const lines = inputPreview
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  for (const line of lines) {
    const separatorIndex = line.indexOf(":");
    if (separatorIndex <= 0) {
      continue;
    }
    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim();
    if (!key || !value || fields.has(key)) {
      continue;
    }
    fields.set(key, value);
  }

  return fields;
}

function resolveToolRangeLabel(tool: ToolCallDisplayItem) {
  const fields = parseToolInputPreview(tool.inputPreview);
  const range = fields.get("range");
  if (range) {
    const [startLine, endLine] = range.split("-").map((value) => value.trim());
    if (startLine && endLine) {
      return `行 ${startLine} 到 ${endLine}`;
    }
  }

  const startLine = fields.get("startLine");
  const endLine = fields.get("endLine");
  if (startLine && endLine) {
    return `行 ${startLine} 到 ${endLine}`;
  }
  if (startLine) {
    return `起始行 ${startLine}`;
  }
  if (endLine) {
    return `结束行 ${endLine}`;
  }

  return undefined;
}

function hasSearchNoResult(tool: ToolCallDisplayItem) {
  const output = tool.outputPreview?.trim();
  if (!output) {
    return tool.stateLabel === "完成";
  }

  return /(^|\b)(no results|no matches|0 matches|not found|empty result|无结果|未找到)(\b|$)/iu.test(
    output,
  );
}

function resolveActionTarget(tool: ToolCallDisplayItem) {
  const fields = parseToolInputPreview(tool.inputPreview);
  const path = fields.get("path") ?? tool.filePath;
  return baseName(path) ?? compactText(tool.headline || tool.description || tool.label, 72);
}

function resolveActionDefinition(tool: ToolCallDisplayItem): ToolCallActionDefinition {
  const kind = normalizeToolKind(tool.kind);
  const fileDefinition = FILE_ACTION_DEFINITIONS[kind];
  if (fileDefinition) {
    return fileDefinition;
  }

  if (SEARCH_TOOL_KINDS.has(kind)) {
    return {
      key: "search",
      label: "搜索",
      unit: "次",
      weight: 50,
    };
  }

  if (COMMAND_TOOL_KINDS.has(kind)) {
    return {
      key: "command",
      label: "执行",
      unit: "条命令",
      weight: 60,
    };
  }

  if (BROWSER_TOOL_KINDS.has(kind)) {
    return {
      key: "browser",
      label: "浏览器操作",
      unit: "次",
      weight: 70,
    };
  }

  return {
    key: "tool",
    label: "调用",
    unit: "个工具",
    weight: 80,
  };
}

function createActionBucket(definition: ToolCallActionDefinition): ToolCallActionBucket {
  return {
    ...definition,
    count: 0,
    filePaths: new Set<string>(),
    commandSamples: [],
    labelSamples: [],
  };
}

function bucketCount(bucket: ToolCallActionBucket) {
  if (bucket.preferDistinctFiles && bucket.filePaths.size > 0) {
    return bucket.filePaths.size;
  }
  return bucket.count;
}

function formatBucketLabel(bucket: ToolCallActionBucket) {
  const count = bucketCount(bucket);
  if (bucket.key === "command") {
    if (bucket.commandSamples.length === 1 && count === 1) {
      return `执行 ${bucket.commandSamples[0]}`;
    }
    return `执行 ${count} 条命令`;
  }

  if (bucket.key === "tool") {
    if (bucket.labelSamples.length === 1 && count === 1) {
      return `调用 ${bucket.labelSamples[0]}`;
    }
    return `调用 ${count} 个工具`;
  }

  return `${bucket.label} ${count} ${bucket.unit}`;
}

function buildStatusSummary(toolCalls: ToolCallDisplayItem[]) {
  const counts = new Map<string, number>();
  for (const tool of toolCalls) {
    const label = tool.stateLabel?.trim();
    if (!label) {
      continue;
    }
    counts.set(label, (counts.get(label) || 0) + 1);
  }

  if (counts.size === 0) {
    return undefined;
  }

  const nonComplete = Array.from(counts.entries()).filter(([label]) => label !== "完成");
  if (nonComplete.length === 0 && counts.size === 1) {
    return undefined;
  }

  const entries = (nonComplete.length > 0 ? nonComplete : Array.from(counts.entries())).sort(
    ([leftLabel], [rightLabel]) => {
      const leftIndex = STATUS_PRIORITY.indexOf(leftLabel);
      const rightIndex = STATUS_PRIORITY.indexOf(rightLabel);
      const normalizedLeft = leftIndex >= 0 ? leftIndex : STATUS_PRIORITY.length;
      const normalizedRight = rightIndex >= 0 ? rightIndex : STATUS_PRIORITY.length;
      return normalizedLeft - normalizedRight || leftLabel.localeCompare(rightLabel, "zh-CN");
    },
  );

  return entries.map(([label, count]) => `${count} ${label}`).join(" · ");
}

function buildSecondarySummary(toolCalls: ToolCallDisplayItem[]) {
  const fileSamples = toolCalls
    .map((tool) => tool.filePath?.trim())
    .filter((value): value is string => Boolean(value));

  if (fileSamples.length > 0) {
    const uniquePaths = Array.from(new Set(fileSamples));
    const visible = uniquePaths.slice(0, 2).map(compactWorkspacePath);
    if (uniquePaths.length <= 2) {
      return `涉及 ${visible.join("、")}`;
    }
    return `涉及 ${visible.join("、")} 等 ${uniquePaths.length} 个文件`;
  }

  if (toolCalls.length === 1) {
    const tool = toolCalls[0];
    const detail = compactText(toolHeadlineText(tool) || tool.description || tool.label, 72);
    if (detail && detail !== tool.label) {
      return detail;
    }
  }

  return undefined;
}

export function summarizeToolCalls(toolCalls: ToolCallDisplayItem[]): ToolCallSummaryView {
  if (toolCalls.length === 0) {
    return {
      primary: "暂无工具调用",
    };
  }

  const actionBuckets = new Map<string, ToolCallActionBucket>();
  for (const tool of toolCalls) {
    const definition = resolveActionDefinition(tool);
    const bucket = actionBuckets.get(definition.key) || createActionBucket(definition);
    bucket.count += 1;
    if (tool.filePath) {
      bucket.filePaths.add(tool.filePath);
    }
    uniquePush(bucket.commandSamples, compactText(tool.command || tool.headline, 48));
    uniquePush(bucket.labelSamples, compactText(tool.label, 32));
    actionBuckets.set(bucket.key, bucket);
  }

  const primary = Array.from(actionBuckets.values())
    .sort((left, right) => left.weight - right.weight || left.label.localeCompare(right.label, "zh-CN"))
    .slice(0, 3)
    .map((bucket) => formatBucketLabel(bucket))
    .join(" · ");

  return {
    primary,
    secondary: buildSecondarySummary(toolCalls),
    status: buildStatusSummary(toolCalls),
  };
}

export function toolHeadlineText(tool: ToolCallDisplayItem) {
  const text = tool.headline || tool.description;
  if (!text) {
    return undefined;
  }

  if (tool.filePath && text.trim() === tool.filePath.trim()) {
    return undefined;
  }

  if (text.trim() === tool.label.trim()) {
    return undefined;
  }

  return text;
}

export function buildToolActionLabel(tool: ToolCallDisplayItem) {
  const kind = normalizeToolKind(tool.kind);
  const fields = parseToolInputPreview(tool.inputPreview);

  if (FILE_ACTION_DEFINITIONS[kind]?.key === "read") {
    const target = resolveActionTarget(tool) ?? "文件";
    const range = resolveToolRangeLabel(tool);
    return range ? `读取 ${target}，${range}` : `读取 ${target}`;
  }

  if (FILE_ACTION_DEFINITIONS[kind]?.key === "edit") {
    return `修改 ${resolveActionTarget(tool) ?? "文件"}`;
  }

  if (FILE_ACTION_DEFINITIONS[kind]?.key === "create") {
    return `创建 ${resolveActionTarget(tool) ?? "文件"}`;
  }

  if (FILE_ACTION_DEFINITIONS[kind]?.key === "write") {
    return `写入 ${resolveActionTarget(tool) ?? "文件"}`;
  }

  if (FILE_ACTION_DEFINITIONS[kind]?.key === "delete") {
    return `删除 ${resolveActionTarget(tool) ?? "文件"}`;
  }

  if (SEARCH_TOOL_KINDS.has(kind)) {
    const query = compactText(fields.get("query") ?? tool.headline ?? tool.description ?? tool.label, 72) ?? tool.label;
    const includePattern = compactText(fields.get("includePattern") ?? fields.get("path"), 72);
    const scope = includePattern ? `（${includePattern}）` : "";
    const resultSuffix = hasSearchNoResult(tool) ? "，无结果" : "";
    return `搜索文本 ${query}${scope}${resultSuffix}`;
  }

  if (COMMAND_TOOL_KINDS.has(kind)) {
    return `执行 ${compactText(tool.command ?? tool.headline ?? tool.label, 96) ?? tool.label}`;
  }

  if (BROWSER_TOOL_KINDS.has(kind)) {
    return `浏览器操作 ${compactText(tool.headline ?? tool.description ?? tool.label, 72) ?? tool.label}`;
  }

  return compactText(toolCallText(tool) ?? tool.label, 96) ?? tool.label;
}

export function toolCallText(tool: ToolCallDisplayItem) {
  return tool.command || toolHeadlineText(tool) || tool.description;
}

export function toolInputText(tool: ToolCallDisplayItem) {
  const input = tool.inputPreview?.trim();
  if (!input) {
    return undefined;
  }

  const callText = toolCallText(tool)?.trim();
  if (callText && input === callText) {
    return undefined;
  }

  return input;
}

function summarizeStructuredToolOutput(value: unknown): string[] {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return [];
    }
    if (!/^[\[{]/u.test(trimmed)) {
      return [trimmed];
    }

    try {
      return summarizeStructuredToolOutput(JSON.parse(trimmed));
    } catch {
      return [trimmed];
    }
  }

  if (Array.isArray(value)) {
    return value.flatMap((entry) => summarizeStructuredToolOutput(entry));
  }

  if (!value || typeof value !== "object") {
    return [];
  }

  const record = value as Record<string, unknown>;
  const directText = [record.text, record.content, record.stdout, record.stderr]
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter(Boolean);
  if (directText.length > 0) {
    return directText;
  }

  if (Array.isArray(record.content)) {
    const contentText = summarizeStructuredToolOutput(record.content);
    if (contentText.length > 0) {
      return contentText;
    }
  }

  if (Array.isArray(record.entries)) {
    const entryText = summarizeStructuredToolOutput(record.entries);
    if (entryText.length > 0) {
      return entryText;
    }
  }

  if (record.details && typeof record.details === "object") {
    return summarizeStructuredToolOutput(record.details);
  }

  return [];
}

export function toolOutputText(tool: ToolCallDisplayItem) {
  const output = tool.outputPreview?.trim();
  if (!output) {
    return undefined;
  }

  const normalized = summarizeStructuredToolOutput(output)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .join("\n\n");
  return normalized || output;
}

export function toolDetailText(tool: ToolCallDisplayItem) {
  return [toolCallText(tool), toolInputText(tool), toolOutputText(tool)]
    .filter(Boolean)
    .join("\n\n");
}

export function buildToolCopyText(tool: ToolCallDisplayItem) {
  return [
    `工具: ${tool.label}`,
    `状态: ${tool.stateLabel}`,
    tool.filePath ? `路径: ${tool.filePath}` : null,
    toolCallText(tool) ? `调用: ${toolCallText(tool)}` : null,
    toolInputText(tool) ? `参数:\n${toolInputText(tool)}` : null,
    toolOutputText(tool) ? `输出:\n${toolOutputText(tool)}` : null,
  ]
    .filter((item): item is string => Boolean(item))
    .join("\n");
}