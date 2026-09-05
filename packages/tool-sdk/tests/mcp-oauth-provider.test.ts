import { describe, expect, it, vi } from "vitest";
import {
  createMcpOAuthCredentialValue,
  DesktopMcpOAuthProvider,
  inspectMcpOAuthCredential,
} from "../src";

function credentialStore(initial: string) {
  let value = initial;
  return {
    resolve: vi.fn(async () => value),
    save: vi.fn(async (_credentialRef: string, next: string) => {
      value = next;
    }),
    clear: vi.fn(async () => {
      value = "";
    }),
    value: () => value,
  };
}

describe("DesktopMcpOAuthProvider", () => {
  it("validates state and persists PKCE, registered client and tokens in the credential store", async () => {
    const credentials = credentialStore(
      createMcpOAuthCredentialValue({ scope: "tools.read tools.write" }),
    );
    const redirectUrl = "http://127.0.0.1:43111/oauth/mcp/callback";
    let expectedState = "";
    const interactions = {
      prepareOAuth: vi.fn(),
      waitForOAuthCallback: vi.fn(async () => `${redirectUrl}?code=code-1&state=${expectedState}`),
      cancelOAuth: vi.fn(async () => undefined),
    };
    const provider = await DesktopMcpOAuthProvider.create({
      credentialRef: "mcp:test",
      credentials,
      interactions,
      callbackSession: {
        sessionId: "00000000-0000-4000-8000-000000000701",
        redirectUrl,
      },
    });
    expectedState = provider.state();
    expect(provider.clientMetadata).toMatchObject({
      redirect_uris: [redirectUrl],
      grant_types: ["authorization_code", "refresh_token"],
      token_endpoint_auth_method: "none",
      scope: "tools.read tools.write",
    });

    await provider.saveCodeVerifier("verifier-123");
    expect(provider.codeVerifier()).toBe("verifier-123");
    expect(credentials.value()).toContain("verifier-123");
    await provider.redirectToAuthorization(
      new URL(`https://identity.example/authorize?state=${expectedState}`),
    );
    expect(provider.takeCallbackParams()?.get("code")).toBe("code-1");
    await provider.saveClientInformation(
      { client_id: "dynamic-client", issuer: "https://identity.example" },
      { issuer: "https://identity.example" },
    );
    await provider.saveTokens(
      {
        access_token: "access-token",
        refresh_token: "refresh-token",
        token_type: "Bearer",
        expires_in: 3_600,
        issuer: "https://identity.example",
      },
      { issuer: "https://identity.example" },
    );

    await expect(inspectMcpOAuthCredential(credentials, "mcp:test")).resolves.toMatchObject({
      authorized: true,
      expiresAt: expect.any(String),
    });
    expect(credentials.value()).toContain("access-token");
    expect(credentials.value()).not.toContain("verifier-123");
    await provider.close();
    expect(interactions.cancelOAuth).toHaveBeenCalled();
  });

  it("rejects a callback whose state does not match", async () => {
    const credentials = credentialStore(createMcpOAuthCredentialValue({}));
    const redirectUrl = "http://127.0.0.1:43111/oauth/mcp/callback";
    const provider = await DesktopMcpOAuthProvider.create({
      credentialRef: "mcp:test",
      credentials,
      interactions: {
        prepareOAuth: vi.fn(),
        waitForOAuthCallback: vi.fn(async () => `${redirectUrl}?code=code-1&state=attacker`),
        cancelOAuth: vi.fn(),
      },
      callbackSession: {
        sessionId: "00000000-0000-4000-8000-000000000701",
        redirectUrl,
      },
    });
    await expect(
      provider.redirectToAuthorization(new URL("https://identity.example/authorize")),
    ).rejects.toThrow("MCP_OAUTH_STATE_MISMATCH");
  });

  it("marks the previous client-credentials payload unavailable instead of silently using it", async () => {
    const credentials = credentialStore(
      JSON.stringify({
        grantType: "client_credentials",
        clientId: "legacy",
        clientSecret: "legacy-secret",
      }),
    );
    await expect(inspectMcpOAuthCredential(credentials, "mcp:test")).rejects.toThrow(
      "MCP_OAUTH_LEGACY_CLIENT_CREDENTIALS_UNSUPPORTED",
    );
  });

  it("requires authorization again for an expired token that cannot be refreshed", async () => {
    const expired = JSON.parse(createMcpOAuthCredentialValue({})) as Record<string, unknown>;
    expired.latestIssuer = "https://identity.example";
    expired.tokensByIssuer = {
      "https://identity.example": {
        savedAt: "2020-01-01T00:00:00.000Z",
        tokens: { access_token: "expired", token_type: "Bearer", expires_in: 60 },
      },
    };
    const credentials = credentialStore(JSON.stringify(expired));

    await expect(inspectMcpOAuthCredential(credentials, "mcp:test")).resolves.toMatchObject({
      authorized: false,
      expiresAt: "2020-01-01T00:01:00.000Z",
    });
  });
});
