import { z } from "zod";
import { entityIdSchema, timestampSchema } from "./common";

export const BROWSER_COMPUTER_USE_CONTRACT_VERSION = "browser_computer_use_v2" as const;
export const LEGACY_BROWSER_CONTRACT_VERSION = "legacy_dom_v1" as const;
export const BROWSER_COMPUTER_USE_V2_FEATURE_FLAG = "OPENERX_BROWSER_COMPUTER_USE_V2" as const;
export const BROWSER_OBSERVATION_MAX_TTL_MS = 30_000;

export function browserComputerUseV2Enabled(value: string | undefined): boolean {
  return value !== "0" && value?.toLocaleLowerCase() !== "false";
}

export const browserComputerUseContractVersionSchema = z.literal(
  BROWSER_COMPUTER_USE_CONTRACT_VERSION,
);
export const legacyBrowserContractVersionSchema = z.literal(LEGACY_BROWSER_CONTRACT_VERSION);
export const browserBackendSchema = z.enum(["system_default", "managed_chromium"]);
export const browserControlPathSchema = z.enum([
  "connected_browser_bridge",
  "os_accessibility",
  "managed_chromium_semantic",
]);
export const browserActionPathSchema = z.enum(["semantic", "native_input", "visual_coordinate"]);
export const browserSurfaceKindSchema = z.enum(["tab", "window"]);
export const browserSurfaceOwnershipSchema = z.enum([
  "external_user",
  "external_openerx",
  "openerx_managed",
]);
export const browserProfilePersistenceSchema = z.enum([
  "browser_owned",
  "ephemeral",
  "managed_persistent",
]);
export const browserSessionStateSchema = z.enum([
  "opening",
  "active",
  "paused_for_user",
  "detached",
  "closing",
  "closed",
  "failed",
]);
export const browserImageReasonSchema = z.enum([
  "baseline",
  "layout_change",
  "uncertain",
  "coordinate",
  "risk",
  "final",
]);
export const browserComputerUseErrorCodeSchema = z.enum([
  "BROWSER_ACTION_NOT_SUPPORTED",
  "BROWSER_BACKEND_DOWNGRADE_REJECTED",
  "BROWSER_BACKEND_UNAVAILABLE",
  "BROWSER_BRIDGE_AUTHORIZATION_REQUIRED",
  "BROWSER_BRIDGE_DISCONNECTED",
  "BROWSER_CANCELLED",
  "BROWSER_COORDINATE_OUT_OF_BOUNDS",
  "BROWSER_ELEMENT_NOT_FOUND",
  "BROWSER_ELEMENT_NOT_INTERACTABLE",
  "BROWSER_NAVIGATION_DENIED",
  "BROWSER_OBSERVATION_EXPIRED",
  "BROWSER_OBSERVATION_MISMATCH",
  "BROWSER_OBSERVATION_REQUIRED",
  "BROWSER_SCOPE_DENIED",
  "BROWSER_SESSION_NOT_FOUND",
  "BROWSER_SURFACE_MISMATCH",
  "BROWSER_SURFACE_NOT_BOUND",
  "BROWSER_USER_TAKEOVER_REQUIRED",
]);

const browserHttpUrlSchema = z
  .url()
  .max(4_096)
  .refine((value) => ["http:", "https:"].includes(new URL(value).protocol), {
    message: "Browser URL must use HTTP or HTTPS",
  });
const browserOpaqueReferenceSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{7,199}$/u);
const browserElementRefSchema = z.string().regex(/^el_[A-Za-z0-9_-]{16,160}$/u);
const browserCoordinateSchema = z.number().int().min(0).max(100_000);
const sha256DigestSchema = z.string().regex(/^[a-f0-9]{64}$/u);

export const browserSemanticTargetSchema = z
  .object({ elementRef: browserElementRefSchema })
  .strict();
export const browserCoordinateTargetSchema = z
  .object({
    x: browserCoordinateSchema,
    y: browserCoordinateSchema,
    visualObservationId: entityIdSchema,
  })
  .strict();
export const browserTargetSchema = z.union([
  browserSemanticTargetSchema,
  browserCoordinateTargetSchema,
]);

