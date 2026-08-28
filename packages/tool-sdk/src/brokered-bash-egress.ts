import { createHash } from "node:crypto";
import { lookup as dnsLookup } from "node:dns/promises";
import { createServer, request as httpRequest, type IncomingMessage } from "node:http";
import { request as httpsRequest } from "node:https";
import net, { type AddressInfo, isIP } from "node:net";
import type { Duplex } from "node:stream";
import { domainToASCII } from "node:url";

export interface BrokeredBashControlledEgressPolicy {
  mode: "controlled_egress";
  allowedDomains: string[];
}

export type BrokeredBashNetworkPolicy = { mode: "deny" } | BrokeredBashControlledEgressPolicy;

export interface ControlledEgressAddress {
  address: string;
  family: 4 | 6;
}

export type ControlledEgressLookup = (hostname: string) => Promise<ControlledEgressAddress[]>;

const MAX_ALLOWED_DOMAINS = 128;
const MAX_REQUEST_TARGET_BYTES = 8_192;
const MAX_TLS_CLIENT_HELLO_BYTES = 65_536;
const TLS_CLIENT_HELLO_TIMEOUT_MS = 5_000;
const BLOCKED_REQUEST_HEADERS = new Set([
  "proxy-authorization",
  "proxy-connection",
  "forwarded",
  "x-forwarded-for",
  "x-forwarded-host",
  "x-forwarded-proto",
]);

function normalizeDomain(value: string): string {
  const wildcard = value.startsWith("*.");
  const candidate = wildcard ? value.slice(2) : value;
  const ascii = domainToASCII(candidate.trim().replace(/\.$/u, "")).toLocaleLowerCase();
  if (
    !ascii ||
    ascii.length > 253 ||
    isIP(ascii) !== 0 ||
    !ascii.includes(".") ||
    ascii.split(".").some((label) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u.test(label))
  ) {
    throw new Error("BROKERED_BASH_EGRESS_POLICY_INVALID");
  }
  return wildcard ? `*.${ascii}` : ascii;
}

export function normalizeControlledEgressPolicy(
  policy: BrokeredBashControlledEgressPolicy,
): BrokeredBashControlledEgressPolicy {
  if (policy.allowedDomains.length === 0 || policy.allowedDomains.length > MAX_ALLOWED_DOMAINS) {
    throw new Error("BROKERED_BASH_EGRESS_POLICY_INVALID");
  }
  return {
    mode: "controlled_egress",
    allowedDomains: [...new Set(policy.allowedDomains.map(normalizeDomain))].sort(),
  };
}

export function brokeredBashNetworkPolicyDigest(policy: BrokeredBashNetworkPolicy): string {
  const normalized = policy.mode === "deny" ? policy : normalizeControlledEgressPolicy(policy);
  return `sha256:${createHash("sha256").update(JSON.stringify(normalized)).digest("hex")}`;
}

function domainAllowed(hostname: string, allowedDomains: string[]): boolean {
  return allowedDomains.some((allowed) =>
    allowed.startsWith("*.")
      ? hostname.endsWith(allowed.slice(1)) && hostname !== allowed.slice(2)
      : hostname === allowed,
  );
}

function parseIPv4(address: string): number[] | null {
  const octets = address.split(".").map(Number);
  return octets.length === 4 &&
    octets.every((octet) => Number.isInteger(octet) && octet >= 0 && octet <= 255)
    ? octets
    : null;
}

export function isPublicEgressAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) {
    const octets = parseIPv4(address);
    if (!octets) return false;
    const [a = 0, b = 0] = octets;
    return !(
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 0) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    );
  }
  if (family !== 6) return false;
  const normalized = address.toLocaleLowerCase();
  if (normalized === "::" || normalized === "::1") return false;
  if (normalized.startsWith("::ffff:")) {
    return isPublicEgressAddress(normalized.slice("::ffff:".length));
  }
  const first = Number.parseInt(normalized.split(":", 1)[0] || "0", 16);
  return !(
    (first & 0xfe00) === 0xfc00 ||
    (first & 0xffc0) === 0xfe80 ||
    (first & 0xff00) === 0xff00 ||
    normalized.startsWith("2001:db8:")
  );
}

