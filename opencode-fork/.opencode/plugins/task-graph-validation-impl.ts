/**
 * ──────────────────────────────────────────────────────────────────────────────
 * DAG Task Graph Validation Framework Implementation
 * ──────────────────────────────────────────────────────────────────────────────
 *
 * Concrete implementation of the validation framework architecture.
 * Provides built-in validators and pipeline implementations.
 */

import type {
  GraphMetrics,
  IConnectivityValidator,
  ICycleDetectionValidator,
  IEdgeValidator,
  IPerformanceAnalyzer,
  ITaskGraphValidationIntegration,
  ITopologicalValidator,
  IValidationFramework,
  IValidationPipeline,
  IValidationPipelineFactory,
  IValidationService,
  IValidator,
  NodeStatus,
  TaskEdge,
  TaskGraph,
  TaskNode,
  ValidationCategory,
  ValidationConfig,
  ValidationContext,
  ValidationReport,
  ValidationResult,
} from "./task-graph-validation";

// ── Core Implementation Classes ───────────────────────────────────────────────

/**
 * Default validation configuration
 */
const DEFAULT_VALIDATION_CONFIG: ValidationConfig = {
  enabledCategories: ["structural", "semantic", "performance"],
  strictMode: false,
  performanceMode: "balanced",
  maxGraphSize: 10000,
  timeoutMs: 30000,
  customValidators: [],
  autoCorrection: {
    enabled: false,
    maxAttempts: 3,
    allowedCorrections: ["remove_redundant_edges", "fix_invalid_transitions"],
  },
} as const;

/**
 * Validation pipeline implementation
 */
export class ValidationPipeline implements IValidationPipeline {
  private validators = new Map<ValidationCategory, IValidator[]>();

  constructor(validators: readonly IValidator[] = []) {
    for (const validator of validators) {
      this.registerValidator(validator);
    }
  }

  registerValidator(validator: IValidator): void {
    const category = validator.category;
    if (!this.validators.has(category)) {
      this.validators.set(category, []);
    }
    this.validators.get(category)!.push(validator);
  }

  getValidators(category?: ValidationCategory): readonly IValidator[] {
    if (category) {
      return this.validators.get(category) ?? [];
    }
    return Array.from(this.validators.values()).flat();
  }

  async validate(graph: TaskGraph, context?: ValidationContext): Promise<ValidationReport> {
    const startTime = Date.now();
    const results: ValidationResult[] = [];
    const categoriesToRun = context?.skipCategories
      ? (
          [
            "structural",
            "semantic",
            "performance",
            "security",
            "consistency",
          ] as ValidationCategory[]
        ).filter((cat) => !context.skipCategories!.includes(cat))
      : ["structural", "semantic", "performance"];

    return this.validateCategories(graph, categoriesToRun, context);
  }

  async validateCategories(
    graph: TaskGraph,
    categories: readonly ValidationCategory[],
    context?: ValidationContext,
  ): Promise<ValidationReport> {
    const startTime = Date.now();
    const results: ValidationResult[] = [];
    let checksRun = 0;

    for (const category of categories) {
      const validators = this.validators.get(category) ?? [];

      // Run validators in parallel for performance
      const categoryPromises = validators.map(async (validator) => {
        try {
          checksRun++;
          return await validator.validate(graph, context);
        } catch (error) {
          return [
            {
              valid: false,
              severity: "error" as const,
              code: `VALIDATOR_ERROR_${validator.name}`,
              message: `Validator "${validator.name}" failed: ${String(error)}`,
              context: { validatorName: validator.name, category },
            },
          ];
        }
      });

      const categoryResults = await Promise.all(categoryPromises);
      results.push(...categoryResults.flat());
    }

    const endTime = Date.now();
    const valid = results.every((r) => r.valid || r.severity !== "error");

    return {
      valid,
      graphId: graph.id,
      timestamp: Date.now(),
      results,
      summary: {
        errorCount: results.filter((r) => r.severity === "error").length,
        warningCount: results.filter((r) => r.severity === "warning").length,
        infoCount: results.filter((r) => r.severity === "info").length,
        suggestionCount: results.filter((r) => r.severity === "suggestion").length,
      },
      performance: {
        validationTimeMs: endTime - startTime,
        checksRun,
      },
    };
  }
}

