import type {
  DeviceDescriptor,
  DeviceSession,
  DeviceSessionGrant,
  EmailChallenge,
} from "./account";
import type {
  ModelCatalogEntry,
  ModelGatewayRequestDto,
  ModelGatewayResponse,
  UsageAggregate,
  UsageRecord,
} from "./model";
import type { SyncConflict, SyncOperation, SyncPullResult, SyncPushResult } from "./sync";

export interface AccessPrincipal {
  accountId: string;
  sessionId: string;
  deviceId: string;
  sessionVersion: number;
}

export interface SyncPrincipal {
  accountId: string;
  sessionId: string;
  deviceId: string;
}

export interface IdentityServicePort {
  requestChallenge(email: string): Promise<EmailChallenge>;
  verifyChallenge(input: {
    challengeId: string;
    code: string;
    device: DeviceDescriptor;
  }): DeviceSessionGrant;
  refresh(sessionId: string, refreshCredential: string): DeviceSessionGrant;
  authenticate(accessToken: string): AccessPrincipal;
  revokeDevice(principal: AccessPrincipal, sessionId: string): DeviceSession;
  listDevices(principal: AccessPrincipal): DeviceSession[];
}

export interface AccountSyncServicePort {
  push(principal: SyncPrincipal, operation: SyncOperation): SyncPushResult;
  pull(principal: SyncPrincipal, cursor: string | null): SyncPullResult;
  listConflicts(principal: SyncPrincipal): SyncConflict[];
}

export interface UsageStorePort {
  record(record: UsageRecord): { record: UsageRecord; replayed: boolean };
  aggregate(input: {
    accountId: string;
    conversationId?: string;
    messageId?: string;
  }): UsageAggregate;
}

export interface ModelGatewayServicePort {
  catalog(): ModelCatalogEntry[];
  execute(request: ModelGatewayRequestDto, signal?: AbortSignal): Promise<ModelGatewayResponse>;
}

export interface PlatformAlphaServices {
  identity: IdentityServicePort;
  sync: AccountSyncServicePort;
  models: ModelGatewayServicePort;
  usage: UsageStorePort;
}
