import {
  asRecord,
  asString,
  type TaskConversationMessageItem,
  type TaskConversationToolCallItem,
} from "./message-normalize";

function normalizeParallelCandidateToolText(value?: string) {
  const normalizedValue = value?.trim();
  return normalizedValue ? normalizedValue : undefined;
}

function preferParallelCandidateToolText(primary?: string, secondary?: string) {
  return normalizeParallelCandidateToolText(primary) ?? normalizeParallelCandidateToolText(secondary);
}

function mergeParallelCandidateToolText(primary?: string, secondary?: string) {
  const normalizedPrimary = normalizeParallelCandidateToolText(primary);
  const normalizedSecondary = normalizeParallelCandidateToolText(secondary);
  if (!normalizedPrimary) {
    return normalizedSecondary;
  }
  if (!normalizedSecondary) {
    return normalizedPrimary;
  }
  if (normalizedPrimary === normalizedSecondary) {
    return normalizedPrimary;
  }
  if (normalizedPrimary.includes(normalizedSecondary)) {
    return normalizedPrimary;
  }
  if (normalizedSecondary.includes(normalizedPrimary)) {
    return normalizedSecondary;
  }
  return `${normalizedPrimary}\n\n${normalizedSecondary}`;
}

function appendParallelCandidateToolIdentifier(identifiers: Set<string>, value: unknown) {
  const normalizedValue = asString(value)?.trim();
  if (!normalizedValue) {
    return;
  }

  identifiers.add(normalizedValue);
  const marker = ":tool:";
  const markerIndex = normalizedValue.lastIndexOf(marker);
  if (markerIndex < 0) {
    return;
  }

  const suffix = normalizedValue
    .slice(markerIndex + marker.length)
    .split(":")[0]
    ?.trim();
  if (suffix) {
    identifiers.add(suffix);
  }
}

function parallelCandidateMessageParts(item: TaskConversationMessageItem) {
  const record = asRecord(item.raw);
  const parts = record?.parts;
  return Array.isArray(parts)
    ? parts
        .map((part) => asRecord(part))
        .filter((part): part is Record<string, unknown> => Boolean(part))
    : [];
}

type ParallelCandidateToolRef = {
  index: number;
  identifiers: Set<string>;
};

function buildParallelCandidateToolRefs(item: TaskConversationMessageItem): ParallelCandidateToolRef[] {
  const toolParts = parallelCandidateMessageParts(item).filter(
    (part) => asString(part.type) === "tool",
  );

  return item.toolCalls.map((toolCall, index) => {
    const identifiers = new Set<string>();
    appendParallelCandidateToolIdentifier(identifiers, toolCall.key);

    const part = toolParts[index];
    appendParallelCandidateToolIdentifier(identifiers, part?.callID);
    appendParallelCandidateToolIdentifier(identifiers, part?.messageID);
    appendParallelCandidateToolIdentifier(identifiers, part?.id);

    return {
      index,
      identifiers,
    } satisfies ParallelCandidateToolRef;
  });
}

function extractParallelCandidateToolIdentifiers(item: TaskConversationMessageItem) {
  const identifiers = new Set<string>();
  const record = asRecord(item.raw);
  const info = asRecord(record?.info);
  appendParallelCandidateToolIdentifier(identifiers, record?.id);
  appendParallelCandidateToolIdentifier(identifiers, info?.id);

  for (const part of parallelCandidateMessageParts(item)) {
    if (asString(part.type) !== "tool") {
      continue;
    }

    appendParallelCandidateToolIdentifier(identifiers, part.callID);
    appendParallelCandidateToolIdentifier(identifiers, part.messageID);
    appendParallelCandidateToolIdentifier(identifiers, part.id);
  }

  return identifiers;
}

function shareParallelCandidateToolIdentifiers(left: Set<string>, right: Set<string>) {
  if (left.size === 0 || right.size === 0) {
    return false;
  }

  for (const value of left) {
    if (right.has(value)) {
      return true;
    }
  }

  return false;
}

