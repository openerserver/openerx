import { z } from "zod";
import { timestampSchema } from "./common";

export const piRuntimeSettingsSchema = z
  .object({
    ownerProfileId: z.string().min(1),
    nativeToolsEnabled: z.boolean(),
    updatedAt: timestampSchema.nullable(),
  })
  .strict();

export const piRuntimeSettingsUpdateInputSchema = z
  .object({ nativeToolsEnabled: z.boolean() })
  .strict();

export type PiRuntimeSettings = z.infer<typeof piRuntimeSettingsSchema>;
export type PiRuntimeSettingsUpdateInput = z.infer<typeof piRuntimeSettingsUpdateInputSchema>;

export interface PiRuntimeBridge {
  getPiRuntimeSettings(): Promise<PiRuntimeSettings>;
  updatePiRuntimeSettings(input: PiRuntimeSettingsUpdateInput): Promise<PiRuntimeSettings>;
}
