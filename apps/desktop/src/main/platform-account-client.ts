import {
  type BillingOverview,
  type BillingStatementExport,
  type BillingTermsAcceptance,
  type BillingTermsState,
  billingOverviewSchema,
  billingStatementExportSchema,
  billingTermsAcceptanceSchema,
  billingTermsStateSchema,
  type ChargeRecord,
  type CloudDataDeletionResult,
  chargeRecordSchema,
  cloudDataDeletionResultSchema,
  createRechargeOrderInputSchema,
  type LedgerTransaction,
  ledgerTransactionSchema,
  type ModelCatalogEntry,
  modelCatalogEntrySchema,
  type RechargeOrder,
  type RefundOrder,
  rechargeOrderSchema,
  refundOrderSchema,
  type UsageAggregate,
  type UsageRecord,
  usageAggregateSchema,
  usageRecordSchema,
} from "@openerx/contracts";

export class PlatformAccountClient {
  readonly #baseUrl: string;

  constructor(baseUrl: string) {
    this.#baseUrl = baseUrl.replace(/\/$/, "");
  }

  async listModels(accessToken: string): Promise<ModelCatalogEntry[]> {
    const body = await this.#get("/api/v2/models", accessToken);
    return modelCatalogEntrySchema.array().parse(body);
  }

  async usage(
    accessToken: string,
    input: { conversationId?: string; messageId?: string },
  ): Promise<UsageAggregate> {
    const query = new URLSearchParams();
    if (input.conversationId) query.set("conversationId", input.conversationId);
    if (input.messageId) query.set("messageId", input.messageId);
    const suffix = query.size > 0 ? `?${query.toString()}` : "";
    return usageAggregateSchema.parse(await this.#get(`/api/v2/usage${suffix}`, accessToken));
  }

  async usageRecords(
    accessToken: string,
    input: { conversationId?: string; messageId?: string },
  ): Promise<UsageRecord[]> {
    const query = this.#query(input);
    return usageRecordSchema
      .array()
      .parse(await this.#get(`/api/v2/usage/records${query}`, accessToken));
  }

  async billingTerms(accessToken: string): Promise<BillingTermsState> {
    return billingTermsStateSchema.parse(await this.#get("/api/v2/billing/terms", accessToken));
  }

  async acceptBillingTerms(accessToken: string, version: string): Promise<BillingTermsAcceptance> {
    return billingTermsAcceptanceSchema.parse(
      await this.#json("/api/v2/billing/terms/accept", accessToken, { version }),
    );
  }

  async billingOverview(accessToken: string): Promise<BillingOverview> {
    return billingOverviewSchema.parse(await this.#get("/api/v2/billing/overview", accessToken));
  }

  async charges(accessToken: string): Promise<ChargeRecord[]> {
    return chargeRecordSchema
      .array()
      .parse(await this.#get("/api/v2/billing/charges", accessToken));
  }

  async ledger(accessToken: string): Promise<LedgerTransaction[]> {
    return ledgerTransactionSchema
      .array()
      .parse(await this.#get("/api/v2/billing/ledger", accessToken));
  }

  async createRechargeOrder(accessToken: string, input: unknown): Promise<RechargeOrder> {
    return rechargeOrderSchema.parse(
      await this.#json(
        "/api/v2/billing/recharge-orders",
        accessToken,
        createRechargeOrderInputSchema.parse(input),
      ),
    );
  }

  async rechargeOrders(accessToken: string): Promise<RechargeOrder[]> {
    return rechargeOrderSchema
      .array()
      .parse(await this.#get("/api/v2/billing/recharge-orders", accessToken));
  }

  async refunds(accessToken: string): Promise<RefundOrder[]> {
    return refundOrderSchema.array().parse(await this.#get("/api/v2/billing/refunds", accessToken));
  }

  async billingStatement(accessToken: string, month: string): Promise<BillingStatementExport> {
    return billingStatementExportSchema.parse(
      await this.#get(`/api/v2/billing/statements/${encodeURIComponent(month)}`, accessToken),
    );
  }

  async deleteCloudData(accessToken: string): Promise<CloudDataDeletionResult> {
    return cloudDataDeletionResultSchema.parse(
      await this.#request("/api/v2/sync/account-data", accessToken, { method: "DELETE" }),
    );
  }

  #query(input: { conversationId?: string; messageId?: string }): string {
    const query = new URLSearchParams();
    if (input.conversationId) query.set("conversationId", input.conversationId);
    if (input.messageId) query.set("messageId", input.messageId);
    return query.size > 0 ? `?${query.toString()}` : "";
  }

  async #get(pathname: string, accessToken: string): Promise<unknown> {
    return await this.#request(pathname, accessToken, { method: "GET" });
  }

  async #json(pathname: string, accessToken: string, body: unknown): Promise<unknown> {
    return await this.#request(pathname, accessToken, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  async #request(pathname: string, accessToken: string, init: RequestInit): Promise<unknown> {
    const response = await fetch(`${this.#baseUrl}${pathname}`, {
      ...init,
      headers: { ...init.headers, authorization: `Bearer ${accessToken}` },
    });
    const body = (await response.json()) as { error?: { code?: string } };
    if (!response.ok) throw new Error(body.error?.code ?? `PLATFORM_HTTP_${response.status}`);
    return body;
  }
}