/**
 * Cycle detection validator using DFS-based algorithm
 */
export class CycleDetectionValidator implements ICycleDetectionValidator {
  readonly name = "CycleDetectionValidator";
  readonly description = "Detects circular dependencies in task graphs using DFS";
  readonly category = "structural" as const;

  async validate(graph: TaskGraph, context?: ValidationContext): Promise<ValidationResult[]> {
    const cycles = await this.findCycles(graph);

    if (cycles.length === 0) {
      return [
        {
          valid: true,
          severity: "info",
          code: "NO_CYCLES_FOUND",
          message: "No circular dependencies detected",
        },
      ];
    }

    return cycles.map((cycle, index) => ({
      valid: false,
      severity: "error" as const,
      code: "CIRCULAR_DEPENDENCY",
      message: `Circular dependency detected: ${cycle.join(" → ")} → ${cycle[0]}`,
      nodeIds: cycle,
      context: { cycleIndex: index, cycleLength: cycle.length },
    }));
  }

  async findCycles(graph: TaskGraph): Promise<string[][]> {
    const visited = new Set<string>();
    const recursionStack = new Set<string>();
    const cycles: string[][] = [];

    // Build adjacency list from blocking edges only
    const adjList = new Map<string, string[]>();
    for (const node of graph.nodes) {
      adjList.set(node.id, []);
    }
    for (const edge of graph.edges) {
      if (edge.type === "blocks") {
        adjList.get(edge.from)?.push(edge.to);
      }
    }

    const dfs = (nodeId: string, path: string[]): boolean => {
      if (recursionStack.has(nodeId)) {
        // Found a cycle - extract it from the path
        const cycleStart = path.indexOf(nodeId);
        if (cycleStart !== -1) {
          cycles.push(path.slice(cycleStart));
        }
        return true;
      }

      if (visited.has(nodeId)) {
        return false;
      }

      visited.add(nodeId);
      recursionStack.add(nodeId);
      path.push(nodeId);

      const neighbors = adjList.get(nodeId) ?? [];
      for (const neighbor of neighbors) {
        if (dfs(neighbor, [...path])) {
          // Continue searching for more cycles
        }
      }

      recursionStack.delete(nodeId);
      return false;
    };

    // Start DFS from each unvisited node
    for (const node of graph.nodes) {
      if (!visited.has(node.id)) {
        dfs(node.id, []);
      }
    }

    return cycles;
  }

  async wouldCreateCycle(graph: TaskGraph, fromId: string, toId: string): Promise<boolean> {
    // Create a temporary graph with the new edge
    const tempGraph: TaskGraph = {
      ...graph,
      edges: [...graph.edges, { from: fromId, to: toId, type: "blocks" }],
    };

    const cycles = await this.findCycles(tempGraph);
    return cycles.length > 0;
  }
}

/**
 * Topological ordering validator using Kahn's algorithm
 */
export class TopologicalValidator implements ITopologicalValidator {
  readonly name = "TopologicalValidator";
  readonly description = "Validates topological ordering using Kahn's algorithm";
  readonly category = "structural" as const;

  async validate(graph: TaskGraph, context?: ValidationContext): Promise<ValidationResult[]> {
    const isValid = await this.isValidDAG(graph);

    if (isValid) {
      const order = await this.getTopologicalOrder(graph);
      return [
        {
          valid: true,
          severity: "info",
          code: "VALID_DAG",
          message: `Graph has valid topological ordering with ${order?.length ?? 0} nodes`,
          context: { topologicalOrder: order },
        },
      ];
    }

    return [
      {
        valid: false,
        severity: "error",
        code: "INVALID_DAG",
        message: "Graph is not a valid DAG - contains cycles or invalid structure",
      },
    ];
  }

