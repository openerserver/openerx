import { cpFetch } from "../../lib/control-plane-client";
import {
  buildTaskWorkflowViewModel,
  fetchTaskWorkflowResources,
  stageLabelFromKey,
  type TaskWorkflowResources,
} from "./workflow-view";

interface TaskDetailPayload {
  id?: string;
  projectId?: string | null;
  status?: string | null;
}

interface ProjectMemberPayload {
  userId: string;
  projectId: string;
  role: "project_admin" | "developer" | "viewer";
  username: string;
  displayName: string;
  globalRole: string;
  createdAt?: string;
}

interface TaskAgentRunPayload {
  id: string;
  taskId: string;
  sessionId?: string | null;
  agentType?: string | null;
  status: string;
  createdAt: string;
  startedAt?: string | null;
  finishedAt?: string | null;
}

interface TaskAgentRunListResponse {
  data?: TaskAgentRunPayload[];
}

type WorkflowStageResource = TaskWorkflowResources["stages"][number];

interface RoleAgentResolutionPayload {
  role?: {
    id: string;
    name: string;
    allowedStages?: string[];
    bindings?: Array<{
      bindingId: string;
      runtimeAgent: string;
      label: string;
      enabled: boolean;
      priority: number;
      model?: string | null;
      tags?: string[] | null;
    }>;
  };
  validation?: {
    executable?: boolean;
    reasons?: string[];
  };
}

type TaskMemberKind = "manager" | "user" | "agent";
type TaskMemberStatusTone = "default" | "processing" | "success" | "warning";

export interface TaskMemberViewMember {
  id: string;
  kind: TaskMemberKind;
  displayName: string;
  handle: string | null;
  identitySource: "human" | "agent";
  intentSource: "original" | "derived";
  responsibilityLabels: string[];
  stageLabels: string[];
  statusLabel: string;
  statusTone: TaskMemberStatusTone;
  summary: string;
  capabilityBadges: string[];
  runCount: number;
  latestActivityAt: string | null;
}

export interface TaskMemberViewModel {
  taskId: string;
  projectId: string | null;
  meta?: {
    snapshotVersion?: number;
    reconcileRequired?: boolean;
  };
  workflowStatus: string;
  currentStageKey: string;
  currentStageLabel: string;
  summary: {
    managerCount: number;
    userCount: number;
    agentCount: number;
    activeAgentCount: number;
  };
  members: TaskMemberViewMember[];
}

function fallbackRoleLabel(roleAgentId: string | null | undefined) {
  if (!roleAgentId) {
    return "未命名职责";
  }
  return roleAgentId.replace(/^role\./, "") || roleAgentId;
}

function normalizeAgentName(value: string | null | undefined) {
  return value?.trim().toLowerCase() || "";
}

function dedupeText(values: Array<string | null | undefined>) {
  return Array.from(
    new Set(
      values.map((value) => value?.trim()).filter((value): value is string => Boolean(value)),
    ),
  );
}

function resolveHumanResponsibility(role: ProjectMemberPayload["role"]) {
  if (role === "project_admin") {
    return "治理 / 授权 / 审批";
  }
  if (role === "developer") {
    return "原始意图 / 协作 / 上下文";
  }
  return "查看 / 反馈 / 确认";
}

function resolveHumanSummary(member: ProjectMemberPayload) {
  if (member.role === "project_admin") {
    return "负责管理介入、授权边界和最终责任兜底。";
  }
  if (member.role === "developer") {
    return "负责补充业务上下文、参与协作并提供原始意图。";
  }
  return "负责查看当前进展并提供反馈或确认。";
}

function resolveAgentStatus(args: {
  runs: TaskAgentRunPayload[];
  executable: boolean;
  touchesCurrentStage: boolean;
}) {
  if (!args.executable) {
    return {
      statusLabel: "未就绪",
      statusTone: "warning" as const,
    };
  }

  if (args.runs.some((run) => run.status === "running" || run.status === "paused")) {
    return {
      statusLabel: "执行中",
      statusTone: "processing" as const,
    };
  }

  if (args.runs.some((run) => run.status === "failed" || run.status === "cancelled")) {
    return {
      statusLabel: "异常",
      statusTone: "warning" as const,
    };
  }

  if (args.runs.some((run) => run.status === "completed")) {
    return {
      statusLabel: "已运行",
      statusTone: "success" as const,
    };
  }

  if (args.touchesCurrentStage) {
    return {
      statusLabel: "当前接手",
      statusTone: "processing" as const,
    };
  }

  return {
    statusLabel: "待命",
    statusTone: "default" as const,
  };
}

