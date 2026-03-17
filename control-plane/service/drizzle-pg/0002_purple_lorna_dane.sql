CREATE INDEX "idx_boss_decisions_task_ts" ON "boss_decisions" USING btree ("task_id","ts");--> statement-breakpoint
CREATE INDEX "idx_human_escalations_task_ts" ON "human_escalations" USING btree ("task_id","ts");--> statement-breakpoint
CREATE INDEX "idx_paid_execution_leases_project_status" ON "paid_execution_leases" USING btree ("project_id","status","expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_project_task_relations_unique_edge" ON "project_task_relations" USING btree ("project_id","source_task_id","target_task_id","relation_type");--> statement-breakpoint
CREATE INDEX "idx_project_task_relations_project" ON "project_task_relations" USING btree ("project_id","relation_type");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_role_agent_bindings_role_project_key" ON "role_agent_bindings" USING btree ("role_agent_id","project_id","binding_key");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_role_agent_project_overrides_role_project" ON "role_agent_project_overrides" USING btree ("role_agent_id","project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_runtime_usage_baselines_project_scope" ON "runtime_usage_baselines" USING btree ("project_id","provider_id","model_id","entrypoint_type","orchestration_fingerprint","match_scope");--> statement-breakpoint
CREATE INDEX "idx_runtime_usage_baselines_project_generated" ON "runtime_usage_baselines" USING btree ("project_id","generated_at");--> statement-breakpoint
CREATE INDEX "idx_runtime_usage_ledger_steps_ledger_request" ON "runtime_usage_ledger_steps" USING btree ("ledger_id","request_index");--> statement-breakpoint
CREATE INDEX "idx_runtime_usage_ledger_steps_project_time" ON "runtime_usage_ledger_steps" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_runtime_usage_ledger_steps_task_type" ON "runtime_usage_ledger_steps" USING btree ("task_id","step_type","trigger_type");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_runtime_usage_ledgers_runtime_session" ON "runtime_usage_ledgers" USING btree ("runtime_session_id");--> statement-breakpoint
CREATE INDEX "idx_runtime_usage_ledgers_project_time" ON "runtime_usage_ledgers" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_runtime_usage_ledgers_agent_run" ON "runtime_usage_ledgers" USING btree ("agent_run_id");