  async getTopologicalOrder(graph: TaskGraph): Promise<string[] | null> {
    // Kahn's algorithm implementation
    const inDegree = new Map<string, number>();
    const adjList = new Map<string, string[]>();

    // Initialize
    for (const node of graph.nodes) {
      inDegree.set(node.id, 0);
      adjList.set(node.id, []);
    }

    // Build graph and calculate in-degrees (only for blocking edges)
    for (const edge of graph.edges) {
      if (edge.type === "blocks") {
        adjList.get(edge.from)?.push(edge.to);
        inDegree.set(edge.to, (inDegree.get(edge.to) ?? 0) + 1);
      }
    }

    // Find nodes with no incoming edges
    const queue: string[] = [];
    for (const [nodeId, degree] of inDegree) {
      if (degree === 0) {
        queue.push(nodeId);
      }
    }

    const result: string[] = [];

    while (queue.length > 0) {
      const current = queue.shift()!;
      result.push(current);

      const neighbors = adjList.get(current) ?? [];
      for (const neighbor of neighbors) {
        const newDegree = (inDegree.get(neighbor) ?? 0) - 1;
        inDegree.set(neighbor, newDegree);
        if (newDegree === 0) {
          queue.push(neighbor);
        }
      }
    }

    // If we processed all nodes, we have a valid topological order
    return result.length === graph.nodes.length ? result : null;
  }

  async isValidDAG(graph: TaskGraph): Promise<boolean> {
    const order = await this.getTopologicalOrder(graph);
    return order !== null;
  }
}

/**
 * Node connectivity validator
 */
export class ConnectivityValidator implements IConnectivityValidator {
  readonly name = "ConnectivityValidator";
  readonly description = "Validates node connectivity and reachability";
  readonly category = "structural" as const;

  async validate(graph: TaskGraph, context?: ValidationContext): Promise<ValidationResult[]> {
    const results: ValidationResult[] = [];

    const unreachable = await this.findUnreachableNodes(graph);
    const roots = await this.findRootNodes(graph);
    const leaves = await this.findLeafNodes(graph);

    if (unreachable.length > 0) {
      results.push({
        valid: false,
        severity: "warning",
        code: "UNREACHABLE_NODES",
        message: `Found ${unreachable.length} unreachable nodes`,
        nodeIds: unreachable,
        context: { unreachableCount: unreachable.length },
      });
    }

    if (roots.length === 0) {
      results.push({
        valid: false,
        severity: "warning",
        code: "NO_ROOT_NODES",
        message: "No root nodes found - all nodes have dependencies",
      });
    }

    results.push({
      valid: true,
      severity: "info",
      code: "CONNECTIVITY_ANALYSIS",
      message: `Graph connectivity: ${roots.length} root nodes, ${leaves.length} leaf nodes`,
      context: { rootNodes: roots, leafNodes: leaves, unreachableNodes: unreachable },
    });

    return results;
  }

  async findUnreachableNodes(graph: TaskGraph): Promise<string[]> {
    const roots = await this.findRootNodes(graph);
    if (roots.length === 0) return []; // All nodes are unreachable from roots

    const reachable = new Set<string>();
    const adjList = new Map<string, string[]>();

    // Build adjacency list
    for (const node of graph.nodes) {
      adjList.set(node.id, []);
    }
    for (const edge of graph.edges) {
      if (edge.type === "blocks") {
        adjList.get(edge.from)?.push(edge.to);
      }
    }

    // DFS from each root to find all reachable nodes
    const dfs = (nodeId: string) => {
      if (reachable.has(nodeId)) return;
      reachable.add(nodeId);

      const neighbors = adjList.get(nodeId) ?? [];
      for (const neighbor of neighbors) {
        dfs(neighbor);
      }
    };

    for (const root of roots) {
      dfs(root);
    }

    return graph.nodes.map((n) => n.id).filter((id) => !reachable.has(id));
  }

  async findRootNodes(graph: TaskGraph): Promise<string[]> {
    const hasIncomingEdge = new Set<string>();

    for (const edge of graph.edges) {
      if (edge.type === "blocks") {
        hasIncomingEdge.add(edge.to);
      }
    }

    return graph.nodes.filter((node) => !hasIncomingEdge.has(node.id)).map((node) => node.id);
  }

  async findLeafNodes(graph: TaskGraph): Promise<string[]> {
    const hasOutgoingEdge = new Set<string>();

    for (const edge of graph.edges) {
      if (edge.type === "blocks") {
        hasOutgoingEdge.add(edge.from);
      }
    }

    return graph.nodes.filter((node) => !hasOutgoingEdge.has(node.id)).map((node) => node.id);
  }
}

/**
 * Edge validation for consistency and redundancy checks
 */
export class EdgeValidator implements IEdgeValidator {
  readonly name = "EdgeValidator";
  readonly description = "Validates edge consistency and identifies redundant edges";
  readonly category = "structural" as const;

