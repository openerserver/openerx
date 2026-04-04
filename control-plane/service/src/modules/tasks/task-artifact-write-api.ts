import { db } from "../../db";
import {
  taskArtifacts,
  type TaskArtifactKind,
  type TaskArtifactStorageKind,
} from "../../db/schema";

type CreateTaskArtifactArgs = {
  taskId: string;
  projectId: string;
  sessionId?: string | null;
  messageId?: string | null;
  operationId?: string | null;
  parentArtifactId?: string | null;
  artifactKind: TaskArtifactKind;
  storageKind?: TaskArtifactStorageKind;
  title?: string | null;
  mimeType?: string | null;
  filePath?: string | null;
  externalUri?: string | null;
  contentText?: string | null;
  payloadJson?: Record<string, unknown>;
  byteSize?: number | null;
  sha256?: string | null;
};

export function createTaskArtifactWriteApi() {
  async function createTaskArtifact(args: CreateTaskArtifactArgs) {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    await db.insert(taskArtifacts).values({
      id,
      taskId: args.taskId,
      projectId: args.projectId,
      sessionId: args.sessionId ?? null,
      messageId: args.messageId ?? null,
      operationId: args.operationId ?? null,
      parentArtifactId: args.parentArtifactId ?? null,
      artifactKind: args.artifactKind,
      storageKind: args.storageKind ?? "inline",
      title: args.title ?? null,
      mimeType: args.mimeType ?? null,
      filePath: args.filePath ?? null,
      externalUri: args.externalUri ?? null,
      contentText: args.contentText ?? null,
      payloadJson: args.payloadJson ?? {},
      byteSize: args.byteSize ?? null,
      sha256: args.sha256 ?? null,
      createdAt: now,
      updatedAt: now,
    });

    return { id };
  }

  return {
    createTaskArtifact,
  };
}