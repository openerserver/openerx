UPDATE "task_sessions" ts
SET
  "source_message_id" = COALESCE(ts."source_message_id", ts."forked_from_message_id"),
  "session_type" = COALESCE(
    ts."session_type",
    CASE
      WHEN ts."parent_session_id" IS NULL THEN 'root'
      WHEN ts."trigger_type" = 'manual_branch' THEN 'manual_branch'
      WHEN ts."trigger_type" = 'workflow_spawn' THEN 'workflow_spawn'
      ELSE 'follow_up'
    END
  ),
  "workflow_stage_key" = COALESCE(ts."workflow_stage_key", t."stage_key"),
  "spawn_trigger_type" = COALESCE(
    ts."spawn_trigger_type",
    CASE ts."trigger_type"
      WHEN 'execute' THEN 'user_prompt'
      WHEN 'continue' THEN 'assistant_reply'
      WHEN 'resume' THEN 'resume'
      WHEN 'workflow_spawn' THEN 'workflow_spawn'
      WHEN 'manual_branch' THEN 'manual_branch'
      ELSE 'system_retry'
    END
  ),
  "status" = CASE
    WHEN ts."archived_at" IS NOT NULL THEN 'archived'
    WHEN ts."execution_status" = 'complete' THEN 'completed'
    WHEN ts."execution_status" = 'cancelled' THEN 'cancelled'
    ELSE COALESCE(ts."execution_status"::text, ts."status", 'running')
  END
FROM "tasks" t
WHERE t."id" = ts."task_id";
--> statement-breakpoint

INSERT INTO "task_session_runs" (
  "id",
  "task_id",
  "session_id",
  "attempt_index",
  "runtime_session_id",
  "trigger_type",
  "execution_kind",
  "coordination_key",
  "candidate_index",
  "lane_role",
  "executor_kind",
  "model_route",
  "workflow_stage_key",
  "status",
  "input_tokens",
  "output_tokens",
  "total_tokens",
  "cost_usd",
  "result_summary",
  "error_text",
  "started_at",
  "finished_at",
  "created_at"
)
SELECT
  concat('run_', ts."id"),
  ts."task_id",
  ts."id",
  1,
  ts."runtime_session_id",
  CASE ts."trigger_type"
    WHEN 'execute' THEN 'user_prompt'
    WHEN 'continue' THEN 'assistant_reply'
    WHEN 'resume' THEN 'resume'
    WHEN 'workflow_spawn' THEN 'workflow_spawn'
    WHEN 'manual_branch' THEN 'manual_branch'
    ELSE 'system_retry'
  END,
  CASE ts."session_kind"
    WHEN 'candidate' THEN 'parallel_candidate'
    WHEN 'judge' THEN 'judge'
    WHEN 'sequential_step' THEN 'workflow_step'
    WHEN 'resume' THEN 'resume'
    WHEN 'hook' THEN 'hook'
    ELSE 'single'
  END,
  ts."coordination_key",
  ts."candidate_index",
  CASE ts."session_kind"
    WHEN 'candidate' THEN 'candidate'
    WHEN 'judge' THEN 'judge'
    WHEN 'resume' THEN 'resume'
    WHEN 'hook' THEN 'hook'
    ELSE 'primary'
  END,
  CASE ts."session_kind"
    WHEN 'judge' THEN 'judge'
    WHEN 'hook' THEN 'hook'
    ELSE 'assistant'
  END,
  COALESCE(ts."effective_model", ts."selected_model"),
  ts."workflow_stage_key",
  CASE
    WHEN ts."archived_at" IS NOT NULL THEN 'archived'
    WHEN ts."execution_status" = 'complete' THEN 'completed'
    WHEN ts."execution_status" = 'cancelled' THEN 'cancelled'
    ELSE COALESCE(ts."execution_status"::text, 'running')
  END,
  ts."input_tokens",
  ts."output_tokens",
  ts."total_tokens",
  ts."cost_usd",
  ts."result_summary",
  ts."error_text",
  ts."started_at",
  ts."finished_at",
  ts."created_at"
