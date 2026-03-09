/**
 * ──────────────────────────────────────────────────────────────────────────────
 * DAG Task Graph Validation Framework Architecture
 * ──────────────────────────────────────────────────────────────────────────────
 *
 * This module provides a comprehensive validation framework for DAG task graphs,
 * designed to integrate seamlessly with the existing task-graph-plugin.ts system.
 *
 * Architecture Overview:
 * ┌─────────────────────────────────────────────────────────────────────────────┐
 * │ Validation Pipeline Flow:                                                   │
 * │                                                                             │
 * │  Input Graph → Pre-Validation → Structural → Semantic → Performance        │
 * │       ↓              ↓             ↓           ↓            ↓              │
 * │   Sanitize    Basic Checks    Topology    Business     Optimization        │
 * │                                 Logic       Rules        Analysis          │
 * │       ↓              ↓             ↓           ↓            ↓              │
 * │   Clean Data → Validation → Error Report → Warnings → Recommendations     │
 * └─────────────────────────────────────────────────────────────────────────────┘
 */

// ── Type Definitions (matching task-graph-plugin.ts) ─────────────────────────

export type NodeStatus =
  | "pending"
  | "in_progress"
  | "completed"
  | "failed"
  | "blocked"
  | "stopped"
  | "paused"
  | "waiting_approval";

export interface TaskNode {
  id: string;
  subject: string;
  status: NodeStatus;
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

export interface TaskEdge {
  from: string;
  to: string;
  type: "blocks" | "informs";
}

export interface TaskGraph {
  id: string;
  taskId: string;
  title: string;
  nodes: TaskNode[];
  edges: TaskEdge[];
  status: "active" | "completed" | "failed" | "cancelled";
  createdAt: number;
  updatedAt: number;
}

// ── Core Validation Interfaces ────────────────────────────────────────────────

/**
 * Validation severity levels for reporting
 */
export type ValidationSeverity = "error" | "warning" | "info" | "suggestion";

/**
 * Validation result for individual checks
 */
export interface ValidationResult {
  readonly valid: boolean;
  readonly severity: ValidationSeverity;
  readonly code: string;
  readonly message: string;
  readonly nodeIds?: readonly string[];
  readonly edgeIds?: readonly string[];
  readonly context?: Record<string, unknown>;
}

/**
 * Comprehensive validation report
 */
export interface ValidationReport {
  readonly valid: boolean;
  readonly graphId: string;
  readonly timestamp: number;
  readonly results: readonly ValidationResult[];
  readonly summary: {
    readonly errorCount: number;
    readonly warningCount: number;
    readonly infoCount: number;
    readonly suggestionCount: number;
  };
  readonly performance: {
    readonly validationTimeMs: number;
    readonly checksRun: number;
  };
}

/**
 * Base interface for all validators
 */
export interface IValidator {
  readonly name: string;
  readonly description: string;
  readonly category: ValidationCategory;
  validate(graph: TaskGraph, context?: ValidationContext): Promise<ValidationResult[]>;
}

/**
 * Validation categories for organizing validators
 */
export type ValidationCategory =
  | "structural"
  | "semantic"
  | "performance"
  | "security"
  | "consistency";

/**
 * Context passed to validators for additional information
 */
export interface ValidationContext {
  readonly allGraphs?: readonly TaskGraph[]; // For cross-graph validation
  readonly projectMetadata?: Record<string, unknown>;
  readonly performanceMode?: "fast" | "thorough";
  readonly skipCategories?: readonly ValidationCategory[];
}

// ── Validation Pipeline Architecture ──────────────────────────────────────────

/**
 * Multi-stage validation pipeline with configurable stages
 */
export interface IValidationPipeline {
  /**
   * Execute the full validation pipeline
   */
  validate(graph: TaskGraph, context?: ValidationContext): Promise<ValidationReport>;

  /**
   * Execute only specific validation categories
   */
  validateCategories(
    graph: TaskGraph,
    categories: readonly ValidationCategory[],
    context?: ValidationContext,
  ): Promise<ValidationReport>;

  /**
   * Register a new validator
   */
  registerValidator(validator: IValidator): void;

  /**
   * Get all registered validators by category
   */
  getValidators(category?: ValidationCategory): readonly IValidator[];
}

/**
 * Factory for creating validation pipelines with different configurations
 */
export interface IValidationPipelineFactory {
  /**
   * Create a standard validation pipeline with all built-in validators
   */
  createStandardPipeline(): IValidationPipeline;

  /**
   * Create a fast validation pipeline for runtime checks
   */
  createFastPipeline(): IValidationPipeline;

  /**
   * Create a thorough validation pipeline for design-time checks
   */
  createThoroughPipeline(): IValidationPipeline;

