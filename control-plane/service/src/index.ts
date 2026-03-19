import { createControlPlaneApp } from "./app";

const app = createControlPlaneApp();

// ── Start Server ───────────────────────────────────────────────────

const port = Number(process.env.PORT) || 4097;

export default {
  port,
  fetch: app.fetch,
};

console.log(`Opener-X Control Plane running on http://localhost:${port}`);
