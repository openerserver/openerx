// ── DAG Sync Service ───────────────────────────────────────────────
// Syncs runtime task-graph-plugin DAG state to control plane DB.
// Triggered by SSE tool events or called on-demand.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { cpFetch, createInternalAuthorization } from "../../lib/control-plane-client";
import { findAgentRunBySessionId, getSessionMessages } from "../agent-control/opencode-adapter";

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
const observedWorkspaceDirs = new Set<string>();

interface RuntimeTaskNode {
  id: string;
  subject: string;
  status: string;
  agentType: string;
  sessionId: string | null;
  retryCount: number;
  maxRetries: number;
  output: string | null;
  error: string | null;
  tokenUsed: number;
  startedAt: number | null;
  finishedAt: number | null;
}

interface RuntimeTaskEdge {
  from: string;
  to: string;
  type: "blocks" | "informs";
}

interface RuntimeTaskGraph {
  id: string;
  taskId: string;
  title: string;
  nodes: RuntimeTaskNode[];
  edges: RuntimeTaskEdge[];
  status: string;
  createdAt: number;
  updatedAt: number;
}

function resolveControlPlaneTaskId(graph: RuntimeTaskGraph, sessionId?: string): string {
  if (sessionId) {
    const run = findAgentRunBySessionId(sessionId);
    if (run?.taskId) {
      return run.taskId;
    }
  }

  for (const node of graph.nodes) {
    if (!node.sessionId) continue;
    const run = findAgentRunBySessionId(node.sessionId);
    if (run?.taskId) {
      return run.taskId;
    }
  }

  return graph.taskId;
}

export function observeGraphWorkspaceDir(directory?: string | null): void {
  if (!directory) return;
  observedWorkspaceDirs.add(directory);
}

function getCandidateWorkspaceDirs(): string[] {
  const candidates = [
    process.env.OPENCODE_DIR,
    process.cwd(),
    join(process.cwd(), "opencode-fork"),
    join(process.cwd(), "../opencode-fork"),
    join(process.cwd(), "../../opencode-fork"),
    resolve(MODULE_DIR, "../../../../../"),
    resolve(MODULE_DIR, "../../../../../opencode-fork"),
    ...observedWorkspaceDirs,
  ].filter((value): value is string => Boolean(value));

  return Array.from(new Set(candidates));
}

export function resolveGraphStorageDirs(preferredDirectory?: string): string[] {
  const workspaceDirs = [preferredDirectory, ...getCandidateWorkspaceDirs()].filter(
    (value): value is string => Boolean(value),
  );

  return Array.from(
    new Set(
      workspaceDirs
        .map((directory) => join(directory, ".opencode", "state", "task-graphs"))
        .filter((directory) => existsSync(directory)),
    ),
  );
}

function loadRuntimeGraph(graphId: string, preferredDirectory?: string): RuntimeTaskGraph | null {
  for (const dir of resolveGraphStorageDirs(preferredDirectory)) {
    const filePath = join(dir, `${graphId}.json`);
    if (!existsSync(filePath)) continue;
    const content = readFileSync(filePath, "utf-8");
    return JSON.parse(content) as RuntimeTaskGraph;
  }

  return null;
}

function listRuntimeGraphs(preferredDirectory?: string): string[] {
  const graphIds = new Set<string>();

  for (const dir of resolveGraphStorageDirs(preferredDirectory)) {
    for (const file of readdirSync(dir)) {
      if (file.endsWith(".json")) {
        graphIds.add(file.replace(".json", ""));
      }
    }
  }

  return Array.from(graphIds);
}

function extractGraphIdsFromMessages(messages: unknown[]): string[] {
  const graphIds = new Set<string>();

  for (const message of messages) {
    if (typeof message !== "object" || !message) continue;
    const parts = Array.isArray((message as { parts?: unknown[] }).parts)
      ? ((message as { parts: unknown[] }).parts ?? [])
      : [];

    for (const part of parts) {
      if (typeof part !== "object" || !part) continue;
      const toolPart = part as {
        type?: unknown;
        tool?: unknown;
        state?: { input?: Record<string, unknown>; output?: unknown };
      };
      if (toolPart.type !== "tool") continue;

      const toolName = typeof toolPart.tool === "string" ? toolPart.tool : "";
      if (!toolName.startsWith("task_graph_")) continue;

      const input = toolPart.state?.input;
      if (typeof input?.graphId === "string") {
        graphIds.add(input.graphId);
      }

      const output = toolPart.state?.output;
      if (typeof output !== "string") continue;
      try {
        const parsed = JSON.parse(output) as { graphId?: unknown; id?: unknown };
        if (typeof parsed.graphId === "string") {
          graphIds.add(parsed.graphId);
        }
        if (typeof parsed.id === "string") {
          graphIds.add(parsed.id);
        }
      } catch {
        // Ignore non-JSON tool outputs.
      }
    }
  }

  return Array.from(graphIds);
}