  /**
   * Create a custom pipeline with specific validators
   */
  createCustomPipeline(validators: readonly IValidator[]): IValidationPipeline;
}

// ── Specific Validator Interfaces ─────────────────────────────────────────────

/**
 * Structural validators check graph topology and basic consistency
 */
export interface IStructuralValidator extends IValidator {
  readonly category: "structural";
}

/**
 * Semantic validators check business logic and domain rules
 */
export interface ISemanticValidator extends IValidator {
  readonly category: "semantic";
}

/**
 * Performance validators analyze efficiency and optimization opportunities
 */
export interface IPerformanceValidator extends IValidator {
  readonly category: "performance";
}

/**
 * Cross-graph validator for validating relationships between multiple graphs
 */
export interface ICrossGraphValidator extends IValidator {
  validateGraphs(
    graphs: readonly TaskGraph[],
    context?: ValidationContext,
  ): Promise<ValidationResult[]>;
}

// ── Built-in Validator Specifications ─────────────────────────────────────────

/**
 * Cycle Detection Validator
 * Detects circular dependencies using DFS-based algorithm
 */
export interface ICycleDetectionValidator extends IStructuralValidator {
  /**
   * Find all cycles in the graph
   * @returns Array of cycles, each cycle is an array of node IDs
   */
  findCycles(graph: TaskGraph): Promise<string[][]>;

  /**
   * Check if adding an edge would create a cycle
   */
  wouldCreateCycle(graph: TaskGraph, fromId: string, toId: string): Promise<boolean>;
}

/**
 * Topological Ordering Validator
 * Validates that the graph has a valid topological ordering
 */
export interface ITopologicalValidator extends IStructuralValidator {
  /**
   * Generate a topological ordering of nodes
   * @returns Ordered array of node IDs, or null if impossible
   */
  getTopologicalOrder(graph: TaskGraph): Promise<string[] | null>;

  /**
   * Check if the graph is a DAG (has valid topological ordering)
   */
  isValidDAG(graph: TaskGraph): Promise<boolean>;
}

/**
 * Node Connectivity Validator
 * Validates node relationships and reachability
 */
export interface IConnectivityValidator extends IStructuralValidator {
  /**
   * Find nodes that are unreachable from any root nodes
   */
  findUnreachableNodes(graph: TaskGraph): Promise<string[]>;

  /**
   * Find nodes with no dependencies (potential root nodes)
   */
  findRootNodes(graph: TaskGraph): Promise<string[]>;

  /**
   * Find nodes with no dependents (potential leaf nodes)
   */
  findLeafNodes(graph: TaskGraph): Promise<string[]>;
}

/**
 * Edge Validation for advanced edge relationship checks
 */
export interface IEdgeValidator extends IStructuralValidator {
  /**
   * Validate edge consistency (no duplicate edges, valid node references)
   */
  validateEdgeConsistency(graph: TaskGraph): Promise<ValidationResult[]>;

  /**
   * Check for redundant edges (edges that don't affect execution order)
   */
  findRedundantEdges(graph: TaskGraph): Promise<TaskEdge[]>;

  /**
   * Validate edge types are used correctly
   */
  validateEdgeTypes(graph: TaskGraph): Promise<ValidationResult[]>;
}

// ── Performance Analysis Interfaces ───────────────────────────────────────────

/**
 * Graph complexity metrics
 */
export interface GraphMetrics {
  readonly nodeCount: number;
  readonly edgeCount: number;
  readonly maxDepth: number;
  readonly maxFanOut: number;
  readonly maxFanIn: number;
  readonly criticalPathLength: number;
  readonly parallelizationFactor: number;
  readonly cyclomaticComplexity: number;
}

/**
 * Performance Analysis Validator
 */
export interface IPerformanceAnalyzer extends IPerformanceValidator {
  /**
   * Calculate comprehensive graph metrics
   */
  calculateMetrics(graph: TaskGraph): Promise<GraphMetrics>;

  /**
   * Find the critical path (longest path through the graph)
   */
  findCriticalPath(graph: TaskGraph): Promise<string[]>;

  /**
   * Analyze parallelization opportunities
   */
  analyzeParallelization(graph: TaskGraph): Promise<{
    maxParallelNodes: number;
    parallelStages: string[][];
    bottlenecks: string[];
  }>;

  /**
   * Suggest optimizations for better performance
   */
  suggestOptimizations(graph: TaskGraph): Promise<ValidationResult[]>;
}

// ── Cross-File Validation Architecture ────────────────────────────────────────

/**
 * Cross-graph relationship types
 */
export type CrossGraphRelationType =
  | "dependency"
  | "communication"
  | "resource_sharing"
  | "data_flow";

/**
 * Cross-graph relationship definition
 */
export interface CrossGraphRelation {
  readonly type: CrossGraphRelationType;
  readonly sourceGraphId: string;
  readonly targetGraphId: string;
  readonly sourceNodeId?: string;
  readonly targetNodeId?: string;
  readonly metadata?: Record<string, unknown>;
}

/**
 * Cross-graph consistency validator
 */
export interface ICrossGraphConsistencyValidator extends ICrossGraphValidator {
  /**
   * Validate relationships between multiple task graphs
   */
  validateRelationships(
    graphs: readonly TaskGraph[],
    relations: readonly CrossGraphRelation[],
  ): Promise<ValidationResult[]>;

