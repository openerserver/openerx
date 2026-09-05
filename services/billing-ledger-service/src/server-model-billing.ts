import { createHash } from "node:crypto";
import type {
  BillingLedgerServicePort,
  ModelBillingAuthorization,
  ModelBillingPort,
  ModelGatewayRequestDto,
  PricingServicePort,
  UsageEstimate,
  UsageRecord,
} from "@openerx/contracts";

function billingDedupeKey(scope: string, requestDedupeKey: string): string {
  const digest = createHash("sha256").update(requestDedupeKey, "utf8").digest("hex");
  return `${scope}:${digest}`;
}

export interface ServerModelBillingOptions {
  pricing: PricingServicePort;
  ledger: BillingLedgerServicePort;
  usageBudget(request: ModelGatewayRequestDto): {
    estimatedUsage: UsageEstimate;
    maximumUsage: UsageEstimate;
  };
  userLimitMinor(accountId: string): number;
}

export class ServerModelBilling implements ModelBillingPort {
  readonly #pricing: PricingServicePort;
  readonly #ledger: BillingLedgerServicePort;
  readonly #usageBudget: ServerModelBillingOptions["usageBudget"];
  readonly #userLimitMinor: ServerModelBillingOptions["userLimitMinor"];

  constructor(options: ServerModelBillingOptions) {
    this.#pricing = options.pricing;
    this.#ledger = options.ledger;
    this.#usageBudget = options.usageBudget;
    this.#userLimitMinor = options.userLimitMinor;
  }

  async authorize(request: ModelGatewayRequestDto): Promise<ModelBillingAuthorization> {
    const budget = this.#usageBudget(request);
    const quote = this.#pricing.createQuote(request.accountId, {
      modelRef: request.selectedModelRef,
      ...budget,
      userLimitMinor: this.#userLimitMinor(request.accountId),
      idempotencyKey: billingDedupeKey("server-quote", request.requestDedupeKey),
    });
    const reservation = this.#ledger.reserve(
      quote,
      billingDedupeKey("server-reservation", request.requestDedupeKey),
    );
    return { quote, reservation };
  }

  async settle(authorization: ModelBillingAuthorization, usage: UsageRecord) {
    return this.#ledger.settle(
      authorization.quote.accountId,
      authorization.reservation.reservationId,
      usage,
      billingDedupeKey("server-charge", usage.dedupeKey),
    );
  }

  async release(authorization: ModelBillingAuthorization): Promise<void> {
    this.#ledger.release(authorization.quote.accountId, authorization.reservation.reservationId);
  }
}
