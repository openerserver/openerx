import { EventEmitter } from "node:events";
import type { ClientRequest, IncomingMessage } from "node:http";
import type { RequestOptions } from "node:https";
import { Readable } from "node:stream";
import { defaultLocalWebSearchPolicy, type LocalWebSearchPolicy } from "@openerx/contracts";
import { describe, expect, it, vi } from "vitest";
import {
  BaiduJsonSearchProvider,
  type ControlledSearchHttpClient,
  type ControlledSearchRequestImplementation,
  FakeLocalWebSearchProvider,
  freezeLocalWebSearchPolicy,
  type LocalSearchProvider,
  LocalWebSearchCoordinator,
  LocalWebSearchError,
  localWebSearchPolicyDigest,
  NodeControlledSearchHttpClient,
  parseBaiduJsonSearchResponse,
  validateControlledSearchUrl,
} from "../src";

function policy(overrides: Partial<LocalWebSearchPolicy> = {}): LocalWebSearchPolicy {
  return { ...defaultLocalWebSearchPolicy(), ...overrides };
}

function responseFixture(): string {
  return JSON.stringify({
    feed: {
      entry: [
        { type: "metadata" },
        {
          title: "<em>OpenERX</em> &amp; docs",
          url: "https://docs.example.com/current#section",
          abs: "Current <em>local</em> search &quot;result&quot;",
          time: 1_787_954_400,
        },
        {
          title: "Private target",
          url: "http://127.0.0.1/admin",
          abs: "must be rejected",
        },
        {
          title: "Private IPv6 target",
          url: "http://[::1]/admin",
          abs: "must also be rejected",
        },
        {
          title: "Out of scope",
          url: "https://other.example.net/result",
          abs: "must be filtered",
        },
      ],
    },
  });
}

function requestFixture(input: {
  statusCode: number;
  headers: Record<string, string>;
  chunks?: string[];
}): {
  request: ControlledSearchRequestImplementation;
  options: () => RequestOptions | null;
} {
  let capturedOptions: RequestOptions | null = null;
  const request: ControlledSearchRequestImplementation = (options, callback) => {
    capturedOptions = options;
    const client = new EventEmitter() as EventEmitter & {
      setTimeout: ReturnType<typeof vi.fn>;
      end: ReturnType<typeof vi.fn>;
      destroy: ReturnType<typeof vi.fn>;
    };
    client.setTimeout = vi.fn(() => client);
    client.destroy = vi.fn(() => client);
    client.end = vi.fn(() => {
      queueMicrotask(() => {
        const response = Readable.from(input.chunks ?? []) as IncomingMessage;
        response.statusCode = input.statusCode;
        response.headers = input.headers;
        callback(response);
      });
      return client;
    });
    return client as unknown as ClientRequest;
  };
  return { request, options: () => capturedOptions };
}

