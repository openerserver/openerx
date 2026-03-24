UPDATE "project_tree_nodes"
SET "content_json" = '{}'::jsonb,
    "updated_at" = CURRENT_TIMESTAMP
WHERE "node_type" = 'task'
  AND COALESCE("content_json", '{}'::jsonb) <> '{}'::jsonb;