  /**
   * Check for conflicts between graphs (resource conflicts, timing conflicts)
   */
  findConflicts(graphs: readonly TaskGraph[]): Promise<ValidationResult[]>;

  /**
   * Validate data flow consistency across graphs
   */
  validateDataFlow(
    graphs: readonly TaskGraph[],
    dataFlowSpecs: readonly CrossGraphRelation[],
  ): Promise<ValidationResult[]>;
}

// ── Error Recovery and Correction ─────────────────────────────────────────────

/**
 * Automatic correction capability for validators
 */
export interface ICorrectableValidator extends IValidator {
  /**
   * Check if this validator can automatically fix issues it detects
   */
  canAutoCorrect(result: ValidationResult): boolean;

  /**
   * Apply automatic corrections to the graph
   * @returns Modified graph and description of changes made
   */
  autoCorrect(
    graph: TaskGraph,
    result: ValidationResult,
  ): Promise<{
    correctedGraph: TaskGraph;
    corrections: string[];
  }>;
}

/**
 * Validation recovery strategies
 */
export interface IValidationRecovery {
  /**
   * Attempt to recover from validation failures
   */
  recoverFromFailures(
    graph: TaskGraph,
    failures: readonly ValidationResult[],
  ): Promise<{
    recoveredGraph: TaskGraph;
    unrecoverableIssues: readonly ValidationResult[];
    appliedFixes: readonly string[];
  }>;
}

// ── Integration Strategy with Existing System ─────────────────────────────────

/**
 * Integration points with task-graph-plugin.ts
 */
export interface ITaskGraphValidationIntegration {
  /**
   * Validate during graph creation (pre-creation validation)
   */
  validateBeforeCreate(
    nodes: Array<{ subject: string; agentType: string; maxRetries?: number }>,
    edges: Array<{ fromIndex: number; toIndex: number; type?: "blocks" | "informs" }>,
  ): Promise<ValidationReport>;

  /**
   * Validate during node updates (runtime validation)
   */
  validateNodeUpdate(
    graph: TaskGraph,
    nodeId: string,
    newStatus: NodeStatus,
  ): Promise<ValidationResult[]>;

  /**
   * Validate graph state consistency (post-operation validation)
   */
  validateGraphState(graph: TaskGraph): Promise<ValidationReport>;

  /**
   * Background validation for existing graphs
   */
  validateExistingGraphs(graphIds?: readonly string[]): Promise<Record<string, ValidationReport>>;
}

// ── Configuration and Customization ───────────────────────────────────────────

/**
 * Validation configuration options
 */
export interface ValidationConfig {
  readonly enabledCategories: readonly ValidationCategory[];
  readonly strictMode: boolean;
  readonly performanceMode: "fast" | "balanced" | "thorough";
  readonly maxGraphSize: number;
  readonly timeoutMs: number;
  readonly customValidators: readonly IValidator[];
  readonly autoCorrection: {
    readonly enabled: boolean;
    readonly maxAttempts: number;
    readonly allowedCorrections: readonly string[];
  };
}

/**
 * Validation rule configuration
 */
export interface ValidationRule {
  readonly id: string;
  readonly enabled: boolean;
  readonly severity: ValidationSeverity;
  readonly parameters?: Record<string, unknown>;
}

/**
 * Configurable validation service
 */
export interface IValidationService {
  /**
   * Update validation configuration
   */
  configure(config: Partial<ValidationConfig>): void;

  /**
   * Enable/disable specific validation rules
   */
  configureRule(ruleId: string, config: Partial<ValidationRule>): void;

  /**
   * Get current configuration
   */
  getConfiguration(): ValidationConfig;

  /**
   * Validate with current configuration
   */
  validate(graph: TaskGraph, context?: ValidationContext): Promise<ValidationReport>;
}

// ── Algorithm Efficiency Specifications ──────────────────────────────────────

/**
 * Performance requirements for validation algorithms
 */
export interface AlgorithmRequirements {
  /**
   * Cycle Detection: O(V + E) using DFS
   * - Tarjan's algorithm for strongly connected components
   * - Early termination on first cycle found in fast mode
   */
  readonly cycleDetection: {
    readonly timeComplexity: "O(V + E)";
    readonly spaceComplexity: "O(V)";
    readonly algorithm: "Tarjan SCC" | "DFS with coloring";
  };

