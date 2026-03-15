# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

### Build and Development

- `bun run build` - Compile TypeScript to dist/ and make executables
- `bun run dev` - Start TypeScript compiler in watch mode for development
- `bun run start` - Run the compiled server from dist/index.js
- `bun run test` - Run all tests using Vitest

### Testing and Quality

- `bun run test` - Execute the complete test suite with custom sequencer (kubectl tests run last)
- Tests have 120s timeout and 60s hook timeout due to Kubernetes operations
- Use `npx @modelcontextprotocol/inspector node dist/index.js` for local testing with Inspector
- Always run single test based on with area you are working on. running all tests will take a long time.

### Local Development Testing

- `bun run chat` - Test locally with mcp-chat CLI client
- For Claude Desktop testing, point to local `dist/index.js` build

## Architecture Overview

This is an MCP (Model Context Protocol) server that provides Kubernetes cluster management capabilities. The server connects to Kubernetes clusters via kubectl and offers both read-only and destructive operations.

### Core Components

**KubernetesManager** (`src/utils/kubernetes-manager.ts`): Central class managing Kubernetes API connections, resource tracking, port forwards, and watches. Handles kubeconfig loading from multiple sources in priority order.

**Tool Structure**: Each Kubernetes operation is implemented as a separate tool in `src/tools/`, with corresponding Zod schemas for validation. Tools are divided into:

- kubectl operations (get, describe, apply, delete, create, etc.)
- Helm operations (install, upgrade, uninstall charts)
- Specialized operations (port forwarding, scaling, rollouts)

**Resource Handlers** (`src/resources/handlers.ts`): Manage MCP resource endpoints for dynamic data retrieval.

**Configuration System** (`src/config/`): Contains schemas and templates for deployments, namespaces, containers, and cleanup operations.

### Key Architecture Patterns

- **Tool Filtering**: Non-destructive mode dynamically removes destructive tools based on `ALLOW_ONLY_NON_DESTRUCTIVE_TOOLS` environment variable
- **Unified kubectl API**: Consistent interface across all kubectl operations with standardized error handling
- **Resource Tracking**: All created resources are tracked for cleanup capabilities
- **Transport Flexibility**: Supports both StdioTransport and SSE transport for different integration scenarios

### Request Flow

1. Client sends MCP request via transport layer
2. Server filters available tools based on destructive/non-destructive mode
3. Request routed to appropriate handler (tools/resources)
4. KubernetesManager executes Kubernetes API calls
5. Responses formatted and returned through transport

## Development Guidelines

### Adding New Tools

- Create new tool file in `src/tools/` with Zod schema export
- Import and register in `src/index.ts` main server setup
- Add to destructive/non-destructive filtering logic as appropriate
- Include comprehensive error handling for Kubernetes API failures

### Testing Strategy

- Unit tests focus on tool functionality and schema validation
- Integration tests verify actual Kubernetes operations
- Custom test sequencer ensures kubectl tests run last (they modify cluster state)
- Tests require active Kubernetes cluster connection

### Configuration Handling

- Server loads kubeconfig from multiple sources: KUBECONFIG_YAML env var, KUBECONFIG path, or ~/.kube/config
- Supports multiple kubectl contexts with context switching capabilities
- Environment variables control server behavior (non-destructive mode, custom kubeconfig paths)

## Kubernetes Integration Details

The server requires:

- kubectl installed and accessible in PATH
- Valid kubeconfig with configured contexts
- Active Kubernetes cluster connection
- Helm v3 for chart operations (optional)

**Non-destructive mode** disables: kubectl_delete, uninstall_helm_chart, cleanup operations, and kubectl_generic (which could contain destructive commands).


---

## Referenced Files

> The following files are referenced in this skill and included for context.

### src/utils/kubernetes-manager.ts

