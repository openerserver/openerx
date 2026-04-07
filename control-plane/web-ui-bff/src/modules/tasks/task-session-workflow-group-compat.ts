import { fetchRuntimeWorkflowCompatGroupSteps } from "./task-session-runtime-workflow-compat";
import type { TaskSessionLineageRecord } from "./task-session-store";

type SynthesizeWorkflowGroupCompatMessagesArgs<TMessage> = {
  taskId: string;
  authorization: string;
  messages: TMessage[];
  records: TaskSessionLineageRecord[];
  isExecutionContextUserMessage(message: TMessage): boolean;
  extractSourceSessionId(message: TMessage): string | undefined;
  extractText(message: TMessage): string | undefined;
  extractCreatedAt(message: TMessage): string | undefined;
  buildLegacyMessage(message: TMessage): Record<string, unknown>;
  mapRegularMessages(messages: TMessage[]): Record<string, unknown>[];
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function toTimestampMs(value?: string | null) {
  const rawValue = asString(value);
  if (!rawValue) {
    return null;
  }

  const parsed = Date.parse(rawValue);
  return Number.isNaN(parsed) ? null : parsed;
}

export function buildTaskSessionLineageCompatRecordLookup(records: TaskSessionLineageRecord[]) {
  const bySessionId = new Map<string, TaskSessionLineageRecord>();

  const addAliasFromCanonicalTaskSessionId = (
    canonicalId: string,
    record: TaskSessionLineageRecord,
  ) => {
    if (!canonicalId.startsWith("task-session:")) {
      return;
    }

    const segments = canonicalId.split(":");
    if (segments.length < 3) {
      return;
    }

    const runtimeSessionId = segments.slice(2).join(":").trim();
    if (runtimeSessionId) {
      bySessionId.set(runtimeSessionId, record);
    }
  };

  for (const record of records) {
    const recordId = asString(record.id);
    if (recordId) {
      bySessionId.set(recordId, record);
      addAliasFromCanonicalTaskSessionId(recordId, record);
    }

    const runtimeSessionId = asString(record.runtimeSessionId);
    if (runtimeSessionId) {
      bySessionId.set(runtimeSessionId, record);
    }
  }

  return bySessionId;
}

function isRootPrimaryTaskSessionRecord(record: TaskSessionLineageRecord | undefined) {
  return record?.sessionKind === "primary" && !asString(record.parentRuntimeSessionId);
}

export function shouldPreserveWorkflowExecutionContextCompatMessage(
  sourceSessionId: string,
  recordLookup: Map<string, TaskSessionLineageRecord>,
) {
  return isRootPrimaryTaskSessionRecord(recordLookup.get(sourceSessionId));
}

function extractWorkflowContextDisplayText(text: string | undefined) {
  const normalized = typeof text === "string" ? text.replace(/\r\n?/g, "\n").trim() : "";
  if (!normalized) {
    return undefined;
  }

  const withoutPrefix = normalized.replace(/^Execution context:\s*/u, "").trim();
  if (!withoutPrefix) {
    return undefined;
  }

  const cutMarkers = [
    "\n请只完成当前阶段的目标。",
    "\n完成后请输出本阶段产出摘要。",
    "\n如果你认为当前阶段已经完成，请在输出末尾单独追加 [STAGE_COMPLETE]。",
    "\n如果你认为当前阶段已经完成，请在输出末尾单独追加 [STAGE_COMPLETE]",
    "\n/start-work ",
  ];

  let cutIndex = withoutPrefix.length;
  for (const marker of cutMarkers) {
    const markerIndex = withoutPrefix.indexOf(marker);
    if (markerIndex >= 0) {
      cutIndex = Math.min(cutIndex, markerIndex);
    }
  }

  const cleaned = withoutPrefix.slice(0, cutIndex).trim();
  return cleaned.length > 0 ? cleaned : withoutPrefix;
}

function extractWorkflowContextStageLabel(text: string | undefined) {
  if (typeof text !== "string" || text.length === 0) {
    return undefined;
  }

  const stageMatch = /当前阶段：([^\n]+)/u.exec(text);
  const stageLabel = stageMatch?.[1]?.trim();
  return stageLabel && stageLabel.length > 0 ? stageLabel : undefined;
}

function buildWorkflowContextCompatMessage(args: {
  legacyMessage: Record<string, unknown>;
  text: string | undefined;
}) {
  const displayText = extractWorkflowContextDisplayText(
    args.text ?? asString(args.legacyMessage.text),
  );
  if (!displayText) {
    return null;
  }

  const info = asRecord(args.legacyMessage.info) ?? {};
  const createdAt =
    asString(args.legacyMessage.createdAt) ??
    asString(asRecord(info.time)?.created) ??
    asString(asRecord(info.time)?.completed);
  const messageId = asString(args.legacyMessage.id) ?? asString(info.id) ?? "workflow-context";
  const textPartId = `${messageId}:workflow-context`;

  return {
    ...args.legacyMessage,
    role: "workflow",
    text: displayText,
    textContent: displayText,
    summaryText: displayText,
    parts: [
      {
        id: textPartId,
        type: "text",
        text: displayText,
        content: displayText,
      },
    ],
    ...(createdAt ? { createdAt } : {}),
    info: {
      ...info,
      role: "workflow",
      preview: displayText,
      time: {
        ...(asRecord(info.time) ?? {}),
        ...(createdAt ? { created: createdAt } : {}),
      },
    },
  } satisfies Record<string, unknown>;
}

export async function synthesizeWorkflowGroupCompatMessages<TMessage>(
  args: SynthesizeWorkflowGroupCompatMessagesArgs<TMessage>,
) {
  const recordLookup = buildTaskSessionLineageCompatRecordLookup(args.records);
  const workflowMessagesBySession = new Map<string, TMessage[]>();

  for (const message of args.messages) {
    if (!args.isExecutionContextUserMessage(message)) {
      continue;
    }

    const sourceSessionId = args.extractSourceSessionId(message);
    if (
      !sourceSessionId ||
      !shouldPreserveWorkflowExecutionContextCompatMessage(sourceSessionId, recordLookup)
    ) {
      continue;
    }

    const existing = workflowMessagesBySession.get(sourceSessionId) ?? [];
    existing.push(message);
    workflowMessagesBySession.set(sourceSessionId, existing);
  }

  const workflowMessageSet = new Set<TMessage>();
  const workflowSteps = Array.from(workflowMessagesBySession.entries()).flatMap(
    ([sourceSessionId, sessionMessages]) => {
      for (const message of sessionMessages) {
        workflowMessageSet.add(message);
      }

      const legacyMessages = sessionMessages.flatMap((message) => {
        const compatMessage = buildWorkflowContextCompatMessage({
          legacyMessage: args.buildLegacyMessage(message),
          text: args.extractText(message),
        });
        return compatMessage ? [compatMessage] : [];
      });
      if (legacyMessages.length === 0) {
        return [];
      }

      const firstSessionMessage = sessionMessages[0];
      if (!firstSessionMessage) {
        return [];
      }

      const stageLabel = extractWorkflowContextStageLabel(args.extractText(firstSessionMessage));

      return [
        {
          agentName: stageLabel ?? "当前工作流",
          sessionId: sourceSessionId,
          messages: legacyMessages,
          createdAt:
            sessionMessages
              .map((message) => args.extractCreatedAt(message))
              .find((value): value is string => Boolean(value)) ?? null,
        },
      ];
    },
  );

  const runtimeWorkflowSteps = await fetchRuntimeWorkflowCompatGroupSteps(
    args.taskId,
    args.authorization,
  );
  if (runtimeWorkflowSteps.length > 0) {
    workflowSteps.push(
      ...runtimeWorkflowSteps.map((step) => ({
        ...step,
        messages: step.messages as typeof workflowSteps[number]["messages"],
        createdAt: step.createdAt ?? null,
      })),
    );
  }

  const regularMessages = args.mapRegularMessages(
    args.messages.filter((message) => !workflowMessageSet.has(message)),
  );
  if (workflowSteps.length === 0) {
    return regularMessages;
  }

  workflowSteps.sort((left, right) => {
    return (toTimestampMs(left.createdAt) ?? 0) - (toTimestampMs(right.createdAt) ?? 0);
  });

  const workflowGroup = {
    _type: "workflow_group",
    info: {
      id: `workflow-group:${args.taskId}`,
      role: "workflow",
      variant: "context",
      label: "工作流消息",
      hint: "当前阶段与执行上下文",
    },
    steps: workflowSteps,
  } satisfies Record<string, unknown>;

  const insertionIndex = regularMessages.findIndex((message) => {
    const record = asRecord(message);
    const info = asRecord(record?.info);
    const role = asString(info?.role) ?? asString(record?.role);
    return role != null && role !== "user";
  });

  if (insertionIndex < 0) {
    return [...regularMessages, workflowGroup];
  }

  return [
    ...regularMessages.slice(0, insertionIndex),
    workflowGroup,
    ...regularMessages.slice(insertionIndex),
  ];
}