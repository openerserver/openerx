import { z } from "zod";
import { automationCommandEnvelopeSchema, automationRunSchema } from "./automation";
import {
  chatCommandEnvelopeSchema,
  chatEventSchema,
  entityIdSchema,
  timestampSchema,
} from "./chat";
import { errorEnvelopeSchema } from "./errors";
import { automaticMemoryCreatedEventSchema } from "./memory";
import { hostToolAvailabilitySchema } from "./model";
import { projectCommandEnvelopeSchema } from "./project";
import { remoteConnectorConfigureFrameSchema, remoteConnectorDisableFrameSchema } from "./remote";
import { normalizedToolResultSchema, toolOperationSchema } from "./tool";

export const appServiceContractVersion = 1 as const;
export const processNonceSchema = z.string().regex(/^[a-f0-9]{64}$/);

export const appServiceBootstrapSchema = z
  .object({
    kind: z.literal("app-service.bootstrap"),
    contractVersion: z.literal(appServiceContractVersion),
    nonce: processNonceSchema,
    piHostNonce: processNonceSchema,
    profileDirectory: z.string().min(1),
    defaultWorkspaceDirectory: z.string().min(1),
    ownerProfileId: z.string().min(1),
    deviceId: entityIdSchema,
  })
  .strict();

export const appServiceReadyFrameSchema = z
  .object({
    kind: z.literal("app-service.ready"),
    contractVersion: z.literal(appServiceContractVersion),
    nonce: processNonceSchema,
  })
  .strict();

export const appServiceAuthorizationSchema = z
  .object({
    accountId: entityIdSchema,
    accessToken: z.string().min(32),
    accessTokenExpiresAt: timestampSchema,
    platformBaseUrl: z.url(),
  })
  .strict();

export const appServiceByokConfigurationSchema = z
  .object({
    apiKey: z.string().min(1).max(20_000),
    baseUrl: z.url(),
    modelId: z.string().min(1).max(200),
    displayName: z.string().min(1).max(120),
    contextWindow: z.number().int().positive(),
    maxOutputTokens: z.number().int().positive(),
    capabilities: z
      .object({
        imageInput: z.boolean(),
        functionCalling: z.boolean(),
        reasoning: z.boolean(),
      })
      .strict(),
  })
  .strict();

export const appServiceRequestFrameSchema = z
  .object({
    kind: z.literal("app-service.request"),
    requestId: z.uuid(),
    request: z.union([
      chatCommandEnvelopeSchema,
      automationCommandEnvelopeSchema,
      projectCommandEnvelopeSchema,
    ]),
    authorization: appServiceAuthorizationSchema.optional(),
    byok: appServiceByokConfigurationSchema.optional(),
  })
  .strict();