async function defaultLookup(hostname: string): Promise<ControlledEgressAddress[]> {
  const addresses = await dnsLookup(hostname, { all: true, verbatim: true });
  return addresses.flatMap(({ address, family }) =>
    family === 4 || family === 6 ? [{ address, family }] : [],
  );
}

export async function resolveControlledEgressTarget(input: {
  hostname: string;
  port: number;
  policy: BrokeredBashControlledEgressPolicy;
  lookup?: ControlledEgressLookup;
}): Promise<{
  hostname: string;
  port: number;
  address: ControlledEgressAddress;
}> {
  const policy = normalizeControlledEgressPolicy(input.policy);
  const hostname = normalizeDomain(input.hostname);
  if (!domainAllowed(hostname, policy.allowedDomains)) {
    throw new Error("BROKERED_BASH_EGRESS_DOMAIN_DENIED");
  }
  if (input.port !== 80 && input.port !== 443) {
    throw new Error("BROKERED_BASH_EGRESS_PORT_DENIED");
  }
  const addresses = await (input.lookup ?? defaultLookup)(hostname);
  if (
    addresses.length === 0 ||
    addresses.some(
      ({ address, family }) => isIP(address) !== family || !isPublicEgressAddress(address),
    )
  ) {
    throw new Error("BROKERED_BASH_EGRESS_ADDRESS_DENIED");
  }
  const address = addresses[0];
  if (!address) throw new Error("BROKERED_BASH_EGRESS_ADDRESS_DENIED");
  return { hostname, port: input.port, address };
}

function filteredHeaders(
  request: IncomingMessage,
  hostname: string,
): Record<string, string | string[]> {
  const headers: Record<string, string | string[]> = { host: hostname };
  for (const [name, value] of Object.entries(request.headers)) {
    if (value === undefined || name === "host" || BLOCKED_REQUEST_HEADERS.has(name)) continue;
    headers[name] = value;
  }
  return headers;
}

function readUInt24(buffer: Buffer, offset: number): number {
  return (
    (buffer[offset] ?? 0) * 65_536 + (buffer[offset + 1] ?? 0) * 256 + (buffer[offset + 2] ?? 0)
  );
}

export function tlsClientHelloServerName(buffer: Buffer): string | undefined {
  const handshakeParts: Buffer[] = [];
  let offset = 0;
  while (offset + 5 <= buffer.length) {
    if (buffer[offset] !== 22) throw new Error("BROKERED_BASH_EGRESS_TLS_REQUIRED");
    const recordLength = buffer.readUInt16BE(offset + 3);
    if (offset + 5 + recordLength > buffer.length) return undefined;
    handshakeParts.push(buffer.subarray(offset + 5, offset + 5 + recordLength));
    offset += 5 + recordLength;
  }
  const handshake = Buffer.concat(handshakeParts);
  if (handshake.length < 4) return undefined;
  if (handshake[0] !== 1) throw new Error("BROKERED_BASH_EGRESS_TLS_REQUIRED");
  const helloLength = readUInt24(handshake, 1);
  if (handshake.length < 4 + helloLength) return undefined;
  const end = 4 + helloLength;
  let cursor = 4 + 2 + 32;
  const requireBytes = (count: number) => {
    if (cursor + count > end) throw new Error("BROKERED_BASH_EGRESS_TLS_INVALID");
  };
  requireBytes(1);
  cursor += 1 + (handshake[cursor] ?? 0);
  requireBytes(2);
  cursor += 2 + handshake.readUInt16BE(cursor);
  requireBytes(1);
  cursor += 1 + (handshake[cursor] ?? 0);
  requireBytes(2);
  const extensionsEnd = cursor + 2 + handshake.readUInt16BE(cursor);
  cursor += 2;
  if (extensionsEnd > end) throw new Error("BROKERED_BASH_EGRESS_TLS_INVALID");
  while (cursor + 4 <= extensionsEnd) {
    const type = handshake.readUInt16BE(cursor);
    const length = handshake.readUInt16BE(cursor + 2);
    cursor += 4;
    if (cursor + length > extensionsEnd) throw new Error("BROKERED_BASH_EGRESS_TLS_INVALID");
    if (type === 0) {
      if (length < 5) throw new Error("BROKERED_BASH_EGRESS_TLS_INVALID");
      const listEnd = cursor + 2 + handshake.readUInt16BE(cursor);
      let nameCursor = cursor + 2;
      if (listEnd > cursor + length) throw new Error("BROKERED_BASH_EGRESS_TLS_INVALID");
      while (nameCursor + 3 <= listEnd) {
        const nameType = handshake[nameCursor] ?? 255;
        const nameLength = handshake.readUInt16BE(nameCursor + 1);
        nameCursor += 3;
        if (nameCursor + nameLength > listEnd) throw new Error("BROKERED_BASH_EGRESS_TLS_INVALID");
        if (nameType === 0) {
          return normalizeDomain(
            handshake.subarray(nameCursor, nameCursor + nameLength).toString("ascii"),
          );
        }
        nameCursor += nameLength;
      }
    }
    cursor += length;
  }
  throw new Error("BROKERED_BASH_EGRESS_TLS_SNI_REQUIRED");
}