  async validate(graph: TaskGraph, context?: ValidationContext): Promise<ValidationResult[]> {
    const results: ValidationResult[] = [];

    // Check edge consistency
    const consistencyResults = await this.validateEdgeConsistency(graph);
    results.push(...consistencyResults);

    // Check edge types
    const typeResults = await this.validateEdgeTypes(graph);
    results.push(...typeResults);

    // Check for redundant edges
    const redundantEdges = await this.findRedundantEdges(graph);
    if (redundantEdges.length > 0) {
      results.push({
        valid: true,
        severity: "suggestion",
        code: "REDUNDANT_EDGES",
        message: `Found ${redundantEdges.length} potentially redundant edges`,
        edgeIds: redundantEdges.map((e) => `${e.from}-${e.to}`),
        context: { redundantEdges },
      });
    }

    return results;
  }

  async validateEdgeConsistency(graph: TaskGraph): Promise<ValidationResult[]> {
    const results: ValidationResult[] = [];
    const nodeIds = new Set(graph.nodes.map((n) => n.id));
    const seenEdges = new Set<string>();

    for (const edge of graph.edges) {
      const edgeKey = `${edge.from}-${edge.to}-${edge.type}`;

      // Check for duplicate edges
      if (seenEdges.has(edgeKey)) {
        results.push({
          valid: false,
          severity: "error",
          code: "DUPLICATE_EDGE",
          message: `Duplicate edge found: ${edge.from} → ${edge.to} (${edge.type})`,
          edgeIds: [edgeKey],
        });
        continue;
      }
      seenEdges.add(edgeKey);

      // Check for invalid node references
      if (!nodeIds.has(edge.from)) {
        results.push({
          valid: false,
          severity: "error",
          code: "INVALID_EDGE_SOURCE",
          message: `Edge references non-existent source node: ${edge.from}`,
          edgeIds: [edgeKey],
          nodeIds: [edge.from],
        });
      }

      if (!nodeIds.has(edge.to)) {
        results.push({
          valid: false,
          severity: "error",
          code: "INVALID_EDGE_TARGET",
          message: `Edge references non-existent target node: ${edge.to}`,
          edgeIds: [edgeKey],
          nodeIds: [edge.to],
        });
      }

      // Check for self-loops
      if (edge.from === edge.to) {
        results.push({
          valid: false,
          severity: "error",
          code: "SELF_LOOP",
          message: `Self-loop detected on node: ${edge.from}`,
          edgeIds: [edgeKey],
          nodeIds: [edge.from],
        });
      }
    }

    return results;
  }

  async findRedundantEdges(graph: TaskGraph): Promise<TaskEdge[]> {
    // An edge A→C is redundant if there's a path A→B→C
    const redundantEdges: TaskEdge[] = [];

    // Build adjacency list for blocking edges only
    const adjList = new Map<string, string[]>();
    for (const node of graph.nodes) {
      adjList.set(node.id, []);
    }
    for (const edge of graph.edges) {
      if (edge.type === "blocks") {
        adjList.get(edge.from)?.push(edge.to);
      }
    }

    // For each edge, check if there's an alternative path
    for (const edge of graph.edges) {
      if (edge.type !== "blocks") continue;

      // Check if there's a path from edge.from to edge.to without using the direct edge
      if (this.hasAlternatePath(adjList, edge.from, edge.to, edge)) {
        redundantEdges.push(edge);
      }
    }

    return redundantEdges;
  }

  private hasAlternatePath(
    adjList: Map<string, string[]>,
    start: string,
    target: string,
    excludeEdge: TaskEdge,
  ): boolean {
    const visited = new Set<string>();
    const stack = [start];

    while (stack.length > 0) {
      const current = stack.pop()!;
      if (current === target && visited.size > 0) {
        return true; // Found alternate path
      }

      if (visited.has(current)) continue;
      visited.add(current);

      const neighbors = adjList.get(current) ?? [];
      for (const neighbor of neighbors) {
        // Skip the direct edge we're testing for redundancy
        if (current === excludeEdge.from && neighbor === excludeEdge.to) {
          continue;
        }
        stack.push(neighbor);
      }
    }

    return false;
  }