FROM "task_sessions" ts
ON CONFLICT ("id") DO NOTHING;
--> statement-breakpoint

UPDATE "task_sessions"
SET "latest_run_id" = COALESCE("latest_run_id", concat('run_', "id"));
--> statement-breakpoint

INSERT INTO "task_messages" (
  "id",
  "task_id",
  "session_id",
  "created_by_run_id",
  "role",
  "message_kind",
  "seq",
  "text_preview",
  "part_count",
  "token_used",
  "status",
  "created_at",
  "updated_at",
  "completed_at"
)
SELECT
  tsm."id",
  tsm."task_id",
  tsm."session_id",
  CASE WHEN tsm."role" = 'user' THEN NULL ELSE concat('run_', tsm."session_id") END,
  tsm."role",
  CASE tsm."role"
    WHEN 'user' THEN 'prompt'
    WHEN 'assistant' THEN 'reply'
    WHEN 'tool' THEN 'tool_echo'
    ELSE 'note'
  END,
  tsm."message_index",
  COALESCE(tsm."summary_text", left(tsm."text_content", 280)),
  0,
  COALESCE(tsm."token_used", 0),
  COALESCE(
    tsm."status",
    CASE WHEN tsm."completed_at" IS NOT NULL THEN 'completed' ELSE 'streaming' END
  ),
  tsm."created_at",
  tsm."updated_at",
  CASE
    WHEN COALESCE(tsm."status", CASE WHEN tsm."completed_at" IS NOT NULL THEN 'completed' ELSE 'streaming' END) = 'completed'
      THEN COALESCE(tsm."completed_at", tsm."updated_at", tsm."created_at")
    ELSE tsm."completed_at"
  END
FROM "task_session_messages" tsm
ON CONFLICT ("id") DO NOTHING;
--> statement-breakpoint

WITH ordered AS (
  SELECT
    tm."id",
    lag(tm."id") OVER (
      PARTITION BY tm."session_id"
      ORDER BY tm."seq", tm."created_at", tm."id"
    ) AS prev_id
  FROM "task_messages" tm
)
UPDATE "task_messages" tm
SET
  "parent_message_id" = COALESCE(tm."parent_message_id", ordered."prev_id"),
  "reply_to_message_id" = COALESCE(tm."reply_to_message_id", ordered."prev_id")
FROM ordered
WHERE ordered."id" = tm."id" AND ordered."prev_id" IS NOT NULL;
--> statement-breakpoint

INSERT INTO "task_message_parts" (
  "id",
  "message_id",
  "part_index",
  "part_type",
  "text_content",
  "json_payload",
  "created_at"
)
SELECT
  tsmp."id",
  tsmp."message_id",
  tsmp."part_index",
  tsmp."part_type",
  tsmp."text_content",
  tsmp."json_payload",
  tsmp."created_at"
FROM "task_session_message_parts" tsmp
ON CONFLICT ("id") DO NOTHING;
--> statement-breakpoint

INSERT INTO "task_message_parts" (
  "id",
  "message_id",
  "part_index",
  "part_type",
  "text_content",
  "json_payload",
  "created_at"
)
SELECT
  concat(tm."id", ':part:0'),
  tm."id",
  0,
  'text',
  COALESCE(tsm."text_content", tsm."summary_text"),
  '{}'::jsonb,
  tm."created_at"
FROM "task_messages" tm
JOIN "task_session_messages" tsm
  ON tsm."id" = tm."id"
WHERE NOT EXISTS (
  SELECT 1
  FROM "task_message_parts" tmp
  WHERE tmp."message_id" = tm."id"
)
  AND COALESCE(tsm."text_content", tsm."summary_text") IS NOT NULL;
--> statement-breakpoint

UPDATE "task_messages" tm
SET "part_count" = counts."part_count"
FROM (
  SELECT "message_id", count(*)::integer AS "part_count"
  FROM "task_message_parts"
  GROUP BY "message_id"
) counts
WHERE counts."message_id" = tm."id";
--> statement-breakpoint

