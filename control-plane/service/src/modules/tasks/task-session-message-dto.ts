import { z } from "zod";

export const taskSessionMessageAttachmentSchema = z.object({}).passthrough();

export const postTaskSessionMessageSchema = z.object({
  client_message_id: z.string().trim().min(1).max(191),
  text: z.string().trim().min(1),
  attachments: z.array(taskSessionMessageAttachmentSchema).default([]),
});

export const listTaskSessionMessagesQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(100),
  cursor: z.string().trim().min(1).optional(),
});

export type PostTaskSessionMessageInput = z.infer<typeof postTaskSessionMessageSchema> & {
  taskId: string;
  sessionId: string;
};

export type ListTaskSessionMessagesQuery = z.infer<typeof listTaskSessionMessagesQuerySchema>;

export type TaskSessionMessageApiStatus =
  | "pending"
  | "streaming"
  | "completed"
  | "failed"
  | "cancelled";

export type TaskSessionOperationApiStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export interface TaskSessionMessageApiSummary {
  id: string;
  client_message_id?: string;
  role: "user" | "assistant" | "system" | "tool";
  status: TaskSessionMessageApiStatus;
  text?: string | null;
  message_index: number;
  created_at: string;
  completed_at?: string | null;
}

export interface TaskSessionOperationApiSummary {
  id: string;
  kind: "model_request";
  status: TaskSessionOperationApiStatus;
}

export interface PostTaskSessionMessageResponse {
  task_id: string;
  session_id: string;
  user_message: TaskSessionMessageApiSummary;
  assistant_message: TaskSessionMessageApiSummary;
  operation: TaskSessionOperationApiSummary;
}