const operationBase = {
  contractVersion: browserComputerUseContractVersionSchema,
};
const observedOperationBase = {
  ...operationBase,
  sessionId: entityIdSchema,
  observationId: entityIdSchema,
};

export const browserComputerUseOperationV2Schema = z.discriminatedUnion("action", [
  z
    .object({
      ...operationBase,
      action: z.literal("open"),
      url: browserHttpUrlSchema,
      requestedBackend: browserBackendSchema.optional(),
      browserContextRef: browserOpaqueReferenceSchema.optional(),
    })
    .strict(),
  z
    .object({
      ...operationBase,
      action: z.literal("observe"),
      sessionId: entityIdSchema,
    })
    .strict(),
  z
    .object({
      ...observedOperationBase,
      action: z.enum(["focus", "invoke", "click", "submit"]),
      target: browserTargetSchema,
    })
    .strict(),
  z
    .object({
      ...observedOperationBase,
      action: z.literal("setValue"),
      target: browserSemanticTargetSchema,
      text: z.string().max(100_000),
    })
    .strict(),
  z
    .object({
      ...observedOperationBase,
      action: z.literal("type"),
      target: browserTargetSchema.optional(),
      text: z.string().max(100_000),
    })
    .strict(),
  z
    .object({
      ...observedOperationBase,
      action: z.literal("select"),
      target: browserSemanticTargetSchema,
      option: z.string().min(1).max(2_000),
    })
    .strict(),
  z
    .object({
      ...observedOperationBase,
      action: z.literal("key"),
      key: z.string().min(1).max(100),
    })
    .strict(),
  z
    .object({
      ...observedOperationBase,
      action: z.literal("scroll"),
      target: browserTargetSchema.optional(),
      direction: z.enum(["up", "down", "left", "right"]),
      distance: z.enum(["small", "medium", "viewport", "edge"]),
    })
    .strict(),
  z
    .object({
      ...observedOperationBase,
      action: z.literal("drag"),
      from: browserTargetSchema,
      to: browserCoordinateTargetSchema,
    })
    .strict(),
  z
    .object({
      ...observedOperationBase,
      action: z.enum(["back", "forward", "reload"]),
    })
    .strict(),
  z
    .object({
      ...observedOperationBase,
      action: z.literal("upload"),
      target: browserSemanticTargetSchema,
      fileId: entityIdSchema,
    })
    .strict(),
  z
    .object({
      ...observedOperationBase,
      action: z.literal("download"),
      target: browserTargetSchema,
    })
    .strict(),
  z
    .object({
      ...operationBase,
      action: z.literal("detach"),
      sessionId: entityIdSchema,
    })
    .strict(),
  z
    .object({
      ...observedOperationBase,
      action: z.literal("close"),
    })
    .strict(),
]);

export const browserBackendSelectionSchema = z
  .object({
    requestedBackend: browserBackendSchema.optional(),
    securityMinimum: browserBackendSchema,
    effectiveBackend: browserBackendSchema,
    selectedBy: z.enum(["user_setting", "request_upgrade", "policy"]),
  })
  .strict()
  .superRefine((value, context) => {
    const downgrade =
      (value.securityMinimum === "managed_chromium" &&
        value.effectiveBackend !== "managed_chromium") ||
      (value.requestedBackend === "managed_chromium" &&
        value.effectiveBackend !== "managed_chromium");
    if (downgrade) {
      context.addIssue({
        code: "custom",
        path: ["effectiveBackend"],
        message: "BROWSER_BACKEND_DOWNGRADE_REJECTED",
      });
    }
  });

export const browserSessionCapabilitiesSchema = z
  .object({
    semanticObserve: z.boolean(),
    semanticAction: z.boolean(),
    visualCapture: z.boolean(),
    coordinateFallback: z.boolean(),
    controlledUpload: z.boolean(),
    controlledDownload: z.boolean(),
    clearProfileData: z.boolean(),
    closeOwnedWindow: z.boolean(),
  })
  .strict();