function resolveLatestActivityAt(runs: TaskAgentRunPayload[]) {
  return (
    runs
      .map((run) => run.finishedAt || run.startedAt || run.createdAt)
      .filter((value): value is string => Boolean(value))
      .sort((left, right) => Date.parse(right) - Date.parse(left))[0] || null
  );
}

function buildAgentSummary(args: {
  roleLabels: string[];
  stageLabels: string[];
  executable: boolean;
  validationReasons: string[];
}) {
  const responsibilityText = args.roleLabels.join(" / ") || "未分配职责";
  const stageText = args.stageLabels.join(" / ") || "未绑定阶段";
  if (!args.executable && args.validationReasons.length > 0) {
    return `负责 ${responsibilityText}，关联 ${stageText}。当前不可执行：${args.validationReasons.join("；")}`;
  }
  return `负责 ${responsibilityText}，关联 ${stageText}。`;
}

async function resolveRoleMembers(args: {
  roleAgentId: string;
  projectId?: string | null;
  templateId?: string | null;
  stageKey?: string;
  authorization: string;
}) {
  const query = new URLSearchParams();
  if (args.projectId) {
    query.set("projectId", args.projectId);
  }
  if (args.templateId) {
    query.set("templateId", args.templateId);
  }
  if (args.stageKey) {
    query.set("stage", args.stageKey);
  }

  const result = await cpFetch<{ data?: RoleAgentResolutionPayload }>(
    `/api/role-agents/${encodeURIComponent(args.roleAgentId)}/resolve${query.toString() ? `?${query.toString()}` : ""}`,
    {
      authorization: args.authorization,
    },
  );

  const data = result.ok ? (result.data?.data ?? null) : null;

  return {
    data,
    reconcileRequired: !result.ok || data == null,
  };
}

