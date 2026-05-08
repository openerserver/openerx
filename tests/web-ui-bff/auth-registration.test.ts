import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { runCleanupStatements } from "./test-env";

const BFF_URL = process.env.TEST_BFF_URL || "http://127.0.0.1:4098";
const ADMIN_USERNAME = process.env.TEST_USERNAME || "admin";
const ADMIN_PASSWORD = process.env.TEST_PASSWORD || "admin123!";

interface AuthResult {
  token: string;
  user: {
    id: string;
    username: string;
    phoneNumber?: string | null;
    role: string;
    projects?: Array<{ id: string; role: string }>;
  };
}

const createdUsers: Array<{ id: string; phoneNumber: string }> = [];

async function request<T>(
  path: string,
  opts: RequestInit = {},
): Promise<{ data: T; status: number }> {
  const res = await fetch(`${BFF_URL}${path}`, opts);
  const text = await res.text();
  let data: unknown;
  try {
    data = text ? JSON.parse(text) : undefined;
  } catch {
    data = text;
  }
  return { data: data as T, status: res.status };
}

async function login(identifier: string, password: string) {
  return request<AuthResult>("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identifier, password }),
  });
}

async function register(phoneNumber: string, password = "BffPhone123!") {
  return request<AuthResult>("/api/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      phoneNumber,
      password,
      displayName: "BFF Phone User",
      email: "bff-phone@example.com",
    }),
  });
}

beforeAll(async () => {
  const adminLogin = await login(ADMIN_USERNAME, ADMIN_PASSWORD);
  if (adminLogin.status !== 200) {
    throw new Error(`Admin login failed: ${adminLogin.status} ${JSON.stringify(adminLogin.data)}`);
  }
});

afterAll(async () => {
  if (createdUsers.length === 0) return;

  const ids = createdUsers.map((user) => user.id.replace(/'/g, "''"));
  const phones = createdUsers.map((user) => user.phoneNumber.replace(/'/g, "''"));
  await runCleanupStatements(
    [
      `DELETE FROM audit_events WHERE user_id IN ('${ids.join("','")}') OR target IN ('${phones.join("','")}');`,
      `DELETE FROM project_roles WHERE user_id IN ('${ids.join("','")}');`,
      `DELETE FROM users WHERE id IN ('${ids.join("','")}');`,
    ],
    "auth-registration.test.ts (bff)",
  );
});

describe("Public phone registration (BFF)", () => {
  test("registers without an existing session and logs in by phone", async () => {
    const phoneNumber = `+1888${Date.now().toString().slice(-10)}`;
    const password = "BffPhone123!";

    const { data, status } = await register(phoneNumber, password);
    expect(status).toBe(201);
    expect(data.token).toBeTruthy();
    expect(data.user.phoneNumber).toBe(phoneNumber);
    expect(data.user.role).toBe("developer");
    expect(data.user.projects).toContainEqual({ id: "proj-default", role: "developer" });
    createdUsers.push({ id: data.user.id, phoneNumber });

    const phoneLogin = await login(phoneNumber, password);
    expect(phoneLogin.status).toBe(200);
    expect(phoneLogin.data.user.id).toBe(data.user.id);
  });

  test("keeps legacy username login working through BFF", async () => {
    const adminLogin = await login(ADMIN_USERNAME, ADMIN_PASSWORD);
    expect(adminLogin.status).toBe(200);
    expect(adminLogin.data.user.username).toBe(ADMIN_USERNAME);
  });

  test("passes through duplicate and validation errors", async () => {
    const phoneNumber = `+1999${Date.now().toString().slice(-10)}`;
    const first = await register(phoneNumber);
    expect(first.status).toBe(201);
    createdUsers.push({ id: first.data.user.id, phoneNumber });

    const duplicate = await register(phoneNumber);
    expect(duplicate.status).toBe(409);

    const badPhone = await register("not-a-phone");
    expect(badPhone.status).toBe(400);

    const weakPassword = await register(`+1222${Date.now().toString().slice(-10)}`, "weak");
    expect(weakPassword.status).toBe(400);
  });
});