  async validateEdgeTypes(graph: TaskGraph): Promise<ValidationResult[]> {
    const results: ValidationResult[] = [];

    const blockingCount = graph.edges.filter((e) => e.type === "blocks").length;
    const informsCount = graph.edges.filter((e) => e.type === "informs").length;

    results.push({
      valid: true,
      severity: "info",
      code: "EDGE_TYPE_ANALYSIS",
      message: `Edge types: ${blockingCount} blocking, ${informsCount} informational`,
      context: { blockingEdges: blockingCount, informsEdges: informsCount },
    });

    return results;
  }
}

/**
 * Performance analyzer for graph metrics and optimization suggestions
 */
export class PerformanceAnalyzer implements IPerformanceAnalyzer {
  readonly name = "PerformanceAnalyzer";
  readonly description = "Analyzes graph performance characteristics and suggests optimizations";
  readonly category = "performance" as const;

  async validate(graph: TaskGraph, context?: ValidationContext): Promise<ValidationResult[]> {
    const results: ValidationResult[] = [];
    const metrics = await this.calculateMetrics(graph);

    // Report basic metrics
    results.push({
      valid: true,
      severity: "info",
      code: "PERFORMANCE_METRICS",
      message: `Graph metrics: ${metrics.nodeCount} nodes, ${metrics.edgeCount} edges, depth ${metrics.maxDepth}`,
      context: { metrics },
    });

    // Check for performance issues
    if (metrics.nodeCount > 1000) {
      results.push({
        valid: true,
        severity: "warning",
        code: "LARGE_GRAPH",
        message: `Large graph detected (${metrics.nodeCount} nodes) - consider partitioning`,
        context: { nodeCount: metrics.nodeCount, threshold: 1000 },
      });
    }

    if (metrics.maxDepth > 50) {
      results.push({
        valid: true,
        severity: "warning",
        code: "DEEP_GRAPH",
        message: `Deep graph detected (depth ${metrics.maxDepth}) - may cause long execution times`,
        context: { maxDepth: metrics.maxDepth, threshold: 50 },
      });
    }

    if (metrics.parallelizationFactor < 0.3) {
      results.push({
        valid: true,
        severity: "suggestion",
        code: "LOW_PARALLELIZATION",
        message: `Low parallelization factor (${metrics.parallelizationFactor.toFixed(2)}) - consider restructuring for better concurrency`,
        context: { parallelizationFactor: metrics.parallelizationFactor },
      });
    }

    // Get optimization suggestions
    const optimizations = await this.suggestOptimizations(graph);
    results.push(...optimizations);

    return results;
  }

  async calculateMetrics(graph: TaskGraph): Promise<GraphMetrics> {
    const nodeCount = graph.nodes.length;
    const edgeCount = graph.edges.length;

    // Build adjacency list for blocking edges
    const adjList = new Map<string, string[]>();
    const reverseAdjList = new Map<string, string[]>();

    for (const node of graph.nodes) {
      adjList.set(node.id, []);
      reverseAdjList.set(node.id, []);
    }

    for (const edge of graph.edges) {
      if (edge.type === "blocks") {
        adjList.get(edge.from)?.push(edge.to);
        reverseAdjList.get(edge.to)?.push(edge.from);
      }
    }

    // Calculate max depth (longest path)
    const maxDepth = this.calculateMaxDepth(adjList);

    // Calculate fan-out and fan-in
    let maxFanOut = 0;
    let maxFanIn = 0;

    for (const neighbors of adjList.values()) {
      maxFanOut = Math.max(maxFanOut, neighbors.length);
    }

    for (const neighbors of reverseAdjList.values()) {
      maxFanIn = Math.max(maxFanIn, neighbors.length);
    }

    // Calculate critical path
    const criticalPath = await this.findCriticalPath(graph);
    const criticalPathLength = criticalPath.length;

    // Calculate parallelization factor (average nodes that can run in parallel)
    const parallelizationFactor = nodeCount > 0 ? nodeCount / Math.max(criticalPathLength, 1) : 0;

    // Simple cyclomatic complexity approximation
    const cyclomaticComplexity = edgeCount - nodeCount + 2;

    return {
      nodeCount,
      edgeCount,
      maxDepth,
      maxFanOut,
      maxFanIn,
      criticalPathLength,
      parallelizationFactor,
      cyclomaticComplexity: Math.max(1, cyclomaticComplexity),
    };
  }

