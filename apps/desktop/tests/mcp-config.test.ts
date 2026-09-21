import { describe, expect, it } from "vitest";
import { parseMcpArguments, parseMcpImport, parseMcpValues } from "../src/renderer/mcp-config";

describe("MCP configuration input", () => {
  it("preserves argument boundaries and values containing spaces, equals signs, or Windows paths", () => {
    expect(parseMcpArguments("-y\nC:\\My Project\\server.js")).toEqual([
      "-y",
      "C:\\My Project\\server.js",
    ]);
    expect(parseMcpArguments('["", "a b"]')).toEqual(["", "a b"]);
    expect(parseMcpValues("TOKEN=abc==\nPATH=C:\\My Tools", "env")).toEqual({
      TOKEN: "abc==",
      PATH: "C:\\My Tools",
    });
    expect(() => parseMcpValues("KEY=1\nKEY=2", "env")).toThrow("名称不能重复");
    expect(() => parseMcpArguments("[1]")).toThrow("字符串数组");
  });
  it("imports multiple conventional servers without requiring cwd and keeps secrets outside config", () => {
    const imported = parseMcpImport(
      JSON.stringify({
        mcpServers: {
          local: { command: "npx", args: ["-y", "fixture", "a b"], env: { KEY: "test-secret" } },
          remote: {
            type: "http",
            url: "https://example.com/mcp",
            headers: { Authorization: "Bearer fixture" },
            disabled: true,
          },
        },
      }),
    );
    expect(imported).toHaveLength(2);
    expect(imported[0]).toMatchObject({
      config: { name: "local", args: ["-y", "fixture", "a b"], cwd: "" },
      env: { KEY: "test-secret" },
    });
    expect(imported[1]).toMatchObject({
      config: { name: "remote", transport: "streamable_http", enabled: false },
      headers: { Authorization: "Bearer fixture" },
    });
    expect(JSON.stringify(imported.map(({ config }) => config))).not.toContain("test-secret");
  });
  it("rejects malformed, unsupported or mixed configs before any import", () => {
    for (const value of [
      "{",
      "[]",
      "{}",
      '{"mcpServers": []}',
      '{"command":"npx","url":"https://example.com"}',
      '{"url":"file:///tmp/mcp"}',
      '{"url":"https://example.com","type":"sse"}',
      '{"command":"npx","args":"-y package"}',
      '{"command":"npx","unknown":true}',
      '{"mcpServers":{"a":{"command":"node"},"A":{"command":"node"}}}',
    ]) {
      expect(() => parseMcpImport(value), value).toThrow();
    }
  });
});
