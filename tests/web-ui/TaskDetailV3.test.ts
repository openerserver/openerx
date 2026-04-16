import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { computed, defineComponent, nextTick, reactive, ref } from "vue";
import type { TreeTask } from "../../control-plane/web-ui/src/composables/useProjectTreeTask";

const MISSING_TASK_LOAD_ERROR =
  "当前任务不存在。当前 UI 指向的 app 数据库实例中找不到这个任务，可能是历史标签仍指向旧数据库实例。请切换到正确的数据库实例，或关闭这个 Workbench 标签。";

const routeState = vi.hoisted(() => ({
  params: { taskId: "task-1" },
  query: {},
}));

const routerState = vi.hoisted(() => ({
  replace: vi.fn(),
}));

const realtimeStoreState = vi.hoisted(() => ({
  connected: true,
  events: [] as Array<Record<string, unknown>>,
  subscribeTask: vi.fn(),
  subscribeProject: vi.fn(),
}));
const realtimeStoreMock = reactive(realtimeStoreState) as typeof realtimeStoreState;

const apiMocks = vi.hoisted(() => ({
  adoptParallelCandidate: vi.fn(),
  cancelTaskPhase: vi.fn(),
  continueTask: vi.fn(),
  forkTaskSession: vi.fn(),
  getModelsList: vi.fn(),
  getTaskAgentRuns: vi.fn(),
  getTaskPhases: vi.fn(),
  getTaskPhaseView: vi.fn(),
  getTaskSessions: vi.fn(),
  getTaskExecutionTraceView: vi.fn(),
  getTaskMemberView: vi.fn(),
  getTaskConversationMessages: vi.fn(),
  getTaskWorkflowView: vi.fn(),
  listTaskRuntimePermissions: vi.fn(),
  replyTaskRuntimePermission: vi.fn(),
  terminateAgent: vi.fn(),
  updateTask: vi.fn(),
}));

const legacyParallelFixtureState = vi.hoisted(() => ({
  taskSessionsResponse: { data: [] as Array<any> },
  agentRunsResponse: { data: [] as Array<any> },
  domainRunsResponse: { data: [] as Array<any> },
  domainRunDetailResponse: null as { data: any } | null,
  phaseResponse: null as { data: Array<any> } | null,
  phaseViewResponses: new Map<string, { data: any }>(),
  domainRunDetailImplementation: null as
    | null
    | ((taskId: string, runId: string) => Promise<{ data: any }> | { data: any }),
}));

const originalGetTaskSessionsMockResolvedValue = apiMocks.getTaskSessions.mockResolvedValue.bind(
  apiMocks.getTaskSessions,
);
apiMocks.getTaskSessions.mockResolvedValue = ((value: { data: Array<any> }) => {
  legacyParallelFixtureState.taskSessionsResponse = value;
  return originalGetTaskSessionsMockResolvedValue(value);
}) as typeof apiMocks.getTaskSessions.mockResolvedValue;

const originalGetTaskAgentRunsMockResolvedValue = apiMocks.getTaskAgentRuns.mockResolvedValue.bind(
  apiMocks.getTaskAgentRuns,
);
apiMocks.getTaskAgentRuns.mockResolvedValue = ((value: { data: Array<any> }) => {
  legacyParallelFixtureState.agentRunsResponse = value;
  return originalGetTaskAgentRunsMockResolvedValue(value);
}) as typeof apiMocks.getTaskAgentRuns.mockResolvedValue;

function setLegacyParallelRuns(runs: Array<any>) {
  legacyParallelFixtureState.domainRunsResponse = { data: runs };
}

function setLegacyParallelRunDetail(detail: any) {
  legacyParallelFixtureState.domainRunDetailResponse = detail == null ? null : { data: detail };
  legacyParallelFixtureState.domainRunDetailImplementation = null;
}

function setLegacyParallelRunDetailImplementation(
  implementation: (taskId: string, runId: string) => Promise<{ data: any }> | { data: any },
) {
  legacyParallelFixtureState.domainRunDetailImplementation = implementation;
  legacyParallelFixtureState.domainRunDetailResponse = null;
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return {
    promise,
    resolve,
    reject,
  };
}

const taskStateRaw = vi.hoisted(() => ({
  task: {
    id: "task-1",
    nodeId: "task-1",
    projectId: "proj-1",
    sessionId: "ses-1",
    title: "任务详情 V3",
    prompt: "执行任务详情页测试",
    status: "running",
    selectedModel: null,
    autoAdvanceStages: false,
    executionMode: undefined,
    result: undefined,
    agentRunId: "run-1",
    createdAt: "2026-03-22T00:00:00.000Z",
  } as any,
  node: { id: "node-task-1" },
  ancestors: [] as Array<unknown>,
  projectId: "proj-1",
  loading: false,
  error: "",
  refresh: vi.fn(async () => undefined),
}));
const taskState = reactive(taskStateRaw) as typeof taskStateRaw;

const branchState = vi.hoisted(() => ({
  flatNodes: [
    {
      id: "node-session-1",
      runtimeSessionId: "ses-1",
      isActive: true,
      contentText: "主分支",
      branchName: "main",
    },
  ] as Array<any>,
  currentSessionId: "ses-1" as string | null,
  currentPhaseId: null as string | null,
  sessionSummaries: null as Array<any> | null,
  selectedNode: {
    id: "node-session-1",
    runtimeSessionId: "ses-1",
    isActive: true,
    contentText: "主分支",
    branchName: "main",
  } as any,
  refresh: vi.fn(async () => undefined),
}));
const branchSessionSummariesRef = ref<Array<any>>([]);

const messagesState = vi.hoisted(() => ({
  trace: null as Record<string, unknown> | null,
  conversationItems: [] as Array<unknown>,
  phaseSlices: [] as Array<any>,
  hasStreamingAssistant: false,
  hasOlderHistory: false,
  historyLoading: false,
  clearPendingAssistantDraft: vi.fn(),
  error: null as string | null,
  loading: false,
  loadOlderHistory: vi.fn(async () => undefined),
  refresh: vi.fn(async () => undefined),
  seedPendingAssistantDraft: vi.fn(),
  sourceMessages: [] as Array<unknown>,
}));
const messagesStoreMock = reactive(messagesState) as typeof messagesState;

vi.mock("vue-router", () => ({
  useRoute: () => routeState,
  useRouter: () => routerState,
}));

vi.mock("../../control-plane/web-ui/src/stores/realtime", () => ({
  useRealtimeStore: () => realtimeStoreMock,
}));

vi.mock("../../control-plane/web-ui/src/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../control-plane/web-ui/src/lib/api")>();
  return {
    ...actual,
    ...apiMocks,
  };
});

vi.mock("../../control-plane/web-ui/src/composables/useProjectTreeTask", () => ({
  useProjectTreeTask: () => ({
    task: computed({
      get: () => taskState.task,
      set: (value) => {
        taskState.task = value;
      },
    }),
    node: computed({
      get: () => taskState.node,
      set: (value) => {
        taskState.node = value;
      },
    }),
    ancestors: computed({
      get: () => taskState.ancestors,
      set: (value) => {
        taskState.ancestors = value;
      },
    }),
    projectId: computed({
      get: () => taskState.projectId,
      set: (value) => {
        taskState.projectId = value;
      },
    }),
    loading: computed(() => taskState.loading),
    error: computed(() => taskState.error),
    refresh: taskState.refresh,
  }),
}));

vi.mock("../../control-plane/web-ui/src/composables/useTreeBranches", () => ({
  useTreeBranches: () => ({
    currentSessionId: computed(() => branchState.currentSessionId),
    currentPhaseId: computed(() => branchState.currentPhaseId),
    flatNodes: computed(() => branchState.flatNodes),
    sessionSummaries: branchSessionSummariesRef,
    selectedNode: computed(() => branchState.selectedNode),
    loading: ref(false),
    error: ref<string | null>(null),
    refresh: branchState.refresh,
  }),
}));

vi.mock("../../control-plane/web-ui/src/composables/useTaskMessageSnapshot", async () => {
  return {
    useTaskMessageSnapshot: () => ({
      activeSessionId: ref<string | undefined>(undefined),
      error: computed(() => messagesStoreMock.error),
      hasOlderHistory: computed(() => messagesStoreMock.hasOlderHistory),
      historyLoading: computed(() => messagesStoreMock.historyLoading),
      loading: computed(() => messagesStoreMock.loading),
      loadOlderHistory: messagesState.loadOlderHistory,
      phaseSlices: computed(() => messagesStoreMock.phaseSlices),
      refresh: messagesState.refresh,
      resolvedSessionId: ref<string | undefined>(undefined),
      sourceMessages: computed(() => messagesStoreMock.sourceMessages),
      trace: computed(() => messagesStoreMock.trace),
    }),
  };
});

vi.mock("../../control-plane/web-ui/src/composables/useTaskMessageStore", async () => {
  const { getTaskDetailRefreshRequest } = await import(
    "../../control-plane/web-ui/src/lib/task-detail-refresh-policy"
  );
  const { toTaskMessagePatchEvent } = await import(
    "../../control-plane/web-ui/src/lib/task-message-patch-event"
  );

  return {
    useTaskMessageStore: () => ({
      conversationItems: computed(() => messagesStoreMock.conversationItems),
      clearPendingAssistantDraft: messagesState.clearPendingAssistantDraft,
      hasStreamingAssistant: computed(() => messagesStoreMock.hasStreamingAssistant),
      latestTaskRefreshRequest: computed(() => {
        const event = realtimeStoreMock.events.find(
          (entry) => entry.taskId === String(routeState.params.taskId || ""),
        );
        return getTaskDetailRefreshRequest(event ? toTaskMessagePatchEvent(event as any) : null);
      }),
      realtimeConnected: computed(() => realtimeStoreMock.connected),
      needsMessagePollingFallback: computed(() => false),
      seedPendingAssistantDraft: messagesState.seedPendingAssistantDraft,
    }),
  };
});

vi.mock("../../control-plane/web-ui/src/lib/message-normalize", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../control-plane/web-ui/src/lib/message-normalize")>();
  return actual;
});

const successMessageMock = vi.fn();
const errorMessageMock = vi.fn();
const mountedWrappers: Array<{ unmount: () => void }> = [];

vi.mock("ant-design-vue", () => ({
  message: {
    success: successMessageMock,
    error: errorMessageMock,
    warning: vi.fn(),
    info: vi.fn(),
  },
}));

function createPassThroughStub(name: string) {
  return defineComponent({
    name,
    props: ["message", "description", "title"],
    template: "<div><slot />{{ title }}{{ message }}{{ description }}</div>",
  });
}

const ButtonStub = defineComponent({
  name: "AButton",
  props: {
    loading: { type: Boolean, default: false },
  },
  emits: ["click"],
  template:
    '<button type="button" :data-loading="loading" @click="$emit(\'click\', $event)"><slot /></button>',
});

const SelectStub = defineComponent({
  name: "ASelect",
  props: {
    value: { type: String, default: undefined },
    options: { type: Array, default: () => [] },
  },
  emits: ["update:value"],
  methods: {
    optionValue(option: unknown) {
      return String((option as { value?: string }).value ?? "");
    },
    optionLabel(option: unknown) {
      return String((option as { label?: string }).label ?? "");
    },
  },
  template: `
    <select data-testid="select" :value="value" @change="$emit('update:value', $event.target.value)">
      <option v-for="option in options" :key="optionValue(option)" :value="optionValue(option)">
        {{ optionLabel(option) }}
      </option>
    </select>
  `,
});

const ChatComposerStub = defineComponent({
  name: "ChatComposer",
  props: {
    canTerminate: { type: Boolean, default: false },
    actionDisabled: { type: Boolean, default: false },
    forkDisabled: { type: Boolean, default: false },
    showFork: { type: Boolean, default: true },
    inputDisabled: { type: Boolean, default: false },
    isExecuting: { type: Boolean, default: false },
  },
  emits: [
    "continue",
    "fork",
    "terminate",
    "removeQueued",
    "clearQueued",
    "refreshModels",
    "update:selectedModel",
  ],
  template:
    '<div data-testid="chat-composer" :data-can-terminate="String(canTerminate)" :data-action-disabled="String(actionDisabled)" :data-fork-disabled="String(forkDisabled)" :data-show-fork="String(showFork)" :data-input-disabled="String(inputDisabled)" :data-is-executing="String(isExecuting)"><button type="button" data-testid="composer-continue" @click="$emit(\'continue\', \'新的 follow-up\')">continue</button></div>',
});

const ChatMessageListStub = defineComponent({
  name: "ChatMessageList",
  props: {
    embedded: { type: Boolean, default: false },
    items: { type: Array, default: () => [] },
    activeSessionId: { type: String, default: undefined },
    forceScrollToken: { type: Number, default: 0 },
  },
  methods: {
    itemText(item: unknown) {
      const record = item as {
        text?: string;
        candidates?: Array<{ label?: string }>;
      };
      if (typeof record?.text === "string" && record.text.length > 0) {
        return record.text;
      }
      return record?.candidates?.[0]?.label ?? "";
    },
    candidateTexts(item: unknown) {
      const record = item as {
        candidates?: Array<{ items?: Array<{ text?: string }> }>;
      };
      return (record?.candidates ?? [])
        .flatMap((candidate) => candidate.items ?? [])
        .map((candidateItem) => String(candidateItem?.text ?? ""))
        .filter(Boolean)
        .join("\n");
    },
    candidateStatuses(item: unknown) {
      const record = item as {
        candidates?: Array<{ status?: string }>;
      };
      return (record?.candidates ?? [])
        .map((candidate) => String(candidate?.status ?? ""))
        .join("|");
    },
    candidateTraceStates(item: unknown) {
      const record = item as {
        candidates?: Array<{ traceState?: string }>;
      };
      return (record?.candidates ?? [])
        .map((candidate) => String(candidate?.traceState ?? ""))
        .join("|");
    },
    candidateModels(item: unknown) {
      const record = item as {
        candidates?: Array<{ model?: string }>;
      };
      return (record?.candidates ?? [])
        .map((candidate) => String(candidate?.model ?? ""))
        .join("|");
    },
    candidateCanAdopt(item: unknown) {
      const record = item as {
        candidates?: Array<{ canAdopt?: boolean }>;
      };
      return (record?.candidates ?? [])
        .map((candidate) => String(Boolean(candidate?.canAdopt)))
        .join("|");
    },
    candidateIsAdopted(item: unknown) {
      const record = item as {
        candidates?: Array<{ isAdopted?: boolean }>;
      };
      return (record?.candidates ?? [])
        .map((candidate) => String(Boolean(candidate?.isAdopted)))
        .join("|");
    },
    candidateToolCallCounts(item: unknown) {
      const record = item as {
        candidates?: Array<{ items?: Array<{ toolCalls?: Array<unknown> }> }>;
      };
      return (record?.candidates ?? [])
        .map((candidate) =>
          String(
            (candidate.items ?? []).reduce(
              (count, entry) => count + (Array.isArray(entry?.toolCalls) ? entry.toolCalls.length : 0),
              0,
            ),
          ),
        )
        .join("|");
    },
    candidateEntryRoles(item: unknown) {
      const record = item as {
        candidates?: Array<{ items?: Array<{ role?: string }> }>;
      };
      return (record?.candidates ?? [])
        .map((candidate) =>
          (candidate.items ?? []).map((entry) => String(entry?.role ?? "")).join(","),
        )
        .join("|");
    },
    candidateToolOutputs(item: unknown) {
      const record = item as {
        candidates?: Array<{
          items?: Array<{ toolCalls?: Array<{ outputPreview?: string }> }>;
        }>;
      };
      return (record?.candidates ?? [])
        .map((candidate) =>
          (candidate.items ?? [])
            .flatMap((entry) =>
              (entry.toolCalls ?? [])
                .map((tool) => String(tool?.outputPreview ?? "").trim())
                .filter(Boolean),
            )
            .join("~"),
        )
        .join("|");
    },
    candidateAgents(item: unknown) {
      const record = item as {
        candidates?: Array<{ items?: Array<{ agent?: string }> }>;
      };
      return (record?.candidates ?? [])
        .map((candidate) =>
          (candidate.items ?? [])
            .map((entry) => String(entry?.agent ?? "").trim())
            .filter(Boolean)
            .join(","),
        )
        .join("|");
    },
  },
  template: `
    <div data-testid="chat-message-list" :data-embedded="String(embedded)">
      <div
        data-testid="chat-message-list-meta"
        :data-session-id="activeSessionId || ''"
        :data-force-scroll-token="String(forceScrollToken)"
        :data-embedded="String(embedded)"
      />
      <div
        v-for="item in items"
        :key="item.key"
        class="chat-item"
        :data-role="item.role"
        :data-text="itemText(item)"
        :data-candidate-statuses="item.role === 'parallel' ? candidateStatuses(item) : ''"
        :data-candidate-trace-states="item.role === 'parallel' ? candidateTraceStates(item) : ''"
        :data-candidate-models="item.role === 'parallel' ? candidateModels(item) : ''"
        :data-candidate-can-adopt="item.role === 'parallel' ? candidateCanAdopt(item) : ''"
        :data-candidate-is-adopted="item.role === 'parallel' ? candidateIsAdopted(item) : ''"
        :data-candidate-tool-call-counts="item.role === 'parallel' ? candidateToolCallCounts(item) : ''"
        :data-candidate-entry-roles="item.role === 'parallel' ? candidateEntryRoles(item) : ''"
        :data-candidate-tool-outputs="item.role === 'parallel' ? candidateToolOutputs(item) : ''"
        :data-candidate-agents="item.role === 'parallel' ? candidateAgents(item) : ''"
      >
        {{ item.role }}:{{ itemText(item) }}
        <div v-if="item.role === 'parallel'" class="parallel-candidate-texts">{{ candidateTexts(item) }}</div>
      </div>
    </div>
  `,
});

const TaskDetailPhaseBlockListStub = defineComponent({
  name: "TaskDetailPhaseBlockList",
  props: {
    blocks: { type: Array, default: () => [] },
  },
  methods: {
    itemText(item: unknown) {
      const record = item as {
        text?: string;
        candidates?: Array<{ label?: string }>;
      };
      if (typeof record?.text === "string" && record.text.length > 0) {
        return record.text;
      }
      return record?.candidates?.[0]?.label ?? "";
    },
  },
  template: `
    <div data-testid="phase-block-list">
      <section
        v-for="block in blocks"
        :key="block.key"
        class="task-detail-v3-phase-block"
        :data-phase-id="block.phaseId"
        :data-phase-index="String(block.phaseIndex)"
      >
        <header>{{ block.phaseIndex }}|{{ block.phaseKind }}|{{ block.status }}|{{ block.triggerType }}</header>
        <div
          v-for="item in block.items"
          :key="item.key"
          class="phase-block-item"
          :data-role="item.role"
          :data-text="itemText(item)"
        >
          {{ item.role }}:{{ itemText(item) }}
        </div>
      </section>
    </div>
  `,
});

function getFixtureDataArray<T>(response: { data?: Array<T> } | null | undefined) {
  return Array.isArray(response?.data) ? response.data : [];
}

function toFixtureTimestamp(value: unknown) {
  if (typeof value !== "string" || value.trim().length === 0) {
    return null;
  }

  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? null : timestamp;
}

function isTerminalFixturePhaseStatus(status: unknown) {
  return status === "completed" || status === "failed" || status === "cancelled";
}

type LegacyNormalizedAgentRun = Record<string, any> & {
  runId?: string | null;
  sessionId?: string | null;
  candidateIndex?: number | null;
  agentType: string;
  modelUsed: string | null;
  tokenUsed: number;
  createdAt: string | null | undefined;
};

type LegacyProjectionCandidateEntry = {
  node?: Record<string, any>;
  agentRun?: LegacyNormalizedAgentRun;
  projectedSessionId?: string | null;
};

function normalizeLegacyAgentRun(record: Record<string, any>): LegacyNormalizedAgentRun {
  return {
    ...record,
    agentType:
      typeof record.agentType === "string"
        ? record.agentType
        : typeof record.agent === "string"
          ? record.agent
          : "executor",
    modelUsed:
      typeof record.modelUsed === "string"
        ? record.modelUsed
        : typeof record.model === "string"
          ? record.model
          : null,
    tokenUsed: typeof record.tokenUsed === "number" ? record.tokenUsed : 0,
    createdAt:
      typeof record.createdAt === "string"
        ? record.createdAt
        : typeof record.startedAt === "string"
          ? record.startedAt
          : typeof record.finishedAt === "string"
            ? record.finishedAt
            : taskState.task.createdAt,
  };
}

async function resolveLegacyDomainRunDetail(runId: string) {
  if (typeof legacyParallelFixtureState.domainRunDetailImplementation === "function") {
    const response = await legacyParallelFixtureState.domainRunDetailImplementation("task-1", runId);
    return response?.data ?? null;
  }

  return legacyParallelFixtureState.domainRunDetailResponse?.data ?? null;
}

async function buildLegacyParallelFixtureProjection() {
  const legacyDomainRuns = getFixtureDataArray(legacyParallelFixtureState.domainRunsResponse).filter(
    (run) => run?.orchestrationKind === "parallel",
  );
  const explicitAgentRuns = getFixtureDataArray(legacyParallelFixtureState.agentRunsResponse).map(
    (record) => normalizeLegacyAgentRun(record as Record<string, any>),
  );
  const topLevelSessionIds = new Set(
    (branchState.flatNodes ?? [])
      .filter((node) => !node?.parentId || node.parentId === "node-task-1")
      .map((node) => String(node.runtimeSessionId ?? ""))
      .filter(Boolean),
  );

  if (legacyDomainRuns.length === 0) {
    return {
      sessions: [] as Array<any>,
      agentRuns: explicitAgentRuns,
      groups: [] as Array<{ rootSessionId?: string; candidateSessionIds: string[]; startedAt?: string }>,
    };
  }

  const detailsByRunId = new Map<string, any>();
  for (const run of legacyDomainRuns) {
    const detail = await resolveLegacyDomainRunDetail(String(run.id));
    if (detail) {
      detailsByRunId.set(String(run.id), detail);
    }
  }

  const normalizedAgentRuns = explicitAgentRuns.slice();
  const normalizedAgentRunKeys = new Set(
    normalizedAgentRuns.map((record) => {
      const candidateIndex =
        typeof record.candidateIndex === "number" ? record.candidateIndex : Number.NaN;
      return `${record.runId ?? ""}|${record.sessionId ?? ""}|${candidateIndex}`;
    }),
  );
  const derivedGroups: Array<{
    phaseId: string;
    rootSessionId?: string;
    candidateSessionIds: string[];
    startedAt?: string;
    finishedAt?: string;
    updatedAt?: string;
    status?: string;
    candidateCount?: number;
    winnerSessionId?: string | null;
  }> = [];

  const resolveProjectedSessionId = (
    sessionId: unknown,
    runRootSessionId: unknown,
    coordinationKey: string,
    candidateIndex: number,
  ) => {
    if (typeof sessionId !== "string" || sessionId.length === 0) {
      return null;
    }

    if (sessionId === runRootSessionId) {
      return `legacy:${coordinationKey}:candidate:${candidateIndex}`;
    }

    if (
      typeof runRootSessionId === "string" &&
      runRootSessionId.length > 0 &&
      topLevelSessionIds.has(sessionId)
    ) {
      return `legacy:${coordinationKey}:candidate:${candidateIndex}`;
    }

    return sessionId;
  };

  const collectRunCandidates = (run: Record<string, any>) => {
    const runId = String(run.id);
    const detail = detailsByRunId.get(runId);
    const detailNodes = Array.isArray(detail?.candidateNodes) ? detail.candidateNodes : [];
    const candidatesByIndex = new Map<number, LegacyProjectionCandidateEntry>();

    for (const [nodePosition, node] of detailNodes.entries()) {
      const candidateIndex =
        typeof node?.candidateIndex === "number" ? node.candidateIndex : nodePosition;
      const projectedSessionId = resolveProjectedSessionId(
        node?.sessionId,
        detail?.run?.rootSessionId ?? run.rootSessionId,
        runId,
        candidateIndex,
      );
      const existing = candidatesByIndex.get(candidateIndex) ?? {};
      candidatesByIndex.set(candidateIndex, { ...existing, node, projectedSessionId });

      const normalizedKey = `${runId}|${projectedSessionId ?? ""}|${candidateIndex}`;
      if (!normalizedAgentRunKeys.has(normalizedKey)) {
        normalizedAgentRuns.push(
          normalizeLegacyAgentRun({
            id: node?.agentRunId ?? `${runId}:candidate:${candidateIndex}`,
            taskId: taskState.task.id,
            runId,
            runNodeId: node?.id ?? null,
            sessionId: projectedSessionId ?? node?.sessionId ?? null,
            candidateIndex,
            agentType: node?.agentType ?? "executor",
            modelUsed: node?.modelUsed ?? null,
            status: node?.status ?? detail?.run?.status ?? "pending",
            result: node?.resultSummary ?? node?.resultText ?? null,
            startedAt: node?.startedAt ?? node?.createdAt ?? detail?.run?.startedAt ?? detail?.run?.createdAt,
            finishedAt: node?.finishedAt ?? node?.updatedAt ?? detail?.run?.finishedAt ?? detail?.run?.updatedAt,
            createdAt: node?.createdAt ?? node?.startedAt ?? detail?.run?.createdAt,
          }),
        );
        normalizedAgentRunKeys.add(normalizedKey);
      }
    }

    for (const agentRun of normalizedAgentRuns) {
      if (agentRun.runId !== runId || typeof agentRun.candidateIndex !== "number") {
        continue;
      }
      const projectedSessionId = resolveProjectedSessionId(
        agentRun.sessionId,
        detail?.run?.rootSessionId ?? run.rootSessionId,
        runId,
        agentRun.candidateIndex,
      );
      if (projectedSessionId) {
        agentRun.sessionId = projectedSessionId;
      }
      const existing = candidatesByIndex.get(agentRun.candidateIndex) ?? {};
      candidatesByIndex.set(agentRun.candidateIndex, {
        ...existing,
        agentRun,
        projectedSessionId: existing.projectedSessionId ?? projectedSessionId,
      });
    }

    return candidatesByIndex;
  };

  const assignedRunIds = new Set<string>();
  const derivedSessions: Array<any> = [];
  const sortedLegacyRuns = legacyDomainRuns
    .slice()
    .sort(
      (left, right) =>
        (toFixtureTimestamp(left.startedAt ?? left.createdAt) ?? 0) -
        (toFixtureTimestamp(right.startedAt ?? right.createdAt) ?? 0),
    );

  const pushCandidateSessions = (args: {
    coordinationKey: string;
    run: Record<string, any>;
    candidatesByIndex: Map<number, LegacyProjectionCandidateEntry>;
    expectedCandidateCount?: number;
    detail?: Record<string, any> | null;
  }) => {
    const expectedCandidateCount =
      typeof args.expectedCandidateCount === "number" && args.expectedCandidateCount > 0
        ? args.expectedCandidateCount
        : undefined;
    const candidateIndexes = new Set<number>(args.candidatesByIndex.keys());

    if (typeof expectedCandidateCount === "number") {
      for (let index = 0; index < expectedCandidateCount; index += 1) {
        if (args.candidatesByIndex.has(index)) {
          candidateIndexes.add(index);
        }
      }
    }

    const orderedIndexes = Array.from(candidateIndexes).sort((left, right) => left - right);
    const winnerCandidateIndex =
      typeof args.detail?.winnerCandidateIndex === "number" ? args.detail.winnerCandidateIndex : null;
    const winnerSessionId =
      winnerCandidateIndex != null
        ? args.candidatesByIndex.get(winnerCandidateIndex)?.projectedSessionId ??
          args.candidatesByIndex.get(winnerCandidateIndex)?.node?.sessionId ??
          args.candidatesByIndex.get(winnerCandidateIndex)?.agentRun?.sessionId ??
          null
        : null;
    const groupCandidateSessionIds: string[] = [];

    for (const candidateIndex of orderedIndexes) {
      const entry = args.candidatesByIndex.get(candidateIndex);
      const sessionId =
        entry?.projectedSessionId ?? entry?.node?.sessionId ?? entry?.agentRun?.sessionId;
      if (typeof sessionId !== "string" || sessionId.length === 0) {
        continue;
      }

       groupCandidateSessionIds.push(sessionId);

      derivedSessions.push({
        id: sessionId,
        title: entry?.node?.title ?? `候选 ${candidateIndex + 1}`,
        isActive: sessionId === taskState.task.sessionId,
        summary: null,
        phaseId: args.coordinationKey,
        phaseRole: "candidate",
        phaseItemIndex: candidateIndex,
        coordinationKey: args.coordinationKey,
        winnerSessionId: typeof winnerSessionId === "string" ? winnerSessionId : null,
        executionStatus:
          entry?.node?.status ?? entry?.agentRun?.status ?? args.run.status ?? "pending",
        sessionKind: "candidate",
        candidateIndex,
        executionModeSnapshot: "parallel",
        selectedModel:
          entry?.node?.modelUsed ?? entry?.agentRun?.modelUsed ?? entry?.agentRun?.model ?? null,
        createdAt:
          entry?.node?.startedAt ??
          entry?.node?.createdAt ??
          entry?.agentRun?.startedAt ??
          entry?.agentRun?.createdAt ??
          args.run.startedAt ??
          args.run.createdAt ??
          null,
        updatedAt:
          entry?.node?.finishedAt ??
          entry?.node?.updatedAt ??
          entry?.agentRun?.finishedAt ??
          entry?.agentRun?.createdAt ??
          args.run.finishedAt ??
          args.run.updatedAt ??
          args.run.createdAt ??
          null,
      });
    }

    derivedGroups.push({
      phaseId: args.coordinationKey,
      rootSessionId:
        typeof args.run.rootSessionId === "string" ? args.run.rootSessionId : taskState.task.sessionId,
      candidateSessionIds: groupCandidateSessionIds,
      startedAt: args.run.startedAt ?? args.run.createdAt ?? undefined,
      finishedAt:
        args.detail?.run?.finishedAt ??
        args.detail?.run?.updatedAt ??
        args.run.finishedAt ??
        args.run.updatedAt ??
        undefined,
      updatedAt: args.run.updatedAt ?? args.run.createdAt ?? undefined,
      status:
        args.detail?.run?.status ??
        (typeof args.run.status === "string" ? args.run.status : undefined),
      candidateCount: groupCandidateSessionIds.length,
      winnerSessionId: typeof winnerSessionId === "string" ? winnerSessionId : null,
    });
  };

  for (const run of sortedLegacyRuns) {
    const runId = String(run.id);
    if (assignedRunIds.has(runId)) {
      continue;
    }

    const detail = detailsByRunId.get(runId) ?? null;
    const candidatesByIndex = collectRunCandidates(run);
    const observedCandidateCount = candidatesByIndex.size;
    const expectedCandidateCount =
      typeof run.candidateCount === "number" && run.candidateCount > 0
        ? run.candidateCount
        : observedCandidateCount;
    const runStartedAtMs = toFixtureTimestamp(run.startedAt ?? run.createdAt);
    const looksPrimary = expectedCandidateCount >= 2 || observedCandidateCount >= 2;

    if (looksPrimary) {
      for (const companionRun of sortedLegacyRuns) {
        const companionRunId = String(companionRun.id);
        if (companionRunId === runId || assignedRunIds.has(companionRunId)) {
          continue;
        }

        if (companionRun.candidateCount !== 1) {
          continue;
        }

        const companionStartedAtMs = toFixtureTimestamp(
          companionRun.startedAt ?? companionRun.createdAt,
        );
        if (
          runStartedAtMs == null ||
          companionStartedAtMs == null ||
          Math.abs(companionStartedAtMs - runStartedAtMs) > 1000
        ) {
          continue;
        }

        const companionCandidates = collectRunCandidates(companionRun);
        for (const [candidateIndex, candidate] of companionCandidates.entries()) {
          if (!candidatesByIndex.has(candidateIndex)) {
            candidatesByIndex.set(candidateIndex, candidate);
          }
        }
        assignedRunIds.add(companionRunId);
      }

      pushCandidateSessions({
        coordinationKey: runId,
        run,
        candidatesByIndex,
        expectedCandidateCount,
        detail,
      });
      assignedRunIds.add(runId);
      continue;
    }

    const fallbackCandidatesByIndex = new Map(candidatesByIndex);
    const siblingRuns = sortedLegacyRuns.filter((candidateRun) => {
      const candidateRunId = String(candidateRun.id);
      if (candidateRunId === runId || assignedRunIds.has(candidateRunId)) {
        return false;
      }

      const candidateStartedAtMs = toFixtureTimestamp(candidateRun.startedAt ?? candidateRun.createdAt);
      return (
        runStartedAtMs != null &&
        candidateStartedAtMs != null &&
        Math.abs(candidateStartedAtMs - runStartedAtMs) <= 1000
      );
    });

    for (const siblingRun of siblingRuns) {
      const siblingRunId = String(siblingRun.id);
      const siblingCandidates = collectRunCandidates(siblingRun);
      for (const [candidateIndex, candidate] of siblingCandidates.entries()) {
        if (!fallbackCandidatesByIndex.has(candidateIndex)) {
          fallbackCandidatesByIndex.set(candidateIndex, candidate);
        }
      }
      assignedRunIds.add(siblingRunId);
    }

    if (fallbackCandidatesByIndex.size >= 2) {
      pushCandidateSessions({
        coordinationKey: runId,
        run,
        candidatesByIndex: fallbackCandidatesByIndex,
        expectedCandidateCount: fallbackCandidatesByIndex.size,
        detail,
      });
    }

    assignedRunIds.add(runId);
  }

  const uniqueSessions = Array.from(
    new Map(derivedSessions.map((session) => [session.id, session])).values(),
  );

  return {
    sessions: uniqueSessions,
    agentRuns: normalizedAgentRuns,
    groups: derivedGroups,
  };
}

