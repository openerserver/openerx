# Task Session Message Service Route 与 DTO 草案

> 状态：Draft v1
> 日期：2026-03-29
> 作者：GitHub Copilot
> 关联文档：[task-session-message-minimal-contract.md](task-session-message-minimal-contract.md)、[task-session-message-roundtrip-target-plan.md](task-session-message-roundtrip-target-plan.md)

## 1. 文档目的

这份文档把最小 contract 再下压一层，直接给出：

1. service route 草案
2. Hono 注册方式草案
3. Zod schema 草案
4. TypeScript DTO 草案
5. 服务层内部命令 DTO 草案

它是 implementation draft，不是最终代码。

## 2. 建议文件布局

最小实现建议拆成 3 个文件：

1. `control-plane/service/src/modules/tasks/task-session-message-dto.ts`
2. `control-plane/service/src/modules/tasks/task-session-message-routes.ts`
3. `control-plane/service/src/modules/tasks/task-session-message-api.ts`

职责建议：

1. `task-session-message-dto.ts`：只放 Zod schema、TypeScript DTO、公共枚举
2. `task-session-message-routes.ts`：只放 Hono route 注册
3. `task-session-message-api.ts`：只放 route 调用的服务层依赖接口与实现

不要把以下内容混在一个文件里：

1. 路由注册
2. 数据库读写
3. executor streaming 逻辑
4. realtime 广播逻辑

## 3. Public Service Routes 草案

MVP 只建议暴露 2 条 public route，加 1 条可选 detail route。

## 3.1 发送用户消息

```http
POST /tasks/:taskId/sessions/:sessionId/messages
```

语义：

1. 接收用户消息
2. 同步创建 user message
3. 同步创建 model_request operation
4. 创建 assistant placeholder
5. 返回本轮 server ids

## 3.2 读取消息列表

```http
GET /tasks/:taskId/sessions/:sessionId/messages?limit=100&cursor=...
```

语义：

1. 从数据库读取当前 session message 列表
2. 返回已经持久化的最新 assistant 文本
3. 不临时读取底层 runtime

## 3.3 可选的单条消息详情

```http
GET /tasks/:taskId/sessions/:sessionId/messages/:messageId
```

语义：

1. 用于前端轻量校验或消息定位
2. 不是 MVP 必需项

## 3.4 明确不提供的 public route

这一版不建议提供以下 public route：

1. `PATCH /tasks/:taskId/sessions/:sessionId/messages/:messageId`
2. `POST /tasks/:taskId/sessions/:sessionId/messages/:messageId/delta`
3. `POST /tasks/:taskId/sessions/:sessionId/messages/:messageId/complete`

原因是这些动作属于服务端内部执行流水，不应该暴露给前端或外部调用方。

## 4. Route Registration 草案

建议路由注册文件形状如下：

