#!/usr/bin/env bun
/**
 * CLI runner for the Phase 1 event-log projector.
 *
 * Usage:
 *   DATABASE_DIALECT=postgres DATABASE_URL=postgres://127.0.0.1:5432/openerx \
 *     bun run control-plane/service/src/modules/tasks/run-projector.ts [--batch 100]
 *
 * Reads unprojected events from `task_message_events`, replays them through
 * the same write path used by the live system, and marks them as projected.
 */

import { projectPendingEvents } from "./task-message-projector";

const batchSize = (() => {
  const idx = process.argv.indexOf("--batch");
  if (idx !== -1 && process.argv[idx + 1]) {
    const n = Number(process.argv[idx + 1]);
    return Number.isFinite(n) && n > 0 ? n : 100;
  }
  return 100;
})();

console.log(`🔄 Running projector (batch=${batchSize})…`);

const result = await projectPendingEvents(batchSize);

console.log(`✅ Projected: ${result.processed}`);
if (result.failed > 0) {
  console.log(`❌ Failed: ${result.failed}`);
  for (const e of result.errors) {
    console.log(`   event ${e.eventId}: ${e.error}`);
  }
}

if (result.processed === 0 && result.failed === 0) {
  console.log("ℹ️  No unprojected events found.");
}

process.exit(result.failed > 0 ? 1 : 0);