// Track last sync time per graph to avoid redundant syncs
const lastSyncTimestamps = new Map<string, number>();

async function syncGraphToControlPlane(graph: RuntimeTaskGraph, sessionId?: string): Promise<boolean> {
  const lastSync = lastSyncTimestamps.get(graph.id);
  if (lastSync && lastSync >= graph.updatedAt) {
    return true; // Already synced
  }

  const controlPlaneTaskId = resolveControlPlaneTaskId(graph, sessionId);

  const authorization = await createInternalAuthorization();

  const toISOOrNull = (ts: number | null): string | null =>
    ts ? new Date(ts).toISOString() : null;

  const result = await cpFetch(`/api/tasks/${encodeURIComponent(controlPlaneTaskId)}/graph`, {
    method: "PUT",
    authorization,
    body: {
      graphId: graph.id,
      nodes: graph.nodes.map((n) => ({
        id: n.id,
        subject: n.subject || n.id,
        status: n.status,
        agentType: n.agentType || "unknown",
        sessionId: n.sessionId,
        retryCount: n.retryCount,
        maxRetries: n.maxRetries,
        output: n.output,
        error: n.error,
        tokenUsed: n.tokenUsed,
        startedAt: toISOOrNull(n.startedAt),
        finishedAt: toISOOrNull(n.finishedAt),
      })),
      edges: graph.edges.map((e) => ({
        from: e.from,
        to: e.to,
        type: e.type,
      })),
    },
  });

  if (result.ok) {
    lastSyncTimestamps.set(graph.id, graph.updatedAt);
    console.log(`[dag-sync] Synced graph ${graph.id} for task ${controlPlaneTaskId}`);
  } else {
    console.error(
      `[dag-sync] Failed to sync graph ${graph.id} for task ${controlPlaneTaskId}: ${result.status}`,
    );
  }

  return result.ok;
}

/**
 * Called when a tool.execute.after event fires for task_graph_* tools.
 * Reads the latest graph state from filesystem and syncs to CP.
 */
export async function onGraphToolExecuted(
  toolName: string,
  toolResult: string,
  workspaceDirectory?: string,
  sessionId?: string,
): Promise<void> {
  if (!toolName.startsWith("task_graph_")) return;

  observeGraphWorkspaceDir(workspaceDirectory);

  try {
    const parsed = JSON.parse(toolResult);

    if (toolName === "task_graph_create" && parsed.graphId) {
      const graph = loadRuntimeGraph(parsed.graphId, workspaceDirectory);
      if (graph) await syncGraphToControlPlane(graph, sessionId);
    } else if (toolName === "task_graph_update_node" && parsed.graphStatus) {
      // toolResult contains graphStatus but we need graphId — extract from context
      // The update_node result doesn't include graphId directly, so we sync all graphs for the task
      await syncAllGraphs(workspaceDirectory);
    } else if (toolName === "task_graph_query" && parsed.id) {
      const graph = loadRuntimeGraph(parsed.id, workspaceDirectory);
      if (graph) await syncGraphToControlPlane(graph, sessionId);
    }
  } catch {
    // Fallback: sync all known graphs
    await syncAllGraphs(workspaceDirectory);
  }
}

/**
 * Sync all runtime graphs to control plane. Used as fallback or periodic sync.
 */
export async function syncAllGraphs(preferredDirectory?: string): Promise<number> {
  const graphIds = listRuntimeGraphs(preferredDirectory);
  let synced = 0;

  for (const graphId of graphIds) {
    const graph = loadRuntimeGraph(graphId, preferredDirectory);
    if (graph) {
      const ok = await syncGraphToControlPlane(graph);
      if (ok) synced++;
    }
  }

  return synced;
}

/**
 * Sync a specific task's graphs by scanning all runtime graphs.
 */
export async function syncGraphsForTask(taskId: string): Promise<number> {
  const graphIds = listRuntimeGraphs();
  let synced = 0;

  for (const graphId of graphIds) {
    const graph = loadRuntimeGraph(graphId);
    if (graph && resolveControlPlaneTaskId(graph) === taskId) {
      const ok = await syncGraphToControlPlane(graph);
      if (ok) synced++;
    }
  }

  return synced;
}

export async function syncGraphsForSessionTask(
  taskId: string,
  sessionId?: string,
  preferredDirectory?: string,
): Promise<number> {
  if (!sessionId) return 0;

  const messageResult = await getSessionMessages(sessionId);
  if (!messageResult.ok || !Array.isArray(messageResult.data)) {
    return 0;
  }

  const graphIds = extractGraphIdsFromMessages(messageResult.data);
  let synced = 0;

  for (const graphId of graphIds) {
    const graph = loadRuntimeGraph(graphId, preferredDirectory);
    if (!graph) continue;
    if (resolveControlPlaneTaskId(graph, sessionId) !== taskId) continue;

    const ok = await syncGraphToControlPlane(graph, sessionId);
    if (ok) synced++;
  }

  return synced;
}