async function readTlsClientHello(
  client: Duplex,
  head: Buffer,
): Promise<{ serverName: string; bytes: Buffer }> {
  return await new Promise((resolve, reject) => {
    let buffer = Buffer.from(head);
    const cleanup = () => {
      clearTimeout(timeout);
      client.off("data", onData);
      client.off("error", onError);
      client.off("close", onClose);
    };
    const inspect = () => {
      if (buffer.length > MAX_TLS_CLIENT_HELLO_BYTES) {
        cleanup();
        reject(new Error("BROKERED_BASH_EGRESS_TLS_INVALID"));
        return;
      }
      try {
        const serverName = tlsClientHelloServerName(buffer);
        if (serverName) {
          cleanup();
          resolve({ serverName, bytes: buffer });
        }
      } catch (error) {
        cleanup();
        reject(error);
      }
    };
    const onData = (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);
      inspect();
    };
    const onError = () => {
      cleanup();
      reject(new Error("BROKERED_BASH_EGRESS_TLS_INVALID"));
    };
    const onClose = () => {
      cleanup();
      reject(new Error("BROKERED_BASH_EGRESS_TLS_INVALID"));
    };
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error("BROKERED_BASH_EGRESS_TLS_INVALID"));
    }, TLS_CLIENT_HELLO_TIMEOUT_MS);
    client.on("data", onData);
    client.once("error", onError);
    client.once("close", onClose);
    inspect();
  });
}

export class BrokeredBashControlledEgressProxy {
  readonly #policy: BrokeredBashControlledEgressPolicy;
  readonly #lookup: ControlledEgressLookup;
  readonly #sockets = new Set<Duplex>();
  readonly #server = createServer();
  #endpoint: { host: "127.0.0.1"; port: number } | null = null;

