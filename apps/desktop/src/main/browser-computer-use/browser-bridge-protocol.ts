import { Buffer } from "node:buffer";
import {
  browserElementBoundsSchema,
  browserSemanticActionSchema,
  browserSemanticElementStateSchema,
} from "@openerx/contracts";
import { z } from "zod";

export const BROWSER_BRIDGE_PROTOCOL_VERSION = "openerx_browser_bridge_v1" as const;
export const BROWSER_BRIDGE_AUTHORIZATION_TTL_MS = 5 * 60 * 1_000;
export const BROWSER_BRIDGE_MAX_INBOUND_MESSAGE_BYTES = 8 * 1_024 * 1_024;

const opaqueReferenceSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{7,199}$/u);
const sourceNodeIdSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$/u);
const pngDataSchema = z
  .string()
  .min(4)
  .max(11_184_812)
  .regex(/^[A-Za-z0-9+/]+={0,2}$/u)
  .refine((value) => {
    const header = Buffer.from(value, "base64").subarray(0, 8);
    return header.equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  }, "Browser Bridge image must be a PNG");
const httpUrlSchema = z
  .url()
  .max(4_096)
  .refine((value) => ["http:", "https:"].includes(new URL(value).protocol), {
    message: "Browser Bridge URLs must use HTTP or HTTPS",
  });
const httpOriginSchema = z
  .url()
  .max(500)
  .refine((value) => {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && value === url.origin;
  }, "Browser Bridge origins must be canonical HTTP(S) origins");

export const browserBridgeExtensionOriginSchema = z
  .string()
  .regex(/^chrome-extension:\/\/[a-p]{32}\/$/u);

export const browserBridgeNativeSurfaceSchema = z
  .object({
    applicationId: z.string().min(1).max(300),
    nativeProcessId: z.number().int().positive(),
    nativeWindowId: opaqueReferenceSchema,
  })
  .strict();

export const browserBridgeTabBindingSchema = z
  .object({
    browserWindowId: z.number().int().positive(),
    tabId: z.number().int().positive(),
    documentId: opaqueReferenceSchema,
    url: httpUrlSchema,
    origin: httpOriginSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (new URL(value.url).origin !== value.origin) {
      context.addIssue({
        code: "custom",
        path: ["origin"],
        message: "Browser Bridge URL and origin do not match",
      });
    }
  });

export const browserBridgeAuthorizeTabMessageSchema = z
  .object({
    protocolVersion: z.literal(BROWSER_BRIDGE_PROTOCOL_VERSION),
    kind: z.literal("authorize_tab"),
    messageId: opaqueReferenceSchema,
    sequence: z.number().int().positive(),
    binding: browserBridgeTabBindingSchema,
  })
  .strict();

export const browserBridgeSemanticSourceElementSchema = z
  .object({
    sourceNodeId: sourceNodeIdSchema,
    role: z.string().min(1).max(100),
    name: z.string().max(500),
    value: z.string().max(2_000).nullable(),
    sensitiveKind: z.enum(["none", "password", "payment", "authentication"]),
    visible: z.literal(true),
    state: browserSemanticElementStateSchema,
    bounds: browserElementBoundsSchema,
    actions: z.array(browserSemanticActionSchema).max(8),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.sensitiveKind !== "none" && value.value !== null) {
      context.addIssue({
        code: "custom",
        path: ["value"],
        message: "Browser Bridge sensitive values must be omitted",
      });
    }
  });

const bridgeMessageBase = {
  protocolVersion: z.literal(BROWSER_BRIDGE_PROTOCOL_VERSION),
  grantId: opaqueReferenceSchema,
  requestId: opaqueReferenceSchema,
};

export const browserBridgeObserveRequestSchema = z
  .object({
    ...bridgeMessageBase,
    kind: z.literal("observe"),
    expectedBinding: browserBridgeTabBindingSchema,
  })
  .strict();

export const browserBridgeObservationMessageSchema = z
  .object({
    ...bridgeMessageBase,
    kind: z.literal("observation"),
    sequence: z.number().int().positive(),
    binding: browserBridgeTabBindingSchema,
    pageRevision: opaqueReferenceSchema,
    title: z.string().max(2_000),
    viewport: z
      .object({
        width: z.number().int().positive().max(100_000),
        height: z.number().int().positive().max(100_000),
        scaleFactor: z.number().positive().max(16),
      })
      .strict(),
    elements: z.array(browserBridgeSemanticSourceElementSchema).max(2_000),
    image: z
      .object({
        type: z.literal("image"),
        data: pngDataSchema,
        mimeType: z.literal("image/png"),
        captureScope: z.literal("tab"),
        redacted: z.literal(true),
      })
      .strict()
      .optional(),
  })
  .strict();

const bridgeElementCommandBase = { sourceNodeId: sourceNodeIdSchema };
export const browserBridgeActionCommandSchema = z.discriminatedUnion("kind", [
  z.object({ ...bridgeElementCommandBase, kind: z.literal("focus") }).strict(),
  z.object({ ...bridgeElementCommandBase, kind: z.literal("invoke") }).strict(),
  z
    .object({
      ...bridgeElementCommandBase,
      kind: z.literal("set_value"),
      text: z.string().max(100_000),
    })
    .strict(),
  z
    .object({
      ...bridgeElementCommandBase,
      kind: z.literal("select"),
      option: z.string().min(1).max(2_000),
    })
    .strict(),
  z
    .object({
      ...bridgeElementCommandBase,
      kind: z.literal("scroll_element"),
      direction: z.enum(["up", "down", "left", "right"]),
      distance: z.enum(["small", "medium", "viewport", "edge"]),
    })
    .strict(),
  z
    .object({
      ...bridgeElementCommandBase,
      kind: z.literal("type_text"),
      text: z.string().max(100_000),
    })
    .strict(),
  z.object({ kind: z.literal("key"), key: z.string().min(1).max(100) }).strict(),
  z
    .object({
      kind: z.literal("scroll_viewport"),
      direction: z.enum(["up", "down", "left", "right"]),
      distance: z.enum(["small", "medium", "viewport", "edge"]),
    })
    .strict(),
  z.object({ kind: z.enum(["history_back", "history_forward", "reload"]) }).strict(),
]);

