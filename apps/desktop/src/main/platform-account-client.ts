import {
  type CloudDataDeletionResult,
  cloudDataDeletionResultSchema,
  type ModelCatalogEntry,
  modelCatalogEntrySchema,
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

  async #request(pathname: string, accessToken: string, init: RequestInit): Promise<unknown> {
    const response = await fetch(`${this.#baseUrl}${pathname}`, {
      ...init,
      headers: { authorization: `Bearer ${accessToken}` },
    });
    const body = (await response.json()) as { error?: { code?: string } };
    if (!response.ok) throw new Error(body.error?.code ?? `PLATFORM_HTTP_${response.status}`);
    return body;
  }
}