  private calculateMaxDepth(adjList: Map<string, string[]>): number {
    const memo = new Map<string, number>();

    const dfs = (nodeId: string, visited: Set<string>): number => {
      if (memo.has(nodeId)) return memo.get(nodeId)!;
      if (visited.has(nodeId)) return 0; // Cycle detected, return 0

      visited.add(nodeId);
      const neighbors = adjList.get(nodeId) ?? [];

      let maxChildDepth = 0;
      for (const neighbor of neighbors) {
        maxChildDepth = Math.max(maxChildDepth, dfs(neighbor, new Set(visited)));
      }

      const depth = maxChildDepth + 1;
      memo.set(nodeId, depth);
      return depth;
    };

    let maxDepth = 0;
    for (const nodeId of adjList.keys()) {
      maxDepth = Math.max(maxDepth, dfs(nodeId, new Set()));
    }

    return maxDepth;
  }

  async findCriticalPath(graph: TaskGraph): Promise<string[]> {
    // For simplicity, return the longest path found by DFS
    // In a real implementation, this would consider node execution times

    const adjList = new Map<string, string[]>();
    for (const node of graph.nodes) {
      adjList.set(node.id, []);
    }
    for (const edge of graph.edges) {
      if (edge.type === "blocks") {
        adjList.get(edge.from)?.push(edge.to);
      }
    }

    let longestPath: string[] = [];

    const dfs = (nodeId: string, path: string[], visited: Set<string>): void => {
      if (visited.has(nodeId)) return;

      const currentPath = [...path, nodeId];
      if (currentPath.length > longestPath.length) {
        longestPath = currentPath;
      }

      visited.add(nodeId);
      const neighbors = adjList.get(nodeId) ?? [];
      for (const neighbor of neighbors) {
        dfs(neighbor, currentPath, new Set(visited));
      }
    };

    // Find root nodes and start DFS from each
    const hasIncoming = new Set<string>();
    for (const edge of graph.edges) {
      if (edge.type === "blocks") {
        hasIncoming.add(edge.to);
      }
    }

    const rootNodes = graph.nodes
      .filter((node) => !hasIncoming.has(node.id))
      .map((node) => node.id);

    for (const root of rootNodes) {
      dfs(root, [], new Set());
    }

    return longestPath;
  }

  async analyzeParallelization(graph: TaskGraph): Promise<{
    maxParallelNodes: number;
    parallelStages: string[][];
    bottlenecks: string[];
  }> {
    // Build topological levels
    const levels = await this.calculateTopologicalLevels(graph);
    const parallelStages = Object.values(levels);
    const maxParallelNodes = Math.max(...parallelStages.map((stage) => stage.length));

    // Identify bottlenecks (stages with only one node)
    const bottlenecks = parallelStages.filter((stage) => stage.length === 1).flat();

    return {
      maxParallelNodes,
      parallelStages,
      bottlenecks,
    };
  }

  private async calculateTopologicalLevels(graph: TaskGraph): Promise<Record<number, string[]>> {
    const levels: Record<number, string[]> = {};
    const nodeLevel = new Map<string, number>();

    // Build adjacency list and in-degree count
    const adjList = new Map<string, string[]>();
    const inDegree = new Map<string, number>();

    for (const node of graph.nodes) {
      adjList.set(node.id, []);
      inDegree.set(node.id, 0);
    }

    for (const edge of graph.edges) {
      if (edge.type === "blocks") {
        adjList.get(edge.from)?.push(edge.to);
        inDegree.set(edge.to, (inDegree.get(edge.to) ?? 0) + 1);
      }
    }

    // Start with nodes that have no dependencies (level 0)
    let currentLevel = 0;
    let queue = graph.nodes.filter((node) => inDegree.get(node.id) === 0).map((node) => node.id);

    while (queue.length > 0) {
      levels[currentLevel] = [...queue];

      for (const nodeId of queue) {
        nodeLevel.set(nodeId, currentLevel);
      }

      const nextQueue: string[] = [];

      for (const nodeId of queue) {
        const neighbors = adjList.get(nodeId) ?? [];
        for (const neighbor of neighbors) {
          const newDegree = (inDegree.get(neighbor) ?? 0) - 1;
          inDegree.set(neighbor, newDegree);

          if (newDegree === 0) {
            nextQueue.push(neighbor);
          }
        }
      }

      queue = nextQueue;
      currentLevel++;
    }

    return levels;
  }