function mergeFixtureRecords<T extends { id?: string | null }>(primary: T[], fallback: T[]) {
  const merged = new Map<string, T>();
  for (const record of fallback) {
    if (typeof record?.id === "string" && record.id.length > 0) {
      merged.set(record.id, record);
    }
  }
  for (const record of primary) {
    if (typeof record?.id === "string" && record.id.length > 0) {
      merged.set(record.id, record);
    }
  }
  return Array.from(merged.values());
}

async function buildLegacyParallelPhaseFixtures() {
  const explicitPhases = getFixtureDataArray(legacyParallelFixtureState.phaseResponse);
  const explicitSessions = getFixtureDataArray(legacyParallelFixtureState.taskSessionsResponse);
  const projection = await buildLegacyParallelFixtureProjection();
  const mergedSessions = mergeFixtureRecords(explicitSessions, projection.sessions);

  const phasesById = new Map<string, any>(
    explicitPhases
      .filter((phase) => typeof phase?.id === "string" && phase.id.length > 0)
      .map((phase) => [phase.id, phase] as const),
  );

  projection.groups.forEach((group, index) => {
    if (!group.phaseId || phasesById.has(group.phaseId)) {
      return;
    }

    const status = group.status ?? "completed";

    phasesById.set(group.phaseId, {
      id: group.phaseId,
      phaseIndex: index + 1,
      phaseKind: "parallel",
      triggerType: "execute",
      status,
      parentPhaseId: null,
      resumedFromPhaseId: null,
      awaitingAdoptionSince: null,
      anchorSessionId: group.rootSessionId ?? null,
      coordinationKey: group.phaseId,
      candidateCount: group.candidateCount ?? group.candidateSessionIds.length,
      winnerSessionId: group.winnerSessionId ?? null,
      judgeSessionId: null,
      startedAt: group.startedAt ?? null,
      finishedAt: isTerminalFixturePhaseStatus(status) ? (group.finishedAt ?? null) : null,
      createdAt: group.startedAt ?? null,
      updatedAt: group.updatedAt ?? group.finishedAt ?? group.startedAt ?? null,
      sessionIds: [group.rootSessionId, ...group.candidateSessionIds].filter(
        (sessionId): sessionId is string =>
          typeof sessionId === "string" && sessionId.length > 0,
      ),
    });
  });

  const phaseViewsById = new Map<string, any>(legacyParallelFixtureState.phaseViewResponses);
  for (const phase of Array.from(phasesById.values())) {
    if (phaseViewsById.has(phase.id)) {
      continue;
    }

    const sessions = mergedSessions.filter((session) => session.phaseId === phase.id);
    phaseViewsById.set(phase.id, {
      data: {
        phase,
        sessions,
        messageGroups: [],
        meta: {
          readSource: "test-fixture-derived-phase-parallel",
          currentPhaseId: phase.id,
          latestPhaseId: phase.id,
          sessionCount: sessions.length,
          messageGroupCount: 0,
          messageCount: 0,
        },
      },
    });
  }

  return {
    phases: Array.from(phasesById.values()).sort(
      (left, right) => (Number(left.phaseIndex) || 0) - (Number(right.phaseIndex) || 0),
    ),
    phaseViewsById,
  };
}

async function applyLegacyParallelFixtureFallbacks() {
  const explicitSessions = getFixtureDataArray(legacyParallelFixtureState.taskSessionsResponse);
  const projection = await buildLegacyParallelFixtureProjection();

  if (projection.sessions.length > 0 || explicitSessions.length > 0) {
    apiMocks.getTaskSessions.mockResolvedValue({
      data: mergeFixtureRecords(explicitSessions, projection.sessions),
    });
  }

  if (projection.agentRuns.length > 0) {
    apiMocks.getTaskAgentRuns.mockResolvedValue({
      data: projection.agentRuns,
    });
  }

  if (projection.groups.length > 0) {
    const nodesBySessionId = new Map(
      (branchState.flatNodes ?? [])
        .filter((node) => typeof node.runtimeSessionId === "string" && node.runtimeSessionId.length > 0)
        .map((node) => [String(node.runtimeSessionId), node] as const),
    );
    const augmentedNodes = branchState.flatNodes.slice();

    for (const group of projection.groups) {
      const rootSessionId = group.rootSessionId;
      if (typeof rootSessionId !== "string" || rootSessionId.length === 0) {
        continue;
      }

      let rootNode = nodesBySessionId.get(rootSessionId);
      if (!rootNode) {
        rootNode = {
          id: `legacy-root-${rootSessionId}`,
          parentId: "node-task-1",
          runtimeSessionId: rootSessionId,
          isActive: rootSessionId === taskState.task.sessionId,
          contentText: rootSessionId,
          branchName: rootSessionId,
          createdAt: group.startedAt,
        };
        augmentedNodes.push(rootNode);
        nodesBySessionId.set(rootSessionId, rootNode);
      }

      for (const candidateSessionId of group.candidateSessionIds) {
        if (nodesBySessionId.has(candidateSessionId)) {
          continue;
        }

        const candidateNode = {
          id: `legacy-session-${candidateSessionId}`,
          parentId: rootNode.id,
          runtimeSessionId: candidateSessionId,
          isActive: candidateSessionId === taskState.task.sessionId,
          contentText: candidateSessionId,
          branchName: candidateSessionId,
          createdAt: group.startedAt,
        };
        augmentedNodes.push(candidateNode);
        nodesBySessionId.set(candidateSessionId, candidateNode);
      }
    }

    branchState.flatNodes = augmentedNodes;
    if (
      branchState.selectedNode?.runtimeSessionId &&
      nodesBySessionId.has(branchState.selectedNode.runtimeSessionId)
    ) {
      branchState.selectedNode = nodesBySessionId.get(
        branchState.selectedNode.runtimeSessionId,
      ) as typeof branchState.selectedNode;
    }
  }
}

async function mountPage() {
  await applyLegacyParallelFixtureFallbacks();
  branchSessionSummariesRef.value =
    branchState.sessionSummaries ??
    (Array.isArray(legacyParallelFixtureState.taskSessionsResponse?.data)
      ? legacyParallelFixtureState.taskSessionsResponse.data
      : []);
  const { default: TaskDetailV3 } = await import(
    "../../control-plane/web-ui/src/pages/TaskDetailV3.vue"
  );
  const wrapper = mount(TaskDetailV3, {
    global: {
      stubs: {
        RouterLink: defineComponent({ name: "RouterLink", template: "<a><slot /></a>" }),
        ASpin: createPassThroughStub("ASpin"),
        AAlert: createPassThroughStub("AAlert"),
        ASpace: createPassThroughStub("ASpace"),
        ASelect: SelectStub,
        AFlex: createPassThroughStub("AFlex"),
        AButton: ButtonStub,
        ATag: createPassThroughStub("ATag"),
        ACard: createPassThroughStub("ACard"),
        ATypographyTitle: createPassThroughStub("ATypographyTitle"),
        ATypographyText: createPassThroughStub("ATypographyText"),
        TreeBreadcrumb: defineComponent({
          name: "TreeBreadcrumb",
          template: '<div data-testid="breadcrumb" />',
        }),
        TaskSwitcher: defineComponent({
          name: "TaskSwitcher",
          template: '<div data-testid="task-switcher" />',
        }),
        TaskDetailQuickOverview: defineComponent({
          name: "TaskDetailQuickOverview",
          template: '<div data-testid="quick-overview" />',
        }),
        TaskDetailPhaseBlockList: TaskDetailPhaseBlockListStub,
        ChatMessageList: ChatMessageListStub,
        ChatComposer: ChatComposerStub,
        ExecutionModeModal: defineComponent({
          name: "ExecutionModeModal",
          props: {
            initialSteps: { type: Array, default: () => [] },
          },
          methods: {
            stepTitles() {
              return (this.initialSteps as Array<{ title?: string }>)
                .map((step) => String(step?.title ?? ""))
                .filter(Boolean)
                .join("|");
            },
          },
          template: '<div data-testid="execution-mode-modal" :data-step-titles="stepTitles()" />',
        }),
        TaskFilePreviewPanel: defineComponent({
          name: "TaskFilePreviewPanel",
          template: '<div data-testid="file-preview" />',
        }),
        TaskMemberPanel: defineComponent({
          name: "TaskMemberPanel",
          props: {
            view: { type: Object, default: null },
          },
          methods: {
            memberNames() {
              const members = (this.view as { members?: Array<{ displayName?: string }> } | null)
                ?.members;
              return (members ?? [])
                .map((member) => String(member?.displayName ?? ""))
                .filter(Boolean)
                .join("|");
            },
            responsibilityText() {
              const members = (
                this.view as {
                  members?: Array<{ responsibilityLabels?: string[]; stageLabels?: string[] }>;
                } | null
              )?.members;
              return (members ?? [])
                .flatMap((member) => [
                  ...(member?.responsibilityLabels ?? []),
                  ...(member?.stageLabels ?? []),
                ])
                .join("|");
            },
          },
          template:
            '<div data-testid="task-member-panel">任务成员{{ memberNames() }}{{ responsibilityText() }}</div>',
        }),
        TaskFollowupPanel: defineComponent({
          name: "TaskFollowupPanel",
          props: {
            refreshKey: { type: Number, default: 0 },
          },
          template:
            '<div data-testid="task-followup-panel" :data-refresh-key="String(refreshKey)">followup</div>',
        }),
        TaskLinksPanel: defineComponent({
          name: "TaskLinksPanel",
          template: '<div data-testid="links-panel" />',
        }),
        TaskExecutionTracePanel: defineComponent({
          name: "TaskExecutionTracePanel",
          props: {
            refreshKey: { type: Number, default: 0 },
          },
          template: '<div data-testid="trace-panel" :data-refresh-key="String(refreshKey)" />',
        }),
      },
    },
  });
  await flushPromises();
  await nextTick();
  await flushPromises();
  await nextTick();
  await flushPromises();
  mountedWrappers.push(wrapper);
  return wrapper;
}

