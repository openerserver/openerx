import { computed, ref, type Ref, watch } from "vue";
import {
  getTaskConversationMessages,
  type ChainStepInput,
  type ExecutionMode,
  type TaskSessionRecord,
} from "../lib/api";
import { normalizeSessionConversationItems } from "../lib/message-normalize";
import { resolveEditableSequentialSteps } from "../lib/taskExecutionMode";
import type { TreeTask } from "./useProjectTreeTask";

type SequentialSessionStepCandidate = {
  sessionId: string;
  title?: string | null;
  createdAt?: string | null;
  stepIndex?: number;
  model?: string | null;
};

const SEQUENTIAL_STEP_PROMPT_SUFFIX = "请只完成当前步骤的目标。完成后输出本步骤产出摘要。";

function parseTaskStrategy(raw?: string | Record<string, unknown> | null) {
  if (!raw) {
    return null as { sequentialSteps?: unknown } | null;
  }

  if (typeof raw === "object" && !Array.isArray(raw)) {
    return raw as { sequentialSteps?: unknown } | null;
  }

  if (typeof raw !== "string" || !raw.trim()) {
    return null as { sequentialSteps?: unknown } | null;
  }

  try {
    const parsed = JSON.parse(raw) as { sequentialSteps?: unknown };
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function resolveSequentialStepsFromStrategy(taskRecord: TreeTask | null | undefined): ChainStepInput[] {
  const strategy = parseTaskStrategy(taskRecord?.strategy);
  if (!Array.isArray(strategy?.sequentialSteps) || strategy.sequentialSteps.length === 0) {
    return [];
  }

  return strategy.sequentialSteps
    .filter(
      (step): step is ChainStepInput =>
        Boolean(step) &&
        typeof step === "object" &&
        typeof (step as { id?: unknown }).id === "string" &&
        typeof (step as { title?: unknown }).title === "string" &&
        typeof (step as { instruction?: unknown }).instruction === "string",
    )
    .map((step) => ({
      id: step.id,
      title: step.title,
      instruction: step.instruction,
      ...(step.model ? { model: step.model } : {}),
    }));
}

function toTimestampMs(value?: string | null) {
  if (typeof value !== "string" || value.trim().length === 0) return null;
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? null : timestamp;
}

function buildSequentialSessionStepCandidates(sessionSummaries: TaskSessionRecord[]) {
  const taggedSummaries = sessionSummaries.filter(
    (summary) => summary.sessionKind === "sequential_step" || typeof summary.stepIndex === "number",
  );
  const sourceSummaries = taggedSummaries.length > 0 ? taggedSummaries : sessionSummaries;

  return sourceSummaries
    .filter((summary) => typeof summary.id === "string" && summary.id.trim().length > 0)
    .map(
      (summary) =>
        ({
          sessionId: summary.id,
          title: summary.title,
          createdAt: summary.createdAt,
          stepIndex: typeof summary.stepIndex === "number" ? summary.stepIndex : undefined,
          model: summary.selectedModel ?? null,
        }) satisfies SequentialSessionStepCandidate,
    )
    .sort((left, right) => {
      const leftIndex =
        typeof left.stepIndex === "number" ? left.stepIndex : Number.MAX_SAFE_INTEGER;
      const rightIndex =
        typeof right.stepIndex === "number" ? right.stepIndex : Number.MAX_SAFE_INTEGER;
      if (leftIndex !== rightIndex) {
        return leftIndex - rightIndex;
      }

      return (toTimestampMs(left.createdAt) ?? 0) - (toTimestampMs(right.createdAt) ?? 0);
    });
}

function normalizeSequentialSessionTitle(title?: string | null, taskTitle?: string | null) {
  if (typeof title !== "string" || title.trim().length === 0) {
    return undefined;
  }

  const normalizedTitle = title.trim();
  if (typeof taskTitle !== "string" || taskTitle.trim().length === 0) {
    return normalizedTitle;
  }

  const taskPrefix = `${taskTitle.trim()} — `;
  return normalizedTitle.startsWith(taskPrefix)
    ? normalizedTitle.slice(taskPrefix.length).trim() || normalizedTitle
    : normalizedTitle;
}

function parseSequentialStepPrompt(text?: string) {
  if (typeof text !== "string" || text.trim().length === 0) {
    return null;
  }

  const normalizedText = text.trim();
  const currentStepMarkerIndex = normalizedText.lastIndexOf("## 当前步骤 (");
  if (currentStepMarkerIndex < 0) {
    return null;
  }

  const stepBlock = normalizedText.slice(currentStepMarkerIndex);
  const suffixIndex = stepBlock.lastIndexOf(SEQUENTIAL_STEP_PROMPT_SUFFIX);
  if (suffixIndex < 0) {
    return null;
  }

  const headerEndIndex = stepBlock.indexOf("\n");
  if (headerEndIndex < 0) {
    return null;
  }

  const header = stepBlock.slice(0, headerEndIndex).trim();
  const headerMatch = /^## 当前步骤 \((\d+)\/(\d+)\): (.+)$/.exec(header);
  if (!headerMatch) {
    return null;
  }

  return {
    stepIndex: Math.max(Number(headerMatch[1]) - 1, 0),
    totalSteps: Number(headerMatch[2]),
    title: headerMatch[3].trim(),
    instruction: stepBlock.slice(headerEndIndex + 1, suffixIndex).trim(),
  };
}

async function resolveSequentialSessionStep(
  currentTaskId: string,
  taskTitle: string | undefined,
  candidate: SequentialSessionStepCandidate,
): Promise<(ChainStepInput & { stepIndex?: number }) | null> {
  try {
    const response = await getTaskConversationMessages(currentTaskId, candidate.sessionId, {
      includeLineage: false,
    });
    const normalizedMessages = normalizeSessionConversationItems(
      Array.isArray(response.data) ? response.data : [],
    );
    const initialPrompt = normalizedMessages.find(
      (item) =>
        item.role === "user" && typeof item.text === "string" && item.text.trim().length > 0,
    )?.text;
    const parsedStep = parseSequentialStepPrompt(initialPrompt);
    if (!parsedStep) {
      return null;
    }

    const normalizedTitle =
      parsedStep.title || normalizeSequentialSessionTitle(candidate.title, taskTitle);
    if (!normalizedTitle) {
      return null;
    }

    return {
      id: candidate.sessionId,
      title: normalizedTitle,
      instruction: parsedStep.instruction,
      stepIndex:
        typeof candidate.stepIndex === "number" ? candidate.stepIndex : parsedStep.stepIndex,
      ...(candidate.model ? { model: candidate.model } : {}),
    };
  } catch {
    return null;
  }
}

export function useTaskDetailSequentialStepsCoordinator(args: {
  taskId: Ref<string>;
  task: Ref<TreeTask | null | undefined>;
  taskSessionSummaries: Ref<TaskSessionRecord[]>;
  editableExecutionMode: Ref<ExecutionMode>;
}) {
  const sequentialSessionStepCache = ref<
    Record<string, (ChainStepInput & { stepIndex?: number }) | null>
  >({});
  let sequentialSessionStepLoadToken = 0;

  const sequentialSessionStepCandidates = computed(() =>
    buildSequentialSessionStepCandidates(args.taskSessionSummaries.value),
  );

  const sessionBackedSequentialSteps = computed<ChainStepInput[]>(() => {
    const taskTitle = args.task.value?.title;

    return sequentialSessionStepCandidates.value
      .map((candidate) => {
        const cached = sequentialSessionStepCache.value[candidate.sessionId];
        if (!cached) {
          return null;
        }

        return {
          step: {
            ...cached,
            title: normalizeSequentialSessionTitle(cached.title, taskTitle) ?? cached.title,
            ...(cached.model ? {} : candidate.model ? { model: candidate.model } : {}),
          } satisfies ChainStepInput,
          stepIndex: typeof cached.stepIndex === "number" ? cached.stepIndex : candidate.stepIndex,
        };
      })
      .filter(
        (
          step,
        ): step is {
          step: ChainStepInput;
          stepIndex: number | undefined;
        } => step != null,
      )
      .sort((left, right) => {
        const leftIndex =
          typeof left.stepIndex === "number" ? left.stepIndex : Number.MAX_SAFE_INTEGER;
        const rightIndex =
          typeof right.stepIndex === "number" ? right.stepIndex : Number.MAX_SAFE_INTEGER;
        if (leftIndex !== rightIndex) {
          return leftIndex - rightIndex;
        }

        return 0;
      })
      .map((entry) => entry.step);
  });

  const editableSequentialSteps = computed<ChainStepInput[]>(() => {
    const strategySteps = resolveSequentialStepsFromStrategy(args.task.value);
    if (strategySteps.length > 0) {
      return strategySteps;
    }

    if (sessionBackedSequentialSteps.value.length > 0) {
      return sessionBackedSequentialSteps.value;
    }

    return resolveEditableSequentialSteps(args.task.value);
  });

  function resetSequentialStepState() {
    sequentialSessionStepCache.value = {};
    sequentialSessionStepLoadToken += 1;
  }

  watch(
    args.taskId,
    () => {
      resetSequentialStepState();
    },
    { immediate: false },
  );

  watch(
    [
      args.taskId,
      () => args.task.value?.title,
      () => args.task.value?.strategy,
      () => args.task.value?.orchestrationKind,
      args.editableExecutionMode,
      sequentialSessionStepCandidates,
    ],
    () => {
      const shouldLoadSessionBackedSteps =
        (args.editableExecutionMode.value === "sequential-chain" ||
          args.task.value?.orchestrationKind === "sequential-chain") &&
        resolveSequentialStepsFromStrategy(args.task.value).length === 0;
      if (!shouldLoadSessionBackedSteps || !args.taskId.value) {
        resetSequentialStepState();
        return;
      }

      const missingCandidates = sequentialSessionStepCandidates.value.filter(
        (candidate) =>
          !Object.prototype.hasOwnProperty.call(
            sequentialSessionStepCache.value,
            candidate.sessionId,
          ),
      );
      if (missingCandidates.length === 0) {
        return;
      }

      const currentTaskId = args.taskId.value;
      const currentTaskTitle = args.task.value?.title;
      const requestToken = ++sequentialSessionStepLoadToken;
      void Promise.all(
        missingCandidates.map(
          async (candidate) =>
            [
              candidate.sessionId,
              await resolveSequentialSessionStep(currentTaskId, currentTaskTitle, candidate),
            ] as const,
        ),
      ).then((entries) => {
        if (requestToken !== sequentialSessionStepLoadToken || currentTaskId !== args.taskId.value) {
          return;
        }

        sequentialSessionStepCache.value = {
          ...sequentialSessionStepCache.value,
          ...Object.fromEntries(entries),
        };
      });
    },
    { immediate: true, deep: true },
  );

  return {
    editableSequentialSteps,
    resetSequentialStepState,
  };
}