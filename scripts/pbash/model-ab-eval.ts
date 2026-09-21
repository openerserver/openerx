import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  automaticModelRef,
  BROKERED_BASH_CONTRACT_VERSION,
  BROKERED_BASH_CORE_ENVIRONMENT_POLICY_ID,
  BROKERED_BASH_DENY_NETWORK_POLICY_ID,
  BROKERED_BASH_MACOS_SANDBOX_POLICY_VERSION,
  type BrokeredBashExecutionContext,
  type PiToolProgressFrame,
  type PiToolRequestFrame,
  safeErrorMessage,
  type UsageRecord,
  type WorkspaceGrant,
} from "@openerx/contracts";
import {
  createDeepSeekModelCatalog,
  createDeepSeekModelExecutorFromEnv,
  deepSeekDefaultModelFromEnv,
  ModelGatewayService,
} from "@openerx/model-gateway";
import { createProductPiSession, ModelRuntime } from "@openerx/pi-host";
import { createPlatformModelProvider } from "@openerx/pi-host/platform-provider";
import {
  BROKERED_BASH_CORE_ENVIRONMENT_POLICY,
  BrokeredBashAdapter,
  brokeredBashEnvironmentPolicyDigest,
  brokeredBashNetworkPolicyDigest,
  MacOSSandboxExecEngine,
  ShellToolAdapter,
  ToolAdapterError,
  type ToolExecutionContext,
} from "@openerx/tool-sdk";
import { createProductCapabilityTools } from "../../packages/pi-host/src/capability-tools";

type Variant = "legacy" | "brokered";

interface EvalTask {
  id: string;
  prompt: string;
  marker: string | null;
  stopAfterToolStart?: boolean;
  expectedCommandFailure?: boolean;
}

interface ToolEvent {
  toolName: string;
  toolCallId: string;
  args: unknown;
  isError: boolean | null;
  resultSummary: string | null;
}

interface EvalRun {
  taskId: string;
  variant: Variant;
  repetition: number;
  completed: boolean;
  stopped: boolean;
  modelRounds: number;
  toolCalls: number;
  toolErrors: number;
  unexpectedToolErrors: number;
  usage: ReturnType<typeof aggregateUsage>;
  durationMs: number;
  finalText: string;
  stopReason: string | null;
  error: string | null;
  activeWorkspacePathEmissionObserved: boolean;
  privateCwdPathEmissionObserved: boolean;
  toolEvents: ToolEvent[];
}

interface EvalDirectories {
  root: string;
  workspace: string;
  piCwd: string;
  agentDir: string;
}

