import { z } from "zod";
import { timestampSchema } from "./common";

export const diagnosticLevelSchema = z.enum(["info", "warning", "error"]);

export const performanceMetricSchema = z
  .object({
    name: z.enum(["desktop_interactive", "app_service_ready", "idle_rss"]),
    value: z.number().nonnegative(),
    unit: z.enum(["ms", "mib"]),
    budget: z.number().positive(),
    status: z.enum(["pass", "over_budget", "pending"]),
  })
  .strict();

export const diagnosticsPreviewSchema = z
  .object({
    generatedAt: timestampSchema,
    health: z.enum(["ready", "attention", "collecting"]),
    eventCount: z.number().int().nonnegative(),
    errorCount: z.number().int().nonnegative(),
    warningCount: z.number().int().nonnegative(),
    restartCount: z.number().int().nonnegative(),
    firstEventAt: timestampSchema.nullable(),
    lastEventAt: timestampSchema.nullable(),
    sources: z.array(z.string().min(1)),
    performance: z.array(performanceMetricSchema),
    includes: z.array(z.string().min(1)),
    excludes: z.array(z.string().min(1)),
  })
  .strict();

export const personalDataSummarySchema = z
  .object({
    generatedAt: timestampSchema,
    conversations: z.number().int().nonnegative(),
    messages: z.number().int().nonnegative(),
    files: z.number().int().nonnegative(),
    artifacts: z.number().int().nonnegative(),
    workItems: z.number().int().nonnegative(),
    skillInstallations: z.number().int().nonnegative(),
    memories: z.number().int().nonnegative(),
  })
  .strict();

export const localExportResultSchema = z
  .object({
    kind: z.enum(["diagnostics", "personal_data"]),
    fileName: z.string().min(1),
    bytes: z.number().int().nonnegative(),
    checksumSha256: z.string().regex(/^[a-f0-9]{64}$/),
    exportedAt: timestampSchema,
  })
  .strict();

export type PerformanceMetric = z.infer<typeof performanceMetricSchema>;
export type DiagnosticsPreview = z.infer<typeof diagnosticsPreviewSchema>;
export type PersonalDataSummary = z.infer<typeof personalDataSummarySchema>;
export type LocalExportResult = z.infer<typeof localExportResultSchema>;

export interface DiagnosticsBridge {
  getDiagnosticsPreview(): Promise<DiagnosticsPreview>;
  exportDiagnostics(): Promise<LocalExportResult | null>;
  getPersonalDataSummary(): Promise<PersonalDataSummary>;
  exportPersonalData(): Promise<LocalExportResult | null>;
}