```typescript
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import * as k8s from "@kubernetes/client-node";

import { ResourceTracker, PortForwardTracker, WatchTracker } from "../types.js";

export class KubernetesManager {
  private resources: ResourceTracker[] = [];
  private portForwards: PortForwardTracker[] = [];
  private watches: WatchTracker[] = [];
  private kc: k8s.KubeConfig;
  private k8sApi: k8s.CoreV1Api;
  private k8sAppsApi: k8s.AppsV1Api;
  private k8sBatchApi: k8s.BatchV1Api;

  constructor() {
    this.kc = new k8s.KubeConfig();

    if (this.hasEnvKubeconfigYaml()) {
      // Priority 1: Full kubeconfig as YAML string
      try {
        this.loadEnvKubeconfigYaml();
        this.createTempKubeconfigFromYaml(process.env.KUBECONFIG_YAML!);
      } catch (error) {
        throw new Error(
          `Failed to parse KUBECONFIG_YAML: ${
            error instanceof Error ? error.message : "Unknown error"
          }`
        );
      }
    } else if (this.isRunningInCluster()) {
      // Priority 2: Check if running in cluster
      this.kc.loadFromCluster();
    } else if (this.hasEnvKubeconfigJson()) {
      // Priority 3: Full kubeconfig as JSON string
      try {
        this.loadEnvKubeconfigJson();
        // Create temp kubeconfig file for kubectl commands from JSON
        const yamlConfig = this.kc.exportConfig();
        this.createTempKubeconfigFromYaml(yamlConfig);
      } catch (error) {
        throw new Error(
          `Failed to parse KUBECONFIG_JSON: ${
            error instanceof Error ? error.message : "Unknown error"
          }`
        );
      }
    } else if (this.hasEnvMinimalKubeconfig()) {
      // Priority 4: Minimal config with individual environment variables
      try {
        this.loadEnvMinimalKubeconfig();
        // Create temp kubeconfig file for kubectl commands from minimal config
        const yamlConfig = this.kc.exportConfig();
        this.createTempKubeconfigFromYaml(yamlConfig);
      } catch (error) {
        throw new Error(
          `Failed to create kubeconfig from K8S_SERVER and K8S_TOKEN: ${
            error instanceof Error ? error.message : "Unknown error"
          }`
        );
      }
    } else if (this.hasEnvKubeconfigPath()) {
      // Priority 5: Custom kubeconfig file path using KUBECONFIG_PATH
      try {
        this.loadEnvKubeconfigPath();
        // Set KUBECONFIG environment variable to the custom path for kubectl commands
        process.env.KUBECONFIG = process.env.KUBECONFIG_PATH;
      } catch (error) {
        throw new Error(
          `Failed to load kubeconfig from KUBECONFIG_PATH: ${
            error instanceof Error ? error.message : "Unknown error"
          }`
        );
      }
    } else if (this.hasEnvKubeconfig()) {
      // Load from KUBECONFIG
      this.kc.loadFromFile(process.env.KUBECONFIG!);
    } else {
      // Priority 7: Default file-based configuration (existing fallback)
      this.kc.loadFromDefault();
    }

    // Apply context override if specified
    if (process.env.K8S_CONTEXT) {
      try {
        this.setCurrentContext(process.env.K8S_CONTEXT);
      } catch (error) {
        console.warn(
          `Warning: Could not set context to ${process.env.K8S_CONTEXT}: ${
            error instanceof Error ? error.message : "Unknown error"
          }`
        );
      }
    }

    // Initialize API clients
    this.k8sApi = this.kc.makeApiClient(k8s.CoreV1Api);
    this.k8sAppsApi = this.kc.makeApiClient(k8s.AppsV1Api);
    this.k8sBatchApi = this.kc.makeApiClient(k8s.BatchV1Api);
  }

  /**
   * A very simple test to check if the application is running inside a Kubernetes cluster
   */
  private isRunningInCluster(): boolean {
    const serviceAccountPath =
      "/var/run/secrets/kubernetes.io/serviceaccount/token";
    try {
      return fs.existsSync(serviceAccountPath);
    } catch {
      return false;
    }
  }

  /**
   * Check if KUBECONFIG_YAML environment variable is available
   */
  private hasEnvKubeconfigYaml(): boolean {
    return !!(
      process.env.KUBECONFIG_YAML && process.env.KUBECONFIG_YAML.trim()
    );
  }

  /**
   * Check if KUBECONFIG_JSON environment variable is available
   */
  private hasEnvKubeconfigJson(): boolean {
    return !!(
      process.env.KUBECONFIG_JSON && process.env.KUBECONFIG_JSON.trim()
    );
  }

  /**
   * Check if minimal K8S_SERVER and K8S_TOKEN environment variables are available
   */
  private hasEnvMinimalKubeconfig(): boolean {
    return !!(
      process.env.K8S_SERVER &&
      process.env.K8S_SERVER.trim() &&
      process.env.K8S_TOKEN &&
      process.env.K8S_TOKEN.trim()
    );
  }

  /**
   * Load kubeconfig from KUBECONFIG_PATH environment variable (file path)
   */
  private loadEnvKubeconfigPath(): void {
    this.kc.loadFromFile(process.env.KUBECONFIG_PATH!);
  }

  /**
   * Load kubeconfig from KUBECONFIG_YAML environment variable (YAML format)
   */
  private loadEnvKubeconfigYaml(): void {
    if (!process.env.KUBECONFIG_YAML) {
      throw new Error("KUBECONFIG_YAML environment variable is not set");
    }

    // Load the config into the JavaScript client
    this.kc.loadFromString(process.env.KUBECONFIG_YAML);
  }

  /**
   * Load kubeconfig from KUBECONFIG_JSON environment variable (JSON format)
   */
  private loadEnvKubeconfigJson(): void {
    const configObj = JSON.parse(process.env.KUBECONFIG_JSON!);
    this.kc.loadFromOptions(configObj);
  }

  /**
   * Load kubeconfig from minimal K8S_SERVER and K8S_TOKEN environment variables
   */
  private loadEnvMinimalKubeconfig(): void {
    if (!process.env.K8S_SERVER || !process.env.K8S_TOKEN) {
      throw new Error(
        "K8S_SERVER and K8S_TOKEN environment variables are required"
      );
    }

    const cluster = {
      name: "env-cluster",
      server: process.env.K8S_SERVER,
      skipTLSVerify: process.env.K8S_SKIP_TLS_VERIFY === "true",
    };

    const user = {
      name: "env-user",
      token: process.env.K8S_TOKEN,
    };

    const context = {
      name: "env-context",
      user: user.name,
      cluster: cluster.name,
    };

    const kubeconfigContent = {
      clusters: [cluster],
      users: [user],
      contexts: [context],
      currentContext: context.name,
    };

    this.kc.loadFromOptions(kubeconfigContent);
  }

  /**
   * Check if KUBECONFIG_PATH environment variable is available
   */
  private hasEnvKubeconfigPath(): boolean {
    return !!(
      process.env.KUBECONFIG_PATH && process.env.KUBECONFIG_PATH.trim()
    );
  }

  private hasEnvKubeconfig(): boolean {
    return !!(process.env.KUBECONFIG && process.env.KUBECONFIG.trim());
  }

  /**
   * Set the current context to the desired context name.
   *
   * @param contextName
   */
  public setCurrentContext(contextName: string) {
    // Get all available contexts
    const contexts = this.kc.getContexts();
    const contextNames = contexts.map((context) => context.name);

    // Check if the requested context exists
    if (!contextNames.includes(contextName)) {
      throw new Error(
        `Context '${contextName}' not found. Available contexts: ${contextNames.join(
          ", "
        )}`
      );
    }
    // Set the current context
    this.kc.setCurrentContext(contextName);
    this.k8sApi = this.kc.makeApiClient(k8s.CoreV1Api);
    this.k8sAppsApi = this.kc.makeApiClient(k8s.AppsV1Api);
    this.k8sBatchApi = this.kc.makeApiClient(k8s.BatchV1Api);
  }

  async cleanup() {
    // Stop watches
    for (const watch of this.watches) {
      watch.abort.abort();
    }

    // Delete tracked resources in reverse order
    for (const resource of [...this.resources].reverse()) {
      try {
        await this.deleteResource(
          resource.kind,
          resource.name,
          resource.namespace
        );
      } catch (error) {
        process.stderr.write(
          `Failed to delete ${resource.kind} ${resource.name}: ${error}\n`
        );
      }
    }
  }

  trackResource(kind: string, name: string, namespace: string) {
    this.resources.push({ kind, name, namespace, createdAt: new Date() });
  }

  async deleteResource(kind: string, name: string, namespace: string) {
    switch (kind.toLowerCase()) {
      case "pod":
        await this.k8sApi.deleteNamespacedPod({ name, namespace });
        break;
      case "deployment":
        await this.k8sAppsApi.deleteNamespacedDeployment({ name, namespace });
        break;
      case "service":
        await this.k8sApi.deleteNamespacedService({ name, namespace });
        break;
      case "cronjob":
        await this.k8sBatchApi.deleteNamespacedCronJob({ name, namespace });
        break;
    }
    this.resources = this.resources.filter(
      (r) => !(r.kind === kind && r.name === name && r.namespace === namespace)
    );
  }

  trackPortForward(pf: PortForwardTracker) {
    this.portForwards.push(pf);
  }

  getPortForward(id: string) {
    return this.portForwards.find((p) => p.id === id);
  }

  removePortForward(id: string) {
    this.portForwards = this.portForwards.filter((p) => p.id !== id);
  }

  trackWatch(watch: WatchTracker) {
    this.watches.push(watch);
  }

  getKubeConfig() {
    return this.kc;
  }

  getCoreApi() {
    return this.k8sApi;
  }

  getAppsApi() {
    return this.k8sAppsApi;
  }

  getBatchApi() {
    return this.k8sBatchApi;
  }

  /**
   * Get the default namespace for operations
   * Uses K8S_NAMESPACE environment variable if set, otherwise defaults to "default"
   */
  getDefaultNamespace(): string {
    return process.env.K8S_NAMESPACE || "default";
  }

  /**
   * Create temporary kubeconfig file from YAML content for kubectl commands
   * @param kubeconfigYaml YAML content of the kubeconfig
   */
  private createTempKubeconfigFromYaml(kubeconfigYaml: string): void {
    try {
      if (!kubeconfigYaml || typeof kubeconfigYaml !== "string") {
        throw new Error(`Invalid kubeconfigYaml: ${typeof kubeconfigYaml}`);
      }

      const tempDir = os.tmpdir();
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const randomString = Math.random().toString(36).substring(2);
      const tempKubeconfigPath = path.join(
        tempDir,
        `kubeconfig-${timestamp}-${randomString}`
      );

      // Write temporary kubeconfig file
      fs.writeFileSync(tempKubeconfigPath, kubeconfigYaml, {
        mode: 0o600,
        encoding: "utf8",
      });

      // Set KUBECONFIG environment variable for kubectl commands
      process.env.KUBECONFIG = tempKubeconfigPath;

      // Function to clean up the temporary file
      const cleanupTempFile = () => {
        try {
          if (fs.existsSync(tempKubeconfigPath)) {
            fs.unlinkSync(tempKubeconfigPath);
          }
        } catch (cleanupError) {
          // Ignore cleanup errors
        }
      };

      // Schedule cleanup of temporary file when process exits
      process.on("exit", cleanupTempFile);

      // Also clean up on SIGINT and SIGTERM (common in Docker containers)
      ["SIGINT", "SIGTERM"].forEach((signal) => {
        process.on(signal, () => {
          cleanupTempFile();
          process.exit(0);
        });
      });

      // Additional cleanup for Docker container lifecycle
      ["SIGUSR1", "SIGUSR2"].forEach((signal) => {
        process.on(signal, cleanupTempFile);
      });
    } catch (error) {
      // Continue without temporary file - kubectl commands may fail but JavaScript client will work
      throw error;
    }
  }
}

```