const tasks: EvalTask[] = [
  {
    id: "repository_exploration",
    prompt:
      "使用当前提供的命令执行工具探索仓库并读取 package.json，确认项目名。完成后只在最后一行输出 PBASH_EXPLORE_OK:pbash-eval-fixture。不得在没有工具结果时输出该标记。",
    marker: "PBASH_EXPLORE_OK:pbash-eval-fixture",
  },
  {
    id: "combined_search",
    prompt:
      "使用当前提供的命令执行工具在仓库中搜索字符串 needle-42，并确认文件和行号。完成后只在最后一行输出 PBASH_SEARCH_OK:src/math.js:2。不得猜测。",
    marker: "PBASH_SEARCH_OK:src/math.js:2",
  },
  {
    id: "build",
    prompt:
      "使用当前提供的命令执行工具运行 node --check src/math.js。只有命令成功后，最后一行输出 PBASH_BUILD_OK。",
    marker: "PBASH_BUILD_OK",
  },
  {
    id: "test",
    prompt:
      "使用当前提供的命令执行工具运行 node tests/math.test.js。确认测试输出后，最后一行输出 PBASH_TEST_OK。",
    marker: "PBASH_TEST_OK",
  },
  {
    id: "lint",
    prompt:
      "使用当前提供的命令执行工具检查 src/math.js 和 tests/math.test.js 的 Node 语法。两者都成功后，最后一行输出 PBASH_LINT_OK。",
    marker: "PBASH_LINT_OK",
  },
  {
    id: "failure_diagnosis",
    prompt:
      "使用当前提供的命令执行工具运行 node broken.js。该命令预期失败；根据真实 stderr 诊断错误码，最后一行输出 PBASH_DIAGNOSIS_OK:BROKEN_WIDGET_CODE_17。",
    marker: "PBASH_DIAGNOSIS_OK:BROKEN_WIDGET_CODE_17",
    expectedCommandFailure: true,
  },
  {
    id: "pre_patch_validation",
    prompt:
      "使用当前提供的命令执行工具原样运行 git diff --check --no-index src/math.js src/math.js。只有退出码为 0 时，最后一行输出 PBASH_PATCH_CHECK_OK；失败时必须报告失败且不能输出成功标记。",
    marker: "PBASH_PATCH_CHECK_OK",
  },
  {
    id: "long_output",
    prompt:
      "使用当前提供的命令执行工具运行 node scripts/long-output.js，核对最后一行。只有实际看到 line-249 后，最后一行输出 PBASH_LONG_OUTPUT_OK:line-249。",
    marker: "PBASH_LONG_OUTPUT_OK:line-249",
  },
  {
    id: "stop",
    prompt:
      "使用当前提供的命令执行工具以前台方式运行 sleep 60；不要设置后台运行。评测控制器会在工具启动后停止当前 Agent。",
    marker: null,
    stopAfterToolStart: true,
  },
];

function option(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length);
}

function selectedTasks(): EvalTask[] {
  const requested = option("tasks")?.split(",").filter(Boolean);
  if (!requested || requested.length === 0) return tasks;
  const selected = tasks.filter(({ id }) => requested.includes(id));
  const missing = requested.filter((id) => !selected.some((task) => task.id === id));
  if (missing.length > 0) throw new Error(`PBASH_EVAL_TASK_UNKNOWN:${missing.join(",")}`);
  return selected;
}

function selectedVariants(): Variant[] {
  const requested = option("variants")?.split(",").filter(Boolean) ?? ["legacy", "brokered"];
  if (requested.some((value) => value !== "legacy" && value !== "brokered")) {
    throw new Error("PBASH_EVAL_VARIANT_INVALID");
  }
  return requested as Variant[];
}

function repetitions(): number {
  const value = Number(option("repetitions") ?? "1");
  if (!Number.isInteger(value) || value < 1 || value > 10) {
    throw new Error("PBASH_EVAL_REPETITIONS_INVALID");
  }
  return value;
}

function createWorkspace(): EvalDirectories {
  const root = mkdtempSync(path.join(tmpdir(), "openerx-pbash-model-ab-"));
  const workspace = path.join(root, "workspace");
  const piCwd = path.join(root, "pi-private-cwd");
  const agentDir = path.join(root, "agent");
  mkdirSync(workspace, { recursive: true });
  mkdirSync(piCwd, { recursive: true });
  mkdirSync(agentDir, { recursive: true });
  mkdirSync(path.join(workspace, "src"), { recursive: true });
  mkdirSync(path.join(workspace, "tests"), { recursive: true });
  mkdirSync(path.join(workspace, "scripts"), { recursive: true });
  writeFileSync(
    path.join(workspace, "package.json"),
    `${JSON.stringify({ name: "pbash-eval-fixture", private: true, type: "module" }, null, 2)}\n`,
  );
  writeFileSync(
    path.join(workspace, "src/math.js"),
    'export const add = (left, right) => left + right;\nexport const PBASH_NEEDLE = "needle-42";\n',
  );
  writeFileSync(
    path.join(workspace, "tests/math.test.js"),
    'import assert from "node:assert/strict";\nimport { add } from "../src/math.js";\nassert.equal(add(2, 3), 5);\nconsole.log("PBASH_TEST_OK");\n',
  );
  writeFileSync(path.join(workspace, "broken.js"), 'throw new Error("BROKEN_WIDGET_CODE_17");\n');
  writeFileSync(
    path.join(workspace, "scripts/long-output.js"),
    'for (let index = 0; index < 250; index += 1) console.log("line-" + index);\n',
  );
  writeFileSync(path.join(workspace, "README.md"), "# PBASH fixed model evaluation fixture\n");
  return { root, workspace, piCwd, agentDir };
}

