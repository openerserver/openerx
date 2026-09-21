import type { DesktopControlOperation } from "@openerx/contracts";
import { z } from "zod";

export const nativeBoundsSchema = z
  .object({
    x: z.number().int(),
    y: z.number().int(),
    width: z.number().int().min(1).max(8192),
    height: z.number().int().min(1).max(8192),
  })
  .strict();
export const nativeTargetSchema = z
  .object({
    applicationId: z.string().min(1).max(2048),
    application: z.string().min(1).max(300),
    executablePath: z.string().min(1).max(2048),
    processStartTime: z.string().regex(/^\d{1,20}$/u),
    processId: z.number().int().positive(),
    windowId: z.string().regex(/^[1-9]\d{0,19}$/u),
    title: z.string().max(512),
    bounds: nativeBoundsSchema,
    dpi: z.number().int().min(48).max(768),
  })
  .strict();
export const nativeElementSchema = z
  .object({
    runtimeId: z.string().min(1).max(500),
    role: z.string().max(100),
    name: z.string().max(200),
    value: z.string().max(2000).nullable(),
    bounds: nativeBoundsSchema,
    enabled: z.boolean(),
    focused: z.boolean(),
    sensitive: z.boolean(),
    actions: z.array(z.enum(["invoke", "set_value", "type_text"])).max(3),
  })
  .strict()
  .refine((e) => !e.sensitive || (e.value === null && e.actions.length === 0));
export const nativeObservationSchema = z
  .object({
    target: nativeTargetSchema,
    elements: z.array(nativeElementSchema).max(512),
    revision: z.string().regex(/^[A-Fa-f0-9]{64}$/u),
    truncated: z.boolean(),
    pngBase64: z
      .string()
      .max(16 * 1024 * 1024)
      .nullable(),
    imageWidth: z.number().int().min(0).max(1600),
    imageHeight: z.number().int().min(0).max(1600),
  })
  .strict();
export type NativeTarget = z.infer<typeof nativeTargetSchema>;
export type NativeObservation = z.infer<typeof nativeObservationSchema>;
export type NativeElement = z.infer<typeof nativeElementSchema>;
export type DesktopObservedAction = Extract<DesktopControlOperation, { observationId: string }>;
export interface DesktopNativeDriver {
  probe(signal: AbortSignal): Promise<void>;
  list(signal: AbortSignal): Promise<NativeTarget[]>;
  open(applicationId: string, signal: AbortSignal): Promise<void>;
  focus(target: NativeTarget, signal: AbortSignal): Promise<void>;
  observe(target: NativeTarget, signal: AbortSignal): Promise<NativeObservation>;
  act(
    target: NativeTarget,
    observation: NativeObservation,
    action: DesktopObservedAction,
    element: NativeElement | undefined,
    signal: AbortSignal,
  ): Promise<void>;
  monitor(onInput: () => void, onLost: () => void, signal: AbortSignal): Promise<{ close(): void }>;
  cancelInteractions?(): void;
  close(): void;
}

export function assertTargetIdentity(expected: NativeTarget, actual: NativeTarget): void {
  if (
    expected.applicationId !== actual.applicationId ||
    expected.processId !== actual.processId ||
    expected.windowId !== actual.windowId ||
    expected.processStartTime !== actual.processStartTime ||
    expected.executablePath.toLowerCase() !== actual.executablePath.toLowerCase()
  )
    throw new Error("DESKTOP_TARGET_IDENTITY_MISMATCH");
}
