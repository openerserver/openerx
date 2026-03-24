/// <reference types="bun-types" />

import { mock } from "bun:test";

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
      query: () => undefined,
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
