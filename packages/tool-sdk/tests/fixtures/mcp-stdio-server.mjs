import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { z } from "zod";

serveStdio(() => {
  const server = new McpServer(
    { name: "openerx-test-server", version: "1.0.0" },
    { capabilities: { tools: {} } },
  );
  server.registerTool(
    "echo",
    {
      title: "Echo",
      description: "Returns the supplied text",
      inputSchema: z.object({ text: z.string() }),
    },
    async ({ text }) => ({ content: [{ type: "text", text }] }),
  );
  return server;
});