  async suggestOptimizations(graph: TaskGraph): Promise<ValidationResult[]> {
    const results: ValidationResult[] = [];
    const parallelization = await this.analyzeParallelization(graph);

    if (parallelization.bottlenecks.length > 0) {
      results.push({
        valid: true,
        severity: "suggestion",
        code: "BOTTLENECK_OPTIMIZATION",
        message: `Consider parallelizing bottleneck nodes: ${parallelization.bottlenecks.slice(0, 3).join(", ")}${parallelization.bottlenecks.length > 3 ? "..." : ""}`,
        nodeIds: parallelization.bottlenecks,
        context: { bottleneckCount: parallelization.bottlenecks.length },
      });
    }

    const redundantEdgeValidator = new EdgeValidator();
    const redundantEdges = await redundantEdgeValidator.findRedundantEdges(graph);

    if (redundantEdges.length > 0) {
      results.push({
        valid: true,
        severity: "suggestion",
        code: "REMOVE_REDUNDANT_EDGES",
        message: `Consider removing ${redundantEdges.length} redundant edges to simplify the graph`,
        edgeIds: redundantEdges.map((e) => `${e.from}-${e.to}`),
        context: { redundantEdgeCount: redundantEdges.length },
      });
    }

    return results;
  }
}

// ── Pipeline Factory Implementation ───────────────────────────────────────────

export class ValidationPipelineFactory implements IValidationPipelineFactory {
  private builtInValidators: IValidator[] = [];

  constructor() {
    this.initializeBuiltInValidators();
  }

  private initializeBuiltInValidators(): void {
    this.builtInValidators = [
      new CycleDetectionValidator(),
      new TopologicalValidator(),
      new ConnectivityValidator(),
      new EdgeValidator(),
      new PerformanceAnalyzer(),
    ];
  }

  createStandardPipeline(): IValidationPipeline {
    return new ValidationPipeline(this.builtInValidators);
  }

  createFastPipeline(): IValidationPipeline {
    // Fast pipeline with only essential structural validators
    const fastValidators = this.builtInValidators.filter(
      (v) =>
        v.category === "structural" &&
        (v.name === "CycleDetectionValidator" || v.name === "TopologicalValidator"),
    );
    return new ValidationPipeline(fastValidators);
  }

  createThoroughPipeline(): IValidationPipeline {
    // Thorough pipeline with all validators
    return new ValidationPipeline(this.builtInValidators);
  }

  createCustomPipeline(validators: readonly IValidator[]): IValidationPipeline {
    return new ValidationPipeline(validators);
  }

  getBuiltInValidators(): readonly IValidator[] {
    return [...this.builtInValidators];
  }
}

// ── Validation Service Implementation ─────────────────────────────────────────

export class ValidationService implements IValidationService {
  private config: ValidationConfig;
  private pipeline: IValidationPipeline;

  constructor(config?: Partial<ValidationConfig>) {
    this.config = { ...DEFAULT_VALIDATION_CONFIG, ...config };
    this.pipeline = this.createPipelineForConfig();
  }

  configure(config: Partial<ValidationConfig>): void {
    this.config = { ...this.config, ...config };
    this.pipeline = this.createPipelineForConfig();
  }

  configureRule(ruleId: string, config: Partial<ValidationRule>): void {
    // Rule configuration would be implemented here
    // For now, we just log the configuration
    console.log(`Configuring rule ${ruleId}:`, config);
  }

  getConfiguration(): ValidationConfig {
    return { ...this.config };
  }

  async validate(graph: TaskGraph, context?: ValidationContext): Promise<ValidationReport> {
    const validationContext: ValidationContext = {
      performanceMode: this.config.performanceMode,
      skipCategories:
        this.config.enabledCategories.length < 5
          ? (
              [
                "structural",
                "semantic",
                "performance",
                "security",
                "consistency",
              ] as ValidationCategory[]
            ).filter((cat) => !this.config.enabledCategories.includes(cat))
          : undefined,
      ...context,
    };

    return this.pipeline.validate(graph, validationContext);
  }

  private createPipelineForConfig(): IValidationPipeline {
    const factory = new ValidationPipelineFactory();

    switch (this.config.performanceMode) {
      case "fast":
        return factory.createFastPipeline();
      case "thorough":
        return factory.createThoroughPipeline();
      default:
        return factory.createStandardPipeline();
    }
  }
}

