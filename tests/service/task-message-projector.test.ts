import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import postgres from "../../control-plane/service/node_modules/postgres";

const DATABASE_URL = process.env.DATABASE_URL?.startsWith("postgres://")
  ? process.env.DATABASE_URL
  : "postgres://127.0.0.1:5432/openerx";

process.env.DATABASE_DIALECT = "postgres";
process.env.DATABASE_URL = DATABASE_URL;

const sql = postgres(DATABASE_URL, { max: 1, prepare: false });

const TEST_TASK_ID = `projector-test-${Date.now()}`;
const TEST_SESSION_ID = `projector-sess-${Date.now()}`;
const TEST_PROJECT_ID = "proj-default";
const TEST_MSG_ID = `msg-proj-${Date.now()}`;
const TEST_TOOL_CALL_ID = `tc-${Date.now()}`;
const TEST_MESSAGE_CREATED_AT = new Date(Date.now() + 1_000).toISOString();
const TEST_MESSAGE_COMPLETED_AT = new Date(Date.now() + 5_000).toISOString();
const TEST_SESSION_WRITE_ID = `task-session:${TEST_TASK_ID}:${TEST_SESSION_ID}`;
const TEST_RUN_ID = `run_${TEST_SESSION_WRITE_ID}`;
const TEST_MESSAGE_WRITE_ID = `task-session-message:${TEST_SESSION_WRITE_ID}:${TEST_MSG_ID}`;

