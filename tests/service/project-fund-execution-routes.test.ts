/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { Hono } from "../../control-plane/service/node_modules/hono";

let importCounter = 0;

type FundRow = {
  id: string;
  projectId: string;
  currency: string;
  totalGranted: number;
  reserved: number;
  consumed: number;
  status: "active" | "depleted";
  createdAt: string;
  updatedAt: string;
};

const mockState: {
  currentFund: FundRow | null;
} = {
  currentFund: null,
};

function createTransactionMock() {
  return {
    select: mock(() => ({
      from: mock(() => ({
        where: mock(() => ({
          limit: mock(async () => (mockState.currentFund ? [mockState.currentFund] : [])),
        })),
      })),
    })),
    insert: mock(() => ({
      values: mock(async () => undefined),
    })),
    update: mock(() => ({
      set: mock(() => ({
        where: mock(async () => undefined),
      })),
    })),
  };
}

mock.module("../../control-plane/service/src/middleware/auth", () => ({
  authMiddleware: async (
    c: { set: (key: string, value: unknown) => void },
    next: () => Promise<void>,
  ) => {
    c.set("user", {
      sub: "user-1",
      role: "project_admin",
      projects: [{ id: "proj-1", role: "project_admin" }],
    });
    await next();
  },
}));

mock.module("../../control-plane/service/src/middleware/rbac", () => ({
  requireProjectRole:
    () => async (_c: unknown, next: () => Promise<void>) => {
      await next();
    },
  requireRole:
    () => async (_c: unknown, next: () => Promise<void>) => {
      await next();
    },
}));

mock.module("../../control-plane/service/src/db", () => ({
  db: {
    query: {
      projects: {
        findFirst: mock(async () => ({ id: "proj-1" })),
      },
    },
    insert: mock(() => ({
      values: mock(async () => undefined),
    })),
    transaction: mock(async (callback: (tx: ReturnType<typeof createTransactionMock>) => Promise<unknown>) => {
      return callback(createTransactionMock());
    }),
  },
}));

async function loadProjectRoutesModule() {
  importCounter += 1;
  return import(
    `../../control-plane/service/src/modules/projects/routes.ts?project-fund-execution-routes-test=${importCounter}`
  );
}

async function requestProjectFundMutation(path: string, body: Record<string, unknown>) {
  const { projectRoutes } = await loadProjectRoutesModule();
  const app = new Hono();
  app.route("/api/projects", projectRoutes);

  return app.request(`http://localhost/api/projects/proj-1${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

async function requestProjectRoute(path: string, init?: RequestInit) {
  const { projectRoutes } = await loadProjectRoutesModule();
  const app = new Hono();
  app.route("/api/projects", projectRoutes);

  return app.request(`http://localhost/api/projects/proj-1${path}`, init);
}

beforeEach(() => {
  mockState.currentFund = {
    id: "fund-1",
    projectId: "proj-1",
    currency: "USD",
    totalGranted: 100,
    reserved: 20,
    consumed: 10,
    status: "active",
    createdAt: "2026-04-14T00:00:00.000Z",
    updatedAt: "2026-04-14T00:00:00.000Z",
  };
});

afterEach(() => {
  mockState.currentFund = null;
  mock.restore();
});

describe("project fund execution routes", () => {
  test("does not expose the retired paid execution lease route", async () => {
    const response = await requestProjectRoute("/paid-execution-lease");

    expect(response.status).toBe(404);
  });

  test("registers and serves reserve mutations", async () => {
    const response = await requestProjectFundMutation("/fund/reserve", {
      amountUsd: 15,
      modelRoute: "github-copilot:gpt-5.4",
      taskId: "task-1",
      runtimeSessionId: "session-1",
      note: "execution preflight reservation",
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      fund: {
        projectId: "proj-1",
        reserved: 35,
        consumed: 10,
        available: 55,
      },
      ledgerEntry: {
        type: "reserve",
        amountUsd: 15,
        taskId: "task-1",
        runtimeSessionId: "session-1",
      },
    });
  });

  test("registers and serves consume mutations", async () => {
    const response = await requestProjectFundMutation("/fund/consume", {
      amountUsd: 15,
      modelRoute: "github-copilot:gpt-5.4",
      taskId: "task-2",
      runtimeSessionId: "session-2",
      note: "runtime settlement",
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      fund: {
        projectId: "proj-1",
        reserved: 5,
        consumed: 25,
        available: 70,
      },
      ledgerEntry: {
        type: "consume",
        amountUsd: 15,
        taskId: "task-2",
        runtimeSessionId: "session-2",
      },
    });
  });

  test("registers and serves refund mutations", async () => {
    const response = await requestProjectFundMutation("/fund/refund", {
      amountUsd: 15,
      modelRoute: "github-copilot:gpt-5.4",
      taskId: "task-3",
      runtimeSessionId: "session-3",
      note: "execution cancelled",
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      fund: {
        projectId: "proj-1",
        reserved: 5,
        consumed: 10,
        available: 85,
      },
      ledgerEntry: {
        type: "refund",
        amountUsd: 15,
        taskId: "task-3",
        runtimeSessionId: "session-3",
      },
    });
  });
});