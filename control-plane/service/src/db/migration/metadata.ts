export function parseCliArgs(argv = process.argv.slice(2)) {
  const parsed: Record<string, string | boolean> = {};

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token || !token.startsWith("--")) {
      continue;
    }

    const normalized = token.slice(2);
    const equalsIndex = normalized.indexOf("=");
    if (equalsIndex >= 0) {
      parsed[normalized.slice(0, equalsIndex)] = normalized.slice(equalsIndex + 1);
      continue;
    }

    const next = argv[index + 1];
    if (next && !next.startsWith("--")) {
      parsed[normalized] = next;
      index += 1;
      continue;
    }

    parsed[normalized] = true;
  }

  return parsed;
}

export function getStringArg(
  args: Record<string, string | boolean>,
  key: string,
  defaultValue?: string,
) {
  const value = args[key];
  if (typeof value === "string" && value.length > 0) {
    return value;
  }

  if (defaultValue !== undefined) {
    return defaultValue;
  }

  throw new Error(`Missing required --${key} argument.`);
}

export function getBooleanArg(
  args: Record<string, string | boolean>,
  key: string,
  defaultValue = false,
) {
  const value = args[key];
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    return !["0", "false", "no"].includes(value.toLowerCase());
  }

  return defaultValue;
}

export const KEY_FOREIGN_KEYS = [
  { table: "project_tree_nodes", column: "project_id", targetTable: "projects" },
  { table: "project_tree_nodes", column: "parent_id", targetTable: "project_tree_nodes" },
  { table: "project_tree_nodes", column: "superseded_by", targetTable: "project_tree_nodes" },
  { table: "task_snapshots", column: "task_id", targetTable: "tasks" },
  { table: "task_snapshots", column: "project_id", targetTable: "projects" },
  { table: "task_snapshots", column: "current_phase_id", targetTable: "task_execution_phases" },
  { table: "task_snapshots", column: "latest_phase_id", targetTable: "task_execution_phases" },
  { table: "task_snapshots", column: "current_session_id", targetTable: "task_sessions" },
  { table: "task_snapshots", column: "latest_session_id", targetTable: "task_sessions" },
  { table: "task_sessions", column: "task_id", targetTable: "tasks" },
  { table: "task_sessions", column: "project_id", targetTable: "projects" },
  { table: "task_sessions", column: "tree_node_id", targetTable: "project_tree_nodes" },
  { table: "task_sessions", column: "parent_session_id", targetTable: "task_sessions" },
  { table: "task_sessions", column: "root_session_id", targetTable: "task_sessions" },
  { table: "task_sessions", column: "phase_id", targetTable: "task_execution_phases" },
  { table: "task_sessions", column: "winner_session_id", targetTable: "task_sessions" },
  { table: "task_sessions", column: "judge_session_id", targetTable: "task_sessions" },
  { table: "task_session_runs", column: "task_id", targetTable: "tasks" },
  { table: "task_session_runs", column: "session_id", targetTable: "task_sessions" },
  { table: "task_session_runs", column: "phase_id", targetTable: "task_execution_phases" },
  { table: "task_timeline_views", column: "project_id", targetTable: "projects" },
  { table: "task_timeline_views", column: "task_id", targetTable: "tasks" },
  { table: "task_timeline_views", column: "phase_id", targetTable: "task_execution_phases" },
  { table: "task_timeline_views", column: "session_id", targetTable: "task_sessions" },
  { table: "task_timeline_views", column: "message_id", targetTable: "task_messages" },
  { table: "task_timeline_views", column: "operation_id", targetTable: "task_operations" },
  { table: "task_timeline_views", column: "artifact_id", targetTable: "task_artifacts" },
] as const;
