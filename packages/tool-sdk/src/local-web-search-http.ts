import type { ClientRequest, IncomingMessage } from "node:http";
import { request as httpsRequest, type RequestOptions } from "node:https";
import type { ControlledEgressLookup } from "./brokered-bash-egress";
import { resolveControlledEgressTarget } from "./brokered-bash-egress";
import { LocalWebSearchError } from "./local-web-search";

export interface ControlledSearchHttpRequest {
  url: URL;
  allowedOrigins: readonly string[];
  allowedPaths: readonly string[];
  headers: Readonly<Record<string, string>>;
  acceptedContentTypes: readonly string[];
  maxResponseBytes: number;
  timeoutMs: number;
  signal: AbortSignal;
}

export interface ControlledSearchHttpResponse {
  statusCode: number;
  contentType: string;
  text: string;
  responseBytes: number;
  durationMs: number;
}

export interface ControlledSearchHttpClient {
  get(input: ControlledSearchHttpRequest): Promise<ControlledSearchHttpResponse>;
}

export type ControlledSearchRequestImplementation = (
  options: RequestOptions,
  callback: (response: IncomingMessage) => void,
) => ClientRequest;

const BLOCKED_REQUEST_HEADERS = new Set([
  "authorization",
  "cookie",
  "forwarded",
  "host",
  "proxy-authorization",
  "proxy-connection",
  "referer",
  "x-forwarded-for",
  "x-forwarded-host",
  "x-forwarded-proto",
]);

export function validateControlledSearchUrl(
  value: URL,
  allowedOrigins: readonly string[],
  allowedPaths: readonly string[],
): URL {
  if (
    value.protocol !== "https:" ||
    value.port !== "" ||
    value.username !== "" ||
    value.password !== "" ||
    value.hash !== "" ||
    !allowedOrigins.includes(value.origin) ||
    !allowedPaths.includes(value.pathname)
  ) {
    throw new LocalWebSearchError("LOCAL_SEARCH_POLICY_MISMATCH");
  }
  return value;
}

function contentTypeValue(response: IncomingMessage): string {
  const value = response.headers["content-type"];
  return (Array.isArray(value) ? value[0] : value)?.trim().toLocaleLowerCase() ?? "";
}

function contentLengthValue(response: IncomingMessage): number | null {
  const value = response.headers["content-length"];
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw || !/^\d+$/u.test(raw)) return null;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function responseError(statusCode: number): LocalWebSearchError {
  if (statusCode === 429) return new LocalWebSearchError("LOCAL_SEARCH_RATE_LIMITED");
  if (statusCode === 401 || statusCode === 403 || (statusCode >= 300 && statusCode < 400)) {
    return new LocalWebSearchError("LOCAL_SEARCH_PROVIDER_CHALLENGE");
  }
  return new LocalWebSearchError("LOCAL_SEARCH_PROVIDER_UNAVAILABLE");
}

function validatedHeaders(headers: Readonly<Record<string, string>>): Record<string, string> {
  const output: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    const normalizedName = name.trim().toLocaleLowerCase();
    if (
      !/^[a-z0-9-]+$/u.test(normalizedName) ||
      BLOCKED_REQUEST_HEADERS.has(normalizedName) ||
      value.includes("\r") ||
      value.includes("\n")
    ) {
      throw new LocalWebSearchError("LOCAL_SEARCH_POLICY_MISMATCH");
    }
    output[normalizedName] = value;
  }
  return output;
}

async function resolveSearchTarget(input: {
  hostname: string;
  timeoutMs: number;
  signal: AbortSignal;
  lookup?: ControlledEgressLookup;
}): Promise<Awaited<ReturnType<typeof resolveControlledEgressTarget>>> {
  return await new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      clearTimeout(timeout);
      input.signal.removeEventListener("abort", onAbort);
    };
    const finish = (target: Awaited<ReturnType<typeof resolveControlledEgressTarget>>) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(target);
    };
    const fail = (error: LocalWebSearchError) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const onAbort = () => fail(new LocalWebSearchError("LOCAL_SEARCH_CANCELLED"));
    const timeout = setTimeout(
      () => fail(new LocalWebSearchError("LOCAL_SEARCH_TIMEOUT")),
      input.timeoutMs,
    );
    input.signal.addEventListener("abort", onAbort, { once: true });
    void resolveControlledEgressTarget({
      hostname: input.hostname,
      port: 443,
      policy: { mode: "controlled_egress", allowedDomains: [input.hostname] },
      ...(input.lookup ? { lookup: input.lookup } : {}),
    }).then(finish, () => fail(new LocalWebSearchError("LOCAL_SEARCH_PROVIDER_UNAVAILABLE")));
  });
}

export class NodeControlledSearchHttpClient implements ControlledSearchHttpClient {
  readonly #lookup?: ControlledEgressLookup;
  readonly #request: ControlledSearchRequestImplementation;

