ALTER TABLE IF EXISTS "task_sessions"
  DROP CONSTRAINT IF EXISTS "task_sessions_forked_from_message_id_task_session_messages_id_fk";

DROP TABLE IF EXISTS "task_session_message_parts";
DROP TABLE IF EXISTS "task_session_messages";