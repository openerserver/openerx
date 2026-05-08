import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { runPostgresCleanupStatements } from "./service-teardown-helpers";

const CP_URL = process.env.TEST_CP_URL || "http://127.0.0.1:4097";
const ADMIN_USERNAME = process.env.TEST_USERNAME || "admin";
const ADMIN_PASSWORD = process.env.TEST_PASSWORD || "admin123!";

interface AuthResult {
  token: string;
  user: {
    id: string;
    username: string;
    phoneNumber?: string | null;
    displayName: string;
    role: string;
    projects?: Array<{ id: string; role: string }>;
  };
}

const createdUsers: Array<{ id: string; phoneNumber: string }> = [];

async function request<T>(
  path: string,
  opts: RequestInit = {},
): Promise<{ data: T; status: number }> {
  const res = await fetch(`${CP_URL}${path}`, opts);
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

async function register(phoneNumber: string, password = "PhoneUser123!") {
  return request<AuthResult>("/api/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      phoneNumber,
      password,
      displayName: "Phone Registration User",
      email: "phone-registration@example.com",
      role: "platform_admin",
      username: "should_not_be_accepted",
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
  runPostgresCleanupStatements(
    [
      `DELETE FROM audit_events WHERE user_id IN ('${ids.join("','")}') OR target IN ('${phones.join("','")}');`,
      `DELETE FROM project_roles WHERE user_id IN ('${ids.join("','")}');`,
      `DELETE FROM users WHERE id IN ('${ids.join("','")}');`,
    ],
    "auth-registration.test.ts",
  );
});

describe("Public phone registration (service)", () => {
  test("registers a developer, assigns default project, and allows phone login", async () => {
    const phoneNumber = `+1555${Date.now().toString().slice(-10)}`;
    const password = "PhoneUser123!";

    const { data, status } = await register(phoneNumber, password);

    expect(status).toBe(201);
    expect(data.token).toBeTruthy();
    expect(data.user.id).toBeTruthy();
    expect(data.user.phoneNumber).toBe(phoneNumber);
    expect(data.user.username).not.toBe("should_not_be_accepted");
    expect(data.user.role).toBe("developer");
    expect(data.user.projects).toContainEqual({ id: "proj-default", role: "developer" });
    createdUsers.push({ id: data.user.id, phoneNumber });

    const phoneLogin = await login(phoneNumber, password);
    expect(phoneLogin.status).toBe(200);
    expect(phoneLogin.data.user.id).toBe(data.user.id);
    expect(phoneLogin.data.user.phoneNumber).toBe(phoneNumber);
  });

  test("keeps legacy username login working", async () => {
    const adminLogin = await login(ADMIN_USERNAME, ADMIN_PASSWORD);
    expect(adminLogin.status).toBe(200);
    expect(adminLogin.data.user.username).toBe(ADMIN_USERNAME);
  });

  test("rejects duplicate phone registrations", async () => {
    const phoneNumber = `+1666${Date.now().toString().slice(-10)}`;
    const first = await register(phoneNumber);
    expect(first.status).toBe(201);
    createdUsers.push({ id: first.data.user.id, phoneNumber });

    const duplicate = await register(phoneNumber);
    expect(duplicate.status).toBe(409);
    expect((duplicate.data as { error: string }).error).toBe("Phone number already registered");
  });

  test("rejects invalid phone numbers and weak passwords", async () => {
    const badPhone = await register("13800000000");
    expect(badPhone.status).toBe(400);

    const weakPassword = await register(`+1777${Date.now().toString().slice(-10)}`, "weak");
    expect(weakPassword.status).toBe(400);
  });
});
