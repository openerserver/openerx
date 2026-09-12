import { randomUUID } from "node:crypto";
import { lstatSync, mkdirSync, realpathSync } from "node:fs";
import path from "node:path";
import type {
  AppServiceAuthorization,
  BrokeredBashExecutionContext,
  ChatEvent,
  ExecutionRun,
  HostToolAvailability,
  LocalWebSearchPolicy,
  LocalWebSearchSettingsSelection,
  LocalWebSearchSettingsState,
  McpServerAuthorizationState,
  McpServerConfig,
  McpToolDescriptor,
  NormalizedToolResult,
  PermissionRequest,
  PiActivityEvent,
  PiFileToolRequestFrame,
  PiToolRequestFrame,
  RunStep,
  SelectableLocalWebSearchProviderId,
  ThinkingLevel,
  ToolCall,
  ToolOperation,
  ToolPermissionMode,
  ToolPermissionModeState,
  ToolRuntimeCapability,
  ToolRuntimeReadiness,
  ToolRuntimeStatus,
  UsageRecord,
  WorkItem,
  WorkspaceGrant,
  WorkspaceInstructionSource,
} from "@openerx/contracts";
import {
  BROKERED_BASH_CONTRACT_VERSION,
  BROKERED_BASH_CONTROLLED_EGRESS_NETWORK_POLICY_ID,
  BROKERED_BASH_CORE_ENVIRONMENT_POLICY_ID,
  BROKERED_BASH_DENY_NETWORK_POLICY_ID,
  BROKERED_BASH_FAKE_SANDBOX_POLICY_VERSION,
  BROKERED_BASH_RUNNER_MODE_ENV,
  BROKERED_BASH_V1_FEATURE_FLAG,
  type BrokeredBashRunnerMode,
  type ByokUsageRecord,
  brokeredBashRunnerMode,
  brokeredBashV1Enabled,
  defaultLocalWebSearchPolicy,
  LOCAL_WEB_SEARCH_V2_FEATURE_FLAG,
  localWebSearchSettingsSelectionSchema,
  localWebSearchSettingsStateSchema,
  localWebSearchV2Enabled,
  orderedLocalWebSearchProviders,
  piHostContractVersion,
} from "@openerx/contracts";
import type { ProjectWorkspaceBindingInput, ToolRepository } from "@openerx/storage";
import {
  BaiduJsonSearchProvider,
  BingHtmlSearchProvider,
  BROKERED_BASH_CORE_ENVIRONMENT_POLICY,
  BrokeredBashAdapter,
  type BrokeredBashEnvironmentPolicy,
  BrokeredBashFakeAdapter,
  type BrokeredBashLogArtifactWriter,
  type BrokeredBashNetworkPolicy,
  BuiltinToolAdapter,
  brokeredBashEnvironmentPolicyDigest,
  brokeredBashEnvironmentPolicyId,
  brokeredBashNetworkPolicyDigest,
  type CapabilityAvailabilityHost,
  CapabilityBroker,
  type CapabilityHost,
  type CredentialResolver,
  type CredentialStore,
  capabilityRequirement,
  DesktopMcpOAuthProvider,
  type FrozenLocalWebSearchConfiguration,
  freezeBrokeredBashEnvironmentPolicy,
  freezeLocalWebSearchPolicy,
  HostCapabilityAdapter,
  HttpPlatformImageGenerationTransport,
  HttpPlatformWebSearchTransport,
  type LocalSearchProvider,
  LocalWebSearchCoordinator,
  LocalWebSearchError,
  MacOSSandboxExecEngine,
  McpToolAdapter,
  type OAuthInteractionHost,
  type PlatformSandboxEngine,
  ShellToolAdapter,
  shellToolAvailability,
  summarizeOperation,
  type ToolAdapter,
  type ToolExecutionContext,
  WorkspaceToolAdapter,
} from "@openerx/tool-sdk";
import { desktopBrand } from "../../branding/src/index";

class GenerationWebSearchAdapter implements ToolAdapter {
  readonly operations = ["web_search"] as const;
  constructor(
    private readonly localWebSearchV2: boolean,
    private readonly localConfiguration: (
      generationId: string,
    ) => FrozenLocalWebSearchConfiguration | undefined,
    private readonly localCoordinator: LocalWebSearchCoordinator,
    private readonly authorization: (generationId: string) => AppServiceAuthorization | undefined,
  ) {}

  async execute(
    operation: ToolOperation,
    context: ToolExecutionContext,
  ): Promise<NormalizedToolResult> {
    if (operation.operation !== "web_search") throw new Error("WEB_SEARCH_OPERATION_NOT_SUPPORTED");
    const generationId = context.projection?.generationId;
    if (this.localWebSearchV2) {
      if (!generationId) throw new LocalWebSearchError("LOCAL_SEARCH_POLICY_MISMATCH");
      const configuration = this.localConfiguration(generationId);
      if (!configuration) throw new LocalWebSearchError("LOCAL_SEARCH_POLICY_MISMATCH");
      return await this.localCoordinator.search({
        generationId,
        query: operation.query,
        ...(operation.recencyDays === undefined ? {} : { recencyDays: operation.recencyDays }),
        ...(operation.domains === undefined ? {} : { domains: operation.domains }),
        configuration,
        signal: context.signal,
      });
    }
    const authorization = generationId ? this.authorization(generationId) : undefined;
    if (!authorization) throw new Error("AUTHENTICATION_REQUIRED");
    return await new HttpPlatformWebSearchTransport(
      authorization.platformBaseUrl,
      authorization.accessToken,
    ).search({
      query: operation.query,
      ...(operation.recencyDays === undefined ? {} : { recencyDays: operation.recencyDays }),
      ...(operation.domains === undefined ? {} : { domains: operation.domains }),
      signal: context.signal,
    });
  }
}

class GenerationImageGenerationAdapter implements ToolAdapter {
  readonly operations = ["image_generate"] as const;
  constructor(
    private readonly authorization: (generationId: string) => AppServiceAuthorization | undefined,
  ) {}

  async execute(
    operation: ToolOperation,
    context: ToolExecutionContext,
  ): Promise<NormalizedToolResult> {
    if (operation.operation !== "image_generate") {
      throw new Error("IMAGE_GENERATION_OPERATION_NOT_SUPPORTED");
    }
    const generationId = context.projection?.generationId;
    const authorization = generationId ? this.authorization(generationId) : undefined;
    if (!authorization) throw new Error("AUTHENTICATION_REQUIRED");
    return await new HttpPlatformImageGenerationTransport(
      authorization.platformBaseUrl,
      authorization.accessToken,
    ).generate({
      prompt: operation.prompt,
      aspectRatio: operation.aspectRatio,
      count: operation.count,
      signal: context.signal,
    });
  }
}

function fileOperationSummary(frame: PiFileToolRequestFrame): {
  input: string;
  target: string;
  risk: "L1" | "L3";
} {
  switch (frame.request.operation) {
    case "list":
      return {
        input: "列出已附加文件",
        target: frame.conversationId,
        risk: "L1",
      };
    case "search":
      return {
        input: frame.request.input.query,
        target: "已附加文件",
        risk: "L1",
      };
    case "read":
      return {
        input: "读取已附加文件",
        target: frame.request.input.personalFileId,
        risk: "L1",
      };
    case "artifact.write":
      return {
        input: `${frame.request.input.format} · ${frame.request.input.displayName}`,
        target: frame.request.input.artifactId ?? "新成果",
        risk: "L3",
      };
    case "artifact.office.write":
      return {
        input: `${frame.request.input.spec.format} · ${frame.request.input.displayName}`,
        target: frame.request.input.artifactId ?? "新 Office 成果",
        risk: "L3",
      };
  }
}

function withoutPreviewMedia(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutPreviewMedia);
  if (!value || typeof value !== "object") return value;
  const output: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (/^(bytesBase64|imageDataUrl|modelImageDataUrl)$/u.test(key)) continue;
    output[key] = withoutPreviewMedia(entry);
  }
  return output;
}

function fileToolResult(
  frame: PiFileToolRequestFrame,
  result: unknown,
  durationMs: number,
): NormalizedToolResult {
  const record = result && typeof result === "object" ? (result as Record<string, unknown>) : null;
  const artifact =
    record?.artifact && typeof record.artifact === "object"
      ? (record.artifact as Record<string, unknown>)
      : record;
  const artifactId = typeof artifact?.id === "string" ? artifact.id : null;
  const count = Array.isArray(result) ? result.length : null;
  const summary =
    frame.request.operation === "list"
      ? `已列出 ${count ?? 0} 个附件`
      : frame.request.operation === "search"
        ? `已找到 ${count ?? 0} 条文件结果`
        : frame.request.operation === "read"
          ? "已读取附件内容"
          : artifactId
            ? `已写入成果 ${artifactId}`
            : "文件工具已完成";
  const serialized = JSON.stringify(withoutPreviewMedia(result));
  return {
    summary,
    content: [
      { type: "text", text: (serialized ?? summary).slice(0, 1_000_000) },
      ...(artifactId ? [{ type: "artifact" as const, artifactId }] : []),
    ],
    data: withoutPreviewMedia(result),
    sources: [],
    artifacts: artifactId ? [artifactId] : [],
    sideEffectCommitted:
      frame.request.operation === "artifact.write" ||
      frame.request.operation === "artifact.office.write",
    durationMs,
  };
}

