import { randomUUID } from "node:crypto";
import {
  defaultByokModelConfiguration,
  type ModelAuthorization,
  type ModelServiceSettings,
} from "@openerx/contracts";
import { describe, expect, it, vi } from "vitest";
import { HostedModelAccess } from "../src/main/hosted-model-access";

const settings: ModelServiceSettings = {
  mode: "byok",
  byok: defaultByokModelConfiguration(),
  credentialConfigured: false,
  providerCredentials: {},
  updatedAt: null,
};
function fixture() {
  const access = new HostedModelAccess();
  let account: string | null = randomUUID();
  const authorization: ModelAuthorization = {
    accountId: account,
    accessToken: "x".repeat(43),
    accessTokenExpiresAt: new Date(Date.now() + 300000).toISOString(),
    platformBaseUrl: "https://models.example.test",
    modelApiVersion: "v3",
  };
  const authorize = vi.fn(async () => authorization);
  access.register({ accountId: () => account, authorize });
  return {
    access,
    authorize,
    authorization,
    switchAccount: (next: string | null) => {
      account = next;
    },
  };
}
describe("hosted model account bridge", () => {
  it("defaults an unconfigured signed-in account to hosted without overwriting saved BYOK", () => {
    const f = fixture();
    expect(f.access.settings(settings).mode).toBe("hosted");
    expect(f.access.settings({ ...settings, updatedAt: new Date().toISOString() }).mode).toBe(
      "byok",
    );
    expect(f.access.settings({ ...settings, providerCredentials: { deepseek: true } }).mode).toBe(
      "byok",
    );
    f.switchAccount(null);
    expect(f.access.settings(settings).hostedAccountId).toBeNull();
    expect(f.access.settings(settings).mode).toBe("byok");
  });
  it("preserves openerx behavior without a distributor provider", () => {
    expect(new HostedModelAccess().settings(settings)).toBe(settings);
  });
  it("binds renewal to the original account before and after async refresh", async () => {
    const f = fixture();
    await f.access.authorization(f.authorization.accountId, "rejected-token");
    expect(f.authorize).toHaveBeenCalledWith(
      f.authorization.accountId,
      expect.any(AbortSignal),
      "rejected-token",
    );
    f.authorize.mockImplementationOnce(async () => {
      f.switchAccount(randomUUID());
      return f.authorization;
    });
    await expect(f.access.authorization()).rejects.toThrow("ACCOUNT_CHANGED");
    await expect(f.access.authorization(f.authorization.accountId)).rejects.toThrow(
      "AUTHENTICATION_REQUIRED",
    );
  });
});
