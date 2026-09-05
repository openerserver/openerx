import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fauxProvider } from "@earendil-works/pi-ai/providers/faux";
import { VERSION as PI_CODING_AGENT_VERSION } from "@earendil-works/pi-coding-agent";
import {
  BROKERED_BASH_CONTRACT_VERSION,
  BROKERED_BASH_CORE_ENVIRONMENT_POLICY_ID,
  BROKERED_BASH_DENY_NETWORK_POLICY_ID,
  BROKERED_BASH_FAKE_SANDBOX_POLICY_VERSION,
} from "@openerx/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createProductPiSession, ModelRuntime } from "../src/agent-session";
import { createProductCapabilityTools } from "../src/capability-tools";
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

describe("Pi runtime dependency", () => {
  it("loads the pinned 0.84.4 coding-agent runtime", () => {
    expect(PI_CODING_AGENT_VERSION).toBe("0.84.4");
  });
});

describe("Pi persistent SessionManager boundary", () => {
  it("restores the same append-only conversation session after process reconstruction", async () => {
    const { root, cwd } = directories();
    const conversationId = randomUUID();
    const branchId = randomUUID();
    const firstRegistry = new ProductSessionRegistry(root, cwd);
    const first = await firstRegistry.sessionManager(conversationId, branchId);
    first.appendMessage({ role: "user", content: "before crash", timestamp: Date.now() });
    appendAssistant(first, "persisted response");
    const sessionFile = first.getSessionFile();

    const secondRegistry = new ProductSessionRegistry(root, cwd);
    const restored = await secondRegistry.sessionManager(conversationId, branchId);
    expect(restored.getSessionFile()).toBe(sessionFile);
    expect(restored.buildSessionContext().messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ role: "user", content: "before crash" }),
        expect.objectContaining({ role: "assistant" }),
      ]),
    );
  });

  it("repairs a pre-upgrade session file whose final entry has no trailing newline", async () => {
    const { root, cwd } = directories();
    const conversationId = randomUUID();
    const branchId = randomUUID();
    const first = await new ProductSessionRegistry(root, cwd).sessionManager(
      conversationId,
      branchId,
    );
    first.appendMessage({ role: "user", content: "before upgrade", timestamp: 1 });
    appendAssistant(first, "persisted before upgrade");
    const sessionFile = first.getSessionFile();
    if (!sessionFile) throw new Error("persistent Pi session file was not created");
    const persisted = readFileSync(sessionFile, "utf8");
    writeFileSync(sessionFile, persisted.replace(/\n$/, ""));

    const restored = await new ProductSessionRegistry(root, cwd).sessionManager(
      conversationId,
      branchId,
    );

    expect(restored.buildSessionContext().messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ role: "user", content: "before upgrade" }),
        expect.objectContaining({ role: "assistant" }),
      ]),
    );
    expect(readFileSync(sessionFile, "utf8").endsWith("\n")).toBe(true);
  });

  it("recovers a damaged registry from Pi session headers and honors compaction context", async () => {
    const { root, cwd } = directories();
    const conversationId = randomUUID();
    const branchId = randomUUID();
    const registry = new ProductSessionRegistry(root, cwd);
    const manager = await registry.sessionManager(conversationId, branchId);
    const first = manager.appendMessage({ role: "user", content: "old context", timestamp: 1 });
    appendAssistant(manager, "old answer");
    const kept = manager.appendMessage({ role: "user", content: "keep this", timestamp: 2 });
    appendAssistant(manager, "kept answer");
    manager.appendCompaction("summary of old context", kept, 12_000, { source: "test" });
    writeFileSync(path.join(root, "pi-sessions", "conversation-sessions.json"), "broken-json");

    const recovered = await new ProductSessionRegistry(root, cwd).sessionManager(
      conversationId,
      branchId,
    );
    const contextEntries = recovered.buildContextEntries();
    expect(contextEntries.some((entry) => entry.type === "compaction")).toBe(true);
    expect(recovered.buildSessionContext().messages).toEqual(
      expect.arrayContaining([expect.objectContaining({ role: "user", content: "keep this" })]),
    );
    expect(recovered.getEntry(first)).toBeDefined();
  });

  it("keeps two branches in the same conversation in separate Pi sessions", async () => {
    const { root, cwd } = directories();
    const registry = new ProductSessionRegistry(root, cwd);
    const conversationId = randomUUID();
    const redBranchId = randomUUID();
    const blueBranchId = randomUUID();
    const red = await registry.sessionManager(conversationId, redBranchId);
    const blue = await registry.sessionManager(conversationId, blueBranchId);
    red.appendMessage({ role: "user", content: "代号为红", timestamp: 1 });
    blue.appendMessage({ role: "user", content: "代号为蓝", timestamp: 1 });

    expect(red.getSessionFile()).not.toBe(blue.getSessionFile());
    expect(JSON.stringify(red.buildSessionContext())).toContain("代号为红");
    expect(JSON.stringify(red.buildSessionContext())).not.toContain("代号为蓝");
    expect(JSON.stringify(blue.buildSessionContext())).toContain("代号为蓝");
    expect(JSON.stringify(blue.buildSessionContext())).not.toContain("代号为红");
  });
});

