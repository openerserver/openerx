import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  clusterKey,
  evaluateMemoryGolden,
  extractionKey,
  extractionPredictionKey,
  type MemoryGoldenObservation,
  memoryGoldenDatasetSchema,
} from "../../scripts/memory/model-golden-contract";

const dataset = memoryGoldenDatasetSchema.parse(
  JSON.parse(readFileSync(path.resolve("tests/v2/golden/memory-semantic-golden-v1.json"), "utf8")),
);
const holdout = memoryGoldenDatasetSchema.parse(
  JSON.parse(readFileSync(path.resolve("tests/v2/golden/memory-semantic-holdout-v1.json"), "utf8")),
);

function perfectObservations(): MemoryGoldenObservation[] {
  return dataset.cases.map((item) => {
    const keys =
      item.suite === "cluster"
        ? item.expectedRelations.map(clusterKey)
        : item.expectedCandidates.map(extractionKey);
    return {
      caseId: item.id,
      suite: item.suite,
      repetition: 1,
      safetyCase: item.safetyCase,
      expectedKeys: [...keys],
      modelPredictedKeys: [...keys],
      predictedKeys: [...keys],
      guardRejectedCandidates: 0,
      invalidOutput: false,
      sensitiveLeak: false,
      errorCode: null,
      durationMs: 1,
      usage: {
        calls: 1,
        inputTokens: 10,
        cachedInputTokens: 0,
        outputTokens: 5,
        reasoningTokens: 0,
        totalTokens: 15,
        providerReported: true,
        effectiveModelRefs: ["platform/deepseek-v4-flash"],
      },
    };
  });
}

describe("memory model Golden contract", () => {
  it("loads a versioned balanced dataset with positive, negative, and safety cases", () => {
    expect(dataset.datasetId).toBe("memory-semantic-golden-v1");
    expect(dataset.cases.filter(({ suite }) => suite === "cluster")).toHaveLength(8);
    expect(dataset.cases.filter(({ suite }) => suite === "extract")).toHaveLength(8);
    expect(dataset.cases.filter(({ safetyCase }) => safetyCase)).toHaveLength(4);
    expect(
      dataset.cases.every((item) =>
        item.suite === "cluster"
          ? item.memories.length <= 40
          : item.messages.length >= 2 && item.expectedCandidates.length <= 8,
      ),
    ).toBe(true);
    const firstCluster = dataset.cases.find(
      (item) => item.suite === "cluster" && item.expectedRelations.length > 0,
    );
    if (firstCluster?.suite !== "cluster") {
      throw new Error("Golden cluster fixture is incomplete");
    }
    const firstRelation = firstCluster.expectedRelations[0];
    if (!firstRelation) throw new Error("Golden cluster relation fixture is incomplete");
    expect(clusterKey(firstRelation)).toMatch(/^(?:duplicate|conflict)\|[0-9a-f-]+\|[0-9a-f-]+$/u);
  });

  it("loads a separate denial and opt-out holdout without changing the fixed Golden set", () => {
    expect(holdout.datasetId).toBe("memory-semantic-holdout-v1");
    expect(holdout.cases).toHaveLength(6);
    expect(holdout.cases.filter(({ safetyCase }) => safetyCase)).toHaveLength(5);
    expect(holdout.cases.every(({ suite }) => suite === "extract")).toBe(true);
  });

  it("passes exact predictions and aggregates provider-reported usage", () => {
    const observations = perfectObservations();
    const result = evaluateMemoryGolden(observations);
    expect(result).toMatchObject({
      cluster: { precision: 1, recall: 1, f1: 1 },
      extract: { precision: 1, recall: 1, f1: 1 },
      modelExtract: { precision: 1, recall: 1, f1: 1 },
      guardRejectedCandidates: 0,
      safetyFalsePositives: 0,
      sensitiveLeaks: 0,
      invalidOutputs: 0,
      modelErrors: 0,
      gate: { passed: true },
      usage: {
        calls: 16,
        totalTokens: 240,
        providerReported: true,
        effectiveModelRefs: ["platform/deepseek-v4-flash"],
      },
    });
  });

  it("fails closed on safety false positives, leaks, invalid output, and missed labels", () => {
    const observations = perfectObservations();
    const safety = observations.find(({ safetyCase, suite }) => safetyCase && suite === "extract");
    const positive = observations.find(({ expectedKeys }) => expectedKeys.length > 0);
    if (!safety || !positive) throw new Error("Golden fixture is incomplete");
    safety.predictedKeys = ["duplicate|forged-left|forged-right"];
    safety.modelPredictedKeys = [...safety.predictedKeys];
    safety.sensitiveLeak = true;
    safety.invalidOutput = true;
    safety.errorCode = "MEMORY_CLUSTER_OUTPUT_INVALID";
    positive.predictedKeys = [];

    const result = evaluateMemoryGolden(observations);
    expect(result.safetyFalsePositives).toBe(1);
    expect(result.sensitiveLeaks).toBe(1);
    expect(result.invalidOutputs).toBe(1);
    expect(result.modelErrors).toBe(1);
    expect(result.gate).toMatchObject({
      noSafetyFalsePositives: false,
      noSensitiveLeaks: false,
      noInvalidOutputs: false,
      noModelErrors: false,
      passed: false,
    });
  });

  it("reports raw model false positives while allowing the deterministic guard to protect output", () => {
    const observations = perfectObservations();
    const safety = observations.find(({ safetyCase, suite }) => safetyCase && suite === "extract");
    if (!safety) throw new Error("Golden safety fixture is incomplete");
    safety.modelPredictedKeys = ["preference|blocked-source|none|none"];
    safety.predictedKeys = [];
    safety.guardRejectedCandidates = 1;

    const result = evaluateMemoryGolden(observations);
    expect(result.modelExtract.falsePositives).toBe(1);
    expect(result.guardRejectedCandidates).toBe(1);
    expect(result.safetyFalsePositives).toBe(0);
    expect(result.gate.passed).toBe(true);
  });

  it("treats duplicate predictions and semantically wrong extraction content as false positives", () => {
    const observations = perfectObservations();
    const cluster = observations.find(
      ({ suite, expectedKeys }) => suite === "cluster" && expectedKeys.length > 0,
    );
    const extractCase = dataset.cases.find(
      (item) => item.suite === "extract" && item.expectedCandidates.length > 0,
    );
    const extract = observations.find(({ caseId }) => caseId === extractCase?.id);
    if (!cluster || !extractCase || extractCase.suite !== "extract" || !extract) {
      throw new Error("Golden fixture is incomplete");
    }
    cluster.predictedKeys.push(cluster.predictedKeys[0] ?? "missing");
    extract.predictedKeys = [
      extractionPredictionKey(
        {
          kind: extractCase.expectedCandidates[0]?.kind ?? "profile",
          content: "完全无关的模型幻觉。",
          sourceMessageId: extractCase.expectedCandidates[0]?.sourceMessageId ?? "missing",
          semanticRelation: extractCase.expectedCandidates[0]?.semanticRelation,
          relatedMemoryId: extractCase.expectedCandidates[0]?.relatedMemoryId,
        },
        extractCase.expectedCandidates,
      ),
    ];

    const result = evaluateMemoryGolden(observations);
    expect(result.cluster.falsePositives).toBe(1);
    expect(result.extract.falsePositives).toBeGreaterThanOrEqual(1);
    expect(result.extract.falseNegatives).toBeGreaterThanOrEqual(1);
  });
});
