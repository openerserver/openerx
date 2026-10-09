import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai/providers/faux";
import {
  type AgentSession,
  createAgentSession,
  DefaultResourceLoader,
  defineTool,
  type ExtensionFactory,
  ModelRuntime,
  SessionManager,
  SettingsManager,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { afterEach, describe, expect, it } from "vitest";
import {
  type ControlledNativeToolOptions,
  createControlledNativeExtensions,
  getProductToolCallContext,
  wrapControlledProductTools,
} from "../src/native-tools";

const temporaryDirectories: string[] = [];
const sessions: AgentSession[] = [];

afterEach(() => {
  for (const session of sessions.splice(0)) session.dispose();
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

async function createFixture(
  tools: ToolDefinition[] = [],
  limits: ControlledNativeToolOptions = {},
  additionalExtensions: ExtensionFactory[] = [],
) {
  const directory = mkdtempSync(path.join(tmpdir(), "openerx-controlled-native-"));
  temporaryDirectories.push(directory);
  const settings = SettingsManager.inMemory({
    compaction: { enabled: false },
    retry: { enabled: false },
  });
  const loader = new DefaultResourceLoader({
    cwd: directory,
    agentDir: directory,
    settingsManager: settings,
    noExtensions: true,
    noSkills: true,
    noContextFiles: true,
    noPromptTemplates: true,
    noThemes: true,
    extensionFactories: [...createControlledNativeExtensions(limits), ...additionalExtensions],
  });
  await loader.reload();
  const runtime = await ModelRuntime.create({
    modelsPath: null,
    authPath: path.join(directory, "auth.json"),
    modelsStorePath: path.join(directory, "models.json"),
    allowModelNetwork: false,
    refreshOnCreate: false,
  });
  const faux = fauxProvider({ tokensPerSecond: 100_000 });
  runtime.registerNativeProvider(faux.provider);
  const sessionManager = SessionManager.inMemory(directory);
  const { session } = await createAgentSession({
    cwd: directory,
    agentDir: directory,
    modelRuntime: runtime,
    model: faux.getModel(),
    settingsManager: settings,
    sessionManager,
    resourceLoader: loader,
    noTools: "builtin",
    customTools: wrapControlledProductTools(tools, { nativeToolsEnabled: true }),
  });
  sessions.push(session);
  await session.bindExtensions({});
  session.setActiveToolsByName(["codemode", "tool_search", "openerx_tool_search"]);
  return { session, sessionManager, faux };
}

async function runCode(fixture: Awaited<ReturnType<typeof createFixture>>, ...scripts: string[]) {
  fixture.faux.setResponses([
    ...scripts.map((code) => fauxAssistantMessage(fauxToolCall("codemode", { code }))),
    fauxAssistantMessage("Synthetic probe complete."),
  ]);
  await fixture.session.prompt("Run this synthetic test without network access.", {
    expandPromptTemplates: false,
  });
  await fixture.session.waitForIdle();
  return fixture.session.messages.filter(
    (message): message is Extract<AgentSession["messages"][number], { role: "toolResult" }> =>
      message.role === "toolResult" && message.toolName === "codemode",
  );
}

function textOf(content: Array<{ type: string; text?: string }>): string {
  return content
    .filter(({ type }) => type === "text")
    .map(({ text }) => text ?? "")
    .join("\n");
}

function requiredAt<T>(values: T[], index = 0): T {
  const value = values[index];
  if (value === undefined) throw new Error("Expected a fixture result");
  return value;
}

describe("controlled Pi native tools", () => {
  it("keeps independent execution signals in concurrent product tool contexts", async () => {
    const observed: Array<{ id: string; signal?: AbortSignal }> = [];
    const tool = defineTool({
      name: "context_probe",
      label: "Context probe",
      description: "Synthetic context probe",
      parameters: Type.Object({}),
      execute: async (id) => {
        await new Promise<void>((resolve) => setImmediate(resolve));
        observed.push({ id, signal: getProductToolCallContext()?.signal });
        return { content: [{ type: "text", text: "ok" }], details: { id } };
      },
    });
    const wrapped = requiredAt(wrapControlledProductTools([tool]));
    const left = new AbortController();
    const right = new AbortController();
    await Promise.all([
      wrapped.execute("left", {}, left.signal, undefined, {} as never),
      wrapped.execute("right", {}, right.signal, undefined, {} as never),
    ]);
    expect(observed).toEqual([
      { id: "left", signal: left.signal },
      { id: "right", signal: right.signal },
    ]);
    expect(getProductToolCallContext()).toBeUndefined();
  });

  it("uses native parallel scripts with sanitized structured results and parent identities", async () => {
    const observed: Array<{ id: string; parent?: string; signal: boolean }> = [];
    const read = defineTool({
      name: "read_amount",
      label: "Read amount",
      description: "Read a synthetic spreadsheet amount",
      parameters: Type.Object({ amount: Type.Number() }),
      execute: async (id, { amount }) => {
        const context = getProductToolCallContext();
        observed.push({ id, parent: context?.parentToolCallId, signal: !!context?.signal });
        return {
          content: [{ type: "text", text: "Read complete." }],
          details: { amount, path: "/private/forbidden", bytesBase64: "c2VjcmV0" },
        };
      },
    });
    const fixture = await createFixture([read]);
    const results = await runCode(
      fixture,
      "const rows = await Promise.all([tools.read_amount({amount:111}),tools.read_amount({amount:222})]); text({total:rows.reduce((sum,row)=>sum+row.amount,0), privatePath:rows[0].path, models:typeof models});",
    );
    const result = requiredAt(results);
    expect(result.isError).toBe(false);
    expect(textOf(result.content)).toContain('"total":333');
    expect(textOf(result.content)).toContain('"models":"undefined"');
    expect(textOf(result.content)).not.toContain("/private/forbidden");
    expect(observed).toHaveLength(2);
    expect(observed.every(({ parent, signal }) => parent === result.toolCallId && signal)).toBe(
      true,
    );
    expect(new Set(observed.map(({ id }) => id)).size).toBe(2);
  });

  it("retains permission hooks for nested calls before dispatch", async () => {
    let executed = false;
    const write = defineTool({
      name: "denied_write",
      label: "Denied write",
      description: "Synthetic denied action",
      parameters: Type.Object({}),
      execute: async () => {
        executed = true;
        return { content: [], details: {} };
      },
    });
    const fixture = await createFixture([write], {}, [
      (pi) => {
        pi.on("tool_call", (event) =>
          event.toolName === "denied_write"
            ? { block: true, reason: "ENTERPRISE_POLICY_DENY" }
            : undefined,
        );
      },
    ]);
    const results = await runCode(fixture, "await tools.denied_write({});");
    expect(executed).toBe(false);
    expect(results[0]?.isError).toBe(true);
    expect(textOf(requiredAt(results).content)).toContain("ENTERPRISE_POLICY_DENY");
  });

  it("keeps structured tool errors as failures instead of returning successful script data", async () => {
    const failed = defineTool({
      name: "failed_read",
      label: "Failed read",
      description: "Synthetic failed read with unusable partial data",
      parameters: Type.Object({}),
      execute: async () => ({
        content: [{ type: "text", text: "DATA_VERIFICATION_FAILED" }],
        details: { amount: 123, usable: false },
        structuredContent: { amount: 123 },
        isError: true,
      }),
    });
    const fixture = await createFixture([failed]);
    const results = await runCode(
      fixture,
      "const amount=await tools.failed_read({});text(amount);",
    );
    const result = requiredAt(results);
    expect(result.isError).toBe(true);
    expect(textOf(result.content)).toContain("DATA_VERIFICATION_FAILED");
    expect(textOf(result.content)).not.toContain('"amount":123');
  });

  it("caps actual nested dispatch and concurrent execution", async () => {
    let running = 0;
    let peak = 0;
    let executed = 0;
    const slow = defineTool({
      name: "slow_read",
      label: "Slow read",
      description: "Synthetic delayed read",
      parameters: Type.Object({}),
      execute: async () => {
        running += 1;
        executed += 1;
        peak = Math.max(peak, running);
        await new Promise<void>((resolve) => setTimeout(resolve, 15));
        running -= 1;
        return { content: [], details: { ok: true } };
      },
    });
    const fixture = await createFixture([slow], { maxNestedCalls: 5, maxConcurrency: 2 });
    const results = await runCode(
      fixture,
      "const calls = await Promise.allSettled(Array.from({length:6},()=>tools.slow_read({})));text(calls.map(call=>call.status));",
    );
    expect(executed).toBe(5);
    expect(peak).toBe(2);
    expect(textOf(requiredAt(results).content)).toContain("rejected");
  });

  it("enforces code size and a deadline even when the script requests larger limits", async () => {
    const fixture = await createFixture([], { timeoutMs: 100, maxCodeBytes: 256 });
    const startedAt = Date.now();
    const results = await runCode(
      fixture,
      '// @options: {"timeout_ms":2000000}\nwhile(true){}',
      "x".repeat(257),
    );
    expect(Date.now() - startedAt).toBeLessThan(5_000);
    expect(results[0]?.isError).toBe(true);
    expect(textOf(requiredAt(results).content)).toMatch(/timed out|aborted/u);
    expect(results[1]?.isError).toBe(true);
    expect(textOf(requiredAt(results, 1).content)).toContain("PI_NATIVE_CODE_LIMIT");
  });

  it("propagates cancellation when a script leaves a nested call outstanding", async () => {
    let cancellationObserved = false;
    const pending = defineTool({
      name: "pending_read",
      label: "Pending read",
      description: "Synthetic cancellable read",
      parameters: Type.Object({}),
      execute: async (_id, _params, signal) => {
        await new Promise<void>((_resolve, reject) => {
          const aborted = () => {
            cancellationObserved = true;
            reject(new Error("TOOL_CANCELLED"));
          };
          signal?.addEventListener("abort", aborted, { once: true });
          if (signal?.aborted) aborted();
        });
        return { content: [], details: {} };
      },
    });
    const fixture = await createFixture([pending]);
    await runCode(fixture, 'tools.pending_read({}); text("Script ended.");');
    expect(cancellationObserved).toBe(true);
  });

  it("does not persist script store values or expose temporary spill paths", async () => {
    const fixture = await createFixture([], { maxOutputTokens: 20 });
    const results = await runCode(
      fixture,
      'store("secret", "session-secret");text("x".repeat(20000));',
      'text({loaded:load("secret") ?? null});',
    );
    expect(textOf(requiredAt(results).content)).not.toContain("pi-codemode-");
    expect(JSON.stringify(requiredAt(results).details)).not.toContain("fullOutputPath");
    expect(textOf(requiredAt(results, 1).content)).toContain('"loaded":null');
    expect(
      fixture.sessionManager
        .getEntries()
        .some((entry) => entry.type === "custom" && entry.customType === "codemode-store"),
    ).toBe(false);
  });

  it("supports native English tool search and the existing Chinese search bridge", async () => {
    const read = defineTool({
      name: "read_table",
      label: "读取表格",
      description: "spreadsheet read",
      parameters: Type.Object({}),
      execute: async () => ({ content: [], details: {} }),
    });
    const fixture = await createFixture([read]);
    fixture.faux.setResponses([
      fauxAssistantMessage(fauxToolCall("openerx_tool_search", { query: "读取表格" })),
      fauxAssistantMessage("complete"),
    ]);
    await fixture.session.prompt("Find this tool.", { expandPromptTemplates: false });
    await fixture.session.waitForIdle();
    expect(fixture.session.getActiveToolNames()).toContain("read_table");
    fixture.session.setActiveToolsByName(["tool_search", "codemode", "openerx_tool_search"]);
    fixture.faux.setResponses([
      fauxAssistantMessage(fauxToolCall("tool_search", { query: "spreadsheet" })),
      fauxAssistantMessage("complete"),
    ]);
    await fixture.session.prompt("Find it again.", { expandPromptTemplates: false });
    await fixture.session.waitForIdle();
    expect(fixture.session.getActiveToolNames()).toContain("read_table");
  });
});