describe("task-message-projector", () => {
  type TaskMessageProjectorModule = typeof import("../../control-plane/service/src/modules/tasks/task-message-projector");

  let projectPendingEvents: TaskMessageProjectorModule["projectPendingEvents"];

  beforeAll(async () => {
    const mod = await import(
      "../../control-plane/service/src/modules/tasks/task-message-projector"
    );
    projectPendingEvents = mod.projectPendingEvents;

    await sql`
      INSERT INTO tasks (id, project_id, title, prompt, created_at, updated_at)
      VALUES (${TEST_TASK_ID}, ${TEST_PROJECT_ID}, 'projector test task', 'test', NOW()::text, NOW()::text)
    `;

    await sql`
      INSERT INTO task_message_events (task_id, session_id, event_type, runtime_message_id, payload, projected, created_at)
      VALUES
        (${TEST_TASK_ID}, ${TEST_SESSION_ID}, 'message.updated', ${TEST_MSG_ID}, ${sql.json({
          info: { id: TEST_MSG_ID, role: "assistant" },
          createdAt: TEST_MESSAGE_CREATED_AT,
          parts: [{ type: "text", text: "Hello from projector test" }],
        })}, false, NOW()::text),
        (${TEST_TASK_ID}, ${TEST_SESSION_ID}, 'message.part.updated', ${TEST_MSG_ID}, ${sql.json({
          info: {
            id: TEST_MSG_ID,
            role: "assistant",
            time: { created: TEST_MESSAGE_CREATED_AT, completed: TEST_MESSAGE_COMPLETED_AT },
          },
          parts: [
            { type: "text", text: "Hello from projector test - updated" },
            {
              type: "tool-call",
              toolCallId: TEST_TOOL_CALL_ID,
              toolName: "readFile",
              args: { path: "README.md" },
            },
            {
              type: "tool-result",
              toolCallId: TEST_TOOL_CALL_ID,
              toolName: "readFile",
              state: { status: "completed", output: "README body" },
            },
          ],
        })}, false, NOW()::text)
    `;
  });

  afterAll(async () => {
    await sql`DELETE FROM task_timeline_views WHERE task_id = ${TEST_TASK_ID}`;
    await sql`DELETE FROM task_artifacts WHERE task_id = ${TEST_TASK_ID}`;
    await sql`DELETE FROM task_operations WHERE task_id = ${TEST_TASK_ID}`;
    await sql`DELETE FROM task_message_parts WHERE message_id = ${TEST_MESSAGE_WRITE_ID}`;
    await sql`
      UPDATE task_sessions
      SET status = 'running', head_message_id = NULL, latest_run_id = NULL
      WHERE task_id = ${TEST_TASK_ID}
    `;
    await sql`DELETE FROM task_messages WHERE task_id = ${TEST_TASK_ID}`;
    await sql`DELETE FROM task_sessions WHERE task_id = ${TEST_TASK_ID}`;
    await sql`DELETE FROM task_session_runs WHERE task_id = ${TEST_TASK_ID}`;
    await sql`DELETE FROM task_message_events WHERE task_id = ${TEST_TASK_ID}`;
    await sql`DELETE FROM tasks WHERE id = ${TEST_TASK_ID}`;
    await sql.end();
  });

  test("projects unprojected events into canonical task-domain tables", async () => {
    const pendingBefore = await sql`
      SELECT count(*)::int AS "count"
      FROM task_message_events
      WHERE projected = false
    `;

    const result = await projectPendingEvents(Number(pendingBefore[0]?.count ?? 0) + 10);

    expect(result.processed + result.failed).toBeGreaterThanOrEqual(
      Number(pendingBefore[0]?.count ?? 0),
    );

    const events = await sql`
      SELECT id, projected FROM task_message_events
      WHERE task_id = ${TEST_TASK_ID}
      ORDER BY id
    `;
    const failedEventIds = events
      .filter((event) => event.projected !== true)
      .map((event) => Number(event.id));
    expect(result.errors.filter((error) => failedEventIds.includes(error.eventId))).toEqual([]);
    expect(events.length).toBe(2);
    expect(events[0].projected).toBe(true);
    expect(events[1].projected).toBe(true);

    const sessions = await sql`
      SELECT id, runtime_session_id AS "runtimeSessionId", latest_run_id AS "latestRunId", status
      FROM task_sessions
      WHERE task_id = ${TEST_TASK_ID}
    `;
    expect(sessions).toEqual([
      expect.objectContaining({
        id: TEST_SESSION_WRITE_ID,
        runtimeSessionId: TEST_SESSION_ID,
        latestRunId: TEST_RUN_ID,
        status: "completed",
      }),
    ]);

    const runs = await sql`
      SELECT
        id,
        session_id AS "sessionId",
        runtime_session_id AS "runtimeSessionId",
        execution_kind AS "executionKind",
        lane_role AS "laneRole",
        status,
        result_summary AS "resultSummary"
      FROM task_session_runs
      WHERE task_id = ${TEST_TASK_ID}
    `;
    expect(runs).toEqual([
      expect.objectContaining({
        id: TEST_RUN_ID,
        sessionId: TEST_SESSION_WRITE_ID,
        runtimeSessionId: TEST_SESSION_ID,
        executionKind: "single",
        laneRole: "primary",
        status: "completed",
        resultSummary: "Hello from projector test - updated",
      }),
    ]);

    const messages = await sql`
      SELECT
        id,
        session_id AS "sessionId",
        created_by_run_id AS "createdByRunId",
        role,
        text_content AS "textContent",
        part_count AS "partCount",
        status
      FROM task_messages
      WHERE task_id = ${TEST_TASK_ID}
    `;
    expect(messages).toEqual([
      expect.objectContaining({
        id: TEST_MESSAGE_WRITE_ID,
        sessionId: TEST_SESSION_WRITE_ID,
        createdByRunId: TEST_RUN_ID,
        role: "assistant",
        textContent: "Hello from projector test - updated",
        partCount: 3,
        status: "completed",
      }),
    ]);

    const parts = await sql`
      SELECT part_type AS "partType" FROM task_message_parts
      WHERE message_id = ${TEST_MESSAGE_WRITE_ID}
      ORDER BY part_index
    `;
    expect(parts.map((part) => part.partType)).toEqual(["text", "tool_call", "tool_result"]);

    const operations = await sql`
      SELECT
        id,
        session_id AS "sessionId",
        run_id AS "runId",
        message_id AS "messageId",
        runtime_operation_id AS "runtimeOperationId",
        operation_kind AS "operationKind",
        tool_name AS "toolName",
        status
      FROM task_operations
      WHERE task_id = ${TEST_TASK_ID}
    `;
    expect(operations).toEqual([
      expect.objectContaining({
        sessionId: TEST_SESSION_WRITE_ID,
        runId: TEST_RUN_ID,
        messageId: TEST_MESSAGE_WRITE_ID,
        runtimeOperationId: TEST_TOOL_CALL_ID,
        operationKind: "tool_call",
        toolName: "readFile",
        status: "completed",
      }),
    ]);

    const artifacts = await sql`
      SELECT
        message_id AS "messageId",
        operation_id AS "operationId",
        artifact_kind AS "artifactKind",
        title,
        content_text AS "contentText"
      FROM task_artifacts
      WHERE task_id = ${TEST_TASK_ID}
    `;
    expect(artifacts).toEqual([
      expect.objectContaining({
        messageId: TEST_MESSAGE_WRITE_ID,
        operationId: operations[0].id,
        artifactKind: "result",
        title: "readFile result",
        contentText: "README body",
      }),
    ]);

    const timeline = await sql`
      SELECT id, message_id AS "messageId", item_kind AS "itemKind", item_role AS "itemRole"
      FROM task_timeline_views
      WHERE task_id = ${TEST_TASK_ID}
    `;
    expect(timeline).toEqual([
      expect.objectContaining({
        id: `task-timeline:message:${TEST_MESSAGE_WRITE_ID}`,
        messageId: TEST_MESSAGE_WRITE_ID,
        itemKind: "message",
        itemRole: "assistant",
      }),
    ]);
  });

  test("is idempotent on a second pass", async () => {
    const countsBefore = await sql`
      SELECT
        (SELECT count(*)::int FROM task_messages WHERE task_id = ${TEST_TASK_ID}) AS "messageCount",
        (SELECT count(*)::int FROM task_message_parts WHERE message_id = ${TEST_MESSAGE_WRITE_ID}) AS "partCount",
        (SELECT count(*)::int FROM task_operations WHERE task_id = ${TEST_TASK_ID}) AS "operationCount",
        (SELECT count(*)::int FROM task_artifacts WHERE task_id = ${TEST_TASK_ID}) AS "artifactCount",
        (SELECT count(*)::int FROM task_timeline_views WHERE task_id = ${TEST_TASK_ID}) AS "timelineCount"
    `;
    const pendingBefore = await sql`
      SELECT count(*)::int AS "count"
      FROM task_message_events
      WHERE projected = false
    `;

    await projectPendingEvents(Number(pendingBefore[0]?.count ?? 0) + 10);

    const countsAfter = await sql`
      SELECT
        (SELECT count(*)::int FROM task_messages WHERE task_id = ${TEST_TASK_ID}) AS "messageCount",
        (SELECT count(*)::int FROM task_message_parts WHERE message_id = ${TEST_MESSAGE_WRITE_ID}) AS "partCount",
        (SELECT count(*)::int FROM task_operations WHERE task_id = ${TEST_TASK_ID}) AS "operationCount",
        (SELECT count(*)::int FROM task_artifacts WHERE task_id = ${TEST_TASK_ID}) AS "artifactCount",
        (SELECT count(*)::int FROM task_timeline_views WHERE task_id = ${TEST_TASK_ID}) AS "timelineCount"
    `;

    expect(countsAfter).toEqual(countsBefore);
  });
});
