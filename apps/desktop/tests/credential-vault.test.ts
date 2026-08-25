import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { AccountIdentity, DeviceSession } from "@openerx/contracts";
import { afterEach, describe, expect, it } from "vitest";
import {
  type CredentialProtector,
  DeviceCredentialVault,
  ToolCredentialVault,
} from "../src/main/credential-vault";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  for (const directory of temporaryDirectories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

class TestProtector implements CredentialProtector {
  readonly #available: boolean;

  constructor(available = true) {
    this.#available = available;
  }

  async isAvailable(): Promise<boolean> {
    return this.#available;
  }

  async encrypt(value: string): Promise<Buffer> {
    return Buffer.from(`protected:${Buffer.from(value).toString("base64")}`);
  }

  async decrypt(value: Buffer): Promise<{ result: string; shouldReEncrypt: boolean }> {
    const encoded = value.toString().replace(/^protected:/, "");
    return { result: Buffer.from(encoded, "base64").toString(), shouldReEncrypt: false };
  }
}

function fixture() {
  const account: AccountIdentity = {
    accountId: randomUUID(),
    email: "vault@example.com",
    displayName: "Vault",
    createdAt: "2026-08-25T10:00:00.000Z",
  };
  const session: DeviceSession = {
    sessionId: randomUUID(),
    accountId: account.accountId,
    device: {
      deviceId: randomUUID(),
      name: "Test Mac",
      platform: "darwin",
      arch: "arm64",
    },
    sessionVersion: 1,
    createdAt: "2026-08-25T10:00:00.000Z",
    lastActiveAt: "2026-08-25T10:00:00.000Z",
    revokedAt: null,
  };
  return { account, session, refreshCredential: "refresh-secret-never-plaintext-1234567890" };
}

describe("DeviceCredentialVault", () => {
  it("persists the reusable credential only as protected bytes", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "openerx-vault-"));
    temporaryDirectories.push(directory);
    const filePath = path.join(directory, "account", "device-session.bin");
    const vault = new DeviceCredentialVault(filePath, new TestProtector());
    const credential = fixture();
    await vault.save(credential);
    const bytes = await readFile(filePath);
    expect(bytes.toString()).not.toContain(credential.refreshCredential);
    await expect(vault.load()).resolves.toEqual({ version: 1, ...credential });
    await vault.clear();
    await expect(vault.load()).resolves.toBeNull();
  });

  it("fails closed when the OS credential boundary is unavailable", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "openerx-vault-"));
    temporaryDirectories.push(directory);
    const vault = new DeviceCredentialVault(
      path.join(directory, "device-session.bin"),
      new TestProtector(false),
    );
    await expect(vault.save(fixture())).rejects.toThrow("OS_CREDENTIAL_STORE_UNAVAILABLE");
  });
});

describe("ToolCredentialVault", () => {
  it("keeps MCP credentials protected and removes one credential without exposing others", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "openerx-tool-vault-"));
    temporaryDirectories.push(directory);
    const filePath = path.join(directory, "tool-credentials.bin");
    const vault = new ToolCredentialVault(filePath, new TestProtector());
    await vault.save("mcp:one", "first-bearer-secret");
    await vault.save("mcp:two", "second-bearer-secret");
    const bytes = await readFile(filePath);
    expect(bytes.toString()).not.toContain("bearer-secret");
    await expect(vault.resolve("mcp:one")).resolves.toBe("first-bearer-secret");
    await vault.clear("mcp:one");
    await expect(vault.resolve("mcp:one")).rejects.toThrow("MCP_CREDENTIAL_NOT_FOUND");
    await expect(vault.resolve("mcp:two")).resolves.toBe("second-bearer-secret");
  });
});
