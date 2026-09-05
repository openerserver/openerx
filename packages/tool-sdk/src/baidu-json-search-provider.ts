import type {
  LocalWebSearchCandidate,
  LocalWebSearchPolicy,
  LocalWebSearchProviderDescriptor,
  LocalWebSearchProviderResult,
} from "@openerx/contracts";
import { desktopBrand } from "../../branding/src/index";
import {
  type LocalSearchProvider,
  LocalWebSearchError,
  type NormalizedLocalSearchQuery,
} from "./local-web-search";
import type { ControlledSearchHttpClient } from "./local-web-search-http";
import { NodeControlledSearchHttpClient } from "./local-web-search-http";

const BAIDU_ORIGIN = "https://www.baidu.com";
const BAIDU_SEARCH_PATH = "/s";
const DEFAULT_APP_VERSION = "2.0.1";

export const BAIDU_JSON_SEARCH_PROVIDER_DESCRIPTOR: LocalWebSearchProviderDescriptor = {
  providerId: "direct:baidu-json",
  displayName: "百度 JSON（Local Alpha）",
  transport: "json",
  stability: "unofficial",
  releaseEligible: false,
  requiresDailyProbe: true,
};

function platformUserAgentToken(): string {
  switch (process.platform) {
    case "darwin":
      return "Macintosh; Intel Mac OS X 10_15_7";
    case "win32":
      return "Windows NT 10.0; Win64; x64";
    default:
      return "X11; Linux x86_64";
  }
}

export function localWebSearchProductUserAgent(appVersion = DEFAULT_APP_VERSION): string {
  const electronVersion = process.versions.electron;
  const chromeVersion = process.versions.chrome;
  if (electronVersion && chromeVersion) {
    return `Mozilla/5.0 (${platformUserAgentToken()}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVersion} Electron/${electronVersion} ${desktopBrand.productName}/${appVersion}`;
  }
  return `${desktopBrand.productName}/${appVersion} (${process.platform}; Node/${process.versions.node})`;
}

function objectRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function publishedAt(value: unknown): string | null {
  const seconds = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  const date = new Date(Math.trunc(seconds) * 1_000);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function parseBaiduJsonSearchResponse(text: string): LocalWebSearchCandidate[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new LocalWebSearchError("LOCAL_SEARCH_RESULT_PARSE_FAILED");
  }
  const root = objectRecord(parsed);
  if (!root) throw new LocalWebSearchError("LOCAL_SEARCH_RESULT_PARSE_FAILED");
  if (Number(root.antiFlag) === 1) {
    throw new LocalWebSearchError("LOCAL_SEARCH_PROVIDER_CHALLENGE");
  }
  const feed = objectRecord(root.feed);
  if (!feed || !Array.isArray(feed.entry)) {
    throw new LocalWebSearchError("LOCAL_SEARCH_RESULT_SURFACE_UNRECOGNIZED");
  }
  return feed.entry.slice(0, 100).flatMap((value): LocalWebSearchCandidate[] => {
    const entry = objectRecord(value);
    if (!entry || typeof entry.title !== "string" || typeof entry.url !== "string") return [];
    return [
      {
        title: entry.title.slice(0, 2_000),
        url: entry.url.slice(0, 8_192),
        excerpt: typeof entry.abs === "string" ? entry.abs.slice(0, 8_000) : "",
        publishedAt: publishedAt(entry.time),
      },
    ];
  });
}

export class BaiduJsonSearchProvider implements LocalSearchProvider {
  readonly descriptor = BAIDU_JSON_SEARCH_PROVIDER_DESCRIPTOR;
  readonly #client: ControlledSearchHttpClient;
  readonly #userAgent: string;
  readonly #now: () => number;

  constructor(
    options: {
      client?: ControlledSearchHttpClient;
      userAgent?: string;
      now?: () => number;
    } = {},
  ) {
    this.#client = options.client ?? new NodeControlledSearchHttpClient();
    this.#userAgent = options.userAgent ?? localWebSearchProductUserAgent();
    this.#now = options.now ?? Date.now;
  }

  async search(
    input: NormalizedLocalSearchQuery,
    context: { signal: AbortSignal; policy: LocalWebSearchPolicy },
  ): Promise<LocalWebSearchProviderResult> {
    const url = new URL(BAIDU_SEARCH_PATH, BAIDU_ORIGIN);
    url.searchParams.set("wd", input.query);
    url.searchParams.set("rn", String(Math.min(context.policy.maxResultsPerCall, 10)));
    url.searchParams.set("pn", "0");
    url.searchParams.set("tn", "json");
    let recencyApplied = false;
    if (input.recencyDays !== undefined) {
      const nowSeconds = Math.floor(this.#now() / 1_000);
      const fromSeconds = nowSeconds - input.recencyDays * 86_400;
      url.searchParams.set("gpc", `stf=${fromSeconds},${nowSeconds}|stftype=1`);
      recencyApplied = true;
    }
    const response = await this.#client.get({
      url,
      allowedOrigins: [BAIDU_ORIGIN],
      allowedPaths: [BAIDU_SEARCH_PATH],
      headers: {
        accept: "application/json,text/plain;q=0.9",
        "accept-language": "zh-CN,zh;q=0.9",
        dnt: "1",
        "sec-gpc": "1",
        "user-agent": this.#userAgent,
      },
      acceptedContentTypes: ["application/json"],
      maxResponseBytes: context.policy.maxResponseBytes,
      timeoutMs: context.policy.requestTimeoutMs,
      signal: context.signal,
    });
    return {
      providerId: this.descriptor.providerId,
      candidates: parseBaiduJsonSearchResponse(response.text),
      recencyApplied,
      executionPerformed: true,
      responseBytes: response.responseBytes,
      durationMs: response.durationMs,
    };
  }
}
