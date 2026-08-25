import {
  type ModelCatalogEntry,
  modelCatalogEntrySchema,
  type UsageAggregate,
  usageAggregateSchema,
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

  async #get(pathname: string, accessToken: string): Promise<unknown> {
    const response = await fetch(`${this.#baseUrl}${pathname}`, {
      headers: { authorization: `Bearer ${accessToken}` },
    });
    const body = (await response.json()) as { error?: { code?: string } };
    if (!response.ok) throw new Error(body.error?.code ?? `PLATFORM_HTTP_${response.status}`);
    return body;
  }
}