### src/resources/handlers.ts

```typescript
import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import { KubernetesManager } from "../types.js";

export const getResourceHandlers = (k8sManager: KubernetesManager) => ({
  listResources: async () => {
    return {
      resources: [
        {
          uri: "k8s://default/pods",
          name: "Kubernetes Pods",
          mimeType: "application/json",
          description: "List of pods in the default namespace",
        },
        {
          uri: "k8s://default/deployments",
          name: "Kubernetes Deployments",
          mimeType: "application/json",
          description: "List of deployments in the default namespace",
        },
        {
          uri: "k8s://default/services",
          name: "Kubernetes Services",
          mimeType: "application/json",
          description: "List of services in the default namespace",
        },
        {
          uri: "k8s://namespaces",
          name: "Kubernetes Namespaces",
          mimeType: "application/json",
          description: "List of all namespaces",
        },
        {
          uri: "k8s://nodes",
          name: "Kubernetes Nodes",
          mimeType: "application/json",
          description: "List of all nodes in the cluster",
        },
      ],
    };
  },

  readResource: async (request: { params: { uri: string } }) => {
    try {
      const uri = request.params.uri;
      const parts = uri.replace("k8s://", "").split("/");

      const isNamespaces = parts[0] === "namespaces";
      const isNodes = parts[0] === "nodes";
      if ((isNamespaces || isNodes) && parts.length === 1) {
        const fn = isNodes ? "listNode" : "listNamespace";
        const { items } = await k8sManager.getCoreApi()[fn]();
        return {
          contents: [
            {
              uri: request.params.uri,
              mimeType: "application/json",
              text: JSON.stringify(items, null, 2),
            },
          ],
        };
      }

      const [namespace, resourceType] = parts;

      switch (resourceType) {
        case "pods": {
          const { items } = await k8sManager
            .getCoreApi()
            .listNamespacedPod({ namespace });
          return {
            contents: [
              {
                uri: request.params.uri,
                mimeType: "application/json",
                text: JSON.stringify(items, null, 2),
              },
            ],
          };
        }
        case "deployments": {
          const { items } = await k8sManager
            .getAppsApi()
            .listNamespacedDeployment({ namespace });
          return {
            contents: [
              {
                uri: request.params.uri,
                mimeType: "application/json",
                text: JSON.stringify(items, null, 2),
              },
            ],
          };
        }
        case "services": {
          const { items } = await k8sManager
            .getCoreApi()
            .listNamespacedService({ namespace });
          return {
            contents: [
              {
                uri: request.params.uri,
                mimeType: "application/json",
                text: JSON.stringify(items, null, 2),
              },
            ],
          };
        }
        default:
          throw new McpError(
            ErrorCode.InvalidRequest,
            `Unsupported resource type: ${resourceType}`
          );
      }
    } catch (error) {
      if (error instanceof McpError) throw error;
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to read resource: ${error}`
      );
    }
  },
});

