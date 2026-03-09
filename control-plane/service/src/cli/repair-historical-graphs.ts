#!/usr/bin/env bun

import { existsSync, readdirSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { agentRuns, sessions, taskEdges, taskNodes, tasks } from "../db/schema";

type NodeStatus =
  | "pending"
  | "in_progress"
  | "completed"
  | "failed"
  | "blocked"
  | "stopped"
  | "paused"
  | "waiting_approval";

type EdgeType = "blocks" | "informs";

interface RuntimeTaskNode {
  id: string;
  subject?: string;
  status?: string;
  agentType?: string;
  sessionId?: string | null;
  retryCount?: number;
  maxRetries?: number;
  output?: string | null;
  error?: string | null;
  tokenUsed?: number;
  startedAt?: number | null;
  finishedAt?: number | null;
}

interface RuntimeTaskEdge {
  from: string;
  to: string;
  type?: string;
}

interface RuntimeTaskGraph {
  id: string;
  taskId: string;
  title: string;
  nodes: RuntimeTaskNode[];
  edges: RuntimeTaskEdge[];
  status?: string;
  createdAt?: number;
  updatedAt?: number;
}

interface ResolverMaps {
  taskIds: Set<string>;
  bySessionId: Map<string, string>;
  byGraphId: Map<string, string>;
}

interface RepairResult {
  graphId: string;
  filePath: string;
  originalTaskId: string;
  resolvedTaskId?: string;
  status: "repaired" | "skipped" | "failed";
  reason?: string;
  nodeCount?: number;
  edgeCount?: number;
  rewroteFile?: boolean;
}

const VALID_NODE_STATUSES = new Set<NodeStatus>([
  "pending",
  "in_progress",
  "completed",
  "failed",
  "blocked",
  "stopped",
  "paused",
  "waiting_approval",
]);

function parseArgs() {
  const args = process.argv.slice(2);
  const parsed: Record<string, string> = {};
  const flags = new Set<string>();

  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (!arg?.startsWith("--")) continue;

    const key = arg.slice(2);
    const next = args[index + 1];
    if (next && !next.startsWith("--")) {
      parsed[key] = next;
      index++;
    } else {
      flags.add(key);
    }
  }

  return { parsed, flags };
}

function toIsoOrNull(value?: number | null): string | null {
  return value ? new Date(value).toISOString() : null;
}

function normalizeNodeStatus(value?: string): NodeStatus {
  return value && VALID_NODE_STATUSES.has(value as NodeStatus)
    ? (value as NodeStatus)
    : "pending";
}

function normalizeEdgeType(value?: string): EdgeType {
  return value === "informs" ? "informs" : "blocks";
}

function unique<T>(values: T[]): T[] {
  return Array.from(new Set(values));
}

function getGraphDir(explicitDir?: string): string {
  if (explicitDir) {
    return resolve(explicitDir);
  }

  return resolve(process.cwd(), "../../.opencode/state/task-graphs");
}

function getOpencodeUrl(): string {
  return process.env.OPENCODE_URL || "http://127.0.0.1:4096";
}

async function fetchRuntimeMessages(sessionId: string): Promise<unknown[]> {
  const response = await fetch(
    `${getOpencodeUrl()}/session/${encodeURIComponent(sessionId)}/message?limit=200`,
  );
  if (!response.ok) {
    throw new Error(`OpenCode session fetch failed for ${sessionId}: HTTP ${response.status}`);
  }

  const data = (await response.json()) as unknown;
  return Array.isArray(data) ? data : [];
}

function extractRuntimeMappings(
  taskId: string,
  messages: unknown[],
  bySessionId: Map<string, string>,
  byGraphId: Map<string, string>,
): void {
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
        state?: { output?: unknown };
      };
      if (toolPart.type !== "tool" || typeof toolPart.tool !== "string") continue;
      if (typeof toolPart.state?.output !== "string") continue;

      let parsed: Record<string, unknown> | undefined;
      try {
        parsed = JSON.parse(toolPart.state.output) as Record<string, unknown>;
      } catch {
        continue;
      }

      if (toolPart.tool === "create_sub_session" && typeof parsed.sessionId === "string") {
        bySessionId.set(parsed.sessionId, taskId);
      }

      if (
        (toolPart.tool === "task_graph_create" && typeof parsed.graphId === "string") ||
        (toolPart.tool === "task_graph_query" && typeof parsed.id === "string")
      ) {
        const graphId =
          typeof parsed.graphId === "string"
            ? parsed.graphId
            : typeof parsed.id === "string"
              ? parsed.id
              : undefined;
        if (graphId) {
          byGraphId.set(graphId, taskId);
        }
      }
    }
  }
}

