import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  type AccountIdentity,
  accountIdentitySchema,
  type DeviceSession,
  deviceSessionSchema,
  remoteOpaqueSchema,
} from "@openerx/contracts";
import type { RemoteDeviceKeyPair } from "@openerx/remote-protocol";
import { safeStorage } from "electron";
import { z } from "zod";

export interface CredentialProtector {
  isAvailable(): Promise<boolean>;
  encrypt(value: string): Promise<Buffer>;
  decrypt(value: Buffer): Promise<{ result: string; shouldReEncrypt: boolean }>;
}

const persistedDeviceCredentialSchema = z
  .object({
    version: z.literal(1),
    account: accountIdentitySchema,
    session: deviceSessionSchema,
    refreshCredential: z.string().min(32),
  })
  .strict();

export interface PersistedDeviceCredential {
  version: 1;
  account: AccountIdentity;
  session: DeviceSession;
  refreshCredential: string;
}

export class ElectronSafeStorageProtector implements CredentialProtector {
  async isAvailable(): Promise<boolean> {
    return await safeStorage.isAsyncEncryptionAvailable();
  }

  async encrypt(value: string): Promise<Buffer> {
    return await safeStorage.encryptStringAsync(value);
  }

  async decrypt(value: Buffer): Promise<{ result: string; shouldReEncrypt: boolean }> {
    return await safeStorage.decryptStringAsync(value);
  }
}

export class DeviceCredentialVault {
  readonly #filePath: string;
  readonly #protector: CredentialProtector;

  constructor(
    filePath: string,
    protector: CredentialProtector = new ElectronSafeStorageProtector(),
  ) {
    this.#filePath = filePath;
    this.#protector = protector;
  }

  async save(input: Omit<PersistedDeviceCredential, "version">): Promise<void> {
    if (!(await this.#protector.isAvailable())) throw new Error("OS_CREDENTIAL_STORE_UNAVAILABLE");
    const credential = persistedDeviceCredentialSchema.parse({ version: 1, ...input });
    const encrypted = await this.#protector.encrypt(JSON.stringify(credential));
    const directory = path.dirname(this.#filePath);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const temporaryPath = path.join(
      directory,
      `.${path.basename(this.#filePath)}.${randomBytes(8).toString("hex")}.tmp`,
    );
    try {
      await writeFile(temporaryPath, encrypted, { mode: 0o600, flag: "wx" });
      await rename(temporaryPath, this.#filePath);
    } finally {
      await rm(temporaryPath, { force: true });
    }
  }

  async load(): Promise<PersistedDeviceCredential | null> {
    let encrypted: Buffer;
    try {
      encrypted = await readFile(this.#filePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
    if (!(await this.#protector.isAvailable())) throw new Error("OS_CREDENTIAL_STORE_UNAVAILABLE");
    const decrypted = await this.#protector.decrypt(encrypted);
    const credential = persistedDeviceCredentialSchema.parse(JSON.parse(decrypted.result));
    if (decrypted.shouldReEncrypt) {
      await this.save({
        account: credential.account,
        session: credential.session,
        refreshCredential: credential.refreshCredential,
      });
    }
    return credential;
  }

  async clear(): Promise<void> {
    await rm(this.#filePath, { force: true });
  }
}

const persistedToolCredentialsSchema = z
  .object({
    version: z.literal(1),
    values: z.record(z.string().min(1).max(500), z.string().min(1)),
  })
  .strict();

export class ToolCredentialVault {
  constructor(
    private readonly filePath: string,
    private readonly protector: CredentialProtector = new ElectronSafeStorageProtector(),
  ) {}

  async save(credentialRef: string, value: string): Promise<void> {
    const values = await this.#load();
    values[credentialRef] = value;
    await this.#write(values);
  }

  async resolve(credentialRef: string): Promise<string> {
    const value = (await this.#load())[credentialRef];
    if (!value) throw new Error("MCP_CREDENTIAL_NOT_FOUND");
    return value;
  }

  async clear(credentialRef: string): Promise<void> {
    const values = await this.#load();
    delete values[credentialRef];
    await this.#write(values);
  }

  async #load(): Promise<Record<string, string>> {
    let encrypted: Buffer;
    try {
      encrypted = await readFile(this.filePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
      throw error;
    }
    if (!(await this.protector.isAvailable())) throw new Error("OS_CREDENTIAL_STORE_UNAVAILABLE");
    const decrypted = await this.protector.decrypt(encrypted);
    const payload = persistedToolCredentialsSchema.parse(JSON.parse(decrypted.result));
    if (decrypted.shouldReEncrypt) await this.#write(payload.values);
    return { ...payload.values };
  }

  async #write(values: Record<string, string>): Promise<void> {
    if (!(await this.protector.isAvailable())) throw new Error("OS_CREDENTIAL_STORE_UNAVAILABLE");
    const payload = persistedToolCredentialsSchema.parse({ version: 1, values });
    const encrypted = await this.protector.encrypt(JSON.stringify(payload));
    const directory = path.dirname(this.filePath);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const temporaryPath = path.join(
      directory,
      `.${path.basename(this.filePath)}.${randomBytes(8).toString("hex")}.tmp`,
    );
    try {
      await writeFile(temporaryPath, encrypted, { mode: 0o600, flag: "wx" });
      await rename(temporaryPath, this.filePath);
    } finally {
      await rm(temporaryPath, { force: true });
    }
  }
}

const persistedRemoteKeySchema = z
  .object({
    version: z.literal(1),
    publicKey: remoteOpaqueSchema,
    privateKey: remoteOpaqueSchema,
  })
  .strict();

export class RemoteKeyVault {
  constructor(
    private readonly filePath: string,
    private readonly protector: CredentialProtector = new ElectronSafeStorageProtector(),
  ) {}

  async save(keyPair: RemoteDeviceKeyPair): Promise<void> {
    if (!(await this.protector.isAvailable())) throw new Error("OS_CREDENTIAL_STORE_UNAVAILABLE");
    const payload = persistedRemoteKeySchema.parse({ version: 1, ...keyPair });
    const encrypted = await this.protector.encrypt(JSON.stringify(payload));
    const directory = path.dirname(this.filePath);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const temporaryPath = path.join(
      directory,
      `.${path.basename(this.filePath)}.${randomBytes(8).toString("hex")}.tmp`,
    );
    try {
      await writeFile(temporaryPath, encrypted, { mode: 0o600, flag: "wx" });
      await rename(temporaryPath, this.filePath);
    } finally {
      await rm(temporaryPath, { force: true });
    }
  }

  async load(): Promise<RemoteDeviceKeyPair | null> {
    let encrypted: Buffer;
    try {
      encrypted = await readFile(this.filePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
    if (!(await this.protector.isAvailable())) throw new Error("OS_CREDENTIAL_STORE_UNAVAILABLE");
    const decrypted = await this.protector.decrypt(encrypted);
    const payload = persistedRemoteKeySchema.parse(JSON.parse(decrypted.result));
    const keyPair = { publicKey: payload.publicKey, privateKey: payload.privateKey };
    if (decrypted.shouldReEncrypt) await this.save(keyPair);
    return keyPair;
  }

  async clear(): Promise<void> {
    await rm(this.filePath, { force: true });
  }
}
