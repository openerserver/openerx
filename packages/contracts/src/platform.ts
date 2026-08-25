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
  ModelCatalogEntry,
  ModelGatewayRequestDto,
  ModelGatewayResponse,
  UsageAggregate,
  UsageRecord,
} from "./model";
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

export interface PlatformAlphaServices {
  identity: IdentityServicePort;
  sync: AccountSyncServicePort;
  models: ModelGatewayServicePort;
  usage: UsageStorePort;
  pricing?: PricingServicePort;
  billing?: BillingLedgerServicePort;
  payments?: PaymentServicePort;
}