export async function buildTaskMemberViewModel(input: {
  taskId: string;
  authorization: string;
  projectId?: string | null;
  taskStatus?: string | null;
  prefetchedWorkflowResources?: TaskWorkflowResources | null;
}): Promise<TaskMemberViewModel> {
  const taskResult = await cpFetch<TaskDetailPayload>(
    `/api/project-tree/tasks/${encodeURIComponent(input.taskId)}`,
    {
      authorization: input.authorization,
    },
  );

  const task = taskResult.ok ? taskResult.data : null;
  const projectId = input.projectId ?? task?.projectId ?? null;
  const [workflowResources, projectMembersResult, agentRunsResult] = await Promise.all([
    input.prefetchedWorkflowResources
      ? Promise.resolve(input.prefetchedWorkflowResources)
      : fetchTaskWorkflowResources({
          taskId: input.taskId,
          authorization: input.authorization,
          includeTask: false,
        }),
    projectId
      ? cpFetch<ProjectMemberPayload[]>(`/api/projects/${encodeURIComponent(projectId)}/members`, {
          authorization: input.authorization,
        })
      : Promise.resolve({ ok: true, status: 200, data: [] as ProjectMemberPayload[] }),
    cpFetch<TaskAgentRunListResponse>(`/api/tasks/${encodeURIComponent(input.taskId)}/runs`, {
      authorization: input.authorization,
    }),
  ]);

  const workflowView = await buildTaskWorkflowViewModel(input.taskId, input.authorization, {
    projectId,
    taskStatus: input.taskStatus ?? task?.status,
    prefetched: workflowResources,
  });
  const agentRuns =
    agentRunsResult.ok && Array.isArray(agentRunsResult.data?.data)
      ? agentRunsResult.data.data
      : [];
  const projectMembers = projectMembersResult.ok ? projectMembersResult.data : [];

  const roleStageMap = new Map<string, Set<string>>();
  const registerRoleStage = (
    roleAgentId: string | null | undefined,
    stageKey: string | null | undefined,
  ) => {
    if (!roleAgentId) {
      return;
    }
    const stages = roleStageMap.get(roleAgentId) ?? new Set<string>();
    if (stageKey) {
      stages.add(stageKey);
    }
    roleStageMap.set(roleAgentId, stages);
  };

  for (const stage of workflowResources.stages) {
    registerRoleStage(stage.primaryRoleAgentId, stage.stageKey);
  }
  for (const conclusion of workflowResources.conclusions) {
    registerRoleStage(conclusion.roleAgentId, conclusion.stage);
  }
  const stageIdToKey = new Map(
    workflowResources.stages
      .filter((stage: WorkflowStageResource): stage is WorkflowStageResource & {
        id: string;
        stageKey: string;
      } =>
        Boolean(stage.id && stage.stageKey),
      )
      .map((stage) => [stage.id, stage.stageKey] as const),
  );
  for (const request of workflowResources.requests) {
    const requestStageId =
      typeof request.taskStageRunId === "string" ? request.taskStageRunId : undefined;
    registerRoleStage(
      request.sourceRoleAgentId,
      requestStageId ? stageIdToKey.get(requestStageId) : undefined,
    );
  }

  const roleIds = Array.from(roleStageMap.keys());
  const roleResolutionEntries = await Promise.all(
    roleIds.map(async (roleAgentId) => {
      const stageKeys = Array.from(roleStageMap.get(roleAgentId) ?? []);
      const resolved = await resolveRoleMembers({
        roleAgentId,
        projectId,
        templateId: workflowView.workflow.templateId ?? null,
        stageKey: stageKeys[0],
        authorization: input.authorization,
      });
      return [roleAgentId, resolved] as const;
    }),
  );
  const roleResolutions = new Map(
    roleResolutionEntries.map(([roleAgentId, resolved]) => [roleAgentId, resolved.data] as const),
  );
  const reconcileRequired =
    Boolean(workflowView.meta?.reconcileRequired) ||
    Boolean(projectId && !projectMembersResult.ok) ||
    !agentRunsResult.ok ||
    roleResolutionEntries.some(([, resolved]) => resolved.reconcileRequired);
  const memberMeta =
    workflowView.meta || reconcileRequired
      ? {
          snapshotVersion: workflowView.meta?.snapshotVersion,
          reconcileRequired,
        }
      : undefined;

  const stageLabelMap = new Map(
    workflowView.workflow.stages.map((stage) => [stage.stageKey, stage.stageLabel] as const),
  );

  const members: TaskMemberViewMember[] = [];

  for (const projectMember of projectMembers) {
    members.push({
      id: `human:${projectMember.userId}`,
      kind: projectMember.role === "project_admin" ? "manager" : "user",
      displayName: projectMember.displayName,
      handle: projectMember.username,
      identitySource: "human",
      intentSource: "original",
      responsibilityLabels: [resolveHumanResponsibility(projectMember.role)],
      stageLabels: [],
      statusLabel: "已加入任务",
      statusTone: "default",
      summary: resolveHumanSummary(projectMember),
      capabilityBadges: dedupeText([
        projectMember.role === "project_admin"
          ? "管理者成员"
          : projectMember.role === "developer"
            ? "普通用户成员"
            : "协作观察",
        projectMember.globalRole,
      ]),
      runCount: 0,
      latestActivityAt: projectMember.createdAt ?? null,
    });
  }

  type AgentDraft = Omit<
    TaskMemberViewMember,
    "summary" | "statusLabel" | "statusTone" | "latestActivityAt" | "runCount"
  > & {
    roleLabels: Set<string>;
    stageLabelsSet: Set<string>;
    validationReasons: Set<string>;
    executable: boolean;
    runs: TaskAgentRunPayload[];
  };

  const agentDrafts = new Map<string, AgentDraft>();

  for (const roleAgentId of roleIds) {
    const stageKeys = Array.from(roleStageMap.get(roleAgentId) ?? []);
    const stageLabels = stageKeys.map(
      (stageKey) => stageLabelMap.get(stageKey) || stageLabelFromKey(stageKey),
    );
    const resolved = roleResolutions.get(roleAgentId);
    const roleName = resolved?.role?.name || fallbackRoleLabel(roleAgentId);
    const bindings = resolved?.role?.bindings ?? [];
    const executable = resolved?.validation?.executable ?? bindings.length > 0;
    const validationReasons = resolved?.validation?.reasons ?? [];

    if (bindings.length === 0) {
      const key = `agent-role:${roleAgentId}`;
      const existing = agentDrafts.get(key);
      agentDrafts.set(key, {
        id: key,
        kind: "agent",
        displayName: roleName,
        handle: roleAgentId,
        identitySource: "agent",
        intentSource: "derived",
        responsibilityLabels: [],
        stageLabels: [],
        capabilityBadges: [],
        roleLabels: new Set([...(existing?.roleLabels ?? []), roleName]),
        stageLabelsSet: new Set([...(existing?.stageLabelsSet ?? []), ...stageLabels]),
        validationReasons: new Set([...(existing?.validationReasons ?? []), ...validationReasons]),
        executable,
        runs: existing?.runs ?? [],
      });
      continue;
    }

    for (const binding of bindings) {
      const key = `agent:${binding.bindingId}`;
      const matchedRuns = agentRuns.filter(
        (run: TaskAgentRunPayload) =>
          normalizeAgentName(run.agentType) === normalizeAgentName(binding.runtimeAgent),
      );
      const existing = agentDrafts.get(key);
      agentDrafts.set(key, {
        id: key,
        kind: "agent",
        displayName: binding.label || binding.runtimeAgent || roleName,
        handle: binding.runtimeAgent || roleAgentId,
        identitySource: "agent",
        intentSource: "derived",
        responsibilityLabels: [],
        stageLabels: [],
        capabilityBadges: dedupeText([
          ...(existing?.capabilityBadges ?? []),
          ...(binding.tags ?? []),
        ]),
        roleLabels: new Set([...(existing?.roleLabels ?? []), roleName]),
        stageLabelsSet: new Set([...(existing?.stageLabelsSet ?? []), ...stageLabels]),
        validationReasons: new Set([...(existing?.validationReasons ?? []), ...validationReasons]),
        executable: (existing?.executable ?? true) && executable,
        runs: [...(existing?.runs ?? []), ...matchedRuns],
      });
    }
  }

  const currentStageLabel =
    workflowView.workflow.stages.find(
      (stage) => stage.stageKey === workflowView.workflow.currentStage,
    )?.stageLabel || stageLabelFromKey(workflowView.workflow.currentStage);

  for (const draft of agentDrafts.values()) {
    const roleLabels = Array.from(draft.roleLabels).sort((left, right) =>
      left.localeCompare(right, "zh-CN"),
    );
    const stageLabels = Array.from(draft.stageLabelsSet).sort((left, right) =>
      left.localeCompare(right, "zh-CN"),
    );
    const status = resolveAgentStatus({
      runs: draft.runs,
      executable: draft.executable,
      touchesCurrentStage: stageLabels.includes(currentStageLabel),
    });
    members.push({
      id: draft.id,
      kind: draft.kind,
      displayName: draft.displayName,
      handle: draft.handle,
      identitySource: draft.identitySource,
      intentSource: draft.intentSource,
      responsibilityLabels: roleLabels,
      stageLabels,
      statusLabel: status.statusLabel,
      statusTone: status.statusTone,
      summary: buildAgentSummary({
        roleLabels,
        stageLabels,
        executable: draft.executable,
        validationReasons: Array.from(draft.validationReasons),
      }),
      capabilityBadges: draft.capabilityBadges,
      runCount: draft.runs.length,
      latestActivityAt: resolveLatestActivityAt(draft.runs),
    });
  }

  const sortedMembers = members.sort((left, right) => {
    const kindRank = { manager: 0, user: 1, agent: 2 } as const;
    if (kindRank[left.kind] !== kindRank[right.kind]) {
      return kindRank[left.kind] - kindRank[right.kind];
    }
    if (left.runCount !== right.runCount) {
      return right.runCount - left.runCount;
    }
    return left.displayName.localeCompare(right.displayName, "zh-CN");
  });

  return {
    taskId: input.taskId,
    projectId,
    meta: memberMeta,
    workflowStatus: workflowView.workflow.status,
    currentStageKey: workflowView.workflow.currentStage,
    currentStageLabel,
    summary: {
      managerCount: sortedMembers.filter((member) => member.kind === "manager").length,
      userCount: sortedMembers.filter((member) => member.kind === "user").length,
      agentCount: sortedMembers.filter((member) => member.kind === "agent").length,
      activeAgentCount: sortedMembers.filter(
        (member) => member.kind === "agent" && member.statusTone === "processing",
      ).length,
    },
    members: sortedMembers,
  };
}