describe("lightweight local Web Search", () => {
  it("freezes and digests the trusted policy", () => {
    const configuration = freezeLocalWebSearchPolicy(policy());
    expect(configuration.policyDigest).toBe(localWebSearchPolicyDigest(configuration.policy));
    expect(Object.isFrozen(configuration)).toBe(true);
    expect(Object.isFrozen(configuration.policy)).toBe(true);
    expect(Object.isFrozen(configuration.policy.providerOrder)).toBe(true);
  });

  it("rejects arbitrary origins and paths before network execution", () => {
    expect(() =>
      validateControlledSearchUrl(
        new URL("https://attacker.example/s?wd=test"),
        ["https://www.baidu.com"],
        ["/s"],
      ),
    ).toThrow("LOCAL_SEARCH_POLICY_MISMATCH");
    expect(() =>
      validateControlledSearchUrl(
        new URL("https://www.baidu.com/private?wd=test"),
        ["https://www.baidu.com"],
        ["/s"],
      ),
    ).toThrow("LOCAL_SEARCH_POLICY_MISMATCH");
  });

  it("pins the approved public address and enforces response type and size", async () => {
    const okRequest = requestFixture({
      statusCode: 200,
      headers: { "content-type": "application/json;charset=utf-8" },
      chunks: ['{"feed":{"entry":[]}}'],
    });
    const client = new NodeControlledSearchHttpClient({
      lookup: async () => [{ address: "93.184.216.34", family: 4 }],
      request: okRequest.request,
    });
    const response = await client.get({
      url: new URL("https://www.baidu.com/s?wd=fixture&tn=json"),
      allowedOrigins: ["https://www.baidu.com"],
      allowedPaths: ["/s"],
      headers: { accept: "application/json", "user-agent": "OpenerX-Test/2.0" },
      acceptedContentTypes: ["application/json"],
      maxResponseBytes: 1_024,
      timeoutMs: 1_000,
      signal: new AbortController().signal,
    });
    expect(response.text).toBe('{"feed":{"entry":[]}}');
    expect(okRequest.options()).toMatchObject({
      hostname: "93.184.216.34",
      servername: "www.baidu.com",
      path: "/s?wd=fixture&tn=json",
      headers: expect.objectContaining({
        host: "www.baidu.com",
        "accept-encoding": "identity",
      }),
    });

    const largeRequest = requestFixture({
      statusCode: 200,
      headers: { "content-type": "application/json", "content-length": "2048" },
    });
    const largeClient = new NodeControlledSearchHttpClient({
      lookup: async () => [{ address: "93.184.216.34", family: 4 }],
      request: largeRequest.request,
    });
    await expect(
      largeClient.get({
        url: new URL("https://www.baidu.com/s?wd=fixture&tn=json"),
        allowedOrigins: ["https://www.baidu.com"],
        allowedPaths: ["/s"],
        headers: { accept: "application/json" },
        acceptedContentTypes: ["application/json"],
        maxResponseBytes: 1_024,
        timeoutMs: 1_000,
        signal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({ code: "LOCAL_SEARCH_RESPONSE_TOO_LARGE" });

    const wrongTypeRequest = requestFixture({
      statusCode: 200,
      headers: { "content-type": "application/jsonp" },
      chunks: ["callback({})"],
    });
    const wrongTypeClient = new NodeControlledSearchHttpClient({
      lookup: async () => [{ address: "93.184.216.34", family: 4 }],
      request: wrongTypeRequest.request,
    });
    await expect(
      wrongTypeClient.get({
        url: new URL("https://www.baidu.com/s?wd=fixture&tn=json"),
        allowedOrigins: ["https://www.baidu.com"],
        allowedPaths: ["/s"],
        headers: { accept: "application/json" },
        acceptedContentTypes: ["application/json"],
        maxResponseBytes: 1_024,
        timeoutMs: 1_000,
        signal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({ code: "LOCAL_SEARCH_CONTENT_TYPE_INVALID" });
  });

  it("bounds DNS resolution with the same timeout and AbortSignal", async () => {
    const neverLookup = async () => await new Promise<never>(() => undefined);
    const client = new NodeControlledSearchHttpClient({ lookup: neverLookup });
    const request = (signal: AbortSignal, timeoutMs: number) =>
      client.get({
        url: new URL("https://www.baidu.com/s?wd=fixture&tn=json"),
        allowedOrigins: ["https://www.baidu.com"],
        allowedPaths: ["/s"],
        headers: { accept: "application/json" },
        acceptedContentTypes: ["application/json"],
        maxResponseBytes: 1_024,
        timeoutMs,
        signal,
      });

    await expect(request(new AbortController().signal, 20)).rejects.toMatchObject({
      code: "LOCAL_SEARCH_TIMEOUT",
    });
    const controller = new AbortController();
    const pending = request(controller.signal, 1_000);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: "LOCAL_SEARCH_CANCELLED" });
  });

  it("executes one Baidu JSON request and projects identical model/UI sources", async () => {
    const get = vi.fn<ControlledSearchHttpClient["get"]>(async (_request) => ({
      statusCode: 200,
      contentType: "application/json;charset=utf-8",
      text: responseFixture(),
      responseBytes: 4_191,
      durationMs: 220,
    }));
    const provider = new BaiduJsonSearchProvider({
      client: { get },
      userAgent: "OpenerX-Test/2.0",
      now: () => Date.parse("2026-08-29T00:00:00.000Z"),
    });
    const coordinator = new LocalWebSearchCoordinator([provider]);
    const configuration = freezeLocalWebSearchPolicy(policy({ maxCallsPerTurn: 1 }));
    const result = await coordinator.search({
      generationId: "generation-search-0001",
      query: "  OpenERX  ",
      recencyDays: 7,
      domains: ["example.com"],
      configuration,
      signal: new AbortController().signal,
    });

    expect(get).toHaveBeenCalledTimes(1);
    const request = get.mock.calls[0]?.[0];
    expect(request?.url.origin).toBe("https://www.baidu.com");
    expect(request?.url.pathname).toBe("/s");
    expect(request?.url.searchParams.get("wd")).toBe("OpenERX");
    expect(request?.url.searchParams.get("tn")).toBe("json");
    expect(request?.url.searchParams.get("gpc")).toBe("stf=1787356800,1787961600|stftype=1");
    expect(result.sources).toEqual([
      {
        title: "OpenERX & docs",
        url: "https://docs.example.com/current",
        publishedAt: "2026-08-28T22:00:00.000Z",
        retrievedAt: expect.any(String),
        excerpt: 'Current local search "result"',
      },
    ]);
    expect(result.content.filter(({ type }) => type === "source")).toEqual([
      { type: "source", source: result.sources[0] },
    ]);
    expect(result).toMatchObject({
      sideEffectCommitted: false,
      data: {
        contractVersion: "local_web_search_v2",
        executionPerformed: true,
        providerId: "direct:baidu-json",
        recencyApplied: true,
        resultCount: 1,
      },
    });
    await expect(
      coordinator.search({
        generationId: "generation-search-0001",
        query: "second call",
        configuration,
        signal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({ code: "LOCAL_SEARCH_CALL_BUDGET_EXCEEDED" });
  });

  it("reuses identical searches inside one Generation and clears the turn cache", async () => {
    const search = vi.fn<LocalSearchProvider["search"]>(async () => ({
      providerId: "direct:baidu-json",
      candidates: [
        {
          title: "Cached source",
          url: "https://example.com/cached",
          excerpt: "one provider request",
          publishedAt: null,
        },
      ],
      recencyApplied: false,
      executionPerformed: true,
      responseBytes: 256,
      durationMs: 10,
    }));
    const provider: LocalSearchProvider = {
      descriptor: {
        providerId: "direct:baidu-json",
        displayName: "cache fixture",
        transport: "json",
        stability: "unofficial",
        releaseEligible: false,
        requiresDailyProbe: true,
      },
      search,
    };
    const coordinator = new LocalWebSearchCoordinator([provider]);
    const configuration = freezeLocalWebSearchPolicy(policy({ maxCallsPerTurn: 3 }));
    const input = {
      generationId: "generation-search-cache",
      query: "OpenERX",
      configuration,
      signal: new AbortController().signal,
    };

    const first = await coordinator.search(input);
    const second = await coordinator.search(input);
    expect(search).toHaveBeenCalledTimes(1);
    expect(first.data).toMatchObject({ cacheMode: "turn", cacheHit: false });
    expect(second.data).toMatchObject({ cacheMode: "turn", cacheHit: true });
    expect(second.sources).toEqual(first.sources);

    coordinator.clearGeneration(input.generationId);
    await coordinator.search(input);
    expect(search).toHaveBeenCalledTimes(2);
  });

  it("fails closed on fake execution, challenge payloads, and schema drift", async () => {
    const fakeCoordinator = new LocalWebSearchCoordinator([new FakeLocalWebSearchProvider()]);
    const configuration = freezeLocalWebSearchPolicy(policy());
    expect(fakeCoordinator.readiness(configuration)).toMatchObject({
      available: false,
      reason: "LOCAL_SEARCH_FAKE_PROVIDER_ONLY",
    });
    await expect(
      fakeCoordinator.search({
        generationId: "generation-search-fake",
        query: "fixture",
        configuration,
        signal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({ code: "LOCAL_SEARCH_FAKE_PROVIDER_ONLY" });
    expect(() => parseBaiduJsonSearchResponse('{"antiFlag":1,"feed":{"entry":[]}}')).toThrow(
      "LOCAL_SEARCH_PROVIDER_CHALLENGE",
    );
    expect(() => parseBaiduJsonSearchResponse('{"antiFlag":"1","feed":{"entry":[]}}')).toThrow(
      "LOCAL_SEARCH_PROVIDER_CHALLENGE",
    );
    expect(() => parseBaiduJsonSearchResponse('{"unexpected":true}')).toThrow(
      "LOCAL_SEARCH_RESULT_SURFACE_UNRECOGNIZED",
    );
  });

  it("detects policy mutation even if an untrusted caller bypasses the frozen type", () => {
    const configuration = freezeLocalWebSearchPolicy(policy());
    const tampered = {
      policy: { ...configuration.policy, maxCallsPerTurn: 9 },
      policyDigest: configuration.policyDigest,
    };
    const coordinator = new LocalWebSearchCoordinator([new FakeLocalWebSearchProvider()]);
    expect(() => coordinator.readiness(tampered)).toThrowError(LocalWebSearchError);
    expect(() => coordinator.readiness(tampered)).toThrow("LOCAL_SEARCH_POLICY_MISMATCH");
    expect(() =>
      coordinator.readiness(freezeLocalWebSearchPolicy(policy({ cacheMode: "local_ttl" }))),
    ).toThrow("LOCAL_SEARCH_POLICY_MISMATCH");
  });
});