```ts
import { zValidator } from "@hono/zod-validator";
import type { Hono } from "hono";
import type { AppEnv } from "../../middleware/auth";
import {
  getTaskSessionMessageParamsSchema,
  getTaskSessionMessageSchema,
  listTaskSessionMessagesQuerySchema,
  postTaskSessionMessageSchema,
  type GetTaskSessionMessageParams,
  type GetTaskSessionMessageInput,
  type ListTaskSessionMessagesInput,
  type ListTaskSessionMessagesQuery,
  type ListTaskSessionMessagesResponse,
  type PostTaskSessionMessageInput,
  type PostTaskSessionMessageResponse,
} from "./task-session-message-dto";

type RouteErrorStatus = 400 | 404 | 409 | 500;

type RouteResult<T, S extends number = 200 | 201> =
  | { ok: true; status: S; data: T }
  | { ok: false; status: RouteErrorStatus; error: string; details?: unknown };

export function registerTaskSessionMessageRoutes(
  taskRoutes: Hono<AppEnv>,
  deps: {
    postTaskSessionMessage: (
      input: PostTaskSessionMessageInput,
    ) => Promise<RouteResult<PostTaskSessionMessageResponse, 201 | 200>>;
    listTaskSessionMessages: (
      input: ListTaskSessionMessagesInput,
    ) => Promise<RouteResult<ListTaskSessionMessagesResponse, 200>>;
    getTaskSessionMessage?: (
      input: GetTaskSessionMessageInput,
    ) => Promise<RouteResult<GetTaskSessionMessageResponse, 200>>;
  },
) {
  taskRoutes.post(
    "/:taskId/sessions/:sessionId/messages",
    zValidator("json", postTaskSessionMessageSchema),
    async (c) => {
      const taskId = c.req.param("taskId");
      const sessionId = c.req.param("sessionId");
      const body = c.req.valid("json");

      const result = await deps.postTaskSessionMessage({
        taskId,
        sessionId,
        ...body,
      });

      if (!result.ok) {
        return c.json({ error: result.error, details: result.details }, result.status);
      }

      return c.json(result.data, result.status);
    },
  );

  taskRoutes.get(
    "/:taskId/sessions/:sessionId/messages",
    zValidator("query", listTaskSessionMessagesQuerySchema),
    async (c) => {
      const taskId = c.req.param("taskId");
      const sessionId = c.req.param("sessionId");
      const query = c.req.valid("query");

      const result = await deps.listTaskSessionMessages({
        taskId,
        sessionId,
        ...query,
      });

      if (!result.ok) {
        return c.json({ error: result.error, details: result.details }, result.status);
      }

      return c.json(result.data, 200);
    },
  );

  if (deps.getTaskSessionMessage) {
    taskRoutes.get(
      "/:taskId/sessions/:sessionId/messages/:messageId",
      async (c) => {
        const result = await deps.getTaskSessionMessage({
          taskId: c.req.param("taskId"),
          sessionId: c.req.param("sessionId"),
          messageId: c.req.param("messageId"),
        });

        if (!result.ok) {
          return c.json({ error: result.error, details: result.details }, result.status);
        }

        return c.json(result.data, 200);
      },
    );
  }
}
```

## 5. DTO 文件草案

建议 DTO 文件同时输出：

1. 基础枚举 schema
2. request / response schema
3. `z.infer` 类型
4. 内部可复用的只读 DTO

## 5.1 基础枚举

```ts
import { z } from "zod";

export const taskSessionMessageRoleSchema = z.enum([
  "user",
  "assistant",
  "tool",
  "system",
]);

export const taskSessionMessageStatusSchema = z.enum([
  "pending",
  "streaming",
  "completed",
  "failed",
  "cancelled",
]);

export const taskSessionMessagePartTypeSchema = z.enum([
  "text",
  "tool_call",
  "tool_result",
]);

export const sessionOperationStatusSchema = z.enum([
  "queued",
  "running",
  "completed",
  "failed",
  "cancelled",
]);

export type TaskSessionMessageRole = z.infer<typeof taskSessionMessageRoleSchema>;
export type TaskSessionMessageStatus = z.infer<typeof taskSessionMessageStatusSchema>;
export type TaskSessionMessagePartType = z.infer<typeof taskSessionMessagePartTypeSchema>;
export type SessionOperationStatus = z.infer<typeof sessionOperationStatusSchema>;
```

## 5.2 通用子对象 DTO