const browserSessionDescriptorShape = {
  contractVersion: browserComputerUseContractVersionSchema,
  sessionId: entityIdSchema,
  backend: browserBackendSchema,
  controlPath: browserControlPathSchema,
  applicationId: z.string().min(1).max(300),
  nativeProcessId: z.number().int().positive(),
  nativeWindowId: browserOpaqueReferenceSchema,
  surfaceKind: browserSurfaceKindSchema,
  surfaceId: browserOpaqueReferenceSchema,
  ownership: browserSurfaceOwnershipSchema,
  profilePersistence: browserProfilePersistenceSchema,
  state: browserSessionStateSchema,
  capabilities: browserSessionCapabilitiesSchema,
};

type BrowserSessionDescriptorShape = z.infer<z.ZodObject<typeof browserSessionDescriptorShape>>;

function validateBrowserSessionDescriptor(
  value: BrowserSessionDescriptorShape,
  context: z.RefinementCtx,
) {
  if (value.backend === "system_default") {
    if (value.controlPath === "managed_chromium_semantic") {
      context.addIssue({
        code: "custom",
        path: ["controlPath"],
        message: "System browser cannot use the managed Chromium control path",
      });
    }
    if (value.profilePersistence !== "browser_owned") {
      context.addIssue({
        code: "custom",
        path: ["profilePersistence"],
        message: "System browser profile remains browser-owned",
      });
    }
    if (value.ownership === "openerx_managed") {
      context.addIssue({
        code: "custom",
        path: ["ownership"],
        message: "System browser surfaces are not OpenERX-managed profiles",
      });
    }
  } else {
    if (["connected_browser_bridge", "os_accessibility"].includes(value.controlPath)) {
      context.addIssue({
        code: "custom",
        path: ["controlPath"],
        message: "Managed Chromium cannot use an external-browser control path",
      });
    }
    if (value.profilePersistence === "browser_owned") {
      context.addIssue({
        code: "custom",
        path: ["profilePersistence"],
        message: "Managed Chromium profile must be isolated",
      });
    }
    if (value.ownership !== "openerx_managed") {
      context.addIssue({
        code: "custom",
        path: ["ownership"],
        message: "Managed Chromium surface must be OpenERX-owned",
      });
    }
  }
  if (value.controlPath === "connected_browser_bridge" && value.surfaceKind !== "tab") {
    context.addIssue({
      code: "custom",
      path: ["surfaceKind"],
      message: "Browser Bridge must bind an exact tab",
    });
  }
  if (value.controlPath === "os_accessibility" && value.surfaceKind !== "window") {
    context.addIssue({
      code: "custom",
      path: ["surfaceKind"],
      message: "OS Accessibility must bind a dedicated window",
    });
  }
}

export const browserSessionDescriptorSchema = z
  .object(browserSessionDescriptorShape)
  .strict()
  .superRefine(validateBrowserSessionDescriptor);

export const browserComputerUseSessionControlInputSchema = z
  .object({ sessionId: entityIdSchema })
  .strict();

export const browserSemanticActionSchema = z.enum([
  "focus",
  "setValue",
  "invoke",
  "select",
  "scroll",
]);
export const browserSemanticElementStateSchema = z
  .object({
    disabled: z.boolean(),
    checked: z.boolean().nullable(),
    selected: z.boolean().nullable(),
    expanded: z.boolean().nullable(),
    focused: z.boolean(),
    editable: z.boolean(),
  })
  .strict();
export const browserElementBoundsSchema = z
  .object({
    x: browserCoordinateSchema,
    y: browserCoordinateSchema,
    width: z.number().int().positive().max(100_000),
    height: z.number().int().positive().max(100_000),
  })
  .strict();
export const browserSemanticElementSchema = z
  .object({
    elementRef: browserElementRefSchema,
    role: z.string().min(1).max(100),
    name: z.string().max(500),
    value: z.string().max(2_000).nullable(),
    valueRedacted: z.boolean(),
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
        message: "Sensitive element values must be redacted",
      });
    }
    if (value.sensitiveKind !== "none" && !value.valueRedacted) {
      context.addIssue({
        code: "custom",
        path: ["valueRedacted"],
        message: "Sensitive elements must declare redaction",
      });
    }
  });