function snapshotDigest(workspace: string): string {
  const contents = [
    "package.json",
    "src/math.js",
    "tests/math.test.js",
    "broken.js",
    "scripts/long-output.js",
    "README.md",
  ].map(
    (relativePath) =>
      `${relativePath}\0${readFileSync(path.join(workspace, relativePath), "utf8")}`,
  );
  return createHash("sha256").update(contents.join("\0"), "utf8").digest("hex");
}

function aggregateUsage(records: UsageRecord[]) {
  const sum = (
    field: "inputTokens" | "cachedInputTokens" | "outputTokens" | "reasoningTokens" | "totalTokens",
  ) => records.reduce((total, record) => total + (record[field] ?? 0), 0);
  return {
    calls: records.length,
    inputTokens: sum("inputTokens"),
    cachedInputTokens: sum("cachedInputTokens"),
    outputTokens: sum("outputTokens"),
    reasoningTokens: sum("reasoningTokens"),
    totalTokens: sum("totalTokens"),
    providerReported: records.every(({ providerReported }) => providerReported),
  };
}

function assistantText(messages: readonly unknown[]): { text: string; stopReason: string | null } {
  const assistants = messages.filter(
    (message): message is { role: "assistant"; content: unknown; stopReason?: string } =>
      Boolean(
        message &&
          typeof message === "object" &&
          (message as { role?: unknown }).role === "assistant",
      ),
  );
  const last = assistants.at(-1);
  if (!last) return { text: "", stopReason: null };
  const text = Array.isArray(last.content)
    ? last.content
        .flatMap((part) =>
          part && typeof part === "object" && (part as { type?: unknown }).type === "text"
            ? [String((part as { text?: unknown }).text ?? "")]
            : [],
        )
        .join("")
    : typeof last.content === "string"
      ? last.content
      : "";
  return { text, stopReason: last.stopReason ?? null };
}

