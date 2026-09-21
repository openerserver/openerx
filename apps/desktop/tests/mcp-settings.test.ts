import type { McpServerConfig } from "@openerx/contracts";
import { describe, expect, it, vi } from "vitest";
import { saveMcpSettings } from "../src/main/mcp-settings";

const id = "66666666-6666-4666-8666-666666666699";
const oauth: McpServerConfig = {
  id,
  name: "OAuth",
  transport: "streamable_http",
  url: "https://example.com/mcp",
  auth: "oauth",
  credentialRef: "mcp:old",
  enabled: true,
  enabledTools: [],
};
const stdio: McpServerConfig = {
  id,
  name: "Local",
  transport: "stdio",
  command: "node",
  args: ["server.js"],
  cwd: "",
  enabled: true,
  enabledTools: [],
};

describe("MCP credential settings", () => {
  it("retains OAuth credentials when editing the name or toggling enabled", async () => {
    const credentials = {
      save: vi.fn().mockResolvedValue(undefined),
      clear: vi.fn().mockResolvedValue(undefined),
    };
    const persist = vi.fn(async (config: McpServerConfig) => config);
    const saved = await saveMcpSettings(
      { config: { ...oauth, name: "Renamed", enabled: false } },
      oauth,
      credentials,
      persist,
    );
    expect(saved).toMatchObject({ credentialRef: "mcp:old", enabled: false });
    expect(credentials.save).not.toHaveBeenCalled();
    expect(credentials.clear).not.toHaveBeenCalled();
  });
  it("stores environment values separately and keeps only names and a reference in the config", async () => {
    const credentials = {
      save: vi.fn().mockResolvedValue(undefined),
      clear: vi.fn().mockResolvedValue(undefined),
    };
    const saved = await saveMcpSettings(
      { config: stdio, env: { API_KEY: "test-secret" } },
      undefined,
      credentials,
      async (config) => config,
    );
    expect(saved).toMatchObject({
      envKeys: ["API_KEY"],
      envCredentialRef: expect.stringContaining(`mcp:${id}:env:`),
    });
    expect(JSON.stringify(saved)).not.toContain("test-secret");
    expect(credentials.save).toHaveBeenCalledWith(
      expect.any(String),
      JSON.stringify({ API_KEY: "test-secret" }),
    );
    const unchanged = await saveMcpSettings(
      { config: stdio },
      saved,
      credentials,
      async (config) => config,
    );
    expect(unchanged).toEqual(saved);
    const cleared = await saveMcpSettings(
      { config: stdio, env: {} },
      saved,
      credentials,
      async (config) => config,
    );
    expect(cleared).toMatchObject({ envCredentialRef: null, envKeys: [] });
    expect(credentials.clear).toHaveBeenCalledWith((saved as typeof stdio).envCredentialRef);
  });
  it("rolls back staged credentials when config persistence fails, preserving old credentials", async () => {
    const credentials = {
      save: vi.fn().mockResolvedValue(undefined),
      clear: vi.fn().mockResolvedValue(undefined),
    };
    await expect(
      saveMcpSettings(
        { config: oauth, oauthClientId: "new-client" },
        oauth,
        credentials,
        async () => {
          throw new Error("save failed");
        },
      ),
    ).rejects.toThrow("save failed");
    expect(credentials.clear).toHaveBeenCalledTimes(1);
    expect(credentials.clear).not.toHaveBeenCalledWith("mcp:old");
  });
  it("requires a fresh bearer token when changing the endpoint and rejects duplicate auth", async () => {
    const credentials = {
      save: vi.fn().mockResolvedValue(undefined),
      clear: vi.fn().mockResolvedValue(undefined),
    };
    const bearer = { ...oauth, auth: "bearer" as const };
    await expect(
      saveMcpSettings(
        { config: { ...bearer, url: "https://other.example/mcp" } },
        bearer,
        credentials,
        async (config) => config,
      ),
    ).rejects.toThrow("MCP_CREDENTIAL_REQUIRED");
    await expect(
      saveMcpSettings(
        { config: bearer, headers: { authorization: "another-token" } },
        bearer,
        credentials,
        async (config) => config,
      ),
    ).rejects.toThrow("MCP_AUTH_HEADER_CONFLICT");
    expect(credentials.save).not.toHaveBeenCalled();
  });
});