  constructor(
    policy: BrokeredBashControlledEgressPolicy,
    lookup: ControlledEgressLookup = defaultLookup,
  ) {
    this.#policy = normalizeControlledEgressPolicy(policy);
    this.#lookup = lookup;
    this.#server.on("request", (request, response) => void this.#handleRequest(request, response));
    this.#server.on(
      "connect",
      (request, socket, head) => void this.#handleConnect(request, socket, head),
    );
    this.#server.on("connection", (socket) => {
      this.#sockets.add(socket);
      socket.once("close", () => this.#sockets.delete(socket));
    });
  }

  async start(): Promise<{ host: "127.0.0.1"; port: number; url: string }> {
    if (!this.#endpoint) {
      await new Promise<void>((resolve, reject) => {
        this.#server.once("error", reject);
        this.#server.listen(0, "127.0.0.1", () => {
          this.#server.off("error", reject);
          resolve();
        });
      });
      const address = this.#server.address() as AddressInfo;
      this.#endpoint = { host: "127.0.0.1", port: address.port };
    }
    return {
      ...this.#endpoint,
      url: `http://${this.#endpoint.host}:${this.#endpoint.port}`,
    };
  }

  async close(): Promise<void> {
    for (const socket of this.#sockets) socket.destroy();
    if (!this.#endpoint) return;
    await new Promise<void>((resolve) => this.#server.close(() => resolve()));
    this.#endpoint = null;
  }

  async #handleRequest(
    request: IncomingMessage,
    response: import("node:http").ServerResponse,
  ): Promise<void> {
    try {
      if (!request.url || Buffer.byteLength(request.url) > MAX_REQUEST_TARGET_BYTES) {
        throw new Error("BROKERED_BASH_EGRESS_REQUEST_INVALID");
      }
      const target = new URL(request.url);
      if (target.protocol !== "http:" && target.protocol !== "https:") {
        throw new Error("BROKERED_BASH_EGRESS_PROTOCOL_DENIED");
      }
      if (target.username || target.password)
        throw new Error("BROKERED_BASH_EGRESS_CREDENTIALS_DENIED");
      const port = target.port ? Number(target.port) : target.protocol === "https:" ? 443 : 80;
      const resolved = await resolveControlledEgressTarget({
        hostname: target.hostname,
        port,
        policy: this.#policy,
        lookup: this.#lookup,
      });
      const transport = target.protocol === "https:" ? httpsRequest : httpRequest;
      const upstream = transport({
        protocol: target.protocol,
        hostname: resolved.address.address,
        family: resolved.address.family,
        port,
        method: request.method,
        path: `${target.pathname}${target.search}`,
        headers: filteredHeaders(request, resolved.hostname),
        ...(target.protocol === "https:" ? { servername: resolved.hostname } : {}),
      });
      upstream.once("socket", (socket) => {
        this.#sockets.add(socket);
        socket.once("close", () => this.#sockets.delete(socket));
      });
      upstream.once("error", () => response.destroy());
      upstream.once("response", (upstreamResponse) => {
        response.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.headers);
        upstreamResponse.pipe(response);
      });
      request.pipe(upstream);
    } catch (error) {
      response.writeHead(403, { "content-type": "text/plain; charset=utf-8" });
      response.end(error instanceof Error ? error.message : "BROKERED_BASH_EGRESS_DENIED");
    }
  }

  async #handleConnect(request: IncomingMessage, client: Duplex, head: Buffer): Promise<void> {
    let established = false;
    try {
      if (!request.url || Buffer.byteLength(request.url) > MAX_REQUEST_TARGET_BYTES) {
        throw new Error("BROKERED_BASH_EGRESS_REQUEST_INVALID");
      }
      const target = new URL(`http://${request.url}`);
      if (target.username || target.password)
        throw new Error("BROKERED_BASH_EGRESS_CREDENTIALS_DENIED");
      const port = target.port ? Number(target.port) : 443;
      if (port !== 443) throw new Error("BROKERED_BASH_EGRESS_PORT_DENIED");
      const resolved = await resolveControlledEgressTarget({
        hostname: target.hostname,
        port,
        policy: this.#policy,
        lookup: this.#lookup,
      });
      client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      established = true;
      const hello = await readTlsClientHello(client, head);
      if (hello.serverName !== resolved.hostname) {
        throw new Error("BROKERED_BASH_EGRESS_TLS_SNI_DENIED");
      }
      const upstream = net.connect({
        host: resolved.address.address,
        family: resolved.address.family,
        port,
      });
      this.#sockets.add(upstream);
      upstream.once("close", () => this.#sockets.delete(upstream));
      upstream.once("connect", () => {
        upstream.write(hello.bytes);
        upstream.pipe(client);
        client.pipe(upstream);
      });
      upstream.once("error", () => client.destroy());
    } catch (error) {
      if (established) {
        client.destroy();
        return;
      }
      client.end(
        `HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Type: text/plain\r\n\r\n${
          error instanceof Error ? error.message : "BROKERED_BASH_EGRESS_DENIED"
        }`,
      );
    }
  }
}
