import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { type DeviceSessionGrant, defaultByokModelConfiguration } from "@openerx/contracts";
import { ChatRepository, migrateDatabase, ProjectRepository } from "@openerx/storage";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AccountSessionManager, type IdentityTransport } from "../src/main/account-session-manager";
import {
  type CredentialProtector,
  DeviceCredentialVault,
  ToolCredentialVault,
} from "../src/main/credential-vault";
import { accountProfileDirectory, configureDesktopProfile } from "../src/main/desktop-profile";
import { ModelServiceSettingsStore } from "../src/main/model-service-settings";

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

const protector: CredentialProtector = {
  isAvailable: async () => true,
  encrypt: async (text) => Buffer.from(text).reverse(),
  decrypt: async (bytes) => ({
    result: Buffer.from(bytes).reverse().toString(),
    shouldReEncrypt: false,
  }),
};

function fixtureGrant(): DeviceSessionGrant {
  const accountId = randomUUID();
  const now = new Date().toISOString();
  return {
    account: {
      accountId,
      email: "persistence@example.com",
      displayName: "持久化验收",
      createdAt: now,
    },
    session: {
      sessionId: randomUUID(),
      accountId,
      device: { deviceId: randomUUID(), name: "Test Desktop", platform: "darwin", arch: "arm64" },
      sessionVersion: 1,
      createdAt: now,
      lastActiveAt: now,
      revokedAt: null,
    },
    refreshCredential: "synthetic-persistence-refresh-credential",
    accessToken: "synthetic-persistence-access-token-0001",
    accessTokenExpiresAt: "2099-09-15T00:00:00.000Z",
  };
}

describe("desktop update data retention", () => {
  it.each([
    ["OpenerX", "fetch failed"],
    ["OpenerX", "REFRESH_REPLAY_REVOKED"],
    ["OpenerX-Enterprise", "fetch failed"],
    ["OpenerX-Enterprise", "REFRESH_REPLAY_REVOKED"],
  ])(
    "retains %s chats, projects and model settings through rebuilds and repeated restarts after %s",
    async (profileDirectoryName, reason) => {
      const root = mkdtempSync(path.join(tmpdir(), "openerx-update-retention-"));
      directories.push(root);
      const appData = path.join(root, "Application Support");
      const paths: Record<string, string> = {};
      const application = {
        getPath: () => appData,
        setPath: (name: string, value: string) => {
          paths[name] = value;
        },
      };
      const base = configureDesktopProfile(application, {}, profileDirectoryName);
      expect(base).toBe(path.join(appData, profileDirectoryName));
      const grant = fixtureGrant();
      const profile = accountProfileDirectory(base, grant.account);
      mkdirSync(profile, { recursive: true });
      const file = path.join(profile, "openerx-v2.sqlite");
      const oldSchema = new DatabaseSync(file);
      migrateDatabase(oldSchema, { throughVersion: 33 });
      const originalMigrationRows = oldSchema.prepare("SELECT * FROM schema_migrations").all();
      oldSchema.close();
      const chats = new ChatRepository(file, { ownerProfileId: grant.account.accountId });
      const draft = chats.createGeneration({
        text: "更新后保留这段聊天",
        idempotencyKey: randomUUID(),
      });
      chats.appendPiEvent(draft.receipt.assistantMessageId, {
        eventId: randomUUID(),
        sequence: 1,
        occurredAt: new Date().toISOString(),
        type: "completed",
      });
      const originalConversation = chats.getConversation(draft.receipt.conversationId);
      chats.close();
      const projects = new ProjectRepository(file, { ownerProfileId: grant.account.accountId });
      const project = projects.createProject({
        operationId: randomUUID(),
        name: "更新后保留这个项目",
      });
      projects.close();

      const sessionPath = path.join(base, "account", "device-session.bin");
      await new DeviceCredentialVault(sessionPath, protector).save({
        account: grant.account,
        session: grant.session,
        refreshCredential: grant.refreshCredential,
      });
      const modelSettings = () =>
        new ModelServiceSettingsStore(
          path.join(base, "model-service.json"),
          new ToolCredentialVault(path.join(base, "credentials", "model-service.bin"), protector),
        );
      await modelSettings().update({
        mode: "byok",
        byok: defaultByokModelConfiguration(),
        providerApiKeys: { deepseek: "synthetic-retained-model-key" },
      });
      const originalSettings = await modelSettings().state();
      const originalModelBytes = readFileSync(path.join(base, "credentials", "model-service.bin"));
      const transport: IdentityTransport = {
        refresh: vi.fn(async () => {
          throw new Error(reason);
        }),
        requestChallenge: vi.fn(),
        verifyChallenge: vi.fn(),
        revoke: vi.fn(),
        revokeAll: vi.fn(),
        listDevices: vi.fn(),
      };

      for (let update = 0; update < 3; update++) {
        const output = path.join(root, "apps", "desktop", "out");
        mkdirSync(output, { recursive: true });
        writeFileSync(path.join(output, "app.fixture"), String(update));
        rmSync(output, { recursive: true });
        const reopenedBase = configureDesktopProfile(application, {}, profileDirectoryName);
        expect(reopenedBase).toBe(base);
        expect(paths).toEqual({ userData: base, sessionData: base });
        const account = new AccountSessionManager({
          vault: new DeviceCredentialVault(sessionPath, protector),
          transport,
          device: grant.session.device,
        });
        const state = await account.initialize();
        expect(state.account).toEqual(grant.account);
        await expect(account.accessToken()).rejects.toThrow("AUTHENTICATION_REQUIRED");
        const reopenedProfile = accountProfileDirectory(reopenedBase, state.account);
        expect(reopenedProfile).toBe(profile);
        expect(existsSync(path.join(base, "openerx-v2.sqlite"))).toBe(false);
        const reopenedChats = new ChatRepository(path.join(reopenedProfile, "openerx-v2.sqlite"));
        expect(reopenedChats.getConversation(draft.receipt.conversationId)).toEqual(
          originalConversation,
        );
        reopenedChats.close();
        const reopenedProjects = new ProjectRepository(file, {
          ownerProfileId: grant.account.accountId,
        });
        expect(reopenedProjects.getProject(project.id).project).toEqual(project);
        reopenedProjects.close();
        expect(await modelSettings().state()).toEqual(originalSettings);
        expect(readFileSync(path.join(base, "credentials", "model-service.bin"))).toEqual(
          originalModelBytes,
        );
      }
      const database = new DatabaseSync(file);
      expect(database.prepare("SELECT * FROM schema_migrations WHERE version <= 33").all()).toEqual(
        originalMigrationRows,
      );
      expect(database.prepare("PRAGMA quick_check").get()).toEqual({ quick_check: "ok" });
      database.close();
      expect(transport.refresh).toHaveBeenCalledTimes(reason === "fetch failed" ? 3 : 1);
    },
  );

  it("isolates test browser storage as well as SQLite without changing normal launch paths", () => {
    const setPath = vi.fn();
    const application = { getPath: () => path.join(tmpdir(), "app-data"), setPath };
    const profile = path.join(tmpdir(), "persistence-test-only");
    expect(configureDesktopProfile(application, { OPENERX_E2E_PROFILE_DIR: profile })).toBe(
      path.join(application.getPath(), "OpenerX"),
    );
    expect(
      configureDesktopProfile(application, { OPENERX_E2E: "1", OPENERX_E2E_PROFILE_DIR: profile }),
    ).toBe(profile);
    expect(setPath).toHaveBeenCalledWith("sessionData", profile);
    expect(setPath).toHaveBeenCalledWith("userData", profile);
  });
});