```ts
export const taskSessionMessageAttachmentSchema = z.object({
  kind: z.enum(["file_reference"]).default("file_reference"),
  filePath: z.string().trim().min(1),
  displayName: z.string().trim().min(1).optional(),
});

export const taskSessionMessagePartDtoSchema = z.object({
  id: z.string().min(1),
  part_index: z.number().int().min(0),
  part_type: taskSessionMessagePartTypeSchema,
  text: z.string(),
  json_payload: z.record(z.unknown()).default({}),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime().optional(),
  finalized_at: z.string().datetime().nullable().optional(),
});

export const taskSessionMessageDtoSchema = z.object({
  id: z.string().min(1),
  task_id: z.string().min(1),
  session_id: z.string().min(1),
  role: taskSessionMessageRoleSchema,
  status: taskSessionMessageStatusSchema,
  message_index: z.number().int().min(0),
  text: z.string(),
  summary_text: z.string().nullable().optional(),
  client_message_id: z.string().nullable().optional(),
  provider_message_id: z.string().nullable().optional(),
  error_text: z.string().nullable().optional(),
  parts: z.array(taskSessionMessagePartDtoSchema),
  started_at: z.string().datetime().nullable().optional(),
  completed_at: z.string().datetime().nullable().optional(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});

export const sessionOperationSummaryDtoSchema = z.object({
  id: z.string().min(1),
  kind: z.literal("model_request"),
  status: sessionOperationStatusSchema,
  provider_id: z.string().nullable().optional(),
  model_id: z.string().nullable().optional(),
});

export type TaskSessionMessageAttachment = z.infer<typeof taskSessionMessageAttachmentSchema>;
export type TaskSessionMessagePartDto = z.infer<typeof taskSessionMessagePartDtoSchema>;
export type TaskSessionMessageDto = z.infer<typeof taskSessionMessageDtoSchema>;
export type SessionOperationSummaryDto = z.infer<typeof sessionOperationSummaryDtoSchema>;
```

## 5.3 POST messages DTO

```ts
export const postTaskSessionMessageSchema = z.object({
  clientMessageId: z.string().trim().min(1).max(128),
  text: z.string().trim().min(1).max(200_000),
  attachments: z.array(taskSessionMessageAttachmentSchema).default([]),
});

export const postTaskSessionMessageResponseSchema = z.object({
  task_id: z.string().min(1),
  session_id: z.string().min(1),
  user_message: taskSessionMessageDtoSchema,
  assistant_message: taskSessionMessageDtoSchema,
  operation: sessionOperationSummaryDtoSchema,
});

export type PostTaskSessionMessageBody = z.infer<typeof postTaskSessionMessageSchema>;

export interface PostTaskSessionMessageInput extends PostTaskSessionMessageBody {
  taskId: string;
  sessionId: string;
}

export type PostTaskSessionMessageResponse = z.infer<
  typeof postTaskSessionMessageResponseSchema
>;
```

## 5.4 GET messages DTO

```ts
export const listTaskSessionMessagesQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(100),
  cursor: z.string().trim().min(1).optional(),
});

export const listTaskSessionMessagesResponseSchema = z.object({
  data: z.array(taskSessionMessageDtoSchema),
  page: z.object({
    limit: z.number().int().min(1),
    next_cursor: z.string().nullable(),
  }),
});

export type ListTaskSessionMessagesQuery = z.infer<
  typeof listTaskSessionMessagesQuerySchema
>;

export interface ListTaskSessionMessagesInput extends ListTaskSessionMessagesQuery {
  taskId: string;
  sessionId: string;
}

export type ListTaskSessionMessagesResponse = z.infer<
  typeof listTaskSessionMessagesResponseSchema
>;
```

## 5.5 可选 GET single message DTO

```ts
export const getTaskSessionMessageParamsSchema = z.object({
  taskId: z.string().min(1),
  sessionId: z.string().min(1),
  messageId: z.string().min(1),
});

export const getTaskSessionMessageResponseSchema = z.object({
  data: taskSessionMessageDtoSchema,
});

export type GetTaskSessionMessageParams = z.infer<
  typeof getTaskSessionMessageParamsSchema
>;

export interface GetTaskSessionMessageInput extends GetTaskSessionMessageParams {}

export type GetTaskSessionMessageResponse = z.infer<
  typeof getTaskSessionMessageResponseSchema
>;
```

## 6. 服务层 API 草案

建议路由不要直接碰 Drizzle。服务层 API 先定义成明确命令。

