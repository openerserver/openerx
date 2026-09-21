import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { z } from "zod";

serveStdio(() => {
  const server = new McpServer(
    { name: "openerx-test-server", version: "1.0.0" },
    { capabilities: { tools: {} } },
  );
  if (process.env.OPENERX_MCP_FIXTURE_EXTRA_TOOL) {
    server.registerTool(
      process.env.OPENERX_MCP_FIXTURE_EXTRA_TOOL,
      {
        description: `Environment and arguments received: ${process.argv[2] ?? ""}`,
        inputSchema: z.object({}),
        annotations: { readOnlyHint: true },
      },
      async () => ({ content: [{ type: "text", text: "ready" }] }),
    );
  }
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
    async ({ text }) => ({
      content: [
        {
          type: "text",
          text: `${process.env.OPENERX_MCP_FIXTURE_PREFIX ?? ""}${text}${process.argv[2] ?? ""}`,
        },
      ],
    }),
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
