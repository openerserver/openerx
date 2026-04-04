import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import postgres from "../../control-plane/service/node_modules/postgres";

const DATABASE_URL = process.env.DATABASE_URL || "postgres://127.0.0.1:5432/openerx";
const sql = postgres(DATABASE_URL, { max: 1, prepare: false });

const TEST_TASK_ID = `projector-test-${Date.now()}`;
const TEST_SESSION_ID = `projector-sess-${Date.now()}`;
const TEST_PROJECT_ID = "proj-default";
const TEST_MSG_ID = `msg-proj-${Date.now()}`;

describe("task-message-projector", () => {
  // Import the projector eagerly so the DB module is fully initialised
  // before we insert test rows.
  let projectPendingEvents: typeof import("../../control-plane/service/src/modules/tasks/task-message-projector")["projectPendingEvents"];

  beforeAll(async () => {
    // Eagerly import so the Drizzle bootstrap (top-level await) completes
    const mod = await import(
      "../../control-plane/service/src/modules/tasks/task-message-projector"
    );
    projectPendingEvents = mod.projectPendingEvents;

    // Create a minimal test task (proj-default must already exist in the DB)
    await sql`
      INSERT INTO tasks (id, project_id, title, prompt, created_at, updated_at)
      VALUES (${TEST_TASK_ID}, ${TEST_PROJECT_ID}, 'projector test task', 'test', NOW()::text, NOW()::text)
    `;

    // The session write API sets treeNodeId = sessionId, which has a FK to
    // project_tree_nodes.  In the live path the tree node is created before
    // message persistence; here we pre-create it for the projector test.
    const treeNodeId = `task-session:${TEST_TASK_ID}:${TEST_SESSION_ID}`;
    const safePath = treeNodeId.replace(/[^a-zA-Z0-9_]/g, "_");
    await sql`
      INSERT INTO project_tree_nodes (id, project_id, path, node_type, created_at, updated_at)
      VALUES (${treeNodeId}, ${TEST_PROJECT_ID}, ${safePath}::ltree, 'session', NOW()::text, NOW()::text)
    `;

    // Insert unprojected events
    await sql`
      INSERT INTO task_message_events (task_id, session_id, event_type, runtime_message_id, payload, projected, created_at)
      VALUES
        (${TEST_TASK_ID}, ${TEST_SESSION_ID}, 'message.updated', ${TEST_MSG_ID}, ${sql.json({
          info: { id: TEST_MSG_ID, role: "assistant" },
          parts: [{ type: "text", text: "Hello from projector test" }],
        })}, false, NOW()::text),
        (${TEST_TASK_ID}, ${TEST_SESSION_ID}, 'message.part.updated', ${TEST_MSG_ID}, ${sql.json({
          info: { id: TEST_MSG_ID, role: "assistant" },
          parts: [
            { type: "text", text: "Hello from projector test – updated" },
            { type: "tool-call", toolCallId: "tc-1", toolName: "readFile", args: {} },
          ],
        })}, false, NOW()::text)
    `;

    // Sanity-check: confirm events are visible to raw client
    const check = await sql`SELECT count(*)::int AS cnt FROM task_message_events WHERE task_id = ${TEST_TASK_ID} AND projected = false`;
    console.log("[beforeAll] unprojected events inserted:", check[0].cnt);
  });

  afterAll(async () => {
    // Clean up in dependency order
    await sql`DELETE FROM task_timeline_views WHERE task_id = ${TEST_TASK_ID}`;
    await sql`DELETE FROM task_session_message_parts WHERE message_id LIKE ${"task-session-message:task-session:" + TEST_TASK_ID + "%"}`;
    await sql`DELETE FROM task_session_messages WHERE task_id = ${TEST_TASK_ID}`;
    await sql`DELETE FROM task_sessions WHERE task_id = ${TEST_TASK_ID}`;
    await sql`DELETE FROM task_message_events WHERE task_id = ${TEST_TASK_ID}`;
    await sql`DELETE FROM project_tree_nodes WHERE id LIKE ${"task-session:" + TEST_TASK_ID + "%"}`;
    await sql`DELETE FROM tasks WHERE id = ${TEST_TASK_ID}`;
    await sql.end();
  });

  test("projects unprojected events into normalized tables", async () => {
    const result = await projectPendingEvents(10);
    console.log("[test-1] result:", JSON.stringify(result));

    // Both events should have been projected
    expect(result.failed).toBe(0);
    expect(result.processed).toBe(2);

    // Events should now be marked projected
    const events = await sql`
      SELECT id, projected FROM task_message_events
      WHERE task_id = ${TEST_TASK_ID}
      ORDER BY id
    `;
    expect(events.length).toBe(2);
    expect(events[0].projected).toBe(true);
    expect(events[1].projected).toBe(true);

    // Normalized message should exist
    const messages = await sql`
      SELECT id, role, text_content, status FROM task_session_messages
      WHERE task_id = ${TEST_TASK_ID}
    `;
    expect(messages.length).toBeGreaterThanOrEqual(1);
    const msg = messages[0];
    expect(msg.role).toBe("assistant");
    // The second event (message.part.updated) should have overwritten the first
    expect(msg.text_content).toContain("updated");

    // Parts should exist (the second event has 2 parts)
    const sessionId = `task-session:${TEST_TASK_ID}:${TEST_SESSION_ID}`;
    const messageId = `task-session-message:${sessionId}:${TEST_MSG_ID}`;
    const parts = await sql`
      SELECT part_type FROM task_session_message_parts
      WHERE message_id = ${messageId}
      ORDER BY part_index
    `;
    expect(parts.length).toBe(2);
    expect(parts[0].part_type).toBe("text");
    expect(parts[1].part_type).toBe("tool_call");

    // Timeline view should exist
    const timeline = await sql`
      SELECT id FROM task_timeline_views
      WHERE task_id = ${TEST_TASK_ID}
    `;
    expect(timeline.length).toBeGreaterThanOrEqual(1);
  });

  test("is idempotent — re-running finds nothing to project", async () => {
    const result = await projectPendingEvents(10);
    console.log("[test-2] result:", JSON.stringify(result));
    expect(result.processed).toBe(0);
    expect(result.failed).toBe(0);
  });
});