export interface ToolAppServiceOptions {
  repository: ToolRepository;
  workspaceDirectory: string;
  defaultWorkspaceDirectory?: string;
  host: CapabilityHost & CapabilityAvailabilityHost & CredentialResolver;
  oauth?: CredentialStore & OAuthInteractionHost;
  resolveUploadPath(fileId: string): string;
  ingestDownload(path: string): Promise<{ fileId: string; displayName: string }>;
  selectedModelRef(assistantMessageId: string): string;
  emit(event: ChatEvent): void;
  additionalAdapters?: ToolAdapter[];
  shellAvailability?: () => HostToolAvailability;
  brokeredBashV1?: boolean;
  brokeredBashRunnerMode?: BrokeredBashRunnerMode;
  platformSandboxEngine?: PlatformSandboxEngine;
  writeBrokeredBashLogArtifact?: BrokeredBashLogArtifactWriter;
  localWebSearchV2?: boolean;
  localWebSearchPolicy?: LocalWebSearchPolicy;
  localWebSearchProviders?: LocalSearchProvider[];
}

interface BrokeredBashRuntimeAvailability {
  available: boolean;
  mode: BrokeredBashRunnerMode | null;
  reason: string | null;
  sandboxPolicyVersion: string | null;
  backendId: string | null;
  platform: string | null;
}

interface ActiveProjection {
  workItem: WorkItem;
  run: ExecutionRun;
}

type ReconciliationItem = NonNullable<ChatEvent["payload"]["reconciliation"]>[number];

const reconciliationStatuses = new Set<ReconciliationItem["status"]>([
  "pending_review",
  "reviewed",
  "applied",
  "reverted",
  "discarded",
  "blocked",
  "apply_failed",
  "outcome_unknown",
]);

function reconciliationForResult(result: NormalizedToolResult): ReconciliationItem[] {
  if (!result.data || typeof result.data !== "object") return [];
  const data = result.data as Record<string, unknown>;
  const candidates: unknown[] = [];
  if (data.workspaceChangeSet && typeof data.workspaceChangeSet === "object") {
    candidates.push(data.workspaceChangeSet);
  }
  if (data.changeSet && typeof data.changeSet === "object") candidates.push(data.changeSet);
  if (Array.isArray(data.changeSets)) candidates.push(...data.changeSets);
  return candidates.flatMap((candidate) => {
    if (!candidate || typeof candidate !== "object") return [];
    const record = candidate as Record<string, unknown>;
    if (
      typeof record.id !== "string" ||
      typeof record.status !== "string" ||
      !reconciliationStatuses.has(record.status as ReconciliationItem["status"])
    ) {
      return [];
    }
    const status = record.status as ReconciliationItem["status"];
    return [
      {
        kind: "workspace_change_set" as const,
        targetId: record.id,
        status,
        actionRequired: [
          "pending_review",
          "reviewed",
          "blocked",
          "apply_failed",
          "outcome_unknown",
        ].includes(status),
      },
    ];
  });
}

export interface PreparedGenerationTools {
  workspaceGrants: WorkspaceGrant[];
  instructionSources: WorkspaceInstructionSource[];
  mcpTools: McpToolDescriptor[];
  initialToolNames: string[];
  availableToolNames: string[];
  brokeredBashExecution?: BrokeredBashExecutionContext;
  localWebSearchConfiguration?: FrozenLocalWebSearchConfiguration;
}

export interface ReconciledProjectWorkspaces {
  activeExecutionGrantId?: string;
  additionalExecutionGrantIds: string[];
}

export class ToolAppService {
  readonly #repository: ToolRepository;
  readonly #defaultWorkspaceDirectory: string;
  readonly #defaultWorkspaceFallback: boolean;
  readonly #broker: CapabilityBroker;
  readonly #emitEvent: (event: ChatEvent) => void;
  readonly #selectedModelRef: (assistantMessageId: string) => string;
  readonly #projectionByGeneration = new Map<string, ActiveProjection>();
  readonly #authorizationByGeneration = new Map<string, AppServiceAuthorization>();
  readonly #localWebSearchConfigurationByGeneration = new Map<
    string,
    FrozenLocalWebSearchConfiguration
  >();
  readonly #brokeredBashExecutionByGeneration = new Map<string, BrokeredBashExecutionContext>();
  readonly #brokeredBashEnvironmentPolicyByDigest = new Map<
    string,
    BrokeredBashEnvironmentPolicy
  >();
  readonly #brokeredBashNetworkPolicyByDigest = new Map<string, BrokeredBashNetworkPolicy>();
  readonly #abortByGeneration = new Map<string, AbortController>();
  readonly #generationByRequest = new Map<string, string>();
  readonly #mcp: McpToolAdapter;
  readonly #workspace: WorkspaceToolAdapter;
  readonly #host: CapabilityAvailabilityHost;
  readonly #shellAvailability: () => HostToolAvailability;
  readonly #brokeredBashV1: boolean;
  readonly #localWebSearchV2: boolean;
  #localWebSearchConfiguration: FrozenLocalWebSearchConfiguration;
  #localWebSearchSettingsUpdatedAt: string | null;
  readonly #localWebSearchCoordinator: LocalWebSearchCoordinator;
  readonly #brokeredBashRunnerMode: BrokeredBashRunnerMode | null;
  readonly #platformSandboxEngine?: PlatformSandboxEngine;

