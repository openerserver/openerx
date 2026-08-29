import type {
  LocalWebSearchCandidate,
  LocalWebSearchPolicy,
  LocalWebSearchProviderDescriptor,
  LocalWebSearchProviderResult,
} from "@openerx/contracts";
import { type DefaultTreeAdapterTypes, parse } from "parse5";
import { localWebSearchProductUserAgent } from "./baidu-json-search-provider";
import {
  type LocalSearchProvider,
  LocalWebSearchError,
  type NormalizedLocalSearchQuery,
} from "./local-web-search";
import type { ControlledSearchHttpClient } from "./local-web-search-http";
import { NodeControlledSearchHttpClient } from "./local-web-search-http";

const BING_SEARCH_PATH = "/search";
const BING_GLOBAL_ORIGIN = "https://www.bing.com";
const BING_CHINA_ORIGIN = "https://cn.bing.com";

export const BING_HTML_SEARCH_ORIGINS = [BING_GLOBAL_ORIGIN, BING_CHINA_ORIGIN] as const;
export type BingHtmlSearchOrigin = (typeof BING_HTML_SEARCH_ORIGINS)[number];

export const BING_HTML_SEARCH_PROVIDER_DESCRIPTOR: LocalWebSearchProviderDescriptor = {
  providerId: "direct:bing-html",
  displayName: "Bing HTML（Local Alpha）",
  transport: "html",
  stability: "unofficial",
  releaseEligible: false,
  requiresDailyProbe: true,
};

type HtmlNode = DefaultTreeAdapterTypes.Node;
type HtmlElement = DefaultTreeAdapterTypes.Element;

function isElement(node: HtmlNode): node is HtmlElement {
  return "tagName" in node && "attrs" in node;
}

function children(node: HtmlNode): readonly HtmlNode[] {
  return "childNodes" in node ? node.childNodes : [];
}

function attribute(element: HtmlElement, name: string): string | null {
  return element.attrs.find((candidate) => candidate.name === name)?.value ?? null;
}

function classNames(element: HtmlElement): string[] {
  return (attribute(element, "class") ?? "").split(/\s+/u).filter(Boolean);
}

function hasClass(element: HtmlElement, name: string): boolean {
  return classNames(element).includes(name);
}

function findFirstElement(
  root: HtmlNode,
  predicate: (element: HtmlElement) => boolean,
): HtmlElement | null {
  if (isElement(root) && predicate(root)) return root;
  for (const child of children(root)) {
    const match = findFirstElement(child, predicate);
    if (match) return match;
  }
  return null;
}

function visibleText(node: HtmlNode): string {
  if (node.nodeName === "#text" && "value" in node) return node.value;
  if (
    isElement(node) &&
    ["script", "style", "template", "noscript", "svg"].includes(node.tagName)
  ) {
    return "";
  }
  return children(node).map(visibleText).join(" ");
}

function normalizedText(node: HtmlNode, maxLength: number): string {
  return visibleText(node).replace(/\s+/gu, " ").trim().slice(0, maxLength);
}

function isBingHostname(hostname: string): boolean {
  const normalized = hostname.toLocaleLowerCase();
  return normalized === "bing.com" || normalized.endsWith(".bing.com");
}

function decodedBingRedirect(value: string): string {
  if (!value.startsWith("a1")) {
    throw new LocalWebSearchError("LOCAL_SEARCH_RESULT_PARSE_FAILED");
  }
  const encoded = value.slice(2);
  const withoutPadding = encoded.replace(/=+$/u, "");
  if (
    withoutPadding === "" ||
    !/^[A-Za-z0-9_-]+$/u.test(withoutPadding) ||
    withoutPadding.length % 4 === 1
  ) {
    throw new LocalWebSearchError("LOCAL_SEARCH_RESULT_PARSE_FAILED");
  }
  const bytes = Buffer.from(withoutPadding, "base64url");
  if (bytes.toString("base64url") !== withoutPadding) {
    throw new LocalWebSearchError("LOCAL_SEARCH_RESULT_PARSE_FAILED");
  }
  let decoded: string;
  try {
    decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new LocalWebSearchError("LOCAL_SEARCH_RESULT_PARSE_FAILED");
  }
  return decoded;
}

export function decodeBingResultUrl(href: string, origin: BingHtmlSearchOrigin): string {
  let parsed: URL;
  try {
    parsed = new URL(href, origin);
    if (isBingHostname(parsed.hostname) && parsed.pathname === "/ck/a") {
      const target = parsed.searchParams.get("u");
      if (!target) throw new LocalWebSearchError("LOCAL_SEARCH_RESULT_PARSE_FAILED");
      parsed = new URL(decodedBingRedirect(target));
    }
  } catch (error) {
    if (error instanceof LocalWebSearchError) throw error;
    throw new LocalWebSearchError("LOCAL_SEARCH_RESULT_PARSE_FAILED");
  }
  if (
    (parsed.protocol !== "https:" && parsed.protocol !== "http:") ||
    parsed.username !== "" ||
    parsed.password !== ""
  ) {
    throw new LocalWebSearchError("LOCAL_SEARCH_SOURCE_URL_INVALID");
  }
  return parsed.href;
}

function hasChallengeSurface(document: HtmlNode): boolean {
  const challengeElement = findFirstElement(document, (element) => {
    const markers = [attribute(element, "id") ?? "", ...classNames(element)];
    return markers.some((marker) => /captcha|challenge|verify-human/iu.test(marker));
  });
  if (challengeElement) return true;
  const text = normalizedText(document, 20_000).toLocaleLowerCase();
  return [
    "verify you are human",
    "unusual traffic",
    "enter the characters you see",
    "验证您是人类",
    "异常流量",
    "请输入图中",
  ].some((marker) => text.includes(marker));
}