  /**
   * Topological Sort: O(V + E) using Kahn's algorithm or DFS
   * - Kahn's algorithm for stable ordering
   * - DFS-based for memory efficiency
   */
  readonly topologicalSort: {
    readonly timeComplexity: "O(V + E)";
    readonly spaceComplexity: "O(V)";
    readonly algorithm: "Kahn" | "DFS-based";
  };

  /**
   * Reachability Analysis: O(V + E) per source node
   * - BFS/DFS from each potential root
   * - Union-Find for connected components
   */
  readonly reachabilityAnalysis: {
    readonly timeComplexity: "O(V * (V + E))";
    readonly spaceComplexity: "O(V)";
    readonly algorithm: "BFS" | "DFS" | "Union-Find";
  };
}

// ── Error Handling Strategy ───────────────────────────────────────────────────

/**
 * Validation failure modes and recovery strategies
 */
export interface ValidationFailureMode {
  readonly type: "timeout" | "memory_limit" | "invalid_structure" | "corrupted_data";
  readonly severity: "fatal" | "recoverable";
  readonly recoveryStrategy: "retry" | "fallback" | "skip" | "abort";
  readonly maxRetries?: number;
}

/**
 * Error handling configuration
 */
export interface ErrorHandlingConfig {
  readonly failureModes: readonly ValidationFailureMode[];
  readonly gracefulDegradation: boolean;
  readonly reportPartialResults: boolean;
  readonly validateInBatches: boolean;
  readonly batchSize: number;
}

// ── Export Strategy ───────────────────────────────────────────────────────────

/**
 * Main validation framework factory - primary entry point
 */
export interface IValidationFramework {
  /**
   * Create a validation service with default configuration
   */
  createValidationService(config?: Partial<ValidationConfig>): IValidationService;

  /**
   * Create integration helper for task-graph-plugin.ts
   */
  createIntegration(): ITaskGraphValidationIntegration;

  /**
   * Create pipeline factory for custom validation workflows
   */
  createPipelineFactory(): IValidationPipelineFactory;

  /**
   * Register custom validators globally
   */
  registerValidator(validator: IValidator): void;

  /**
   * Get all available built-in validators
   */
  getBuiltInValidators(): readonly IValidator[];
}

/**
 * Framework instance - singleton for the validation system
 */
export declare const ValidationFramework: IValidationFramework;

// ── Integration Example ───────────────────────────────────────────────────────

/**
 * Example integration pattern with existing task-graph-plugin.ts:
 *
 * ```typescript
 * // In task-graph-plugin.ts modifications:
 * import { ValidationFramework } from "./task-graph-validation";
 *
 * const validationIntegration = ValidationFramework.createIntegration();
 *
 * // Before graph creation:
 * const preValidation = await validationIntegration.validateBeforeCreate(nodes, edges);
 * if (!preValidation.valid) {
 *   return JSON.stringify({
 *     error: "Validation failed",
 *     details: preValidation.results
 *   });
 * }
 *
 * // After graph creation:
 * const postValidation = await validationIntegration.validateGraphState(graph);
 * if (!postValidation.valid) {
 *   // Log warnings but don't fail creation
 *   console.warn("Graph validation warnings:", postValidation.results);
 * }
 *
 * // During node updates:
 * const updateValidation = await validationIntegration.validateNodeUpdate(
 *   graph, nodeId, newStatus
 * );
 * if (updateValidation.some(r => r.severity === "error")) {
 *   return JSON.stringify({
 *     error: "Invalid state transition",
 *     details: updateValidation
 *   });
 * }
 * ```
 */

// ── Performance Optimization Strategy ─────────────────────────────────────────

/**
 * Optimization strategies for large graphs (1000+ nodes):
 *
 * 1. **Incremental Validation**: Only validate changed portions
 * 2. **Caching**: Cache validation results with invalidation
 * 3. **Parallel Processing**: Run independent validators concurrently
 * 4. **Early Termination**: Stop on first error in strict mode
 * 5. **Sampling**: Statistical validation for very large graphs
 * 6. **Lazy Loading**: Load validation rules on demand
 */
export interface OptimizationStrategy {
  readonly incrementalValidation: boolean;
  readonly resultCaching: boolean;
  readonly parallelValidation: boolean;
  readonly earlyTermination: boolean;
  readonly samplingThreshold: number;
  readonly lazyRuleLoading: boolean;
}

/**
 * Validation performance monitor
 */
export interface IValidationPerformanceMonitor {
  startValidation(graphId: string, nodeCount: number): void;
  recordValidatorExecution(validatorName: string, durationMs: number): void;
  finishValidation(graphId: string, totalDurationMs: number): void;
  getMetrics(): {
    averageValidationTime: number;
    slowestValidators: Array<{ name: string; avgDuration: number }>;
    graphSizeCorrelation: number;
  };
}