export const appServiceResponseFrameSchema = z.discriminatedUnion("ok", [
  z
    .object({
      kind: z.literal("app-service.response"),
      requestId: z.uuid(),
      ok: z.literal(true),
      data: z.unknown(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("app-service.response"),
      requestId: z.uuid(),
      ok: z.literal(false),
      error: errorEnvelopeSchema,
    })
    .strict(),
]);

export const appServiceEventFrameSchema = z
  .object({
    kind: z.literal("app-service.event"),
    event: chatEventSchema,
  })
  .strict();

export const automationRunEventFrameSchema = z
  .object({
    kind: z.literal("automation.run.event"),
    run: automationRunSchema,
  })
  .strict();

export const automationSchedulerReconcileFrameSchema = z
  .object({
    kind: z.literal("automation.scheduler.reconcile"),
    reason: z.literal("system_resume"),
    suspendedAt: timestampSchema.nullable(),
    resumedAt: timestampSchema,
  })
  .strict()
  .refine(
    ({ suspendedAt, resumedAt }) =>
      suspendedAt === null || Date.parse(suspendedAt) <= Date.parse(resumedAt),
    "AUTOMATION_WAKE_WINDOW_INVALID",
  );

export const automaticMemoryCreatedEventFrameSchema = z
  .object({
    kind: z.literal("memory.created.event"),
    event: automaticMemoryCreatedEventSchema,
  })
  .strict();

export const automationExecutionContextSchema = z
  .object({
    authorization: appServiceAuthorizationSchema.optional(),
    byok: appServiceByokConfigurationSchema.optional(),
  })
  .strict();

export const mainAutomationContextRequestFrameSchema = z
  .object({
    kind: z.literal("main.automation-context.request"),
    requestId: z.uuid(),
    modelRef: z
      .string()
      .regex(/^platform\/[a-z0-9][a-z0-9._-]*$/)
      .optional(),
  })
  .strict();

export const mainAutomationContextResponseFrameSchema = z.discriminatedUnion("ok", [
  z
    .object({
      kind: z.literal("main.automation-context.response"),
      requestId: z.uuid(),
      ok: z.literal(true),
      data: automationExecutionContextSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("main.automation-context.response"),
      requestId: z.uuid(),
      ok: z.literal(false),
      errorCode: z.string().min(1),
    })
    .strict(),
]);

export const mainCapabilityRequestFrameSchema = z
  .object({
    kind: z.literal("main.capability.request"),
    requestId: z.uuid(),
    operation: toolOperationSchema,
    executionContext: z
      .object({ conversationId: z.uuid(), generationId: z.uuid() })
      .strict()
      .optional(),
  })
  .strict();

export const mainCapabilityResponseFrameSchema = z.discriminatedUnion("ok", [
  z
    .object({
      kind: z.literal("main.capability.response"),
      requestId: z.uuid(),
      ok: z.literal(true),
      data: normalizedToolResultSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("main.capability.response"),
      requestId: z.uuid(),
      ok: z.literal(false),
      errorCode: z.string().min(1),
    })
    .strict(),
]);

export const mainCapabilityCancelFrameSchema = z
  .object({
    kind: z.literal("main.capability.cancel"),
    requestId: z.uuid(),
  })
  .strict();

export const mainCapabilityAvailabilityRequestFrameSchema = z
  .object({
    kind: z.literal("main.capability.availability.request"),
    requestId: z.uuid(),
  })
  .strict();

export const mainCapabilityAvailabilityResponseFrameSchema = z.discriminatedUnion("ok", [
  z
    .object({
      kind: z.literal("main.capability.availability.response"),
      requestId: z.uuid(),
      ok: z.literal(true),
      data: hostToolAvailabilitySchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("main.capability.availability.response"),
      requestId: z.uuid(),
      ok: z.literal(false),
      errorCode: z.string().min(1),
    })
    .strict(),
]);

export const mainCredentialRequestFrameSchema = z.discriminatedUnion("operation", [
  z
    .object({
      kind: z.literal("main.credential.request"),
      requestId: z.uuid(),
      operation: z.enum(["resolve", "clear"]),
      credentialRef: z.string().min(1).max(500),
    })
    .strict(),
  z
    .object({
      kind: z.literal("main.credential.request"),
      requestId: z.uuid(),
      operation: z.literal("save"),
      credentialRef: z.string().min(1).max(500),
      value: z.string().min(1).max(1_000_000),
    })
    .strict(),
]);

export const mainCredentialResponseFrameSchema = z.discriminatedUnion("ok", [
  z
    .object({
      kind: z.literal("main.credential.response"),
      requestId: z.uuid(),
      ok: z.literal(true),
      value: z.string().optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("main.credential.response"),
      requestId: z.uuid(),
      ok: z.literal(false),
      errorCode: z.string().min(1),
    })
    .strict(),
]);

export const mainOAuthRequestFrameSchema = z.discriminatedUnion("operation", [
  z
    .object({
      kind: z.literal("main.oauth.request"),
      requestId: z.uuid(),
      operation: z.literal("prepare"),
      serverId: entityIdSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("main.oauth.request"),
      requestId: z.uuid(),
      operation: z.literal("authorize"),
      sessionId: z.uuid(),
      authorizationUrl: z.url(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("main.oauth.request"),
      requestId: z.uuid(),
      operation: z.literal("cancel"),
      sessionId: z.uuid(),
    })
    .strict(),
]);

export const mainOAuthResponseFrameSchema = z.union([
  z
    .object({
      kind: z.literal("main.oauth.response"),
      requestId: z.uuid(),
      ok: z.literal(true),
      operation: z.literal("prepare"),
      sessionId: z.uuid(),
      redirectUrl: z.url(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("main.oauth.response"),
      requestId: z.uuid(),
      ok: z.literal(true),
      operation: z.literal("authorize"),
      callbackUrl: z.url(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("main.oauth.response"),
      requestId: z.uuid(),
      ok: z.literal(true),
      operation: z.literal("cancel"),
    })
    .strict(),
  z
    .object({
      kind: z.literal("main.oauth.response"),
      requestId: z.uuid(),
      ok: z.literal(false),
      errorCode: z.string().min(1),
    })
    .strict(),
]);

export const appServicePortFrameSchema = z.union([
  appServiceReadyFrameSchema,
  appServiceRequestFrameSchema,
  appServiceResponseFrameSchema,
  appServiceEventFrameSchema,
  automationRunEventFrameSchema,
  automationSchedulerReconcileFrameSchema,
  automaticMemoryCreatedEventFrameSchema,
  mainAutomationContextRequestFrameSchema,
  mainAutomationContextResponseFrameSchema,
  mainCapabilityRequestFrameSchema,
  mainCapabilityResponseFrameSchema,
  mainCapabilityCancelFrameSchema,
  mainCapabilityAvailabilityRequestFrameSchema,
  mainCapabilityAvailabilityResponseFrameSchema,
  mainCredentialRequestFrameSchema,
  mainCredentialResponseFrameSchema,
  mainOAuthRequestFrameSchema,
  mainOAuthResponseFrameSchema,
  remoteConnectorConfigureFrameSchema,
  remoteConnectorDisableFrameSchema,
]);

export type AppServiceBootstrap = z.infer<typeof appServiceBootstrapSchema>;
export type AppServiceByokConfiguration = z.infer<typeof appServiceByokConfigurationSchema>;
export type AppServiceReadyFrame = z.infer<typeof appServiceReadyFrameSchema>;
export type AppServiceRequestFrame = z.infer<typeof appServiceRequestFrameSchema>;
export type AppServiceRequest = AppServiceRequestFrame["request"];
export type AppServiceAuthorization = z.infer<typeof appServiceAuthorizationSchema>;
export type AppServiceResponseFrame = z.infer<typeof appServiceResponseFrameSchema>;
export type AppServiceEventFrame = z.infer<typeof appServiceEventFrameSchema>;
export type AutomationRunEventFrame = z.infer<typeof automationRunEventFrameSchema>;
export type AutomationSchedulerReconcileFrame = z.infer<
  typeof automationSchedulerReconcileFrameSchema
>;
export type AutomaticMemoryCreatedEventFrame = z.infer<
  typeof automaticMemoryCreatedEventFrameSchema
>;
export type AutomationExecutionContext = z.infer<typeof automationExecutionContextSchema>;
export type MainAutomationContextRequestFrame = z.infer<
  typeof mainAutomationContextRequestFrameSchema
>;
export type MainAutomationContextResponseFrame = z.infer<
  typeof mainAutomationContextResponseFrameSchema
>;
export type MainCapabilityRequestFrame = z.infer<typeof mainCapabilityRequestFrameSchema>;
export type MainCapabilityResponseFrame = z.infer<typeof mainCapabilityResponseFrameSchema>;
export type MainCapabilityCancelFrame = z.infer<typeof mainCapabilityCancelFrameSchema>;
export type MainCapabilityAvailabilityRequestFrame = z.infer<
  typeof mainCapabilityAvailabilityRequestFrameSchema
>;
export type MainCapabilityAvailabilityResponseFrame = z.infer<
  typeof mainCapabilityAvailabilityResponseFrameSchema
>;
export type MainCredentialRequestFrame = z.infer<typeof mainCredentialRequestFrameSchema>;
export type MainCredentialResponseFrame = z.infer<typeof mainCredentialResponseFrameSchema>;
export type MainOAuthRequestFrame = z.infer<typeof mainOAuthRequestFrameSchema>;
export type MainOAuthResponseFrame = z.infer<typeof mainOAuthResponseFrameSchema>;
