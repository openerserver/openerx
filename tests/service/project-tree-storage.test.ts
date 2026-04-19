/// <reference types="bun-types" />

import { afterEach, describe, expect, mock, test } from "bun:test";
import { assertSessionNodeLineageOnlyContentJson } from "./task-route-test-helpers";

let importCounter = 0;

async function loadProjectTreeStorageModule(args?: {
  existingNode?: Record<string, unknown> | null;
  findFirstResults?: Array<Record<string, unknown> | null>;
  failNodeInsertOnce?: boolean;
  failBranchInsertOnce?: boolean;
}) {
  importCounter += 1;

  const insertedNodeValues: Array<Record<string, unknown>> = [];
  const insertedBranchValues: Array<Record<string, unknown>> = [];
  const updatedNodeValues: Array<Record<string, unknown>> = [];

  const taskNode = {
    id: "task-1",
    projectId: "project-1",
    path: "project_project_1.task_task_1",
    depth: 1,
  };
  const parentNode = {
    id: "task_session:task-1:root-session-1",
    projectId: "project-1",
    path: "project_project_1.task_task_1.session_task_session_task_1_root_session_1",
    depth: 2,
  };

  let shouldFailNodeInsertOnce = args?.failNodeInsertOnce === true;
  let shouldFailBranchInsertOnce = args?.failBranchInsertOnce === true;

  let projectTreeNodeFindFirstCall = 0;
  const explicitFindFirstResults = [...(args?.findFirstResults ?? [])];

  const fakeDb = {
    query: {
      projectTreeNodes: {
        findFirst: mock(async () => {
          if (explicitFindFirstResults.length > 0) {
            return explicitFindFirstResults.shift() ?? null;
          }
          projectTreeNodeFindFirstCall += 1;
          if (projectTreeNodeFindFirstCall === 1) {
            return taskNode;
          }
          if (projectTreeNodeFindFirstCall === 2) {
            return parentNode;
          }
          return args?.existingNode ?? null;
        }),
      },
      projectTreeBranches: {
        findFirst: mock(async () => null),
      },
    },
    insert: mock((_table: unknown) => ({
      values: async (payload: Record<string, unknown>) => {
        if ("nodeType" in payload) {
          if (shouldFailNodeInsertOnce) {
            shouldFailNodeInsertOnce = false;
            throw new Error(
              'duplicate key value violates unique constraint "project_tree_nodes_pkey"',
            );
          }
          insertedNodeValues.push(payload);
          return;
        }
        if (shouldFailBranchInsertOnce) {
          shouldFailBranchInsertOnce = false;
          throw new Error(
            'duplicate key value violates unique constraint "idx_ptb_task_branch_unique"',
          );
        }
        insertedBranchValues.push(payload);
      },
    })),
    update: mock((_table: unknown) => ({
      set: (payload: Record<string, unknown>) => ({
        where: async () => {
          updatedNodeValues.push(payload);
        },
      }),
    })),
    execute: mock(async () => undefined),
  };

  mock.module("../../control-plane/service/src/db", () => ({
    db: fakeDb,
  }));

  const module = await import(
    `../../control-plane/service/src/modules/project-tree/storage.ts?project-tree-storage-test=${importCounter}`
  );

  return {
    ...module,
    insertedNodeValues,
    insertedBranchValues,
    updatedNodeValues,
  };
}

afterEach(() => {
  mock.restore();
});

