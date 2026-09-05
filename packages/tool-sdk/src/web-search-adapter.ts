import type { NormalizedToolResult, ToolOperation } from "@openerx/contracts";
import { normalizedToolResultSchema } from "@openerx/contracts";
import type { ToolAdapter, WebSearchTransport } from "./types";

export class HttpPlatformWebSearchTransport implements WebSearchTransport {
  constructor(
    private readonly platformBaseUrl: string,
    private readonly accessToken: string,
    private readonly fetchImplementation: typeof fetch = fetch,
  ) {}

  async search(input: {
    query: string;
    recencyDays?: number;
    domains?: string[];
    signal: AbortSignal;
  }): Promise<NormalizedToolResult> {
    const response = await this.fetchImplementation(
      new URL("/v1/tools/web-search", this.platformBaseUrl),
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.accessToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          query: input.query,
          recencyDays: input.recencyDays,
          domains: input.domains,
        }),
        signal: input.signal,
      },
    );
    if (!response.ok) throw new Error(`WEB_SEARCH_HTTP_${response.status}`);
    return normalizedToolResultSchema.parse(await response.json());
  }
}

export class WebSearchAdapter implements ToolAdapter {
  readonly operations = ["web_search"] as const;
  constructor(private readonly transport: WebSearchTransport) {}

  async execute(
    operation: ToolOperation,
    context: { signal: AbortSignal },
  ): Promise<NormalizedToolResult> {
    if (operation.operation !== "web_search") throw new Error("WEB_SEARCH_OPERATION_NOT_SUPPORTED");
    return await this.transport.search({
      query: operation.query,
      ...(operation.recencyDays === undefined ? {} : { recencyDays: operation.recencyDays }),
      ...(operation.domains === undefined ? {} : { domains: operation.domains }),
      signal: context.signal,
    });
  }
}
