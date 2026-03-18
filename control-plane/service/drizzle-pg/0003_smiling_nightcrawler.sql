ALTER TABLE IF EXISTS "agent_runs" DROP CONSTRAINT IF EXISTS "agent_runs_node_id_task_nodes_id_fk";--> statement-breakpoint
ALTER TABLE IF EXISTS "agent_runs" DROP COLUMN IF EXISTS "node_id";--> statement-breakpoint
ALTER TABLE IF EXISTS "approval_tickets" DROP COLUMN IF EXISTS "node_id";--> statement-breakpoint
ALTER TABLE IF EXISTS "task_edges" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE IF EXISTS "task_nodes" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE IF EXISTS "task_edges" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "task_nodes" CASCADE;