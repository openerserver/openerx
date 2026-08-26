import type {
  DeviceDescriptor,
  DeviceSession,
  DeviceSessionGrant,
  EmailChallenge,
} from "./account";
import type {
  BillingOverview,
  BillingStatementExport,
  BillingTerms,
  BillingTermsAcceptance,
  ChargeRecord,
  FundsReservation,
  LedgerTransaction,
  PaymentCallback,
  PriceCatalogEntry,
  PriceQuote,
  RechargeOrder,
  RefundOrder,
} from "./billing";
import type {
  CloudObjectDescriptor,
  CloudObjectIntentInput,
  CloudObjectTransferIntent,
} from "./file";
import type {
  ModelCatalogEntry,
  ModelGatewayRequestDto,
  ModelGatewayResponse,
  UsageAggregate,
  UsageRecord,
} from "./model";
import type {
  PushSubscription,
  RemoteCommand,
  RemoteCommandReceipt,
  RemoteDevicePairing,
  RemoteEventCursor,
  RemoteEventPublishInput,
  RemoteHost,
  RemoteHostRegistrationInput,
  RemotePairingAcceptInput,
  RemotePairingChallenge,
  RemoteProductEvent,
  RemotePushEnvelope,
} from "./remote";
import type {
  CloudDataDeletionResult,
  SyncConflict,
  SyncOperation,
  SyncPullResult,
  SyncPushResult,
} from "./sync";

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
  revokeAllDevices(principal: AccessPrincipal): DeviceSession[];
  listDevices(principal: AccessPrincipal): DeviceSession[];
}

export interface AccountSyncServicePort {
  push(principal: SyncPrincipal, operation: SyncOperation): SyncPushResult;
  pull(principal: SyncPrincipal, cursor: string | null): SyncPullResult;
  listConflicts(principal: SyncPrincipal): SyncConflict[];
  resolveConflict(principal: SyncPrincipal, conflictId: string): SyncConflict;
  deleteAccountData(principal: SyncPrincipal): CloudDataDeletionResult;
}

export interface CloudObjectServicePort {
  createUploadIntent(
    principal: SyncPrincipal,
    input: CloudObjectIntentInput,
  ): CloudObjectTransferIntent;
  upload(principal: SyncPrincipal, token: string, bytes: Uint8Array): CloudObjectDescriptor;
  createDownloadIntent(principal: SyncPrincipal, objectId: string): CloudObjectTransferIntent;
  download(
    principal: SyncPrincipal,
    token: string,
  ): {
    descriptor: CloudObjectDescriptor;
    bytes: Uint8Array;
  };
  deleteAccountData(principal: SyncPrincipal): number;
  revokeSession?(sessionId: string): void;
}

export interface UsageStorePort {
  record(record: UsageRecord): { record: UsageRecord; replayed: boolean };
  aggregate(input: {
    accountId: string;
    conversationId?: string;
    messageId?: string;
  }): UsageAggregate;
  list(input: { accountId: string; conversationId?: string; messageId?: string }): UsageRecord[];
}

export interface ModelGatewayServicePort {
  catalog(): ModelCatalogEntry[];
  execute(request: ModelGatewayRequestDto, signal?: AbortSignal): Promise<ModelGatewayResponse>;
  stream(
    request: ModelGatewayRequestDto,
    onDelta: (delta: string) => void,
    signal?: AbortSignal,
  ): Promise<ModelGatewayResponse>;
}

export interface PricingServicePort {
  terms(): BillingTerms;
  catalog(): PriceCatalogEntry[];
  acceptTerms(accountId: string, version: string): BillingTermsAcceptance;
  termsAcceptance(accountId: string, version?: string): BillingTermsAcceptance | null;
  createQuote(accountId: string, input: unknown): PriceQuote;
  getQuote(accountId: string, quoteId: string): PriceQuote;
}

export interface BillingLedgerServicePort {
  overview(accountId: string): BillingOverview;
  reserve(quote: PriceQuote, idempotencyKey: string): FundsReservation;
  release(accountId: string, reservationId: string): FundsReservation;
  settle(
    accountId: string,
    reservationId: string,
    usage: UsageRecord,
    dedupeKey: string,
  ): ChargeRecord;
  listCharges(accountId: string): ChargeRecord[];
  listLedger(accountId: string): LedgerTransaction[];
  exportStatement(accountId: string, month: string): BillingStatementExport;
  rebuildAssetProjections?(accountId: string): BillingOverview;
}

export interface PaymentServicePort {
  createOrder(accountId: string, input: unknown): RechargeOrder;
  handleCallback(input: PaymentCallback): RechargeOrder;
  listOrders(accountId: string): RechargeOrder[];
  refund(
    accountId: string,
    orderId: string,
    amountMinor: number,
    reason: string,
    idempotencyKey: string,
  ): RefundOrder;
  listRefunds(accountId: string): RefundOrder[];
}

export interface ModelBillingAuthorization {
  quote: PriceQuote;
  reservation: FundsReservation;
}

export interface ModelBillingPort {
  authorize(request: ModelGatewayRequestDto): Promise<ModelBillingAuthorization>;
  settle(authorization: ModelBillingAuthorization, usage: UsageRecord): Promise<ChargeRecord>;
  release(authorization: ModelBillingAuthorization): Promise<void>;
}

export interface RemoteControlServicePort {
  registerHost(principal: AccessPrincipal, input: RemoteHostRegistrationInput): RemoteHost;
  listHosts(principal: AccessPrincipal): RemoteHost[];
  updatePresence(
    principal: AccessPrincipal,
    input: { hostDeviceId: string; presence: "online" | "degraded" | "offline"; revision: number },
  ): RemoteHost;
  createPairingChallenge(
    principal: AccessPrincipal,
    input: { hostDeviceId: string; hostPublicKey: string },
  ): RemotePairingChallenge;
  acceptPairing(principal: AccessPrincipal, input: RemotePairingAcceptInput): RemoteDevicePairing;
  listPairings(principal: AccessPrincipal): RemoteDevicePairing[];
  revokePairing(principal: AccessPrincipal, pairingId: string): RemoteDevicePairing;
  submitCommand(principal: AccessPrincipal, command: RemoteCommand): RemoteCommandReceipt;
  pullHostCommands(
    principal: AccessPrincipal,
    hostDeviceId: string,
    limit?: number,
  ): RemoteCommand[];
  recordReceipt(principal: AccessPrincipal, receipt: RemoteCommandReceipt): RemoteCommandReceipt;
  publishEvent(principal: AccessPrincipal, input: RemoteEventPublishInput): RemoteProductEvent;
  listEvents(
    principal: AccessPrincipal,
    input: {
      hostDeviceId: string;
      conversationId?: string | null;
      afterCursor: string | null;
      limit?: number;
    },
  ): RemoteProductEvent[];
  acknowledgeCursor(
    principal: AccessPrincipal,
    input: { hostDeviceId: string; conversationId: string | null; cursor: string },
  ): RemoteEventCursor;
  upsertPushSubscription(principal: AccessPrincipal, input: PushSubscription): PushSubscription;
  createPushEnvelope(input: RemotePushEnvelope): RemotePushEnvelope;
}

export interface PlatformAlphaServices {
  identity: IdentityServicePort;
  sync: AccountSyncServicePort;
  objects?: CloudObjectServicePort;
  models: ModelGatewayServicePort;
  usage: UsageStorePort;
  pricing?: PricingServicePort;
  billing?: BillingLedgerServicePort;
  payments?: PaymentServicePort;
  remote?: RemoteControlServicePort;
}
