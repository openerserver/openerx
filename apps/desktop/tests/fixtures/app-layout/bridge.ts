import type { DesktopBridge, ModelCatalogEntry, SkillInstallation } from "@openerx/contracts";

const timestamp = "2026-10-09T00:00:00.000Z";
export const fixtureModel: ModelCatalogEntry = {
  modelRef: "pi/default",
  displayName: "隔离文本模型",
  version: "fixture",
  capabilities: {
    textInput: true,
    imageInput: false,
    fileInput: false,
    functionCalling: true,
    structuredOutput: true,
  },
  contextWindow: 128_000,
  maxOutputTokens: 16_384,
  status: "available",
  priceRef: "fixture/price",
  priceSummary: "合成目录，不会调用模型",
  free: true,
  thinkingLevels: ["off", "medium"],
};
export const fixtureSkills: SkillInstallation[] = Array.from({ length: 12 }, (_, index) => ({
  id: `synthetic-skill-${index}`,
  ownerProfileId: "fixture-owner",
  name: `synthetic-skill-${index}`,
  displayName: `隔离 Skill ${index + 1}`,
  description:
    "Analyze supplied documents and create a structured summary with explicit sources and next actions. Only synthetic layout content.",
  version: "1.0.0",
  publisher: "fixture",
  scope: "builtin",
  workspaceId: null,
  sourceKind: "built_in",
  sourceLabel: "synthetic bundled fixture",
  checksumSha256: "a".repeat(64),
  trust: "bundled",
  enabled: true,
  autoInvoke: true,
  packageState: "installed",
  permissionDigest: "b".repeat(64),
  approvedPermissionDigest: "b".repeat(64),
  declaredTools: [],
  declaredMcpServers: [],
  permissions: [],
  platforms: ["darwin", "win32"],
  rollbackVersions: [],
  installedAt: timestamp,
  updatedAt: timestamp,
  lastUsedAt: null,
  revision: 1,
}));

/** Read fixtures only. Every unlisted API is blocked and recorded, including model and data mutations. */
export function createLayoutBridge(options: { fileFailure?: boolean; toolFailure?: boolean } = {}) {
  const state = {
    fileFailure: options.fileFailure ?? false,
    toolFailure: options.toolFailure ?? false,
  };
  const reads: string[] = [];
  const blockedCalls: string[] = [];
  const emptyMethods = [
    "listProjects",
    "listConversations",
    "listArtifacts",
    "listWorkspaces",
    "listWorkItems",
    "listPermissionRequests",
    "listCapabilityScopes",
    "listAutomations",
    "listAutomationRuns",
    "listRemoteConnectionRequests",
    "listBrowserComputerUseSessions",
    "listDesktopControlSessions",
    "listMcpServerAuthorizationStates",
    "listSkillInvocations",
    "listMemories",
    "listMemoryMergeReviews",
    "listMemorySources",
    "listSyncConflicts",
    "listDevices",
    "getChatEvents",
    "search",
    "getUsageRecords",
  ];
  const readMethods: Record<string, (...args: unknown[]) => unknown> = Object.fromEntries(
    emptyMethods.map((key) => [key, () => []]),
  );
  Object.assign(readMethods, {
    listModels: () => [fixtureModel],
    listSkills: () => fixtureSkills,
    listFiles: () => {
      if (state.fileFailure) throw Error("FIXTURE_FILE_READ_FAILED");
      return [];
    },
    listToolRuntimeReadiness: () => {
      if (state.toolFailure) throw Error("FIXTURE_TOOL_READ_FAILED");
      return [];
    },
    listMcpServers: () => {
      if (state.toolFailure) throw Error("FIXTURE_MCP_READ_FAILED");
      return [];
    },
    getPiRuntimeSettings: () => {
      if (state.toolFailure) throw Error("FIXTURE_PI_READ_FAILED");
      return { ownerProfileId: "fixture-owner", nativeToolsEnabled: false, updatedAt: null };
    },
    getAccountState: () => ({ status: "signed_out", account: null, session: null, reason: null }),
    getEnvironment: () => ({ platform: "darwin", arch: "arm64", appVersion: "fixture" }),
    getModelServiceSettings: () => ({
      mode: "byok",
      byok: {
        baseUrl: "https://invalid.fixture",
        modelId: "fixture-text",
        displayName: "隔离文本模型",
        contextWindow: 128_000,
        maxOutputTokens: 16_384,
        capabilities: { imageInput: false, functionCalling: true, reasoning: true },
      },
      credentialConfigured: false,
      providerCredentials: {},
      updatedAt: null,
    }),
    getLoginStartupSettings: () => ({
      supported: false,
      openAtLogin: false,
      launchesInBackground: false,
    }),
    getReleaseUpdateState: () => ({
      status: "disabled",
      channel: "internal",
      currentVersion: "fixture",
      availableVersion: null,
      progressPercentage: null,
      lastCheckedAt: null,
      reason: "UPDATE_NOT_CONFIGURED",
    }),
    getRemoteState: () => ({
      available: false,
      enabled: false,
      host: null,
      pairings: [],
      reason: "AUTHENTICATION_REQUIRED",
    }),
    getBrowserConnectionState: () => ({
      mode: "auto",
      extensionConnected: false,
      authorizedTabs: [],
      extensionDirectory: "/tmp/synthetic-browser-fixture",
      fullCdpEnabled: false,
    }),
    getLocalWebSearchSettings: () => ({
      providerId: "direct:baidu-json",
      locale: "zh-CN",
      safeSearch: "moderate",
      featureEnabled: false,
      allowProviderFallback: false,
      cacheMode: "turn",
      updatedAt: null,
      providers: [],
    }),
    getMemorySettings: () => ({
      ownerProfileId: "fixture-owner",
      memoriesEnabled: false,
      useMemories: false,
      generateMemories: false,
      syncMemories: false,
      disableOnExternalContext: true,
      idleDelayMinutes: 30,
      minRateLimitRemainingPercent: 20,
      updatedAt: timestamp,
      revision: 1,
    }),
    getPersonalDataSummary: () => ({
      generatedAt: timestamp,
      conversations: 0,
      messages: 0,
      files: 0,
      artifacts: 0,
      workItems: 0,
      skillInstallations: fixtureSkills.length,
      memories: 0,
    }),
    getDiagnosticsPreview: () => ({
      generatedAt: timestamp,
      health: "ready",
      eventCount: 3,
      errorCount: 0,
      warningCount: 0,
      restartCount: 0,
      firstEventAt: timestamp,
      lastEventAt: timestamp,
      sources: ["synthetic-fixture"],
      performance: [
        { name: "desktop_interactive", value: 420, unit: "ms", budget: 5000, status: "pass" },
        { name: "app_service_ready", value: 360, unit: "ms", budget: 5000, status: "pass" },
        { name: "idle_rss", value: 180, unit: "mib", budget: 512, status: "pass" },
      ],
      includes: ["合成应用版本与平台"],
      excludes: ["真实账户与对话数据"],
    }),
  });
  const bridge = new Proxy(
    {},
    {
      get(_target, key) {
        const name = String(key);
        if (name.startsWith("on")) return () => () => undefined;
        if (name in readMethods)
          return async (...args: unknown[]) => {
            reads.push(name);
            return readMethods[name]?.(...args);
          };
        return () => {
          blockedCalls.push(name);
          throw Error(`UNEXPECTED_BRIDGE_CALL:${name}`);
        };
      },
    },
  ) as DesktopBridge;
  return { bridge, state, reads, blockedCalls };
}