function findParallelCandidateToolCallIndex(
  item: TaskConversationMessageItem,
  identifiers: Set<string>,
) {
  const toolRefs = buildParallelCandidateToolRefs(item);
  if (toolRefs.length === 0) {
    return -1;
  }

  const matchedRef = toolRefs.find((toolRef) =>
    shareParallelCandidateToolIdentifiers(toolRef.identifiers, identifiers),
  );
  if (matchedRef) {
    return matchedRef.index;
  }

  return toolRefs.length === 1 ? 0 : -1;
}

function cloneParallelCandidateMessageItem(
  item: TaskConversationMessageItem,
): TaskConversationMessageItem {
  return {
    ...item,
    toolCalls: item.toolCalls.map((toolCall) => ({ ...toolCall })),
  };
}

function mergeParallelCandidateToolCall(
  target: TaskConversationToolCallItem,
  incoming: TaskConversationToolCallItem,
  outputText?: string,
): TaskConversationToolCallItem {
  return {
    ...target,
    stateLabel: incoming.stateLabel || target.stateLabel,
    stateColor: incoming.stateColor || target.stateColor,
    headline: preferParallelCandidateToolText(target.headline, incoming.headline),
    description: preferParallelCandidateToolText(target.description, incoming.description),
    command: preferParallelCandidateToolText(target.command, incoming.command),
    filePath: preferParallelCandidateToolText(target.filePath, incoming.filePath),
    fileContent: mergeParallelCandidateToolText(target.fileContent, incoming.fileContent),
    inputPreview: mergeParallelCandidateToolText(target.inputPreview, incoming.inputPreview),
    outputPreview: mergeParallelCandidateToolText(
      mergeParallelCandidateToolText(target.outputPreview, incoming.outputPreview),
      outputText,
    ),
  };
}

function findParallelCandidateToolMergeTargetIndex(
  items: TaskConversationMessageItem[],
  sourceIdentifiers: Set<string>,
) {
  if (sourceIdentifiers.size === 0) {
    return -1;
  }

  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (item.role === "user") {
      break;
    }
    if (item.toolCalls.length === 0) {
      if (item.role === "assistant") {
        break;
      }
      continue;
    }

    if (findParallelCandidateToolCallIndex(item, sourceIdentifiers) >= 0) {
      return index;
    }
  }

  return -1;
}

export function condenseParallelCandidateToolItems(items: TaskConversationMessageItem[]) {
  const condensed: TaskConversationMessageItem[] = [];

  for (const item of items) {
    const clonedItem = cloneParallelCandidateMessageItem(item);
    if (clonedItem.role !== "tool") {
      condensed.push(clonedItem);
      continue;
    }

    const sourceIdentifiers = extractParallelCandidateToolIdentifiers(clonedItem);
    const targetIndex = findParallelCandidateToolMergeTargetIndex(condensed, sourceIdentifiers);
    if (targetIndex < 0) {
      condensed.push(clonedItem);
      continue;
    }

    const mergedTarget = cloneParallelCandidateMessageItem(condensed[targetIndex]);
    let merged = false;

    if (clonedItem.toolCalls.length > 0) {
      const sourceToolRefs = buildParallelCandidateToolRefs(clonedItem);
      clonedItem.toolCalls.forEach((toolCall, toolCallIndex) => {
        const targetToolCallIndex = findParallelCandidateToolCallIndex(
          mergedTarget,
          sourceToolRefs[toolCallIndex]?.identifiers ?? sourceIdentifiers,
        );
        if (targetToolCallIndex < 0) {
          return;
        }

        mergedTarget.toolCalls[targetToolCallIndex] = mergeParallelCandidateToolCall(
          mergedTarget.toolCalls[targetToolCallIndex],
          toolCall,
        );
        merged = true;
      });
    }

    const textOutput = normalizeParallelCandidateToolText(clonedItem.text);
    if (textOutput) {
      const targetToolCallIndex = findParallelCandidateToolCallIndex(
        mergedTarget,
        sourceIdentifiers,
      );
      if (targetToolCallIndex >= 0) {
        mergedTarget.toolCalls[targetToolCallIndex] = mergeParallelCandidateToolCall(
          mergedTarget.toolCalls[targetToolCallIndex],
          mergedTarget.toolCalls[targetToolCallIndex],
          textOutput,
        );
        merged = true;
      }
    }

    if (merged) {
      condensed[targetIndex] = mergedTarget;
      continue;
    }

    condensed.push(clonedItem);
  }

  return condensed;
}