export const browserSemanticDiffSchema = z
  .object({
    added: z.array(browserSemanticElementSchema).max(2_000),
    changed: z.array(browserSemanticElementSchema).max(2_000),
    removed: z.array(browserElementRefSchema).max(2_000),
  })
  .strict();
export const browserPngImageSchema = z
  .object({
    type: z.literal("image"),
    data: z.string().min(4).max(44_739_244),
    mimeType: z.literal("image/png"),
  })
  .strict();

export const browserObservationSchema = z
  .object({
    ...browserSessionDescriptorShape,
    observationId: entityIdSchema,
    previousObservationId: entityIdSchema.nullable(),
    semanticSnapshotId: entityIdSchema,
    visualObservationId: entityIdSchema.nullable(),
    actionPath: browserActionPathSchema.nullable(),
    url: browserHttpUrlSchema,
    title: z.string().max(2_000),
    viewport: z
      .object({
        width: z.number().int().positive().max(100_000),
        height: z.number().int().positive().max(100_000),
        scaleFactor: z.number().positive().max(16),
      })
      .strict(),
    elements: z.array(browserSemanticElementSchema).max(2_000),
    semanticDiff: browserSemanticDiffSchema.optional(),
    image: browserPngImageSchema.optional(),
    imageReason: browserImageReasonSchema.optional(),
    screenshotDigest: sha256DigestSchema,
    capturedAt: timestampSchema,
    expiresAt: timestampSchema,
  })
  .strict()
  .superRefine((value, context) => {
    validateBrowserSessionDescriptor(value, context);
    const capturedAt = Date.parse(value.capturedAt);
    const expiresAt = Date.parse(value.expiresAt);
    if (expiresAt <= capturedAt || expiresAt - capturedAt > BROWSER_OBSERVATION_MAX_TTL_MS) {
      context.addIssue({
        code: "custom",
        path: ["expiresAt"],
        message: `Observation TTL must be between 1 and ${BROWSER_OBSERVATION_MAX_TTL_MS} ms`,
      });
    }
    if (
      Boolean(value.image) !== Boolean(value.imageReason) ||
      Boolean(value.image) !== Boolean(value.visualObservationId)
    ) {
      context.addIssue({
        code: "custom",
        path: [value.image ? "imageReason" : "image"],
        message: "Image, imageReason and visualObservationId must be present together",
      });
    }
    if (value.actionPath === "visual_coordinate" && !value.image) {
      context.addIssue({
        code: "custom",
        path: ["image"],
        message: "Visual coordinate fallback requires a current image",
      });
    }
    const refs = value.elements.map((element) => element.elementRef);
    if (new Set(refs).size !== refs.length) {
      context.addIssue({
        code: "custom",
        path: ["elements"],
        message: "Semantic element references must be unique",
      });
    }
  });

export type BrowserBackend = z.infer<typeof browserBackendSchema>;
export type BrowserControlPath = z.infer<typeof browserControlPathSchema>;
export type BrowserActionPath = z.infer<typeof browserActionPathSchema>;
export type BrowserTarget = z.infer<typeof browserTargetSchema>;
export type BrowserSemanticAction = z.infer<typeof browserSemanticActionSchema>;
export type BrowserImageReason = z.infer<typeof browserImageReasonSchema>;
export type BrowserSurfaceKind = z.infer<typeof browserSurfaceKindSchema>;
export type BrowserSurfaceOwnership = z.infer<typeof browserSurfaceOwnershipSchema>;
export type BrowserProfilePersistence = z.infer<typeof browserProfilePersistenceSchema>;
export type BrowserComputerUseOperationV2 = z.infer<typeof browserComputerUseOperationV2Schema>;
export type BrowserBackendSelection = z.infer<typeof browserBackendSelectionSchema>;
export type BrowserSessionDescriptor = z.infer<typeof browserSessionDescriptorSchema>;
export type BrowserComputerUseSessionControlInput = z.infer<
  typeof browserComputerUseSessionControlInputSchema
>;
export type BrowserSemanticElement = z.infer<typeof browserSemanticElementSchema>;
export type BrowserObservation = z.infer<typeof browserObservationSchema>;
export type BrowserComputerUseErrorCode = z.infer<typeof browserComputerUseErrorCodeSchema>;