async function buildResolverMaps(): Promise<ResolverMaps> {
  const [taskRows, sessionRows, runRows, nodeRows] = await Promise.all([
    db.select({ id: tasks.id, sessionId: tasks.sessionId }).from(tasks),
    db.select({ id: sessions.id, taskId: sessions.taskId }).from(sessions),
    db.select({ sessionId: agentRuns.sessionId, taskId: agentRuns.taskId }).from(agentRuns),
    db.select({ sessionId: taskNodes.sessionId, taskId: taskNodes.taskId }).from(taskNodes),
  ]);

  const taskIds = new Set(taskRows.map((row) => row.id));
  const bySessionId = new Map<string, string>();
  const byGraphId = new Map<string, string>();

  for (const row of taskRows) {
    if (row.sessionId) bySessionId.set(row.sessionId, row.id);
  }
  for (const row of sessionRows) {
    if (row.taskId) bySessionId.set(row.id, row.taskId);
  }
  for (const row of runRows) {
    if (row.sessionId) bySessionId.set(row.sessionId, row.taskId);
  }
  for (const row of nodeRows) {
    if (row.sessionId) bySessionId.set(row.sessionId, row.taskId);
  }

  for (const row of taskRows) {
    if (!row.sessionId) continue;
    try {
      const messages = await fetchRuntimeMessages(row.sessionId);
      extractRuntimeMappings(row.id, messages, bySessionId, byGraphId);
    } catch {
      // Historical repair should continue even if some runtime sessions are unavailable.
    }
  }

  return { taskIds, bySessionId, byGraphId };
}

function resolveTaskId(graph: RuntimeTaskGraph, maps: ResolverMaps): string | undefined {
  if (maps.taskIds.has(graph.taskId)) {
    return graph.taskId;
  }

  const byGraphId = maps.byGraphId.get(graph.id);
  if (byGraphId) {
    return byGraphId;
  }

  const sessionIds = unique(
    graph.nodes
      .map((node) => node.sessionId)
      .filter((value): value is string => typeof value === "string" && value.length > 0),
  );

  for (const sessionId of sessionIds) {
    const taskId = maps.bySessionId.get(sessionId);
    if (taskId) {
      return taskId;
    }
  }

  return undefined;
}

async function rewriteGraphFile(filePath: string, graph: RuntimeTaskGraph): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(graph, null, 2)}\n`, "utf8");
}

async function upsertGraph(taskId: string, graph: RuntimeTaskGraph): Promise<void> {
  const normalizedNodes = graph.nodes.map((node) => ({
    id: node.id,
    taskId,
    graphId: graph.id,
    subject: node.subject || node.id,
    status: normalizeNodeStatus(node.status),
    agentType: node.agentType || "unknown",
    sessionId: node.sessionId ?? null,
    retryCount: node.retryCount ?? 0,
    maxRetries: node.maxRetries ?? 2,
    output: node.output ?? null,
    error: node.error ?? null,
    tokenUsed: node.tokenUsed ?? 0,
    startedAt: toIsoOrNull(node.startedAt),
    finishedAt: toIsoOrNull(node.finishedAt),
  }));

  const validNodeIds = new Set(normalizedNodes.map((node) => node.id));
  const normalizedEdges = graph.edges
    .filter((edge) => validNodeIds.has(edge.from) && validNodeIds.has(edge.to))
    .map((edge) => ({
      id: crypto.randomUUID(),
      taskId,
      graphId: graph.id,
      fromNodeId: edge.from,
      toNodeId: edge.to,
      edgeType: normalizeEdgeType(edge.type),
    }));

  await db.transaction(async (tx) => {
    await tx
      .delete(taskEdges)
      .where(and(eq(taskEdges.taskId, taskId), eq(taskEdges.graphId, graph.id)));
    await tx
      .delete(taskNodes)
      .where(and(eq(taskNodes.taskId, taskId), eq(taskNodes.graphId, graph.id)));

    if (normalizedNodes.length > 0) {
      await tx.insert(taskNodes).values(normalizedNodes);
    }

    if (normalizedEdges.length > 0) {
      await tx.insert(taskEdges).values(normalizedEdges);
    }
  });
}

async function loadGraph(filePath: string): Promise<RuntimeTaskGraph> {
  return JSON.parse(await readFile(filePath, "utf8")) as RuntimeTaskGraph;
}

async function repairGraph(
  filePath: string,
  maps: ResolverMaps,
  rewriteFiles: boolean,
): Promise<RepairResult> {
  const graph = await loadGraph(filePath);
  const originalTaskId = graph.taskId;
  const resolvedTaskId = resolveTaskId(graph, maps);

  if (!resolvedTaskId) {
    return {
      graphId: graph.id,
      filePath,
      originalTaskId,
      status: "skipped",
      reason: "No matching control-plane task could be resolved from graph.taskId or node sessionIds",
    };
  }

  const taskExists = await db.query.tasks.findFirst({ where: eq(tasks.id, resolvedTaskId) });
  if (!taskExists) {
    return {
      graphId: graph.id,
      filePath,
      originalTaskId,
      resolvedTaskId,
      status: "skipped",
      reason: "Resolved task ID does not exist in control-plane database",
    };
  }

  graph.taskId = resolvedTaskId;

  await upsertGraph(resolvedTaskId, graph);

  let rewroteFile = false;
  if (rewriteFiles && originalTaskId !== resolvedTaskId) {
    await rewriteGraphFile(filePath, graph);
    rewroteFile = true;
  }

  return {
    graphId: graph.id,
    filePath,
    originalTaskId,
    resolvedTaskId,
    status: "repaired",
    nodeCount: graph.nodes.length,
    edgeCount: graph.edges.length,
    rewroteFile,
  };
}

async function main() {
  const { parsed, flags } = parseArgs();

  if (flags.has("help") || flags.has("h")) {
    console.log(`