// ── Integration Implementation ────────────────────────────────────────────────

export class TaskGraphValidationIntegration implements ITaskGraphValidationIntegration {
  private validationService: IValidationService;

  constructor(config?: Partial<ValidationConfig>) {
    this.validationService = new ValidationService(config);
  }

  async validateBeforeCreate(
    nodes: Array<{ subject: string; agentType: string; maxRetries?: number }>,
    edges: Array<{ fromIndex: number; toIndex: number; type?: "blocks" | "informs" }>,
  ): Promise<ValidationReport> {
    // Create a temporary graph for validation
    const tempGraph: TaskGraph = {
      id: "temp-validation-graph",
      taskId: "temp-task",
      title: "Temporary Validation Graph",
      nodes: nodes.map((node, index) => ({
        id: `temp-node-${index}`,
        subject: node.subject,
        status: "pending" as NodeStatus,
        agentType: node.agentType,
        sessionId: null,
        retryCount: 0,
        maxRetries: node.maxRetries ?? 3,
        output: null,
        error: null,
        tokenUsed: 0,
        startedAt: null,
        finishedAt: null,
      })),
      edges: edges
        .filter((edge) => edge.fromIndex < nodes.length && edge.toIndex < nodes.length)
        .map((edge) => ({
          from: `temp-node-${edge.fromIndex}`,
          to: `temp-node-${edge.toIndex}`,
          type: edge.type ?? "blocks",
        })),
      status: "active",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    return this.validationService.validate(tempGraph);
  }

  async validateNodeUpdate(
    graph: TaskGraph,
    nodeId: string,
    newStatus: NodeStatus,
  ): Promise<ValidationResult[]> {
    const results: ValidationResult[] = [];

    // Validate state transition logic
    const node = graph.nodes.find((n) => n.id === nodeId);
    if (!node) {
      results.push({
        valid: false,
        severity: "error",
        code: "NODE_NOT_FOUND",
        message: `Node ${nodeId} not found in graph`,
        nodeIds: [nodeId],
      });
      return results;
    }

    // Check if the new status would create invalid state
    if (newStatus === "in_progress") {
      // Check if all blocking dependencies are completed
      const blockingEdges = graph.edges.filter((e) => e.to === nodeId && e.type === "blocks");
      const uncompletedBlockers = blockingEdges
        .map((e) => graph.nodes.find((n) => n.id === e.from))
        .filter((n) => n && n.status !== "completed");

      if (uncompletedBlockers.length > 0) {
        results.push({
          valid: false,
          severity: "error",
          code: "UNMET_DEPENDENCIES",
          message: `Cannot start node ${nodeId}: ${uncompletedBlockers.length} dependencies not completed`,
          nodeIds: [nodeId, ...uncompletedBlockers.map((n) => n!.id)],
        });
      }
    }

    return results;
  }

  async validateGraphState(graph: TaskGraph): Promise<ValidationReport> {
    return this.validationService.validate(graph);
  }

  async validateExistingGraphs(
    graphIds?: readonly string[],
  ): Promise<Record<string, ValidationReport>> {
    // This would load graphs from storage and validate them
    // For now, return empty result
    return {};
  }
}

// ── Main Framework Implementation ─────────────────────────────────────────────

export class ValidationFrameworkImpl implements IValidationFramework {
  private globalValidators: IValidator[] = [];
  private pipelineFactory: IValidationPipelineFactory;

  constructor() {
    this.pipelineFactory = new ValidationPipelineFactory();
  }

  createValidationService(config?: Partial<ValidationConfig>): IValidationService {
    return new ValidationService(config);
  }

  createIntegration(): ITaskGraphValidationIntegration {
    return new TaskGraphValidationIntegration();
  }

  createPipelineFactory(): IValidationPipelineFactory {
    return this.pipelineFactory;
  }

  registerValidator(validator: IValidator): void {
    this.globalValidators.push(validator);
  }

  getBuiltInValidators(): readonly IValidator[] {
    return this.pipelineFactory.getBuiltInValidators();
  }
}

// ── Singleton Export ──────────────────────────────────────────────────────────

export const ValidationFramework = new ValidationFrameworkImpl();
