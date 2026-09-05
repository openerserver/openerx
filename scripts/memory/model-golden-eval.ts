import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import {
  automaticMemoryExtractionOutputSchema,
  memorySemanticClusterOutputSchema,
  redactSensitiveText,
  safeErrorMessage,
  type UsageRecord,
} from "@openerx/contracts";
import {
  createDeepSeekModelCatalog,
  createDeepSeekModelExecutorFromEnv,
  deepSeekDefaultModelFromEnv,
  ModelGatewayService,
} from "@openerx/model-gateway";
import { createProductPiSession, ModelRuntime } from "@openerx/pi-host";
import {
  filterIneligibleMemoryExtractionSources,
  memoryClusterSystemPrompt,
  memoryExtractionSystemPrompt,
  parseMemoryJsonOutput,
  validateMemoryClusterOutput,
  validateMemoryExtractionOutput,
} from "@openerx/pi-host/memory-background";
import { createPlatformModelProvider } from "@openerx/pi-host/platform-provider";
import { ZodError } from "zod";
import {
  clusterKey,
  evaluateMemoryGolden,
  extractionKey,
  extractionPredictionKey,
  type MemoryGoldenCase,
  type MemoryGoldenObservation,
  type MemoryGoldenSuite,
  memoryGoldenDatasetSchema,
} from "./model-golden-contract";

function option(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length);
}

function repetitions(): number {
  const value = Number(option("repetitions") ?? "1");
  if (!Number.isInteger(value) || value < 1 || value > 5) {
    throw new Error("MEMORY_GOLDEN_REPETITIONS_INVALID");
  }
  return value;
}

function selectedSuites(): Set<MemoryGoldenSuite> {
  const values = option("suites")?.split(",").filter(Boolean) ?? ["cluster", "extract"];
  if (values.some((value) => value !== "cluster" && value !== "extract")) {
    throw new Error("MEMORY_GOLDEN_SUITE_INVALID");
  }
  return new Set(values as MemoryGoldenSuite[]);
}

function selectedCases(cases: readonly MemoryGoldenCase[]): MemoryGoldenCase[] {
  const suites = selectedSuites();
  const requested = option("cases")?.split(",").filter(Boolean);
  const filtered = cases.filter(
    (item) => suites.has(item.suite) && (!requested || requested.includes(item.id)),
  );
  if (requested) {
    const missing = requested.filter((id) => !filtered.some((item) => item.id === id));
    if (missing.length > 0) throw new Error(`MEMORY_GOLDEN_CASE_UNKNOWN:${missing.join(",")}`);
  }
  if (filtered.length === 0) throw new Error("MEMORY_GOLDEN_CASES_EMPTY");
  return filtered;
}

function lastAssistantMessage(messages: readonly unknown[]): AssistantMessage | undefined {
  return [...messages]
    .reverse()
    .find((message): message is AssistantMessage =>
      Boolean(
        message &&
          typeof message === "object" &&
          (message as { role?: unknown }).role === "assistant",
      ),
    );
}

function assistantText(message: AssistantMessage | undefined): string {
  if (!message) return "";
  return message.content
    .filter(
      (part): part is Extract<(typeof message.content)[number], { type: "text" }> =>
        part.type === "text",
    )
    .map(({ text }) => text)
    .join("")
    .trim();
}

function aggregateUsage(records: readonly UsageRecord[]): MemoryGoldenObservation["usage"] {
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
    providerReported:
      records.length > 0 && records.every(({ providerReported }) => providerReported),
    effectiveModelRefs: [
      ...new Set(records.map(({ effectiveModelRef }) => effectiveModelRef)),
    ].sort(),
  };
}

const extraSensitivePatterns: readonly RegExp[] = [
  /\bsk-[A-Za-z0-9_-]{16,}\b/u,
  /\bsecret[_ -]?token\s*[:=]\s*\S+/iu,
];

function containsSensitiveContent(content: string): boolean {
  return (
    redactSensitiveText(content) !== content ||
    extraSensitivePatterns.some((pattern) => pattern.test(content))
  );
}

function expectedKeys(item: MemoryGoldenCase): string[] {
  return item.suite === "cluster"
    ? item.expectedRelations.map(clusterKey)
    : item.expectedCandidates.map(extractionKey);
}

