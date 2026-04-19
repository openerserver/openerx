/// <reference types="bun-types" />

import { afterEach, describe, expect, mock, test } from "bun:test";

let importCounter = 0;

function createSqlMock(args: {
  project:
    | {
        id: string;
        orgId: string;
        name: string | null;
        status: string | null;
      }
    | null;
  taskIds: string[];
  sqlCalls: string[];
}) {
  const sqlMock = (async (strings: TemplateStringsArray, ..._values: unknown[]) => {
    const query = strings.join("?").replace(/\s+/g, " ").trim();
    args.sqlCalls.push(query);

    if (query.startsWith('SELECT id, org_id as "orgId", name, status FROM projects WHERE id = ?')) {
      return args.project ? [args.project] : [];
    }

    if (query.startsWith("SELECT id FROM tasks WHERE project_id = ?")) {
      return args.taskIds.map((id) => ({ id }));
    }

    return [];
  }) as unknown as {
    (strings: TemplateStringsArray, ...values: unknown[]): Promise<unknown[]>;
    begin: <T>(callback: (transaction: typeof sqlMock) => Promise<T>) => Promise<T>;
  };

  sqlMock.begin = async <T>(callback: (transaction: typeof sqlMock) => Promise<T>) =>
    callback(sqlMock);

  return sqlMock;
}

async function loadProjectsRoutesModule(args: {
  project:
    | {
        id: string;
        orgId: string;
        name: string | null;
        status: string | null;
      }
    | null;
  taskIds: string[];
  sqlCalls: string[];
  loadTaskDeleteNodeIdsMock: ReturnType<typeof mock>;
  deleteTaskTreeBackedTaskMock: ReturnType<typeof mock>;
}) {
  importCounter += 1;
  const postgresSql = createSqlMock({
    project: args.project,
    taskIds: args.taskIds,
    sqlCalls: args.sqlCalls,
  });

  mock.module("../../control-plane/service/src/db", () => ({
    db: { query: {} },
    postgresSql,
  }));

  mock.module("../../control-plane/service/src/modules/tasks/task-core-routes", () => ({
    loadTaskDeleteNodeIds: args.loadTaskDeleteNodeIdsMock,
    deleteTaskTreeBackedTask: args.deleteTaskTreeBackedTaskMock,
  }));

  return import(
    `../../control-plane/service/src/modules/projects/routes.ts?project-delete-cascade-test=${importCounter}`
  );
}

afterEach(() => {
  mock.restore();
});

describe("project delete cascade", () => {
  test("reuses task cleanup and removes project-scoped resources", async () => {
    const sqlCalls: string[] = [];
    const loadTaskDeleteNodeIdsMock = mock(async (taskId: string) => [taskId, `${taskId}-node`]);
    const deleteTaskTreeBackedTaskMock = mock(async () => undefined);
    const { deleteProjectCascade } = await loadProjectsRoutesModule({
      project: {
        id: "proj-1",
        orgId: "org-1",
        name: "Alpha",
        status: "active",
      },
      taskIds: ["task-1", "task-2"],
      sqlCalls,
      loadTaskDeleteNodeIdsMock,
      deleteTaskTreeBackedTaskMock,
    });

    const result = await deleteProjectCascade("proj-1", "user-1");

    expect(result).toEqual({ id: "proj-1", deletedTaskCount: 2 });
    expect(loadTaskDeleteNodeIdsMock).toHaveBeenCalledTimes(2);
    expect(deleteTaskTreeBackedTaskMock).toHaveBeenCalledTimes(2);
    expect(
      sqlCalls.some((query) => query.includes("DELETE FROM workflow_template_stages")),
    ).toBe(true);
    expect(sqlCalls.some((query) => query.includes("DELETE FROM repository_credentials"))).toBe(
      true,
    );
    expect(sqlCalls.some((query) => query.includes("DELETE FROM projects WHERE id = ?"))).toBe(
      true,
    );
    expect(sqlCalls.some((query) => query.includes("INSERT INTO audit_events"))).toBe(true);
  });

  test("returns null when the project does not exist", async () => {
    const sqlCalls: string[] = [];
    const loadTaskDeleteNodeIdsMock = mock(async () => []);
    const deleteTaskTreeBackedTaskMock = mock(async () => undefined);
    const { deleteProjectCascade } = await loadProjectsRoutesModule({
      project: null,
      taskIds: [],
      sqlCalls,
      loadTaskDeleteNodeIdsMock,
      deleteTaskTreeBackedTaskMock,
    });

    const result = await deleteProjectCascade("proj-missing", "user-1");

    expect(result).toBeNull();
    expect(loadTaskDeleteNodeIdsMock).not.toHaveBeenCalled();
    expect(deleteTaskTreeBackedTaskMock).not.toHaveBeenCalled();
    expect(sqlCalls).toEqual([
      'SELECT id, org_id as "orgId", name, status FROM projects WHERE id = ?',
    ]);
  });
});