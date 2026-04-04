UPDATE "task_messages" tm
SET
  "runtime_message_id" = COALESCE(tm."runtime_message_id", tsm."runtime_message_id"),
  "client_message_id" = COALESCE(tm."client_message_id", tsm."client_message_id"),
  "provider_message_id" = COALESCE(tm."provider_message_id", tsm."provider_message_id"),
  "text_content" = COALESCE(tm."text_content", tsm."text_content", tsm."summary_text"),
  "text_preview" = COALESCE(
    tm."text_preview",
    tsm."summary_text",
    left(tsm."text_content", 280)
  ),
  "raw_payload" = CASE
    WHEN tm."raw_payload" = '{}'::jsonb THEN COALESCE(tsm."raw_payload", '{}'::jsonb)
    ELSE tm."raw_payload"
  END,
  "token_used" = CASE
    WHEN tm."token_used" = 0 THEN COALESCE(tsm."token_used", tm."token_used")
    ELSE tm."token_used"
  END,
  "error_text" = COALESCE(tm."error_text", tsm."error_text"),
  "started_at" = COALESCE(tm."started_at", tsm."started_at", tsm."created_at"),
  "completed_at" = COALESCE(
    tm."completed_at",
    CASE
      WHEN COALESCE(tsm."status", CASE WHEN tsm."completed_at" IS NOT NULL THEN 'completed' ELSE 'streaming' END) = 'completed'
        THEN COALESCE(tsm."completed_at", tsm."updated_at", tsm."created_at")
      ELSE tsm."completed_at"
    END
  ),
  "updated_at" = GREATEST(
    COALESCE(tm."updated_at", tm."created_at"),
    COALESCE(tsm."updated_at", tsm."created_at", tm."updated_at", tm."created_at")
  )
FROM "task_session_messages" tsm
WHERE tsm."id" = tm."id";
--> statement-breakpoint

INSERT INTO "task_messages" (
  "id",
  "task_id",
  "session_id",
  "created_by_run_id",
  "role",
  "message_kind",
  "runtime_message_id",
  "client_message_id",
  "provider_message_id",
  "seq",
  "text_content",
  "text_preview",
  "raw_payload",
  "part_count",
  "token_used",
  "status",
  "error_text",
  "started_at",
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
  tsm."runtime_message_id",
  tsm."client_message_id",
  tsm."provider_message_id",
  tsm."message_index",
  COALESCE(tsm."text_content", tsm."summary_text"),
  COALESCE(tsm."summary_text", left(tsm."text_content", 280)),
  COALESCE(tsm."raw_payload", '{}'::jsonb),
  0,
  COALESCE(tsm."token_used", 0),
  COALESCE(
    tsm."status",
    CASE WHEN tsm."completed_at" IS NOT NULL THEN 'completed' ELSE 'streaming' END
  ),
  tsm."error_text",
  COALESCE(tsm."started_at", tsm."created_at"),
  tsm."created_at",
  tsm."updated_at",
  CASE
    WHEN COALESCE(tsm."status", CASE WHEN tsm."completed_at" IS NOT NULL THEN 'completed' ELSE 'streaming' END) = 'completed'
      THEN COALESCE(tsm."completed_at", tsm."updated_at", tsm."created_at")
    ELSE tsm."completed_at"
  END
FROM "task_session_messages" tsm
WHERE NOT EXISTS (
  SELECT 1
  FROM "task_messages" tm
  WHERE tm."id" = tsm."id"
)
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
WHERE NOT EXISTS (
  SELECT 1
  FROM "task_message_parts" tmp
  WHERE tmp."id" = tsmp."id"
)
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