function errorCode(error: unknown): string {
  const candidate = error instanceof Error ? error.message.split(":", 1)[0] : "";
  return candidate && /^[A-Z][A-Z0-9_]*$/u.test(candidate)
    ? candidate
    : "MEMORY_GOLDEN_MODEL_FAILED";
}

async function runCase(
  item: MemoryGoldenCase,
  repetition: number,
): Promise<MemoryGoldenObservation> {
  const startedAt = Date.now();
  const temporaryRoot = mkdtempSync(path.join(tmpdir(), "openerx-memory-model-golden-"));
  const sessionDirectory = path.join(temporaryRoot, "session");
  const agentDirectory = path.join(temporaryRoot, "agent");
  mkdirSync(sessionDirectory, { recursive: true });
  mkdirSync(agentDirectory, { recursive: true });
  const usageRecords: UsageRecord[] = [];
  let predictedKeys: string[] = [];
  let modelPredictedKeys: string[] = [];
  let guardRejectedCandidates = 0;
  let invalidOutput = false;
  let sensitiveLeak = false;
  let caughtCode: string | null = null;
  let session: Awaited<ReturnType<typeof createProductPiSession>>["session"] | undefined;
  try {
    const gateway = new ModelGatewayService({
      catalog: createDeepSeekModelCatalog(deepSeekDefaultModelFromEnv()),
      executor: createDeepSeekModelExecutorFromEnv(),
      usageStore: {
        record(record) {
          usageRecords.push(record);
          return { record, replayed: false };
        },
      },
    });
    const requestId = randomUUID();
    const platform = createPlatformModelProvider({
      catalog: gateway.catalog(),
      transport: { execute: (request, signal) => gateway.execute(request, signal) },
      request: {
        accountId: randomUUID(),
        conversationId: randomUUID(),
        messageId: requestId,
        selectedModelRef: "platform/auto",
        approvedFallbackModelRef: null,
        requestDedupeKey: `memory-model-golden:${item.id}:${repetition}:${requestId}`,
      },
      thinkingLevel: "medium",
      onUsage: () => undefined,
      streamChunkSize: 64,
      contextRedactions: [
        { value: sessionDirectory, replacement: "<private-memory-eval-session>" },
        { value: agentDirectory, replacement: "<private-memory-eval-agent>" },
      ],
    });
    const runtime = await ModelRuntime.create({ modelsPath: null, refreshOnCreate: false });
    runtime.registerNativeProvider(platform.provider);
    const created = await createProductPiSession({
      cwd: sessionDirectory,
      agentDir: agentDirectory,
      history: [],
      thinkingLevel: "medium",
      modelRuntime: runtime,
      model: platform.model,
      customTools: [],
      systemPromptOverride:
        item.suite === "cluster" ? memoryClusterSystemPrompt : memoryExtractionSystemPrompt,
    });
    session = created.session;
    await session.prompt(
      JSON.stringify(
        item.suite === "cluster"
          ? { task: "find_memory_duplicates_and_conflicts", memories: item.memories }
          : {
              task: "extract_durable_user_memories",
              messages: item.messages,
              existingMemories: item.existingMemories.map((memory) => ({
                ...memory,
                conflictKey: memory.conflictKey ?? null,
              })),
            },
      ),
      { expandPromptTemplates: false },
    );
    await session.waitForIdle();
    const assistant = lastAssistantMessage(session.messages);
    if (!assistant || assistant.stopReason === "error" || assistant.stopReason === "aborted") {
      throw new Error("MEMORY_GOLDEN_MODEL_FAILED");
    }
    if (assistant.stopReason === "length") throw new Error("MEMORY_GOLDEN_OUTPUT_TRUNCATED");
    const responseText = assistantText(assistant);
    if (item.suite === "cluster") {
      const output = memorySemanticClusterOutputSchema.parse(
        parseMemoryJsonOutput(responseText, "MEMORY_CLUSTER_OUTPUT_INVALID"),
      );
      validateMemoryClusterOutput(output, item.memories);
      predictedKeys = output.proposals.map(clusterKey);
      modelPredictedKeys = [...predictedKeys];
    } else {
      sensitiveLeak = containsSensitiveContent(responseText);
      const parsedOutput = automaticMemoryExtractionOutputSchema.parse(
        parseMemoryJsonOutput(responseText, "MEMORY_EXTRACTION_OUTPUT_INVALID"),
      );
      modelPredictedKeys = parsedOutput.candidates.map((candidate) =>
        extractionPredictionKey(candidate, item.expectedCandidates),
      );
      const output = filterIneligibleMemoryExtractionSources(parsedOutput, item.messages);
      guardRejectedCandidates = parsedOutput.candidates.length - output.candidates.length;
      validateMemoryExtractionOutput(output, item.messages, item.existingMemories);
      predictedKeys = output.candidates.map((candidate) =>
        extractionPredictionKey(candidate, item.expectedCandidates),
      );
    }
  } catch (error) {
    const schemaInvalid = error instanceof ZodError;
    caughtCode = schemaInvalid
      ? item.suite === "cluster"
        ? "MEMORY_CLUSTER_OUTPUT_INVALID"
        : "MEMORY_EXTRACTION_OUTPUT_INVALID"
      : errorCode(error);
    invalidOutput =
      schemaInvalid ||
      /(?:OUTPUT_INVALID|SOURCE_INVALID|RELATION_INVALID|OUTPUT_TRUNCATED)$/u.test(caughtCode);
  } finally {
    session?.dispose();
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
  return {
    caseId: item.id,
    suite: item.suite,
    repetition,
    safetyCase: item.safetyCase,
    expectedKeys: expectedKeys(item),
    modelPredictedKeys,
    predictedKeys,
    guardRejectedCandidates,
    invalidOutput,
    sensitiveLeak,
    errorCode: caughtCode,
    durationMs: Date.now() - startedAt,
    usage: aggregateUsage(usageRecords),
  };
}

try {
  const datasetPath = path.resolve(
    option("dataset") ?? "tests/v2/golden/memory-semantic-golden-v1.json",
  );
  const serializedDataset = readFileSync(datasetPath, "utf8");
  const dataset = memoryGoldenDatasetSchema.parse(JSON.parse(serializedDataset));
  const cases = selectedCases(dataset.cases);
  const repeatCount = repetitions();
  const observations: MemoryGoldenObservation[] = [];
  for (let repetition = 1; repetition <= repeatCount; repetition += 1) {
    for (const item of cases) {
      process.stderr.write(`[memory-model-golden] ${item.id} repetition=${repetition}\n`);
      const observation = await runCase(item, repetition);
      observations.push(observation);
      process.stderr.write(
        `[memory-model-golden] result predicted=${observation.predictedKeys.length} error=${observation.errorCode ?? "none"} tokens=${observation.usage.totalTokens} durationMs=${observation.durationMs}\n`,
      );
    }
  }
  const evaluation = evaluateMemoryGolden(observations);
  const result = {
    schemaVersion: 1,
    scoringVersion: 1,
    kind: dataset.datasetId.includes("-holdout-") ? "memory_model_holdout" : "memory_model_golden",
    generatedAt: new Date().toISOString(),
    datasetId: dataset.datasetId,
    datasetDigest: `sha256:${createHash("sha256").update(serializedDataset).digest("hex")}`,
    configuredModel: deepSeekDefaultModelFromEnv(),
    effectiveModelRefs: evaluation.usage.effectiveModelRefs,
    thinkingLevel: "medium",
    repetitions: repeatCount,
    cases: cases.map(({ id, suite, tags, safetyCase }) => ({ id, suite, tags, safetyCase })),
    evaluation,
    observations,
  };
  const output = option("output");
  if (output) {
    const destination = path.resolve(output);
    mkdirSync(path.dirname(destination), { recursive: true });
    writeFileSync(destination, `${JSON.stringify(result, null, 2)}\n`);
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!evaluation.gate.passed && option("allow-gate-failure") !== "true") {
    process.exitCode = 2;
  }
} catch (error) {
  process.stderr.write(`${safeErrorMessage(error, "Memory model Golden evaluation failed")}\n`);
  process.exitCode = 1;
}