```

### src/index.ts

```typescript
#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  installHelmChart,
  installHelmChartSchema,
  upgradeHelmChart,
  upgradeHelmChartSchema,
  uninstallHelmChart,
  uninstallHelmChartSchema,
} from "./tools/helm-operations.js";



import {
  nodeManagement,
  nodeManagementSchema,
} from "./tools/node-management.js";
import {
  explainResource,
  explainResourceSchema,
  listApiResources,
  listApiResourcesSchema,
} from "./tools/kubectl-operations.js";
import { execInPod, execInPodSchema } from "./tools/exec_in_pod.js";
import { getResourceHandlers } from "./resources/handlers.js";
import {
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  ListToolsRequestSchema,
  CallToolRequestSchema,
  ErrorCode,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import { KubernetesManager } from "./types.js";
import { serverConfig } from "./config/server-config.js";
import { cleanupSchema } from "./config/cleanup-config.js";
import { startSSEServer } from "./utils/sse.js";
import {
  startPortForward,
  PortForwardSchema,
  stopPortForward,
  StopPortForwardSchema,
} from "./tools/port_forward.js";
import { kubectlScale, kubectlScaleSchema } from "./tools/kubectl-scale.js";
import {
  kubectlContext,
  kubectlContextSchema,
} from "./tools/kubectl-context.js";
import { kubectlGet, kubectlGetSchema } from "./tools/kubectl-get.js";
import {
  kubectlDescribe,
  kubectlDescribeSchema,
} from "./tools/kubectl-describe.js";
import { kubectlApply, kubectlApplySchema } from "./tools/kubectl-apply.js";
import { kubectlDelete, kubectlDeleteSchema } from "./tools/kubectl-delete.js";
import { kubectlCreate, kubectlCreateSchema } from "./tools/kubectl-create.js";
import { kubectlLogs, kubectlLogsSchema } from "./tools/kubectl-logs.js";
import {
  kubectlGeneric,
  kubectlGenericSchema,
} from "./tools/kubectl-generic.js";
import { kubectlPatch, kubectlPatchSchema } from "./tools/kubectl-patch.js";
import {
  kubectlRollout,
  kubectlRolloutSchema,
} from "./tools/kubectl-rollout.js";
import { registerPromptHandlers } from "./prompts/index.js";
import { ping, pingSchema } from "./tools/ping.js";
import { startStreamableHTTPServer } from "./utils/streamable-http.js";

// Check environment variables for tool filtering
const allowOnlyReadonlyTools = process.env.ALLOW_ONLY_READONLY_TOOLS === "true";
const allowedToolsEnv = process.env.ALLOWED_TOOLS;
const nonDestructiveTools =
  process.env.ALLOW_ONLY_NON_DESTRUCTIVE_TOOLS === "true";

// Define readonly tools
const readonlyTools = [
  kubectlGetSchema,
  kubectlDescribeSchema,
  kubectlLogsSchema,
  kubectlContextSchema,
  explainResourceSchema,
  listApiResourcesSchema,
  pingSchema,
];

// Define destructive tools (delete and uninstall operations)
const destructiveTools = [
  kubectlDeleteSchema, // This replaces all individual delete operations
  uninstallHelmChartSchema,
  cleanupSchema, // Cleanup is also destructive as it deletes resources
  kubectlGenericSchema, // Generic kubectl command can perform destructive operations

  nodeManagementSchema, // Node management can drain nodes (destructive)
];

// Get all available tools
const allTools = [
  // Core operation tools
  cleanupSchema,

  // Unified kubectl-style tools - these replace many specific tools
  kubectlGetSchema,
  kubectlDescribeSchema,
  kubectlApplySchema,
  kubectlDeleteSchema,
  kubectlCreateSchema,
  kubectlLogsSchema,
  kubectlScaleSchema,
  kubectlPatchSchema,
  kubectlRolloutSchema,

  // Kubernetes context management
  kubectlContextSchema,

  // Special operations that aren't covered by simple kubectl commands
  explainResourceSchema,

  // Helm operations
  installHelmChartSchema,
  upgradeHelmChartSchema,
  uninstallHelmChartSchema,

  nodeManagementSchema,

  // Port forwarding
  PortForwardSchema,
  StopPortForwardSchema,
  execInPodSchema,

  // API resource operations
  listApiResourcesSchema,
  // Generic kubectl command
  kubectlGenericSchema,

  // Ping utility
  pingSchema,
];

const k8sManager = new KubernetesManager();

const server = new Server(
  {
    name: serverConfig.name,
    version: serverConfig.version,
  },
  {
    ...serverConfig,
    capabilities: {
      prompts: {},
      ...serverConfig.capabilities,
    },
  }
);

// Resources handlers
const resourceHandlers = getResourceHandlers(k8sManager);
server.setRequestHandler(
  ListResourcesRequestSchema,
  resourceHandlers.listResources
);
server.setRequestHandler(
  ReadResourceRequestSchema,
  resourceHandlers.readResource
);

// Register prompt handlers
registerPromptHandlers(server, k8sManager);

// Tools handlers
server.setRequestHandler(ListToolsRequestSchema, async () => {
  let tools;

  if (allowedToolsEnv) {
    const allowedToolNames = allowedToolsEnv.split(",").map((t) => t.trim());
    tools = allTools.filter((tool) => allowedToolNames.includes(tool.name));
  } else if (allowOnlyReadonlyTools) {
    tools = readonlyTools;
  } else if (nonDestructiveTools) {
    tools = allTools.filter(
      (tool) => !destructiveTools.some((dt) => dt.name === tool.name)
    );
  } else {
    tools = allTools;
  }

  return { tools };
});

server.setRequestHandler(
  CallToolRequestSchema,
  async (request: {
    params: { name: string; _meta?: any; arguments?: Record<string, any> };
    method: string;
  }) => {
    try {
      const { name, arguments: input = {} } = request.params;

      // Handle new kubectl-style commands
      if (name === "kubectl_context") {
        return await kubectlContext(
          k8sManager,
          input as {
            operation: "list" | "get" | "set";
            name?: string;
            showCurrent?: boolean;
            detailed?: boolean;
            output?: string;
            context?: string;
          }
        );
      }

      if (name === "kubectl_get") {
        return await kubectlGet(
          k8sManager,
          input as {
            resourceType: string;
            name?: string;
            namespace?: string;
            output?: string;
            allNamespaces?: boolean;
            labelSelector?: string;
            fieldSelector?: string;
            sortBy?: string;
            context?: string;
          }
        );
      }

      if (name === "kubectl_describe") {
        return await kubectlDescribe(
          k8sManager,
          input as {
            resourceType: string;
            name: string;
            namespace?: string;
            allNamespaces?: boolean;
            context?: string;
          }
        );
      }

      if (name === "kubectl_apply") {
        return await kubectlApply(
          k8sManager,
          input as {
            manifest?: string;
            filename?: string;
            namespace?: string;
            dryRun?: boolean;
            force?: boolean;
            context?: string;
          }
        );
      }

      if (name === "kubectl_delete") {
        return await kubectlDelete(
          k8sManager,
          input as {
            resourceType?: string;
            name?: string;
            namespace?: string;
            labelSelector?: string;
            manifest?: string;
            filename?: string;
            allNamespaces?: boolean;
            force?: boolean;
            gracePeriodSeconds?: number;
            context?: string;
          }
        );
      }

      if (name === "kubectl_create") {
        return await kubectlCreate(
          k8sManager,
          input as {
            manifest?: string;
            filename?: string;
            namespace?: string;
            dryRun?: boolean;
            validate?: boolean;
            context?: string;
          }
        );
      }

      if (name === "kubectl_logs") {
        return await kubectlLogs(
          k8sManager,
          input as {
            resourceType: string;
            name: string;
            namespace: string;
            container?: string;
            tail?: number;
            since?: string;
            sinceTime?: string;
            timestamps?: boolean;
            previous?: boolean;
            follow?: boolean;
            labelSelector?: string;
            context?: string;
          }
        );
      }

      if (name === "kubectl_patch") {
        return await kubectlPatch(
          k8sManager,
          input as {
            resourceType: string;
            name: string;
            namespace?: string;
            patchType?: "strategic" | "merge" | "json";
            patchData?: object;
            patchFile?: string;
            dryRun?: boolean;
            context?: string;
          }
        );
      }

      if (name === "kubectl_rollout") {
        return await kubectlRollout(
          k8sManager,
          input as {
            subCommand:
              | "history"
              | "pause"
              | "restart"
              | "resume"
              | "status"
              | "undo";
            resourceType: "deployment" | "daemonset" | "statefulset";
            name: string;
            namespace?: string;
            revision?: number;
            toRevision?: number;
            timeout?: string;
            watch?: boolean;
            context?: string;
          }
        );
      }

      if (name === "kubectl_generic") {
        return await kubectlGeneric(
          k8sManager,
          input as {
            command: string;
            subCommand?: string;
            resourceType?: string;
            name?: string;
            namespace?: string;
            outputFormat?: string;
            flags?: Record<string, any>;
            args?: string[];
            context?: string;
          }
        );
      }

      if (name === "kubectl_events") {
        return await kubectlGet(k8sManager, {
          resourceType: "events",
          namespace: (input as { namespace?: string }).namespace,
          fieldSelector: (input as { fieldSelector?: string }).fieldSelector,
          labelSelector: (input as { labelSelector?: string }).labelSelector,
          sortBy: (input as { sortBy?: string }).sortBy,
          output: (input as { output?: string }).output,
          context: (input as { context?: string }).context,
        });
      }

      // Handle specific non-kubectl operations
      switch (name) {
        case "cleanup": {
          await k8sManager.cleanup();
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    success: true,
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

        case "explain_resource": {
          return await explainResource(
            input as {
              context?: string;
              resource: string;
              apiVersion?: string;
              recursive?: boolean;
              output?: "plaintext" | "plaintext-openapiv2";
            }
          );
        }

        case "install_helm_chart": {
          return await installHelmChart(
            input as {
              name: string;
              chart: string;
              repo: string;
              namespace: string;
              values?: Record<string, any>;
              context?: string;
            }
          );
        }

        case "uninstall_helm_chart": {
          return await uninstallHelmChart(
            input as {
              name: string;
              namespace: string;
              context?: string;
            }
          );
        }

        case "upgrade_helm_chart": {
          return await upgradeHelmChart(
            input as {
              name: string;
              chart: string;
              repo: string;
              namespace: string;
              values?: Record<string, any>;
              context?: string;
            }
          );
        }





        case "node_management": {
          return await nodeManagement(
            input as {
              operation: "cordon" | "drain" | "uncordon";
              nodeName?: string;
              force?: boolean;
              gracePeriod?: number;
              deleteLocalData?: boolean;
              ignoreDaemonsets?: boolean;
              timeout?: string;
              dryRun?: boolean;
              confirmDrain?: boolean;
            }
          );
        }

        case "list_api_resources": {
          return await listApiResources(
            input as {
              apiGroup?: string;
              namespaced?: boolean;
              verbs?: string[];
              output?: "wide" | "name" | "no-headers";
              context?: string;
            }
          );
        }

        case "port_forward": {
          return await startPortForward(
            k8sManager,
            input as {
              resourceType: string;
              resourceName: string;
              localPort: number;
              targetPort: number;
              context?: string;
            }
          );
        }

        case "stop_port_forward": {
          return await stopPortForward(
            k8sManager,
            input as {
              id: string;
            }
          );
        }

        case "kubectl_scale": {
          return await kubectlScale(
            k8sManager,
            input as {
              name: string;
              namespace?: string;
              replicas: number;
              resourceType?: string;
              context?: string;
            }
          );
        }

        case "ping": {
          return await ping();
        }

        case "exec_in_pod": {
          return await execInPod(
            k8sManager,
            input as {
              name: string;
              namespace?: string;
              command: string[];
              container?: string;
              timeout?: number;
              context?: string;
            }
          );
        }

        default:
          throw new McpError(ErrorCode.InvalidRequest, `Unknown tool: ${name}`);
      }
    } catch (error) {
      if (error instanceof McpError) throw error;
      throw new McpError(
        ErrorCode.InternalError,
        `Tool execution failed: ${error}`
      );
    }
  }
);

// Start the server
if (process.env.ENABLE_UNSAFE_SSE_TRANSPORT) {
  startSSEServer(server);
  console.log(`SSE server started`);
} else if (process.env.ENABLE_UNSAFE_STREAMABLE_HTTP_TRANSPORT) {
  startStreamableHTTPServer(server);
  console.log(`Streamable HTTP server started`);
} else {
  const transport = new StdioServerTransport();

  console.error(
    `Starting Kubernetes MCP server v${serverConfig.version}, handling commands...`
  );

  server.connect(transport);
}

["SIGINT", "SIGTERM"].forEach((signal) => {
  process.on(signal, async () => {
    console.log(`Received ${signal}, shutting down...`);
    await server.close();
    process.exit(0);
  });
});

export { allTools, destructiveTools };

```