  constructor(options: ToolAppServiceOptions) {
    this.#repository = options.repository;
    const preferredDefaultWorkspace =
      options.defaultWorkspaceDirectory ??
      path.join(path.dirname(options.workspaceDirectory), desktopBrand.workspaceDirectoryName);
    let defaultWorkspaceFallback = false;
    try {
      mkdirSync(path.join(preferredDefaultWorkspace, "conversations"), { recursive: true });
      this.#defaultWorkspaceDirectory = realpathSync(preferredDefaultWorkspace);
    } catch {
      const fallback = path.join(path.dirname(options.workspaceDirectory), "default-workspace");
      mkdirSync(path.join(fallback, "conversations"), { recursive: true });
      this.#defaultWorkspaceDirectory = realpathSync(fallback);
      defaultWorkspaceFallback = true;
    }
    this.#defaultWorkspaceFallback = defaultWorkspaceFallback;
    this.#emitEvent = options.emit;
    this.#selectedModelRef = options.selectedModelRef;
    this.#host = options.host;
    this.#shellAvailability = options.shellAvailability ?? shellToolAvailability;
    this.#brokeredBashV1 =
      options.brokeredBashV1 ?? brokeredBashV1Enabled(process.env[BROKERED_BASH_V1_FEATURE_FLAG]);
    this.#localWebSearchV2 =
      options.localWebSearchV2 ??
      localWebSearchV2Enabled(process.env[LOCAL_WEB_SEARCH_V2_FEATURE_FLAG]);
    const persistedLocalWebSearchSettings = options.localWebSearchPolicy
      ? null
      : this.#repository.localWebSearchSettings();
    this.#localWebSearchConfiguration = freezeLocalWebSearchPolicy(
      options.localWebSearchPolicy ?? {
        ...defaultLocalWebSearchPolicy(),
        ...(persistedLocalWebSearchSettings
          ? {
              providerOrder: orderedLocalWebSearchProviders(
                persistedLocalWebSearchSettings.providerId,
              ),
              allowProviderFallback: true,
              locale: persistedLocalWebSearchSettings.locale,
              safeSearch: persistedLocalWebSearchSettings.safeSearch,
            }
          : {}),
      },
    );
    this.#localWebSearchSettingsUpdatedAt = persistedLocalWebSearchSettings?.updatedAt ?? null;
    this.#localWebSearchCoordinator = new LocalWebSearchCoordinator(
      options.localWebSearchProviders ?? [
        new BaiduJsonSearchProvider(),
        new BingHtmlSearchProvider(),
      ],
    );
    this.#brokeredBashRunnerMode =
      options.brokeredBashRunnerMode ??
      brokeredBashRunnerMode(process.env[BROKERED_BASH_RUNNER_MODE_ENV]);
    this.#platformSandboxEngine =
      this.#brokeredBashV1 && this.#brokeredBashRunnerMode === "macos"
        ? (options.platformSandboxEngine ?? new MacOSSandboxExecEngine())
        : undefined;
    this.#brokeredBashEnvironmentPolicyByDigest.set(
      brokeredBashEnvironmentPolicyDigest(BROKERED_BASH_CORE_ENVIRONMENT_POLICY),
      BROKERED_BASH_CORE_ENVIRONMENT_POLICY,
    );
    this.#brokeredBashNetworkPolicyByDigest.set(brokeredBashNetworkPolicyDigest({ mode: "deny" }), {
      mode: "deny",
    });
    const oauth = options.oauth;
    this.#mcp = new McpToolAdapter(
      options.host,
      oauth
        ? async (config, { interactive }) => {
            if (!config.credentialRef) throw new Error("MCP_CREDENTIAL_REQUIRED");
            const callbackSession = interactive ? await oauth.prepareOAuth(config.id) : undefined;
            return await DesktopMcpOAuthProvider.create({
              credentialRef: config.credentialRef,
              credentials: oauth,
              interactions: oauth,
              ...(callbackSession ? { callbackSession } : {}),
            });
          }
        : undefined,
    );
    this.#workspace = new WorkspaceToolAdapter(
      options.repository,
      path.dirname(options.workspaceDirectory),
    );
    this.#broker = new CapabilityBroker(options.repository, [
      new BuiltinToolAdapter(),
      new GenerationWebSearchAdapter(
        this.#localWebSearchV2,
        (generationId) => this.#localWebSearchConfigurationByGeneration.get(generationId),
        this.#localWebSearchCoordinator,
        (generationId) => this.#authorizationByGeneration.get(generationId),
      ),
      new GenerationImageGenerationAdapter((generationId) =>
        this.#authorizationByGeneration.get(generationId),
      ),
      new ShellToolAdapter(
        [options.workspaceDirectory],
        (workspaceGrantId, conversationId) =>
          options.repository.activeWorkspaceGrant(workspaceGrantId, conversationId),
        undefined,
        (changes, context) => {
          const workspaceGrantId = changes.materialization[0]?.workspaceGrantId;
          if (!workspaceGrantId || !context.projection) return;
          const changeSet = this.#repository.createWorkspaceChangeSet({
            workspaceGrantId,
            runId: context.projection.runId,
            toolCallId: context.toolCallId,
            baselineRevision: changes.baselineRevision,
            finalRevision: changes.finalRevision,
            manifest: changes.manifest,
            diffs: changes.diffs,
            entries: changes.materialization,
            blocked: false,
          });
          this.#repository.markWorkspaceChangeSet(changeSet.id, "applied");
        },
      ),
      ...(this.#brokeredBashV1 && this.#brokeredBashRunnerMode === "fake"
        ? [
            new BrokeredBashFakeAdapter(
              (workspaceGrantId, conversationId) =>
                options.repository.activeWorkspaceGrant(workspaceGrantId, conversationId),
              (generationId) => this.#brokeredBashExecutionByGeneration.get(generationId),
            ),
          ]
        : this.#brokeredBashV1 &&
            this.#brokeredBashRunnerMode === "macos" &&
            this.#platformSandboxEngine
          ? [
              new BrokeredBashAdapter(
                (workspaceGrantId, conversationId) =>
                  options.repository.activeWorkspaceGrant(workspaceGrantId, conversationId),
                (generationId) => this.#brokeredBashExecutionByGeneration.get(generationId),
                this.#platformSandboxEngine,
                options.writeBrokeredBashLogArtifact,
                (input) => {
                  const changeSet = this.#repository.createWorkspaceChangeSet(input);
                  return input.directWrite
                    ? this.#repository.markWorkspaceChangeSet(changeSet.id, "applied")
                    : changeSet;
                },
                (generationId) => {
                  const digest =
                    this.#brokeredBashExecutionByGeneration.get(
                      generationId,
                    )?.environmentPolicyDigest;
                  return digest
                    ? this.#brokeredBashEnvironmentPolicyByDigest.get(digest)
                    : undefined;
                },
                (generationId) => {
                  const digest =
                    this.#brokeredBashExecutionByGeneration.get(generationId)?.networkPolicyDigest;
                  return digest ? this.#brokeredBashNetworkPolicyByDigest.get(digest) : undefined;
                },
              ),
            ]
          : []),
      this.#workspace,
      new HostCapabilityAdapter(options.host, options.resolveUploadPath, options.ingestDownload),
      this.#mcp,
      ...(options.additionalAdapters ?? []),
    ]);
  }

  initialize(): void {
    this.#repository.recoverInterrupted();
    for (const config of this.#repository.listMcpServers()) this.#mcp.register(config);
  }

  startGeneration(input: {
    generationId: string;
    conversationId: string;
    branchId: string;
    assistantMessageId: string;
    selectedModelRef: string;
    thinkingLevel: ThinkingLevel;
    initialToolNames?: string[];
    availableToolNames?: string[];
    skillInstallationIds?: string[];
    instructionSources?: WorkspaceInstructionSource[];
  }): ActiveProjection {
    const active = this.#projectionByGeneration.get(input.generationId);
    if (active) return active;
    const projection = this.#repository.createProjection({
      conversationId: input.conversationId,
      messageId: input.assistantMessageId,
      branchId: input.branchId,
      title: "对话轮次",
      selectedModelRef: input.selectedModelRef,
      thinkingLevel: input.thinkingLevel,
      piPackageVersion: "0.84.4",
      piHostContractVersion,
      piSessionRef: `branch:${input.branchId}`,
      initialToolNames: input.initialToolNames,
      availableToolNames: input.availableToolNames,
      skillInstallationIds: input.skillInstallationIds,
      instructionSources: input.instructionSources,
    });
    this.#projectionByGeneration.set(input.generationId, projection);
    this.#emit(
      "run.started",
      {
        conversationId: input.conversationId,
        assistantMessageId: input.assistantMessageId,
      },
      projection,
      {},
    );
    return projection;
  }

  repository(): ToolRepository {
    return this.#repository;
  }

  localWebSearchSettings(): LocalWebSearchSettingsState {
    const { policy } = this.#localWebSearchConfiguration;
    return localWebSearchSettingsStateSchema.parse({
      providerId: policy.providerOrder[0],
      locale: policy.locale,
      safeSearch: policy.safeSearch,
      featureEnabled: this.#localWebSearchV2,
      allowProviderFallback: policy.allowProviderFallback,
      cacheMode: "turn",
      updatedAt: this.#localWebSearchSettingsUpdatedAt,
      providers: this.#localWebSearchCoordinator.providerStates(this.#localWebSearchConfiguration),
    });
  }

  updateLocalWebSearchSettings(
    input: LocalWebSearchSettingsSelection,
  ): LocalWebSearchSettingsState {
    const selection = localWebSearchSettingsSelectionSchema.parse(input);
    const persisted = this.#repository.saveLocalWebSearchSettings(selection);
    this.#localWebSearchConfiguration = freezeLocalWebSearchPolicy({
      ...this.#localWebSearchConfiguration.policy,
      providerOrder: orderedLocalWebSearchProviders(selection.providerId),
      allowProviderFallback: true,
      locale: selection.locale,
      safeSearch: selection.safeSearch,
      cacheMode: "turn",
    });
    this.#localWebSearchSettingsUpdatedAt = persisted.updatedAt;
    return this.localWebSearchSettings();
  }

  resetLocalWebSearchRuntime(
    input: { providerId?: SelectableLocalWebSearchProviderId } = {},
  ): LocalWebSearchSettingsState {
    this.#localWebSearchCoordinator.resetRuntimeState(input.providerId);
    return this.localWebSearchSettings();
  }

  grantWorkspace(input: {
    rootPath: string;
    conversationId: string | null;
    access: WorkspaceGrant["access"];
    allowNetwork: boolean;
    expiresAt: string | null;
    projectOperationId?: string;
    role?: WorkspaceGrant["bindingRole"];
  }): WorkspaceGrant {
    if (input.expiresAt && Date.parse(input.expiresAt) <= Date.now()) {
      throw new Error("WORKSPACE_EXPIRY_INVALID");
    }
    const canonicalRoot = realpathSync(input.rootPath);
    if (!lstatSync(canonicalRoot).isDirectory()) throw new Error("WORKSPACE_DIRECTORY_REQUIRED");
    if (input.conversationId && input.role !== "additional") {
      this.#repository.revokeDefaultWorkspaceGrants(input.conversationId);
    }
    if (input.conversationId && input.role === "additional") {
      this.ensureConversationWorkspace(input.conversationId);
    }
    return this.#repository.grantWorkspace({
      conversationId: input.conversationId,
      displayName: path.basename(canonicalRoot),
      rootPath: canonicalRoot,
      access: input.access,
      allowNetwork: input.allowNetwork,
      expiresAt: input.expiresAt,
      ...(input.projectOperationId ? { projectOperationId: input.projectOperationId } : {}),
      ...(input.conversationId
        ? { binding: { role: input.role ?? "primary", source: "user_added" as const } }
        : {}),
    });
  }

  listWorkspaces(conversationId?: string): WorkspaceGrant[] {
    if (conversationId) this.ensureConversationWorkspace(conversationId);
    return conversationId
      ? this.#repository.effectiveWorkspaceGrants(conversationId)
      : this.#repository.listWorkspaceGrants();
  }

  setPrimaryWorkspace(input: { conversationId: string; workspaceGrantId: string }): WorkspaceGrant {
    const selected = this.#repository.activeWorkspaceGrant(
      input.workspaceGrantId,
      input.conversationId,
    );
    if (selected.conversationId !== input.conversationId)
      throw new Error("WORKSPACE_BINDING_CONVERSATION_REQUIRED");
    return this.grantWorkspace({
      conversationId: input.conversationId,
      rootPath: selected.rootPath,
      access: selected.access,
      allowNetwork: selected.allowNetwork,
      expiresAt: selected.expiresAt,
      role: "primary",
    });
  }

  ensureConversationWorkspace(conversationId: string): WorkspaceGrant {
    const primary = this.#repository.primaryWorkspaceGrant(conversationId);
    if (primary) {
      try {
        if (lstatSync(realpathSync(primary.rootPath)).isDirectory()) return primary;
      } catch {
        this.#repository.revokeWorkspaceGrant(primary.id);
      }
    }

    const existing = this.#repository.listWorkspaceGrants(conversationId).find((grant) => {
      if (
        grant.bindingSource === "project" ||
        this.#repository.isProjectSourceWorkspaceGrant(grant.id)
      ) {
        return false;
      }
      try {
        return lstatSync(realpathSync(grant.rootPath)).isDirectory();
      } catch {
        return false;
      }
    });
    if (existing) {
      if (existing.conversationId === conversationId) {
        this.#repository.bindWorkspace({
          workspaceGrantId: existing.id,
          conversationId,
          role: "primary",
          source: "user_added",
        });
      }
      return existing;
    }

    const rootPath = path.join(this.#defaultWorkspaceDirectory, "conversations", conversationId);
    mkdirSync(rootPath, { recursive: true });
    const canonicalRoot = realpathSync(rootPath);
    return this.#repository.grantWorkspace({
      conversationId,
      displayName: `默认工作区 · ${conversationId.slice(0, 8)}`,
      rootPath: canonicalRoot,
      access: "read_write",
      allowNetwork: false,
      expiresAt: null,
      binding: { role: "primary", source: "default" },
    });
  }

  revokeWorkspace(workspaceGrantId: string): WorkspaceGrant {
    return this.#repository.revokeWorkspaceGrant(workspaceGrantId);
  }

  reconcileProjectWorkspaces(input: {
    conversationId: string;
    directories: ProjectWorkspaceBindingInput[];
  }): ReconciledProjectWorkspaces {
    const validDirectories = input.directories.filter((directory) => {
      try {
        const source = this.#repository.activeWorkspaceGrant(directory.sourceWorkspaceGrantId);
        return lstatSync(realpathSync(source.rootPath)).isDirectory();
      } catch {
        try {
          this.#repository.revokeWorkspaceGrant(directory.sourceWorkspaceGrantId);
        } catch {
          // Already revoked or absent: omit it from the frozen Generation scope.
        }
        return false;
      }
    });
    this.#repository.reconcileProjectWorkspaceBindings({
      conversationId: input.conversationId,
      directories: validDirectories,
    });
    const primary = this.#repository.primaryWorkspaceGrant(input.conversationId);
    const activeExecutionGrantId = primary?.id;
    const additionalExecutionGrantIds = this.#repository
      .effectiveWorkspaceGrants(input.conversationId)
      .filter((grant) => grant.id !== primary?.id && grant.rootPath !== primary?.rootPath)
      .map(({ id }) => id);
    return {
      ...(activeExecutionGrantId ? { activeExecutionGrantId } : {}),
      additionalExecutionGrantIds,
    };
  }

  async prepareGeneration(input: {
    conversationId: string;
    prompt: string;
    hasFiles: boolean;
    skillInstallationIds: string[];
    authenticated: boolean;
    activeExecutionGrantId?: string;
    additionalExecutionGrantIds?: string[];
    executionOrigin?: "local_interactive" | "remote_attended" | "remote_unattended";
    requiresHighIsolation?: boolean;
    environmentPolicy?: BrokeredBashEnvironmentPolicy;
    networkPolicy?: BrokeredBashNetworkPolicy;
  }): Promise<PreparedGenerationTools> {
    this.ensureConversationWorkspace(input.conversationId);
    const workspaceGrants = this.#repository
      .effectiveWorkspaceGrants(input.conversationId)
      .filter((grant) => {
        try {
          return lstatSync(realpathSync(grant.rootPath)).isDirectory();
        } catch {
          return false;
        }
      });
    const instructionSources = workspaceGrants.flatMap((grant) => {
      try {
        return this.#workspace.instructionSources(grant);
      } catch {
        return [];
      }
    });
    const hostAvailability = await this.#safeHostAvailability();
    const shellAvailability = this.#shellAvailability();
    const brokeredBashRuntime = await this.#brokeredBashRuntimeAvailability();
    const primaryWorkspaceGrant = this.#repository.primaryWorkspaceGrant(input.conversationId);
    const brokeredBashExecution = this.#prepareBrokeredBashExecution(
      workspaceGrants,
      {
        ...input,
        activeExecutionGrantId: input.activeExecutionGrantId ?? primaryWorkspaceGrant?.id,
      },
      brokeredBashRuntime,
    );
    const localWebSearchReadiness = this.#localWebSearchV2
      ? this.#localWebSearchCoordinator.readiness(this.#localWebSearchConfiguration)
      : null;
    let mcpTools: McpToolDescriptor[] = [];
    try {
      mcpTools = await this.#mcp.discoverEnabledTools();
    } catch {
      mcpTools = [];
    }
    const base = [
      "openerx_tool_search",
      "openerx_update_plan",
      "openerx_file_list",
      "openerx_file_search",
      "openerx_file_read",
      "openerx_artifact_write",
      "openerx_office_artifact",
      "openerx_calculate",
      "openerx_structured_data",
      ...(this.#localWebSearchV2
        ? localWebSearchReadiness?.available
          ? ["openerx_web_search"]
          : []
        : input.authenticated
          ? ["openerx_web_search"]
          : []),
      ...(input.authenticated ? ["openerx_image_generate"] : []),
      ...(hostAvailability.availableToolNames.includes("openerx_browser")
        ? ["openerx_browser"]
        : []),
      ...(hostAvailability.availableToolNames.includes("openerx_desktop")
        ? ["openerx_desktop"]
        : []),
      ...(workspaceGrants.length > 0
        ? [
            "openerx_workspace_list",
            "openerx_workspace_search",
            "openerx_workspace_read",
            "openerx_workspace_instructions",
            "openerx_workspace_apply_patch",
            "openerx_workspace_diff",
            "openerx_workspace_changes",
            "openerx_workspace_undo",
            "openerx_workspace_change_set_review",
            "openerx_workspace_change_set_apply",
            "openerx_workspace_change_set_discard",
            "openerx_workspace_change_set_undo",
          ]
        : []),
      ...(this.#brokeredBashV1
        ? brokeredBashExecution
          ? ["bash"]
          : []
        : workspaceGrants.some(({ access }) => access === "read_write")
          ? shellAvailability.availableToolNames.filter(
              (name) => name === "openerx_shell" || name === "openerx_shell_process",
            )
          : []),
      ...(input.skillInstallationIds.length > 0 ? ["read", "openerx_skill_script"] : []),
      ...mcpTools.map(({ name }) => name),
    ];
    const availableToolNames = [...new Set(base)];
    const prompt = input.prompt.toLocaleLowerCase();
    const selected = new Set<string>();
    const add = (...names: string[]) => {
      for (const name of names) if (availableToolNames.includes(name)) selected.add(name);
    };
    if (
      /计划|步骤|继续|检查|代码|实现|修复|迁移|plan|steps|check|code|implement|fix|migrate/u.test(
        prompt,
      )
    ) {
      add("openerx_update_plan");
    }
    if (input.hasFiles || /附件|文档|文件|pdf|docx|xlsx|attachment|file/u.test(prompt)) {
      add(
        "openerx_file_list",
        "openerx_file_search",
        "openerx_file_read",
        "openerx_artifact_write",
        "openerx_office_artifact",
      );
    }
    if (
      /生成|创建|制作|修改|编辑|更新|报告|文档|表格|演示|幻灯片|word|excel|powerpoint|documents|spreadsheets|presentations|docx|xlsx|pptx|pdf|deliverable|update/u.test(
        prompt,
      )
    ) {
      add("openerx_office_artifact");
    }
    if (/计算|算一下|统计|表格|排序|calculate|compute|sort|json/u.test(prompt)) {
      add("openerx_calculate", "openerx_structured_data");
    }
    if (/最新|新闻|搜索网络|查网页|web|search online|current/u.test(prompt))
      add("openerx_web_search", "openerx_browser");
    if (/生成图片|画图|image|illustration|render/u.test(prompt)) add("openerx_image_generate");
    if (/浏览器|网页操作|browser|website/u.test(prompt)) add("openerx_browser");
    if (/桌面|应用窗口|desktop|screenshot/u.test(prompt)) add("openerx_desktop");
    if (
      workspaceGrants.length > 0 &&
      /代码|项目|仓库|修复|实现|测试|构建|code|repo|patch|build|test/u.test(prompt)
    ) {
      add(
        "openerx_workspace_list",
        "openerx_workspace_search",
        "openerx_workspace_read",
        "openerx_workspace_instructions",
        "openerx_workspace_apply_patch",
        "openerx_workspace_diff",
        "openerx_workspace_changes",
        "openerx_workspace_undo",
        "openerx_workspace_change_set_review",
        "openerx_workspace_change_set_apply",
        "openerx_workspace_change_set_discard",
        "openerx_workspace_change_set_undo",
      );
      if (/运行|命令|测试|构建|run|command|build|test/u.test(prompt)) {
        if (this.#brokeredBashV1) {
          if (brokeredBashExecution) add("bash");
        } else add("openerx_shell", "openerx_shell_process");
      }
    }
    if (input.skillInstallationIds.length > 0) add("read", "openerx_skill_script");
    for (const descriptor of mcpTools) {
      if (
        prompt.includes("mcp") ||
        prompt.includes(descriptor.serverName.toLocaleLowerCase()) ||
        prompt.includes(descriptor.toolName.toLocaleLowerCase())
      ) {
        add(descriptor.name);
      }
    }
    return {
      workspaceGrants,
      instructionSources,
      mcpTools,
      initialToolNames: ["openerx_tool_search", ...selected],
      availableToolNames,
      ...(brokeredBashExecution ? { brokeredBashExecution } : {}),
      ...(this.#localWebSearchV2
        ? { localWebSearchConfiguration: this.#localWebSearchConfiguration }
        : {}),
    };
  }

  async listRuntimeReadiness(input: {
    authenticated: boolean;
    platformConfigured: boolean;
  }): Promise<ToolRuntimeReadiness[]> {
    const checkedAt = new Date().toISOString();
    const hostAvailability = await this.#safeHostAvailability();
    const shellAvailability = this.#shellAvailability();
    const brokeredBashRuntime = await this.#brokeredBashRuntimeAvailability();
    const readiness = (
      capability: ToolRuntimeCapability,
      status: ToolRuntimeStatus,
      reason: string | null,
      availableToolNames: string[],
      details: string[] = [],
      missingPermissions: ToolRuntimeReadiness["missingPermissions"] = [],
    ): ToolRuntimeReadiness => ({
      capability,
      status,
      reason,
      availableToolNames,
      ...(details.length > 0 ? { details } : {}),
      ...(missingPermissions.length > 0 ? { missingPermissions } : {}),
      checkedAt,
    });
    const onlineStatus: ToolRuntimeStatus = !input.platformConfigured
      ? "unavailable"
      : input.authenticated
        ? "available"
        : "authorization_required";
    const onlineReason = !input.platformConfigured
      ? "PLATFORM_ENDPOINT_NOT_CONFIGURED"
      : input.authenticated
        ? null
        : "AUTHENTICATION_REQUIRED";
    const localSearch = this.#localWebSearchV2
      ? this.#localWebSearchCoordinator.readiness(this.#localWebSearchConfiguration)
      : null;
    const browserAvailable = hostAvailability.availableToolNames.includes("openerx_browser");
    const desktopAvailable = hostAvailability.availableToolNames.includes("openerx_desktop");
    const desktopInteractionReason =
      hostAvailability.unavailableReasons["openerx_desktop:interact"] ?? null;
    const desktopReason = hostAvailability.unavailableReasons.openerx_desktop ?? null;
    const executionWorkspaceGrants = this.#repository.listWorkspaceGrants().filter((grant) => {
      try {
        return lstatSync(realpathSync(grant.rootPath)).isDirectory();
      } catch {
        return false;
      }
    });
    const shellHostAvailable = shellAvailability.availableToolNames.includes("openerx_shell");
    const writableWorkspaceAvailable =
      executionWorkspaceGrants.some(({ access }) => access === "read_write") ||
      this.#defaultWorkspaceAvailable();
    const mcp = await this.#mcpRuntimeReadiness(checkedAt);

    return [
      readiness("builtin.compute", "available", null, ["openerx_calculate"]),
      readiness("builtin.structured_data", "available", null, ["openerx_structured_data"]),
      readiness("file", "available", null, [
        "openerx_file_list",
        "openerx_file_search",
        "openerx_file_read",
        "openerx_artifact_write",
        "openerx_office_artifact",
      ]),
      readiness(
        "web.search",
        localSearch ? (localSearch.available ? "available" : "unavailable") : onlineStatus,
        localSearch ? localSearch.reason : onlineReason,
        (localSearch?.available ?? onlineStatus === "available") ? ["openerx_web_search"] : [],
        localSearch
          ? [
              "阶段：Desktop Local Alpha",
              "执行：本机 App Service",
              `Provider 顺序：${this.#localWebSearchConfiguration.policy.providerOrder.join(" → ")}`,
              `Provider 自动降级：${this.#localWebSearchConfiguration.policy.allowProviderFallback ? "开启" : "关闭"}`,
              browserAvailable ? "浏览器兜底：可用" : "浏览器兜底：不可用",
            ]
          : [],
      ),
      readiness(
        "image.generate",
        onlineStatus,
        onlineReason,
        onlineStatus === "available" ? ["openerx_image_generate"] : [],
      ),
      readiness(
        "browser",
        browserAvailable
          ? "available"
          : hostAvailability.missingPermissions?.openerx_browser?.length ||
              hostAvailability.unavailableReasons.openerx_browser?.includes("PERMISSION_REQUIRED")
            ? "authorization_required"
            : "unavailable",
        browserAvailable
          ? null
          : (hostAvailability.unavailableReasons.openerx_browser ?? "MAIN_CAPABILITY_UNAVAILABLE"),
        browserAvailable ? ["openerx_browser"] : [],
        [],
        hostAvailability.missingPermissions?.openerx_browser,
      ),
      readiness(
        "shell",
        this.#brokeredBashV1
          ? !brokeredBashRuntime.available
            ? "unavailable"
            : executionWorkspaceGrants.length === 1
              ? brokeredBashRuntime.mode === "fake"
                ? "degraded"
                : "available"
              : "authorization_required"
          : !shellHostAvailable
            ? "unavailable"
            : writableWorkspaceAvailable
              ? "available"
              : "authorization_required",
        this.#brokeredBashV1
          ? !brokeredBashRuntime.available
            ? (brokeredBashRuntime.reason ?? "BROKERED_BASH_RUNNER_UNAVAILABLE")
            : executionWorkspaceGrants.length === 1
              ? brokeredBashRuntime.mode === "fake"
                ? "BROKERED_BASH_FAKE_RUNNER_ONLY"
                : null
              : executionWorkspaceGrants.length === 0
                ? "WORKSPACE_GRANT_REQUIRED"
                : "BROKERED_BASH_ACTIVE_WORKSPACE_REQUIRED"
          : !shellHostAvailable
            ? (shellAvailability.unavailableReasons.openerx_shell ?? "SHELL_OS_SANDBOX_UNAVAILABLE")
            : writableWorkspaceAvailable
              ? null
              : "WORKSPACE_WRITE_GRANT_REQUIRED",
        this.#brokeredBashV1
          ? brokeredBashRuntime.available && executionWorkspaceGrants.length === 1
            ? ["bash"]
            : []
          : shellHostAvailable && writableWorkspaceAvailable
            ? ["openerx_shell", "openerx_shell_process"]
            : [],
        this.#brokeredBashV1
          ? [
              "阶段：Local Alpha",
              `Runner：${brokeredBashRuntime.mode ?? "unavailable"}`,
              `Backend：${brokeredBashRuntime.backendId ?? "unavailable"}`,
              `平台：${brokeredBashRuntime.platform ?? "unverified"}`,
              `Sandbox：${brokeredBashRuntime.sandboxPolicyVersion ?? "unavailable"}`,
              "环境：core（Secret 过滤）",
              "网络：默认拒绝",
              `工作区：${executionWorkspaceGrants.length} 个有效授权`,
            ]
          : process.platform === "win32"
            ? [
                `Backend：Codex Windows restricted token${shellHostAvailable ? "" : "（未就绪）"}`,
                "隔离：受限账户 / ACL / Job Object / WFP",
                "命令：argv 直传；网络默认拒绝",
                `默认工作区：${this.#defaultWorkspaceDirectory}`,
                ...(this.#defaultWorkspaceFallback
                  ? ["位置：系统文档目录不可写，已使用应用数据目录"]
                  : []),
              ]
            : ["回滚路径：openerx_shell", "同一会话不会同时暴露 brokered bash"],
      ),
      readiness(
        "desktop",
        desktopAvailable
          ? desktopInteractionReason
            ? "degraded"
            : "available"
          : desktopReason?.includes("PERMISSION_REQUIRED")
            ? "authorization_required"
            : "unavailable",
        desktopAvailable
          ? desktopInteractionReason
          : (desktopReason ?? "MAIN_CAPABILITY_UNAVAILABLE"),
        desktopAvailable ? ["openerx_desktop"] : [],
        [],
        hostAvailability.missingPermissions?.openerx_desktop,
      ),
      mcp,
    ];
  }

  #defaultWorkspaceAvailable(): boolean {
    try {
      mkdirSync(path.join(this.#defaultWorkspaceDirectory, "conversations"), { recursive: true });
      return lstatSync(realpathSync(this.#defaultWorkspaceDirectory)).isDirectory();
    } catch {
      return false;
    }
  }

  async #safeHostAvailability(): Promise<HostToolAvailability> {
    try {
      return await this.#host.availability();
    } catch {
      return {
        availableToolNames: [],
        unavailableReasons: {
          openerx_browser: "MAIN_CAPABILITY_UNAVAILABLE",
          openerx_desktop: "MAIN_CAPABILITY_UNAVAILABLE",
        },
      };
    }
  }

  async #mcpRuntimeReadiness(checkedAt: string): Promise<ToolRuntimeReadiness> {
    const enabled = this.#repository.listMcpServers().filter(({ enabled }) => enabled);
    if (enabled.length === 0) {
      return {
        capability: "mcp",
        status: "authorization_required",
        reason: "MCP_SERVER_CONFIGURATION_REQUIRED",
        availableToolNames: [],
        checkedAt,
      };
    }
    const [authorizationStates, descriptors] = await Promise.all([
      this.#mcp.authorizationStates(),
      this.#mcp.discoverEnabledTools(AbortSignal.timeout(5_000)),
    ]);
    const enabledIds = new Set(enabled.map(({ id }) => id));
    const enabledAuthorization = authorizationStates.filter(({ serverId }) =>
      enabledIds.has(serverId),
    );
    const connectedCount = enabled.filter(({ id }) => this.#mcp.status(id).connected).length;
    const authorizationRequired = enabledAuthorization.find(
      ({ status }) => status === "authorization_required",
    );
    const unavailable = enabledAuthorization.find(({ status }) => status === "unavailable");
    const availableToolNames = descriptors.map(({ name }) => name);
    if (availableToolNames.length > 0) {
      const degraded =
        connectedCount < enabled.length || Boolean(authorizationRequired || unavailable);
      return {
        capability: "mcp",
        status: degraded ? "degraded" : "available",
        reason: degraded
          ? (unavailable?.reason ??
            (authorizationRequired
              ? "MCP_OAUTH_AUTHORIZATION_REQUIRED"
              : "MCP_PARTIALLY_UNAVAILABLE"))
          : null,
        availableToolNames,
        checkedAt,
      };
    }
    if (connectedCount > 0) {
      return {
        capability: "mcp",
        status: "degraded",
        reason: "MCP_NO_ENABLED_TOOLS",
        availableToolNames: [],
        checkedAt,
      };
    }
    if (authorizationRequired) {
      return {
        capability: "mcp",
        status: "authorization_required",
        reason: authorizationRequired.reason ?? "MCP_OAUTH_AUTHORIZATION_REQUIRED",
        availableToolNames: [],
        checkedAt,
      };
    }
    return {
      capability: "mcp",
      status: "unavailable",
      reason: unavailable?.reason ?? "MCP_SERVER_UNREACHABLE",
      availableToolNames: [],
      checkedAt,
    };
  }

  freezeGenerationConfiguration(
    generationId: string,
    input: Pick<
      PreparedGenerationTools,
      | "initialToolNames"
      | "availableToolNames"
      | "instructionSources"
      | "brokeredBashExecution"
      | "localWebSearchConfiguration"
    > & { skillInstallationIds: string[] },
  ): ExecutionRun {
    const projection = this.#projectionByGeneration.get(generationId);
    if (!projection) throw new Error("GENERATION_RUN_NOT_FOUND");
    const { localWebSearchConfiguration, ...runConfiguration } = input;
    if (this.#localWebSearchV2) {
      if (!localWebSearchConfiguration) {
        throw new LocalWebSearchError("LOCAL_SEARCH_POLICY_MISMATCH");
      }
      this.#localWebSearchCoordinator.readiness(localWebSearchConfiguration);
    } else if (localWebSearchConfiguration) {
      throw new LocalWebSearchError("LOCAL_SEARCH_POLICY_MISMATCH");
    }
    const run = this.#repository.freezeRunConfiguration(projection.run.id, runConfiguration);
    if (localWebSearchConfiguration) {
      this.#localWebSearchConfigurationByGeneration.set(generationId, localWebSearchConfiguration);
    }
    if (input.brokeredBashExecution) {
      this.#brokeredBashExecutionByGeneration.set(generationId, input.brokeredBashExecution);
    } else {
      this.#brokeredBashExecutionByGeneration.delete(generationId);
    }
    projection.run = run;
    return run;
  }

  upsertMcpServer(config: McpServerConfig): McpServerConfig {
    const saved = this.#repository.upsertMcpServer(config);
    this.#mcp.register(saved);
    return saved;
  }

  async listMcpServerAuthorizationStates(): Promise<McpServerAuthorizationState[]> {
    return await this.#mcp.authorizationStates();
  }

  async authorizeMcpServer(serverId: string): Promise<McpServerAuthorizationState> {
    return await this.#mcp.authorize(serverId, new AbortController().signal);
  }

  async removeMcpServer(serverId: string): Promise<{ serverId: string; removed: boolean }> {
    await this.#mcp.unregister(serverId);
    return this.#repository.removeMcpServer(serverId);
  }

  async handleRequest(
    frame: PiToolRequestFrame,
    authorization?: AppServiceAuthorization,
    onProgress: (delta: string, truncated: boolean) => void = () => undefined,
  ): Promise<NormalizedToolResult> {
    if (authorization) this.#authorizationByGeneration.set(frame.generationId, authorization);
    const projection = this.#ensureProjection(frame);
    const requirement = {
      requirement: capabilityRequirement(frame.operation),
      summary: summarizeOperation(frame.operation),
    };
    const projected = this.#repository.createToolCall({
      runId: projection.run.id,
      piCallRef: frame.piToolCallId,
      toolName: frame.toolName,
      source: frame.operation.operation.startsWith("mcp_")
        ? "mcp"
        : frame.operation.operation.startsWith("skill_")
          ? "skill"
          : "openerx",
      risk: requirement.requirement.risk,
      idempotencyKey: frame.operation.idempotencyKey,
      input: frame.operation,
      inputSummary: requirement.summary.input,
      targetSummary: requirement.summary.target,
    });
    this.#emit("tool.requested", frame, projection, {
      toolCall: projected.toolCall,
      step: projected.step,
    });
    const controller = this.#abortByGeneration.get(frame.generationId) ?? new AbortController();
    this.#abortByGeneration.set(frame.generationId, controller);
    this.#generationByRequest.set(frame.requestId, frame.generationId);
    try {
      const result = await this.#broker.executeAwaitingPermission(
        {
          generationId: frame.generationId,
          workItemId: projection.workItem.id,
          runId: projection.run.id,
          conversationId: frame.conversationId,
          assistantMessageId: frame.assistantMessageId,
          piToolCallId: frame.piToolCallId,
          toolName: frame.toolName,
        },
        frame.operation,
        controller.signal,
        (summary, truncated = false) => {
          const call = this.#repository.toolCallByPiRef(projection.run.id, frame.piToolCallId);
          if (call)
            this.#emit("tool.progressed", frame, projection, {
              toolCall: call,
              reason: summary.slice(0, 2_000),
            });
          onProgress(summary, truncated);
        },
        (permission) => {
          const call = this.#repository.toolCall(permission.toolCallId);
          this.#emit("permission.required", frame, projection, {
            permission,
            toolCall: call,
          });
        },
      );
      const call = this.#repository.toolCallByPiRef(projection.run.id, frame.piToolCallId);
      if (call) {
        const reconciliation = reconciliationForResult(result);
        this.#emit("tool.completed", frame, projection, {
          toolCall: call,
          ...(reconciliation.length > 0 ? { reconciliation } : {}),
        });
      }
      return result;
    } catch (error) {
      const call = this.#repository.toolCallByPiRef(projection.run.id, frame.piToolCallId);
      if (call) {
        const code = error instanceof Error ? error.message.split(":", 1)[0] : "TOOL_FAILED";
        this.#emit("tool.failed", frame, projection, {
          toolCall: call,
          reason: error instanceof Error ? error.message : "TOOL_FAILED",
          ...(code === "SIDE_EFFECT_OUTCOME_UNKNOWN"
            ? {
                reconciliation: [
                  {
                    kind: "tool_side_effect",
                    targetId: frame.operation.idempotencyKey,
                    status: "outcome_unknown",
                    actionRequired: true,
                  },
                ],
              }
            : {}),
        });
      }
      throw error;
    } finally {
      this.#generationByRequest.delete(frame.requestId);
    }
  }

  cancelToolRequest(requestId: string, generationId: string): void {
    if (this.#generationByRequest.get(requestId) !== generationId) return;
    this.requestCancellation(generationId);
  }

  async handleFileRequest(
    frame: PiFileToolRequestFrame,
    execute: () => Promise<unknown> | unknown,
  ): Promise<unknown> {
    const projection = this.#projectionByGeneration.get(frame.generationId);
    if (!projection) throw new Error("GENERATION_RUN_NOT_FOUND");
    const summary = fileOperationSummary(frame);
    const projected = this.#repository.createToolCall({
      runId: projection.run.id,
      piCallRef: frame.piToolCallId,
      toolName: frame.toolName,
      source: "openerx",
      risk: summary.risk,
      idempotencyKey: frame.requestId,
      input: frame.request,
      inputSummary: summary.input,
      targetSummary: summary.target,
    });
    this.#emit("tool.requested", frame, projection, {
      toolCall: projected.toolCall,
      step: projected.step,
    });
    this.#repository.markToolCall(projected.toolCall.id, "running");
    const startedAt = Date.now();
    try {
      const result = await execute();
      const normalized = fileToolResult(frame, result, Date.now() - startedAt);
      const call = this.#repository.markToolCall(projected.toolCall.id, "completed", {
        resultSummary: normalized.summary,
        resultContent: normalized.content,
        resultData: normalized.data,
      });
      this.#emit("tool.completed", frame, projection, { toolCall: call });
      return result;
    } catch (error) {
      const code =
        error instanceof Error && /^[A-Z][A-Z0-9_]*$/u.test(error.message.split(":", 1)[0] ?? "")
          ? (error.message.split(":", 1)[0] ?? "FILE_TOOL_FAILED")
          : "FILE_TOOL_FAILED";
      const call = this.#repository.markToolCall(projected.toolCall.id, "failed", {
        errorCode: code,
      });
      this.#emit("tool.failed", frame, projection, {
        toolCall: call,
        reason: code,
      });
      throw error;
    }
  }

  handleActivity(frame: PiActivityEvent): void {
    const projection = this.#projectionByGeneration.get(frame.generationId);
    if (!projection) return;
    this.#repository.recordPiEventSequence(projection.run.id, frame.sequence);
    const itemRef = frame.piItemRef ?? `${frame.type}:${frame.sequence}`;
    let changed = false;
    if (frame.type === "model.started" || frame.type === "model.completed") {
      this.#repository.upsertRunItem({
        runId: projection.run.id,
        piItemRef: itemRef,
        status:
          frame.type === "model.completed" ? (frame.errorCode ? "failed" : "completed") : "running",
        content: {
          type: "model",
          modelRef: frame.modelRef ?? projection.run.selectedModelRef,
          summary:
            frame.resultSummary ??
            (frame.type === "model.completed" ? "模型轮次已完成" : "模型轮次已开始"),
        },
        errorCode: frame.errorCode ?? null,
      });
      changed = true;
    }
    if (frame.type === "reasoning.started" || frame.type === "reasoning.completed") {
      this.#repository.upsertRunItem({
        runId: projection.run.id,
        piItemRef: itemRef,
        status: frame.type === "reasoning.completed" ? "completed" : "running",
        content: {
          type: "reasoning",
          summary:
            frame.type === "reasoning.completed"
              ? "模型推理已完成；Run 时间线仅保存安全摘要。"
              : "模型推理已开始；Run 时间线不记录原始思维链。",
          reasoningTokens: frame.reasoningTokens ?? null,
          contentRedacted: true,
        },
        errorCode: frame.errorCode ?? null,
      });
      changed = true;
    }
    if (frame.type === "plan.updated" && frame.planEntries) {
      this.#repository.upsertRunItem({
        runId: projection.run.id,
        piItemRef: itemRef,
        status: "completed",
        content: {
          type: "plan",
          explanation: frame.explanation ?? null,
          entries: frame.planEntries,
        },
      });
      changed = true;
    }
    if (frame.type === "run.compacting" || frame.type === "run.compacted") {
      this.#repository.recordPiProjection(
        projection.run.id,
        frame.sequence,
        "compaction",
        frame.type === "run.compacted",
      );
      this.#repository.upsertRunItem({
        runId: projection.run.id,
        piItemRef: itemRef,
        status:
          frame.type === "run.compacting" ? "running" : frame.errorCode ? "failed" : "completed",
        content: {
          type: "compaction",
          reason: frame.compactionReason ?? "unknown",
          tokensBefore: frame.tokensBefore ?? null,
          tokensAfter: frame.tokensAfter ?? null,
        },
        errorCode: frame.errorCode ?? null,
      });
      this.#emit(
        frame.type === "run.compacted" ? "run.compacted" : "run.progressed",
        this.#syntheticFrame(frame, projection),
        projection,
        { reason: frame.resultSummary ?? frame.errorCode },
      );
      return;
    }
    if (frame.type === "run.retrying" || frame.type === "run.retry_completed") {
      this.#repository.recordPiProjection(
        projection.run.id,
        frame.sequence,
        "retry",
        frame.type === "run.retry_completed",
      );
      const existing = this.#repository.runItemByRef(projection.run.id, itemRef);
      this.#repository.upsertRunItem({
        runId: projection.run.id,
        piItemRef: itemRef,
        status:
          frame.type === "run.retrying" ? "running" : frame.errorCode ? "failed" : "completed",
        content:
          existing?.content.type === "retry"
            ? existing.content
            : {
                type: "retry",
                attempt: frame.attempt ?? 1,
                maxAttempts: frame.maxAttempts ?? frame.attempt ?? 1,
                delayMs: frame.delayMs ?? 0,
                summary: frame.resultSummary ?? "模型请求正在重试",
              },
        errorCode: frame.errorCode ?? null,
      });
      this.#emit("run.retrying", this.#syntheticFrame(frame, projection), projection, {
        reason: frame.resultSummary ?? frame.errorCode,
      });
      return;
    }
    if (changed) {
      this.#emit("run.progressed", this.#syntheticFrame(frame, projection), projection, {
        reason: frame.resultSummary,
      });
    }
  }

  setPermissionMode(input: {
    conversationId: string;
    mode: ToolPermissionMode;
  }): ToolPermissionModeState {
    const state = this.#repository.setPermissionMode(input);
    if (state.mode !== "full_access") return state;

    // Updating the scope alone does not release tools already waiting for approval.
    for (const [generationId, projection] of this.#projectionByGeneration) {
      if (
        projection.workItem.conversationId !== input.conversationId ||
        this.#abortByGeneration.get(generationId)?.signal.aborted
      ) {
        continue;
      }
      for (const permission of this.#repository.listPermissionsForRun(projection.run.id)) {
        if (permission.status !== "pending") {
          continue;
        }
        this.resolvePermission({
          permissionRequestId: permission.id,
          decision: "once",
          payloadDigest: permission.payloadDigest,
        });
      }
    }
    return state;
  }

  resolvePermission(input: {
    permissionRequestId: string;
    decision: "once" | "session" | "persistent" | "deny";
    payloadDigest: string;
    scopeConversationId?: string | null;
  }): PermissionRequest {
    const permission = this.#broker.resolvePermission(input);
    const projection = [...this.#projectionByGeneration.values()].find(
      ({ run }) => run.id === permission.runId,
    );
    if (projection) {
      this.#emitEvent({
        eventId: randomUUID(),
        type: "permission.resolved",
        conversationId: projection.workItem.conversationId,
        messageId: projection.workItem.messageId,
        sequence: 0,
        occurredAt: new Date().toISOString(),
        payloadVersion: 1,
        payload: {
          permission,
          workItem: this.#repository.workItem(projection.workItem.id),
          run: this.#repository.run(projection.run.id),
        },
      });
    }
    return permission;
  }

  recordByokUsage(record: ByokUsageRecord): void {
    const projection =
      record.operation === "chat"
        ? this.#projectionByGeneration.get(record.operationId)
        : undefined;
    this.#repository.recordByokUsage(record, projection?.run.id);
  }

  byokUsage(query: { conversationId?: string; messageId?: string }) {
    return this.#repository.byokUsage(query);
  }

  completeGeneration(
    generationId: string,
    status: "completed" | "failed" | "interrupted",
    errorCode?: string,
    usageRecords: UsageRecord[] = [],
  ): void {
    const projection = this.#projectionByGeneration.get(generationId);
    if (projection) {
      this.#repository.completeRun(
        projection.run.id,
        status,
        errorCode,
        usageRecords.map((usage) => ({ ...usage, runId: projection.run.id })),
      );
      const workItem = this.#repository.workItem(projection.workItem.id);
      const run = this.#repository.run(projection.run.id);
      this.#emitEvent({
        eventId: randomUUID(),
        type:
          status === "completed"
            ? "run.completed"
            : status === "interrupted"
              ? "run.interrupted"
              : "run.failed",
        conversationId: workItem.conversationId,
        messageId: workItem.messageId,
        sequence: 0,
        occurredAt: new Date().toISOString(),
        payloadVersion: 1,
        payload: { workItem, run, ...(errorCode ? { reason: errorCode } : {}) },
      });
    }
    this.#abortByGeneration.get(generationId)?.abort();
    this.#abortByGeneration.delete(generationId);
    for (const [requestId, requestGenerationId] of this.#generationByRequest) {
      if (requestGenerationId === generationId) this.#generationByRequest.delete(requestId);
    }
    this.#authorizationByGeneration.delete(generationId);
    this.#localWebSearchConfigurationByGeneration.delete(generationId);
    this.#localWebSearchCoordinator.clearGeneration(generationId);
    this.#brokeredBashExecutionByGeneration.delete(generationId);
    this.#projectionByGeneration.delete(generationId);
  }

  requestCancellation(generationId: string): void {
    const projection = this.#projectionByGeneration.get(generationId);
    if (projection) {
      const run = this.#repository.requestRunCancellation(projection.run.id);
      const workItem = this.#repository.workItem(projection.workItem.id);
      this.#emitEvent({
        eventId: randomUUID(),
        type: "run.cancelling",
        conversationId: workItem.conversationId,
        messageId: workItem.messageId,
        sequence: 0,
        occurredAt: new Date().toISOString(),
        payloadVersion: 1,
        payload: { workItem, run },
      });
    }
    this.#abortByGeneration.get(generationId)?.abort();
  }

  async close(): Promise<void> {
    for (const controller of this.#abortByGeneration.values()) controller.abort();
    await this.#broker.stopAll();
    this.#brokeredBashExecutionByGeneration.clear();
    this.#repository.close();
  }

  async handleHostDisconnect(): Promise<void> {
    const generationIds = [...this.#projectionByGeneration.keys()];
    for (const generationId of generationIds) this.requestCancellation(generationId);
    await this.#broker.stopAll();
    for (const generationId of generationIds) {
      if (this.#projectionByGeneration.has(generationId)) {
        this.completeGeneration(generationId, "interrupted", "PI_HOST_DISCONNECTED");
      }
    }
  }

  #prepareBrokeredBashExecution(
    workspaceGrants: WorkspaceGrant[],
    input: {
      activeExecutionGrantId?: string;
      additionalExecutionGrantIds?: string[];
      executionOrigin?: "local_interactive" | "remote_attended" | "remote_unattended";
      requiresHighIsolation?: boolean;
      environmentPolicy?: BrokeredBashEnvironmentPolicy;
      networkPolicy?: BrokeredBashNetworkPolicy;
    },
    runtime: BrokeredBashRuntimeAvailability,
  ): BrokeredBashExecutionContext | undefined {
    if (!this.#brokeredBashV1 || !runtime.available || !runtime.sandboxPolicyVersion) {
      return undefined;
    }
    const grants = new Map(workspaceGrants.map((grant) => [grant.id, grant]));
    const active = input.activeExecutionGrantId
      ? grants.get(input.activeExecutionGrantId)
      : workspaceGrants.length === 1
        ? workspaceGrants[0]
        : undefined;
    if (!active) return undefined;
    const additionalIds = input.additionalExecutionGrantIds ?? [];
    if (
      new Set(additionalIds).size !== additionalIds.length ||
      additionalIds.includes(active.id) ||
      additionalIds.some((grantId) => !grants.has(grantId))
    ) {
      return undefined;
    }
    const requiresIsolatedChangeSet =
      active.access === "read_write" &&
      (input.executionOrigin === "remote_unattended" || input.requiresHighIsolation === true);
    const environmentPolicy = freezeBrokeredBashEnvironmentPolicy(
      input.environmentPolicy ?? BROKERED_BASH_CORE_ENVIRONMENT_POLICY,
      process.env,
    );
    const environmentPolicyDigest = brokeredBashEnvironmentPolicyDigest(environmentPolicy);
    const networkPolicy = input.networkPolicy ?? ({ mode: "deny" } as const);
    const networkPolicyDigest = brokeredBashNetworkPolicyDigest(networkPolicy);
    const networkPolicyId =
      networkPolicy.mode === "deny"
        ? BROKERED_BASH_DENY_NETWORK_POLICY_ID
        : BROKERED_BASH_CONTROLLED_EGRESS_NETWORK_POLICY_ID;
    if (environmentPolicy.mode === "all") return undefined;
    const executionOrigin = input.executionOrigin ?? "local_interactive";
    if (
      executionOrigin !== "local_interactive" &&
      (environmentPolicyDigest !==
        brokeredBashEnvironmentPolicyDigest(BROKERED_BASH_CORE_ENVIRONMENT_POLICY) ||
        networkPolicy.mode !== "deny")
    ) {
      return undefined;
    }
    if (
      runtime.mode === "fake" &&
      (environmentPolicy.mode !== "core" || networkPolicy.mode !== "deny")
    ) {
      return undefined;
    }
    if (
      networkPolicy.mode === "controlled_egress" &&
      (!active.allowNetwork || executionOrigin !== "local_interactive")
    ) {
      return undefined;
    }
    this.#brokeredBashEnvironmentPolicyByDigest.set(environmentPolicyDigest, environmentPolicy);
    this.#brokeredBashNetworkPolicyByDigest.set(networkPolicyDigest, networkPolicy);
    return {
      contractVersion: BROKERED_BASH_CONTRACT_VERSION,
      activeExecutionGrantId: active.id,
      additionalExecutionGrantIds: additionalIds,
      executionProfile: active.access === "read_write" ? "workspace_write" : "read_only",
      executionOrigin,
      workspaceWriteMode:
        active.access !== "read_write"
          ? "none"
          : requiresIsolatedChangeSet
            ? "isolated_change_set"
            : "direct_workspace",
      environmentPolicyId: brokeredBashEnvironmentPolicyId(environmentPolicy),
      environmentPolicyDigest,
      networkPolicyId,
      networkPolicyDigest,
      sandboxPolicyVersion: runtime.sandboxPolicyVersion,
    };
  }

  async #brokeredBashRuntimeAvailability(): Promise<BrokeredBashRuntimeAvailability> {
    if (!this.#brokeredBashV1) {
      return {
        available: false,
        mode: null,
        reason: "BROKERED_BASH_DISABLED",
        sandboxPolicyVersion: null,
        backendId: null,
        platform: null,
      };
    }
    if (this.#brokeredBashRunnerMode === "fake") {
      return {
        available: true,
        mode: "fake",
        reason: "BROKERED_BASH_FAKE_RUNNER_ONLY",
        sandboxPolicyVersion: BROKERED_BASH_FAKE_SANDBOX_POLICY_VERSION,
        backendId: "deterministic_fake",
        platform: "test-only",
      };
    }
    if (this.#brokeredBashRunnerMode !== "macos" || !this.#platformSandboxEngine) {
      return {
        available: false,
        mode: this.#brokeredBashRunnerMode,
        reason: "BROKERED_BASH_RUNNER_MODE_INVALID",
        sandboxPolicyVersion: null,
        backendId: null,
        platform: process.platform,
      };
    }
    const capability = await this.#platformSandboxEngine.probe();
    const requiredCapabilities =
      capability.capabilities.filesystemBoundary &&
      capability.capabilities.hardlinkBoundary &&
      capability.capabilities.readOnlyRoots &&
      capability.capabilities.writableRoots &&
      capability.capabilities.networkDeny &&
      capability.capabilities.sanitizedEnvironment &&
      capability.capabilities.processGroupCleanup &&
      capability.capabilities.descendantSandboxInheritance &&
      !capability.capabilities.pty;
    if (
      !capability.available ||
      !requiredCapabilities ||
      capability.policyVersion !== this.#platformSandboxEngine.policyVersion ||
      !capability.supportedProfiles.includes("read_only") ||
      !capability.supportedProfiles.includes("workspace_write") ||
      !capability.environmentPolicyIds.includes(BROKERED_BASH_CORE_ENVIRONMENT_POLICY_ID) ||
      !capability.networkPolicyIds.includes(BROKERED_BASH_DENY_NETWORK_POLICY_ID)
    ) {
      return {
        available: false,
        mode: "macos",
        reason: capability.reason ?? "BROKERED_BASH_CAPABILITY_PROBE_FAILED",
        sandboxPolicyVersion: null,
        backendId: capability.backendId,
        platform: `${capability.platform} ${capability.platformRelease}`,
      };
    }
    return {
      available: true,
      mode: "macos",
      reason: null,
      sandboxPolicyVersion: capability.policyVersion,
      backendId: capability.backendId,
      platform: `${capability.platform} ${capability.platformRelease}`,
    };
  }

  #ensureProjection(frame: PiToolRequestFrame): ActiveProjection {
    const active = this.#projectionByGeneration.get(frame.generationId);
    if (active) return active;
    const projection = this.#repository.createProjection({
      conversationId: frame.conversationId,
      messageId: frame.assistantMessageId,
      branchId: frame.branchId,
      title: "对话轮次",
      selectedModelRef: this.#selectedModelRef(frame.assistantMessageId),
      thinkingLevel: "medium",
      piPackageVersion: "0.84.4",
      piHostContractVersion,
      piSessionRef: `branch:${frame.branchId}`,
    });
    this.#projectionByGeneration.set(frame.generationId, projection);
    this.#emit("run.started", frame, projection, {});
    return projection;
  }

  #emit(
    type: ChatEvent["type"],
    frame: Pick<PiToolRequestFrame, "conversationId" | "assistantMessageId">,
    projection: ActiveProjection,
    payload: {
      toolCall?: ToolCall;
      step?: RunStep;
      permission?: PermissionRequest;
      reason?: string;
      reconciliation?: NonNullable<ChatEvent["payload"]["reconciliation"]>;
    },
  ): void {
    this.#emitEvent({
      eventId: randomUUID(),
      type,
      conversationId: frame.conversationId,
      messageId: frame.assistantMessageId,
      sequence: 0,
      occurredAt: new Date().toISOString(),
      payloadVersion: 1,
      payload: {
        workItem: this.#repository.workItem(projection.workItem.id),
        run: this.#repository.run(projection.run.id),
        ...payload,
      },
    });
  }

  #syntheticFrame(
    _frame: PiActivityEvent,
    projection: ActiveProjection,
  ): Pick<PiToolRequestFrame, "conversationId" | "assistantMessageId"> {
    return {
      conversationId: projection.workItem.conversationId,
      assistantMessageId: projection.workItem.messageId,
    };
  }
}