describe("TaskDetailV3 runtime permissions", () => {
  afterEach(() => {
    while (mountedWrappers.length > 0) {
      mountedWrappers.pop()?.unmount();
    }
  });

  beforeEach(() => {
    vi.clearAllMocks();
    apiMocks.continueTask.mockReset();
    apiMocks.forkTaskSession.mockReset();
    taskState.refresh.mockReset();
    taskState.refresh.mockImplementation(async () => undefined);
    messagesState.refresh.mockReset();
    messagesState.refresh.mockImplementation(async () => undefined);
    legacyParallelFixtureState.taskSessionsResponse = { data: [] };
    legacyParallelFixtureState.agentRunsResponse = { data: [] };
    legacyParallelFixtureState.domainRunsResponse = { data: [] };
    legacyParallelFixtureState.domainRunDetailResponse = null;
    legacyParallelFixtureState.phaseResponse = null;
    legacyParallelFixtureState.phaseViewResponses.clear();
    legacyParallelFixtureState.domainRunDetailImplementation = null;
    routeState.params = { taskId: "task-1" };
    routeState.query = {};
    taskState.task = {
      id: "task-1",
      nodeId: "task-1",
      projectId: "proj-1",
      sessionId: "ses-1",
      title: "任务详情 V3",
      prompt: "执行任务详情页测试",
      status: "running",
      selectedModel: null,
      autoAdvanceStages: false,
      executionMode: undefined,
      result: undefined,
      agentRunId: "run-1",
      createdAt: "2026-03-22T00:00:00.000Z",
      finishedAt: undefined,
      orchestrationKind: undefined,
      currentRunId: undefined,
      strategy: undefined,
      changesSummary: null,
    } as TreeTask;
    taskState.node = { id: "node-task-1" };
    taskState.ancestors = [];
    taskState.projectId = "proj-1";
    taskState.loading = false;
    taskState.error = "";
    branchState.refresh.mockImplementation(async () => {
      if (branchState.sessionSummaries !== null) {
        branchSessionSummariesRef.value = branchState.sessionSummaries;
        return;
      }
      const sessionsResponse = await apiMocks.getTaskSessions();
      legacyParallelFixtureState.taskSessionsResponse = sessionsResponse;
      branchSessionSummariesRef.value = Array.isArray(sessionsResponse?.data)
        ? sessionsResponse.data
        : [];
    });
    branchState.currentPhaseId = null;
    branchState.currentSessionId = taskState.task.sessionId ?? null;
    branchState.sessionSummaries = null;
    branchSessionSummariesRef.value = [];
    branchState.flatNodes = [
      {
        id: "node-session-1",
        runtimeSessionId: "ses-1",
        isActive: true,
        contentText: "主分支",
        branchName: "main",
      },
    ];
    branchState.selectedNode = branchState.flatNodes[0];
    realtimeStoreMock.connected = true;
    realtimeStoreMock.events = [];
    messagesState.trace = null;
    messagesState.conversationItems = [];
    messagesState.phaseSlices = [];
    messagesState.hasStreamingAssistant = false;
    messagesState.hasOlderHistory = false;
    messagesState.historyLoading = false;
    messagesState.loading = false;
    messagesState.clearPendingAssistantDraft.mockReset();
    messagesState.error = null;
    messagesState.loadOlderHistory.mockReset();
    messagesState.loadOlderHistory.mockImplementation(async () => undefined);
    messagesState.seedPendingAssistantDraft.mockReset();
    messagesState.sourceMessages = [];
    apiMocks.getTaskWorkflowView.mockResolvedValue(null);
    apiMocks.getTaskMemberView.mockResolvedValue({
      taskId: "task-1",
      projectId: "proj-1",
      workflowStatus: "running",
      currentStageKey: "implement",
      currentStageLabel: "实现开发",
      summary: {
        managerCount: 1,
        userCount: 1,
        agentCount: 1,
        activeAgentCount: 1,
      },
      members: [
        {
          id: "human:manager-1",
          kind: "manager",
          displayName: "项目管理员",
          handle: "manager",
          identitySource: "human",
          intentSource: "original",
          responsibilityLabels: ["治理 / 授权 / 审批"],
          stageLabels: [],
          statusLabel: "已加入任务",
          statusTone: "default",
          summary: "负责管理介入、授权边界和最终责任兜底。",
          capabilityBadges: ["管理者成员"],
          runCount: 0,
          latestActivityAt: "2026-03-22T00:00:00.000Z",
        },
        {
          id: "human:user-1",
          kind: "user",
          displayName: "需求发起人",
          handle: "requester",
          identitySource: "human",
          intentSource: "original",
          responsibilityLabels: ["原始意图 / 协作 / 上下文"],
          stageLabels: [],
          statusLabel: "已加入任务",
          statusTone: "default",
          summary: "负责补充业务上下文、参与协作并提供原始意图。",
          capabilityBadges: ["普通用户成员"],
          runCount: 0,
          latestActivityAt: "2026-03-22T00:00:00.000Z",
        },
        {
          id: "agent:binding-dev",
          kind: "agent",
          displayName: "开发 Agent Alpha",
          handle: "oracle-enterprise",
          identitySource: "agent",
          intentSource: "derived",
          responsibilityLabels: ["开发 Agent"],
          stageLabels: ["实现开发"],
          statusLabel: "执行中",
          statusTone: "processing",
          summary: "负责 开发 Agent，关联 实现开发。",
          capabilityBadges: ["code", "review"],
          runCount: 2,
          latestActivityAt: "2026-03-22T01:00:00.000Z",
        },
      ],
    });
    apiMocks.getModelsList.mockResolvedValue({ data: [] });
    apiMocks.getTaskAgentRuns.mockResolvedValue({ data: [] });
    apiMocks.getTaskPhases.mockImplementation(async () => {
      const fixtures = await buildLegacyParallelPhaseFixtures();
      if (fixtures.phases.length > 0) {
        return { data: fixtures.phases };
      }

      throw new Error("phase fixtures unavailable");
    });
    apiMocks.getTaskPhaseView.mockImplementation(async (_taskId: string, phaseId: string) => {
      const fixtures = await buildLegacyParallelPhaseFixtures();
      const phaseView = fixtures.phaseViewsById.get(phaseId)?.data;
      if (phaseView) {
        return { data: phaseView };
      }

      throw new Error(`phase view unavailable: ${phaseId}`);
    });
    apiMocks.getTaskConversationMessages.mockResolvedValue({ data: [] });
    apiMocks.getTaskSessions.mockResolvedValue({ data: [] });
    setLegacyParallelRuns([]);
    setLegacyParallelRunDetail({
        run: {
          id: "run-1",
          taskId: "task-1",
          projectId: "proj-1",
          orchestrationKind: "parallel",
          triggerType: "user_execute",
          status: "completed",
          createdAt: "2026-03-22T00:00:00.000Z",
          updatedAt: "2026-03-22T00:00:00.000Z",
        },
        nodes: [],
        candidateNodes: [],
        judgeNode: null,
        winnerCandidateIndex: null,
      },);
    apiMocks.getTaskExecutionTraceView.mockResolvedValue({
      taskId: "task-1",
      sessionId: "ses-1",
      segments: [],
      hookExecutions: [],
      messages: [],
      timeline: [],
    });
    apiMocks.listTaskRuntimePermissions.mockResolvedValue({
      data: [
        {
          id: "per-1",
          sessionId: "ses-1",
          permission: "external_directory",
          patterns: ["/tmp/demo/*"],
          metadata: { filepath: "/tmp/demo/file.ts", parentDir: "/tmp/demo" },
          always: ["/tmp/demo/*"],
          tool: { messageId: "msg-1", callId: "call-1" },
        },
      ],
    });
    apiMocks.replyTaskRuntimePermission.mockResolvedValue({
      ok: true,
      requestId: "per-1",
      sessionId: "ses-1",
      reply: "once",
    });
  });

  it("strips legacy session query params from the V3 route on load", async () => {
    routeState.query = { session: "ses-legacy", keep: "1" };

    await mountPage();

    expect(routerState.replace).toHaveBeenCalledWith({
      name: "TaskDetailV3",
      params: { taskId: "task-1" },
      query: { keep: "1" },
    });
  });

  it("does not request domain runs in embedded workbench mode", async () => {
    routeState.query = { embedded: "1", workbench: "1" };

    await mountPage();
    await flushPromises();
    await nextTick();

    expect(apiMocks.getTaskAgentRuns).toHaveBeenCalledWith("task-1");
  });

  it("keeps rendering core task state when tree navigation data is unavailable", async () => {
    taskState.node = null as unknown as typeof taskState.node;
    taskState.ancestors = [];

    const wrapper = await mountPage();

    expect(wrapper.text()).toContain("任务详情 V3");
    expect(wrapper.find('[data-testid="chat-composer"]').attributes("data-can-terminate")).toBe(
      "true",
    );
    expect(wrapper.find('[data-testid="breadcrumb"]').exists()).toBe(true);
  });

  it("shows missing-task guidance when the current task no longer exists", async () => {
    taskState.task = null;
    taskState.node = null;
    taskState.ancestors = [];
    taskState.projectId = "";
    taskState.error = MISSING_TASK_LOAD_ERROR;

    const wrapper = await mountPage();
    await flushPromises();

    expect(wrapper.text()).toContain("当前任务不存在");
    expect(wrapper.text()).toContain("当前 UI 指向的 app 数据库实例中找不到这个任务");
    expect(apiMocks.getTaskWorkflowView).not.toHaveBeenCalled();
    expect(apiMocks.getTaskMemberView).not.toHaveBeenCalled();
    expect(apiMocks.listTaskRuntimePermissions).not.toHaveBeenCalled();
  });

  it("waits for the loaded task to match the route before loading follow-up snapshots", async () => {
    routeState.params = { taskId: "task-2" };
    taskState.task = {
      ...(taskState.task as TreeTask),
      id: "task-1",
      nodeId: "task-1",
    };

    await mountPage();
    await flushPromises();

    expect(apiMocks.getTaskWorkflowView).not.toHaveBeenCalled();
    expect(apiMocks.getTaskMemberView).not.toHaveBeenCalled();
    expect(apiMocks.listTaskRuntimePermissions).not.toHaveBeenCalled();
  });

  it("renders and approves a pending external_directory request", async () => {
    const wrapper = await mountPage();

    expect(apiMocks.listTaskRuntimePermissions).toHaveBeenCalledWith("task-1", "ses-1");
    expect(wrapper.text()).toContain("外部目录访问");
    expect(wrapper.text()).toContain("/tmp/demo/file.ts");

    const allowButton = wrapper.findAll("button").find((button) => button.text() === "允许本次");
    expect(allowButton).toBeTruthy();
    await allowButton?.trigger("click");
    await flushPromises();

    expect(apiMocks.replyTaskRuntimePermission).toHaveBeenCalledWith("task-1", "per-1", {
      reply: "once",
    });
    expect(taskState.refresh).toHaveBeenCalled();
    expect(messagesState.refresh).toHaveBeenCalled();
  });

  it("renders the task member view in the sidebar", async () => {
    const wrapper = await mountPage();
    const expandSidebarButton = wrapper.findAll("button").find((button) => button.text() === "展开 Sidebar");
    await expandSidebarButton?.trigger("click");
    await nextTick();
    await flushPromises();

    expect(wrapper.text()).toContain("任务成员");
    expect(wrapper.text()).toContain("项目管理员");
    expect(wrapper.text()).toContain("需求发起人");
    expect(wrapper.text()).toContain("开发 Agent Alpha");
    expect(wrapper.text()).toContain("治理 / 授权 / 审批");
    expect(wrapper.text()).toContain("实现开发");
    expect(apiMocks.getTaskMemberView).toHaveBeenCalledWith("task-1");
  });

  it("bumps the sidebar trace refresh key when follow-up realtime events arrive", async () => {
    const wrapper = await mountPage();
    const expandSidebarButton = wrapper.findAll("button").find((button) => button.text() === "展开 Sidebar");
    await expandSidebarButton?.trigger("click");
    await nextTick();
    await flushPromises();

    const tracePanel = wrapper.get('[data-testid="trace-panel"]');
    expect(tracePanel.attributes("data-refresh-key")).toBe("0");

    realtimeStoreMock.events = [
      {
        id: "evt-followup-1",
        type: "task.updated",
        taskId: "task-1",
        data: {
          rawType: "task.followup.completed",
        },
      },
    ];
    await nextTick();
    await flushPromises();

    expect(wrapper.get('[data-testid="trace-panel"]').attributes("data-refresh-key")).toBe("1");
  });

  it("refreshes phase-aware task and compare state without forcing message reload", async () => {
    vi.useFakeTimers();
    try {
      const wrapper = await mountPage();
      taskState.refresh.mockClear();
      branchState.refresh.mockClear();
      messagesState.refresh.mockClear();

      realtimeStoreMock.events = [
        {
          id: "evt-snapshot-1",
          type: "task.phase.updated",
          taskId: "task-1",
          data: {
            phaseId: "phase-1",
          },
        },
      ];

      await nextTick();
      await vi.advanceTimersByTimeAsync(250);
      await flushPromises();

      expect(taskState.refresh).toHaveBeenCalled();
      expect(branchState.refresh).toHaveBeenCalled();
      expect(messagesState.refresh).not.toHaveBeenCalled();
      wrapper.unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not refetch persisted messages for an in-progress assistant realtime update", async () => {
    vi.useFakeTimers();
    try {
      const wrapper = await mountPage();
      taskState.refresh.mockClear();
      branchState.refresh.mockClear();
      messagesState.refresh.mockClear();

      realtimeStoreMock.events = [
        {
          id: "evt-assistant-progress-1",
          type: "task.message.updated",
          taskId: "task-1",
          data: {
            message: {
              id: "assistant-1",
              role: "assistant",
              time: {
                created: "2026-04-08T03:18:17.218Z",
              },
            },
          },
        },
      ];

      await nextTick();
      await vi.advanceTimersByTimeAsync(300);
      await flushPromises();

      expect(taskState.refresh).not.toHaveBeenCalled();
      expect(branchState.refresh).not.toHaveBeenCalled();
      expect(messagesState.refresh).not.toHaveBeenCalled();
      wrapper.unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps assistant completion on realtime state until a round synced ack arrives", async () => {
    vi.useFakeTimers();
    try {
      const wrapper = await mountPage();
      taskState.refresh.mockClear();
      branchState.refresh.mockClear();
      messagesState.refresh.mockClear();

      realtimeStoreMock.events = [
        {
          id: "evt-assistant-completed-1",
          type: "task.message.updated",
          taskId: "task-1",
          data: {
            message: {
              id: "assistant-1",
              role: "assistant",
              time: {
                created: "2026-04-08T03:18:17.218Z",
                completed: "2026-04-08T03:18:24.437Z",
              },
            },
          },
        },
      ];

      await nextTick();
      await vi.advanceTimersByTimeAsync(300);
      await flushPromises();

      expect(taskState.refresh).not.toHaveBeenCalled();
      expect(branchState.refresh).not.toHaveBeenCalled();
      expect(messagesState.refresh).not.toHaveBeenCalled();
      wrapper.unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  it("refetches persisted task and messages when a round synced ack arrives", async () => {
    vi.useFakeTimers();
    try {
      const wrapper = await mountPage();
      taskState.refresh.mockClear();
      branchState.refresh.mockClear();
      messagesState.refresh.mockClear();

      realtimeStoreMock.events = [
        {
          id: "evt-round-synced-1",
          type: "task.round.synced",
          taskId: "task-1",
          data: {
            roundId: "task-session:task-1:ses-1",
            taskSessionId: "task-session:task-1:ses-1",
            messageId: "assistant-1",
            snapshotVersion: 8,
            persistedThroughRevision: 8,
          },
        },
      ];

      await nextTick();
      await vi.advanceTimersByTimeAsync(200);
      await flushPromises();

      expect(taskState.refresh).not.toHaveBeenCalled();
      expect(branchState.refresh).not.toHaveBeenCalled();
      expect(messagesState.refresh).toHaveBeenCalled();
      wrapper.unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows an incomplete trace warning in the main chat area when timeline cache is partial", async () => {
    messagesState.trace = {
      taskId: "task-1",
      sessionId: "ses-1",
      segments: [],
      hookExecutions: [],
      messages: [],
      timeline: [],
      timelineMeta: {
        readSource: "task-domain-projection",
        cacheState: "partial",
        complete: false,
      },
    };

    const wrapper = await mountPage();

    expect(wrapper.text()).toContain("当前对话时间线仅部分可用");
    expect(wrapper.text()).toContain("主聊天区当前展示的是部分执行追踪结果");
  });

  it("enables stop capability for running tasks with either an agent run or a current phase", async () => {
    taskState.task.status = "completed";

    let wrapper = await mountPage();
    let composer = wrapper.get('[data-testid="chat-composer"]');
    expect(composer.attributes("data-can-terminate")).toBe("false");
    expect(composer.attributes("data-is-executing")).toBe("false");

    wrapper.unmount();

    taskState.task.status = "running";
    taskState.task.agentRunId = "run-1";

    wrapper = await mountPage();
    composer = wrapper.get('[data-testid="chat-composer"]');
    expect(composer.attributes("data-can-terminate")).toBe("true");
    expect(composer.attributes("data-is-executing")).toBe("true");

    wrapper.unmount();

    taskState.task.agentRunId = undefined;
    branchState.currentPhaseId = "phase-live-1";

    wrapper = await mountPage();
    composer = wrapper.get('[data-testid="chat-composer"]');
    expect(composer.attributes("data-can-terminate")).toBe("true");
    expect(composer.attributes("data-is-executing")).toBe("true");
  });

  it("stops showing execution immediately when a task.completed patch arrives", async () => {
    taskState.task.status = "running";
    taskState.task.finishedAt = undefined;

    const wrapper = await mountPage();

    expect(wrapper.get('[data-testid="chat-composer"]').attributes("data-is-executing")).toBe(
      "true",
    );

    realtimeStoreMock.events = [
      {
        id: "evt-task-completed-1",
        type: "task.completed",
        taskId: "task-1",
        data: {
          status: "completed",
        },
      },
    ];

    await nextTick();

    expect(wrapper.get('[data-testid="chat-composer"]').attributes("data-is-executing")).toBe(
      "false",
    );
  });

  it("renders completed parallel comparison from domain runs even without an adopted candidate", async () => {
    taskState.task.status = "completed";
    taskState.task.agentRunId = undefined;
    taskState.task.executionMode = "parallel";
    taskState.task.orchestrationKind = "parallel";
    taskState.task.currentRunId = "run-pending-adopt";
    setLegacyParallelRuns([
        {
          id: "run-pending-adopt",
          taskId: "task-1",
          projectId: "proj-1",
          orchestrationKind: "parallel",
          triggerType: "user_execute",
          status: "completed",
          rootSessionId: "ses-root",
          createdAt: "2026-03-22T04:00:00.000Z",
          updatedAt: "2026-03-22T04:00:10.000Z",
        },
      ],);
    setLegacyParallelRunDetail({
        run: {
          id: "run-pending-adopt",
          taskId: "task-1",
          projectId: "proj-1",
          orchestrationKind: "parallel",
          triggerType: "user_execute",
          status: "completed",
          rootSessionId: "ses-root",
          createdAt: "2026-03-22T04:00:00.000Z",
          updatedAt: "2026-03-22T04:00:10.000Z",
        },
        nodes: [],
        candidateNodes: [
          {
            id: "pending-adopt-node-a",
            runId: "run-pending-adopt",
            taskId: "task-1",
            projectId: "proj-1",
            nodeKind: "candidate",
            nodeKey: "candidate:0",
            title: "候选 A",
            candidateIndex: 0,
            agentType: "executor",
            modelUsed: "gpt-5-mini",
            sessionId: "ses-a",
            status: "completed",
            resultText: "A",
            createdAt: "2026-03-22T04:00:01.000Z",
            updatedAt: "2026-03-22T04:00:02.000Z",
          },
          {
            id: "pending-adopt-node-b",
            runId: "run-pending-adopt",
            taskId: "task-1",
            projectId: "proj-1",
            nodeKind: "candidate",
            nodeKey: "candidate:1",
            title: "候选 B",
            candidateIndex: 1,
            agentType: "executor",
            modelUsed: "gpt-4o",
            sessionId: "ses-b",
            status: "completed",
            resultText: "B",
            createdAt: "2026-03-22T04:00:01.000Z",
            updatedAt: "2026-03-22T04:00:02.000Z",
          },
        ],
        judgeNode: null,
        winnerCandidateIndex: null,
      },);

    const wrapper = await mountPage();

    const renderedItems = wrapper.findAll(".chat-item").map((node) => ({
      role: node.attributes("data-role"),
      text: node.attributes("data-text"),
    }));
    const candidateTexts = wrapper
      .findAll(".parallel-candidate-texts")
      .map((node) => node.text())
      .join("\n");

    expect(renderedItems).toContainEqual({ role: "parallel", text: "候选 A" });
    expect(candidateTexts).toContain("A");
    expect(candidateTexts).toContain("B");
  });

  it("forces pending-adoption current parallel batches back onto the mainline session when a candidate branch is focused", async () => {
    taskState.task.status = "completed";
    taskState.task.agentRunId = undefined;
    taskState.task.executionMode = "parallel";
    taskState.task.orchestrationKind = "parallel";
    taskState.task.currentRunId = "run-pending-adopt";
    taskState.task.sessionId = "ses-1";
    branchState.flatNodes = [
      {
        id: "node-session-root",
        parentId: "node-task-1",
        runtimeSessionId: "ses-1",
        isActive: false,
        contentText: "主分支",
        branchName: "main",
      },
      {
        id: "node-session-a",
        parentId: "node-session-root",
        runtimeSessionId: "ses-a",
        isActive: true,
        contentText: "候选 A",
        branchName: "candidate-a",
      },
      {
        id: "node-session-b",
        parentId: "node-session-root",
        runtimeSessionId: "ses-b",
        isActive: false,
        contentText: "候选 B",
        branchName: "candidate-b",
      },
    ];
    branchState.selectedNode = branchState.flatNodes[1];
    messagesState.conversationItems = [
      {
        key: "user-mainline",
        role: "user",
        text: "比较这两个候选",
        createdAt: "2026-03-22T04:00:00.000Z",
        toolCalls: [],
        raw: null,
      },
    ];
    setLegacyParallelRuns([
        {
          id: "run-pending-adopt",
          taskId: "task-1",
          projectId: "proj-1",
          orchestrationKind: "parallel",
          triggerType: "user_execute",
          status: "completed",
          rootSessionId: "ses-1",
          createdAt: "2026-03-22T04:00:00.000Z",
          updatedAt: "2026-03-22T04:00:10.000Z",
        },
      ],);
    setLegacyParallelRunDetail({
        run: {
          id: "run-pending-adopt",
          taskId: "task-1",
          projectId: "proj-1",
          orchestrationKind: "parallel",
          triggerType: "user_execute",
          status: "completed",
          rootSessionId: "ses-1",
          createdAt: "2026-03-22T04:00:00.000Z",
          updatedAt: "2026-03-22T04:00:10.000Z",
        },
        nodes: [],
        candidateNodes: [
          {
            id: "pending-adopt-node-a",
            runId: "run-pending-adopt",
            taskId: "task-1",
            projectId: "proj-1",
            nodeKind: "candidate",
            nodeKey: "candidate:0",
            title: "候选 A",
            candidateIndex: 0,
            agentType: "executor",
            modelUsed: "gpt-5-mini",
            sessionId: "ses-a",
            status: "completed",
            resultText: "A",
            createdAt: "2026-03-22T04:00:01.000Z",
            updatedAt: "2026-03-22T04:00:02.000Z",
          },
          {
            id: "pending-adopt-node-b",
            runId: "run-pending-adopt",
            taskId: "task-1",
            projectId: "proj-1",
            nodeKind: "candidate",
            nodeKey: "candidate:1",
            title: "候选 B",
            candidateIndex: 1,
            agentType: "executor",
            modelUsed: "gpt-4o",
            sessionId: "ses-b",
            status: "completed",
            resultText: "B",
            createdAt: "2026-03-22T04:00:01.000Z",
            updatedAt: "2026-03-22T04:00:02.000Z",
          },
        ],
        judgeNode: null,
        winnerCandidateIndex: null,
      },);

    const wrapper = await mountPage();
    const renderedItems = wrapper.findAll(".chat-item").map((node) => ({
      role: node.attributes("data-role"),
      text: node.attributes("data-text"),
      canAdopt: node.attributes("data-candidate-can-adopt"),
    }));

    expect(renderedItems).toContainEqual({
      role: "parallel",
      text: "候选 A",
      canAdopt: "true|true",
    });
    expect(
      wrapper.get('[data-testid="chat-message-list-meta"]').attributes("data-session-id"),
    ).toBe("ses-1");
    expect(routerState.replace).not.toHaveBeenCalled();
  });

  it("uses the current parallel run root session when task.sessionId has drifted onto an active candidate", async () => {
    taskState.task.status = "completed";
    taskState.task.agentRunId = undefined;
    taskState.task.executionMode = "parallel";
    taskState.task.orchestrationKind = "parallel";
    taskState.task.currentRunId = "run-pending-adopt-drifted";
    taskState.task.sessionId = "ses-a";
    branchState.flatNodes = [
      {
        id: "node-session-root",
        parentId: "node-task-1",
        runtimeSessionId: "ses-root",
        isActive: false,
        contentText: "主分支",
        branchName: "main",
      },
      {
        id: "node-session-a",
        parentId: "node-session-root",
        runtimeSessionId: "ses-a",
        isActive: true,
        contentText: "候选 A",
        branchName: "candidate-a",
      },
      {
        id: "node-session-b",
        parentId: "node-session-root",
        runtimeSessionId: "ses-b",
        isActive: false,
        contentText: "候选 B",
        branchName: "candidate-b",
      },
    ];
    branchState.selectedNode = null;
    messagesState.conversationItems = [
      {
        key: "user-mainline-drifted",
        role: "user",
        text: "请并行比较两个候选",
        createdAt: "2026-03-22T04:05:00.000Z",
        toolCalls: [],
        raw: null,
      },
    ];
    setLegacyParallelRuns([
      {
        id: "run-pending-adopt-drifted",
        taskId: "task-1",
        projectId: "proj-1",
        orchestrationKind: "parallel",
        triggerType: "user_execute",
        status: "completed",
        rootSessionId: "ses-root",
        createdAt: "2026-03-22T04:05:00.000Z",
        updatedAt: "2026-03-22T04:05:10.000Z",
      },
    ]);
    setLegacyParallelRunDetail({
      run: {
        id: "run-pending-adopt-drifted",
        taskId: "task-1",
        projectId: "proj-1",
        orchestrationKind: "parallel",
        triggerType: "user_execute",
        status: "completed",
        rootSessionId: "ses-root",
        createdAt: "2026-03-22T04:05:00.000Z",
        updatedAt: "2026-03-22T04:05:10.000Z",
      },
      nodes: [],
      candidateNodes: [
        {
          id: "pending-drifted-node-a",
          runId: "run-pending-adopt-drifted",
          taskId: "task-1",
          projectId: "proj-1",
          nodeKind: "candidate",
          nodeKey: "candidate:0",
          title: "候选 A",
          candidateIndex: 0,
          agentType: "executor",
          modelUsed: "gpt-5-mini",
          sessionId: "ses-a",
          status: "completed",
          resultText: "A",
          createdAt: "2026-03-22T04:05:01.000Z",
          updatedAt: "2026-03-22T04:05:02.000Z",
        },
        {
          id: "pending-drifted-node-b",
          runId: "run-pending-adopt-drifted",
          taskId: "task-1",
          projectId: "proj-1",
          nodeKind: "candidate",
          nodeKey: "candidate:1",
          title: "候选 B",
          candidateIndex: 1,
          agentType: "executor",
          modelUsed: "gpt-4o",
          sessionId: "ses-b",
          status: "completed",
          resultText: "B",
          createdAt: "2026-03-22T04:05:01.000Z",
          updatedAt: "2026-03-22T04:05:02.000Z",
        },
      ],
      judgeNode: null,
      winnerCandidateIndex: null,
    });

    const wrapper = await mountPage();

    expect(
      wrapper.get('[data-testid="chat-message-list-meta"]').attributes("data-session-id"),
    ).toBe("ses-root");
    expect(routerState.replace).not.toHaveBeenCalled();
  });

  it("prefers the current parallel run root session over task.sessionId when a candidate branch is focused", async () => {
    taskState.task.status = "completed";
    taskState.task.agentRunId = undefined;
    taskState.task.executionMode = "parallel";
    taskState.task.orchestrationKind = "parallel";
    taskState.task.currentRunId = "run-pending-adopt-root";
    taskState.task.sessionId = "ses-stale-task-root";
    branchState.flatNodes = [
      {
        id: "node-session-root",
        parentId: "node-task-1",
        runtimeSessionId: "ses-run-root",
        isActive: false,
        contentText: "主分支",
        branchName: "main",
      },
      {
        id: "node-session-a",
        parentId: "node-session-root",
        runtimeSessionId: "ses-a",
        isActive: true,
        contentText: "候选 A",
        branchName: "candidate-a",
      },
      {
        id: "node-session-b",
        parentId: "node-session-root",
        runtimeSessionId: "ses-b",
        isActive: false,
        contentText: "候选 B",
        branchName: "candidate-b",
      },
    ];
    branchState.selectedNode = branchState.flatNodes[1];
    messagesState.conversationItems = [
      {
        key: "user-mainline-root",
        role: "user",
        text: "对比两个候选方案",
        createdAt: "2026-03-22T04:10:00.000Z",
        toolCalls: [],
        raw: null,
      },
    ];
    setLegacyParallelRuns([
        {
          id: "run-pending-adopt-root",
          taskId: "task-1",
          projectId: "proj-1",
          orchestrationKind: "parallel",
          triggerType: "user_execute",
          status: "completed",
          rootSessionId: "ses-run-root",
          createdAt: "2026-03-22T04:10:00.000Z",
          updatedAt: "2026-03-22T04:10:10.000Z",
        },
      ],);
    setLegacyParallelRunDetail({
        run: {
          id: "run-pending-adopt-root",
          taskId: "task-1",
          projectId: "proj-1",
          orchestrationKind: "parallel",
          triggerType: "user_execute",
          status: "completed",
          rootSessionId: "ses-run-root",
          createdAt: "2026-03-22T04:10:00.000Z",
          updatedAt: "2026-03-22T04:10:10.000Z",
        },
        nodes: [],
        candidateNodes: [
          {
            id: "pending-root-node-a",
            runId: "run-pending-adopt-root",
            taskId: "task-1",
            projectId: "proj-1",
            nodeKind: "candidate",
            nodeKey: "candidate:0",
            title: "候选 A",
            candidateIndex: 0,
            agentType: "executor",
            modelUsed: "gpt-5-mini",
            sessionId: "ses-a",
            status: "completed",
            resultText: "A",
            createdAt: "2026-03-22T04:10:01.000Z",
            updatedAt: "2026-03-22T04:10:02.000Z",
          },
          {
            id: "pending-root-node-b",
            runId: "run-pending-adopt-root",
            taskId: "task-1",
            projectId: "proj-1",
            nodeKind: "candidate",
            nodeKey: "candidate:1",
            title: "候选 B",
            candidateIndex: 1,
            agentType: "executor",
            modelUsed: "gpt-4o",
            sessionId: "ses-b",
            status: "completed",
            resultText: "B",
            createdAt: "2026-03-22T04:10:01.000Z",
            updatedAt: "2026-03-22T04:10:02.000Z",
          },
        ],
        judgeNode: null,
        winnerCandidateIndex: null,
      },);

    const wrapper = await mountPage();
    const renderedItems = wrapper.findAll(".chat-item").map((node) => ({
      role: node.attributes("data-role"),
      text: node.attributes("data-text"),
      canAdopt: node.attributes("data-candidate-can-adopt"),
    }));

    expect(renderedItems).toContainEqual({
      role: "parallel",
      text: "候选 A",
      canAdopt: "true|true",
    });
    expect(
      wrapper.get('[data-testid="chat-message-list-meta"]').attributes("data-session-id"),
    ).toBe("ses-run-root");
    expect(routerState.replace).not.toHaveBeenCalled();
  });

  it("restores the current compare block from session-tree siblings when the latest parallel batch is split into two single-candidate runs", async () => {
    taskState.task.status = "completed";
    taskState.task.agentRunId = undefined;
    taskState.task.executionMode = "parallel";
    taskState.task.orchestrationKind = "parallel";
    taskState.task.currentRunId = "run-split-b";
    taskState.task.sessionId = "ses-b";
    taskState.task.strategy = {
      executionMode: "parallel",
      parallelCandidates: [
        { label: "候选 A", model: "gpt-5.4" },
        { label: "候选 B", model: "claude-opus-4.6" },
      ],
    } as unknown as string;
    branchState.flatNodes = [
      {
        id: "node-old-root",
        parentId: "node-task-1",
        runtimeSessionId: "ses-old-root",
        isActive: false,
        contentText: "旧主线",
        branchName: "main",
        createdAt: "2026-03-22T10:00:00.000Z",
      },
      {
        id: "node-split-root",
        parentId: "node-task-1",
        runtimeSessionId: "ses-run-root",
        isActive: false,
        contentText: "当前主线",
        branchName: "main",
        createdAt: "2026-03-22T10:10:00.000Z",
      },
      {
        id: "node-split-a",
        parentId: "node-split-root",
        runtimeSessionId: "ses-a",
        isActive: false,
        contentText: "候选 A",
        branchName: "candidate-a",
        createdAt: "2026-03-22T10:10:01.000Z",
      },
      {
        id: "node-split-b",
        parentId: "node-split-root",
        runtimeSessionId: "ses-b",
        isActive: true,
        contentText: "候选 B",
        branchName: "candidate-b",
        createdAt: "2026-03-22T10:10:02.000Z",
      },
    ];
    branchState.selectedNode = branchState.flatNodes[3];
    messagesState.conversationItems = [
      {
        key: "user-before-split-parallel",
        role: "user",
        text: "请给出 2 个布局方案",
        createdAt: "2026-03-22T10:10:00.000Z",
        toolCalls: [],
        raw: null,
      },
    ];
    setLegacyParallelRuns([
        {
          id: "run-split-a",
          taskId: "task-1",
          projectId: "proj-1",
          orchestrationKind: "parallel",
          triggerType: "user_execute",
          status: "completed",
          rootSessionId: "ses-a",
          createdAt: "2026-03-22T10:10:01.000Z",
          startedAt: "2026-03-22T10:10:01.000Z",
          finishedAt: "2026-03-22T10:10:08.000Z",
          updatedAt: "2026-03-22T10:10:08.000Z",
        },
        {
          id: "run-split-b",
          taskId: "task-1",
          projectId: "proj-1",
          orchestrationKind: "parallel",
          triggerType: "user_execute",
          status: "completed",
          rootSessionId: "ses-b",
          createdAt: "2026-03-22T10:10:02.000Z",
          startedAt: "2026-03-22T10:10:02.000Z",
          finishedAt: "2026-03-22T10:10:09.000Z",
          updatedAt: "2026-03-22T10:10:09.000Z",
        },
      ],);
    setLegacyParallelRunDetailImplementation(
      async (taskIdArg: string, runId: string) => ({
        data: {
          run: {
            id: runId,
            taskId: taskIdArg,
            projectId: "proj-1",
            orchestrationKind: "parallel",
            triggerType: "user_execute",
            status: "completed",
            rootSessionId: runId === "run-split-a" ? "ses-a" : "ses-b",
            createdAt: "2026-03-22T10:10:00.000Z",
            updatedAt:
              runId === "run-split-a" ? "2026-03-22T10:10:08.000Z" : "2026-03-22T10:10:09.000Z",
          },
          nodes: [],
          candidateNodes: [
            {
              id: `${runId}-candidate`,
              runId,
              taskId: taskIdArg,
              projectId: "proj-1",
              nodeKind: "candidate",
              nodeKey: "candidate:0",
              title: runId === "run-split-a" ? "候选 A" : "候选 B",
              candidateIndex: 0,
              agentType: "executor",
              modelUsed: runId === "run-split-a" ? "gpt-5.4" : "claude-opus-4.6",
              sessionId: runId === "run-split-a" ? "ses-a" : "ses-b",
              status: "completed",
              resultText: runId === "run-split-a" ? "A" : "B",
              createdAt: "2026-03-22T10:10:03.000Z",
              updatedAt:
                runId === "run-split-a" ? "2026-03-22T10:10:08.000Z" : "2026-03-22T10:10:09.000Z",
            },
          ],
          judgeNode: null,
          winnerCandidateIndex: null,
        },
      }),
    );
    apiMocks.getTaskExecutionTraceView.mockImplementation(
      async (_taskId: string, sessionId: string) => ({
        taskId: "task-1",
        sessionId,
        segments: [],
        hookExecutions: [],
        timeline: [],
        messages: [
          {
            id: `assistant-${sessionId}`,
            role: "assistant",
            text: `reply-${sessionId}`,
            createdAt: "2026-03-22T10:10:10.000Z",
          },
        ],
        latestResponse: `reply-${sessionId}`,
      }),
    );
    apiMocks.listTaskRuntimePermissions.mockResolvedValue({ data: [] });

    const wrapper = await mountPage();
    const parallelItem = wrapper
      .findAll(".chat-item")
      .find((node) => node.attributes("data-role") === "parallel");

    expect(parallelItem?.attributes("data-text")).toBe("候选 A");
    expect(parallelItem?.attributes("data-candidate-can-adopt")).toBe("true|true");
  });

  it("does not synthesize a session-tree fallback run when one historical root contains an ambiguous mixed candidate set", async () => {
    taskState.task.status = "completed";
    taskState.task.agentRunId = undefined;
    taskState.task.executionMode = "parallel";
    taskState.task.orchestrationKind = "parallel";
    taskState.task.currentRunId = undefined;
    taskState.task.sessionId = "ses-current";
    taskState.task.strategy = {
      executionMode: "parallel",
      parallelCandidates: [
        { label: "候选 A", model: "gpt-5.4" },
        { label: "候选 B", model: "claude-opus-4.6" },
      ],
    } as unknown as string;
    branchState.flatNodes = [
      {
        id: "node-root",
        parentId: "node-task-1",
        runtimeSessionId: "ses-root",
        isActive: false,
        contentText: "历史主线",
        branchName: "main",
        createdAt: "2026-03-22T10:00:00.000Z",
      },
      {
        id: "node-old-a",
        parentId: "node-root",
        runtimeSessionId: "ses-old-a",
        isActive: false,
        contentText: "候选 A",
        branchName: "candidate-a-old",
        createdAt: "2026-03-22T11:00:00.000Z",
      },
      {
        id: "node-new-a",
        parentId: "node-root",
        runtimeSessionId: "ses-new-a",
        isActive: false,
        contentText: "候选 A",
        branchName: "candidate-a-new",
        createdAt: "2026-03-22T12:00:00.000Z",
      },
      {
        id: "node-new-b",
        parentId: "node-root",
        runtimeSessionId: "ses-new-b",
        isActive: true,
        contentText: "候选 B",
        branchName: "candidate-b-new",
        createdAt: "2026-03-22T12:00:00.400Z",
      },
    ];
    branchState.selectedNode = branchState.flatNodes[0];
    messagesState.conversationItems = [
      {
        key: "user-root-fallback",
        role: "user",
        text: "继续比较最近一批候选",
        createdAt: "2026-03-22T12:00:00.000Z",
        toolCalls: [],
        raw: null,
      },
    ];
    setLegacyParallelRuns([]);
    apiMocks.getTaskExecutionTraceView.mockImplementation(
      async (_taskId: string, sessionId: string) => ({
        taskId: "task-1",
        sessionId,
        segments: [],
        hookExecutions: [],
        timeline: [],
        messages: [
          {
            id: `assistant-${sessionId}`,
            role: "assistant",
            text:
              sessionId === "ses-new-a"
                ? "latest-batch-a"
                : sessionId === "ses-new-b"
                  ? "latest-batch-b"
                  : "old-batch-a",
            createdAt:
              sessionId === "ses-old-a" ? "2026-03-22T11:00:10.000Z" : "2026-03-22T12:00:10.000Z",
          },
        ],
        latestResponse:
          sessionId === "ses-new-a"
            ? "latest-batch-a"
            : sessionId === "ses-new-b"
              ? "latest-batch-b"
              : "old-batch-a",
      }),
    );
    apiMocks.listTaskRuntimePermissions.mockResolvedValue({ data: [] });

    const wrapper = await mountPage();
    const renderedItems = wrapper.findAll(".chat-item").map((node) => ({
      role: node.attributes("data-role"),
      text: node.attributes("data-text"),
      models: node.attributes("data-candidate-models"),
    }));

    expect(apiMocks.getTaskExecutionTraceView).not.toHaveBeenCalled();
    expect(renderedItems).toEqual([
      {
        role: "user",
        text: "继续比较最近一批候选",
        models: "",
      },
    ]);
  });

  it("does not synthesize a descendant fallback run when the selected historical root already has its own projection run", async () => {
    taskState.task.status = "completed";
    taskState.task.agentRunId = undefined;
    taskState.task.executionMode = "parallel";
    taskState.task.orchestrationKind = "parallel";
    taskState.task.currentRunId = "run-root-summary";
    taskState.task.sessionId = "ses-current";
    taskState.task.strategy = {
      executionMode: "parallel",
      parallelCandidates: [
        { label: "候选 A", model: "gemini-3-flash-preview" },
        { label: "候选 B", model: "gpt-5-mini" },
      ],
    } as unknown as string;
    branchState.flatNodes = [
      {
        id: "node-root",
        parentId: "node-task-1",
        runtimeSessionId: "ses-root",
        isActive: false,
        contentText: "历史主线",
        branchName: "main",
        createdAt: "2026-03-22T13:00:00.000Z",
      },
      {
        id: "node-root-a",
        parentId: "node-root",
        runtimeSessionId: "ses-root-a",
        isActive: false,
        contentText: "候选 A",
        branchName: "candidate-a-root",
        createdAt: "2026-03-22T13:00:01.000Z",
      },
      {
        id: "node-desc-a",
        parentId: "node-root",
        runtimeSessionId: "ses-desc-a",
        isActive: false,
        contentText: "候选 A",
        branchName: "candidate-a-desc",
        createdAt: "2026-03-22T14:00:01.000Z",
      },
      {
        id: "node-desc-b",
        parentId: "node-root",
        runtimeSessionId: "ses-desc-b",
        isActive: true,
        contentText: "候选 B",
        branchName: "candidate-b-desc",
        createdAt: "2026-03-22T14:00:01.300Z",
      },
    ];
    branchState.selectedNode = branchState.flatNodes[0];
    messagesState.conversationItems = [
      {
        key: "user-root-projection",
        role: "user",
        text: "保留历史这批候选",
        createdAt: "2026-03-22T13:00:00.000Z",
        toolCalls: [],
        raw: null,
      },
    ];
    setLegacyParallelRuns([
        {
          id: "run-root-summary",
          taskId: "task-1",
          projectId: "proj-1",
          orchestrationKind: "parallel",
          triggerType: "user_execute",
          status: "completed",
          rootSessionId: "ses-root",
          candidateCount: 2,
          createdAt: "2026-03-22T13:00:00.000Z",
          startedAt: "2026-03-22T13:00:00.100Z",
          finishedAt: "2026-03-22T13:00:09.000Z",
          updatedAt: "2026-03-22T13:00:09.000Z",
        },
        {
          id: "run-root-candidate-a",
          taskId: "task-1",
          projectId: "proj-1",
          orchestrationKind: "parallel",
          triggerType: "user_execute",
          status: "completed",
          rootSessionId: "ses-root-a",
          candidateCount: 1,
          createdAt: "2026-03-22T13:00:00.000Z",
          startedAt: "2026-03-22T13:00:00.101Z",
          finishedAt: "2026-03-22T13:00:08.000Z",
          updatedAt: "2026-03-22T13:00:08.000Z",
        },
      ],);
    setLegacyParallelRunDetail({
        run: {
          id: "run-root-summary",
          taskId: "task-1",
          projectId: "proj-1",
          orchestrationKind: "parallel",
          triggerType: "user_execute",
          status: "completed",
          rootSessionId: "ses-root",
          createdAt: "2026-03-22T13:00:00.000Z",
          updatedAt: "2026-03-22T13:00:09.000Z",
        },
        nodes: [],
        candidateNodes: [],
        judgeNode: null,
        winnerCandidateIndex: null,
      },);
    apiMocks.getTaskAgentRuns.mockResolvedValue({
      data: [
        {
          id: "agent-root-summary",
          runId: "run-root-summary",
          taskId: "task-1",
          projectId: "proj-1",
          candidateIndex: 1,
          sessionId: "ses-root",
          model: "gpt-5-mini",
          agent: "executor",
          status: "completed",
          startedAt: "2026-03-22T13:00:00.100Z",
          finishedAt: "2026-03-22T13:00:09.000Z",
          result: "root-summary",
        },
        {
          id: "agent-root-a",
          runId: "run-root-candidate-a",
          taskId: "task-1",
          projectId: "proj-1",
          candidateIndex: 0,
          sessionId: "ses-root-a",
          model: "gemini-3-flash-preview",
          agent: "executor",
          status: "completed",
          startedAt: "2026-03-22T13:00:00.101Z",
          finishedAt: "2026-03-22T13:00:08.000Z",
          result: "root-a",
        },
      ],
    });
    apiMocks.getTaskExecutionTraceView.mockImplementation(
      async (_taskId: string, sessionId: string) => ({
        taskId: "task-1",
        sessionId,
        segments: [],
        hookExecutions: [],
        timeline: [],
        messages: [
          {
            id: `assistant-${sessionId}`,
            role: "assistant",
            text:
              sessionId === "ses-root"
                ? "root-mainline-trace"
                : sessionId === "ses-root-a"
                  ? "root-candidate-trace"
                  : sessionId === "ses-desc-a"
                    ? "desc-a-trace"
                    : "desc-b-trace",
            createdAt:
              sessionId === "ses-root" || sessionId === "ses-root-a"
                ? "2026-03-22T13:00:10.000Z"
                : "2026-03-22T14:00:10.000Z",
          },
        ],
        latestResponse:
          sessionId === "ses-root"
            ? "root-mainline-trace"
            : sessionId === "ses-root-a"
              ? "root-candidate-trace"
              : sessionId === "ses-desc-a"
                ? "desc-a-trace"
                : "desc-b-trace",
      }),
    );
    apiMocks.listTaskRuntimePermissions.mockResolvedValue({ data: [] });

    const wrapper = await mountPage();
    const renderedItems = wrapper.findAll(".chat-item").map((node) => ({
      role: node.attributes("data-role"),
      text: node.attributes("data-text"),
      models: node.attributes("data-candidate-models"),
    }));

    expect(apiMocks.getTaskExecutionTraceView).toHaveBeenCalledTimes(2);
    expect(apiMocks.getTaskExecutionTraceView).toHaveBeenCalledWith("task-1", "ses-root-a", {
      includeLineage: false,
    });
    expect(apiMocks.getTaskExecutionTraceView).not.toHaveBeenCalledWith("task-1", "ses-desc-a", {
      includeLineage: false,
    });
    expect(apiMocks.getTaskExecutionTraceView).not.toHaveBeenCalledWith("task-1", "ses-desc-b", {
      includeLineage: false,
    });
    expect(renderedItems).toContainEqual(
      expect.objectContaining({
        role: "parallel",
        text: "候选 A",
        models: "gemini-3-flash-preview|gpt-5-mini",
      }),
    );
  });

  it("merges missing candidate indexes from companion runs when the selected historical root only exposes the summary candidate", async () => {
    taskState.task.status = "completed";
    taskState.task.agentRunId = undefined;
    taskState.task.executionMode = "parallel";
    taskState.task.orchestrationKind = "parallel";
    taskState.task.currentRunId = "run-summary";
    taskState.task.sessionId = "ses-current";
    branchState.flatNodes = [
      {
        id: "node-root",
        parentId: "node-task-1",
        runtimeSessionId: "ses-root",
        isActive: false,
        contentText: "历史主线",
        branchName: "root",
        createdAt: "2026-03-22T14:56:35.390Z",
      },
      {
        id: "node-current-summary",
        parentId: "node-root",
        runtimeSessionId: "ses-current-summary",
        isActive: true,
        contentText: "当前错误 fallback A",
        branchName: "current-summary",
        createdAt: "2026-03-22T15:03:46.577Z",
      },
      {
        id: "node-current-companion",
        parentId: "node-root",
        runtimeSessionId: "ses-current-companion",
        isActive: false,
        contentText: "当前错误 fallback B",
        branchName: "current-companion",
        createdAt: "2026-03-22T15:03:46.578Z",
      },
    ];
    branchState.selectedNode = branchState.flatNodes[0];
    messagesState.conversationItems = [
      {
        key: "root-user",
        role: "user",
        text: "把页面结构压缩成四条",
        createdAt: "2026-03-22T14:56:35.390Z",
        toolCalls: [],
        raw: null,
      },
    ];
    setLegacyParallelRuns([
        {
          id: "run-summary",
          taskId: "task-1",
          projectId: "proj-1",
          orchestrationKind: "parallel",
          triggerType: "user_execute",
          status: "completed",
          rootSessionId: "ses-root",
          candidateCount: 2,
          createdAt: "2026-03-22T14:56:35.521Z",
          startedAt: "2026-03-22T14:56:35.521Z",
          finishedAt: "2026-03-22T15:07:30.624Z",
          updatedAt: "2026-03-22T15:07:30.624Z",
        },
        {
          id: "run-companion",
          taskId: "task-1",
          projectId: "proj-1",
          orchestrationKind: "parallel",
          triggerType: "user_execute",
          status: "completed",
          rootSessionId: "ses-root-candidate-a",
          candidateCount: 1,
          createdAt: "2026-03-22T14:56:35.522Z",
          startedAt: "2026-03-22T14:56:35.522Z",
          finishedAt: "2026-03-22T14:57:01.909Z",
          updatedAt: "2026-03-22T14:57:01.909Z",
        },
      ],);
    setLegacyParallelRunDetailImplementation(async (_taskId: string, runId: string) => ({
      data: {
        run: {
          id: runId,
          taskId: "task-1",
          projectId: "proj-1",
          orchestrationKind: "parallel",
          triggerType: "user_execute",
          status: "completed",
          rootSessionId: runId === "run-summary" ? "ses-root" : "ses-root-candidate-a",
        },
        nodes: [],
        candidateNodes:
          runId === "run-summary"
            ? [
                {
                  id: "summary-node-1",
                  runId,
                  taskId: "task-1",
                  projectId: "proj-1",
                  nodeKind: "candidate",
                  nodeKey: "candidate:1",
                  title: "候选 B",
                  candidateIndex: 1,
                  agentType: "executor",
                  modelUsed: "gpt-5-mini",
                  sessionId: "ses-root",
                  status: "completed",
                  resultSummary: "history-summary-b",
                  createdAt: "2026-03-22T14:56:35.521Z",
                  updatedAt: "2026-03-22T14:57:20.362Z",
                },
              ]
            : [],
        judgeNode: null,
        winnerCandidateIndex: runId === "run-summary" ? 1 : null,
      },
    }));
    apiMocks.getTaskAgentRuns.mockResolvedValue({
      data: [
        {
          id: "agent-summary",
          runId: "run-summary",
          taskId: "task-1",
          projectId: "proj-1",
          candidateIndex: 1,
          sessionId: "ses-root",
          model: "gpt-5-mini",
          agent: "executor",
          status: "completed",
          startedAt: "2026-03-22T14:56:35.521Z",
          finishedAt: "2026-03-22T14:57:20.362Z",
          result: "history-summary-b",
        },
        {
          id: "agent-companion",
          runId: "run-companion",
          taskId: "task-1",
          projectId: "proj-1",
          candidateIndex: 0,
          sessionId: "ses-root-candidate-a",
          model: "gemini-3-flash-preview",
          agent: "executor",
          status: "completed",
          startedAt: "2026-03-22T14:56:35.522Z",
          finishedAt: "2026-03-22T14:57:01.909Z",
          result: "history-summary-a",
        },
      ],
    });
    apiMocks.getTaskExecutionTraceView.mockResolvedValue({
      taskId: "task-1",
      sessionId: "ses-root",
      segments: [],
      hookExecutions: [],
      timeline: [],
      messages: [],
      latestResponse: "",
    });
    apiMocks.listTaskRuntimePermissions.mockResolvedValue({ data: [] });

    const wrapper = await mountPage();
    const parallelItems = wrapper
      .findAll(".chat-item")
      .filter((node) => node.attributes("data-role") === "parallel");
    const candidateTexts = wrapper
      .findAll(".parallel-candidate-texts")
      .map((node) => node.text())
      .join("\n");

    expect(parallelItems).toHaveLength(1);
    expect(candidateTexts).toContain("history-summary-a");
    expect(candidateTexts).toContain("history-summary-b");
    expect(candidateTexts).not.toContain("当前错误 fallback");
  });

  it("prefers direct mainline-scoped parallel runs over later candidate-only matches", async () => {
    taskState.task.status = "completed";
    taskState.task.agentRunId = undefined;
    taskState.task.executionMode = "parallel";
    taskState.task.orchestrationKind = "parallel";
    taskState.task.currentRunId = "run-current";
    taskState.task.sessionId = "ses-main";
    branchState.flatNodes = [
      {
        id: "node-main",
        parentId: "node-task-1",
        runtimeSessionId: "ses-main",
        isActive: false,
        contentText: "当前主线",
        branchName: "main",
        createdAt: "2026-03-22T11:00:00.000Z",
      },
      {
        id: "node-current-a",
        parentId: "node-main",
        runtimeSessionId: "ses-current-a",
        isActive: false,
        contentText: "当前候选 A",
        branchName: "candidate-a",
        createdAt: "2026-03-22T11:00:01.000Z",
      },
      {
        id: "node-current-b",
        parentId: "node-main",
        runtimeSessionId: "ses-current-b",
        isActive: false,
        contentText: "当前候选 B",
        branchName: "candidate-b",
        createdAt: "2026-03-22T11:00:02.000Z",
      },
      {
        id: "node-stale-root",
        parentId: "node-task-1",
        runtimeSessionId: "ses-stale-root",
        isActive: true,
        contentText: "历史候选根",
        branchName: "stale-root",
        createdAt: "2026-03-22T11:05:00.000Z",
      },
      {
        id: "node-stale-b",
        parentId: "node-stale-root",
        runtimeSessionId: "ses-stale-b",
        isActive: false,
        contentText: "历史候选 B",
        branchName: "stale-b",
        createdAt: "2026-03-22T11:05:02.000Z",
      },
    ];
    branchState.selectedNode = branchState.flatNodes[0];
    messagesState.conversationItems = [
      {
        key: "user-mainline-direct",
        role: "user",
        text: "请给我两个页面方案",
        createdAt: "2026-03-22T11:00:00.000Z",
        toolCalls: [],
        raw: null,
      },
    ];
    setLegacyParallelRuns([
        {
          id: "run-current",
          taskId: "task-1",
          projectId: "proj-1",
          orchestrationKind: "parallel",
          triggerType: "user_execute",
          status: "completed",
          rootSessionId: "ses-main",
          createdAt: "2026-03-22T11:00:00.000Z",
          startedAt: "2026-03-22T11:00:00.000Z",
          finishedAt: "2026-03-22T11:00:10.000Z",
          updatedAt: "2026-03-22T11:00:10.000Z",
        },
        {
          id: "run-stale-candidate-ref",
          taskId: "task-1",
          projectId: "proj-1",
          orchestrationKind: "parallel",
          triggerType: "user_execute",
          status: "completed",
          rootSessionId: "ses-stale-root",
          createdAt: "2026-03-22T11:05:00.000Z",
          startedAt: "2026-03-22T11:05:00.000Z",
          finishedAt: "2026-03-22T11:05:10.000Z",
          updatedAt: "2026-03-22T11:05:10.000Z",
        },
      ],);
    setLegacyParallelRunDetailImplementation(async (_taskId: string, runId: string) => ({
      data: {
        run: {
          id: runId,
          taskId: "task-1",
          projectId: "proj-1",
          orchestrationKind: "parallel",
          triggerType: "user_execute",
          status: "completed",
          rootSessionId: runId === "run-current" ? "ses-main" : "ses-stale-root",
          createdAt:
            runId === "run-current" ? "2026-03-22T11:00:00.000Z" : "2026-03-22T11:05:00.000Z",
          updatedAt:
            runId === "run-current" ? "2026-03-22T11:00:10.000Z" : "2026-03-22T11:05:10.000Z",
        },
        nodes: [],
        candidateNodes:
          runId === "run-current"
            ? [
                {
                  id: "current-node-a",
                  runId,
                  taskId: "task-1",
                  projectId: "proj-1",
                  nodeKind: "candidate",
                  nodeKey: "candidate:0",
                  title: "当前候选 A",
                  candidateIndex: 0,
                  agentType: "executor",
                  modelUsed: "gpt-5-mini",
                  sessionId: "ses-current-a",
                  status: "completed",
                  resultText: "current-summary-a",
                  createdAt: "2026-03-22T11:00:01.000Z",
                  updatedAt: "2026-03-22T11:00:08.000Z",
                },
                {
                  id: "current-node-b",
                  runId,
                  taskId: "task-1",
                  projectId: "proj-1",
                  nodeKind: "candidate",
                  nodeKey: "candidate:1",
                  title: "当前候选 B",
                  candidateIndex: 1,
                  agentType: "executor",
                  modelUsed: "gpt-4o",
                  sessionId: "ses-current-b",
                  status: "completed",
                  resultText: "current-summary-b",
                  createdAt: "2026-03-22T11:00:02.000Z",
                  updatedAt: "2026-03-22T11:00:09.000Z",
                },
              ]
            : [
                {
                  id: "stale-node-a",
                  runId,
                  taskId: "task-1",
                  projectId: "proj-1",
                  nodeKind: "candidate",
                  nodeKey: "candidate:0",
                  title: "历史候选 A",
                  candidateIndex: 0,
                  agentType: "executor",
                  modelUsed: "gemini-3-flash-preview",
                  sessionId: "ses-main",
                  status: "completed",
                  resultText: "stale-summary-main",
                  createdAt: "2026-03-22T11:05:01.000Z",
                  updatedAt: "2026-03-22T11:05:08.000Z",
                },
                {
                  id: "stale-node-b",
                  runId,
                  taskId: "task-1",
                  projectId: "proj-1",
                  nodeKind: "candidate",
                  nodeKey: "candidate:1",
                  title: "历史候选 B",
                  candidateIndex: 1,
                  agentType: "executor",
                  modelUsed: "claude-opus-4.6",
                  sessionId: "ses-stale-b",
                  status: "completed",
                  resultText: "stale-summary-b",
                  createdAt: "2026-03-22T11:05:02.000Z",
                  updatedAt: "2026-03-22T11:05:09.000Z",
                },
              ],
        judgeNode: null,
        winnerCandidateIndex: null,
      },
    }));
    apiMocks.getTaskExecutionTraceView.mockImplementation(
      async (_taskId: string, sessionId: string) => ({
        taskId: "task-1",
        sessionId,
        segments: [],
        hookExecutions: [],
        timeline: [],
        messages: [
          {
            id: `assistant-${sessionId}`,
            role: "assistant",
            text:
              sessionId === "ses-current-a"
                ? "current-trace-a"
                : sessionId === "ses-current-b"
                  ? "current-trace-b"
                  : sessionId === "ses-main"
                    ? "stale-trace-main"
                    : "stale-trace-b",
            createdAt:
              sessionId === "ses-current-a" || sessionId === "ses-current-b"
                ? "2026-03-22T11:00:10.000Z"
                : "2026-03-22T11:05:10.000Z",
          },
        ],
        latestResponse:
          sessionId === "ses-current-a"
            ? "current-trace-a"
            : sessionId === "ses-current-b"
              ? "current-trace-b"
              : sessionId === "ses-main"
                ? "stale-trace-main"
                : "stale-trace-b",
      }),
    );
    apiMocks.listTaskRuntimePermissions.mockResolvedValue({ data: [] });

    const wrapper = await mountPage();
    const candidateTexts = wrapper
      .findAll(".parallel-candidate-texts")
      .map((node) => node.text())
      .join("\n");

    expect(candidateTexts).toContain("current-trace-a");
    expect(candidateTexts).toContain("current-trace-b");
    expect(candidateTexts).not.toContain("stale-trace-main");
    expect(candidateTexts).not.toContain("stale-trace-b");
  });

  it("keeps a selected historical session pinned instead of forcing the current pending-adoption batch", async () => {
    taskState.task.status = "completed";
    taskState.task.agentRunId = undefined;
    taskState.task.executionMode = "parallel";
    taskState.task.orchestrationKind = "parallel";
    taskState.task.currentRunId = "run-current-summary";
    taskState.task.sessionId = "ses-current-main";
    branchState.flatNodes = [
      {
        id: "node-history-main",
        parentId: "node-task-1",
        runtimeSessionId: "ses-history-main",
        isActive: false,
        contentText: "历史主线",
        branchName: "history-main",
        createdAt: "2026-03-22T12:00:00.000Z",
      },
      {
        id: "node-history-candidate-a",
        parentId: "node-task-1",
        runtimeSessionId: "ses-history-a",
        isActive: false,
        contentText: "历史候选 A",
        branchName: "history-a",
        createdAt: "2026-03-22T12:00:00.500Z",
      },
      {
        id: "node-current-main",
        parentId: "node-task-1",
        runtimeSessionId: "ses-current-main",
        isActive: true,
        contentText: "当前主线",
        branchName: "current-main",
        createdAt: "2026-03-22T12:05:00.000Z",
      },
      {
        id: "node-current-candidate-a",
        parentId: "node-task-1",
        runtimeSessionId: "ses-current-a",
        isActive: false,
        contentText: "当前候选 A",
        branchName: "current-a",
        createdAt: "2026-03-22T12:05:00.500Z",
      },
    ];
    branchState.selectedNode = branchState.flatNodes[0];
    messagesState.conversationItems = [
      {
        key: "user-mainline-companion",
        role: "user",
        text: "给出页面结构和顶部导航",
        createdAt: "2026-03-22T12:00:00.000Z",
        toolCalls: [],
        raw: null,
      },
    ];
    setLegacyParallelRuns([
        {
          id: "run-history-summary",
          taskId: "task-1",
          projectId: "proj-1",
          orchestrationKind: "parallel",
          triggerType: "user_execute",
          status: "completed",
          rootSessionId: "ses-history-main",
          candidateCount: 2,
          createdAt: "2026-03-22T12:00:00.000Z",
          startedAt: "2026-03-22T12:00:00.100Z",
          finishedAt: "2026-03-22T12:00:09.000Z",
          updatedAt: "2026-03-22T12:00:09.000Z",
        },
        {
          id: "run-history-candidate-a",
          taskId: "task-1",
          projectId: "proj-1",
          orchestrationKind: "parallel",
          triggerType: "user_execute",
          status: "completed",
          rootSessionId: "ses-history-a",
          candidateCount: 1,
          createdAt: "2026-03-22T12:00:00.000Z",
          startedAt: "2026-03-22T12:00:00.101Z",
          finishedAt: "2026-03-22T12:00:08.000Z",
          updatedAt: "2026-03-22T12:00:08.000Z",
        },
        {
          id: "run-current-summary",
          taskId: "task-1",
          projectId: "proj-1",
          orchestrationKind: "parallel",
          triggerType: "user_execute",
          status: "completed",
          rootSessionId: "ses-current-main",
          candidateCount: 2,
          createdAt: "2026-03-22T12:05:00.000Z",
          startedAt: "2026-03-22T12:05:00.100Z",
          finishedAt: "2026-03-22T12:05:09.000Z",
          updatedAt: "2026-03-22T12:05:09.000Z",
        },
        {
          id: "run-current-candidate-a",
          taskId: "task-1",
          projectId: "proj-1",
          orchestrationKind: "parallel",
          triggerType: "user_execute",
          status: "completed",
          rootSessionId: "ses-current-a",
          candidateCount: 1,
          createdAt: "2026-03-22T12:05:00.000Z",
          startedAt: "2026-03-22T12:05:00.101Z",
          finishedAt: "2026-03-22T12:05:08.000Z",
          updatedAt: "2026-03-22T12:05:08.000Z",
        },
      ],);
    setLegacyParallelRunDetailImplementation(async (_taskId: string, runId: string) => ({
      data: {
        run: {
          id: runId,
          taskId: "task-1",
          projectId: "proj-1",
          orchestrationKind: "parallel",
          triggerType: "user_execute",
          status: "completed",
          rootSessionId:
            runId === "run-history-summary"
              ? "ses-history-main"
              : runId === "run-history-candidate-a"
                ? "ses-history-a"
                : runId === "run-current-summary"
                  ? "ses-current-main"
                  : "ses-current-a",
          createdAt:
            runId === "run-history-summary" || runId === "run-history-candidate-a"
              ? "2026-03-22T12:00:00.000Z"
              : "2026-03-22T12:05:00.000Z",
          updatedAt:
            runId === "run-history-summary"
              ? "2026-03-22T12:00:09.000Z"
              : runId === "run-history-candidate-a"
                ? "2026-03-22T12:00:08.000Z"
                : runId === "run-current-summary"
                  ? "2026-03-22T12:05:09.000Z"
                  : "2026-03-22T12:05:08.000Z",
        },
        nodes: [],
        candidateNodes: [],
        judgeNode: null,
        winnerCandidateIndex: null,
      },
    }));
    apiMocks.getTaskAgentRuns.mockResolvedValue({
      data: [
        {
          id: "agent-history-summary",
          runId: "run-history-summary",
          taskId: "task-1",
          projectId: "proj-1",
          candidateIndex: 1,
          sessionId: "ses-history-main",
          model: "gpt-5-mini",
          agent: "executor",
          status: "completed",
          startedAt: "2026-03-22T12:00:00.100Z",
          finishedAt: "2026-03-22T12:00:09.000Z",
          result: "history-summary",
        },
        {
          id: "agent-history-a",
          runId: "run-history-candidate-a",
          taskId: "task-1",
          projectId: "proj-1",
          candidateIndex: 0,
          sessionId: "ses-history-a",
          model: "gemini-3-flash-preview",
          agent: "executor",
          status: "completed",
          startedAt: "2026-03-22T12:00:00.101Z",
          finishedAt: "2026-03-22T12:00:08.000Z",
          result: "history-a",
        },
        {
          id: "agent-current-summary",
          runId: "run-current-summary",
          taskId: "task-1",
          projectId: "proj-1",
          candidateIndex: 1,
          sessionId: "ses-current-main",
          model: "gpt-5-mini",
          agent: "executor",
          status: "completed",
          startedAt: "2026-03-22T12:05:00.100Z",
          finishedAt: "2026-03-22T12:05:09.000Z",
          result: "current-summary",
        },
        {
          id: "agent-current-a",
          runId: "run-current-candidate-a",
          taskId: "task-1",
          projectId: "proj-1",
          candidateIndex: 0,
          sessionId: "ses-current-a",
          model: "gemini-3-flash-preview",
          agent: "executor",
          status: "completed",
          startedAt: "2026-03-22T12:05:00.101Z",
          finishedAt: "2026-03-22T12:05:08.000Z",
          result: "current-a",
        },
      ],
    });
    apiMocks.getTaskExecutionTraceView.mockImplementation(
      async (_taskId: string, sessionId: string) => ({
        taskId: "task-1",
        sessionId,
        segments: [],
        hookExecutions: [],
        timeline: [],
        messages: [
          {
            id: `assistant-${sessionId}`,
            role: "assistant",
            text:
              sessionId === "ses-history-main"
                ? "history-mainline-trace"
                : sessionId === "ses-history-a"
                  ? "history-candidate-trace"
                  : sessionId === "ses-current-main"
                    ? "current-mainline-trace"
                    : "current-candidate-trace",
            createdAt:
              sessionId === "ses-history-main" || sessionId === "ses-history-a"
                ? "2026-03-22T12:00:10.000Z"
                : "2026-03-22T12:05:10.000Z",
          },
        ],
        latestResponse:
          sessionId === "ses-history-main"
            ? "history-mainline-trace"
            : sessionId === "ses-history-a"
              ? "history-candidate-trace"
              : sessionId === "ses-current-main"
                ? "current-mainline-trace"
                : "current-candidate-trace",
      }),
    );
    apiMocks.listTaskRuntimePermissions.mockResolvedValue({ data: [] });

    const wrapper = await mountPage();
    const candidateTexts = wrapper
      .findAll(".parallel-candidate-texts")
      .map((node) => node.text())
      .join("\n");

    expect(candidateTexts).toContain("history-summary");
    expect(candidateTexts).toContain("history-a");
    expect(candidateTexts).not.toContain("current-summary");
    expect(candidateTexts).not.toContain("current-a");
  });

  it("keeps a selected historical session pinned instead of auto-switching to the adopted winner branch", async () => {
    taskState.task.status = "completed";
    taskState.task.agentRunId = undefined;
    taskState.task.executionMode = "parallel";
    taskState.task.orchestrationKind = "parallel";
    taskState.task.currentRunId = "run-current-summary";
    taskState.task.sessionId = "ses-current-main";
    branchState.flatNodes = [
      {
        id: "node-history-main",
        parentId: "node-task-1",
        runtimeSessionId: "ses-history-main",
        isActive: false,
        contentText: "历史主线",
        branchName: "history-main",
        createdAt: "2026-03-22T12:00:00.000Z",
      },
      {
        id: "node-history-candidate-a",
        parentId: "node-history-main",
        runtimeSessionId: "ses-history-a",
        isActive: false,
        contentText: "历史候选 A",
        branchName: "history-a",
        createdAt: "2026-03-22T12:00:00.500Z",
      },
      {
        id: "node-history-candidate-b",
        parentId: "node-history-main",
        runtimeSessionId: "ses-history-b",
        isActive: false,
        contentText: "历史候选 B",
        branchName: "history-b",
        createdAt: "2026-03-22T12:00:00.700Z",
      },
      {
        id: "node-current-main",
        parentId: "node-task-1",
        runtimeSessionId: "ses-current-main",
        isActive: true,
        contentText: "当前主线",
        branchName: "current-main",
        createdAt: "2026-03-22T12:05:00.000Z",
      },
      {
        id: "node-current-winner",
        parentId: "node-current-main",
        runtimeSessionId: "ses-current-winner",
        isActive: false,
        contentText: "当前采纳分支",
        branchName: "current-winner",
        createdAt: "2026-03-22T12:05:00.500Z",
      },
      {
        id: "node-current-loser",
        parentId: "node-current-main",
        runtimeSessionId: "ses-current-loser",
        isActive: false,
        contentText: "当前未采纳分支",
        branchName: "current-loser",
        createdAt: "2026-03-22T12:05:00.700Z",
      },
    ];
    branchState.selectedNode = branchState.flatNodes[0];
    messagesState.conversationItems = [
      {
        key: "history-user",
        role: "user",
        text: "历史问题",
        createdAt: "2026-03-22T12:00:00.100Z",
        toolCalls: [],
        raw: null,
      },
    ];
    setLegacyParallelRuns([
        {
          id: "run-history-summary",
          taskId: "task-1",
          projectId: "proj-1",
          orchestrationKind: "parallel",
          triggerType: "user_execute",
          status: "completed",
          rootSessionId: "ses-history-main",
          executionSessionId: "ses-history-main",
          parentSessionId: "ses-history-main",
          candidateCount: 2,
          createdAt: "2026-03-22T12:00:00.000Z",
          startedAt: "2026-03-22T12:00:00.100Z",
          finishedAt: "2026-03-22T12:00:09.000Z",
          updatedAt: "2026-03-22T12:00:09.000Z",
        },
        {
          id: "run-current-summary",
          taskId: "task-1",
          projectId: "proj-1",
          orchestrationKind: "parallel",
          triggerType: "user_execute",
          status: "completed",
          rootSessionId: "ses-current-main",
          executionSessionId: "ses-current-main",
          parentSessionId: "ses-current-main",
          candidateCount: 2,
          winnerCandidateIndex: 0,
          createdAt: "2026-03-22T12:05:00.000Z",
          startedAt: "2026-03-22T12:05:00.100Z",
          finishedAt: "2026-03-22T12:05:09.000Z",
          updatedAt: "2026-03-22T12:05:09.000Z",
        },
      ],);
    setLegacyParallelRunDetailImplementation(async (_taskId: string, runId: string) => ({
      data: {
        run: {
          id: runId,
          taskId: "task-1",
          projectId: "proj-1",
          orchestrationKind: "parallel",
          triggerType: "user_execute",
          status: "completed",
          rootSessionId: runId === "run-history-summary" ? "ses-history-main" : "ses-current-main",
          executionSessionId:
            runId === "run-history-summary" ? "ses-history-main" : "ses-current-main",
          parentSessionId:
            runId === "run-history-summary" ? "ses-history-main" : "ses-current-main",
          createdAt:
            runId === "run-history-summary"
              ? "2026-03-22T12:00:00.000Z"
              : "2026-03-22T12:05:00.000Z",
          updatedAt:
            runId === "run-history-summary"
              ? "2026-03-22T12:00:09.000Z"
              : "2026-03-22T12:05:09.000Z",
        },
        nodes: [],
        candidateNodes:
          runId === "run-history-summary"
            ? [
                {
                  nodeId: "history-node-a",
                  candidateIndex: 0,
                  sessionId: "ses-history-a",
                  title: "历史候选 A",
                  resultSummary: "history-final-a",
                  status: "completed",
                  startedAt: "2026-03-22T12:00:00.500Z",
                  finishedAt: "2026-03-22T12:00:00.800Z",
                },
                {
                  nodeId: "history-node-b",
                  candidateIndex: 1,
                  sessionId: "ses-history-b",
                  title: "历史候选 B",
                  resultSummary: "history-final-b",
                  status: "completed",
                  startedAt: "2026-03-22T12:00:00.700Z",
                  finishedAt: "2026-03-22T12:00:00.900Z",
                },
              ]
            : [
                {
                  nodeId: "current-node-a",
                  candidateIndex: 0,
                  sessionId: "ses-current-winner",
                  title: "当前采纳分支",
                  resultSummary: "current-winner-final",
                  status: "completed",
                  startedAt: "2026-03-22T12:05:00.500Z",
                  finishedAt: "2026-03-22T12:05:00.800Z",
                },
                {
                  nodeId: "current-node-b",
                  candidateIndex: 1,
                  sessionId: "ses-current-loser",
                  title: "当前未采纳分支",
                  resultSummary: "current-loser-final",
                  status: "completed",
                  startedAt: "2026-03-22T12:05:00.700Z",
                  finishedAt: "2026-03-22T12:05:00.900Z",
                },
              ],
        judgeNode: null,
        winnerCandidateIndex: runId === "run-current-summary" ? 0 : null,
      },
    }));
    apiMocks.getTaskAgentRuns.mockResolvedValue({
      data: [],
    });
    apiMocks.getTaskExecutionTraceView.mockImplementation(
      async (_taskId: string, sessionId: string) => ({
        data: {
          taskId: "task-1",
          sessionId,
          segments: [],
          hookExecutions: [],
          timeline: [],
          messages: [
            {
              id: `assistant-${sessionId}`,
              role: "assistant",
              text:
                sessionId === "ses-history-a"
                  ? "history-final-a"
                  : sessionId === "ses-history-b"
                    ? "history-final-b"
                    : sessionId === "ses-current-winner"
                      ? "current-winner-final"
                      : "current-loser-final",
              createdAt:
                sessionId === "ses-history-a" || sessionId === "ses-history-b"
                  ? "2026-03-22T12:00:08.500Z"
                  : "2026-03-22T12:05:08.500Z",
            },
          ],
          latestResponse:
            sessionId === "ses-history-a"
              ? "history-final-a"
              : sessionId === "ses-history-b"
                ? "history-final-b"
                : sessionId === "ses-current-winner"
                  ? "current-winner-final"
                  : "current-loser-final",
        },
      }),
    );
    apiMocks.listTaskRuntimePermissions.mockResolvedValue({ data: [] });

    const wrapper = await mountPage();
    const activeSessionId = wrapper
      .find('[data-testid="chat-message-list-meta"]')
      .attributes("data-session-id");
    const candidateTexts = wrapper
      .findAll(".parallel-candidate-texts")
      .map((node) => node.text())
      .join("\n");

    expect(activeSessionId).toBe("ses-history-main");
    expect(candidateTexts).toContain("history-final-a");
    expect(candidateTexts).toContain("history-final-b");
    expect(candidateTexts).not.toContain("current-winner-final");
    expect(candidateTexts).not.toContain("current-loser-final");
    expect(apiMocks.getTaskExecutionTraceView).toHaveBeenCalledWith("task-1", "ses-history-a", {
      includeLineage: false,
    });
    expect(apiMocks.getTaskExecutionTraceView).toHaveBeenCalledWith("task-1", "ses-history-b", {
      includeLineage: false,
    });
    expect(apiMocks.getTaskExecutionTraceView).not.toHaveBeenCalledWith(
      "task-1",
      "ses-current-winner",
      expect.anything(),
    );
  });

  it("does not expose session selection or fork entry in the task conversation view", async () => {
    branchState.flatNodes = [
      {
        id: "node-session-1",
        runtimeSessionId: "ses-1",
        isActive: true,
        contentText: "主分支",
        branchName: "main",
      },
      {
        id: "node-session-2",
        runtimeSessionId: "ses-2",
        isActive: false,
        contentText: "分叉会话",
        branchName: "fork-a",
      },
    ];
    branchState.selectedNode = branchState.flatNodes[0];

    const wrapper = await mountPage();
    const selects = wrapper.findAll('[data-testid="select"]');

    expect(selects).toHaveLength(0);
    expect(wrapper.text()).not.toContain("选择会话");
    expect(wrapper.text()).not.toContain("Session ses-1");
    expect(wrapper.get('[data-testid="chat-composer"]').attributes("data-show-fork")).toBe("false");
    expect(apiMocks.listTaskRuntimePermissions).toHaveBeenLastCalledWith("task-1", "ses-1");
  });

  it("disables fork when the task has no active or selected session", async () => {
    taskState.task.sessionId = undefined;
    branchState.flatNodes = [];
    branchState.selectedNode = null as unknown as typeof branchState.selectedNode;
    apiMocks.listTaskRuntimePermissions.mockResolvedValue({ data: [] });

    const wrapper = await mountPage();
    const composer = wrapper.get('[data-testid="chat-composer"]');
    expect(composer.attributes("data-fork-disabled")).toBe("true");
  });

  it("switches the chat list to the new session and bumps the force-scroll token immediately after continue", async () => {
    taskState.task.status = "completed";
    taskState.task.finishedAt = "2026-03-22T10:00:00.000Z";
    apiMocks.continueTask.mockResolvedValueOnce({ ok: true, sessionId: "ses-2" });

    const wrapper = await mountPage();
    const metaBefore = wrapper.get('[data-testid="chat-message-list-meta"]');

    expect(metaBefore.attributes("data-session-id")).toBe("");
    expect(metaBefore.attributes("data-force-scroll-token")).toBe("0");

    await (
      wrapper.vm as unknown as { handleContinue: (prompt: string) => Promise<void> }
    ).handleContinue("新的 follow-up");
    await flushPromises();
    await nextTick();

    const metaAfter = wrapper.get('[data-testid="chat-message-list-meta"]');
    expect(apiMocks.continueTask).toHaveBeenCalledWith(
      "task-1",
      "新的 follow-up",
      "ses-1",
      expect.any(String),
    );
    expect(metaAfter.attributes("data-session-id")).toBe("ses-2");
    expect(Number(metaAfter.attributes("data-force-scroll-token"))).toBeGreaterThanOrEqual(1);
    expect(routerState.replace).not.toHaveBeenCalled();
  });

  it("keeps the provisional child round focused when silent refresh still returns the parent session tree", async () => {
    taskState.task.status = "completed";
    taskState.task.finishedAt = "2026-03-22T10:00:00.000Z";
    apiMocks.continueTask.mockResolvedValueOnce({ ok: true, sessionId: "ses-2" });
    taskState.refresh.mockImplementation(async () => {
      taskState.task = {
        ...taskState.task,
        status: "running",
        sessionId: "ses-1",
        finishedAt: undefined,
      } as TreeTask;
      branchState.flatNodes = [
        {
          id: "node-session-1",
          runtimeSessionId: "ses-1",
          isActive: true,
          contentText: "主分支",
          branchName: "main",
        },
      ];
      branchState.selectedNode = branchState.flatNodes[0];
    });

    const wrapper = await mountPage();

    await (
      wrapper.vm as unknown as { handleContinue: (prompt: string) => Promise<void> }
    ).handleContinue("新的 follow-up");
    await flushPromises();
    await nextTick();
    await flushPromises();

    const metaAfter = wrapper.get('[data-testid="chat-message-list-meta"]');
    expect(taskState.refresh).toHaveBeenCalled();
    expect(metaAfter.attributes("data-session-id")).toBe("ses-2");
    expect(Number(metaAfter.attributes("data-force-scroll-token"))).toBeGreaterThanOrEqual(1);
    expect(routerState.replace).not.toHaveBeenCalled();
  });

  it("seeds a pending assistant draft immediately after continue succeeds", async () => {
    taskState.task.status = "completed";
    taskState.task.finishedAt = "2026-03-22T10:00:00.000Z";
    apiMocks.continueTask.mockResolvedValueOnce({ ok: true, sessionId: "ses-2" });

    const wrapper = await mountPage();

    await (
      wrapper.vm as unknown as { handleContinue: (prompt: string) => Promise<void> }
    ).handleContinue("新的 follow-up");
    await flushPromises();

    expect(messagesState.seedPendingAssistantDraft).toHaveBeenCalledWith("ses-2");
  });

  it("prefers canonical task session ids for continue when session summaries expose them", async () => {
    taskState.task.status = "completed";
    taskState.task.finishedAt = "2026-03-22T10:00:00.000Z";
    apiMocks.getTaskSessions.mockResolvedValue({
      data: [
        {
          id: "ses-1",
          taskSessionId: "task-session:task-1:ses-1",
          title: "主分支",
          isActive: true,
          summary: null,
          createdAt: "2026-03-22T00:00:00.000Z",
          updatedAt: "2026-03-22T00:10:00.000Z",
        },
      ],
    });
    apiMocks.continueTask.mockResolvedValueOnce({ ok: true, sessionId: "ses-2" });

    const wrapper = await mountPage();

    await (
      wrapper.vm as unknown as { handleContinue: (prompt: string) => Promise<void> }
    ).handleContinue("新的 follow-up");
    await flushPromises();

    expect(apiMocks.continueTask).toHaveBeenCalledWith(
      "task-1",
      "新的 follow-up",
      "task-session:task-1:ses-1",
      expect.any(String),
    );
  });

  it("prefers the current task session for continue even when the page still points at a historical adopted session", async () => {
    taskState.task.status = "completed";
    taskState.task.finishedAt = "2026-03-22T10:00:00.000Z";
    taskState.task.sessionId = "ses-current";
    branchState.flatNodes = [
      {
        id: "node-history-root",
        parentId: "node-task-1",
        runtimeSessionId: "ses-history-root",
        isActive: false,
        contentText: "历史主线",
        branchName: "history-root",
      },
      {
        id: "node-history-winner",
        parentId: "node-history-root",
        runtimeSessionId: "ses-history-winner",
        isActive: false,
        contentText: "历史采纳分支",
        branchName: "history-winner",
      },
      {
        id: "node-current",
        parentId: "node-task-1",
        runtimeSessionId: "ses-current",
        isActive: true,
        contentText: "当前主线",
        branchName: "current",
      },
    ];
    branchState.selectedNode = branchState.flatNodes[1];
    apiMocks.getTaskSessions.mockResolvedValue({
      data: [
        {
          id: "ses-history-root",
          taskSessionId: "task-session:task-1:ses-history-root",
          title: "历史主线",
          isActive: false,
          summary: null,
          createdAt: "2026-03-22T09:00:00.000Z",
          updatedAt: "2026-03-22T09:10:00.000Z",
        },
        {
          id: "ses-history-winner",
          taskSessionId: "task-session:task-1:ses-history-winner",
          title: "历史采纳分支",
          isActive: false,
          summary: null,
          coordinationKey: "group-old",
          winnerSessionId: "ses-history-winner",
          candidateIndex: 1,
          createdAt: "2026-03-22T09:01:00.000Z",
          updatedAt: "2026-03-22T09:02:00.000Z",
        },
        {
          id: "ses-current",
          taskSessionId: "task-session:task-1:ses-current",
          title: "当前主线",
          isActive: true,
          summary: null,
          createdAt: "2026-03-22T10:00:00.000Z",
          updatedAt: "2026-03-22T10:10:00.000Z",
        },
      ],
    });
    apiMocks.continueTask.mockResolvedValueOnce({ ok: true, sessionId: "ses-next" });

    const wrapper = await mountPage();

    await (
      wrapper.vm as unknown as { handleContinue: (prompt: string) => Promise<void> }
    ).handleContinue("新的 follow-up");
    await flushPromises();

    expect(apiMocks.continueTask).toHaveBeenCalledWith(
      "task-1",
      "新的 follow-up",
      "task-session:task-1:ses-current",
      expect.any(String),
    );
  });

  it("continues forked sessions via canonical task session ids when available", async () => {
    taskState.task.status = "completed";
    taskState.task.finishedAt = "2026-03-22T10:00:00.000Z";
    apiMocks.getTaskSessions.mockResolvedValue({
      data: [
        {
          id: "ses-1",
          taskSessionId: "task-session:task-1:ses-1",
          title: "主分支",
          isActive: true,
          summary: null,
          createdAt: "2026-03-22T00:00:00.000Z",
          updatedAt: "2026-03-22T00:10:00.000Z",
        },
      ],
    });
    apiMocks.forkTaskSession.mockResolvedValueOnce({
      ok: true,
      sessionId: "ses-2",
      taskSessionId: "task-session:task-1:ses-2",
    });
    apiMocks.continueTask.mockResolvedValueOnce({ ok: true, sessionId: "ses-3" });

    const wrapper = await mountPage();

    await (wrapper.vm as unknown as { handleFork: (prompt: string) => Promise<void> }).handleFork(
      "新的 follow-up",
    );
    await flushPromises();

    expect(apiMocks.forkTaskSession).toHaveBeenCalledWith(
      "task-1",
      "task-session:task-1:ses-1",
      expect.stringContaining("分叉"),
    );
    expect(apiMocks.continueTask).toHaveBeenCalledWith(
      "task-1",
      "新的 follow-up",
      "task-session:task-1:ses-2",
      expect.any(String),
    );
    expect(messagesState.seedPendingAssistantDraft).toHaveBeenCalledWith("ses-3");
  });

  it("eventually renders the new user follow-up text in the switched session conversation", async () => {
    taskState.task.status = "completed";
    taskState.task.finishedAt = "2026-03-22T10:00:00.000Z";
    messagesStoreMock.trace = { sessionId: "ses-1" };
    messagesStoreMock.conversationItems = [
      {
        key: "old-user",
        role: "user",
        text: "旧主线消息",
      },
      {
        key: "old-assistant",
        role: "assistant",
        text: "旧主线回复",
      },
    ];
    apiMocks.continueTask.mockResolvedValueOnce({ ok: true, sessionId: "ses-2" });

    let refreshCount = 0;
    messagesState.refresh = vi.fn(async () => {
      refreshCount += 1;
      messagesStoreMock.trace = { sessionId: "ses-2" };
      messagesStoreMock.conversationItems = [
        {
          key: "new-user",
          role: "user",
          text: "新的 follow-up",
        },
        {
          key: "new-assistant",
          role: "assistant",
          text: "新的 follow-up 回复",
        },
      ];
    });

    const wrapper = await mountPage();

    await (
      wrapper.vm as unknown as { handleContinue: (prompt: string) => Promise<void> }
    ).handleContinue("新的 follow-up");
    await flushPromises();
    await nextTick();

    expect(messagesState.refresh).toHaveBeenCalled();
    expect(refreshCount).toBe(1);

    const renderedItems = wrapper.findAll(".chat-item").map((node) => ({
      role: node.attributes("data-role"),
      text: node.attributes("data-text"),
    }));

    expect(renderedItems).toContainEqual(
      expect.objectContaining({
        role: "user",
        text: "新的 follow-up",
      }),
    );
    expect(renderedItems).toContainEqual(
      expect.objectContaining({
        role: "assistant",
        text: "新的 follow-up 回复",
      }),
    );
  });

  it("loads parallel candidate cards from domain runs without lineage history", async () => {
    taskState.task.executionMode = "parallel";
    taskState.task.orchestrationKind = "parallel";
    taskState.task.currentRunId = "run-current-1";
    setLegacyParallelRuns([
        {
          id: "run-current-1",
          taskId: "task-1",
          projectId: "proj-1",
          orchestrationKind: "parallel",
          triggerType: "user_execute",
          status: "running",
          rootSessionId: "ses-root",
          createdAt: "2026-03-22T05:25:21.900Z",
          updatedAt: "2026-03-22T05:25:21.980Z",
        },
      ],);
    setLegacyParallelRunDetail({
        run: {
          id: "run-current-1",
          taskId: "task-1",
          projectId: "proj-1",
          orchestrationKind: "parallel",
          triggerType: "user_execute",
          status: "running",
          rootSessionId: "ses-root",
          createdAt: "2026-03-22T05:25:21.900Z",
          updatedAt: "2026-03-22T05:25:21.980Z",
        },
        nodes: [],
        candidateNodes: [
          {
            id: "current-node-a",
            runId: "run-current-1",
            taskId: "task-1",
            projectId: "proj-1",
            nodeKind: "candidate",
            nodeKey: "candidate:0",
            title: "候选 A",
            candidateIndex: 0,
            agentType: "oracle-enterprise",
            modelUsed: "gpt-5-mini",
            sessionId: "ses-a",
            status: "running",
            createdAt: "2026-03-22T05:25:21.966Z",
            updatedAt: "2026-03-22T05:25:21.970Z",
          },
          {
            id: "current-node-b",
            runId: "run-current-1",
            taskId: "task-1",
            projectId: "proj-1",
            nodeKind: "candidate",
            nodeKey: "candidate:1",
            title: "候选 B",
            candidateIndex: 1,
            agentType: "oracle-enterprise",
            modelUsed: "gpt-4o",
            sessionId: "ses-b",
            status: "running",
            createdAt: "2026-03-22T05:25:21.977Z",
            updatedAt: "2026-03-22T05:25:21.980Z",
          },
        ],
        judgeNode: null,
        winnerCandidateIndex: null,
      },);
    apiMocks.listTaskRuntimePermissions.mockResolvedValue({ data: [] });

    await mountPage();

    expect(apiMocks.getTaskExecutionTraceView).toHaveBeenCalledWith("task-1", "ses-a", {
      includeLineage: false,
    });
    expect(apiMocks.getTaskExecutionTraceView).toHaveBeenCalledWith("task-1", "ses-b", {
      includeLineage: false,
    });
  });

  it("renders session fallback candidate replies before slower traces settle", async () => {
    taskState.task.executionMode = "parallel";
    taskState.task.orchestrationKind = "parallel";
    taskState.task.currentRunId = "run-current-1";
    messagesState.conversationItems = [
      {
        key: "parallel-user-1",
        role: "user",
        text: "给两个并行方案",
        createdAt: "2026-03-22T05:25:21.900Z",
        toolCalls: [],
        raw: null,
      },
    ];
    setLegacyParallelRuns([
        {
          id: "run-current-1",
          taskId: "task-1",
          projectId: "proj-1",
          orchestrationKind: "parallel",
          triggerType: "user_execute",
          status: "running",
          rootSessionId: "ses-root",
          createdAt: "2026-03-22T05:25:21.900Z",
          updatedAt: "2026-03-22T05:25:21.980Z",
        },
      ],);
    setLegacyParallelRunDetail({
        run: {
          id: "run-current-1",
          taskId: "task-1",
          projectId: "proj-1",
          orchestrationKind: "parallel",
          triggerType: "user_execute",
          status: "running",
          rootSessionId: "ses-root",
          createdAt: "2026-03-22T05:25:21.900Z",
          updatedAt: "2026-03-22T05:25:21.980Z",
        },
        nodes: [],
        candidateNodes: [
          {
            id: "current-node-a",
            runId: "run-current-1",
            taskId: "task-1",
            projectId: "proj-1",
            nodeKind: "candidate",
            nodeKey: "candidate:0",
            title: "候选 A",
            candidateIndex: 0,
            agentType: "oracle-enterprise",
            modelUsed: "gpt-5-mini",
            sessionId: "ses-a",
            status: "running",
            createdAt: "2026-03-22T05:25:21.966Z",
            updatedAt: "2026-03-22T05:25:21.970Z",
          },
          {
            id: "current-node-b",
            runId: "run-current-1",
            taskId: "task-1",
            projectId: "proj-1",
            nodeKind: "candidate",
            nodeKey: "candidate:1",
            title: "候选 B",
            candidateIndex: 1,
            agentType: "oracle-enterprise",
            modelUsed: "gpt-4o",
            sessionId: "ses-b",
            status: "running",
            createdAt: "2026-03-22T05:25:21.977Z",
            updatedAt: "2026-03-22T05:25:21.980Z",
          },
        ],
        judgeNode: null,
        winnerCandidateIndex: null,
      },);
    const traceA = createDeferred<any>();
    const traceB = createDeferred<any>();
    apiMocks.getTaskConversationMessages.mockImplementation(
      async (_taskId: string, sessionId: string) => ({
        data:
          sessionId === "ses-a"
            ? [
                {
                  info: {
                    id: "assistant-ses-a",
                    role: "assistant",
                    time: { created: "2026-03-22T05:25:22.100Z" },
                  },
                  parts: [{ type: "text", text: "会话回退候选 A" }],
                },
              ]
            : [],
      }),
    );
    apiMocks.getTaskExecutionTraceView.mockImplementation(
      (_taskId: string, sessionId: string) =>
        sessionId === "ses-a" ? traceA.promise : traceB.promise,
    );
    apiMocks.listTaskRuntimePermissions.mockResolvedValue({ data: [] });

    const wrapper = await mountPage();
    for (let attempt = 0; attempt < 4; attempt += 1) {
      await flushPromises();
      await nextTick();
    }

    let parallelItem = wrapper
      .findAll(".chat-item")
      .find((node) => node.attributes("data-role") === "parallel");

    expect(apiMocks.getTaskConversationMessages).toHaveBeenCalledWith("task-1", "ses-a", {
      includeLineage: false,
    });
    expect(parallelItem?.attributes("data-candidate-statuses")).toBe("completed|running");
    expect(parallelItem?.attributes("data-candidate-entry-roles")).toBe("assistant|");
    expect(wrapper.get(".parallel-candidate-texts").text()).toContain("会话回退候选 A");
    expect(wrapper.get(".parallel-candidate-texts").text()).not.toContain("追踪候选 B");

    traceB.resolve({
      taskId: "task-1",
      sessionId: "ses-b",
      segments: [],
      hookExecutions: [],
      messages: [
        {
          id: "assistant-ses-b",
          role: "assistant",
          text: "追踪候选 B",
          createdAt: "2026-03-22T05:25:22.300Z",
        },
      ],
      timeline: [],
      latestResponse: "追踪候选 B",
    });
    await flushPromises();
    await nextTick();

    parallelItem = wrapper
      .findAll(".chat-item")
      .find((node) => node.attributes("data-role") === "parallel");

    expect(wrapper.get(".parallel-candidate-texts").text()).toContain("会话回退候选 A");
    expect(wrapper.get(".parallel-candidate-texts").text()).toContain("追踪候选 B");
    expect(parallelItem?.attributes("data-candidate-statuses")).toBe("completed|completed");

    traceA.resolve({
      taskId: "task-1",
      sessionId: "ses-a",
      segments: [],
      hookExecutions: [],
      messages: [
        {
          id: "assistant-ses-a",
          role: "assistant",
          text: "追踪候选 A",
          createdAt: "2026-03-22T05:25:22.100Z",
        },
      ],
      timeline: [],
      latestResponse: "追踪候选 A",
    });
    await flushPromises();
  });

  it("applies realtime assistant deltas to parallel candidate cards", async () => {
    taskState.task.executionMode = "parallel";
    taskState.task.orchestrationKind = "parallel";
    taskState.task.currentRunId = "run-current-1";
    messagesState.conversationItems = [
      {
        key: "parallel-user-live-1",
        role: "user",
        text: "继续并行生成",
        createdAt: "2026-03-22T05:25:21.900Z",
        toolCalls: [],
        raw: null,
      },
    ];
    setLegacyParallelRuns([
        {
          id: "run-current-1",
          taskId: "task-1",
          projectId: "proj-1",
          orchestrationKind: "parallel",
          triggerType: "user_execute",
          status: "running",
          rootSessionId: "ses-root",
          createdAt: "2026-03-22T05:25:21.900Z",
          updatedAt: "2026-03-22T05:25:21.980Z",
        },
      ],);
    setLegacyParallelRunDetail({
        run: {
          id: "run-current-1",
          taskId: "task-1",
          projectId: "proj-1",
          orchestrationKind: "parallel",
          triggerType: "user_execute",
          status: "running",
          rootSessionId: "ses-root",
          createdAt: "2026-03-22T05:25:21.900Z",
          updatedAt: "2026-03-22T05:25:21.980Z",
        },
        nodes: [],
        candidateNodes: [
          {
            id: "live-node-a",
            runId: "run-current-1",
            taskId: "task-1",
            projectId: "proj-1",
            nodeKind: "candidate",
            nodeKey: "candidate:0",
            title: "候选 A",
            candidateIndex: 0,
            agentType: "oracle-enterprise",
            modelUsed: "gpt-5-mini",
            sessionId: "ses-a",
            status: "running",
            createdAt: "2026-03-22T05:25:21.966Z",
            updatedAt: "2026-03-22T05:25:21.970Z",
          },
          {
            id: "live-node-b",
            runId: "run-current-1",
            taskId: "task-1",
            projectId: "proj-1",
            nodeKind: "candidate",
            nodeKey: "candidate:1",
            title: "候选 B",
            candidateIndex: 1,
            agentType: "oracle-enterprise",
            modelUsed: "gpt-4o",
            sessionId: "ses-b",
            status: "running",
            createdAt: "2026-03-22T05:25:21.977Z",
            updatedAt: "2026-03-22T05:25:21.980Z",
          },
        ],
        judgeNode: null,
        winnerCandidateIndex: null,
      },);
    apiMocks.getTaskConversationMessages.mockResolvedValue({ data: [] });
    apiMocks.getTaskExecutionTraceView.mockImplementation(
      async (_taskId: string, sessionId: string) => ({
        taskId: "task-1",
        sessionId,
        segments: [],
        hookExecutions: [],
        messages: [],
        timeline: [],
      }),
    );
    apiMocks.listTaskRuntimePermissions.mockResolvedValue({ data: [] });

    const wrapper = await mountPage();

    expect(wrapper.get(".parallel-candidate-texts").text()).toBe("");

    realtimeStoreMock.events = [
      {
        id: "evt-parallel-delta-a-2",
        type: "task.message.delta",
        taskId: "task-1",
        sessionId: "ses-a",
        data: {
          delta: "候选回复",
          part: {
            messageID: "assistant-live-a",
            type: "text",
            text: "候选回复",
          },
        },
      },
      {
        id: "evt-parallel-delta-a-1",
        type: "task.message.delta",
        taskId: "task-1",
        sessionId: "ses-a",
        data: {
          delta: "实时",
          part: {
            messageID: "assistant-live-a",
            type: "text",
            text: "实时",
          },
        },
      },
      {
        id: "evt-parallel-progress-a",
        type: "task.message.updated",
        taskId: "task-1",
        sessionId: "ses-a",
        data: {
          message: {
            id: "assistant-live-a",
            role: "assistant",
            agent: "oracle-enterprise",
            model: "gpt-5-mini",
            time: {
              created: "2026-03-22T05:25:22.500Z",
            },
          },
        },
      },
    ];
    await nextTick();
    await flushPromises();

    const parallelItem = wrapper
      .findAll(".chat-item")
      .find((node) => node.attributes("data-role") === "parallel");

    expect(wrapper.get(".parallel-candidate-texts").text()).toContain("实时候选回复");
    expect(parallelItem?.attributes("data-candidate-statuses")).toBe("running|running");
  });

  it("prefers session message tool-call details for parallel candidate cards when trace omits them", async () => {
    taskState.task.executionMode = "parallel";
    taskState.task.orchestrationKind = "parallel";
    taskState.task.currentRunId = "run-current-1";
    setLegacyParallelRuns([
        {
          id: "run-current-1",
          taskId: "task-1",
          projectId: "proj-1",
          orchestrationKind: "parallel",
          triggerType: "user_execute",
          status: "completed",
          rootSessionId: "ses-root",
          createdAt: "2026-03-22T05:25:21.900Z",
          updatedAt: "2026-03-22T05:25:29.000Z",
        },
      ],);
    setLegacyParallelRunDetail({
        run: {
          id: "run-current-1",
          taskId: "task-1",
          projectId: "proj-1",
          orchestrationKind: "parallel",
          triggerType: "user_execute",
          status: "completed",
          rootSessionId: "ses-root",
          createdAt: "2026-03-22T05:25:21.900Z",
          updatedAt: "2026-03-22T05:25:29.000Z",
        },
        nodes: [],
        candidateNodes: [
          {
            id: "candidate-node-a",
            runId: "run-current-1",
            taskId: "task-1",
            projectId: "proj-1",
            nodeKind: "candidate",
            nodeKey: "candidate:0",
            title: "候选 A",
            candidateIndex: 0,
            agentType: "oracle-enterprise",
            modelUsed: "gpt-5-mini",
            sessionId: "ses-a",
            status: "completed",
            createdAt: "2026-03-22T05:25:21.966Z",
            updatedAt: "2026-03-22T05:25:29.000Z",
          },
          {
            id: "candidate-node-b",
            runId: "run-current-1",
            taskId: "task-1",
            projectId: "proj-1",
            nodeKind: "candidate",
            nodeKey: "candidate:1",
            title: "候选 B",
            candidateIndex: 1,
            agentType: "oracle-enterprise",
            modelUsed: "gpt-4o",
            sessionId: "ses-b",
            status: "completed",
            createdAt: "2026-03-22T05:25:21.977Z",
            updatedAt: "2026-03-22T05:25:29.000Z",
          },
        ],
        judgeNode: null,
        winnerCandidateIndex: null,
      },);
    apiMocks.getTaskExecutionTraceView.mockImplementation(
      async (_taskId: string, sessionId: string) => ({
        taskId: "task-1",
        sessionId,
        segments: [],
        hookExecutions: [],
        messages: [
          {
            id: `assistant-${sessionId}`,
            role: "assistant",
            text: sessionId === "ses-a" ? "先看 README" : "直接给建议",
            createdAt: "2026-03-22T05:25:22.100Z",
          },
        ],
        timeline:
          sessionId === "ses-a"
            ? [
                {
                  id: `assistant-${sessionId}`,
                  role: "assistant",
                  text: "先看 README",
                  createdAt: "2026-03-22T05:25:22.100Z",
                },
                {
                  id: `system-tool-${sessionId}`,
                  role: "system",
                  text: '{"path":"README.md"}',
                  createdAt: "2026-03-22T05:25:22.100Z",
                },
                {
                  id: `tool-output-${sessionId}`,
                  role: "tool",
                  text: "README 内容",
                  createdAt: "2026-03-22T05:25:22.300Z",
                },
              ]
            : [],
        latestResponse: sessionId === "ses-a" ? "已经阅读 README" : "直接给建议",
      }),
    );
    apiMocks.getTaskConversationMessages.mockImplementation(
      async (_taskId: string, sessionId: string) => ({
        data:
          sessionId === "ses-a"
            ? [
                {
                  info: {
                    id: `user-${sessionId}`,
                    role: "user",
                    time: { created: "2026-03-22T05:25:21.966Z" },
                  },
                  parts: [{ type: "text", text: "给3个建议" }],
                },
                {
                  info: {
                    id: `assistant-${sessionId}`,
                    role: "assistant",
                    time: { created: "2026-03-22T05:25:22.100Z" },
                  },
                  parts: [
                    { type: "text", text: "先看 README" },
                    {
                      type: "tool",
                      toolName: "read",
                      callID: `read-${sessionId}`,
                      input: { path: "README.md" },
                      state: {
                        status: "completed",
                        output: "<path>README.md</path><content>README 内容</content>",
                      },
                    },
                  ],
                },
              ]
            : [],
      }),
    );
    apiMocks.listTaskRuntimePermissions.mockResolvedValue({ data: [] });

    const wrapper = await mountPage();
    const parallelItem = wrapper
      .findAll(".chat-item")
      .find((node) => node.attributes("data-role") === "parallel");

    expect(apiMocks.getTaskConversationMessages).toHaveBeenCalledWith("task-1", "ses-a", {
      includeLineage: false,
    });
    expect(parallelItem?.attributes("data-candidate-tool-call-counts")).toBe("1|0");
  });

  it("merges duplicated projected tool outputs into the first tool call card for parallel candidates", async () => {
    taskState.task.executionMode = "parallel";
    taskState.task.orchestrationKind = "parallel";
    taskState.task.currentRunId = "run-current-1";
    setLegacyParallelRuns([
        {
          id: "run-current-1",
          taskId: "task-1",
          projectId: "proj-1",
          orchestrationKind: "parallel",
          triggerType: "user_execute",
          status: "completed",
          rootSessionId: "ses-root",
          createdAt: "2026-03-22T05:25:21.900Z",
          updatedAt: "2026-03-22T05:25:29.000Z",
        },
      ],);
    setLegacyParallelRunDetail({
        run: {
          id: "run-current-1",
          taskId: "task-1",
          projectId: "proj-1",
          orchestrationKind: "parallel",
          triggerType: "user_execute",
          status: "completed",
          rootSessionId: "ses-root",
          createdAt: "2026-03-22T05:25:21.900Z",
          updatedAt: "2026-03-22T05:25:29.000Z",
        },
        nodes: [],
        candidateNodes: [
          {
            id: "candidate-node-a",
            runId: "run-current-1",
            taskId: "task-1",
            projectId: "proj-1",
            nodeKind: "candidate",
            nodeKey: "candidate:0",
            title: "候选 A",
            candidateIndex: 0,
            agentType: "oracle-enterprise",
            modelUsed: "gpt-5-mini",
            sessionId: "ses-a",
            status: "completed",
            createdAt: "2026-03-22T05:25:21.966Z",
            updatedAt: "2026-03-22T05:25:29.000Z",
          },
          {
            id: "candidate-node-b",
            runId: "run-current-1",
            taskId: "task-1",
            projectId: "proj-1",
            nodeKind: "candidate",
            nodeKey: "candidate:1",
            title: "候选 B",
            candidateIndex: 1,
            agentType: "oracle-enterprise",
            modelUsed: "gpt-4o",
            sessionId: "ses-b",
            status: "completed",
            createdAt: "2026-03-22T05:25:21.977Z",
            updatedAt: "2026-03-22T05:25:29.000Z",
          },
        ],
        judgeNode: null,
        winnerCandidateIndex: null,
      },);
    apiMocks.getTaskExecutionTraceView.mockImplementation(
      async (_taskId: string, sessionId: string) => ({
        taskId: "task-1",
        sessionId,
        segments: [],
        hookExecutions: [],
        messages: [
          {
            id: `assistant-${sessionId}`,
            role: "assistant",
            text: sessionId === "ses-a" ? "先看 README" : "直接给建议",
            createdAt: "2026-03-22T05:25:22.100Z",
          },
        ],
        timeline:
          sessionId === "ses-a"
            ? [
                {
                  id: `assistant-${sessionId}`,
                  role: "assistant",
                  text: "先看 README",
                  createdAt: "2026-03-22T05:25:22.100Z",
                },
                {
                  id: `tool-output-${sessionId}`,
                  role: "tool",
                  text: "README 内容",
                  createdAt: "2026-03-22T05:25:22.300Z",
                },
              ]
            : [],
        latestResponse: sessionId === "ses-a" ? "已经阅读 README" : "直接给建议",
      }),
    );
    apiMocks.getTaskConversationMessages.mockImplementation(
      async (_taskId: string, sessionId: string) => ({
        data:
          sessionId === "ses-a"
            ? [
                {
                  info: {
                    id: `user-${sessionId}`,
                    role: "user",
                    time: { created: "2026-03-22T05:25:21.966Z" },
                  },
                  parts: [{ type: "text", text: "给3个建议" }],
                },
                {
                  info: {
                    id: `assistant-${sessionId}`,
                    role: "assistant",
                    time: { created: "2026-03-22T05:25:22.100Z" },
                  },
                  parts: [
                    { type: "text", text: "先看 README" },
                    {
                      type: "tool",
                      toolName: "read",
                      callID: `read-${sessionId}`,
                      input: { path: "README.md" },
                      state: { status: "completed" },
                    },
                  ],
                },
                {
                  info: {
                    id: `task-session-message:task-session:task-1:${sessionId}:tool:read-${sessionId}:call`,
                    role: "tool",
                    time: { created: "2026-03-22T05:25:22.200Z" },
                  },
                  parts: [
                    {
                      type: "tool",
                      toolName: "read",
                      callID: `read-${sessionId}`,
                      input: { path: "README.md" },
                      state: { status: "completed" },
                    },
                  ],
                },
                {
                  info: {
                    id: `task-session-message:task-session:task-1:${sessionId}:tool:read-${sessionId}:output`,
                    role: "tool",
                    time: { created: "2026-03-22T05:25:22.300Z" },
                  },
                  parts: [{ type: "text", text: "README 内容" }],
                },
              ]
            : [
                {
                  info: {
                    id: `assistant-${sessionId}`,
                    role: "assistant",
                    time: { created: "2026-03-22T05:25:22.100Z" },
                  },
                  parts: [{ type: "text", text: "直接给建议" }],
                },
              ],
      }),
    );
    apiMocks.listTaskRuntimePermissions.mockResolvedValue({ data: [] });

    const wrapper = await mountPage();
    const parallelItem = wrapper
      .findAll(".chat-item")
      .find((node) => node.attributes("data-role") === "parallel");

    expect(parallelItem?.attributes("data-candidate-tool-call-counts")).toBe("1|0");
    expect(parallelItem?.attributes("data-candidate-entry-roles")).toBe("assistant|assistant");
    expect(parallelItem?.attributes("data-candidate-tool-outputs")).toBe("README 内容|");
  });

  it("hides pre-start historical messages from parallel candidate cards", async () => {
    taskState.task.executionMode = "parallel";
    taskState.task.orchestrationKind = "parallel";
    taskState.task.currentRunId = "run-current-1";
    setLegacyParallelRuns([
        {
          id: "run-current-1",
          taskId: "task-1",
          projectId: "proj-1",
          orchestrationKind: "parallel",
          triggerType: "user_execute",
          status: "completed",
          rootSessionId: "ses-root",
          startedAt: "2026-03-22T05:25:21.900Z",
          finishedAt: "2026-03-22T05:25:29.000Z",
          createdAt: "2026-03-22T05:25:21.900Z",
          updatedAt: "2026-03-22T05:25:29.000Z",
        },
      ],);
    setLegacyParallelRunDetail({
        run: {
          id: "run-current-1",
          taskId: "task-1",
          projectId: "proj-1",
          orchestrationKind: "parallel",
          triggerType: "user_execute",
          status: "completed",
          rootSessionId: "ses-root",
          startedAt: "2026-03-22T05:25:21.900Z",
          finishedAt: "2026-03-22T05:25:29.000Z",
          createdAt: "2026-03-22T05:25:21.900Z",
          updatedAt: "2026-03-22T05:25:29.000Z",
        },
        nodes: [],
        candidateNodes: [
          {
            id: "candidate-node-a",
            runId: "run-current-1",
            taskId: "task-1",
            projectId: "proj-1",
            nodeKind: "candidate",
            nodeKey: "candidate:0",
            title: "候选 A",
            candidateIndex: 0,
            agentType: "oracle-enterprise",
            modelUsed: "gemini-3-flash-preview",
            sessionId: "ses-a",
            status: "completed",
            startedAt: "2026-03-22T05:25:22.000Z",
            finishedAt: "2026-03-22T05:25:27.000Z",
            createdAt: "2026-03-22T05:25:22.000Z",
            updatedAt: "2026-03-22T05:25:27.000Z",
          },
          {
            id: "candidate-node-b",
            runId: "run-current-1",
            taskId: "task-1",
            projectId: "proj-1",
            nodeKind: "candidate",
            nodeKey: "candidate:1",
            title: "候选 B",
            candidateIndex: 1,
            agentType: "oracle-enterprise",
            modelUsed: "gpt-5-mini",
            sessionId: "ses-b",
            status: "completed",
            startedAt: "2026-03-22T05:25:22.100Z",
            finishedAt: "2026-03-22T05:25:27.100Z",
            createdAt: "2026-03-22T05:25:22.100Z",
            updatedAt: "2026-03-22T05:25:27.100Z",
          },
        ],
        judgeNode: null,
        winnerCandidateIndex: null,
      },);
    apiMocks.getTaskExecutionTraceView.mockImplementation(
      async (_taskId: string, sessionId: string) => ({
        taskId: "task-1",
        sessionId,
        segments: [],
        hookExecutions: [],
        timeline: [],
        messages:
          sessionId === "ses-a"
            ? [
                {
                  id: "old-a",
                  role: "assistant",
                  text: "旧候选 A 内容",
                  createdAt: "2026-03-22T05:25:20.000Z",
                },
                {
                  id: "new-a",
                  role: "assistant",
                  text: "新的候选 A 内容",
                  createdAt: "2026-03-22T05:25:23.000Z",
                },
              ]
            : [
                {
                  id: "new-b",
                  role: "assistant",
                  text: "新的候选 B 内容",
                  createdAt: "2026-03-22T05:25:24.000Z",
                },
              ],
        latestResponse: sessionId === "ses-a" ? "新的候选 A 内容" : "新的候选 B 内容",
      }),
    );

    const wrapper = await mountPage();
    const candidateTexts = wrapper
      .findAll(".parallel-candidate-texts")
      .map((node) => node.text())
      .join("\n");

    expect(candidateTexts).toContain("新的候选 A 内容");
    expect(candidateTexts).toContain("新的候选 B 内容");
    expect(candidateTexts).not.toContain("旧候选 A 内容");
  });

  it("loads historical parallel candidate cards on first render even after the task switched back to single mode", async () => {
    taskState.task.status = "completed";
    taskState.task.executionMode = "single";
    taskState.task.orchestrationKind = "parallel";
    taskState.task.currentRunId = "run-history-1";
    setLegacyParallelRuns([
        {
          id: "run-history-1",
          taskId: "task-1",
          projectId: "proj-1",
          orchestrationKind: "parallel",
          triggerType: "user_execute",
          status: "completed",
          rootSessionId: "ses-root",
          createdAt: "2026-03-22T05:00:00.000Z",
          updatedAt: "2026-03-22T05:00:10.000Z",
        },
      ],);
    setLegacyParallelRunDetail({
        run: {
          id: "run-history-1",
          taskId: "task-1",
          projectId: "proj-1",
          orchestrationKind: "parallel",
          triggerType: "user_execute",
          status: "completed",
          rootSessionId: "ses-root",
          createdAt: "2026-03-22T05:00:00.000Z",
          updatedAt: "2026-03-22T05:00:10.000Z",
        },
        nodes: [],
        candidateNodes: [
          {
            id: "history-node-a",
            runId: "run-history-1",
            taskId: "task-1",
            projectId: "proj-1",
            nodeKind: "candidate",
            nodeKey: "candidate:0",
            title: "候选 A",
            candidateIndex: 0,
            agentType: "explore-enterprise",
            modelUsed: "gpt-5-mini",
            sessionId: "ses-a",
            status: "completed",
            createdAt: "2026-03-22T05:00:01.000Z",
            updatedAt: "2026-03-22T05:00:02.000Z",
          },
          {
            id: "history-node-b",
            runId: "run-history-1",
            taskId: "task-1",
            projectId: "proj-1",
            nodeKind: "candidate",
            nodeKey: "candidate:1",
            title: "候选 B",
            candidateIndex: 1,
            agentType: "explore-enterprise",
            modelUsed: "gpt-4o",
            sessionId: "ses-b",
            status: "completed",
            createdAt: "2026-03-22T05:00:01.000Z",
            updatedAt: "2026-03-22T05:00:02.000Z",
          },
        ],
        judgeNode: null,
        winnerCandidateIndex: 0,
      },);
    apiMocks.listTaskRuntimePermissions.mockResolvedValue({ data: [] });

    await mountPage();

    expect(apiMocks.getTaskExecutionTraceView).toHaveBeenCalledWith("task-1", "ses-a", {
      includeLineage: false,
    });
    expect(apiMocks.getTaskExecutionTraceView).toHaveBeenCalledWith("task-1", "ses-b", {
      includeLineage: false,
    });
  });

  it("marks parallel candidates as incomplete when fetched trace timeline is partial", async () => {
    taskState.task.status = "completed";
    taskState.task.agentRunId = undefined;
    taskState.task.executionMode = "parallel";
    taskState.task.orchestrationKind = "parallel";
    taskState.task.currentRunId = "run-trace-partial";
    setLegacyParallelRuns([
        {
          id: "run-trace-partial",
          taskId: "task-1",
          projectId: "proj-1",
          orchestrationKind: "parallel",
          triggerType: "user_execute",
          status: "completed",
          rootSessionId: "ses-root",
          createdAt: "2026-03-22T05:00:00.000Z",
          updatedAt: "2026-03-22T05:00:10.000Z",
        },
      ],);
    setLegacyParallelRunDetail({
        run: {
          id: "run-trace-partial",
          taskId: "task-1",
          projectId: "proj-1",
          orchestrationKind: "parallel",
          triggerType: "user_execute",
          status: "completed",
          rootSessionId: "ses-root",
          createdAt: "2026-03-22T05:00:00.000Z",
          updatedAt: "2026-03-22T05:00:10.000Z",
        },
        nodes: [],
        candidateNodes: [
          {
            id: "trace-partial-node-a",
            runId: "run-trace-partial",
            taskId: "task-1",
            projectId: "proj-1",
            nodeKind: "candidate",
            nodeKey: "candidate:0",
            title: "候选 A",
            candidateIndex: 0,
            agentType: "explore-enterprise",
            modelUsed: "gpt-5-mini",
            sessionId: "ses-a",
            status: "completed",
            createdAt: "2026-03-22T05:00:01.000Z",
            updatedAt: "2026-03-22T05:00:02.000Z",
          },
          {
            id: "trace-partial-node-b",
            runId: "run-trace-partial",
            taskId: "task-1",
            projectId: "proj-1",
            nodeKind: "candidate",
            nodeKey: "candidate:1",
            title: "候选 B",
            candidateIndex: 1,
            agentType: "explore-enterprise",
            modelUsed: "gpt-4o",
            sessionId: "ses-b",
            status: "completed",
            createdAt: "2026-03-22T05:00:01.000Z",
            updatedAt: "2026-03-22T05:00:02.000Z",
          },
        ],
        judgeNode: null,
        winnerCandidateIndex: 0,
      },);
    apiMocks.getTaskExecutionTraceView.mockImplementation(
      async (_taskId: string, sessionId: string) => ({
        taskId: "task-1",
        sessionId,
        segments: [],
        hookExecutions: [],
        messages: [],
        timeline: [],
        timelineMeta:
          sessionId === "ses-a"
            ? {
                readSource: "task-domain-projection",
                cacheState: "partial",
                complete: false,
              }
            : {
                readSource: "task-domain-projection",
                cacheState: "complete",
                complete: true,
              },
      }),
    );
    apiMocks.listTaskRuntimePermissions.mockResolvedValue({ data: [] });

    const wrapper = await mountPage();
    const parallelItem = wrapper
      .findAll(".chat-item")
      .find((node) => node.attributes("data-role") === "parallel");

    expect(parallelItem?.attributes("data-candidate-trace-states")).toBe("incomplete|");
  });

  it("marks reused parallel candidate trace as stale when silent refresh fails", async () => {
    vi.useFakeTimers();
    try {
      taskState.task.status = "running";
      taskState.task.agentRunId = "run-1";
      taskState.task.executionMode = "parallel";
      taskState.task.orchestrationKind = "parallel";
      taskState.task.currentRunId = "run-trace-stale";
      setLegacyParallelRuns([
          {
            id: "run-trace-stale",
            taskId: "task-1",
            projectId: "proj-1",
            orchestrationKind: "parallel",
            triggerType: "user_execute",
            status: "running",
            rootSessionId: "ses-root",
            createdAt: "2026-03-22T05:00:00.000Z",
            updatedAt: "2026-03-22T05:00:10.000Z",
          },
        ],);
      setLegacyParallelRunDetail({
          run: {
            id: "run-trace-stale",
            taskId: "task-1",
            projectId: "proj-1",
            orchestrationKind: "parallel",
            triggerType: "user_execute",
            status: "running",
            rootSessionId: "ses-root",
            createdAt: "2026-03-22T05:00:00.000Z",
            updatedAt: "2026-03-22T05:00:10.000Z",
          },
          nodes: [],
          candidateNodes: [
            {
              id: "trace-stale-node-a",
              runId: "run-trace-stale",
              taskId: "task-1",
              projectId: "proj-1",
              nodeKind: "candidate",
              nodeKey: "candidate:0",
              title: "候选 A",
              candidateIndex: 0,
              agentType: "explore-enterprise",
              modelUsed: "gpt-5-mini",
              sessionId: "ses-a",
              status: "running",
              createdAt: "2026-03-22T05:00:01.000Z",
              updatedAt: "2026-03-22T05:00:02.000Z",
            },
            {
              id: "trace-stale-node-b",
              runId: "run-trace-stale",
              taskId: "task-1",
              projectId: "proj-1",
              nodeKind: "candidate",
              nodeKey: "candidate:1",
              title: "候选 B",
              candidateIndex: 1,
              agentType: "explore-enterprise",
              modelUsed: "gpt-4o",
              sessionId: "ses-b",
              status: "running",
              createdAt: "2026-03-22T05:00:01.000Z",
              updatedAt: "2026-03-22T05:00:02.000Z",
            },
          ],
          judgeNode: null,
          winnerCandidateIndex: null,
        },);
      let silentRefreshPhase = false;
      apiMocks.getTaskExecutionTraceView.mockImplementation(
        async (_taskId: string, sessionId: string) => {
          if (silentRefreshPhase && sessionId === "ses-a") {
            throw new Error("trace refresh failed");
          }
          return {
            taskId: "task-1",
            sessionId,
            segments: [],
            hookExecutions: [],
            messages: [
              {
                id: `${sessionId}-assistant`,
                role: "assistant",
                text: `${sessionId} reply`,
                createdAt: "2026-03-22T05:00:02.000Z",
              },
            ],
            timeline: [],
            timelineMeta: {
              readSource: "task-domain-projection",
              cacheState: "complete",
              complete: true,
            },
          };
        },
      );
      apiMocks.listTaskRuntimePermissions.mockResolvedValue({ data: [] });

      const wrapper = await mountPage();
      silentRefreshPhase = true;

      await vi.advanceTimersByTimeAsync(2100);
      await flushPromises();
      await nextTick();

      const parallelItem = wrapper
        .findAll(".chat-item")
        .find((node) => node.attributes("data-role") === "parallel");

      expect(parallelItem?.attributes("data-candidate-trace-states")).toBe("stale|");
      wrapper.unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  it("loads projection-backed parallel candidates even after the task switches back to single mode", async () => {
    taskState.task.status = "completed";
    taskState.task.executionMode = "single";
    taskState.task.orchestrationKind = "parallel";
    taskState.task.currentRunId = "run-projection-1";
    setLegacyParallelRuns([
        {
          id: "run-projection-1",
          taskId: "task-1",
          projectId: "proj-1",
          orchestrationKind: "parallel",
          triggerType: "user_execute",
          status: "completed",
          rootSessionId: "ses-root",
          createdAt: "2026-03-22T05:00:00.000Z",
          updatedAt: "2026-03-22T05:00:10.000Z",
        },
      ],);
    setLegacyParallelRunDetail({
        run: {
          id: "run-projection-1",
          taskId: "task-1",
          projectId: "proj-1",
          orchestrationKind: "parallel",
          triggerType: "user_execute",
          status: "completed",
          rootSessionId: "ses-root",
          createdAt: "2026-03-22T05:00:00.000Z",
          updatedAt: "2026-03-22T05:00:10.000Z",
        },
        nodes: [],
        candidateNodes: [
          {
            id: "node-a",
            runId: "run-projection-1",
            taskId: "task-1",
            projectId: "proj-1",
            nodeKind: "candidate",
            nodeKey: "candidate:0",
            candidateIndex: 0,
            agentType: "executor",
            modelUsed: "gpt-5-mini",
            sessionId: "ses-projection-a",
            agentRunId: "run-a",
            status: "completed",
            resultSummary: "projection-a",
            createdAt: "2026-03-22T05:00:01.000Z",
            updatedAt: "2026-03-22T05:00:02.000Z",
          },
          {
            id: "node-b",
            runId: "run-projection-1",
            taskId: "task-1",
            projectId: "proj-1",
            nodeKind: "candidate",
            nodeKey: "candidate:1",
            candidateIndex: 1,
            agentType: "executor",
            modelUsed: "gpt-4o",
            sessionId: "ses-projection-b",
            agentRunId: "run-b",
            status: "completed",
            resultSummary: "projection-b",
            createdAt: "2026-03-22T05:00:01.000Z",
            updatedAt: "2026-03-22T05:00:02.000Z",
          },
        ],
        judgeNode: null,
        winnerCandidateIndex: 0,
      },);
    apiMocks.listTaskRuntimePermissions.mockResolvedValue({ data: [] });

    await mountPage();

    expect(apiMocks.getTaskExecutionTraceView).toHaveBeenCalledWith("task-1", "ses-projection-a", {
      includeLineage: false,
    });
    expect(apiMocks.getTaskExecutionTraceView).toHaveBeenCalledWith("task-1", "ses-projection-b", {
      includeLineage: false,
    });
  });

  it("prefers configured parallel candidate labels and models over stale projection metadata", async () => {
    taskState.task.status = "completed";
    taskState.task.executionMode = "single";
    taskState.task.orchestrationKind = "parallel";
    taskState.task.currentRunId = "run-projection-configured";
    taskState.task.strategy = {
      executionMode: "parallel",
      parallelCandidates: [
        { label: "候选 A", model: "gpt-5.4" },
        { label: "候选 B", model: "claude-opus-4.6" },
      ],
    };
    setLegacyParallelRuns([
        {
          id: "run-projection-configured",
          taskId: "task-1",
          projectId: "proj-1",
          orchestrationKind: "parallel",
          triggerType: "user_execute",
          status: "completed",
          rootSessionId: "ses-root",
          createdAt: "2026-03-22T05:00:00.000Z",
          updatedAt: "2026-03-22T05:00:10.000Z",
        },
      ],);
    setLegacyParallelRunDetail({
        run: {
          id: "run-projection-configured",
          taskId: "task-1",
          projectId: "proj-1",
          orchestrationKind: "parallel",
          triggerType: "user_execute",
          status: "completed",
          rootSessionId: "ses-root",
          createdAt: "2026-03-22T05:00:00.000Z",
          updatedAt: "2026-03-22T05:00:10.000Z",
        },
        nodes: [],
        candidateNodes: [
          {
            id: "node-stale-a",
            runId: "run-projection-configured",
            taskId: "task-1",
            projectId: "proj-1",
            nodeKind: "candidate",
            nodeKey: "candidate:0",
            title: "旧候选 A",
            candidateIndex: 0,
            agentType: "executor",
            modelUsed: "github-copilot:gemini-3-flash-preview",
            sessionId: "ses-projection-a",
            status: "completed",
            resultSummary: "projection-a",
            createdAt: "2026-03-22T05:00:01.000Z",
            updatedAt: "2026-03-22T05:00:02.000Z",
          },
          {
            id: "node-stale-b",
            runId: "run-projection-configured",
            taskId: "task-1",
            projectId: "proj-1",
            nodeKind: "candidate",
            nodeKey: "candidate:1",
            title: "旧候选 B",
            candidateIndex: 1,
            agentType: "executor",
            modelUsed: "gpt-4o",
            sessionId: "ses-projection-b",
            status: "completed",
            resultSummary: "projection-b",
            createdAt: "2026-03-22T05:00:01.000Z",
            updatedAt: "2026-03-22T05:00:02.000Z",
          },
        ],
        judgeNode: null,
        winnerCandidateIndex: null,
      },);
    apiMocks.getTaskExecutionTraceView.mockImplementation(
      async (_taskId: string, sessionId: string) => ({
        taskId: "task-1",
        sessionId,
        segments: [],
        hookExecutions: [],
        timeline: [],
        messages: [
          {
            id: `msg-${sessionId}`,
            role: "assistant",
            text: `result-${sessionId}`,
            createdAt: "2026-03-22T05:00:02.000Z",
          },
        ],
      }),
    );
    apiMocks.listTaskRuntimePermissions.mockResolvedValue({ data: [] });

    const wrapper = await mountPage();
    const parallelItem = wrapper
      .findAll(".chat-item")
      .find((node) => node.attributes("data-role") === "parallel");

    expect(parallelItem?.attributes("data-text")).toBe("候选 A");
    expect(parallelItem?.attributes("data-candidate-models")).toBe("gpt-5.4|claude-opus-4.6");
  });

  it("falls back to session selectedModel when parallel agent runs omit modelUsed", async () => {
    taskState.task.status = "completed";
    taskState.task.executionMode = "parallel";
    taskState.task.orchestrationKind = "parallel";
    taskState.task.currentRunId = undefined;
    taskState.task.strategy = undefined;
    branchState.flatNodes = [
      {
        id: "node-root",
        runtimeSessionId: "ses-root",
        isActive: true,
        contentText: "主线",
        branchName: "main",
      },
      {
        id: "node-a",
        runtimeSessionId: "ses-a",
        parentRuntimeSessionId: "ses-root",
        parentId: "node-root",
        isActive: false,
        contentText: "候选 A",
        branchName: "candidate-a",
      },
      {
        id: "node-b",
        runtimeSessionId: "ses-b",
        parentRuntimeSessionId: "ses-root",
        parentId: "node-root",
        isActive: false,
        contentText: "候选 B",
        branchName: "candidate-b",
      },
    ];
    branchState.selectedNode = branchState.flatNodes[0];
    apiMocks.getTaskSessions.mockResolvedValue({
      data: [
        {
          id: "ses-a",
          taskSessionId: "task-session:task-1:ses-a",
          phaseId: "phase-parallel-1",
          title: "候选 A",
          isActive: false,
          summary: null,
          parentRuntimeSessionId: "ses-root",
          winnerSessionId: null,
          executionStatus: "completed",
          sessionKind: "candidate",
          candidateIndex: 0,
          stepIndex: null,
          executionModeSnapshot: "parallel",
          selectedModel: "github-copilot:gemini-3-flash-preview",
          createdAt: "2026-03-22T05:00:01.000Z",
          updatedAt: "2026-03-22T05:00:02.000Z",
        },
        {
          id: "ses-b",
          taskSessionId: "task-session:task-1:ses-b",
          phaseId: "phase-parallel-1",
          title: "候选 B",
          isActive: false,
          summary: null,
          parentRuntimeSessionId: "ses-root",
          winnerSessionId: null,
          executionStatus: "completed",
          sessionKind: "candidate",
          candidateIndex: 1,
          stepIndex: null,
          executionModeSnapshot: "parallel",
          selectedModel: "github-copilot:gpt-4o",
          createdAt: "2026-03-22T05:00:01.500Z",
          updatedAt: "2026-03-22T05:00:02.500Z",
        },
      ],
    });
    apiMocks.getTaskAgentRuns.mockResolvedValue({
      data: [
        {
          id: "run-a",
          runId: "run-parallel-fallback",
          taskId: "task-1",
          projectId: "proj-1",
          candidateIndex: 0,
          sessionId: "ses-a",
          agentType: "executor",
          modelUsed: null,
          status: "completed",
          result: "candidate-a",
          startedAt: "2026-03-22T05:00:01.000Z",
          finishedAt: "2026-03-22T05:00:02.000Z",
        },
        {
          id: "run-b",
          runId: "run-parallel-fallback",
          taskId: "task-1",
          projectId: "proj-1",
          candidateIndex: 1,
          sessionId: "ses-b",
          agentType: "executor",
          modelUsed: null,
          status: "completed",
          result: "candidate-b",
          startedAt: "2026-03-22T05:00:01.500Z",
          finishedAt: "2026-03-22T05:00:02.500Z",
        },
      ],
    });
    setLegacyParallelRuns([]);
    apiMocks.getTaskExecutionTraceView.mockImplementation(
      async (_taskId: string, sessionId: string) => ({
        taskId: "task-1",
        sessionId,
        segments: [],
        hookExecutions: [],
        timeline: [],
        messages: [
          {
            id: `msg-${sessionId}`,
            role: "assistant",
            text: sessionId === "ses-a" ? "candidate-a" : "candidate-b",
            createdAt: "2026-03-22T05:00:03.000Z",
          },
        ],
        latestResponse: sessionId === "ses-a" ? "candidate-a" : "candidate-b",
      }),
    );
    apiMocks.listTaskRuntimePermissions.mockResolvedValue({ data: [] });

    const wrapper = await mountPage();
    const parallelItem = wrapper
      .findAll(".chat-item")
      .find((node) => node.attributes("data-role") === "parallel");

    expect(parallelItem?.attributes("data-candidate-models")).toBe(
      "github-copilot:gemini-3-flash-preview|github-copilot:gpt-4o",
    );
  });

  it("loads sequential chain steps from session messages when strategy is absent", async () => {
    taskState.task.status = "running";
    taskState.task.executionMode = "sequential-chain";
    taskState.task.orchestrationKind = "sequential-chain";
    taskState.task.strategy = undefined;
    apiMocks.getTaskAgentRuns.mockResolvedValue({ data: [] });
    apiMocks.getTaskSessions.mockResolvedValue({
      data: [
        {
          id: "ses-chain-1",
          title: "任务详情 V3 — 分析现状",
          isActive: false,
          summary: null,
          sessionKind: "sequential_step",
          stepIndex: 0,
          selectedModel: "gpt-5-mini",
          createdAt: "2026-03-22T06:00:00.000Z",
          updatedAt: "2026-03-22T06:00:02.000Z",
        },
        {
          id: "ses-chain-2",
          title: "任务详情 V3 — 设计方案",
          isActive: true,
          summary: null,
          sessionKind: "sequential_step",
          stepIndex: 1,
          selectedModel: "gpt-5",
          createdAt: "2026-03-22T06:00:03.000Z",
          updatedAt: "2026-03-22T06:00:04.000Z",
        },
      ],
    });
    apiMocks.getTaskConversationMessages.mockImplementation(
      async (_taskId: string, sessionId: string) => {
        const stepPrompt =
          sessionId === "ses-chain-1"
            ? [
                "执行任务详情页测试",
                "",
                "## 当前步骤 (1/2): 分析现状",
                "先梳理现状和约束。",
                "请只完成当前步骤的目标。完成后输出本步骤产出摘要。",
              ].join("\n")
            : [
                "执行任务详情页测试",
                "",
                "## 已完成步骤产出",
                "",
                "### 分析现状",
                "已梳理完成。",
                "",
                "## 当前步骤 (2/2): 设计方案",
                "输出模块划分和接口设计。",
                "请只完成当前步骤的目标。完成后输出本步骤产出摘要。",
              ].join("\n");

        return {
          data: [
            {
              info: {
                id: `msg-${sessionId}-user`,
                role: "user",
                time: {
                  created: "2026-03-22T06:00:00.000Z",
                },
              },
              parts: [{ type: "text", text: stepPrompt }],
            },
          ],
        };
      },
    );
    apiMocks.listTaskRuntimePermissions.mockResolvedValue({ data: [] });

    const wrapper = await mountPage();
    const modal = wrapper.get('[data-testid="execution-mode-modal"]');

    expect(modal.attributes("data-step-titles")).toBe("分析现状|设计方案");
    expect(apiMocks.getTaskConversationMessages).toHaveBeenCalledWith("task-1", "ses-chain-1", {
      includeLineage: false,
    });
    expect(apiMocks.getTaskConversationMessages).toHaveBeenCalledWith("task-1", "ses-chain-2", {
      includeLineage: false,
    });
  });

  it("renders multiple historical parallel runs directly from domain runs", async () => {
    taskState.task.status = "completed";
    taskState.task.agentRunId = undefined;
    taskState.task.executionMode = "single";
    setLegacyParallelRuns([
        {
          id: "run-old",
          taskId: "task-1",
          projectId: "proj-1",
          orchestrationKind: "parallel",
          triggerType: "user_execute",
          status: "completed",
          rootSessionId: "ses-root",
          createdAt: "2026-03-22T03:34:19.120Z",
          startedAt: "2026-03-22T03:34:19.120Z",
          finishedAt: "2026-03-22T03:34:20.000Z",
          updatedAt: "2026-03-22T03:34:20.000Z",
        },
        {
          id: "run-new",
          taskId: "task-1",
          projectId: "proj-1",
          orchestrationKind: "parallel",
          triggerType: "user_execute",
          status: "completed",
          rootSessionId: "ses-root",
          createdAt: "2026-03-22T05:25:21.950Z",
          startedAt: "2026-03-22T05:25:21.950Z",
          finishedAt: "2026-03-22T05:25:22.500Z",
          updatedAt: "2026-03-22T05:25:22.500Z",
        },
      ],);
    setLegacyParallelRunDetailImplementation(async (_taskId: string, runId: string) => {
      if (runId === "run-old") {
        return {
          data: {
            run: {
              id: "run-old",
              taskId: "task-1",
              projectId: "proj-1",
              orchestrationKind: "parallel",
              triggerType: "user_execute",
              status: "completed",
              rootSessionId: "ses-root",
              createdAt: "2026-03-22T03:34:19.120Z",
              updatedAt: "2026-03-22T03:34:20.000Z",
            },
            nodes: [],
            candidateNodes: [
              {
                id: "run-old-node-a",
                runId: "run-old",
                taskId: "task-1",
                projectId: "proj-1",
                nodeKind: "candidate",
                nodeKey: "candidate:0",
                title: "最早候选 A",
                candidateIndex: 0,
                agentType: "explore-enterprise",
                modelUsed: "gpt-5-mini",
                sessionId: "ses-old-a",
                status: "completed",
                createdAt: "2026-03-22T03:34:19.120Z",
                updatedAt: "2026-03-22T03:34:20.000Z",
              },
              {
                id: "run-old-node-b",
                runId: "run-old",
                taskId: "task-1",
                projectId: "proj-1",
                nodeKind: "candidate",
                nodeKey: "candidate:1",
                title: "最早候选 B",
                candidateIndex: 1,
                agentType: "explore-enterprise",
                modelUsed: "gpt-4o",
                sessionId: "ses-old-b",
                status: "completed",
                createdAt: "2026-03-22T03:34:19.120Z",
                updatedAt: "2026-03-22T03:34:20.000Z",
              },
            ],
            judgeNode: null,
            winnerCandidateIndex: 1,
          },
        };
      }

      return {
        data: {
          run: {
            id: "run-new",
            taskId: "task-1",
            projectId: "proj-1",
            orchestrationKind: "parallel",
            triggerType: "user_execute",
            status: "completed",
            rootSessionId: "ses-root",
            createdAt: "2026-03-22T05:25:21.950Z",
            updatedAt: "2026-03-22T05:25:22.500Z",
          },
          nodes: [],
          candidateNodes: [
            {
              id: "run-new-node-a",
              runId: "run-new",
              taskId: "task-1",
              projectId: "proj-1",
              nodeKind: "candidate",
              nodeKey: "candidate:0",
              title: "较新候选 A",
              candidateIndex: 0,
              agentType: "explore-enterprise",
              modelUsed: "gpt-5-mini",
              sessionId: "ses-new-a",
              status: "completed",
              createdAt: "2026-03-22T05:25:21.950Z",
              updatedAt: "2026-03-22T05:25:22.500Z",
            },
            {
              id: "run-new-node-b",
              runId: "run-new",
              taskId: "task-1",
              projectId: "proj-1",
              nodeKind: "candidate",
              nodeKey: "candidate:1",
              title: "较新候选 B",
              candidateIndex: 1,
              agentType: "explore-enterprise",
              modelUsed: "gpt-4o",
              sessionId: "ses-new-b",
              status: "completed",
              createdAt: "2026-03-22T05:25:21.950Z",
              updatedAt: "2026-03-22T05:25:22.500Z",
            },
          ],
          judgeNode: null,
          winnerCandidateIndex: 0,
        },
      };
    });
    messagesState.conversationItems = [
      {
        key: "user-old",
        role: "user",
        text: "最早那次并行",
        createdAt: "2026-03-22T03:34:19.100Z",
        toolCalls: [],
        raw: null,
      },
      {
        key: "user-new",
        role: "user",
        text: "后面这次并行",
        createdAt: "2026-03-22T05:25:21.900Z",
        toolCalls: [],
        raw: null,
      },
      {
        key: "assistant-mainline",
        role: "assistant",
        text: "主线采纳结果",
        createdAt: "2026-03-22T05:25:23.000Z",
        toolCalls: [],
        raw: null,
      },
    ];
    apiMocks.listTaskRuntimePermissions.mockResolvedValue({ data: [] });
    apiMocks.getTaskExecutionTraceView.mockImplementation(
      async (_taskId: string, sessionId: string) => ({
        taskId: "task-1",
        sessionId,
        segments: [],
        hookExecutions: [],
        timeline: [],
        messages: [
          {
            id: `assistant-${sessionId}`,
            role: "assistant",
            text: `reply-${sessionId}`,
            createdAt: sessionId.includes("old")
              ? "2026-03-22T03:34:19.200Z"
              : "2026-03-22T05:25:22.100Z",
          },
        ],
      }),
    );

    const wrapper = await mountPage();
    const parallelItems = wrapper
      .findAll(".chat-item")
      .filter((node) => node.attributes("data-role") === "parallel");

    expect(parallelItems).toHaveLength(2);
    expect(parallelItems[0]?.attributes("data-text")).toBe("最早候选 A");
    expect(parallelItems[1]?.attributes("data-text")).toBe("较新候选 A");
    expect(apiMocks.getTaskExecutionTraceView).toHaveBeenCalledWith("task-1", "ses-old-a", {
      includeLineage: false,
    });
    expect(apiMocks.getTaskExecutionTraceView).toHaveBeenCalledWith("task-1", "ses-old-b", {
      includeLineage: false,
    });
    expect(apiMocks.getTaskExecutionTraceView).toHaveBeenCalledWith("task-1", "ses-new-a", {
      includeLineage: false,
    });
    expect(apiMocks.getTaskExecutionTraceView).toHaveBeenCalledWith("task-1", "ses-new-b", {
      includeLineage: false,
    });
  });

  it("scopes visible parallel runs to the selected session context", async () => {
    taskState.task.status = "completed";
    taskState.task.agentRunId = undefined;
    taskState.task.executionMode = "single";
    taskState.task.sessionId = "ses-new-root";
    branchState.flatNodes = [
      {
        id: "node-old-root",
        runtimeSessionId: "ses-old-root",
        isActive: false,
        contentText: "旧主线",
        branchName: "old-main",
      },
      {
        id: "node-new-root",
        runtimeSessionId: "ses-new-root",
        isActive: true,
        contentText: "新主线",
        branchName: "new-main",
      },
    ];
    branchState.selectedNode = branchState.flatNodes[0] as typeof branchState.selectedNode;
    setLegacyParallelRuns([
        {
          id: "run-old",
          taskId: "task-1",
          projectId: "proj-1",
          orchestrationKind: "parallel",
          triggerType: "user_execute",
          status: "completed",
          rootSessionId: "ses-old-root",
          createdAt: "2026-03-22T03:34:19.120Z",
          startedAt: "2026-03-22T03:34:19.120Z",
          finishedAt: "2026-03-22T03:34:20.000Z",
          updatedAt: "2026-03-22T03:34:20.000Z",
        },
        {
          id: "run-new",
          taskId: "task-1",
          projectId: "proj-1",
          orchestrationKind: "parallel",
          triggerType: "user_execute",
          status: "completed",
          rootSessionId: "ses-new-root",
          createdAt: "2026-03-22T05:25:21.950Z",
          startedAt: "2026-03-22T05:25:21.950Z",
          finishedAt: "2026-03-22T05:25:22.500Z",
          updatedAt: "2026-03-22T05:25:22.500Z",
        },
      ],);
    setLegacyParallelRunDetailImplementation(async (_taskId: string, runId: string) => {
      if (runId === "run-old") {
        return {
          data: {
            run: {
              id: "run-old",
              taskId: "task-1",
              projectId: "proj-1",
              orchestrationKind: "parallel",
              triggerType: "user_execute",
              status: "completed",
              rootSessionId: "ses-old-root",
              createdAt: "2026-03-22T03:34:19.120Z",
              updatedAt: "2026-03-22T03:34:20.000Z",
            },
            nodes: [],
            candidateNodes: [
              {
                id: "run-old-node-a",
                runId: "run-old",
                taskId: "task-1",
                projectId: "proj-1",
                nodeKind: "candidate",
                nodeKey: "candidate:0",
                title: "旧轮候选 A",
                candidateIndex: 0,
                agentType: "explore-enterprise",
                modelUsed: "gpt-5-mini",
                sessionId: "ses-old-a",
                status: "completed",
                createdAt: "2026-03-22T03:34:19.120Z",
                updatedAt: "2026-03-22T03:34:20.000Z",
              },
              {
                id: "run-old-node-b",
                runId: "run-old",
                taskId: "task-1",
                projectId: "proj-1",
                nodeKind: "candidate",
                nodeKey: "candidate:1",
                title: "旧轮候选 B",
                candidateIndex: 1,
                agentType: "explore-enterprise",
                modelUsed: "gpt-4o",
                sessionId: "ses-old-b",
                status: "completed",
                createdAt: "2026-03-22T03:34:19.120Z",
                updatedAt: "2026-03-22T03:34:20.000Z",
              },
            ],
            judgeNode: null,
            winnerCandidateIndex: 0,
          },
        };
      }

      return {
        data: {
          run: {
            id: "run-new",
            taskId: "task-1",
            projectId: "proj-1",
            orchestrationKind: "parallel",
            triggerType: "user_execute",
            status: "completed",
            rootSessionId: "ses-new-root",
            createdAt: "2026-03-22T05:25:21.950Z",
            updatedAt: "2026-03-22T05:25:22.500Z",
          },
          nodes: [],
          candidateNodes: [
            {
              id: "run-new-node-a",
              runId: "run-new",
              taskId: "task-1",
              projectId: "proj-1",
              nodeKind: "candidate",
              nodeKey: "candidate:0",
              title: "新轮候选 A",
              candidateIndex: 0,
              agentType: "explore-enterprise",
              modelUsed: "gpt-5-mini",
              sessionId: "ses-new-a",
              status: "completed",
              createdAt: "2026-03-22T05:25:21.950Z",
              updatedAt: "2026-03-22T05:25:22.500Z",
            },
            {
              id: "run-new-node-b",
              runId: "run-new",
              taskId: "task-1",
              projectId: "proj-1",
              nodeKind: "candidate",
              nodeKey: "candidate:1",
              title: "新轮候选 B",
              candidateIndex: 1,
              agentType: "explore-enterprise",
              modelUsed: "gpt-4o",
              sessionId: "ses-new-b",
              status: "completed",
              createdAt: "2026-03-22T05:25:21.950Z",
              updatedAt: "2026-03-22T05:25:22.500Z",
            },
          ],
          judgeNode: null,
          winnerCandidateIndex: 0,
        },
      };
    });
    messagesState.conversationItems = [
      {
        key: "user-old",
        role: "user",
        text: "旧轮提问",
        createdAt: "2026-03-22T03:34:19.100Z",
        toolCalls: [],
        raw: null,
      },
      {
        key: "user-new",
        role: "user",
        text: "新轮提问",
        createdAt: "2026-03-22T05:25:21.900Z",
        toolCalls: [],
        raw: null,
      },
    ];
    apiMocks.listTaskRuntimePermissions.mockResolvedValue({ data: [] });
    apiMocks.getTaskExecutionTraceView.mockImplementation(
      async (_taskId: string, sessionId: string) => ({
        taskId: "task-1",
        sessionId,
        segments: [],
        hookExecutions: [],
        timeline: [],
        messages: [
          {
            id: `assistant-${sessionId}`,
            role: "assistant",
            text: `reply-${sessionId}`,
            createdAt: sessionId.includes("old")
              ? "2026-03-22T03:34:19.200Z"
              : "2026-03-22T05:25:22.100Z",
          },
        ],
      }),
    );

    const wrapper = await mountPage();
    const parallelItems = wrapper
      .findAll(".chat-item")
      .filter((node) => node.attributes("data-role") === "parallel");

    expect(parallelItems).toHaveLength(1);
    expect(parallelItems[0]?.attributes("data-text")).toBe("旧轮候选 A");
    expect(
      wrapper.get('[data-testid="chat-message-list-meta"]').attributes("data-session-id"),
    ).toBe("ses-old-root");
    expect(apiMocks.getTaskExecutionTraceView).toHaveBeenCalledWith("task-1", "ses-old-a", {
      includeLineage: false,
    });
    expect(apiMocks.getTaskExecutionTraceView).toHaveBeenCalledWith("task-1", "ses-old-b", {
      includeLineage: false,
    });
  });

  it("treats stale running candidates as completed once the parent task has finished", async () => {
    taskState.task.status = "completed";
    taskState.task.agentRunId = undefined;
    taskState.task.executionMode = "parallel";
    taskState.task.orchestrationKind = "parallel";
    taskState.task.currentRunId = "run-live-1";
    setLegacyParallelRuns([
        {
          id: "run-live-1",
          taskId: "task-1",
          projectId: "proj-1",
          orchestrationKind: "parallel",
          triggerType: "user_execute",
          status: "completed",
          rootSessionId: "ses-root",
          createdAt: "2026-03-22T05:25:21.900Z",
          updatedAt: "2026-03-22T05:25:21.980Z",
        },
      ],);
    setLegacyParallelRunDetail({
        run: {
          id: "run-live-1",
          taskId: "task-1",
          projectId: "proj-1",
          orchestrationKind: "parallel",
          triggerType: "user_execute",
          status: "completed",
          rootSessionId: "ses-root",
          createdAt: "2026-03-22T05:25:21.900Z",
          updatedAt: "2026-03-22T05:25:21.980Z",
        },
        nodes: [],
        candidateNodes: [
          {
            id: "live-node-a",
            runId: "run-live-1",
            taskId: "task-1",
            projectId: "proj-1",
            nodeKind: "candidate",
            nodeKey: "candidate:0",
            title: "候选 A",
            candidateIndex: 0,
            agentType: "executor",
            modelUsed: "gpt-5-mini",
            sessionId: "ses-a",
            status: "running",
            createdAt: "2026-03-22T05:25:21.966Z",
            updatedAt: "2026-03-22T05:25:21.970Z",
          },
          {
            id: "live-node-b",
            runId: "run-live-1",
            taskId: "task-1",
            projectId: "proj-1",
            nodeKind: "candidate",
            nodeKey: "candidate:1",
            title: "候选 B",
            candidateIndex: 1,
            agentType: "executor",
            modelUsed: "gpt-4o",
            sessionId: "ses-b",
            status: "completed",
            createdAt: "2026-03-22T05:25:21.977Z",
            updatedAt: "2026-03-22T05:25:21.980Z",
          },
        ],
        judgeNode: null,
        winnerCandidateIndex: null,
      },);
    apiMocks.listTaskRuntimePermissions.mockResolvedValue({ data: [] });
    apiMocks.getTaskExecutionTraceView.mockImplementation(
      async (_taskId: string, sessionId: string) => ({
        taskId: "task-1",
        sessionId,
        segments: [],
        hookExecutions: [],
        timeline: [],
        messages:
          sessionId === "ses-a"
            ? [
                {
                  id: "msg-user-a",
                  role: "user",
                  text: "并行请求",
                  createdAt: "2026-03-22T05:25:21.966Z",
                },
                {
                  id: "msg-assistant-a",
                  role: "assistant",
                  text: "候选 A 已经返回",
                  createdAt: "2026-03-22T05:25:21.970Z",
                },
              ]
            : [
                {
                  id: "msg-user-b",
                  role: "user",
                  text: "并行请求",
                  createdAt: "2026-03-22T05:25:21.977Z",
                },
                {
                  id: "msg-assistant-b",
                  role: "assistant",
                  text: "候选 B 已经返回",
                  createdAt: "2026-03-22T05:25:21.980Z",
                },
              ],
      }),
    );

    const wrapper = await mountPage();
    const parallelItem = wrapper
      .findAll(".chat-item")
      .find((node) => node.attributes("data-role") === "parallel");

    expect(parallelItem?.attributes("data-candidate-statuses")).toBe("completed|completed");
  });

  it("does not treat a stale single task as actively executing when no projection-backed parallel run exists", async () => {
    taskState.task.status = "running";
    taskState.task.finishedAt = "2026-03-22T10:10:00.000Z";
    taskState.task.executionMode = "single";
    messagesState.conversationItems = [
      {
        key: "user-single",
        role: "user",
        text: "现在单次执行",
        createdAt: "2026-03-22T11:00:00.000Z",
        toolCalls: [],
        raw: null,
      },
      {
        key: "assistant-single",
        role: "assistant",
        text: "这是单次执行回复",
        createdAt: "2026-03-22T11:00:30.000Z",
        toolCalls: [],
        raw: null,
      },
    ];
    apiMocks.listTaskRuntimePermissions.mockResolvedValue({ data: [] });

    const wrapper = await mountPage();
    const composer = wrapper.get('[data-testid="chat-composer"]');
    const renderedItems = wrapper.findAll(".chat-item").map((node) => ({
      role: node.attributes("data-role"),
      text: node.attributes("data-text"),
    }));

    expect(composer.attributes("data-is-executing")).toBe("false");
    expect(renderedItems).toEqual([
      { role: "user", text: "现在单次执行" },
      { role: "assistant", text: "这是单次执行回复" },
    ]);
  });

  it("renders current parallel comparison from session tree when domain runs are unavailable", async () => {
    taskState.task.status = "running";
    taskState.task.executionMode = "parallel";
    taskState.task.orchestrationKind = "parallel";
    taskState.task.strategy = {
      executionMode: "parallel",
      parallelCandidates: [
        { label: "候选 A", model: "gpt-5.4" },
        { label: "候选 B", model: "claude-opus-4.6" },
      ],
    } as unknown as string;
    branchState.flatNodes = [
      {
        id: "node-session-root",
        parentId: "node-task-1",
        runtimeSessionId: "ses-1",
        isActive: true,
        contentText: "主分支",
        branchName: "main",
        createdAt: "2026-03-22T09:59:59.000Z",
      },
      {
        id: "node-session-a",
        parentId: "node-session-root",
        runtimeSessionId: "ses-a",
        isActive: true,
        contentText: "候选 A",
        branchName: "candidate-a",
        createdAt: "2026-03-22T10:00:01.000Z",
      },
      {
        id: "node-session-b",
        parentId: "node-session-root",
        runtimeSessionId: "ses-b",
        isActive: true,
        contentText: "候选 B",
        branchName: "candidate-b",
        createdAt: "2026-03-22T10:00:02.000Z",
      },
    ];
    branchState.selectedNode = branchState.flatNodes[0];
    setLegacyParallelRuns([]);
    apiMocks.getTaskExecutionTraceView.mockImplementation(
      async (_taskId: string, sessionId: string) => ({
        taskId: "task-1",
        sessionId,
        segments: [],
        hookExecutions: [],
        timeline: [],
        messages: [
          {
            id: `assistant-${sessionId}`,
            role: "assistant",
            text: `reply-${sessionId}`,
            createdAt: "2026-03-22T10:00:10.000Z",
          },
        ],
        latestResponse: `reply-${sessionId}`,
      }),
    );
    apiMocks.listTaskRuntimePermissions.mockResolvedValue({ data: [] });

    const wrapper = await mountPage();
    const renderedItems = wrapper.findAll(".chat-item").map((node) => ({
      role: node.attributes("data-role"),
      text: node.attributes("data-text"),
      canAdopt: node.attributes("data-candidate-can-adopt"),
      models: node.attributes("data-candidate-models"),
    }));

    expect(apiMocks.getTaskExecutionTraceView).toHaveBeenCalledWith("task-1", "ses-a", {
      includeLineage: false,
    });
    expect(apiMocks.getTaskExecutionTraceView).toHaveBeenCalledWith("task-1", "ses-b", {
      includeLineage: false,
    });
    expect(renderedItems).toContainEqual(
      expect.objectContaining({
        role: "parallel",
        text: "候选 A",
        canAdopt: "true|true",
        models: "gpt-5.4|claude-opus-4.6",
      }),
    );
  });

  it("falls back to session messages when candidate execution trace has no displayable reply", async () => {
    taskState.task.status = "running";
    taskState.task.executionMode = "parallel";
    taskState.task.orchestrationKind = "parallel";
    taskState.task.strategy = {
      executionMode: "parallel",
      parallelCandidates: [
        { label: "候选 A", model: "gpt-5.4" },
        { label: "候选 B", model: "claude-opus-4.6" },
      ],
    } as unknown as string;
    branchState.flatNodes = [
      {
        id: "node-session-root",
        parentId: "node-task-1",
        runtimeSessionId: "ses-1",
        isActive: true,
        contentText: "主分支",
        branchName: "main",
        createdAt: "2026-03-22T09:59:59.000Z",
      },
      {
        id: "node-session-a",
        parentId: "node-session-root",
        runtimeSessionId: "ses-a",
        isActive: true,
        contentText: "候选 A",
        branchName: "candidate-a",
        createdAt: "2026-03-22T10:00:01.000Z",
      },
      {
        id: "node-session-b",
        parentId: "node-session-root",
        runtimeSessionId: "ses-b",
        isActive: true,
        contentText: "候选 B",
        branchName: "candidate-b",
        createdAt: "2026-03-22T10:00:02.000Z",
      },
    ];
    branchState.selectedNode = branchState.flatNodes[0];
    setLegacyParallelRuns([]);
    apiMocks.getTaskExecutionTraceView.mockImplementation(
      async (_taskId: string, sessionId: string) => {
        if (sessionId === "ses-a") {
          return {
            taskId: "task-1",
            sessionId,
            segments: [],
            hookExecutions: [],
            timeline: [],
            messages: [
              {
                id: "msg-user-a",
                role: "user",
                text: "并行请求",
                createdAt: "2026-03-22T10:00:01.000Z",
              },
            ],
            timelineMeta: {
              cacheState: "partial",
            },
            latestResponse: null,
          };
        }

        return {
          taskId: "task-1",
          sessionId,
          segments: [],
          hookExecutions: [],
          timeline: [],
          messages: [
            {
              id: "msg-assistant-b",
              role: "assistant",
              text: "候选 B 直接来自执行追踪",
              createdAt: "2026-03-22T10:00:10.000Z",
            },
          ],
          latestResponse: "候选 B 直接来自执行追踪",
        };
      },
    );
    apiMocks.getTaskConversationMessages.mockImplementation(
      async (_taskId: string, sessionId: string) => {
        if (sessionId === "ses-a") {
          return {
            data: [
              {
                info: {
                  id: "msg-user-a",
                  role: "user",
                  time: { created: "2026-03-22T10:00:01.000Z" },
                },
                parts: [{ type: "text", text: "并行请求" }],
              },
              {
                info: {
                  id: "msg-assistant-a",
                  role: "assistant",
                  time: { created: "2026-03-22T10:00:08.000Z" },
                },
                parts: [{ type: "text", text: "候选 A 已回退到会话消息" }],
              },
            ],
          };
        }

        return { data: [] };
      },
    );
    apiMocks.listTaskRuntimePermissions.mockResolvedValue({ data: [] });

    const wrapper = await mountPage();
    const parallelItem = wrapper
      .findAll(".chat-item")
      .find((node) => node.attributes("data-role") === "parallel");

    expect(apiMocks.getTaskConversationMessages).toHaveBeenCalledWith("task-1", "ses-a", {
      includeLineage: false,
    });
    expect(parallelItem?.attributes("data-candidate-statuses")).toBe("completed|completed");
    expect(parallelItem?.attributes("data-candidate-trace-states")).toBe("incomplete|");
    expect(parallelItem?.text()).toContain("候选 A 已回退到会话消息");
    expect(parallelItem?.text()).toContain("候选 B 直接来自执行追踪");
  });

  it("uses session fallback as the display source even when candidate traces already have replies", async () => {
    taskState.task.status = "running";
    taskState.task.executionMode = "parallel";
    taskState.task.orchestrationKind = "parallel";
    taskState.task.strategy = {
      executionMode: "parallel",
      parallelCandidates: [
        { label: "候选 A", model: "gpt-5.4" },
        { label: "候选 B", model: "claude-opus-4.6" },
      ],
    } as unknown as string;
    branchState.flatNodes = [
      {
        id: "node-session-root",
        parentId: "node-task-1",
        runtimeSessionId: "ses-1",
        isActive: true,
        contentText: "主分支",
        branchName: "main",
        createdAt: "2026-03-22T09:59:59.000Z",
      },
      {
        id: "node-session-a",
        parentId: "node-session-root",
        runtimeSessionId: "ses-a",
        isActive: true,
        contentText: "候选 A",
        branchName: "candidate-a",
        createdAt: "2026-03-22T10:00:01.000Z",
      },
      {
        id: "node-session-b",
        parentId: "node-session-root",
        runtimeSessionId: "ses-b",
        isActive: true,
        contentText: "候选 B",
        branchName: "candidate-b",
        createdAt: "2026-03-22T10:00:02.000Z",
      },
    ];
    branchState.selectedNode = branchState.flatNodes[0];
    setLegacyParallelRuns([]);
    apiMocks.getTaskExecutionTraceView.mockImplementation(
      async (_taskId: string, sessionId: string) => ({
        taskId: "task-1",
        sessionId,
        segments: [],
        hookExecutions: [],
        timeline: [
          {
            id: `msg-trace-${sessionId}`,
            role: "assistant",
            text: sessionId === "ses-a" ? "trace-候选 A" : "trace-候选 B",
            agent: sessionId === "ses-a" ? "candidate" : undefined,
            createdAt: "2026-03-22T10:00:10.000Z",
          },
        ],
        messages: [
          {
            id: `msg-trace-${sessionId}`,
            role: "assistant",
            text: sessionId === "ses-a" ? "trace-候选 A" : "trace-候选 B",
            agent: sessionId === "ses-a" ? "candidate" : undefined,
            createdAt: "2026-03-22T10:00:10.000Z",
          },
        ],
        latestResponse: sessionId === "ses-a" ? "trace-候选 A" : "trace-候选 B",
      }),
    );
    apiMocks.getTaskConversationMessages.mockImplementation(
      async (_taskId: string, sessionId: string) => ({
        data: [
          {
            info: {
              id: `msg-user-${sessionId}`,
              role: "user",
              time: { created: "2026-03-22T10:00:01.000Z" },
            },
            parts: [{ type: "text", text: "做并行比较" }],
          },
          {
            info: {
              id: `msg-session-${sessionId}`,
              role: "assistant",
              time: { created: "2026-03-22T10:00:12.000Z" },
            },
            parts: [
              {
                type: "text",
                text: sessionId === "ses-a" ? "session-候选 A" : "session-候选 B",
              },
            ],
          },
        ],
      }),
    );
    apiMocks.listTaskRuntimePermissions.mockResolvedValue({ data: [] });

    const wrapper = await mountPage();
    const parallelItem = wrapper
      .findAll(".chat-item")
      .find((node) => node.attributes("data-role") === "parallel");

    expect(apiMocks.getTaskConversationMessages).toHaveBeenCalledWith("task-1", "ses-a", {
      includeLineage: false,
    });
    expect(apiMocks.getTaskConversationMessages).toHaveBeenCalledWith("task-1", "ses-b", {
      includeLineage: false,
    });
    expect(parallelItem?.text()).toContain("session-候选 A");
    expect(parallelItem?.text()).toContain("session-候选 B");
    expect(parallelItem?.text()).not.toContain("trace-候选 A");
    expect(parallelItem?.text()).not.toContain("trace-候选 B");
    expect(parallelItem?.attributes("data-candidate-agents")).toBe("|");
  });

  it("renders ordered phase blocks from snapshot phase slices instead of a single flat message list", async () => {
    taskState.task.status = "completed";
    taskState.task.executionMode = "single";
    messagesState.conversationItems = [
      {
        key: "flat-user",
        role: "user",
        text: "旧扁平消息",
        createdAt: "2026-03-22T08:59:00.000Z",
        toolCalls: [],
        raw: null,
      },
    ];
    messagesState.phaseSlices = [
      {
        phase: {
          id: "phase-2",
          phaseIndex: 2,
          phaseKind: "single",
          triggerType: "continue",
          status: "completed",
          startedAt: "2026-03-22T09:10:00.000Z",
        },
        sourceMessages: [
          {
            id: "phase-2-user",
            role: "user",
            text: "第二阶段问题",
            createdAt: "2026-03-22T09:10:01.000Z",
          },
        ],
        resolvedSessionId: "ses-phase-2",
      },
      {
        phase: {
          id: "phase-1",
          phaseIndex: 1,
          phaseKind: "single",
          triggerType: "execute",
          status: "completed",
          startedAt: "2026-03-22T09:00:00.000Z",
        },
        sourceMessages: [
          {
            id: "phase-1-user",
            role: "user",
            text: "第一阶段问题",
            createdAt: "2026-03-22T09:00:01.000Z",
          },
          {
            id: "phase-1-assistant",
            role: "assistant",
            text: "第一阶段回复",
            createdAt: "2026-03-22T09:00:02.000Z",
          },
        ],
        resolvedSessionId: "ses-phase-1",
      },
    ];
    apiMocks.listTaskRuntimePermissions.mockResolvedValue({ data: [] });

    const wrapper = await mountPage();
    const blocks = wrapper.findAll(".task-detail-v3-phase-block");
    const phaseBlockList = wrapper.find('[data-testid="phase-block-list"]');
    const messageLists = wrapper.findAll('[data-testid="chat-message-list"]');
    const renderedItems = wrapper.findAll(".phase-block-item").map((node) => ({
      role: node.attributes("data-role"),
      text: node.attributes("data-text"),
    }));

    expect(phaseBlockList.exists()).toBe(true);
    expect(blocks).toHaveLength(2);
    expect(blocks[0]?.attributes("data-phase-index")).toBe("1");
    expect(blocks[0]?.attributes("data-phase-id")).toBe("phase-1");
    expect(blocks[1]?.attributes("data-phase-index")).toBe("2");
    expect(blocks[1]?.attributes("data-phase-id")).toBe("phase-2");
    expect(messageLists).toHaveLength(0);
    expect(renderedItems).toEqual([
      { role: "user", text: "第一阶段问题" },
      { role: "assistant", text: "第一阶段回复" },
      { role: "user", text: "第二阶段问题" },
    ]);
    expect(renderedItems.some((item) => item.text === "旧扁平消息")).toBe(false);
  });

  it("includes current live assistant items inside the current phase block", async () => {
    taskState.task.status = "running";
    branchState.currentPhaseId = "phase-2";
    messagesState.phaseSlices = [
      {
        phase: {
          id: "phase-1",
          phaseIndex: 1,
          phaseKind: "single",
          triggerType: "execute",
          status: "completed",
          startedAt: "2026-03-22T09:00:00.000Z",
        },
        sourceMessages: [
          {
            id: "phase-1-user",
            role: "user",
            text: "第一阶段问题",
            createdAt: "2026-03-22T09:00:01.000Z",
          },
        ],
        resolvedSessionId: "ses-phase-1",
      },
      {
        phase: {
          id: "phase-2",
          phaseIndex: 2,
          phaseKind: "single",
          triggerType: "continue",
          status: "running",
          startedAt: "2026-03-22T09:10:00.000Z",
        },
        sourceMessages: [
          {
            id: "phase-2-user",
            role: "user",
            text: "第二阶段问题",
            createdAt: "2026-03-22T09:10:01.000Z",
          },
        ],
        resolvedSessionId: "ses-phase-2",
      },
    ];
    messagesState.conversationItems = [
      {
        key: "phase-1-user",
        role: "user",
        text: "第一阶段问题",
        createdAt: "2026-03-22T09:00:01.000Z",
        toolCalls: [],
        raw: null,
      },
      {
        key: "phase-2-user",
        role: "user",
        text: "第二阶段问题",
        createdAt: "2026-03-22T09:10:01.000Z",
        toolCalls: [],
        raw: null,
      },
      {
        key: "pending-assistant:ses-phase-2:2026-03-22T09:10:02.000Z",
        role: "assistant",
        text: "正在生成...",
        createdAt: "2026-03-22T09:10:02.000Z",
        toolCalls: [],
        raw: null,
        isStreaming: true,
      },
    ];
    apiMocks.listTaskRuntimePermissions.mockResolvedValue({ data: [] });

    const wrapper = await mountPage();
    const phaseTwoItems = wrapper
      .findAll('.task-detail-v3-phase-block[data-phase-id="phase-2"] .phase-block-item')
      .map((node) => ({
        role: node.attributes("data-role"),
        text: node.attributes("data-text"),
      }));

    expect(phaseTwoItems).toEqual([
      { role: "user", text: "第二阶段问题" },
      { role: "assistant", text: "正在生成..." },
    ]);
  });

  it("derives the adopted fallback candidate from task session summaries", async () => {
    taskState.task.status = "running";
    taskState.task.executionMode = "parallel";
    taskState.task.orchestrationKind = "parallel";
    taskState.task.strategy = {
      executionMode: "parallel",
      parallelCandidates: [
        { label: "候选 A", model: "gpt-5.4" },
        { label: "候选 B", model: "claude-opus-4.6" },
      ],
    } as unknown as string;
    branchState.flatNodes = [
      {
        id: "node-session-root",
        parentId: "node-task-1",
        runtimeSessionId: "ses-1",
        isActive: true,
        contentText: "主分支",
        branchName: "main",
        createdAt: "2026-03-22T09:59:59.000Z",
      },
      {
        id: "node-session-a",
        parentId: "node-session-root",
        runtimeSessionId: "ses-a",
        isActive: true,
        contentText: "候选 A",
        branchName: "candidate-a",
        createdAt: "2026-03-22T10:00:01.000Z",
      },
      {
        id: "node-session-b",
        parentId: "node-session-root",
        runtimeSessionId: "ses-b",
        isActive: true,
        contentText: "候选 B",
        branchName: "candidate-b",
        createdAt: "2026-03-22T10:00:02.000Z",
      },
    ];
    branchState.selectedNode = branchState.flatNodes[0];
    setLegacyParallelRuns([]);
    apiMocks.getTaskSessions.mockResolvedValue({
      data: [
        {
          id: "ses-a",
          title: "候选 A",
          isActive: false,
          summary: null,
          coordinationKey: "group-1",
          winnerSessionId: "ses-b",
          createdAt: "2026-03-22T10:00:01.000Z",
          updatedAt: "2026-03-22T10:00:12.000Z",
        },
        {
          id: "ses-b",
          title: "候选 B",
          isActive: true,
          summary: null,
          coordinationKey: "group-1",
          winnerSessionId: "ses-b",
          createdAt: "2026-03-22T10:00:02.000Z",
          updatedAt: "2026-03-22T10:00:13.000Z",
        },
      ],
    });
    apiMocks.getTaskExecutionTraceView.mockImplementation(
      async (_taskId: string, sessionId: string) => ({
        taskId: "task-1",
        sessionId,
        segments: [],
        hookExecutions: [],
        timeline: [],
        messages: [
          {
            id: `assistant-${sessionId}`,
            role: "assistant",
            text: `reply-${sessionId}`,
            createdAt: "2026-03-22T10:00:10.000Z",
          },
        ],
        latestResponse: `reply-${sessionId}`,
      }),
    );
    apiMocks.listTaskRuntimePermissions.mockResolvedValue({ data: [] });

    const wrapper = await mountPage();
    const parallelItem = wrapper
      .findAll(".chat-item")
      .find((node) => node.attributes("data-role") === "parallel");

    expect(
      wrapper.get('[data-testid="chat-message-list-meta"]').attributes("data-session-id"),
    ).toBe("ses-b");
    expect(parallelItem?.attributes("data-candidate-can-adopt")).toBe("false|false");
  });

  it("keeps current session-tree parallel comparison visible even when historical projection runs already exist", async () => {
    taskState.task.status = "running";
    taskState.task.executionMode = "parallel";
    taskState.task.orchestrationKind = "parallel";
    taskState.task.currentRunId = "run-current-missing";
    taskState.task.strategy = {
      executionMode: "parallel",
      parallelCandidates: [
        { label: "候选 A", model: "gpt-5.4" },
        { label: "候选 B", model: "claude-opus-4.6" },
      ],
    } as unknown as string;
    branchState.flatNodes = [
      {
        id: "node-session-root",
        parentId: "node-task-1",
        runtimeSessionId: "ses-1",
        isActive: true,
        contentText: "主分支",
        branchName: "main",
        createdAt: "2026-03-22T09:59:59.000Z",
      },
      {
        id: "node-session-a",
        parentId: "node-session-root",
        runtimeSessionId: "ses-a",
        isActive: true,
        contentText: "候选 A",
        branchName: "candidate-a",
        createdAt: "2026-03-22T10:10:01.000Z",
      },
      {
        id: "node-session-b",
        parentId: "node-session-root",
        runtimeSessionId: "ses-b",
        isActive: true,
        contentText: "候选 B",
        branchName: "candidate-b",
        createdAt: "2026-03-22T10:10:02.000Z",
      },
    ];
    branchState.selectedNode = branchState.flatNodes[0];
    setLegacyParallelRuns([
        {
          id: "run-history-1",
          taskId: "task-1",
          projectId: "proj-1",
          orchestrationKind: "parallel",
          triggerType: "user_execute",
          status: "completed",
          rootSessionId: "ses-root-history",
          createdAt: "2026-03-22T09:00:00.000Z",
          startedAt: "2026-03-22T09:00:00.000Z",
          finishedAt: "2026-03-22T09:00:20.000Z",
          updatedAt: "2026-03-22T09:00:20.000Z",
        },
      ],);
    setLegacyParallelRunDetail({
        run: {
          id: "run-history-1",
          taskId: "task-1",
          projectId: "proj-1",
          orchestrationKind: "parallel",
          triggerType: "user_execute",
          status: "completed",
          rootSessionId: "ses-root-history",
          createdAt: "2026-03-22T09:00:00.000Z",
          updatedAt: "2026-03-22T09:00:20.000Z",
        },
        nodes: [],
        candidateNodes: [
          {
            id: "history-node-a",
            runId: "run-history-1",
            taskId: "task-1",
            projectId: "proj-1",
            nodeKind: "candidate",
            nodeKey: "candidate:0",
            title: "旧候选 A",
            candidateIndex: 0,
            agentType: "executor",
            modelUsed: "gpt-4o-mini",
            sessionId: "ses-old-a",
            status: "completed",
            createdAt: "2026-03-22T09:00:01.000Z",
            updatedAt: "2026-03-22T09:00:10.000Z",
          },
          {
            id: "history-node-b",
            runId: "run-history-1",
            taskId: "task-1",
            projectId: "proj-1",
            nodeKind: "candidate",
            nodeKey: "candidate:1",
            title: "旧候选 B",
            candidateIndex: 1,
            agentType: "executor",
            modelUsed: "claude-3-7-sonnet",
            sessionId: "ses-old-b",
            status: "completed",
            createdAt: "2026-03-22T09:00:02.000Z",
            updatedAt: "2026-03-22T09:00:11.000Z",
          },
        ],
        judgeNode: null,
        winnerCandidateIndex: null,
      },);
    apiMocks.getTaskExecutionTraceView.mockImplementation(
      async (_taskId: string, sessionId: string) => ({
        taskId: "task-1",
        sessionId,
        segments: [],
        hookExecutions: [],
        timeline: [],
        messages: [
          {
            id: `assistant-${sessionId}`,
            role: "assistant",
            text: `reply-${sessionId}`,
            createdAt: "2026-03-22T10:10:10.000Z",
          },
        ],
        latestResponse: `reply-${sessionId}`,
      }),
    );
    apiMocks.listTaskRuntimePermissions.mockResolvedValue({ data: [] });

    const wrapper = await mountPage();
    const renderedParallelItems = wrapper
      .findAll(".chat-item")
      .filter((node) => node.attributes("data-role") === "parallel")
      .map((node) => ({
        text: node.attributes("data-text"),
        canAdopt: node.attributes("data-candidate-can-adopt"),
        models: node.attributes("data-candidate-models"),
      }));

    expect(renderedParallelItems).toContainEqual({
      text: "候选 A",
      canAdopt: "true|true",
      models: "gpt-5.4|claude-opus-4.6",
    });
  });

  it("keeps session-tree parallel comparison visible after task refresh temporarily reports single mode", async () => {
    taskState.task.status = "running";
    taskState.task.executionMode = "single";
    taskState.task.orchestrationKind = undefined;
    taskState.task.strategy = {
      executionMode: "parallel",
      parallelCandidates: [
        { label: "候选 A", model: "gpt-5.4" },
        { label: "候选 B", model: "claude-opus-4.6" },
      ],
    } as unknown as string;
    branchState.flatNodes = [
      {
        id: "node-session-root",
        parentId: "node-task-1",
        runtimeSessionId: "ses-1",
        isActive: true,
        contentText: "主分支",
        branchName: "main",
        createdAt: "2026-03-22T09:59:59.000Z",
      },
      {
        id: "node-session-a",
        parentId: "node-session-root",
        runtimeSessionId: "ses-a",
        isActive: true,
        contentText: "候选 A",
        branchName: "candidate-a",
        createdAt: "2026-03-22T10:00:01.000Z",
      },
      {
        id: "node-session-b",
        parentId: "node-session-root",
        runtimeSessionId: "ses-b",
        isActive: true,
        contentText: "候选 B",
        branchName: "candidate-b",
        createdAt: "2026-03-22T10:00:02.000Z",
      },
    ];
    branchState.selectedNode = branchState.flatNodes[0];
    messagesState.conversationItems = [
      {
        key: "user-before-parallel",
        role: "user",
        text: "做并行比较",
        createdAt: "2026-03-22T10:00:00.000Z",
        toolCalls: [],
        raw: null,
      },
    ];
    setLegacyParallelRuns([]);
    apiMocks.getTaskExecutionTraceView.mockImplementation(
      async (_taskId: string, sessionId: string) => ({
        taskId: "task-1",
        sessionId,
        segments: [],
        hookExecutions: [],
        timeline: [],
        messages: [
          {
            id: `assistant-${sessionId}`,
            role: "assistant",
            text: `reply-${sessionId}`,
            createdAt: "2026-03-22T10:00:10.000Z",
          },
        ],
        latestResponse: `reply-${sessionId}`,
      }),
    );
    apiMocks.listTaskRuntimePermissions.mockResolvedValue({ data: [] });

    const wrapper = await mountPage();
    const parallelItem = wrapper
      .findAll(".chat-item")
      .find((node) => node.attributes("data-role") === "parallel");

    expect(parallelItem?.attributes("data-text")).toBe("候选 A");
    expect(parallelItem?.attributes("data-candidate-can-adopt")).toBe("true|true");
  });

  it("passes current fallback run context when adopting a session-tree candidate", async () => {
    taskState.task.status = "running";
    taskState.task.executionMode = "single";
    taskState.task.orchestrationKind = undefined;
    taskState.task.strategy = {
      executionMode: "parallel",
      parallelCandidates: [
        { label: "候选 A", model: "gpt-5.4" },
        { label: "候选 B", model: "claude-opus-4.6" },
      ],
    } as unknown as string;
    branchState.flatNodes = [
      {
        id: "node-session-root",
        parentId: "node-task-1",
        runtimeSessionId: "ses-1",
        isActive: true,
        contentText: "主分支",
        branchName: "main",
        createdAt: "2026-03-22T09:59:59.000Z",
      },
      {
        id: "node-session-a",
        parentId: "node-session-root",
        runtimeSessionId: "ses-a",
        isActive: true,
        contentText: "候选 A",
        branchName: "candidate-a",
        createdAt: "2026-03-22T10:00:01.000Z",
      },
      {
        id: "node-session-b",
        parentId: "node-session-root",
        runtimeSessionId: "ses-b",
        isActive: true,
        contentText: "候选 B",
        branchName: "candidate-b",
        createdAt: "2026-03-22T10:00:02.000Z",
      },
    ];
    branchState.selectedNode = branchState.flatNodes[0];
    messagesState.conversationItems = [
      {
        key: "user-before-parallel",
        role: "user",
        text: "做并行比较",
        createdAt: "2026-03-22T10:00:00.000Z",
        toolCalls: [],
        raw: null,
      },
    ];
    setLegacyParallelRuns([]);
    apiMocks.getTaskExecutionTraceView.mockImplementation(
      async (_taskId: string, sessionId: string) => ({
        taskId: "task-1",
        sessionId,
        segments: [],
        hookExecutions: [],
        timeline: [],
        messages: [
          {
            id: `assistant-${sessionId}`,
            role: "assistant",
            text: `reply-${sessionId}`,
            createdAt: "2026-03-22T10:00:10.000Z",
          },
        ],
        latestResponse: `reply-${sessionId}`,
      }),
    );
    apiMocks.listTaskRuntimePermissions.mockResolvedValue({ data: [] });
    apiMocks.adoptParallelCandidate.mockResolvedValue({ ok: true, winnerCandidateIndex: 1 });

    const wrapper = await mountPage();
    wrapper.getComponent(ChatMessageListStub).vm.$emit("adoptCandidate", 1);
    await flushPromises();

    expect(apiMocks.adoptParallelCandidate).toHaveBeenCalledWith("task-1", "ses-1", 1);
  });

  it("refreshes adopted session-tree candidate state after manual adoption", async () => {
    taskState.task.status = "running";
    taskState.task.executionMode = "single";
    taskState.task.orchestrationKind = undefined;
    taskState.task.strategy = {
      executionMode: "parallel",
      parallelCandidates: [
        { label: "候选 A", model: "gpt-5.4" },
        { label: "候选 B", model: "claude-opus-4.6" },
      ],
    } as unknown as string;
    branchState.flatNodes = [
      {
        id: "node-session-root",
        parentId: "node-task-1",
        runtimeSessionId: "ses-1",
        isActive: true,
        contentText: "主分支",
        branchName: "main",
        createdAt: "2026-03-22T09:59:59.000Z",
      },
      {
        id: "node-session-a",
        parentId: "node-session-root",
        runtimeSessionId: "ses-a",
        isActive: true,
        contentText: "候选 A",
        branchName: "candidate-a",
        createdAt: "2026-03-22T10:00:01.000Z",
      },
      {
        id: "node-session-b",
        parentId: "node-session-root",
        runtimeSessionId: "ses-b",
        isActive: true,
        contentText: "候选 B",
        branchName: "candidate-b",
        createdAt: "2026-03-22T10:00:02.000Z",
      },
    ];
    branchState.selectedNode = branchState.flatNodes[0];
    messagesState.conversationItems = [
      {
        key: "user-before-parallel",
        role: "user",
        text: "做并行比较",
        createdAt: "2026-03-22T10:00:00.000Z",
        toolCalls: [],
        raw: null,
      },
    ];
    setLegacyParallelRuns([]);

    const unadoptedSessions = {
      data: [
        {
          id: "ses-a",
          title: "候选 A",
          isActive: false,
          summary: null,
          coordinationKey: "group-1",
          winnerSessionId: null,
          executionStatus: "completed",
          candidateIndex: 0,
          createdAt: "2026-03-22T10:00:01.000Z",
          updatedAt: "2026-03-22T10:00:12.000Z",
        },
        {
          id: "ses-b",
          title: "候选 B",
          isActive: true,
          summary: null,
          coordinationKey: "group-1",
          winnerSessionId: null,
          executionStatus: "completed",
          candidateIndex: 1,
          createdAt: "2026-03-22T10:00:02.000Z",
          updatedAt: "2026-03-22T10:00:13.000Z",
        },
      ],
    };
    const adoptedSessions = {
      data: [
        {
          id: "ses-a",
          title: "候选 A",
          isActive: false,
          summary: null,
          coordinationKey: "group-1",
          winnerSessionId: "ses-b",
          executionStatus: "completed",
          candidateIndex: 0,
          createdAt: "2026-03-22T10:00:01.000Z",
          updatedAt: "2026-03-22T10:00:12.000Z",
        },
        {
          id: "ses-b",
          title: "候选 B",
          isActive: true,
          summary: null,
          coordinationKey: "group-1",
          winnerSessionId: "ses-b",
          executionStatus: "completed",
          candidateIndex: 1,
          createdAt: "2026-03-22T10:00:02.000Z",
          updatedAt: "2026-03-22T10:00:13.000Z",
        },
      ],
    };
    let adopted = false;
    apiMocks.getTaskSessions.mockImplementation(async () =>
      adopted ? adoptedSessions : unadoptedSessions,
    );
    apiMocks.getTaskExecutionTraceView.mockImplementation(
      async (_taskId: string, sessionId: string) => ({
        taskId: "task-1",
        sessionId,
        segments: [],
        hookExecutions: [],
        timeline: [],
        messages: [
          {
            id: `assistant-${sessionId}`,
            role: "assistant",
            text: `reply-${sessionId}`,
            createdAt: "2026-03-22T10:00:10.000Z",
          },
        ],
        latestResponse: `reply-${sessionId}`,
      }),
    );
    apiMocks.listTaskRuntimePermissions.mockResolvedValue({ data: [] });
    apiMocks.adoptParallelCandidate.mockImplementation(async () => {
      adopted = true;
      return { ok: true, winnerCandidateIndex: 1 };
    });

    const wrapper = await mountPage();
    let parallelItem = wrapper
      .findAll(".chat-item")
      .find((node) => node.attributes("data-role") === "parallel");

    expect(parallelItem?.attributes("data-candidate-can-adopt")).toBe("true|true");
    expect(parallelItem?.attributes("data-candidate-is-adopted")).toBe("false|false");

    wrapper.getComponent(ChatMessageListStub).vm.$emit("adoptCandidate", 1);
    await flushPromises();
    await nextTick();

    parallelItem = wrapper
      .findAll(".chat-item")
      .find((node) => node.attributes("data-role") === "parallel");

    expect(parallelItem?.attributes("data-candidate-can-adopt")).toBe("false|false");
    expect(parallelItem?.attributes("data-candidate-is-adopted")).toBe("false|true");
  });

  it("hides stale session-tree parallel comparison once a later single-turn user message appears", async () => {
    taskState.task.status = "running";
    taskState.task.executionMode = "single";
    taskState.task.orchestrationKind = undefined;
    taskState.task.strategy = {
      executionMode: "parallel",
      parallelCandidates: [
        { label: "候选 A", model: "gpt-5.4" },
        { label: "候选 B", model: "claude-opus-4.6" },
      ],
    } as unknown as string;
    branchState.flatNodes = [
      {
        id: "node-session-root",
        parentId: "node-task-1",
        runtimeSessionId: "ses-1",
        isActive: true,
        contentText: "主分支",
        branchName: "main",
        createdAt: "2026-03-22T09:59:59.000Z",
      },
      {
        id: "node-session-a",
        parentId: "node-session-root",
        runtimeSessionId: "ses-a",
        isActive: true,
        contentText: "候选 A",
        branchName: "candidate-a",
        createdAt: "2026-03-22T10:00:01.000Z",
      },
      {
        id: "node-session-b",
        parentId: "node-session-root",
        runtimeSessionId: "ses-b",
        isActive: true,
        contentText: "候选 B",
        branchName: "candidate-b",
        createdAt: "2026-03-22T10:00:02.000Z",
      },
    ];
    branchState.selectedNode = branchState.flatNodes[0];
    messagesState.conversationItems = [
      {
        key: "user-after-parallel",
        role: "user",
        text: "现在改成单次继续",
        createdAt: "2026-03-22T10:00:30.000Z",
        toolCalls: [],
        raw: null,
      },
      {
        key: "assistant-after-parallel",
        role: "assistant",
        text: "单次执行回复",
        createdAt: "2026-03-22T10:00:40.000Z",
        toolCalls: [],
        raw: null,
      },
    ];
    setLegacyParallelRuns([]);
    apiMocks.listTaskRuntimePermissions.mockResolvedValue({ data: [] });

    const wrapper = await mountPage();
    const renderedItems = wrapper.findAll(".chat-item").map((node) => ({
      role: node.attributes("data-role"),
      text: node.attributes("data-text"),
    }));

    expect(renderedItems.some((item) => item.role === "parallel")).toBe(false);
    expect(renderedItems).toContainEqual({ role: "user", text: "现在改成单次继续" });
    expect(renderedItems).toContainEqual({ role: "assistant", text: "单次执行回复" });
  });

  it("keeps historical parallel comparison anchored before later single-run replies", async () => {
    taskState.task.status = "completed";
    taskState.task.agentRunId = undefined;
    taskState.task.executionMode = "single";
    taskState.task.orchestrationKind = "parallel";
    taskState.task.currentRunId = "run-anchor-1";
    setLegacyParallelRuns([
        {
          id: "run-anchor-1",
          taskId: "task-1",
          projectId: "proj-1",
          orchestrationKind: "parallel",
          triggerType: "user_execute",
          status: "completed",
          rootSessionId: "ses-root",
          createdAt: "2026-03-22T10:00:10.000Z",
          startedAt: "2026-03-22T10:00:10.000Z",
          finishedAt: "2026-03-22T10:00:20.000Z",
          updatedAt: "2026-03-22T10:00:20.000Z",
        },
      ],);
    setLegacyParallelRunDetail({
        run: {
          id: "run-anchor-1",
          taskId: "task-1",
          projectId: "proj-1",
          orchestrationKind: "parallel",
          triggerType: "user_execute",
          status: "completed",
          rootSessionId: "ses-root",
          createdAt: "2026-03-22T10:00:10.000Z",
          updatedAt: "2026-03-22T10:00:20.000Z",
        },
        nodes: [],
        candidateNodes: [
          {
            id: "anchor-node-a",
            runId: "run-anchor-1",
            taskId: "task-1",
            projectId: "proj-1",
            nodeKind: "candidate",
            nodeKey: "candidate:0",
            title: "候选 A",
            candidateIndex: 0,
            agentType: "executor",
            modelUsed: "gpt-5-mini",
            sessionId: "ses-a",
            status: "completed",
            createdAt: "2026-03-22T10:00:10.000Z",
            updatedAt: "2026-03-22T10:00:20.000Z",
          },
          {
            id: "anchor-node-b",
            runId: "run-anchor-1",
            taskId: "task-1",
            projectId: "proj-1",
            nodeKind: "candidate",
            nodeKey: "candidate:1",
            title: "候选 B",
            candidateIndex: 1,
            agentType: "executor",
            modelUsed: "gpt-4o",
            sessionId: "ses-b",
            status: "completed",
            createdAt: "2026-03-22T10:00:11.000Z",
            updatedAt: "2026-03-22T10:00:21.000Z",
          },
        ],
        judgeNode: null,
        winnerCandidateIndex: 0,
      },);
    messagesState.conversationItems = [
      {
        key: "user-parallel",
        role: "user",
        text: "先并行试一下",
        createdAt: "2026-03-22T10:00:00.000Z",
        toolCalls: [],
        raw: null,
      },
      {
        key: "assistant-adopted",
        role: "assistant",
        text: "这是采纳后的主线结果",
        createdAt: "2026-03-22T10:00:30.000Z",
        toolCalls: [],
        raw: null,
      },
      {
        key: "user-single",
        role: "user",
        text: "现在单次执行",
        createdAt: "2026-03-22T11:00:00.000Z",
        toolCalls: [],
        raw: null,
      },
      {
        key: "assistant-single",
        role: "assistant",
        text: "这是单次执行回复",
        createdAt: "2026-03-22T11:00:30.000Z",
        toolCalls: [],
        raw: null,
      },
    ];
    apiMocks.listTaskRuntimePermissions.mockResolvedValue({ data: [] });

    const wrapper = await mountPage();
    const renderedItems = wrapper.findAll(".chat-item").map((node) => ({
      role: node.attributes("data-role"),
      text: node.attributes("data-text"),
    }));

    expect(renderedItems).toEqual([
      { role: "user", text: "先并行试一下" },
      { role: "parallel", text: "候选 A" },
      { role: "assistant", text: "这是采纳后的主线结果" },
      { role: "user", text: "现在单次执行" },
      { role: "assistant", text: "这是单次执行回复" },
    ]);
  });

  it("does not swallow later single-run replies when an older parallel batch is still awaiting adoption", async () => {
    taskState.task.status = "completed";
    taskState.task.agentRunId = undefined;
    taskState.task.executionMode = "single";
    taskState.task.orchestrationKind = "parallel";
    taskState.task.currentRunId = "run-unadopted-1";
    setLegacyParallelRuns([
        {
          id: "run-unadopted-1",
          taskId: "task-1",
          projectId: "proj-1",
          orchestrationKind: "parallel",
          triggerType: "user_execute",
          status: "completed",
          rootSessionId: "ses-root",
          createdAt: "2026-03-22T10:00:10.000Z",
          startedAt: "2026-03-22T10:00:10.000Z",
          finishedAt: "2026-03-22T10:00:20.000Z",
          updatedAt: "2026-03-22T10:00:20.000Z",
        },
      ],);
    setLegacyParallelRunDetail({
        run: {
          id: "run-unadopted-1",
          taskId: "task-1",
          projectId: "proj-1",
          orchestrationKind: "parallel",
          triggerType: "user_execute",
          status: "completed",
          rootSessionId: "ses-root",
          createdAt: "2026-03-22T10:00:10.000Z",
          updatedAt: "2026-03-22T10:00:20.000Z",
        },
        nodes: [],
        candidateNodes: [
          {
            id: "unadopted-node-a",
            runId: "run-unadopted-1",
            taskId: "task-1",
            projectId: "proj-1",
            nodeKind: "candidate",
            nodeKey: "candidate:0",
            title: "候选 A",
            candidateIndex: 0,
            agentType: "executor",
            modelUsed: "gpt-5-mini",
            sessionId: "ses-a",
            status: "completed",
            createdAt: "2026-03-22T10:00:10.000Z",
            updatedAt: "2026-03-22T10:00:20.000Z",
          },
          {
            id: "unadopted-node-b",
            runId: "run-unadopted-1",
            taskId: "task-1",
            projectId: "proj-1",
            nodeKind: "candidate",
            nodeKey: "candidate:1",
            title: "候选 B",
            candidateIndex: 1,
            agentType: "executor",
            modelUsed: "gpt-4o",
            sessionId: "ses-b",
            status: "completed",
            createdAt: "2026-03-22T10:00:11.000Z",
            updatedAt: "2026-03-22T10:00:21.000Z",
          },
        ],
        judgeNode: null,
        winnerCandidateIndex: null,
      },);
    messagesState.conversationItems = [
      {
        key: "user-parallel",
        role: "user",
        text: "先并行试一下",
        createdAt: "2026-03-22T10:00:00.000Z",
        toolCalls: [],
        raw: null,
      },
      {
        key: "assistant-candidate",
        role: "assistant",
        text: "这是候选叶子分支上的回复",
        createdAt: "2026-03-22T10:00:30.000Z",
        toolCalls: [],
        raw: null,
      },
      {
        key: "user-single",
        role: "user",
        text: "现在单次执行",
        createdAt: "2026-03-22T11:00:00.000Z",
        toolCalls: [],
        raw: null,
      },
      {
        key: "assistant-single",
        role: "assistant",
        text: "这是单次执行回复",
        createdAt: "2026-03-22T11:00:30.000Z",
        toolCalls: [],
        raw: null,
      },
    ];
    apiMocks.listTaskRuntimePermissions.mockResolvedValue({ data: [] });

    const wrapper = await mountPage();
    const renderedItems = wrapper.findAll(".chat-item").map((node) => ({
      role: node.attributes("data-role"),
      text: node.attributes("data-text"),
    }));

    expect(renderedItems).toEqual([
      { role: "user", text: "先并行试一下" },
      { role: "parallel", text: "候选 A" },
      { role: "user", text: "现在单次执行" },
      { role: "assistant", text: "这是单次执行回复" },
    ]);
  });

  it("anchors session-tree parallel fallback to the current candidate cohort instead of an old parent root", async () => {
    taskState.task.status = "running";
    taskState.task.executionMode = "parallel";
    taskState.task.orchestrationKind = "parallel";
    taskState.task.currentRunId = undefined;
    taskState.task.sessionId = "ses-current-b";
    taskState.task.strategy = {
      executionMode: "parallel",
      parallelCandidates: [
        { label: "候选 A", model: "gpt-5.4" },
        { label: "候选 B", model: "claude-opus-4.6" },
      ],
    } as unknown as string;
    branchState.flatNodes = [
      {
        id: "node-session-root-old",
        parentId: "node-task-1",
        runtimeSessionId: "ses-root-old",
        isActive: false,
        contentText: "历史主线",
        branchName: "history-root",
        createdAt: "2026-03-22T09:00:00.000Z",
      },
      {
        id: "node-session-current-a",
        parentId: "node-session-root-old",
        runtimeSessionId: "ses-current-a",
        isActive: false,
        contentText: "当前候选 A",
        branchName: "candidate-a",
        forkedFromMessageId: "current-user-a",
        createdAt: "2026-03-22T10:09:58.000Z",
      },
      {
        id: "node-session-current-b",
        parentId: "node-session-root-old",
        runtimeSessionId: "ses-current-b",
        isActive: true,
        contentText: "当前候选 B",
        branchName: "candidate-b",
        forkedFromMessageId: "current-user-a",
        createdAt: "2026-03-22T10:09:59.000Z",
      },
    ];
    branchState.selectedNode = branchState.flatNodes[0];
    messagesState.conversationItems = [
      {
        key: "history-user-1",
        role: "user",
        text: "历史第一次执行",
        createdAt: "2026-03-22T09:00:00.000Z",
        toolCalls: [],
        raw: null,
      },
      {
        key: "history-assistant-1",
        role: "assistant",
        text: "历史第一次回复",
        createdAt: "2026-03-22T09:00:10.000Z",
        toolCalls: [],
        raw: null,
      },
      {
        key: "history-user-2",
        role: "user",
        text: "历史第二次执行",
        createdAt: "2026-03-22T09:30:00.000Z",
        toolCalls: [],
        raw: null,
      },
      {
        key: "history-assistant-2",
        role: "assistant",
        text: "历史第二次回复",
        createdAt: "2026-03-22T09:30:10.000Z",
        toolCalls: [],
        raw: null,
      },
      {
        key: "current-user-a",
        role: "user",
        text: "开始当前并行请求",
        createdAt: "2026-03-22T10:10:05.000Z",
        toolCalls: [],
        raw: null,
      },
      {
        key: "current-user-b",
        role: "user",
        text: "开始当前并行请求",
        createdAt: "2026-03-22T10:10:05.500Z",
        toolCalls: [],
        raw: null,
      },
      {
        key: "current-assistant-a",
        role: "assistant",
        text: "当前候选 A 回复",
        createdAt: "2026-03-22T10:10:05.000Z",
        toolCalls: [],
        raw: null,
      },
      {
        key: "current-assistant-b",
        role: "assistant",
        text: "当前候选 B 回复",
        createdAt: "2026-03-22T10:10:06.000Z",
        toolCalls: [],
        raw: null,
      },
    ];
    apiMocks.getTaskSessions.mockResolvedValue({ data: [] });
    setLegacyParallelRuns([]);
    apiMocks.getTaskExecutionTraceView.mockImplementation(
      async (_taskId: string, sessionId: string) => ({
        taskId: "task-1",
        sessionId,
        segments: [],
        hookExecutions: [],
        timeline: [],
        messages: [
          {
            id: `assistant-${sessionId}`,
            role: "assistant",
            text: sessionId === "ses-current-a" ? "当前候选 A 回复" : "当前候选 B 回复",
            createdAt: "2026-03-22T10:10:06.000Z",
          },
        ],
        latestResponse: sessionId === "ses-current-a" ? "当前候选 A 回复" : "当前候选 B 回复",
      }),
    );
    apiMocks.listTaskRuntimePermissions.mockResolvedValue({ data: [] });

    const wrapper = await mountPage();
    const renderedItems = wrapper.findAll(".chat-item").map((node) => ({
      role: node.attributes("data-role"),
      text: node.attributes("data-text"),
    }));

    expect(
      wrapper.get('[data-testid="chat-message-list-meta"]').attributes("data-session-id"),
    ).toBe("ses-current-b");
    expect(renderedItems).toEqual([
      { role: "user", text: "历史第一次执行" },
      { role: "assistant", text: "历史第一次回复" },
      { role: "user", text: "历史第二次执行" },
      { role: "assistant", text: "历史第二次回复" },
      { role: "user", text: "开始当前并行请求" },
      { role: "parallel", text: "候选 A" },
    ]);
  });

  it("keeps both pending parallel batches when an older run finishes after a newer user turn starts", async () => {
    taskState.task.status = "completed";
    taskState.task.agentRunId = undefined;
    taskState.task.executionMode = "single";
    taskState.task.orchestrationKind = "parallel";
    taskState.task.currentRunId = "run-unadopted-new";
    taskState.task.sessionId = "ses-root";
    setLegacyParallelRuns([
        {
          id: "run-unadopted-old",
          taskId: "task-1",
          projectId: "proj-1",
          orchestrationKind: "parallel",
          triggerType: "user_execute",
          status: "completed",
          rootSessionId: "ses-root",
          createdAt: "2026-03-22T10:00:10.000Z",
          startedAt: "2026-03-22T10:00:10.000Z",
          finishedAt: "2026-03-22T10:02:00.000Z",
          updatedAt: "2026-03-22T10:02:00.000Z",
        },
        {
          id: "run-unadopted-new",
          taskId: "task-1",
          projectId: "proj-1",
          orchestrationKind: "parallel",
          triggerType: "user_execute",
          status: "completed",
          rootSessionId: "ses-root",
          createdAt: "2026-03-22T10:01:10.000Z",
          startedAt: "2026-03-22T10:01:10.000Z",
          finishedAt: "2026-03-22T10:01:20.000Z",
          updatedAt: "2026-03-22T10:01:20.000Z",
        },
      ],);
    setLegacyParallelRunDetailImplementation(async (_taskId: string, runId: string) => ({
      data: {
        run: {
          id: runId,
          taskId: "task-1",
          projectId: "proj-1",
          orchestrationKind: "parallel",
          triggerType: "user_execute",
          status: "completed",
          rootSessionId: "ses-root",
          createdAt:
            runId === "run-unadopted-old" ? "2026-03-22T10:00:10.000Z" : "2026-03-22T10:01:10.000Z",
          updatedAt:
            runId === "run-unadopted-old" ? "2026-03-22T10:02:00.000Z" : "2026-03-22T10:01:20.000Z",
        },
        nodes: [],
        candidateNodes: [
          {
            id: `${runId}-node-a`,
            runId,
            taskId: "task-1",
            projectId: "proj-1",
            nodeKind: "candidate",
            nodeKey: "candidate:0",
            title: runId === "run-unadopted-old" ? "旧候选 A" : "新候选 A",
            candidateIndex: 0,
            agentType: "executor",
            modelUsed: "gpt-5-mini",
            sessionId: runId === "run-unadopted-old" ? "ses-old-a" : "ses-new-a",
            status: "completed",
            resultText: runId === "run-unadopted-old" ? "旧候选结果 A" : "新候选结果 A",
            createdAt:
              runId === "run-unadopted-old"
                ? "2026-03-22T10:00:10.000Z"
                : "2026-03-22T10:01:10.000Z",
            updatedAt:
              runId === "run-unadopted-old"
                ? "2026-03-22T10:02:00.000Z"
                : "2026-03-22T10:01:20.000Z",
          },
          {
            id: `${runId}-node-b`,
            runId,
            taskId: "task-1",
            projectId: "proj-1",
            nodeKind: "candidate",
            nodeKey: "candidate:1",
            title: runId === "run-unadopted-old" ? "旧候选 B" : "新候选 B",
            candidateIndex: 1,
            agentType: "executor",
            modelUsed: "gpt-4o",
            sessionId: runId === "run-unadopted-old" ? "ses-old-b" : "ses-new-b",
            status: "completed",
            resultText: runId === "run-unadopted-old" ? "旧候选结果 B" : "新候选结果 B",
            createdAt:
              runId === "run-unadopted-old"
                ? "2026-03-22T10:00:11.000Z"
                : "2026-03-22T10:01:11.000Z",
            updatedAt:
              runId === "run-unadopted-old"
                ? "2026-03-22T10:02:01.000Z"
                : "2026-03-22T10:01:21.000Z",
          },
        ],
        judgeNode: null,
        winnerCandidateIndex: null,
      },
    }));
    apiMocks.getTaskExecutionTraceView.mockImplementation(
      async (_taskId: string, sessionId: string) => ({
        taskId: "task-1",
        sessionId,
        segments: [],
        hookExecutions: [],
        timeline: [],
        messages: [],
      }),
    );
    messagesState.conversationItems = [
      {
        key: "user-old-parallel",
        role: "user",
        text: "先比较第一轮方案",
        createdAt: "2026-03-22T10:00:00.000Z",
        toolCalls: [],
        raw: null,
      },
      {
        key: "user-new-parallel",
        role: "user",
        text: "再比较第二轮方案",
        createdAt: "2026-03-22T10:01:00.000Z",
        toolCalls: [],
        raw: null,
      },
    ];
    apiMocks.listTaskRuntimePermissions.mockResolvedValue({ data: [] });

    const wrapper = await mountPage();
    const renderedItems = wrapper.findAll(".chat-item").map((node) => ({
      role: node.attributes("data-role"),
      text: node.attributes("data-text"),
    }));
    const candidateTexts = wrapper.findAll(".parallel-candidate-texts").map((node) => node.text());

    expect(renderedItems).toEqual([
      { role: "user", text: "先比较第一轮方案" },
      { role: "parallel", text: "旧候选 A" },
      { role: "user", text: "再比较第二轮方案" },
      { role: "parallel", text: "新候选 A" },
    ]);
    expect(candidateTexts[0]).toContain("旧候选结果 A");
    expect(candidateTexts[0]).toContain("旧候选结果 B");
    expect(candidateTexts[1]).toContain("新候选结果 A");
    expect(candidateTexts[1]).toContain("新候选结果 B");
  });

  it("keeps the historical adopted parallel card visible while focusing the latest rerun batch", async () => {
    taskState.task.status = "completed";
    taskState.task.agentRunId = undefined;
    taskState.task.executionMode = "parallel";
    taskState.task.orchestrationKind = "parallel";
    taskState.task.currentRunId = undefined;
    taskState.task.sessionId = "ses-current-a";
    branchState.currentSessionId = "ses-current-a";
    branchState.currentPhaseId = "phase-current";
    branchState.flatNodes = [
      {
        id: "node-root",
        parentId: "node-task-1",
        runtimeSessionId: "ses-root",
        isActive: false,
        contentText: "主分支",
        branchName: "main",
        createdAt: "2026-03-22T10:00:00.000Z",
      },
      {
        id: "node-old-a",
        parentId: "node-root",
        runtimeSessionId: "ses-old-a",
        isActive: false,
        contentText: "旧候选 A",
        branchName: "old-a",
        createdAt: "2026-03-22T10:01:00.000Z",
      },
      {
        id: "node-old-winner",
        parentId: "node-root",
        runtimeSessionId: "ses-old-winner",
        isActive: false,
        contentText: "旧候选 B",
        branchName: "old-b",
        createdAt: "2026-03-22T10:01:01.000Z",
      },
      {
        id: "node-current-a",
        parentId: "node-old-winner",
        runtimeSessionId: "ses-current-a",
        isActive: false,
        contentText: "当前候选 A",
        branchName: "current-a",
        createdAt: "2026-03-22T10:02:00.000Z",
      },
      {
        id: "node-current-b",
        parentId: "node-old-winner",
        runtimeSessionId: "ses-current-b",
        isActive: false,
        contentText: "当前候选 B",
        branchName: "current-b",
        createdAt: "2026-03-22T10:02:01.000Z",
      },
    ];
    branchState.selectedNode = branchState.flatNodes[0];
    messagesState.conversationItems = [
      {
        key: "root-user-1",
        role: "user",
        text: "第一轮主线问题",
        createdAt: "2026-03-22T10:00:00.000Z",
        toolCalls: [],
        raw: null,
      },
      {
        key: "root-assistant-1",
        role: "assistant",
        text: "第一轮主线回复",
        createdAt: "2026-03-22T10:00:30.000Z",
        toolCalls: [],
        raw: null,
      },
      {
        key: "root-user-2",
        role: "user",
        text: "第二轮主线问题",
        createdAt: "2026-03-22T10:01:00.000Z",
        toolCalls: [],
        raw: null,
      },
      {
        key: "root-assistant-2",
        role: "assistant",
        text: "旧批次采纳回复",
        createdAt: "2026-03-22T10:01:30.000Z",
        toolCalls: [],
        raw: null,
      },
      {
        key: "current-user-1",
        role: "user",
        text: "第三轮并行问题",
        createdAt: "2026-03-22T10:02:00.000Z",
        toolCalls: [],
        raw: null,
      },
    ];
    apiMocks.getTaskSessions.mockResolvedValue({
      data: [
        {
          id: "ses-root",
          taskSessionId: "task-session:task-1:ses-root",
          title: "主分支",
          isActive: false,
          summary: null,
          winnerSessionId: null,
          executionStatus: "completed",
          sessionKind: "primary",
          candidateIndex: null,
          createdAt: "2026-03-22T10:00:00.000Z",
          updatedAt: "2026-03-22T10:00:30.000Z",
        },
        {
          id: "ses-old-a",
          taskSessionId: "task-session:task-1:ses-old-a",
          phaseId: "phase-old",
          title: "旧候选 A",
          isActive: false,
          summary: null,
          parentRuntimeSessionId: "ses-root",
          winnerSessionId: "ses-old-winner",
          executionStatus: "completed",
          sessionKind: "candidate",
          candidateIndex: 0,
          executionModeSnapshot: "parallel",
          selectedModel: "gpt-4o",
          createdAt: "2026-03-22T10:01:00.000Z",
          updatedAt: "2026-03-22T10:01:20.000Z",
        },
        {
          id: "ses-old-winner",
          taskSessionId: "task-session:task-1:ses-old-winner",
          phaseId: "phase-old",
          title: "旧候选 B",
          isActive: false,
          summary: null,
          parentRuntimeSessionId: "ses-root",
          winnerSessionId: "ses-old-winner",
          executionStatus: "completed",
          sessionKind: "candidate",
          candidateIndex: 1,
          executionModeSnapshot: "parallel",
          selectedModel: "gpt-5-mini",
          createdAt: "2026-03-22T10:01:01.000Z",
          updatedAt: "2026-03-22T10:01:25.000Z",
        },
        {
          id: "ses-current-a",
          taskSessionId: "task-session:task-1:ses-current-a",
          phaseId: "phase-current",
          title: "当前候选 A",
          isActive: false,
          summary: null,
          parentRuntimeSessionId: "ses-old-winner",
          winnerSessionId: null,
          executionStatus: "completed",
          sessionKind: "candidate",
          candidateIndex: 0,
          executionModeSnapshot: "parallel",
          selectedModel: "gpt-5.4",
          createdAt: "2026-03-22T10:02:00.000Z",
          updatedAt: "2026-03-22T10:02:20.000Z",
        },
        {
          id: "ses-current-b",
          taskSessionId: "task-session:task-1:ses-current-b",
          phaseId: "phase-current",
          title: "当前候选 B",
          isActive: false,
          summary: null,
          parentRuntimeSessionId: "ses-old-winner",
          winnerSessionId: null,
          executionStatus: "completed",
          sessionKind: "candidate",
          candidateIndex: 1,
          executionModeSnapshot: "parallel",
          selectedModel: "claude-opus-4.6",
          createdAt: "2026-03-22T10:02:01.000Z",
          updatedAt: "2026-03-22T10:02:21.000Z",
        },
      ],
    });
    apiMocks.getTaskConversationMessages.mockResolvedValue({ data: [] });
    apiMocks.getTaskExecutionTraceView.mockImplementation(
      async (_taskId: string, sessionId: string) => ({
        taskId: "task-1",
        sessionId,
        segments: [],
        hookExecutions: [],
        timeline: [],
        messages: [
          {
            id: `assistant-${sessionId}`,
            role: "assistant",
            text:
              sessionId === "ses-old-a"
                ? "旧候选结果 A"
                : sessionId === "ses-old-winner"
                  ? "旧候选结果 B"
                  : sessionId === "ses-current-a"
                    ? "当前候选结果 A"
                    : "当前候选结果 B",
            createdAt:
              sessionId === "ses-current-a" || sessionId === "ses-current-b"
                ? "2026-03-22T10:02:20.000Z"
                : "2026-03-22T10:01:20.000Z",
          },
        ],
        latestResponse:
          sessionId === "ses-old-a"
            ? "旧候选结果 A"
            : sessionId === "ses-old-winner"
              ? "旧候选结果 B"
              : sessionId === "ses-current-a"
                ? "当前候选结果 A"
                : "当前候选结果 B",
      }),
    );
    apiMocks.listTaskRuntimePermissions.mockResolvedValue({ data: [] });

    const wrapper = await mountPage();
    const renderedItems = wrapper.findAll(".chat-item").map((node) => ({
      role: node.attributes("data-role"),
      text: node.attributes("data-text"),
    }));
    const candidateTexts = wrapper.findAll(".parallel-candidate-texts").map((node) => node.text());

    expect(
      wrapper.get('[data-testid="chat-message-list-meta"]').attributes("data-session-id"),
    ).toBe("ses-current-a");
    expect(renderedItems).toEqual([
      { role: "user", text: "第一轮主线问题" },
      { role: "assistant", text: "第一轮主线回复" },
      { role: "user", text: "第二轮主线问题" },
      { role: "parallel", text: "旧候选 A" },
      { role: "assistant", text: "旧批次采纳回复" },
      { role: "user", text: "第三轮并行问题" },
      { role: "parallel", text: "当前候选 A" },
    ]);
    expect(candidateTexts).toHaveLength(2);
    expect(candidateTexts[0]).toContain("旧候选结果 A");
    expect(candidateTexts[0]).toContain("旧候选结果 B");
    expect(candidateTexts[1]).toContain("当前候选结果 A");
    expect(candidateTexts[1]).toContain("当前候选结果 B");
  });
});