function finalMarkerObserved(text: string, marker: string | null): boolean {
  if (!marker) return false;
  const lastLine = text
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .at(-1);
  if (!lastLine) return false;
  const normalized = lastLine
    .replace(/[`*#]/gu, "")
    .replace(/[。.!！]+$/u, "")
    .trim();
  return normalized.endsWith(marker);
}

async function runTask(task: EvalTask, variant: Variant, repetition: number): Promise<EvalRun> {
  const startedAt = Date.now();
  const directories = createWorkspace();
  const { workspace } = directories;
  const accountId = randomUUID();
  const conversationId = randomUUID();
  const messageId = randomUUID();
  const generationId = randomUUID();
  const branchId = randomUUID();
  const usageRecords: UsageRecord[] = [];
  const toolEvents: ToolEvent[] = [];
  const grant: WorkspaceGrant = {
    id: "11111111-1111-4111-8111-111111111111",
    ownerProfileId: "pbash-model-eval",
    conversationId,
    displayName: "pbash-eval-fixture",
    rootPath: workspace,
    access: "read_write",
    allowNetwork: false,
    expiresAt: null,
    revokedAt: null,
    createdAt: "2026-08-28T00:00:00.000Z",
  };
  const networkPolicy = { mode: "deny" } as const;
  const execution: BrokeredBashExecutionContext = {
    contractVersion: BROKERED_BASH_CONTRACT_VERSION,
    activeExecutionGrantId: grant.id,
    additionalExecutionGrantIds: [],
    executionProfile: "workspace_write",
    executionOrigin: "local_interactive",
    workspaceWriteMode: "direct_workspace",
    environmentPolicyId: BROKERED_BASH_CORE_ENVIRONMENT_POLICY_ID,
    environmentPolicyDigest: brokeredBashEnvironmentPolicyDigest(
      BROKERED_BASH_CORE_ENVIRONMENT_POLICY,
    ),
    networkPolicyId: BROKERED_BASH_DENY_NETWORK_POLICY_ID,
    networkPolicyDigest: brokeredBashNetworkPolicyDigest(networkPolicy),
    sandboxPolicyVersion: BROKERED_BASH_MACOS_SANDBOX_POLICY_VERSION,
  };
  const resolveGrant = (grantId: string, requestedConversationId: string) => {
    if (grantId !== grant.id || requestedConversationId !== conversationId) {
      throw new Error("PBASH_EVAL_WORKSPACE_GRANT_INVALID");
    }
    return grant;
  };
  const legacy = new ShellToolAdapter([workspace], resolveGrant);
  const engine = new MacOSSandboxExecEngine();
  const brokered = new BrokeredBashAdapter(
    resolveGrant,
    (requestedGenerationId) => (requestedGenerationId === generationId ? execution : undefined),
    engine,
  );
  const adapter = variant === "legacy" ? legacy : brokered;
  const transport = {
    async request(
      frame: PiToolRequestFrame,
      options?: { signal?: AbortSignal; onProgress?(frame: PiToolProgressFrame): void },
    ) {
      const signal = options?.signal ?? new AbortController().signal;
      const projection: NonNullable<ToolExecutionContext["projection"]> = {
        generationId,
        workItemId: randomUUID(),
        runId: randomUUID(),
        conversationId,
        assistantMessageId: messageId,
        piToolCallId: frame.piToolCallId,
        toolName: frame.toolName,
      };
      try {
        return await adapter.execute(frame.operation, {
          signal,
          toolCallId: randomUUID(),
          projection,
          update: () => undefined,
        });
      } catch (error) {
        if (error instanceof ToolAdapterError) {
          throw new Error(`${error.code}: ${error.result.summary}`);
        }
        throw error;
      }
    },
  };
  const allTools = createProductCapabilityTools({
    generationId,
    conversationId,
    branchId,
    assistantMessageId: messageId,
    transport,
    ...(variant === "brokered" ? { brokeredBashExecution: execution } : {}),
  });
  const allowedNames = new Set(
    variant === "legacy" ? ["openerx_shell", "openerx_shell_process"] : ["bash"],
  );
  const customTools = allTools.filter(({ name }) => allowedNames.has(name));
  let session: Awaited<ReturnType<typeof createProductPiSession>>["session"] | undefined;
  let modelRounds = 0;
  let stopped = false;
  let error: string | null = null;
  try {
    const executor = createDeepSeekModelExecutorFromEnv();
    const gateway = new ModelGatewayService({
      catalog: createDeepSeekModelCatalog(deepSeekDefaultModelFromEnv()),
      executor,
      usageStore: {
        record(record) {
          usageRecords.push(record);
          return { record, replayed: false };
        },
      },
    });
    const platform = createPlatformModelProvider({
      catalog: gateway.catalog(),
      transport: { execute: (request, signal) => gateway.execute(request, signal) },
      request: {
        accountId,
        conversationId,
        messageId,
        selectedModelRef: automaticModelRef,
        approvedFallbackModelRef: null,
        requestDedupeKey: `pbash-model-ab:${task.id}:${variant}:${repetition}:${randomUUID()}`,
      },
      thinkingLevel: "off",
      onUsage: () => undefined,
      streamChunkSize: 64,
      contextRedactions: [
        {
          value: directories.piCwd,
          replacement: "<private-pi-session-directory-not-a-tool-workspace>",
        },
        { value: directories.agentDir, replacement: "<private-pi-agent-directory>" },
      ],
    });
    const runtime = await ModelRuntime.create({ modelsPath: null, refreshOnCreate: false });
    runtime.registerNativeProvider(platform.provider);
    const created = await createProductPiSession({
      cwd: directories.piCwd,
      agentDir: directories.agentDir,
      history: [
        {
          role: "system",
          text: "这是固定 Coding Agent 评测。必须实际使用唯一提供的命令执行工具；网络不可用；不要修改文件；不得根据用户消息猜测成功标记。工具失败后可以诊断或安全重试。回答保持简短。",
        },
      ],
      thinkingLevel: "off",
      modelRuntime: runtime,
      model: platform.model,
      customTools,
      workspace: {
        grants: [
          {
            id: grant.id,
            displayName: grant.displayName,
            access: grant.access,
            allowNetwork: grant.allowNetwork,
            expiresAt: grant.expiresAt,
          },
        ],
        instructionSources: [],
        ...(variant === "brokered" ? { execution } : {}),
      },
    });
    session = created.session;
    session.subscribe((event) => {
      if (event.type === "turn_start") modelRounds += 1;
      if (event.type === "tool_execution_start") {
        toolEvents.push({
          toolName: event.toolName,
          toolCallId: event.toolCallId,
          args: event.args,
          isError: null,
          resultSummary: null,
        });
        if (task.stopAfterToolStart) {
          setTimeout(() => {
            stopped = true;
            void adapter.stopAll?.();
            void session?.abort();
          }, 250);
        }
      }
      if (event.type === "tool_execution_end") {
        const matching = toolEvents.findLast(({ toolCallId }) => toolCallId === event.toolCallId);
        if (matching) {
          matching.isError = event.isError;
          matching.resultSummary = JSON.stringify(event.result).slice(0, 4_000);
        }
      }
    });
    await session.prompt(task.prompt, { expandPromptTemplates: false });
    await session.waitForIdle();
  } catch (caught) {
    error = safeErrorMessage(caught, "PBASH model evaluation failed");
  } finally {
    await adapter.stopAll?.();
  }
  const final = assistantText(session?.messages ?? []);
  const toolErrors = toolEvents.filter(({ isError }) => isError === true).length;
  const successfulToolCall = toolEvents.some(({ isError }) => isError === false);
  const expectedFailureEvidence = task.marker?.split(":").slice(1).join(":") ?? "";
  const observedExpectedFailure = toolEvents.some(
    ({ isError, resultSummary }) =>
      isError === true ||
      (expectedFailureEvidence.length > 0 && resultSummary?.includes(expectedFailureEvidence)),
  );
  const completed = task.stopAfterToolStart
    ? stopped && toolEvents.length > 0
    : toolEvents.length > 0 &&
      finalMarkerObserved(final.text, task.marker) &&
      (task.expectedCommandFailure ? observedExpectedFailure : successfulToolCall);
  const serializedToolEvents = JSON.stringify(toolEvents);
  const observableModelOutput = `${serializedToolEvents}\n${final.text}`;
  const activeWorkspacePathEmissionObserved = observableModelOutput.includes(workspace);
  const privateCwdPathEmissionObserved = observableModelOutput.includes(directories.piCwd);
  const redact = (value: string) =>
    value
      .replaceAll(workspace, "$OPENERX_WORKSPACE")
      .replaceAll(directories.piCwd, "$OPENERX_PI_PRIVATE_CWD")
      .replaceAll(directories.agentDir, "$OPENERX_AGENT_DIR")
      .replaceAll(directories.root, "$OPENERX_EVAL_ROOT");
  const redactedToolEvents = JSON.parse(redact(serializedToolEvents)) as ToolEvent[];
  session?.dispose();
  rmSync(directories.root, { recursive: true, force: true });
  return {
    taskId: task.id,
    variant,
    repetition,
    completed,
    stopped,
    modelRounds,
    toolCalls: toolEvents.length,
    toolErrors,
    unexpectedToolErrors:
      task.expectedCommandFailure || task.stopAfterToolStart
        ? Math.max(0, toolErrors - 1)
        : toolErrors,
    usage: aggregateUsage(usageRecords),
    durationMs: Date.now() - startedAt,
    finalText: redact(final.text.slice(-4_000)),
    stopReason: final.stopReason,
    error: error ? redact(error) : null,
    activeWorkspacePathEmissionObserved,
    privateCwdPathEmissionObserved,
    toolEvents: redactedToolEvents,
  };
}

function summarize(runs: EvalRun[], variant: Variant) {
  const selected = runs.filter((run) => run.variant === variant);
  return {
    tasks: selected.length,
    completed: selected.filter(({ completed }) => completed).length,
    completionRate:
      selected.length === 0
        ? 0
        : selected.filter(({ completed }) => completed).length / selected.length,
    modelRounds: selected.reduce((sum, run) => sum + run.modelRounds, 0),
    toolCalls: selected.reduce((sum, run) => sum + run.toolCalls, 0),
    toolErrors: selected.reduce((sum, run) => sum + run.toolErrors, 0),
    unexpectedToolErrors: selected.reduce((sum, run) => sum + run.unexpectedToolErrors, 0),
    inputTokens: selected.reduce((sum, run) => sum + run.usage.inputTokens, 0),
    cachedInputTokens: selected.reduce((sum, run) => sum + run.usage.cachedInputTokens, 0),
    outputTokens: selected.reduce((sum, run) => sum + run.usage.outputTokens, 0),
    reasoningTokens: selected.reduce((sum, run) => sum + run.usage.reasoningTokens, 0),
    totalTokens: selected.reduce((sum, run) => sum + run.usage.totalTokens, 0),
    durationMs: selected.reduce((sum, run) => sum + run.durationMs, 0),
    activeWorkspacePathEmissions: selected.filter(
      ({ activeWorkspacePathEmissionObserved }) => activeWorkspacePathEmissionObserved,
    ).length,
    privateCwdPathEmissions: selected.filter(
      ({ privateCwdPathEmissionObserved }) => privateCwdPathEmissionObserved,
    ).length,
  };
}

try {
  const selected = selectedTasks();
  const variants = selectedVariants();
  const repeatCount = repetitions();
  const digestWorkspace = createWorkspace();
  const fixtureDigest = snapshotDigest(digestWorkspace.workspace);
  rmSync(digestWorkspace.root, { recursive: true, force: true });
  const runs: EvalRun[] = [];
  for (let repetition = 1; repetition <= repeatCount; repetition += 1) {
    for (const task of selected) {
      for (const variant of variants) {
        process.stderr.write(`[pbash-model-ab] ${task.id} ${variant} repetition=${repetition}\n`);
        const run = await runTask(task, variant, repetition);
        runs.push(run);
        process.stderr.write(
          `[pbash-model-ab] result completed=${run.completed} rounds=${run.modelRounds} tools=${run.toolCalls} tokens=${run.usage.totalTokens} durationMs=${run.durationMs}\n`,
        );
      }
    }
  }
  const result = {
    schemaVersion: 2,
    scoringVersion: 2,
    kind: "pbash_model_golden_ab",
    generatedAt: new Date().toISOString(),
    model: deepSeekDefaultModelFromEnv(),
    thinkingLevel: "off",
    networkPolicy: "deny",
    repetitions: repeatCount,
    fixtureDigest: `sha256:${fixtureDigest}`,
    tasks: selected.map(({ id, marker, stopAfterToolStart, expectedCommandFailure }) => ({
      id,
      marker,
      stopAfterToolStart: stopAfterToolStart ?? false,
      expectedCommandFailure: expectedCommandFailure ?? false,
    })),
    summary: Object.fromEntries(variants.map((variant) => [variant, summarize(runs, variant)])),
    runs,
  };
  const output = option("output");
  if (output) {
    mkdirSync(path.dirname(path.resolve(output)), { recursive: true });
    writeFileSync(path.resolve(output), `${JSON.stringify(result, null, 2)}\n`);
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} catch (error) {
  process.stderr.write(`${safeErrorMessage(error, "PBASH model A/B failed")}\n`);
  process.exitCode = 1;
}