describe("project tree storage", () => {
  test("creates session nodes with lineage-only whitelist content_json", async () => {
    const { upsertTaskBranchCompatTreeNode, insertedNodeValues, insertedBranchValues } =
      await loadProjectTreeStorageModule();

    const nodeId = await upsertTaskBranchCompatTreeNode({
      taskId: "task-1",
      runtimeSessionId: "fork-session-1",
      parentRuntimeSessionId: "root-session-1",
      forkedFromMessageId: "msg-1",
      branchName: "feature/fork",
      sourceType: "fork",
      isActive: true,
      archivedAt: null,
    });

    expect(nodeId).toBe("branch-node:task-1:fork-session-1");
    expect(insertedNodeValues).toHaveLength(1);
    expect(insertedBranchValues).toHaveLength(1);
    expect(insertedNodeValues[0]).toMatchObject({
      id: "branch-node:task-1:fork-session-1",
      parentId: "task_session:task-1:root-session-1",
      nodeType: "session",
      runtimeSessionId: "fork-session-1",
      branchName: "feature/fork",
      isActive: true,
    });
    assertSessionNodeLineageOnlyContentJson(
      insertedNodeValues[0]?.contentJson as Record<string, unknown> | null | undefined,
      {
        sourceType: "fork",
        parentRuntimeSessionId: "root-session-1",
        forkedFromMessageId: "msg-1",
      },
    );
  });

  test("updates existing session nodes without expanding lineage-only whitelist content_json", async () => {
    const { upsertTaskBranchCompatTreeNode, updatedNodeValues } =
      await loadProjectTreeStorageModule({
        existingNode: {
          id: "task_session:task-1:fork-session-1",
          contentText: "existing-branch",
          branchName: "existing-branch",
          createdAt: "2026-03-24T00:00:00.000Z",
          isActive: false,
        },
      });

    const nodeId = await upsertTaskBranchCompatTreeNode({
      taskId: "task-1",
      runtimeSessionId: "fork-session-1",
      parentRuntimeSessionId: "root-session-1",
      forkedFromMessageId: "msg-2",
      branchName: "feature/fork-updated",
      sourceType: "fork",
      isActive: true,
      archivedAt: null,
    });

    expect(nodeId).toBe("task_session:task-1:fork-session-1");
    expect(updatedNodeValues).not.toHaveLength(0);
    assertSessionNodeLineageOnlyContentJson(
      updatedNodeValues[0]?.contentJson as Record<string, unknown> | null | undefined,
      {
        sourceType: "fork",
        parentRuntimeSessionId: "root-session-1",
        forkedFromMessageId: "msg-2",
      },
    );
    expect(updatedNodeValues[0]).toMatchObject({
      runtimeSessionId: "fork-session-1",
      branchName: "feature/fork-updated",
      isActive: true,
    });
  });

  test("skips rewriting existing active session nodes when lineage and state are unchanged", async () => {
    const { upsertTaskBranchCompatTreeNode, updatedNodeValues } =
      await loadProjectTreeStorageModule({
        existingNode: {
          id: "task_session:task-1:fork-session-1",
          parentId: "task_session:task-1:root-session-1",
          path: "project_project_1.task_task_1.session_task_session_task_1_root_session_1.session_task_session_task_1_fork_session_1",
          depth: 3,
          contentText: "feature/fork",
          contentJson: {
            sourceType: "fork",
            parentRuntimeSessionId: "root-session-1",
            forkedFromMessageId: null,
          },
          refType: "conversation_session",
          refId: "task_session:task-1:fork-session-1",
          runtimeSessionId: "fork-session-1",
          branchName: "feature/fork",
          createdAt: "2026-03-24T00:00:00.000Z",
          isActive: true,
          archivedAt: null,
        },
      });

    const nodeId = await upsertTaskBranchCompatTreeNode({
      taskId: "task-1",
      runtimeSessionId: "fork-session-1",
      parentRuntimeSessionId: "root-session-1",
      branchName: "feature/fork",
      sourceType: "fork",
      isActive: true,
      archivedAt: null,
    });

    expect(nodeId).toBe("task_session:task-1:fork-session-1");
    expect(updatedNodeValues).toHaveLength(0);
  });

  test("archives session nodes without rewriting lineage-only whitelist content_json", async () => {
    const { archiveTaskBranchCompatTreeNode, updatedNodeValues } =
      await loadProjectTreeStorageModule({
        findFirstResults: [{ id: "branch-node:task-1:fork-session-1" }, null],
      });

    await archiveTaskBranchCompatTreeNode("task-1", "fork-session-1");

    expect(updatedNodeValues).toHaveLength(1);
    expect(updatedNodeValues[0]).toMatchObject({
      isActive: false,
      archivedAt: expect.any(String),
      updatedAt: expect.any(String),
    });
    expect(updatedNodeValues[0]).not.toHaveProperty("contentJson");
  });

  test("prefers legacy compat node ids when an existing node already uses the old prefix", async () => {
    const { upsertTaskBranchCompatTreeNode, updatedNodeValues } =
      await loadProjectTreeStorageModule({
        existingNode: {
          id: "task_session:task-1:fork-session-1",
          contentText: "legacy-branch",
          branchName: "legacy-branch",
          createdAt: "2026-03-24T00:00:00.000Z",
          isActive: false,
        },
      });

    const nodeId = await upsertTaskBranchCompatTreeNode({
      taskId: "task-1",
      runtimeSessionId: "fork-session-1",
      parentRuntimeSessionId: "root-session-1",
      branchName: "legacy-updated",
      sourceType: "fork",
      isActive: true,
      archivedAt: null,
    });

    expect(nodeId).toBe("task_session:task-1:fork-session-1");
    expect(updatedNodeValues[0]).toMatchObject({
      branchName: "legacy-updated",
      runtimeSessionId: "fork-session-1",
    });
  });

  test("falls back to update when concurrent insert hits project_tree_nodes primary key conflict", async () => {
    const { upsertTaskBranchCompatTreeNode, insertedNodeValues, insertedBranchValues, updatedNodeValues } =
      await loadProjectTreeStorageModule({
        failNodeInsertOnce: true,
      });

    const nodeId = await upsertTaskBranchCompatTreeNode({
      taskId: "task-1",
      runtimeSessionId: "fork-session-1",
      parentRuntimeSessionId: "root-session-1",
      branchName: "feature/fork-race",
      sourceType: "fork",
      isActive: true,
      archivedAt: null,
    });

    expect(nodeId).toBe("branch-node:task-1:fork-session-1");
    expect(insertedNodeValues).toHaveLength(0);
    expect(updatedNodeValues).not.toHaveLength(0);
    expect(insertedBranchValues).toHaveLength(1);
    expect(updatedNodeValues[0]).toMatchObject({
      runtimeSessionId: "fork-session-1",
      branchName: "feature/fork-race",
      isActive: true,
    });
  });

  test("falls back to branch head update when concurrent insert hits task branch unique index", async () => {
    const { upsertTaskBranchCompatTreeNode, insertedNodeValues, insertedBranchValues, updatedNodeValues } =
      await loadProjectTreeStorageModule({
        failBranchInsertOnce: true,
      });

    const nodeId = await upsertTaskBranchCompatTreeNode({
      taskId: "task-1",
      runtimeSessionId: "fork-session-1",
      parentRuntimeSessionId: "root-session-1",
      branchName: "feature/fork-race",
      sourceType: "fork",
      isActive: true,
      archivedAt: null,
    });

    expect(nodeId).toBe("branch-node:task-1:fork-session-1");
    expect(insertedNodeValues).toHaveLength(1);
    expect(insertedBranchValues).toHaveLength(0);
    expect(updatedNodeValues).not.toHaveLength(0);
    expect(updatedNodeValues.at(-1)).toMatchObject({
      headNodeId: "branch-node:task-1:fork-session-1",
    });
  });
});
