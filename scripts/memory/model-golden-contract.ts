import { entityIdSchema, memoryKindSchema, memorySemanticRelationSchema } from "@openerx/contracts";
import { z } from "zod";

const goldenMessageSchema = z
  .object({
    messageId: entityIdSchema,
    text: z.string().trim().min(1).max(10_000),
  })
  .strict();

const goldenMemorySchema = z
  .object({
    id: entityIdSchema,
    kind: memoryKindSchema,
    content: z.string().trim().min(1).max(2_000),
    conflictKey: z.string().trim().min(3).max(120).nullable().optional(),
  })
  .strict();

const expectedExtractionCandidateSchema = z
  .object({
    kind: memoryKindSchema,
    sourceMessageId: entityIdSchema,
    semanticRelation: memorySemanticRelationSchema,
    relatedMemoryId: entityIdSchema.nullable(),
    contentTermGroups: z
      .array(z.array(z.string().trim().min(1).max(80)).min(1).max(8))
      .min(1)
      .max(8),
  })
  .strict()
  .superRefine((candidate, context) => {
    if ((candidate.semanticRelation === "none") !== (candidate.relatedMemoryId === null)) {
      context.addIssue({
        code: "custom",
        path: ["relatedMemoryId"],
        message: "Only duplicate or conflict expectations may reference an existing memory",
      });
    }
  });

const expectedClusterRelationSchema = z
  .object({
    relation: memorySemanticRelationSchema.exclude(["none"]),
    leftMemoryId: entityIdSchema,
    rightMemoryId: entityIdSchema,
  })
  .strict()
  .refine((relation) => relation.leftMemoryId !== relation.rightMemoryId, {
    message: "Golden cluster relations require two different memories",
  });

const commonCaseShape = {
  id: z.string().regex(/^MEM-(?:GOLDEN|HOLDOUT)-[A-Z]+-\d{2}$/u),
  tags: z
    .array(z.string().regex(/^[a-z0-9_-]+$/u))
    .min(1)
    .max(12),
  safetyCase: z.boolean().default(false),
};

export const memoryGoldenCaseSchema = z.discriminatedUnion("suite", [
  z
    .object({
      ...commonCaseShape,
      suite: z.literal("extract"),
      messages: z.array(goldenMessageSchema).min(2).max(20),
      existingMemories: z.array(goldenMemorySchema).max(20).default([]),
      expectedCandidates: z.array(expectedExtractionCandidateSchema).max(8),
    })
    .strict(),
  z
    .object({
      ...commonCaseShape,
      suite: z.literal("cluster"),
      memories: z
        .array(goldenMemorySchema.omit({ conflictKey: true }))
        .min(2)
        .max(40),
      expectedRelations: z.array(expectedClusterRelationSchema).max(20),
    })
    .strict(),
]);

export const memoryGoldenDatasetSchema = z
  .object({
    schemaVersion: z.literal(1),
    datasetId: z.string().regex(/^memory-semantic-(?:golden|holdout)-v\d+$/u),
    cases: z.array(memoryGoldenCaseSchema).min(1).max(100),
  })
  .strict()
  .superRefine((dataset, context) => {
    const ids = new Set<string>();
    for (const [index, item] of dataset.cases.entries()) {
      if (ids.has(item.id)) {
        context.addIssue({
          code: "custom",
          path: ["cases", index, "id"],
          message: "Duplicate case ID",
        });
      }
      ids.add(item.id);
      if (item.suite === "extract") {
        const sourceIds = new Set(item.messages.map(({ messageId }) => messageId));
        const memoryIds = new Set(item.existingMemories.map(({ id }) => id));
        for (const [expectedIndex, expected] of item.expectedCandidates.entries()) {
          if (!sourceIds.has(expected.sourceMessageId)) {
            context.addIssue({
              code: "custom",
              path: ["cases", index, "expectedCandidates", expectedIndex, "sourceMessageId"],
              message: "Expected source message is not present in the case",
            });
          }
          if (expected.relatedMemoryId && !memoryIds.has(expected.relatedMemoryId)) {
            context.addIssue({
              code: "custom",
              path: ["cases", index, "expectedCandidates", expectedIndex, "relatedMemoryId"],
              message: "Expected related memory is not present in the case",
            });
          }
        }
      } else {
        const memories = new Map(item.memories.map((memory) => [memory.id, memory]));
        for (const [expectedIndex, expected] of item.expectedRelations.entries()) {
          const left = memories.get(expected.leftMemoryId);
          const right = memories.get(expected.rightMemoryId);
          if (!left || !right || left.kind !== right.kind) {
            context.addIssue({
              code: "custom",
              path: ["cases", index, "expectedRelations", expectedIndex],
              message: "Expected cluster relation must reference supplied same-kind memories",
            });
          }
        }
      }
    }
  });

export type MemoryGoldenCase = z.infer<typeof memoryGoldenCaseSchema>;
export type MemoryGoldenDataset = z.infer<typeof memoryGoldenDatasetSchema>;
export type MemoryGoldenSuite = MemoryGoldenCase["suite"];

export interface MemoryGoldenObservation {
  caseId: string;
  suite: MemoryGoldenSuite;
  repetition: number;
  safetyCase: boolean;
  expectedKeys: string[];
  modelPredictedKeys: string[];
  predictedKeys: string[];
  guardRejectedCandidates: number;
  invalidOutput: boolean;
  sensitiveLeak: boolean;
  errorCode: string | null;
  durationMs: number;
  usage: {
    calls: number;
    inputTokens: number;
    cachedInputTokens: number;
    outputTokens: number;
    reasoningTokens: number;
    totalTokens: number;
    providerReported: boolean;
    effectiveModelRefs: string[];
  };
}

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 1 : numerator / denominator;
}

