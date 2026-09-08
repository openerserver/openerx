import { z } from "zod";

export const DESKTOP_CONTROL_VERSION = "desktop_control_v2" as const;
export const DESKTOP_CONTROL_FEATURE_FLAG = "OPENERX_WINDOWS_DESKTOP_CONTROL";
export function windowsDesktopControlEnabled(value: string | undefined): boolean {
  return value === "1";
}

// Execution ownership is supplied by App Service, never by model tool parameters.
export const desktopExecutionContextSchema = z
  .object({
    conversationId: z.uuid(),
    generationId: z.uuid(),
  })
  .strict();
export type DesktopExecutionContext = z.infer<typeof desktopExecutionContextSchema>;

const base = { contractVersion: z.literal(DESKTOP_CONTROL_VERSION) };
const application = { applicationId: z.string().min(1).max(2048) };
const session = { ...base, ...application, sessionId: z.uuid() };
const observed = { ...session, observationId: z.uuid() };
const effect = { effect: z.enum(["local", "submit", "send", "delete", "purchase"]) };
const point = { x: z.number().int().nonnegative(), y: z.number().int().nonnegative() };

export const desktopControlOperationSchema = z.discriminatedUnion("action", [
  z.object({ ...base, action: z.literal("list_apps") }).strict(),
  z.object({ ...base, ...application, action: z.literal("open_app"), appRef: z.uuid() }).strict(),
  z.object({ ...base, ...application, action: z.literal("attach"), windowRef: z.uuid() }).strict(),
  z.object({ ...session, action: z.literal("observe") }).strict(),
  z.object({ ...session, action: z.literal("detach") }).strict(),
  z.object({ ...observed, ...effect, action: z.literal("invoke"), elementRef: z.uuid() }).strict(),
  z
    .object({
      ...observed,
      ...effect,
      action: z.literal("set_value"),
      elementRef: z.uuid(),
      text: z.string().max(10000),
    })
    .strict(),
  z
    .object({
      ...observed,
      ...effect,
      action: z.literal("type_text"),
      elementRef: z.uuid(),
      text: z.string().min(1).max(10000),
    })
    .strict(),
  z
    .object({ ...observed, ...effect, action: z.literal("key"), key: z.string().min(1).max(80) })
    .strict(),
  z
    .object({
      ...observed,
      ...effect,
      ...point,
      action: z.literal("click"),
      button: z.enum(["left", "right"]),
      count: z.number().int().min(1).max(2),
    })
    .strict(),
  z
    .object({
      ...observed,
      ...point,
      action: z.literal("scroll"),
      delta: z
        .number()
        .int()
        .min(-1200)
        .max(1200)
        .refine((n) => n !== 0),
      horizontal: z.boolean(),
    })
    .strict(),
]);
export type DesktopControlOperation = z.infer<typeof desktopControlOperationSchema>;

export const desktopControlSessionSchema = z
  .object({
    sessionId: z.uuid(),
    conversationId: z.uuid(),
    applicationId: z.string(),
    application: z.string(),
    windowTitle: z.string(),
    state: z.enum(["ready", "controlling", "paused", "stopped"]),
    reason: z.string().nullable(),
  })
  .strict();
export type DesktopControlSession = z.infer<typeof desktopControlSessionSchema>;
export const desktopControlCommandSchema = z
  .object({
    sessionId: z.uuid(),
    action: z.enum(["pause", "resume", "stop"]),
  })
  .strict();
export type DesktopControlCommand = z.infer<typeof desktopControlCommandSchema>;
