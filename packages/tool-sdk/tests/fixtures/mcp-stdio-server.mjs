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
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ text }) => ({ content: [{ type: "text", text }] }),
  );
  server.registerTool(
    "write_echo",
    {
      title: "Write Echo",
      description: "Fixture write operation",
      inputSchema: z.object({ text: z.string() }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ text }) => ({ content: [{ type: "text", text: `wrote:${text}` }] }),
  );
  return server;
});