Usage: bun run src/cli/repair-historical-graphs.ts [options]

Options:
  --graph-dir <path>   Override the runtime graph directory
  --graph-id <id>      Repair only a specific graph ID
  --task-id <id>       Repair only graphs that resolve to this task ID
  --dry-run            Show what would change without writing DB or files
  --no-rewrite         Do not rewrite runtime graph files with the resolved task ID
  --help               Show this help
`);
    return;
  }

  const graphDir = getGraphDir(parsed["graph-dir"]);
  const graphIdFilter = parsed["graph-id"];
  const taskIdFilter = parsed["task-id"];
  const dryRun = flags.has("dry-run");
  const rewriteFiles = !flags.has("no-rewrite");

  if (!existsSync(graphDir)) {
    throw new Error(`Graph directory not found: ${graphDir}`);
  }

  const maps = await buildResolverMaps();
  const filePaths = readdirSync(graphDir)
    .filter((file) => file.endsWith(".json"))
    .filter((file) => !graphIdFilter || file === `${graphIdFilter}.json`)
    .map((file) => join(graphDir, file));

  if (filePaths.length === 0) {
    console.log("No graph files matched the requested filters.");
    return;
  }

  const results: RepairResult[] = [];

  for (const filePath of filePaths) {
    try {
      const graph = await loadGraph(filePath);
      const resolvedTaskId = resolveTaskId(graph, maps);

      if (taskIdFilter && resolvedTaskId !== taskIdFilter && graph.taskId !== taskIdFilter) {
        continue;
      }

      if (dryRun) {
        results.push({
          graphId: graph.id,
          filePath,
          originalTaskId: graph.taskId,
          resolvedTaskId,
          status: resolvedTaskId ? "repaired" : "skipped",
          reason: resolvedTaskId ? undefined : "No matching control-plane task could be resolved",
          nodeCount: graph.nodes.length,
          edgeCount: graph.edges.length,
          rewroteFile: Boolean(resolvedTaskId && rewriteFiles && graph.taskId !== resolvedTaskId),
        });
        continue;
      }

      results.push(await repairGraph(filePath, maps, rewriteFiles));
    } catch (error) {
      results.push({
        graphId: graphIdFilter || filePath,
        filePath,
        originalTaskId: "unknown",
        status: "failed",
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const repaired = results.filter((result) => result.status === "repaired");
  const skipped = results.filter((result) => result.status === "skipped");
  const failed = results.filter((result) => result.status === "failed");

  console.log(`Scanned ${results.length} graph file(s) from ${graphDir}`);
  console.log(`Repaired: ${repaired.length}`);
  console.log(`Skipped:  ${skipped.length}`);
  console.log(`Failed:   ${failed.length}`);

  for (const result of results) {
    const suffix = result.reason ? ` — ${result.reason}` : "";
    const mapping = result.resolvedTaskId
      ? ` ${result.originalTaskId} -> ${result.resolvedTaskId}`
      : ` ${result.originalTaskId}`;
    const detail =
      result.status === "repaired"
        ? ` (${result.nodeCount ?? 0} nodes, ${result.edgeCount ?? 0} edges${
            result.rewroteFile ? ", file rewritten" : ""
          })`
        : "";
    console.log(`[${result.status}] ${result.graphId}${mapping}${detail}${suffix}`);
  }
}

main().catch((error) => {
  console.error(`Fatal: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});