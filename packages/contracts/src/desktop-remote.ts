import { z } from "zod";
import { entityIdSchema } from "./common";
import {
  type RemoteConnectionRequest,
  remoteDevicePairingSchema,
  remoteHostSchema,
  type remotePairingChallengeSchema,
} from "./remote";

export const remoteDesktopStateSchema = z
  .object({
    available: z.boolean(),
    enabled: z.boolean(),
    host: remoteHostSchema.nullable(),
    pairings: z.array(remoteDevicePairingSchema),
    reason: z.string().min(1).nullable(),
  })
  .strict();

export const remoteDesktopEnableInputSchema = z.object({ enabled: z.boolean() }).strict();
export const remoteDesktopRevokeInputSchema = z.object({ pairingId: entityIdSchema }).strict();
export const remoteDesktopConnectionDecisionSchema = z
  .object({
    requestId: entityIdSchema,
    decision: z.enum(["approve", "reject"]),
  })
  .strict();

export type RemoteDesktopState = z.infer<typeof remoteDesktopStateSchema>;

export interface RemoteDesktopBridge {
  getRemoteState(): Promise<RemoteDesktopState>;
  setRemoteEnabled(
    input: z.input<typeof remoteDesktopEnableInputSchema>,
  ): Promise<RemoteDesktopState>;
  createRemotePairingChallenge(): Promise<z.infer<typeof remotePairingChallengeSchema>>;
  listRemoteConnectionRequests(): Promise<RemoteConnectionRequest[]>;
  decideRemoteConnectionRequest(
    input: z.infer<typeof remoteDesktopConnectionDecisionSchema>,
  ): Promise<RemoteConnectionRequest>;
  revokeRemotePairing(
    input: z.input<typeof remoteDesktopRevokeInputSchema>,
  ): Promise<z.infer<typeof remoteDevicePairingSchema>>;
}
