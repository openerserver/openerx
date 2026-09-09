import { type ChildProcess, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, rm, symlink } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { remoteHostSchema, remotePairingChallengeSchema } from "@openerx/contracts";
import { generateRemoteDeviceKeyPair } from "@openerx/remote-protocol";
import { build } from "vite";
import { afterAll, beforeAll, expect, it } from "vitest";

// Exercise the entry point used by npm run dev:v2, not the separate E2E fixture.
let directory: string;
let platform: ChildProcess | undefined;
let port: number;
let baseUrl: string;

async function startPlatform(): Promise<void> {
  platform = spawn(process.execPath, [path.join(directory, "build/platform.mjs")], {
    env: {
      ...process.env,
      OPENERX_PLATFORM_PORT: String(port),
      OPENERX_DEV_PLATFORM_DATA_DIR: path.join(directory, "data"),
      OPENERX_DEV_EMAIL_CODE: "123456",
      DEEPSEEK_API_KEY: "sk-remote-configuration-test-no-provider-requests",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const child = platform;
  await new Promise<void>((resolve, reject) => {
    let output = "";
    let errors = "";
    child.stderr?.on("data", (data) => {
      errors += data.toString();
    });
    const timeout = setTimeout(
      () => reject(new Error("Development platform startup timed out")),
      10_000,
    );
    const fail = (error: Error) => {
      clearTimeout(timeout);
      reject(error);
    };
    child.once("error", fail);
    child.once("exit", (code) =>
      fail(new Error(`Development platform exited: ${code}\n${errors}`)),
    );
    child.stdout?.on("data", (data) => {
      output += data.toString();
      if (output.includes("[openerx-platform] ready")) {
        clearTimeout(timeout);
        resolve();
      }
    });
  });
}
async function stopPlatform(): Promise<void> {
  if (!platform || platform.exitCode !== null || platform.signalCode !== null) return;
  const child = platform;
  const exit = once(child, "exit");
  child.kill("SIGTERM");
  const timeout = setTimeout(() => child.kill("SIGKILL"), 3_000);
  await exit;
  clearTimeout(timeout);
  platform = undefined;
}
async function json(pathname: string, token?: string, body?: unknown) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(5_000),
  });
  const value = await response.json();
  expect(response.status, JSON.stringify(value)).toBe(200);
  return value;
}
beforeAll(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "openerx-dev-remote-"));
  await symlink(path.resolve("node_modules"), path.join(directory, "node_modules"), "junction");
  await build({
    configFile: path.resolve("tests/v2/vite.deepseek-platform.config.mts"),
    build: { outDir: path.join(directory, "build") },
    logLevel: "error",
  });
  const probe = createServer();
  probe.listen(0, "127.0.0.1");
  await once(probe, "listening");
  const address = probe.address();
  if (!address || typeof address === "string") throw new Error("Missing test port");
  port = address.port;
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  baseUrl = `http://127.0.0.1:${port}`;
  await startPlatform();
}, 30_000);
afterAll(async () => {
  await stopPlatform();
  if (directory) await rm(directory, { recursive: true, force: true });
});

it("supports remote registration and pairing in the development platform and persists across restarts", async () => {
  const login = await json("/api/v2/account/challenges", undefined, {
    email: "remote-dev-test@example.com",
  });
  const deviceId = randomUUID();
  const session = await json("/api/v2/account/sessions", undefined, {
    challengeId: login.challengeId,
    code: "123456",
    device: { deviceId, name: "Remote development test", platform: "darwin", arch: "arm64" },
  });
  const token: string = session.accessToken;
  expect(await json("/api/v2/remote/hosts", token)).toEqual([]);
  expect(await json("/api/v2/remote/pairings", token)).toEqual([]);
  const registration = {
    hostDeviceId: deviceId,
    displayName: "Remote development test",
    platform: "darwin",
    arch: "arm64",
    appVersion: "2.0.1",
    capabilities: ["task.start"],
    remoteEnabled: true,
  };
  const host = remoteHostSchema.parse(await json("/api/v2/remote/hosts", token, registration));
  expect(host.remoteEnabled).toBe(true);
  const keys = generateRemoteDeviceKeyPair();
  const challenge = remotePairingChallengeSchema.parse(
    await json("/api/v2/remote/pairing-challenges", token, {
      hostDeviceId: deviceId,
      hostPublicKey: keys.publicKey,
    }),
  );
  expect(challenge.accountId).toBe(session.account.accountId);
  expect(challenge.hostDeviceId).toBe(deviceId);
  await stopPlatform();
  await startPlatform();
  const hosts = remoteHostSchema.array().parse(await json("/api/v2/remote/hosts", token));
  expect(hosts[0]?.remoteEnabled).toBe(true);
  expect(hosts[0]?.hostDeviceId).toBe(deviceId);
  const disabled = remoteHostSchema.parse(
    await json("/api/v2/remote/hosts", token, {
      ...registration,
      remoteEnabled: false,
    }),
  );
  expect(disabled.remoteEnabled).toBe(false);
}, 25_000);
