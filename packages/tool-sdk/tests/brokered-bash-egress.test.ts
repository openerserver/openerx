import { request as httpRequest } from "node:http";
import net from "node:net";
import { describe, expect, it, vi } from "vitest";
import {
  BrokeredBashControlledEgressProxy,
  brokeredBashNetworkPolicyDigest,
  isPublicEgressAddress,
  normalizeControlledEgressPolicy,
  resolveControlledEgressTarget,
  tlsClientHelloServerName,
} from "../src";

const policy = {
  mode: "controlled_egress" as const,
  allowedDomains: ["example.com"],
};

async function proxyRequest(
  proxyUrl: string,
  target: string,
): Promise<{ status: number; body: string }> {
  const endpoint = new URL(proxyUrl);
  return await new Promise((resolve, reject) => {
    const request = httpRequest(
      {
        host: endpoint.hostname,
        port: endpoint.port,
        method: "GET",
        path: target,
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () =>
          resolve({
            status: response.statusCode ?? 0,
            body: Buffer.concat(chunks).toString("utf8"),
          }),
        );
      },
    );
    request.once("error", reject);
    request.end();
  });
}

async function proxyConnect(proxyUrl: string, authority: string): Promise<string> {
  const endpoint = new URL(proxyUrl);
  return await new Promise((resolve, reject) => {
    const socket = net.connect(Number(endpoint.port), endpoint.hostname);
    const chunks: Buffer[] = [];
    socket.once("connect", () => {
      socket.write(`CONNECT ${authority} HTTP/1.1\r\nHost: ${authority}\r\n\r\n`);
    });
    socket.on("data", (chunk: Buffer) => chunks.push(chunk));
    socket.once("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    socket.once("error", reject);
  });
}

// A deterministic ClientHello tests the SNI gate before any certificate exchange.
// The cipher/version fields are valid TLS framing; no TLS verification is disabled.
function clientHello(serverName: string): Buffer {
  const uint16 = (value: number) => {
    const bytes = Buffer.alloc(2);
    bytes.writeUInt16BE(value);
    return bytes;
  };
  const name = Buffer.from(serverName, "ascii");
  const names = Buffer.concat([
    uint16(name.length + 3),
    Buffer.from([0]),
    uint16(name.length),
    name,
  ]);
  const extension = Buffer.concat([uint16(0), uint16(names.length), names]);
  const body = Buffer.concat([
    Buffer.from([3, 3]),
    Buffer.alloc(32),
    Buffer.from([0]),
    uint16(2),
    Buffer.from([0xc0, 0x2f]),
    Buffer.from([1, 0]),
    uint16(extension.length),
    extension,
  ]);
  const header = Buffer.alloc(4);
  header[0] = 1;
  header.writeUIntBE(body.length, 1, 3);
  const handshake = Buffer.concat([header, body]);
  return Buffer.concat([Buffer.from([22, 3, 1]), uint16(handshake.length), handshake]);
}

async function proxyTlsRejected(
  proxyUrl: string,
  authority: string,
  hello: Buffer,
): Promise<boolean> {
  const endpoint = new URL(proxyUrl);
  return await new Promise((resolve, reject) => {
    const socket = net.connect(Number(endpoint.port), endpoint.hostname);
    const timeout = setTimeout(() => {
      reject(new Error("proxy TLS test timed out"));
      socket.destroy();
    }, 5_000);
    let response = "";
    let sentHello = false;
    socket.once("connect", () => {
      socket.write(`CONNECT ${authority} HTTP/1.1\r\nHost: ${authority}\r\n\r\n`);
    });
    socket.on("data", (chunk: Buffer) => {
      if (sentHello) {
        reject(new Error("Unexpected upstream TLS response"));
        socket.destroy();
        return;
      }
      response += chunk.toString("utf8");
      if (!response.includes("\r\n\r\n")) return;
      if (!response.startsWith("HTTP/1.1 200")) {
        reject(new Error(response));
        socket.destroy();
        return;
      }
      sentHello = true;
      socket.write(hello);
    });
    socket.once("error", reject);
    socket.once("close", () => {
      clearTimeout(timeout);
      resolve(sentHello);
    });
  });
}

describe("brokered Bash controlled egress", () => {
  it("normalizes allowlists and binds them to a stable digest", () => {
    expect(
      normalizeControlledEgressPolicy({
        mode: "controlled_egress",
        allowedDomains: ["EXAMPLE.com.", "*.cdn.example.com", "example.com"],
      }),
    ).toEqual({
      mode: "controlled_egress",
      allowedDomains: ["*.cdn.example.com", "example.com"],
    });
    expect(brokeredBashNetworkPolicyDigest(policy)).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(() =>
      normalizeControlledEgressPolicy({
        mode: "controlled_egress",
        allowedDomains: ["127.0.0.1"],
      }),
    ).toThrow("BROKERED_BASH_EGRESS_POLICY_INVALID");
  });

  it("accepts exact and wildcard domains but never treats a parent as a wildcard match", async () => {
    const lookup = async () => [{ address: "93.184.216.34", family: 4 as const }];
    await expect(
      resolveControlledEgressTarget({
        hostname: "example.com",
        port: 443,
        policy,
        lookup,
      }),
    ).resolves.toMatchObject({ hostname: "example.com", port: 443 });
    await expect(
      resolveControlledEgressTarget({
        hostname: "evil-example.com",
        port: 443,
        policy,
        lookup,
      }),
    ).rejects.toThrow("BROKERED_BASH_EGRESS_DOMAIN_DENIED");

    const wildcard = {
      mode: "controlled_egress" as const,
      allowedDomains: ["*.example.com"],
    };
    await expect(
      resolveControlledEgressTarget({
        hostname: "cdn.example.com",
        port: 443,
        policy: wildcard,
        lookup,
      }),
    ).resolves.toMatchObject({ hostname: "cdn.example.com" });
    await expect(
      resolveControlledEgressTarget({
        hostname: "example.com",
        port: 443,
        policy: wildcard,
        lookup,
      }),
    ).rejects.toThrow("BROKERED_BASH_EGRESS_DOMAIN_DENIED");
  });

  it("blocks loopback, private, link-local, metadata, CGNAT and non-public IPv6", () => {
    for (const address of [
      "0.0.0.0",
      "10.0.0.1",
      "100.64.0.1",
      "127.0.0.1",
      "169.254.169.254",
      "172.16.0.1",
      "192.168.0.1",
      "224.0.0.1",
      "::",
      "::1",
      "::ffff:127.0.0.1",
      "fc00::1",
      "fe80::1",
      "ff02::1",
      "2001:db8::1",
    ]) {
      expect(isPublicEgressAddress(address), address).toBe(false);
    }
    expect(isPublicEgressAddress("93.184.216.34")).toBe(true);
    expect(isPublicEgressAddress("2606:2800:220:1:248:1893:25c8:1946")).toBe(true);
  });

  it("rejects a DNS answer set if any answer rebinds to a private address", async () => {
    await expect(
      resolveControlledEgressTarget({
        hostname: "example.com",
        port: 443,
        policy,
        lookup: async () => [
          { address: "93.184.216.34", family: 4 },
          { address: "127.0.0.1", family: 4 },
        ],
      }),
    ).rejects.toThrow("BROKERED_BASH_EGRESS_ADDRESS_DENIED");
    await expect(
      resolveControlledEgressTarget({
        hostname: "example.com",
        port: 443,
        policy,
        lookup: async () => [{ address: "93.184.216.34", family: 6 }],
      }),
    ).rejects.toThrow("BROKERED_BASH_EGRESS_ADDRESS_DENIED");
  });

  it("restricts proxy tunnels to HTTP/S ports and revalidates every request target", async () => {
    const proxy = new BrokeredBashControlledEgressProxy(policy, async () => [
      { address: "127.0.0.1", family: 4 },
    ]);
    const endpoint = await proxy.start();
    try {
      await expect(proxyRequest(endpoint.url, "http://localhost/")).resolves.toEqual({
        status: 403,
        body: "BROKERED_BASH_EGRESS_POLICY_INVALID",
      });
      await expect(proxyRequest(endpoint.url, "http://example.com:22/")).resolves.toEqual({
        status: 403,
        body: "BROKERED_BASH_EGRESS_PORT_DENIED",
      });
      await expect(proxyRequest(endpoint.url, "http://example.com/")).resolves.toEqual({
        status: 403,
        body: "BROKERED_BASH_EGRESS_ADDRESS_DENIED",
      });
      await expect(proxyRequest(endpoint.url, "http://redirected.invalid/")).resolves.toEqual({
        status: 403,
        body: "BROKERED_BASH_EGRESS_DOMAIN_DENIED",
      });
      await expect(proxyConnect(endpoint.url, "example.com:22")).resolves.toContain(
        "BROKERED_BASH_EGRESS_PORT_DENIED",
      );
      await expect(proxyConnect(endpoint.url, "user:pass@example.com:443")).resolves.toContain(
        "BROKERED_BASH_EGRESS_CREDENTIALS_DENIED",
      );
    } finally {
      await proxy.close();
    }
  });

  it("rejects HTTPS CONNECT when ClientHello SNI differs from the approved authority", async () => {
    const proxy = new BrokeredBashControlledEgressProxy(policy, async () => [
      { address: "93.184.216.34", family: 4 },
    ]);
    const endpoint = await proxy.start();
    const hello = clientHello("redirected.invalid");
    expect(tlsClientHelloServerName(hello)).toBe("redirected.invalid");
    const originalConnect = net.connect;
    const connect = vi.spyOn(net, "connect").mockImplementation((...args) => {
      // Block and count any attempted upstream connection, so an unrelated
      // network/certificate failure cannot make this rejection test pass.
      if (typeof args[0] === "object") throw new Error("Unexpected upstream connection");
      return Reflect.apply(originalConnect, net, args) as net.Socket;
    });
    try {
      await expect(proxyTlsRejected(endpoint.url, "example.com:443", hello)).resolves.toBe(true);
      expect(connect).toHaveBeenCalledTimes(1);
      expect(connect).toHaveBeenCalledWith(Number(new URL(endpoint.url).port), "127.0.0.1");
    } finally {
      connect.mockRestore();
      await proxy.close();
    }
  });
});