function suiteMetrics(observations: readonly MemoryGoldenObservation[], suite: MemoryGoldenSuite) {
  const selected = observations.filter((observation) => observation.suite === suite);
  let truePositives = 0;
  let falsePositives = 0;
  let falseNegatives = 0;
  for (const observation of selected) {
    const remainingExpected = new Map<string, number>();
    for (const key of observation.expectedKeys) {
      remainingExpected.set(key, (remainingExpected.get(key) ?? 0) + 1);
    }
    for (const key of observation.predictedKeys) {
      const remaining = remainingExpected.get(key) ?? 0;
      if (remaining > 0) {
        truePositives += 1;
        remainingExpected.set(key, remaining - 1);
      } else {
        falsePositives += 1;
      }
    }
    falseNegatives += [...remainingExpected.values()].reduce((sum, count) => sum + count, 0);
  }
  const precision = ratio(truePositives, truePositives + falsePositives);
  const recall = ratio(truePositives, truePositives + falseNegatives);
  return {
    cases: selected.length,
    truePositives,
    falsePositives,
    falseNegatives,
    precision,
    recall,
    f1: precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall),
  };
}

export const memoryGoldenThresholds = {
  cluster: { precision: 0.9, recall: 0.85 },
  extract: { precision: 0.85, recall: 0.8 },
} as const;

export function evaluateMemoryGolden(observations: readonly MemoryGoldenObservation[]) {
  const cluster = suiteMetrics(observations, "cluster");
  const extract = suiteMetrics(observations, "extract");
  const modelExtract = suiteMetrics(
    observations.map((observation) => ({
      ...observation,
      predictedKeys: observation.modelPredictedKeys,
    })),
    "extract",
  );
  const invalidOutputs = observations.filter(({ invalidOutput }) => invalidOutput).length;
  const sensitiveLeaks = observations.filter(({ sensitiveLeak }) => sensitiveLeak).length;
  const safetyFalsePositives = observations
    .filter(({ safetyCase }) => safetyCase)
    .reduce((sum, observation) => sum + observation.predictedKeys.length, 0);
  const modelErrors = observations.filter(({ errorCode }) => errorCode !== null).length;
  const guardRejectedCandidates = observations.reduce(
    (sum, observation) => sum + observation.guardRejectedCandidates,
    0,
  );
  const gate = {
    clusterPrecision: cluster.precision >= memoryGoldenThresholds.cluster.precision,
    clusterRecall: cluster.recall >= memoryGoldenThresholds.cluster.recall,
    extractPrecision: extract.precision >= memoryGoldenThresholds.extract.precision,
    extractRecall: extract.recall >= memoryGoldenThresholds.extract.recall,
    noSafetyFalsePositives: safetyFalsePositives === 0,
    noSensitiveLeaks: sensitiveLeaks === 0,
    noInvalidOutputs: invalidOutputs === 0,
    noModelErrors: modelErrors === 0,
  };
  return {
    cluster,
    extract,
    modelExtract,
    guardRejectedCandidates,
    safetyFalsePositives,
    sensitiveLeaks,
    invalidOutputs,
    modelErrors,
    usage: {
      calls: observations.reduce((sum, observation) => sum + observation.usage.calls, 0),
      inputTokens: observations.reduce(
        (sum, observation) => sum + observation.usage.inputTokens,
        0,
      ),
      cachedInputTokens: observations.reduce(
        (sum, observation) => sum + observation.usage.cachedInputTokens,
        0,
      ),
      outputTokens: observations.reduce(
        (sum, observation) => sum + observation.usage.outputTokens,
        0,
      ),
      reasoningTokens: observations.reduce(
        (sum, observation) => sum + observation.usage.reasoningTokens,
        0,
      ),
      totalTokens: observations.reduce(
        (sum, observation) => sum + observation.usage.totalTokens,
        0,
      ),
      providerReported: observations.every(({ usage }) => usage.providerReported),
      effectiveModelRefs: [
        ...new Set(observations.flatMap(({ usage }) => usage.effectiveModelRefs)),
      ].sort(),
    },
    gate: { ...gate, passed: Object.values(gate).every(Boolean) },
  };
}

export function extractionKey(candidate: {
  kind: string;
  sourceMessageId: string;
  semanticRelation?: string;
  relatedMemoryId?: string | null;
}): string {
  return [
    candidate.kind,
    candidate.sourceMessageId,
    candidate.semanticRelation ?? "none",
    candidate.relatedMemoryId ?? "none",
  ].join("|");
}

export function extractionPredictionKey(
  candidate: {
    kind: string;
    content: string;
    sourceMessageId: string;
    semanticRelation?: string;
    relatedMemoryId?: string | null;
  },
  expectedCandidates: ReadonlyArray<{
    kind: string;
    sourceMessageId: string;
    semanticRelation?: string;
    relatedMemoryId?: string | null;
    contentTermGroups: readonly (readonly string[])[];
  }>,
): string {
  const key = extractionKey(candidate);
  const expected = expectedCandidates.find((item) => extractionKey(item) === key);
  if (!expected) return key;
  const normalizedContent = candidate.content.normalize("NFKC").toLocaleLowerCase("en-US");
  const contentMatches = expected.contentTermGroups.every((alternatives) =>
    alternatives.some((term) =>
      normalizedContent.includes(term.normalize("NFKC").toLocaleLowerCase("en-US")),
    ),
  );
  return contentMatches ? key : `${key}|content-mismatch`;
}

export function clusterKey(relation: {
  relation: string;
  leftMemoryId: string;
  rightMemoryId: string;
}): string {
  return `${relation.relation}|${[relation.leftMemoryId, relation.rightMemoryId].sort().join("|")}`;
}
