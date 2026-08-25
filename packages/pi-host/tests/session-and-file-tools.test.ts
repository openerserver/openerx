import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fauxProvider } from "@earendil-works/pi-ai/providers/faux";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createProductPiSession, ModelRuntime } from "../src/agent-session";
import { createProductFileTools } from "../src/file-tools";
import { ProductSessionRegistry } from "../src/session-registry";

const temporaryDirectories: string[] = [];
const emptyUsage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

function appendAssistant(
  manager: Awaited<ReturnType<ProductSessionRegistry["sessionManager"]>>,
  content: string,
): string {
  return manager.appendMessage({
    role: "assistant",
    content: [{ type: "text", text: content }],
    api: "openai-responses",
    provider: "test",
    model: "test",
    usage: emptyUsage,
    stopReason: "stop",
    timestamp: Date.now(),
  });
}

function directories() {
  const root = mkdtempSync(path.join(tmpdir(), "openerx-pi-session-"));
  temporaryDirectories.push(root);
  const cwd = path.join(root, "workspace");
  const agentDir = path.join(root, "agent");
  mkdirSync(cwd);
  mkdirSync(agentDir);
  return { root, cwd, agentDir };
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("Pi persistent SessionManager boundary", () => {
  it("restores the same append-only conversation session after process reconstruction", async () => {
    const { root, cwd } = directories();
    const conversationId = randomUUID();
    const firstRegistry = new ProductSessionRegistry(root, cwd);
    const first = await firstRegistry.sessionManager(conversationId);
    first.appendMessage({ role: "user", content: "before crash", timestamp: Date.now() });
    appendAssistant(first, "persisted response");
    const sessionFile = first.getSessionFile();

    const secondRegistry = new ProductSessionRegistry(root, cwd);
    const restored = await secondRegistry.sessionManager(conversationId);
    expect(restored.getSessionFile()).toBe(sessionFile);
    expect(restored.buildSessionContext().messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ role: "user", content: "before crash" }),
        expect.objectContaining({ role: "assistant" }),
      ]),
    );
  });

  it("recovers a damaged registry from Pi session headers and honors compaction context", async () => {
    const { root, cwd } = directories();
    const conversationId = randomUUID();
    const registry = new ProductSessionRegistry(root, cwd);
    const manager = await registry.sessionManager(conversationId);
    const first = manager.appendMessage({ role: "user", content: "old context", timestamp: 1 });
    appendAssistant(manager, "old answer");
    const kept = manager.appendMessage({ role: "user", content: "keep this", timestamp: 2 });
    appendAssistant(manager, "kept answer");
    manager.appendCompaction("summary of old context", kept, 12_000, { source: "test" });
    writeFileSync(path.join(root, "pi-sessions", "conversation-sessions.json"), "broken-json");

    const recovered = await new ProductSessionRegistry(root, cwd).sessionManager(conversationId);
    const contextEntries = recovered.buildContextEntries();
    expect(contextEntries.some((entry) => entry.type === "compaction")).toBe(true);
    expect(recovered.buildSessionContext().messages).toEqual(
      expect.arrayContaining([expect.objectContaining({ role: "user", content: "keep this" })]),
    );
    expect(recovered.getEntry(first)).toBeDefined();
  });
});

describe("Pi native Broker tools", () => {
  it("registers only OpenerX file tools and forwards operations without raw paths", async () => {
    const { cwd, agentDir } = directories();
    const request = vi.fn(async () => [{ id: randomUUID(), displayName: "brief.pdf" }]);
    const generationId = randomUUID();
    const conversationId = randomUUID();
    const tools = createProductFileTools({ generationId, conversationId, transport: { request } });
    const runtime = await ModelRuntime.create({ modelsPath: null, refreshOnCreate: false });
    const faux = fauxProvider({ tokensPerSecond: 10_000 });
    runtime.registerNativeProvider(faux.provider);
    const { session } = await createProductPiSession({
      cwd,
      agentDir,
      history: [],
      modelRuntime: runtime,
      model: faux.getModel(),
      customTools: tools,
      files: [{ personalFileId: randomUUID(), displayName: "brief.pdf", format: "pdf" }],
    });

    expect(session.getActiveToolNames().sort()).toEqual(
      [
        "openerx_artifact_write",
        "openerx_file_list",
        "openerx_file_read",
        "openerx_file_search",
      ].sort(),
    );
    expect(session.getActiveToolNames()).not.toEqual(
      expect.arrayContaining(["bash", "read", "write", "edit"]),
    );
    const list = tools.find(({ name }) => name === "openerx_file_list");
    await list?.execute("tool-call", {}, undefined, undefined, {} as never);
    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({
        generationId,
        conversationId,
        request: { operation: "list", input: {} },
      }),
    );
    expect(JSON.stringify(request.mock.calls)).not.toMatch(/absolutePath|localPath/);
    session.dispose();
  });
});
