import { db } from "../../db";
import { taskUsageLedgerEntries, type TaskUsageEntryKind } from "../../db/schema";

type AppendTaskUsageLedgerEntryArgs = {
  taskId: string;
  projectId: string;
  sessionId?: string | null;
  messageId?: string | null;
  operationId?: string | null;
  entryKind: TaskUsageEntryKind;
  providerId?: string | null;
  modelId?: string | null;
  requestCount?: number;
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
  currencyCode?: string;
  recordedAt?: string;
  metadataJson?: Record<string, unknown>;
};

export function createTaskUsageLedgerWriteApi() {
  async function appendTaskUsageLedgerEntry(args: AppendTaskUsageLedgerEntryArgs) {
    const id = crypto.randomUUID();
    const inputTokens = args.inputTokens ?? 0;
    const outputTokens = args.outputTokens ?? 0;

    await db.insert(taskUsageLedgerEntries).values({
      id,
      taskId: args.taskId,
      projectId: args.projectId,
      sessionId: args.sessionId ?? null,
      messageId: args.messageId ?? null,
      operationId: args.operationId ?? null,
      entryKind: args.entryKind,
      providerId: args.providerId ?? null,
      modelId: args.modelId ?? null,
      requestCount: args.requestCount ?? 1,
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
      costUsd: args.costUsd ?? 0,
      currencyCode: (args.currencyCode ?? "USD").toUpperCase(),
      recordedAt: args.recordedAt ?? new Date().toISOString(),
      metadataJson: args.metadataJson ?? {},
      createdAt: new Date().toISOString(),
    });

    return { id };
  }

  return {
    appendTaskUsageLedgerEntry,
  };
}