function hasKnownNoResultsSurface(results: HtmlElement): boolean {
  if (
    findFirstElement(
      results,
      (element) => attribute(element, "id") === "b_no" || hasClass(element, "b_no"),
    )
  ) {
    return true;
  }
  const text = normalizedText(results, 20_000).toLocaleLowerCase();
  return ["there are no results for", "no results found for", "没有与", "未找到相关结果"].some(
    (marker) => text.includes(marker),
  );
}

export function parseBingHtmlSearchResponse(
  text: string,
  origin: BingHtmlSearchOrigin,
): LocalWebSearchCandidate[] {
  let document: DefaultTreeAdapterTypes.Document;
  try {
    document = parse(text);
  } catch {
    throw new LocalWebSearchError("LOCAL_SEARCH_RESULT_PARSE_FAILED");
  }
  if (hasChallengeSurface(document)) {
    throw new LocalWebSearchError("LOCAL_SEARCH_PROVIDER_CHALLENGE");
  }
  const results = findFirstElement(
    document,
    (element) => element.tagName === "ol" && attribute(element, "id") === "b_results",
  );
  if (!results) {
    throw new LocalWebSearchError("LOCAL_SEARCH_RESULT_SURFACE_UNRECOGNIZED");
  }
  const resultItems = results.childNodes.filter(
    (node): node is HtmlElement =>
      isElement(node) && node.tagName === "li" && hasClass(node, "b_algo"),
  );
  if (resultItems.length === 0) {
    if (hasKnownNoResultsSurface(results)) return [];
    throw new LocalWebSearchError("LOCAL_SEARCH_RESULT_SURFACE_UNRECOGNIZED");
  }

  return resultItems.slice(0, 100).map((item) => {
    const heading = findFirstElement(item, (element) => element.tagName === "h2");
    const anchor = heading ? findFirstElement(heading, (element) => element.tagName === "a") : null;
    const href = anchor ? attribute(anchor, "href") : null;
    const title = anchor ? normalizedText(anchor, 2_000) : "";
    if (!anchor || !href || title === "") {
      throw new LocalWebSearchError("LOCAL_SEARCH_RESULT_SURFACE_UNRECOGNIZED");
    }
    const excerpt = findFirstElement(item, (element) => element.tagName === "p");
    return {
      title,
      url: decodeBingResultUrl(href, origin).slice(0, 8_192),
      excerpt: excerpt ? normalizedText(excerpt, 8_000) : "",
      publishedAt: null,
    };
  });
}

function bingSettings(locale: string): {
  origin: BingHtmlSearchOrigin;
  market: string;
  setLanguage: string;
  acceptLanguage: string;
} {
  if (locale === "zh-CN") {
    return {
      origin: BING_CHINA_ORIGIN,
      market: "zh-CN",
      setLanguage: "zh-hans",
      acceptLanguage: "zh-CN,zh;q=0.9,en;q=0.5",
    };
  }
  if (locale === "zh-TW") {
    return {
      origin: BING_GLOBAL_ORIGIN,
      market: "zh-TW",
      setLanguage: "zh-hant",
      acceptLanguage: "zh-TW,zh;q=0.9,en;q=0.5",
    };
  }
  return {
    origin: BING_GLOBAL_ORIGIN,
    market: locale,
    setLanguage: locale,
    acceptLanguage: `${locale},en;q=0.8`,
  };
}

export class BingHtmlSearchProvider implements LocalSearchProvider {
  readonly descriptor = BING_HTML_SEARCH_PROVIDER_DESCRIPTOR;
  readonly #client: ControlledSearchHttpClient;
  readonly #userAgent: string;

  constructor(options: { client?: ControlledSearchHttpClient; userAgent?: string } = {}) {
    this.#client = options.client ?? new NodeControlledSearchHttpClient();
    this.#userAgent = options.userAgent ?? localWebSearchProductUserAgent();
  }

  async search(
    input: NormalizedLocalSearchQuery,
    context: { signal: AbortSignal; policy: LocalWebSearchPolicy },
  ): Promise<LocalWebSearchProviderResult> {
    const settings = bingSettings(context.policy.locale);
    const url = new URL(BING_SEARCH_PATH, settings.origin);
    url.searchParams.set("q", input.query);
    url.searchParams.set("mkt", settings.market);
    url.searchParams.set("setlang", settings.setLanguage);
    url.searchParams.set("adlt", context.policy.safeSearch);
    const response = await this.#client.get({
      url,
      allowedOrigins: BING_HTML_SEARCH_ORIGINS,
      allowedPaths: [BING_SEARCH_PATH],
      headers: {
        accept: "text/html,application/xhtml+xml;q=0.9",
        "accept-language": settings.acceptLanguage,
        dnt: "1",
        "sec-gpc": "1",
        "user-agent": this.#userAgent,
      },
      acceptedContentTypes: ["text/html"],
      maxResponseBytes: context.policy.maxResponseBytes,
      timeoutMs: context.policy.requestTimeoutMs,
      signal: context.signal,
    });
    return {
      providerId: this.descriptor.providerId,
      candidates: parseBingHtmlSearchResponse(response.text, settings.origin),
      recencyApplied: false,
      executionPerformed: true,
      responseBytes: response.responseBytes,
      durationMs: response.durationMs,
    };
  }
}
