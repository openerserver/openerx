import { Hono } from "hono";
import { sseAggregator } from "./sse-aggregator";
import { wsBroadcaster } from "./ws-broadcaster";

export const realtimeRoutes = new Hono();

// GET /api/realtime/status
realtimeRoutes.get("/status", (c) => {
  return c.json({
    wsClients: wsBroadcaster.getClientCount(),
    status: "ok",
  });
});

// POST /api/realtime/subscribe-session
realtimeRoutes.post("/subscribe-session", async (c) => {
  const body = await c.req.json<{ sessionId: string }>();
  if (!body.sessionId) return c.json({ error: "sessionId required" }, 400);

  await sseAggregator.subscribeSession(body.sessionId);
  return c.json({ subscribed: body.sessionId });
});
