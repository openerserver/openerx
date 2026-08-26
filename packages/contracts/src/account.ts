import { z } from "zod";
import { entityIdSchema, timestampSchema } from "./chat";

export const desktopPlatformSchema = z.enum(["darwin", "win32"]);
export const desktopArchitectureSchema = z.enum(["arm64", "x64"]);
export const accountDevicePlatformSchema = z.enum(["darwin", "win32", "ios", "android"]);

export const accountIdentitySchema = z
  .object({
    accountId: entityIdSchema,
    email: z.email(),
    displayName: z.string().trim().min(1).max(120),
    createdAt: timestampSchema,
  })
  .strict();

export const deviceDescriptorSchema = z
  .object({
    deviceId: entityIdSchema,
    name: z.string().trim().min(1).max(120),
    platform: accountDevicePlatformSchema,
    arch: desktopArchitectureSchema,
  })
  .strict();

export const deviceSessionSchema = z
  .object({
    sessionId: entityIdSchema,
    accountId: entityIdSchema,
    device: deviceDescriptorSchema,
    sessionVersion: z.number().int().positive(),
    createdAt: timestampSchema,
    lastActiveAt: timestampSchema,
    revokedAt: timestampSchema.nullable(),
  })
  .strict();

export const emailChallengeSchema = z
  .object({
    challengeId: entityIdSchema,
    email: z.email(),
    expiresAt: timestampSchema,
  })
  .strict();

export const deviceSessionGrantSchema = z
  .object({
    account: accountIdentitySchema,
    session: deviceSessionSchema,
    refreshCredential: z.string().min(32),
    accessToken: z.string().min(32),
    accessTokenExpiresAt: timestampSchema,
  })
  .strict();

export const accountStateSchema = z
  .object({
    status: z.enum(["signed_out", "signed_in", "reauth_required", "unavailable"]),
    account: accountIdentitySchema.nullable(),
    session: deviceSessionSchema.nullable(),
    reason: z.string().min(1).nullable(),
  })
  .strict();

export const accountRequestCodeInputSchema = z.object({ email: z.email() }).strict();

export const accountVerifyCodeInputSchema = z
  .object({
    challengeId: entityIdSchema,
    code: z.string().regex(/^\d{6}$/),
  })
  .strict();

export const accountRevokeDeviceInputSchema = z.object({ sessionId: entityIdSchema }).strict();

export type AccountIdentity = z.infer<typeof accountIdentitySchema>;
export type DeviceDescriptor = z.infer<typeof deviceDescriptorSchema>;
export type DeviceSession = z.infer<typeof deviceSessionSchema>;
export type EmailChallenge = z.infer<typeof emailChallengeSchema>;
export type DeviceSessionGrant = z.infer<typeof deviceSessionGrantSchema>;
export type AccountState = z.infer<typeof accountStateSchema>;

export interface AccountBridge {
  getAccountState(): Promise<AccountState>;
  listDevices(): Promise<DeviceSession[]>;
  requestEmailCode(input: z.input<typeof accountRequestCodeInputSchema>): Promise<EmailChallenge>;
  verifyEmailCode(input: z.input<typeof accountVerifyCodeInputSchema>): Promise<AccountState>;
  signOut(): Promise<AccountState>;
  signOutAll(): Promise<AccountState>;
  revokeDevice(input: z.input<typeof accountRevokeDeviceInputSchema>): Promise<AccountState>;
}
