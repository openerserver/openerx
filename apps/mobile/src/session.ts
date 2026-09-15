import type { AccountIdentity, DeviceDescriptor, DeviceSessionGrant } from "@openerx/contracts";
import { deviceSessionGrantSchema } from "@openerx/contracts";
import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

const sessionKey = "openerx.remote.session.v1";
const deviceKey = "openerx.remote.device.v1";
let sessionRevision = 0;
let sessionWrites = Promise.resolve();
const refreshes = new Map<string, Promise<MobileSession>>();

function writeSession(operation: () => Promise<void>): Promise<void> {
  const write = sessionWrites.then(operation);
  sessionWrites = write.catch(() => undefined);
  return write;
}

export interface MobileSession {
  account: AccountIdentity;
  sessionId: string;
  refreshCredential: string;
  accessToken: string;
  accessTokenExpiresAt: string;
}

const secureOptions: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

export async function mobileDevice(): Promise<DeviceDescriptor> {
  const stored = await SecureStore.getItemAsync(deviceKey, secureOptions);
  if (stored) return JSON.parse(stored) as DeviceDescriptor;
  const descriptor: DeviceDescriptor = {
    deviceId: Crypto.randomUUID(),
    name: Platform.OS === "ios" ? "iPhone / iPad" : "Android Remote",
    platform: Platform.OS === "ios" ? "ios" : "android",
    arch: "arm64",
  };
  await SecureStore.setItemAsync(deviceKey, JSON.stringify(descriptor), secureOptions);
  return descriptor;
}

function fromGrant(grant: DeviceSessionGrant): MobileSession {
  return {
    account: grant.account,
    sessionId: grant.session.sessionId,
    refreshCredential: grant.refreshCredential,
    accessToken: grant.accessToken,
    accessTokenExpiresAt: grant.accessTokenExpiresAt,
  };
}

export async function saveSession(grantInput: DeviceSessionGrant): Promise<MobileSession> {
  const session = fromGrant(deviceSessionGrantSchema.parse(grantInput));
  sessionRevision += 1;
  await writeSession(() =>
    SecureStore.setItemAsync(sessionKey, JSON.stringify(session), secureOptions),
  );
  return session;
}

export async function loadSession(): Promise<MobileSession | null> {
  const value = await SecureStore.getItemAsync(sessionKey, secureOptions);
  return value ? (JSON.parse(value) as MobileSession) : null;
}

export async function clearSession(): Promise<void> {
  sessionRevision += 1;
  await writeSession(() => SecureStore.deleteItemAsync(sessionKey, secureOptions));
}

export function refreshSession(baseUrl: string, session: MobileSession): Promise<MobileSession> {
  const key = `${sessionRevision}:${session.sessionId}:${session.refreshCredential}`;
  const pending = refreshes.get(key);
  if (pending) return pending;
  const result = rotateSession(baseUrl, session).finally(() => refreshes.delete(key));
  refreshes.set(key, result);
  return result;
}

async function rotateSession(baseUrl: string, session: MobileSession): Promise<MobileSession> {
  const revision = sessionRevision;
  const response = await fetch(
    `${baseUrl.replace(/\/$/u, "")}/api/v2/account/sessions/${encodeURIComponent(session.sessionId)}/refresh`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ refreshCredential: session.refreshCredential }),
    },
  );
  const value = (await response.json()) as unknown;
  if (!response.ok) {
    const code = (value as { error?: { code?: string } })?.error?.code;
    throw new Error(code?.startsWith("DEVICE_SESSION_") ? code : "SESSION_REFRESH_FAILED");
  }
  const next = fromGrant(deviceSessionGrantSchema.parse(value));
  if (next.sessionId !== session.sessionId || next.account.accountId !== session.account.accountId)
    throw new Error("SESSION_REFRESH_SCOPE_VIOLATION");
  await writeSession(async () => {
    if (revision !== sessionRevision) throw new Error("SESSION_CHANGED");
    await SecureStore.setItemAsync(sessionKey, JSON.stringify(next), secureOptions);
  });
  return next;
}
