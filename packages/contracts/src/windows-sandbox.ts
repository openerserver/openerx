import { z } from "zod";

export const windowsSandboxSetupResultSchema = z
  .object({
    success: z.boolean(),
    reason: z.string().min(1).nullable(),
    details: z.array(z.string().max(200)),
  })
  .strict();

export type WindowsSandboxSetupResult = z.infer<typeof windowsSandboxSetupResultSchema>;

export interface WindowsSandboxSetupBridge {
  startWindowsSandboxSetup(): Promise<WindowsSandboxSetupResult>;
}
