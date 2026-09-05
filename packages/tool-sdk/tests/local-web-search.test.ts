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
    expect(localWebSearchPolicyDigest(policy({ locale: "en-US" }))).not.toBe(
      configuration.policyDigest,
    );
    expect(localWebSearchPolicyDigest(policy({ safeSearch: "strict" }))).not.toBe(
      configuration.policyDigest,
    );
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
      headers: { accept: "application/json", "user-agent": "OpenERX-Test/2.0" },
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

  it("does not follow search redirects and preserves rate-limit failures", async () => {
    const request = async (statusCode: number) => {
      const fixture = requestFixture({
        statusCode,
        headers: {
          "content-type": "text/html;charset=utf-8",
          location: "https://cn.bing.com/search?q=fixture",
        },
      });
      const client = new NodeControlledSearchHttpClient({
        lookup: async () => [{ address: "93.184.216.34", family: 4 }],
        request: fixture.request,
      });
      return client.get({
        url: new URL("https://www.bing.com/search?q=fixture"),
        allowedOrigins: ["https://www.bing.com"],
        allowedPaths: ["/search"],
        headers: { accept: "text/html" },
        acceptedContentTypes: ["text/html"],
        maxResponseBytes: 1_024,
        timeoutMs: 1_000,
        signal: new AbortController().signal,
      });
    };

    await expect(request(302)).rejects.toMatchObject({
      code: "LOCAL_SEARCH_PROVIDER_CHALLENGE",
    });
    await expect(request(429)).rejects.toMatchObject({ code: "LOCAL_SEARCH_RATE_LIMITED" });
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

  it("destroys an in-flight response and cannot commit late data after Stop", async () => {
    const response = new Readable({ read: () => undefined }) as IncomingMessage;
    response.statusCode = 200;
    response.headers = { "content-type": "application/json" };
    let responseStarted: (() => void) | null = null;
    const started = new Promise<void>((resolve) => {
      responseStarted = resolve;
    });
    const requestEmitter = new EventEmitter() as EventEmitter & {
      setTimeout: ReturnType<typeof vi.fn>;
      end: ReturnType<typeof vi.fn>;
      destroy: ReturnType<typeof vi.fn>;
    };
    requestEmitter.setTimeout = vi.fn(() => requestEmitter);
    requestEmitter.destroy = vi.fn(() => {
      requestEmitter.emit("error", new Error("socket destroyed"));
      return requestEmitter;
    });
    requestEmitter.end = vi.fn(() => {
      queueMicrotask(() => {
        callback?.(response);
        responseStarted?.();
      });
      return requestEmitter;
    });
    let callback: ((incoming: IncomingMessage) => void) | null = null;
    const client = new NodeControlledSearchHttpClient({
      lookup: async () => [{ address: "93.184.216.34", family: 4 }],
      request: (_options, incomingCallback) => {
        callback = incomingCallback;
        return requestEmitter as unknown as ClientRequest;
      },
    });
    const controller = new AbortController();
    const pending = client.get({
      url: new URL("https://www.baidu.com/s?wd=fixture&tn=json"),
      allowedOrigins: ["https://www.baidu.com"],
      allowedPaths: ["/s"],
      headers: { accept: "application/json" },
      acceptedContentTypes: ["application/json"],
      maxResponseBytes: 1_024,
      timeoutMs: 1_000,
      signal: controller.signal,
    });

    await started;
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: "LOCAL_SEARCH_CANCELLED" });
    expect(requestEmitter.destroy).toHaveBeenCalledTimes(1);
    expect(response.destroyed).toBe(true);
    expect(response.push('{"feed":{"entry":[]}}')).toBe(false);
  });

  it("does not impose a per-turn call-count cap on distinct Baidu JSON searches", async () => {
    const get = vi.fn<ControlledSearchHttpClient["get"]>(async (_request) => ({
      statusCode: 200,
      contentType: "application/json;charset=utf-8",
      text: responseFixture(),
      responseBytes: 4_191,
      durationMs: 220,
    }));
    const provider = new BaiduJsonSearchProvider({
      client: { get },
      userAgent: "OpenERX-Test/2.0",
      now: () => Date.parse("2026-08-29T00:00:00.000Z"),
    });
    const coordinator = new LocalWebSearchCoordinator([provider]);
    const configuration = freezeLocalWebSearchPolicy(policy());
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
    const additional = await Promise.all(
      ["second angle", "third angle", "fourth angle", "fifth angle"].map((query) =>
        coordinator.search({
          generationId: "generation-search-0001",
          query,
          configuration,
          signal: new AbortController().signal,
        }),
      ),
    );
    expect(additional).toHaveLength(4);
    expect(additional).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ data: expect.objectContaining({ executionPerformed: true }) }),
      ]),
    );
    expect(get).toHaveBeenCalledTimes(5);
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
    const configuration = freezeLocalWebSearchPolicy(policy());
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
    expect(first.summary).toContain("· live ·");
    expect(second.summary).toContain("· turn cache ·");
    expect(second.content.find(({ type }) => type === "text")).toMatchObject({
      text: expect.stringContaining("Execution: turn cache"),
    });
    expect(second.sources).toEqual(first.sources);

    coordinator.clearGeneration(input.generationId);
    await coordinator.search(input);
    expect(search).toHaveBeenCalledTimes(2);
  });

  it.each([
    "LOCAL_SEARCH_PROVIDER_CHALLENGE",
    "LOCAL_SEARCH_TIMEOUT",
    "LOCAL_SEARCH_RATE_LIMITED",
  ] as const)("falls back after %s and marks the result as partial", async (errorCode) => {
    const baiduSearch = vi.fn<LocalSearchProvider["search"]>(async () => {
      throw new LocalWebSearchError(errorCode);
    });
    const bingSearch = vi.fn<LocalSearchProvider["search"]>(async () => ({
      providerId: "direct:bing-html",
      candidates: [
        {
          title: "Fallback source",
          url: "https://example.com/fallback",
          excerpt: "second provider",
          publishedAt: null,
        },
      ],
      recencyApplied: false,
      executionPerformed: true,
      responseBytes: 128,
      durationMs: 8,
    }));
    const coordinator = new LocalWebSearchCoordinator([
      {
        descriptor: {
          providerId: "direct:baidu-json",
          displayName: "Baidu fixture",
          transport: "json",
          stability: "unofficial",
          releaseEligible: false,
          requiresDailyProbe: true,
        },
        search: baiduSearch,
      },
      {
        descriptor: {
          providerId: "direct:bing-html",
          displayName: "Bing fixture",
          transport: "html",
          stability: "unofficial",
          releaseEligible: false,
          requiresDailyProbe: true,
        },
        search: bingSearch,
      },
    ]);
    const configuration = freezeLocalWebSearchPolicy(
      policy({
        providerOrder: ["direct:baidu-json", "direct:bing-html"],
        allowProviderFallback: true,
      }),
    );
    const result = await coordinator.search({
      generationId: "generation-explicit-fallback",
      query: "OpenERX",
      configuration,
      signal: new AbortController().signal,
    });

    expect(baiduSearch).toHaveBeenCalledTimes(1);
    expect(bingSearch).toHaveBeenCalledTimes(1);
    expect(result.summary).toContain("· partial");
    expect(result.data).toMatchObject({
      providerId: "direct:bing-html",
      executionMode: "live",
      partial: true,
      attempts: [
        { providerId: "direct:baidu-json", status: "failed" },
        { providerId: "direct:bing-html", status: "completed" },
      ],
    });
  });

  it("backs off after consecutive throttle failures and recovers after the window", async () => {
    let now = Date.parse("2026-08-29T02:00:00.000Z");
    const search = vi
      .fn<LocalSearchProvider["search"]>()
      .mockRejectedValueOnce(new LocalWebSearchError("LOCAL_SEARCH_PROVIDER_CHALLENGE"))
      .mockRejectedValueOnce(new LocalWebSearchError("LOCAL_SEARCH_RATE_LIMITED"))
      .mockResolvedValue({
        providerId: "direct:baidu-json",
        candidates: [
          {
            title: "Recovered source",
            url: "https://example.com/recovered",
            excerpt: "provider recovered",
            publishedAt: null,
          },
        ],
        recencyApplied: false,
        executionPerformed: true,
        responseBytes: 100,
        durationMs: 5,
      });
    const provider: LocalSearchProvider = {
      descriptor: {
        providerId: "direct:baidu-json",
        displayName: "backoff fixture",
        transport: "json",
        stability: "unofficial",
        releaseEligible: false,
        requiresDailyProbe: true,
      },
      search,
    };
    const coordinator = new LocalWebSearchCoordinator([provider], {
      now: () => now,
      backoffMs: 30 * 60 * 1_000,
    });
    const configuration = freezeLocalWebSearchPolicy(
      policy({ providerOrder: ["direct:baidu-json"], allowProviderFallback: false }),
    );
    const execute = (generationId: string) =>
      coordinator.search({
        generationId,
        query: "OpenERX",
        configuration,
        signal: new AbortController().signal,
      });

    await expect(execute("generation-throttle-1")).rejects.toMatchObject({
      code: "LOCAL_SEARCH_PROVIDER_CHALLENGE",
    });
    expect(coordinator.providerStates(configuration)[0]).toMatchObject({
      status: "available",
      consecutiveThrottleFailures: 1,
    });
    await expect(execute("generation-throttle-2")).rejects.toMatchObject({
      code: "LOCAL_SEARCH_RATE_LIMITED",
    });
    expect(coordinator.providerStates(configuration)[0]).toMatchObject({
      status: "backed_off",
      consecutiveThrottleFailures: 2,
      lastErrorCode: "LOCAL_SEARCH_RATE_LIMITED",
    });
    expect(coordinator.readiness(configuration)).toMatchObject({
      available: false,
      reason: "LOCAL_SEARCH_PROVIDER_UNAVAILABLE",
    });
    await expect(execute("generation-throttle-3")).rejects.toMatchObject({
      code: "LOCAL_SEARCH_PROVIDER_UNAVAILABLE",
    });
    expect(search).toHaveBeenCalledTimes(2);

    now += 30 * 60 * 1_000 + 1;
    expect(coordinator.readiness(configuration).available).toBe(true);
    await expect(execute("generation-throttle-4")).resolves.toMatchObject({
      data: { executionMode: "live", partial: false },
    });
    expect(coordinator.providerStates(configuration)[0]).toMatchObject({
      status: "available",
      consecutiveThrottleFailures: 0,
      lastErrorCode: null,
      lastSuccessAt: new Date(now).toISOString(),
    });
  });

  it("blocks a drifted result surface until the trusted runtime reset", async () => {
    const search = vi
      .fn<LocalSearchProvider["search"]>()
      .mockRejectedValueOnce(new LocalWebSearchError("LOCAL_SEARCH_RESULT_SURFACE_UNRECOGNIZED"))
      .mockResolvedValue({
        providerId: "direct:baidu-json",
        candidates: [
          {
            title: "Reset source",
            url: "https://example.com/reset",
            excerpt: "manual reset",
            publishedAt: null,
          },
        ],
        recencyApplied: false,
        executionPerformed: true,
        responseBytes: 100,
        durationMs: 5,
      });
    const provider: LocalSearchProvider = {
      descriptor: {
        providerId: "direct:baidu-json",
        displayName: "schema fixture",
        transport: "json",
        stability: "unofficial",
        releaseEligible: false,
        requiresDailyProbe: true,
      },
      search,
    };
    const coordinator = new LocalWebSearchCoordinator([provider]);
    const configuration = freezeLocalWebSearchPolicy(
      policy({ providerOrder: ["direct:baidu-json"], allowProviderFallback: false }),
    );
    const execute = (generationId: string) =>
      coordinator.search({
        generationId,
        query: "OpenERX",
        configuration,
        signal: new AbortController().signal,
      });

    await expect(execute("generation-schema-1")).rejects.toMatchObject({
      code: "LOCAL_SEARCH_RESULT_SURFACE_UNRECOGNIZED",
    });
    expect(coordinator.providerStates(configuration)[0]).toMatchObject({
      status: "schema_blocked",
    });
    await expect(execute("generation-schema-2")).rejects.toMatchObject({
      code: "LOCAL_SEARCH_PROVIDER_UNAVAILABLE",
    });
    expect(search).toHaveBeenCalledTimes(1);

    coordinator.resetRuntimeState("direct:baidu-json");
    expect(coordinator.providerStates(configuration)[0]).toMatchObject({ status: "available" });
    await expect(execute("generation-schema-3")).resolves.toMatchObject({
      data: { executionMode: "live" },
    });
    expect(search).toHaveBeenCalledTimes(2);
  });

  it("fails closed on fake execution, challenge payloads, and schema drift", async () => {
    const fakeCoordinator = new LocalWebSearchCoordinator([new FakeLocalWebSearchProvider()]);
    const configuration = freezeLocalWebSearchPolicy(
      policy({ providerOrder: ["direct:baidu-json"], allowProviderFallback: false }),
    );
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
      policy: { ...configuration.policy, maxResultsPerCall: 9 },
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
