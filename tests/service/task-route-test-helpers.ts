/// <reference types="bun-types" />

import { expect, mock } from "bun:test";

export function createRouteCollector() {
  const routes = new Map<string, Array<unknown>>();

  return {
    routes,
    get(path: string, ...handlers: Array<unknown>) {
      routes.set(`GET ${path}`, handlers);
      return this;
    },
    post(path: string, ...handlers: Array<unknown>) {
      routes.set(`POST ${path}`, handlers);
      return this;
    },
  };
}

export type TaskRouteCollector = ReturnType<typeof createRouteCollector>;

export function createRouteContext(options: {
  params?: Record<string, string>;
  query?: Record<string, string>;
  validJson?: unknown;
  userRole?: string;
}) {
  const json = mock(
    (data: unknown, status?: number) =>
      new Response(JSON.stringify(data), {
        status: status ?? 200,
        headers: { "Content-Type": "application/json" },
      }),
  );

  return {
    json,
    req: {
      param: (name: string) => options.params?.[name] ?? "",
      valid: (_target: string) => options.validJson,
      query: (name: string) => options.query?.[name],
    },
    get: () => ({ role: options.userRole ?? "developer" }),
  };
}

export type TaskRouteTestContext = ReturnType<typeof createRouteContext>;
export type TaskRouteHandler = (context: TaskRouteTestContext) => Promise<Response>;

export function getLastRouteHandler(routeCollector: TaskRouteCollector, routeKey: string) {
  return routeCollector.routes.get(routeKey)?.at(-1) as TaskRouteHandler | undefined;
}

export function getRequiredRouteHandler(routeCollector: TaskRouteCollector, routeKey: string) {
  const handler = getLastRouteHandler(routeCollector, routeKey);
  if (!handler) {
    throw new Error(`Missing route handler for ${routeKey}`);
  }

  return handler;
}

export function invokeRouteHandler(handler: TaskRouteHandler, context: TaskRouteTestContext) {
  return handler(context);
}

export function assertSessionNodeLineageOnlyContentJson(
  contentJson: Record<string, unknown> | null | undefined,
  expected: {
    sourceType: string;
    parentRuntimeSessionId: string | null;
    forkedFromMessageId: string | null;
  },
) {
  expect(contentJson).toEqual({
    sourceType: expected.sourceType,
    parentRuntimeSessionId: expected.parentRuntimeSessionId,
    forkedFromMessageId: expected.forkedFromMessageId,
  });
  expect(Object.keys(contentJson ?? {}).sort()).toEqual([
    "forkedFromMessageId",
    "parentRuntimeSessionId",
    "sourceType",
  ]);
  expect(contentJson).not.toHaveProperty("status");
  expect(contentJson).not.toHaveProperty("sessionId");
  expect(contentJson).not.toHaveProperty("result");
  expect(contentJson).not.toHaveProperty("strategy");
  expect(contentJson).not.toHaveProperty("selectedModel");
  expect(contentJson).not.toHaveProperty("workingBranch");
  expect(contentJson).not.toHaveProperty("executionMode");
  expect(contentJson).not.toHaveProperty("autoAdvanceStages");
  expect(contentJson).not.toHaveProperty("executionPlan");
  expect(contentJson).not.toHaveProperty("parallelRunHistory");
  expect(contentJson).not.toHaveProperty("startedAt");
  expect(contentJson).not.toHaveProperty("finishedAt");
  expect(contentJson).not.toHaveProperty("changesSummary");
  expect(contentJson).not.toHaveProperty("gitAuthorName");
  expect(contentJson).not.toHaveProperty("gitAuthorEmail");
  expect(contentJson).not.toHaveProperty("gitCommitterName");
  expect(contentJson).not.toHaveProperty("gitCommitterEmail");
  expect(contentJson).not.toHaveProperty("finalCommitSha");
  expect(contentJson).not.toHaveProperty("finalBranchName");
}