  constructor(
    options: {
      lookup?: ControlledEgressLookup;
      request?: ControlledSearchRequestImplementation;
    } = {},
  ) {
    this.#lookup = options.lookup;
    this.#request =
      options.request ?? ((requestOptions, callback) => httpsRequest(requestOptions, callback));
  }

  async get(input: ControlledSearchHttpRequest): Promise<ControlledSearchHttpResponse> {
    if (input.signal.aborted) throw new LocalWebSearchError("LOCAL_SEARCH_CANCELLED");
    const startedAt = Date.now();
    const url = validateControlledSearchUrl(input.url, input.allowedOrigins, input.allowedPaths);
    const target = await resolveSearchTarget({
      hostname: url.hostname,
      timeoutMs: input.timeoutMs,
      signal: input.signal,
      ...(this.#lookup ? { lookup: this.#lookup } : {}),
    });
    if (input.signal.aborted) throw new LocalWebSearchError("LOCAL_SEARCH_CANCELLED");
    const remainingTimeoutMs = input.timeoutMs - (Date.now() - startedAt);
    if (remainingTimeoutMs <= 0) throw new LocalWebSearchError("LOCAL_SEARCH_TIMEOUT");
    const trustedHeaders = validatedHeaders(input.headers);
    const headers = {
      ...trustedHeaders,
      accept: trustedHeaders.accept ?? "*/*",
      "accept-encoding": "identity",
      connection: "close",
      host: url.hostname,
    };

    return await new Promise<ControlledSearchHttpResponse>((resolve, reject) => {
      let settled = false;
      let request: ClientRequest | null = null;
      let response: IncomingMessage | null = null;
      const finish = (result: ControlledSearchHttpResponse) => {
        if (settled) return;
        settled = true;
        input.signal.removeEventListener("abort", onAbort);
        resolve(result);
      };
      const fail = (error: unknown) => {
        if (settled) return;
        settled = true;
        input.signal.removeEventListener("abort", onAbort);
        reject(
          error instanceof LocalWebSearchError
            ? error
            : new LocalWebSearchError("LOCAL_SEARCH_PROVIDER_UNAVAILABLE"),
        );
      };
      const onAbort = () => {
        fail(new LocalWebSearchError("LOCAL_SEARCH_CANCELLED"));
        response?.destroy();
        request?.destroy();
      };
      request = this.#request(
        {
          protocol: "https:",
          hostname: target.address.address,
          port: 443,
          method: "GET",
          path: `${url.pathname}${url.search}`,
          headers,
          servername: target.hostname,
          rejectUnauthorized: true,
        },
        (incomingResponse) => {
          response = incomingResponse;
          if (settled) {
            incomingResponse.destroy();
            return;
          }
          const statusCode = incomingResponse.statusCode ?? 0;
          if (statusCode < 200 || statusCode >= 300) {
            fail(responseError(statusCode));
            incomingResponse.destroy();
            return;
          }
          const contentType = contentTypeValue(incomingResponse);
          const mediaType = contentType.split(";", 1)[0]?.trim() ?? "";
          if (!input.acceptedContentTypes.some((accepted) => mediaType === accepted)) {
            fail(new LocalWebSearchError("LOCAL_SEARCH_CONTENT_TYPE_INVALID"));
            incomingResponse.destroy();
            return;
          }
          const declaredLength = contentLengthValue(incomingResponse);
          if (declaredLength !== null && declaredLength > input.maxResponseBytes) {
            fail(new LocalWebSearchError("LOCAL_SEARCH_RESPONSE_TOO_LARGE"));
            incomingResponse.destroy();
            return;
          }
          const chunks: Buffer[] = [];
          let responseBytes = 0;
          incomingResponse.on("data", (chunk: Buffer | string) => {
            if (settled) return;
            const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
            responseBytes += buffer.length;
            if (responseBytes > input.maxResponseBytes) {
              fail(new LocalWebSearchError("LOCAL_SEARCH_RESPONSE_TOO_LARGE"));
              incomingResponse.destroy();
              return;
            }
            chunks.push(buffer);
          });
          incomingResponse.once("aborted", () =>
            fail(new LocalWebSearchError("LOCAL_SEARCH_PROVIDER_UNAVAILABLE")),
          );
          incomingResponse.once("error", fail);
          incomingResponse.once("end", () => {
            if (settled) return;
            try {
              const text = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks));
              finish({
                statusCode,
                contentType,
                text,
                responseBytes,
                durationMs: Date.now() - startedAt,
              });
            } catch {
              fail(new LocalWebSearchError("LOCAL_SEARCH_RESULT_PARSE_FAILED"));
            }
          });
        },
      );
      input.signal.addEventListener("abort", onAbort, { once: true });
      request.setTimeout(remainingTimeoutMs, () => {
        fail(new LocalWebSearchError("LOCAL_SEARCH_TIMEOUT"));
        response?.destroy();
        request?.destroy();
      });
      request.once("error", fail);
      request.end();
    });
  }
}
