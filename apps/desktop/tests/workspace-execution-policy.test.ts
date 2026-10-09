import { expect, test } from "vitest";
import {
  assertWorkspaceExecutionAllowed,
  assertWorkspaceRemoteAllowed,
} from "../src/main/workspace-execution-policy";

const personalCommands = [
  "chat.send",
  "chat.get",
  "chat.list",
  "chat.search",
  "chat.stop",
  "file.import",
  "file.list",
  "file.preview",
  "artifact.get",
  "project.list",
  "project.create",
  "conversation.moveToProject",
  "memory.list",
  "data.export",
  "sync.now",
  "cache.clear",
  "model.connection.test",
  "usage.byok.list",
  "mcp.servers.list",
  "tool.permission.resolve",
  "automation.list",
  "automation.pause",
  "automation.create",
  "automation.execution",
];

test.each(personalCommands)(
  "personal workspace permits %s for guests and nonmembers",
  (command) => {
    expect(() => assertWorkspaceExecutionAllowed("personal", command)).not.toThrow();
  },
);

test.each(personalCommands)("enterprise authority cannot access personal %s", (command) => {
  for (const mode of ["enterprise", "resolving"] as const) {
    expect(() => assertWorkspaceExecutionAllowed(mode, command)).toThrow(
      "ENTERPRISE_WORKSPACE_REQUIRED",
    );
  }
});

test.each([
  undefined,
  { kind: "project.list" },
  { kind: "task.start" },
  { kind: "session.prompt" },
  { kind: "session.abort" },
  { kind: "permission.decide", decision: "deny" },
  { kind: "permission.decide", decision: "once" },
])("remote operations use the same account boundary: %j", (payload) => {
  expect(() => assertWorkspaceRemoteAllowed("personal", payload)).not.toThrow();
  expect(() => assertWorkspaceRemoteAllowed("enterprise", payload)).toThrow(
    "ENTERPRISE_WORKSPACE_REQUIRED",
  );
  expect(() => assertWorkspaceRemoteAllowed("resolving", payload)).toThrow(
    "ENTERPRISE_WORKSPACE_REQUIRED",
  );
});
