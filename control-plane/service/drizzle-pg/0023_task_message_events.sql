CREATE TABLE IF NOT EXISTS "task_message_events" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
	"task_id" text NOT NULL,
	"session_id" text NOT NULL,
	"event_type" text NOT NULL,
	"runtime_message_id" text,
	"payload" jsonb NOT NULL,
	"projected" boolean DEFAULT false NOT NULL,
	"created_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
ALTER TABLE "task_message_events" ADD CONSTRAINT "task_message_events_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "idx_task_message_events_unprojected" ON "task_message_events" USING btree ("id") WHERE projected = false;
--> statement-breakpoint
CREATE INDEX "idx_task_message_events_task_session" ON "task_message_events" USING btree ("task_id","session_id","created_at");
