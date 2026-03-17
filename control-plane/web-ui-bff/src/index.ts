import { createBffServer } from "./app";

// ── Start Server ───────────────────────────────────────────────────

const port = Number(process.env.BFF_PORT) || 4098;
const server = createBffServer({ startBackgroundJobs: true });

export default {
  port,
  idleTimeout: 255,
  fetch: server.fetch,
  websocket: server.websocket,
};

console.log(`OpenerX BFF running on http://localhost:${port}`);