INSERT INTO "task_operations" (
  "id",
  "task_id",
  "session_id",
  "run_id",
  "message_id",
  "parent_operation_id",
  "runtime_operation_id",
  "operation_index",
  "operation_kind",
  "tool_name",
  "title",
  "status",
  "summary_json",
  "started_at",
  "finished_at",
  "created_at",
  "updated_at"
)
SELECT
  so."id",
  so."task_id",
  so."session_id",
  concat('run_', so."session_id"),
  NULL,
  NULL,
  so."runtime_operation_id",
  so."operation_index",
  CASE
    WHEN COALESCE(so."metadata_json" ->> 'toolName', so."metadata_json" ->> 'tool_name') IS NOT NULL THEN 'tool_call'
    WHEN so."operation_kind" = 'judge' THEN 'judge'
    WHEN so."operation_kind" = 'hook' THEN 'hook'
    WHEN so."operation_kind" = 'resume' THEN 'resume'
    WHEN so."operation_kind" = 'system' THEN 'system'
    ELSE 'model_request'
  END,
  COALESCE(so."metadata_json" ->> 'toolName', so."metadata_json" ->> 'tool_name'),
  COALESCE(so."executor_label", so."executor_key"),
  CASE
    WHEN so."execution_status" = 'complete' THEN 'completed'
    WHEN so."execution_status" = 'cancelled' THEN 'cancelled'
    ELSE COALESCE(so."execution_status"::text, 'running')
  END,
  so."metadata_json",
  so."started_at",
  so."finished_at",
  so."created_at",
  so."updated_at"
FROM "session_operations" so
ON CONFLICT ("id") DO NOTHING;
--> statement-breakpoint

WITH prompts AS (
  SELECT
    tm."session_id",
    tm."text_preview",
    row_number() OVER (
      PARTITION BY tm."session_id"
      ORDER BY tm."seq", tm."created_at", tm."id"
    ) AS rn
  FROM "task_messages" tm
  WHERE tm."role" = 'user'
)
UPDATE "task_sessions" ts
SET "user_prompt_summary" = COALESCE(ts."user_prompt_summary", prompts."text_preview")
FROM prompts
WHERE prompts."session_id" = ts."id" AND prompts.rn = 1;
--> statement-breakpoint

WITH ranked AS (
  SELECT
    tm."session_id",
    tm."id",
    tm."created_by_run_id",
    row_number() OVER (
      PARTITION BY tm."session_id"
      ORDER BY tm."seq" DESC, tm."created_at" DESC, tm."id" DESC
    ) AS rn
  FROM "task_messages" tm
  WHERE tm."role" = 'assistant' AND tm."status" = 'completed'
)
UPDATE "task_sessions" ts
SET
  "head_message_id" = ranked."id",
  "latest_run_id" = COALESCE(ranked."created_by_run_id", ts."latest_run_id")
FROM ranked
WHERE ranked."session_id" = ts."id" AND ranked.rn = 1;
--> statement-breakpoint

WITH RECURSIVE ordered AS (
  SELECT
    ts."id",
    ts."parent_session_id",
    lpad(
      (row_number() OVER (
        PARTITION BY ts."task_id", ts."parent_session_id"
        ORDER BY ts."created_at", ts."id"
      ) - 1)::text,
      4,
      '0'
    ) AS segment
  FROM "task_sessions" ts
),
tree AS (
  SELECT
    ordered."id",
    0 AS depth,
    ordered.segment AS sort_key
  FROM ordered
  WHERE ordered."parent_session_id" IS NULL

  UNION ALL

  SELECT
    child."id",
    parent.depth + 1,
    parent.sort_key || '.' || child.segment
  FROM ordered child
  JOIN tree parent ON parent."id" = child."parent_session_id"
)
UPDATE "task_sessions" ts
SET
  "depth" = tree.depth,
  "sort_key" = tree.sort_key
FROM tree
WHERE tree."id" = ts."id";
--> statement-breakpoint

UPDATE "task_sessions"
SET "sort_key" = COALESCE("sort_key", concat('orphan.', "id"))
WHERE "sort_key" IS NULL;