export const browserBridgeActionRequestSchema = z
  .object({
    ...bridgeMessageBase,
    kind: z.literal("act"),
    expectedBinding: browserBridgeTabBindingSchema,
    expectedPageRevision: opaqueReferenceSchema,
    command: browserBridgeActionCommandSchema,
  })
  .strict();

export const browserBridgeActionResultMessageSchema = z
  .object({
    ...bridgeMessageBase,
    kind: z.literal("action_result"),
    sequence: z.number().int().positive(),
    binding: browserBridgeTabBindingSchema,
    expectedPageRevision: opaqueReferenceSchema,
    pageRevisionAfter: opaqueReferenceSchema,
    status: z.enum([
      "performed",
      "unsupported",
      "user_takeover_required",
      "stale_observation",
      "navigation_denied",
      "element_not_interactable",
    ]),
  })
  .strict();

export const browserBridgeEventMessageSchema = z
  .object({
    protocolVersion: z.literal(BROWSER_BRIDGE_PROTOCOL_VERSION),
    kind: z.literal("event"),
    grantId: opaqueReferenceSchema,
    sequence: z.number().int().positive(),
    event: z.enum([
      "user_input",
      "same_origin_navigation",
      "tab_deactivated",
      "tab_closed",
      "cross_origin_navigation",
      "authorization_revoked",
      "bridge_disconnected",
    ]),
    binding: browserBridgeTabBindingSchema,
    pageRevision: opaqueReferenceSchema,
  })
  .strict();

export const browserBridgeGrantAcceptedMessageSchema = z
  .object({
    protocolVersion: z.literal(BROWSER_BRIDGE_PROTOCOL_VERSION),
    kind: z.literal("grant_accepted"),
    grantId: opaqueReferenceSchema,
    authorizationMessageId: opaqueReferenceSchema,
    binding: browserBridgeTabBindingSchema,
  })
  .strict();

export const browserBridgeReleaseMessageSchema = z
  .object({
    protocolVersion: z.literal(BROWSER_BRIDGE_PROTOCOL_VERSION),
    kind: z.literal("release"),
    grantId: opaqueReferenceSchema,
  })
  .strict();

export type BrowserBridgeNativeSurface = z.infer<typeof browserBridgeNativeSurfaceSchema>;
export type BrowserBridgeTabBinding = z.infer<typeof browserBridgeTabBindingSchema>;
export type BrowserBridgeAuthorizeTabMessage = z.infer<
  typeof browserBridgeAuthorizeTabMessageSchema
>;
export type BrowserBridgeObserveRequest = z.infer<typeof browserBridgeObserveRequestSchema>;
export type BrowserBridgeObservationMessage = z.infer<typeof browserBridgeObservationMessageSchema>;
export type BrowserBridgeActionCommand = z.infer<typeof browserBridgeActionCommandSchema>;
export type BrowserBridgeActionRequest = z.infer<typeof browserBridgeActionRequestSchema>;
export type BrowserBridgeActionResultMessage = z.infer<
  typeof browserBridgeActionResultMessageSchema
>;
export type BrowserBridgeEventMessage = z.infer<typeof browserBridgeEventMessageSchema>;
export type BrowserBridgeGrantAcceptedMessage = z.infer<
  typeof browserBridgeGrantAcceptedMessageSchema
>;
export type BrowserBridgeReleaseMessage = z.infer<typeof browserBridgeReleaseMessageSchema>;
export type BrowserBridgeRequest = BrowserBridgeObserveRequest | BrowserBridgeActionRequest;
export type BrowserBridgePostMessage =
  | BrowserBridgeGrantAcceptedMessage
  | BrowserBridgeReleaseMessage;

export class BrowserBridgeProtocolError extends Error {
  constructor() {
    super("BROWSER_BRIDGE_PROTOCOL_INVALID");
    this.name = "BrowserBridgeProtocolError";
  }
}

export function parseBrowserBridgeMessage<Schema extends z.ZodType>(
  schema: Schema,
  input: unknown,
): z.infer<Schema> {
  let serialized: string;
  try {
    serialized = JSON.stringify(input);
  } catch {
    throw new BrowserBridgeProtocolError();
  }
  if (
    typeof serialized !== "string" ||
    Buffer.byteLength(serialized, "utf8") > BROWSER_BRIDGE_MAX_INBOUND_MESSAGE_BYTES
  ) {
    throw new BrowserBridgeProtocolError();
  }
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw new BrowserBridgeProtocolError();
  return parsed.data;
}

export function sameBrowserBridgeTab(
  left: BrowserBridgeTabBinding,
  right: BrowserBridgeTabBinding,
): boolean {
  return left.browserWindowId === right.browserWindowId && left.tabId === right.tabId;
}

export function sameBrowserBridgeDocument(
  left: BrowserBridgeTabBinding,
  right: BrowserBridgeTabBinding,
): boolean {
  return (
    sameBrowserBridgeTab(left, right) &&
    left.documentId === right.documentId &&
    left.url === right.url &&
    left.origin === right.origin
  );
}
