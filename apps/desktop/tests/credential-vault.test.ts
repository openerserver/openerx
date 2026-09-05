import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { type AccountIdentity, byokModelRef, type DeviceSession } from "@openerx/contracts";
import { afterEach, describe, expect, it } from "vitest";
import {
  type CredentialProtector,
  DeviceCredentialVault,
  ToolCredentialVault,
} from "../src/main/credential-vault";
import { ModelServiceSettingsStore } from "../src/main/model-service-settings";

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

describe("ModelServiceSettingsStore", () => {
  it("defaults to unconfigured BYOK mode and stores secrets only in the protected vault", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "openerx-model-settings-"));
    temporaryDirectories.push(directory);
    const configurationPath = path.join(directory, "model-service.json");
    const credentialPath = path.join(directory, "model-service.bin");
    const store = new ModelServiceSettingsStore(
      configurationPath,
      new ToolCredentialVault(credentialPath, new TestProtector()),
      async () => ["93.184.216.34"],
    );
    await expect(store.state()).resolves.toMatchObject({
      mode: "byok",
      byok: {
        baseUrl: "https://api.deepseek.com",
        modelId: "deepseek-v4-flash",
      },
      credentialConfigured: false,
    });
    const secret = "sk-user-secret-value";
    const state = await store.update({
      mode: "byok",
      apiKey: secret,
      byok: {
        baseUrl: "https://api.example.com/v1/",
        modelId: "example-model",
        displayName: "Example",
        contextWindow: 128_000,
        maxOutputTokens: 8_192,
        capabilities: { imageInput: false, functionCalling: true, reasoning: false },
      },
    });
    expect(state).toMatchObject({ mode: "byok", credentialConfigured: true });
    expect(await readFile(configurationPath, "utf8")).not.toContain(secret);
    expect((await readFile(credentialPath)).toString()).not.toContain(secret);
    await expect(store.execution()).resolves.toMatchObject({
      apiKey: secret,
      baseUrl: "https://api.example.com/v1",
      modelId: "example-model",
    });
    await store.update({ mode: "hosted", byok: state.byok });
    await expect(store.execution()).resolves.toBeUndefined();
    await store.update({ mode: "byok", byok: state.byok });
    await store.clearApiKey();
    await expect(store.state()).resolves.toMatchObject({
      mode: "byok",
      credentialConfigured: false,
    });
  });

  it("stores independent API keys for multiple preset providers", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "openerx-model-settings-"));
    temporaryDirectories.push(directory);
    const credentialPath = path.join(directory, "model-service.bin");
    const store = new ModelServiceSettingsStore(
      path.join(directory, "model-service.json"),
      new ToolCredentialVault(credentialPath, new TestProtector()),
      async () => ["93.184.216.34"],
    );

    const state = await store.update({
      mode: "byok",
      byok: {
        baseUrl: "https://api.deepseek.com",
        modelId: "deepseek-v4-flash",
        displayName: "DeepSeek V4 Flash",
        contextWindow: 1_000_000,
        maxOutputTokens: 384_000,
        capabilities: { imageInput: false, functionCalling: true, reasoning: true },
      },
      providerApiKeys: {
        deepseek: "sk-deepseek-secret",
        qwen: "sk-qwen-secret",
      },
    });

    expect(state.providerCredentials).toMatchObject({ deepseek: true, qwen: true });
    await expect(store.execution(byokModelRef("deepseek", "pro"))).resolves.toMatchObject({
      apiKey: "sk-deepseek-secret",
      modelId: "deepseek-v4-pro",
    });
    await expect(store.execution(byokModelRef("qwen", "plus"))).resolves.toMatchObject({
      apiKey: "sk-qwen-secret",
      modelId: "qwen3.7-plus",
    });
    expect((await readFile(credentialPath)).toString()).not.toContain("sk-deepseek-secret");
    expect((await readFile(credentialPath)).toString()).not.toContain("sk-qwen-secret");

    await store.clearApiKey("deepseek");
    await expect(store.execution(byokModelRef("deepseek", "pro"))).resolves.toBeUndefined();
    await expect(store.execution(byokModelRef("qwen", "plus"))).resolves.toMatchObject({
      apiKey: "sk-qwen-secret",
    });
  });

  it("rejects insecure non-loopback HTTP endpoints", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "openerx-model-settings-"));
    temporaryDirectories.push(directory);
    const store = new ModelServiceSettingsStore(
      path.join(directory, "model-service.json"),
      new ToolCredentialVault(path.join(directory, "model-service.bin"), new TestProtector()),
    );
    await expect(
      store.update({
        mode: "byok",
        apiKey: "secret",
        byok: {
          baseUrl: "http://api.example.com/v1",
          modelId: "model",
          displayName: "Model",
          contextWindow: 8_192,
          maxOutputTokens: 1_024,
          capabilities: { imageInput: false, functionCalling: false, reasoning: false },
        },
      }),
    ).rejects.toThrow("BYOK_INSECURE_REMOTE_URL");
  });

  it("rejects private DNS targets before returning BYOK execution credentials", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "openerx-model-settings-"));
    temporaryDirectories.push(directory);
    const store = new ModelServiceSettingsStore(
      path.join(directory, "model-service.json"),
      new ToolCredentialVault(path.join(directory, "model-service.bin"), new TestProtector()),
      async () => ["169.254.169.254"],
    );
    await store.update({
      mode: "byok",
      apiKey: "secret",
      byok: {
        baseUrl: "https://api.example.com/v1",
        modelId: "model",
        displayName: "Model",
        contextWindow: 8_192,
        maxOutputTokens: 1_024,
        capabilities: { imageInput: false, functionCalling: false, reasoning: false },
      },
    });
    await expect(store.execution()).rejects.toThrow("BYOK_PRIVATE_NETWORK_FORBIDDEN");
  });
});
