import { z } from "zod";
import {
  chatCommandEnvelopeSchema,
  chatEventSchema,
  entityIdSchema,
  timestampSchema,
} from "./chat";
import { errorEnvelopeSchema } from "./errors";
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

export const appServiceRequestFrameSchema = z
  .object({
    kind: z.literal("app-service.request"),
    requestId: z.uuid(),
    request: chatCommandEnvelopeSchema,
    authorization: appServiceAuthorizationSchema.optional(),
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

export const mainCapabilityRequestFrameSchema = z
  .object({
    kind: z.literal("main.capability.request"),
    requestId: z.uuid(),
    operation: toolOperationSchema,
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

export const mainCredentialRequestFrameSchema = z
  .object({
    kind: z.literal("main.credential.request"),
    requestId: z.uuid(),
    operation: z.enum(["resolve", "clear"]),
    credentialRef: z.string().min(1).max(500),
  })
  .strict();

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

export const appServicePortFrameSchema = z.union([
  appServiceReadyFrameSchema,
  appServiceRequestFrameSchema,
  appServiceResponseFrameSchema,
  appServiceEventFrameSchema,
  mainCapabilityRequestFrameSchema,
  mainCapabilityResponseFrameSchema,
  mainCapabilityCancelFrameSchema,
  mainCredentialRequestFrameSchema,
  mainCredentialResponseFrameSchema,
  remoteConnectorConfigureFrameSchema,
  remoteConnectorDisableFrameSchema,
]);

export type AppServiceBootstrap = z.infer<typeof appServiceBootstrapSchema>;
export type AppServiceReadyFrame = z.infer<typeof appServiceReadyFrameSchema>;
export type AppServiceRequestFrame = z.infer<typeof appServiceRequestFrameSchema>;
export type AppServiceAuthorization = z.infer<typeof appServiceAuthorizationSchema>;
export type AppServiceResponseFrame = z.infer<typeof appServiceResponseFrameSchema>;
export type AppServiceEventFrame = z.infer<typeof appServiceEventFrameSchema>;
export type MainCapabilityRequestFrame = z.infer<typeof mainCapabilityRequestFrameSchema>;
export type MainCapabilityResponseFrame = z.infer<typeof mainCapabilityResponseFrameSchema>;
export type MainCapabilityCancelFrame = z.infer<typeof mainCapabilityCancelFrameSchema>;
export type MainCredentialRequestFrame = z.infer<typeof mainCredentialRequestFrameSchema>;
export type MainCredentialResponseFrame = z.infer<typeof mainCredentialResponseFrameSchema>;
