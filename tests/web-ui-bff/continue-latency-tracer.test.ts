/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  __peekContinueLatencyTraceForTests,
  __resetContinueLatencyTracesForTests,
  beginContinueLatencyTrace,
  handoffContinueLatencyTrace,
  markContinueLatencyStage,
  noteContinueLatencyRuntimeEvent,
  noteContinueLatencyTaskDomainEvent,
} from "../../control-plane/web-ui-bff/src/modules/agent-control/continue-latency-tracer";

describe("continue latency tracer", () => {
  const originalDebug = process.env.OPENERX_CONTINUE_LATENCY_DEBUG;

  beforeEach(() => {
    process.env.OPENERX_CONTINUE_LATENCY_DEBUG = "0";
    __resetContinueLatencyTracesForTests();
  });

  afterEach(() => {
    if (originalDebug === undefined) {
      delete process.env.OPENERX_CONTINUE_LATENCY_DEBUG;
    } else {
      process.env.OPENERX_CONTINUE_LATENCY_DEBUG = originalDebug;
    }
    __resetContinueLatencyTracesForTests();
  });

  test("records the first runtime and task message milestones for a continued session", () => {
    beginContinueLatencyTrace({
      sessionId: "session-1",
      taskId: "task-1",
      prompt: "继续执行",
    });
    markContinueLatencyStage("session-1", "runtime-continue-entered", {
      taskId: "task-1",
      promptLength: 4,
    });
    markContinueLatencyStage("session-1", "runtime-handle-ready", {
      taskId: "task-1",
      promptLength: 4,
    });
    markContinueLatencyStage("session-1", "runtime-model-ready", {
      taskId: "task-1",
      promptLength: 4,
    });
    markContinueLatencyStage("session-1", "runtime-agent-run-ready", {
      taskId: "task-1",
      promptLength: 4,
    });
    markContinueLatencyStage("session-1", "runtime-dispatch-begin", {
      taskId: "task-1",
      promptLength: 4,
      wasRunning: false,
      dispatchMode: "prompt",
    });
    markContinueLatencyStage("session-1", "runtime-dispatch-resolved", {
      taskId: "task-1",
      promptLength: 4,
      wasRunning: false,
      dispatchMode: "prompt",
    });

    noteContinueLatencyRuntimeEvent("session-1", "agent_start");
    noteContinueLatencyRuntimeEvent("session-1", "message_start", { role: "assistant" });
    noteContinueLatencyTaskDomainEvent("session-1", "task.snapshot.updated");
    noteContinueLatencyTaskDomainEvent("session-1", "task.message.updated", {
      role: "assistant",
    });

    const trace = __peekContinueLatencyTraceForTests("session-1");
    expect(trace).toMatchObject({
      taskId: "task-1",
      sessionId: "session-1",
      promptLength: 4,
      wasRunning: false,
      dispatchMode: "prompt",
      firstRawRuntimeEventType: "agent_start",
      firstAssistantRuntimeEventType: "message_start",
      firstTaskDomainEventType: "task.snapshot.updated",
      firstTaskMessageEventType: "task.message.updated",
    });
    expect(trace?.completedAtMs).toBeDefined();
    expect(trace?.stages["route-received"]).toBeDefined();
    expect(trace?.stages["runtime-dispatch-resolved"]).toBeDefined();
  });

  test("keeps only the first raw and task message milestones", () => {
    beginContinueLatencyTrace({
      sessionId: "session-2",
      taskId: "task-2",
      prompt: "hello",
    });

    noteContinueLatencyRuntimeEvent("session-2", "agent_start");
    noteContinueLatencyRuntimeEvent("session-2", "message_update", { role: "assistant" });
    noteContinueLatencyTaskDomainEvent("session-2", "task.message.delta", { partType: "text" });
    noteContinueLatencyTaskDomainEvent("session-2", "task.message.updated");

    const trace = __peekContinueLatencyTraceForTests("session-2");
    expect(trace).toMatchObject({
      firstRawRuntimeEventType: "agent_start",
      firstAssistantRuntimeEventType: "message_update",
      firstTaskDomainEventType: "task.message.delta",
      firstTaskMessageEventType: "task.message.delta:text",
    });
  });

  test("moves an in-flight trace to the child follow-up session", () => {
    beginContinueLatencyTrace({
      sessionId: "session-parent",
      taskId: "task-3",
      prompt: "新的 follow-up",
    });

    handoffContinueLatencyTrace({
      fromSessionId: "session-parent",
      toSessionId: "session-child",
      taskId: "task-3",
      promptLength: 12,
    });
    markContinueLatencyStage("session-child", "runtime-continue-entered", {
      taskId: "task-3",
      promptLength: 12,
    });

    expect(__peekContinueLatencyTraceForTests("session-parent")).toBeNull();
    expect(__peekContinueLatencyTraceForTests("session-child")).toMatchObject({
      taskId: "task-3",
      sessionId: "session-child",
      promptLength: 12,
    });
  });
});
