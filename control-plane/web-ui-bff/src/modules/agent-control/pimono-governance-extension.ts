import path from "node:path";

type ToolCallEvent = {
  toolCallId: string;
  toolName: string;
  input: Record<string, unknown>;
};

type ToolCallResult = {
  block?: boolean;
  reason?: string;
};

type ExtensionContext = {
  ui: {
    confirm(title: string, message: string): Promise<boolean>;
  };
};

type ExtensionApi = {
  on(
    event: "tool_call",
    handler: (
      event: ToolCallEvent,
      ctx: ExtensionContext,
    ) => Promise<ToolCallResult | void> | ToolCallResult | void,
  ): void;
};

type GovernancePermissionPayload = {
  permission: "external_directory" | "command_execution";
  filepath?: string;
  parentDir?: string;
  patterns?: string[];
  command?: string;
  toolName: string;
  toolCallId: string;
};

const OPENERX_PI_MONO_PERMISSION_PREFIX = "openerx-permission:";
const PROTECTED_WRITE_SEGMENTS = new Set([".git", "node_modules"]);
const PROTECTED_WRITE_BASENAME = /^\.env(\..+)?$/i;
const FILE_TOOLS = new Set(["read", "edit", "write", "grep", "find", "ls"]);
const DANGEROUS_BASH_PATTERNS = [
  /(^|\s)sudo(\s|$)/,
  /(^|\s)rm\s+-rf(\s|$)/,
  /(^|\s)(mkfs|shutdown|reboot|launchctl|diskutil)(\s|$)/,
  /(^|\s)chmod\s+-R(\s|$)/,
  /(^|\s)chown\s+-R(\s|$)/,
];

function parseAllowedRoots() {
  const raw = process.env.OPENERX_PI_MONO_ALLOWED_ROOTS?.trim();
  if (!raw) {
    return [path.resolve(process.cwd())];
  }

  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.every((entry) => typeof entry === "string")) {
      return parsed.map((entry) => path.resolve(entry));
    }
  } catch {
    // Fall back to current cwd below.
  }

  return [path.resolve(process.cwd())];
}

function normalizeCandidatePath(value: string) {
  return path.resolve(value);
}

function isWithinAllowedRoots(candidatePath: string, allowedRoots: string[]) {
  return allowedRoots.some(
    (allowedRoot) =>
      candidatePath === allowedRoot || candidatePath.startsWith(`${allowedRoot}${path.sep}`),
  );
}

function isProtectedWritePath(candidatePath: string) {
  const normalizedPath = normalizeCandidatePath(candidatePath);
  const basename = path.basename(normalizedPath);
  if (PROTECTED_WRITE_BASENAME.test(basename)) {
    return true;
  }

  return normalizedPath
    .split(path.sep)
    .some((segment) => PROTECTED_WRITE_SEGMENTS.has(segment));
}

function readStringValue(record: Record<string, unknown>, key: string) {
  const value = record[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function readStringArrayValue(record: Record<string, unknown>, key: string) {
  const value = record[key];
  if (!Array.isArray(value)) {
    return [] as string[];
  }

  return value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0);
}

function collectToolPaths(input: Record<string, unknown>) {
  const paths = new Set<string>();
  const directKeys = ["path", "file_path", "filePath", "directory", "dir", "targetPath"];
  for (const key of directKeys) {
    const value = readStringValue(input, key);
    if (value) {
      paths.add(normalizeCandidatePath(value));
    }
  }

  const arrayKeys = ["paths"];
  for (const key of arrayKeys) {
    for (const value of readStringArrayValue(input, key)) {
      paths.add(normalizeCandidatePath(value));
    }
  }

  return Array.from(paths);
}

function serializePermissionPayload(payload: GovernancePermissionPayload) {
  return `${OPENERX_PI_MONO_PERMISSION_PREFIX}${JSON.stringify(payload)}`;
}

async function requestExternalDirectoryApproval(
  event: ToolCallEvent,
  ctx: ExtensionContext,
  filepath: string,
) {
  const parentDir = path.dirname(filepath);
  const approved = await ctx.ui.confirm(
    "external_directory",
    serializePermissionPayload({
      permission: "external_directory",
      filepath,
      parentDir,
      patterns: [`${parentDir}${path.sep}*`],
      toolName: event.toolName,
      toolCallId: event.toolCallId,
    }),
  );
  if (approved) {
    return undefined;
  }

  return {
    block: true,
    reason: `Blocked external directory access to ${filepath}`,
  } satisfies ToolCallResult;
}

function extractAbsoluteCommandPaths(command: string) {
  return command
    .split(/\s+/)
    .map((token) => token.replace(/^["'`]+|["'`;|&]+$/g, ""))
    .filter((token) => token.startsWith("/"))
    .map((token) => normalizeCandidatePath(token));
}

async function requestCommandApproval(
  event: ToolCallEvent,
  ctx: ExtensionContext,
  command: string,
) {
  const approved = await ctx.ui.confirm(
    "command_execution",
    serializePermissionPayload({
      permission: "command_execution",
      command,
      toolName: event.toolName,
      toolCallId: event.toolCallId,
    }),
  );
  if (approved) {
    return undefined;
  }

  return {
    block: true,
    reason: `Blocked command execution: ${command}`,
  } satisfies ToolCallResult;
}

export default function registerOpenerXPiMonoGovernanceExtension(pi: ExtensionApi) {
  const allowedRoots = parseAllowedRoots();

  pi.on("tool_call", async (event, ctx) => {
    if (event.toolName === "edit" || event.toolName === "write") {
      const protectedPath = collectToolPaths(event.input).find((candidatePath) =>
        isProtectedWritePath(candidatePath),
      );
      if (protectedPath) {
        return {
          block: true,
          reason: `Blocked write to protected path ${protectedPath}`,
        } satisfies ToolCallResult;
      }
    }

    if (FILE_TOOLS.has(event.toolName)) {
      const externalPath = collectToolPaths(event.input).find(
        (candidatePath) => !isWithinAllowedRoots(candidatePath, allowedRoots),
      );
      if (externalPath) {
        return requestExternalDirectoryApproval(event, ctx, externalPath);
      }
    }

    if (event.toolName === "bash") {
      const command = readStringValue(event.input, "command");
      if (!command) {
        return undefined;
      }

      const hasDangerousPattern = DANGEROUS_BASH_PATTERNS.some((pattern) => pattern.test(command));
      const externalCommandPath = extractAbsoluteCommandPaths(command).find(
        (candidatePath) => !isWithinAllowedRoots(candidatePath, allowedRoots),
      );

      if (hasDangerousPattern || externalCommandPath) {
        return requestCommandApproval(event, ctx, command);
      }
    }

    return undefined;
  });
}