```ts
export interface CreateUserTaskSessionMessageCommand {
  taskId: string;
  sessionId: string;
  clientMessageId: string;
  text: string;
  attachments: TaskSessionMessageAttachment[];
  actorUserId?: string | null;
}

export interface CreateAssistantPlaceholderCommand {
  taskId: string;
  sessionId: string;
  triggeredByMessageId: string;
  operationId: string;
  selectedModel?: string | null;
}

export interface AppendAssistantMessageDeltaCommand {
  taskId: string;
  sessionId: string;
  messageId: string;
  operationId: string;
  deltaText: string;
  fullText: string;
  providerMessageId?: string | null;
  emittedAt?: string;
}

export interface CompleteAssistantMessageCommand {
  taskId: string;
  sessionId: string;
  messageId: string;
  operationId: string;
  finalText: string;
  providerMessageId?: string | null;
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
  completedAt?: string;
}

export interface FailAssistantMessageCommand {
  taskId: string;
  sessionId: string;
  messageId: string;
  operationId: string;
  errorText: string;
  failedAt?: string;
}
```

这些命令的目的分别是：

1. `CreateUserTaskSessionMessageCommand`：处理 public POST messages
2. `CreateAssistantPlaceholderCommand`：在 executor 启动时创建 assistant 占位
3. `AppendAssistantMessageDeltaCommand`：executor streaming 中的小批次刷库
4. `CompleteAssistantMessageCommand`：assistant 完成时封账
5. `FailAssistantMessageCommand`：assistant 失败或取消时写失败态

## 7. Route 依赖接口草案

如果要和现有 `registerTaskProjectionRoutes(...)`、`registerTaskSessionRoutes(...)` 风格对齐，建议路由依赖接口保持统一的 `{ ok, status, data, error }` 形状。

```ts
type TaskSessionMessageRouteResult<T, S extends number = 200> =
  | { ok: true; status: S; data: T }
  | { ok: false; status: 400 | 404 | 409 | 500; error: string; details?: unknown };

export interface TaskSessionMessageRouteDeps {
  postTaskSessionMessage: (
    input: PostTaskSessionMessageInput,
  ) => Promise<TaskSessionMessageRouteResult<PostTaskSessionMessageResponse, 200 | 201>>;
  listTaskSessionMessages: (
    input: ListTaskSessionMessagesInput,
  ) => Promise<TaskSessionMessageRouteResult<ListTaskSessionMessagesResponse, 200>>;
  getTaskSessionMessage?: (
    input: GetTaskSessionMessageInput,
  ) => Promise<TaskSessionMessageRouteResult<GetTaskSessionMessageResponse, 200>>;
}
```

## 8. 命名口径建议

为了避免再次混入旧 branch / compat 语义，这一版建议统一采用以下命名：

1. route 文件：`task-session-message-routes.ts`
2. dto 文件：`task-session-message-dto.ts`
3. service api 文件：`task-session-message-api.ts`
4. public route path：`/tasks/:taskId/sessions/:sessionId/messages`

避免再出现这些命名：

1. `branch`
2. `conversation`
3. `runtimeSessionId` 作为 public path 主键
4. `/branches/messages`
5. `/domain-runs/*`

## 9. 最小实施建议

真正开始写代码时，建议顺序如下：

1. 先写 `task-session-message-dto.ts`
2. 再写 `task-session-message-routes.ts`
3. 用 stub 形式实现 `task-session-message-api.ts`
4. 先让 `POST` 和 `GET list` 路由可以返回稳定 DTO
5. 再把 executor pipeline 接入内部命令 DTO

这样可以先把 API contract 固化，再逐步接真实数据库和 realtime。

## 10. 一句话总结

这一版下压后的最小实现建议是：

1. 对外只暴露 `POST messages` 和 `GET messages`
2. 路由层只做参数校验和结果包装
3. DTO 层统一输出 Zod schema 与 TypeScript 类型
4. assistant streaming 更新走服务层内部命令，不走 public PATCH route

这样可以让 service contract 从第一天起就是 sessions-native，而不是再次走向 compat patchwork。