describe("Pi native Broker tools", () => {
  it("registers the product bash name without restoring Pi builtin filesystem tools", async () => {
    const { cwd, agentDir } = directories();
    const runtime = await ModelRuntime.create({ modelsPath: null, refreshOnCreate: false });
    const faux = fauxProvider({ tokensPerSecond: 10_000 });
    runtime.registerNativeProvider(faux.provider);
    const customTools = createProductCapabilityTools({
      generationId: randomUUID(),
      conversationId: randomUUID(),
      branchId: randomUUID(),
      assistantMessageId: randomUUID(),
      brokeredBashExecution: {
        contractVersion: BROKERED_BASH_CONTRACT_VERSION,
        activeExecutionGrantId: randomUUID(),
        additionalExecutionGrantIds: [],
        executionProfile: "read_only",
        executionOrigin: "local_interactive",
        workspaceWriteMode: "none",
        environmentPolicyId: BROKERED_BASH_CORE_ENVIRONMENT_POLICY_ID,
        networkPolicyId: BROKERED_BASH_DENY_NETWORK_POLICY_ID,
        sandboxPolicyVersion: BROKERED_BASH_FAKE_SANDBOX_POLICY_VERSION,
      },
      transport: { request: vi.fn() },
    }).filter(({ name }) => name === "bash");
    const { session } = await createProductPiSession({
      cwd,
      agentDir,
      history: [],
      modelRuntime: runtime,
      model: faux.getModel(),
      customTools,
    });

    expect(session.getActiveToolNames()).toEqual(["bash"]);
    expect(session.getActiveToolNames()).not.toEqual(
      expect.arrayContaining(["read", "write", "edit", "openerx_shell"]),
    );
    session.dispose();
  });

  it("registers only OpenERX file tools and forwards operations without raw paths", async () => {
    const { cwd, agentDir } = directories();
    const request = vi.fn(async () => [{ id: randomUUID(), displayName: "brief.pdf" }]);
    const generationId = randomUUID();
    const conversationId = randomUUID();
    const branchId = randomUUID();
    const assistantMessageId = randomUUID();
    const tools = createProductFileTools({
      generationId,
      conversationId,
      branchId,
      assistantMessageId,
      transport: { request },
    });
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
        "openerx_office_artifact",
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
        branchId,
        assistantMessageId,
        piToolCallId: "tool-call",
        toolName: "openerx_file_list",
        request: { operation: "list", input: {} },
      }),
    );
    expect(JSON.stringify(request.mock.calls)).not.toMatch(/absolutePath|localPath/);
    session.dispose();
  });

  it("returns every generated Office review surface to Pi as typed image content", async () => {
    const generationId = randomUUID();
    const conversationId = randomUUID();
    const branchId = randomUUID();
    const assistantMessageId = randomUUID();
    const artifactId = randomUUID();
    const imageDataUrl = `data:image/svg+xml;base64,${Buffer.from("<svg/>").toString("base64")}`;
    const modelImageDataUrl = `data:image/png;base64,${Buffer.from("png").toString("base64")}`;
    const request = vi.fn(async () => ({
      artifact: { id: artifactId, currentVersion: 1 },
      preview: {
        renderedSurfaces: [
          { kind: "slide", index: 1, label: "幻灯片 1", imageDataUrl, modelImageDataUrl },
          { kind: "slide", index: 2, label: "幻灯片 2", imageDataUrl, modelImageDataUrl },
        ],
      },
    }));
    const tools = createProductFileTools({
      generationId,
      conversationId,
      branchId,
      assistantMessageId,
      transport: { request },
    });
    const office = tools.find(({ name }) => name === "openerx_office_artifact");
    const result = await office?.execute(
      "office-call",
      {
        displayName: "release-review",
        spec: {
          format: "pptx",
          title: "Release review",
          slides: [
            { title: "Scope", bullets: [] },
            { title: "Gate", bullets: ["Visual review"] },
          ],
        },
      },
      undefined,
      undefined,
      {} as never,
    );

    expect(result?.content).toEqual([
      expect.objectContaining({ type: "text", text: expect.stringContaining("2 visual-review") }),
      { type: "image", mimeType: "image/png", data: expect.any(String) },
      { type: "image", mimeType: "image/png", data: expect.any(String) },
    ]);
    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({
        assistantMessageId,
        piToolCallId: "office-call",
        toolName: "openerx_office_artifact",
        request: expect.objectContaining({ operation: "artifact.office.write" }),
      }),
    );
    expect(JSON.stringify(result?.details)).not.toContain("imageDataUrl");
    expect(JSON.stringify(result?.details)).not.toContain("modelImageDataUrl");
  });
});
