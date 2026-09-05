import { randomBytes } from "node:crypto";
import type {
  OAuthClientInformationContext,
  OAuthClientMetadata,
  OAuthClientProvider,
  OAuthDiscoveryState,
  StoredOAuthClientInformation,
  StoredOAuthTokens,
} from "@modelcontextprotocol/client";
import { desktopBrand } from "../../branding/src/index";
import type {
  CredentialResolver,
  CredentialStore,
  OAuthCallbackSession,
  OAuthInteractionHost,
} from "./types";

interface StoredTokenEntry {
  tokens: StoredOAuthTokens;
  savedAt: string;
}

interface PersistedMcpOAuthCredential {
  version: 2;
  grantType: "authorization_code";
  clientId: string | null;
  scope: string | null;
  clientsByIssuer: Record<string, StoredOAuthClientInformation>;
  tokensByIssuer: Record<string, StoredTokenEntry>;
  latestIssuer: string | null;
  codeVerifier: string | null;
  discoveryState: OAuthDiscoveryState | null;
  redirectUrl: string | null;
}

export interface McpOAuthCredentialInspection {
  authorized: boolean;
  expiresAt: string | null;
}

export interface InteractiveMcpOAuthProvider extends OAuthClientProvider {
  takeCallbackParams(): URLSearchParams | null;
  close(): Promise<void>;
}

function object(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseCredential(value: string): PersistedMcpOAuthCredential {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("MCP_OAUTH_CREDENTIAL_INVALID");
  }
  if (
    object(parsed) &&
    parsed.grantType === "client_credentials" &&
    typeof parsed.clientSecret === "string"
  ) {
    throw new Error("MCP_OAUTH_LEGACY_CLIENT_CREDENTIALS_UNSUPPORTED");
  }
  if (
    !object(parsed) ||
    parsed.version !== 2 ||
    parsed.grantType !== "authorization_code" ||
    (parsed.clientId !== null && typeof parsed.clientId !== "string") ||
    (parsed.scope !== null && typeof parsed.scope !== "string") ||
    !object(parsed.clientsByIssuer) ||
    !object(parsed.tokensByIssuer) ||
    (parsed.latestIssuer !== null && typeof parsed.latestIssuer !== "string") ||
    (parsed.codeVerifier !== null && typeof parsed.codeVerifier !== "string") ||
    (parsed.discoveryState !== null && !object(parsed.discoveryState)) ||
    (parsed.redirectUrl !== null && typeof parsed.redirectUrl !== "string")
  ) {
    throw new Error("MCP_OAUTH_CREDENTIAL_INVALID");
  }
  return parsed as unknown as PersistedMcpOAuthCredential;
}

function initialCredential(input: {
  clientId?: string;
  scope?: string;
}): PersistedMcpOAuthCredential {
  return {
    version: 2,
    grantType: "authorization_code",
    clientId: input.clientId?.trim() || null,
    scope: input.scope?.trim() || null,
    clientsByIssuer: {},
    tokensByIssuer: {},
    latestIssuer: null,
    codeVerifier: null,
    discoveryState: null,
    redirectUrl: null,
  };
}

export function createMcpOAuthCredentialValue(input: {
  clientId?: string;
  scope?: string;
}): string {
  return JSON.stringify(initialCredential(input));
}

export async function inspectMcpOAuthCredential(
  credentials: CredentialResolver,
  credentialRef: string,
): Promise<McpOAuthCredentialInspection> {
  const state = parseCredential(await credentials.resolve(credentialRef));
  const entry = state.latestIssuer ? state.tokensByIssuer[state.latestIssuer] : undefined;
  if (!entry) return { authorized: false, expiresAt: null };
  const expiresIn = entry.tokens.expires_in;
  const savedAt = Date.parse(entry.savedAt);
  const expiresAt =
    typeof expiresIn === "number" && Number.isFinite(savedAt)
      ? new Date(savedAt + expiresIn * 1_000).toISOString()
      : null;
  const expired = expiresAt !== null && Date.parse(expiresAt) <= Date.now();
  const refreshable = Boolean(entry.tokens.refresh_token);
  return {
    authorized: Boolean(entry.tokens.access_token) && (!expired || refreshable),
    expiresAt,
  };
}

function issuerKey(
  state: PersistedMcpOAuthCredential,
  context?: OAuthClientInformationContext,
): string {
  return context?.issuer ?? state.latestIssuer ?? "default";
}

function sameCallbackTarget(callbackUrl: URL, redirectUrl: URL): boolean {
  return callbackUrl.origin === redirectUrl.origin && callbackUrl.pathname === redirectUrl.pathname;
}

export class DesktopMcpOAuthProvider implements InteractiveMcpOAuthProvider {
  readonly #stateValue: string;
  #callbackParams: URLSearchParams | null = null;

  private constructor(
    private readonly credentialRef: string,
    private readonly credentials: CredentialStore,
    private readonly stateValue: PersistedMcpOAuthCredential,
    private readonly interactions: OAuthInteractionHost | null,
    private readonly callbackSession: OAuthCallbackSession | null,
  ) {
    this.#stateValue = randomBytes(32).toString("base64url");
  }

  static async create(input: {
    credentialRef: string;
    credentials: CredentialStore;
    interactions?: OAuthInteractionHost;
    callbackSession?: OAuthCallbackSession;
  }): Promise<DesktopMcpOAuthProvider> {
    const state = parseCredential(await input.credentials.resolve(input.credentialRef));
    if (input.callbackSession) {
      state.redirectUrl = input.callbackSession.redirectUrl;
      await input.credentials.save(input.credentialRef, JSON.stringify(state));
    }
    return new DesktopMcpOAuthProvider(
      input.credentialRef,
      input.credentials,
      state,
      input.interactions ?? null,
      input.callbackSession ?? null,
    );
  }

  get redirectUrl(): string {
    return (
      this.callbackSession?.redirectUrl ??
      this.stateValue.redirectUrl ??
      "http://127.0.0.1/callback"
    );
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: `${desktopBrand.productName} Desktop`,
      redirect_uris: [this.redirectUrl],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      ...(this.stateValue.scope ? { scope: this.stateValue.scope } : {}),
    };
  }

  state(): string {
    return this.#stateValue;
  }

  clientInformation(
    context?: OAuthClientInformationContext,
  ): StoredOAuthClientInformation | undefined {
    const saved = this.stateValue.clientsByIssuer[issuerKey(this.stateValue, context)];
    if (saved) return saved;
    return this.stateValue.clientId ? { client_id: this.stateValue.clientId } : undefined;
  }

  async saveClientInformation(
    clientInformation: StoredOAuthClientInformation,
    context?: OAuthClientInformationContext,
  ): Promise<void> {
    const key = context?.issuer ?? clientInformation.issuer ?? "default";
    this.stateValue.clientsByIssuer[key] = clientInformation;
    this.stateValue.latestIssuer = key;
    await this.#persist();
  }

  tokens(context?: OAuthClientInformationContext): StoredOAuthTokens | undefined {
    return this.stateValue.tokensByIssuer[issuerKey(this.stateValue, context)]?.tokens;
  }

  async saveTokens(
    tokens: StoredOAuthTokens,
    context?: OAuthClientInformationContext,
  ): Promise<void> {
    const key = context?.issuer ?? tokens.issuer ?? "default";
    this.stateValue.tokensByIssuer[key] = { tokens, savedAt: new Date().toISOString() };
    this.stateValue.latestIssuer = key;
    this.stateValue.codeVerifier = null;
    await this.#persist();
  }

  async redirectToAuthorization(authorizationUrl: URL): Promise<void> {
    if (!this.interactions || !this.callbackSession) {
      throw new Error("MCP_OAUTH_AUTHORIZATION_REQUIRED");
    }
    const callback = new URL(
      await this.interactions.waitForOAuthCallback(
        this.callbackSession.sessionId,
        authorizationUrl.toString(),
      ),
    );
    const redirect = new URL(this.callbackSession.redirectUrl);
    if (!sameCallbackTarget(callback, redirect)) throw new Error("MCP_OAUTH_CALLBACK_MISMATCH");
    if (callback.searchParams.get("state") !== this.#stateValue) {
      throw new Error("MCP_OAUTH_STATE_MISMATCH");
    }
    const error = callback.searchParams.get("error");
    if (error)
      throw new Error(`MCP_OAUTH_DENIED_${error.toUpperCase().replace(/[^A-Z0-9]+/gu, "_")}`);
    if (!callback.searchParams.get("code")) throw new Error("MCP_OAUTH_CODE_MISSING");
    this.#callbackParams = new URLSearchParams(callback.searchParams);
  }

  async saveCodeVerifier(codeVerifier: string): Promise<void> {
    this.stateValue.codeVerifier = codeVerifier;
    await this.#persist();
  }

  codeVerifier(): string {
    if (!this.stateValue.codeVerifier) throw new Error("MCP_OAUTH_CODE_VERIFIER_MISSING");
    return this.stateValue.codeVerifier;
  }

  async invalidateCredentials(
    scope: "all" | "client" | "tokens" | "verifier" | "discovery",
  ): Promise<void> {
    if (scope === "all" || scope === "client") this.stateValue.clientsByIssuer = {};
    if (scope === "all" || scope === "tokens") {
      this.stateValue.tokensByIssuer = {};
      this.stateValue.latestIssuer = null;
    }
    if (scope === "all" || scope === "verifier") this.stateValue.codeVerifier = null;
    if (scope === "all" || scope === "discovery") this.stateValue.discoveryState = null;
    await this.#persist();
  }

  async saveDiscoveryState(state: OAuthDiscoveryState): Promise<void> {
    this.stateValue.discoveryState = state;
    await this.#persist();
  }

  discoveryState(): OAuthDiscoveryState | undefined {
    return this.stateValue.discoveryState ?? undefined;
  }

  takeCallbackParams(): URLSearchParams | null {
    const value = this.#callbackParams;
    this.#callbackParams = null;
    return value;
  }

  async close(): Promise<void> {
    if (this.interactions && this.callbackSession) {
      await this.interactions.cancelOAuth(this.callbackSession.sessionId).catch(() => undefined);
    }
  }

  async #persist(): Promise<void> {
    await this.credentials.save(this.credentialRef, JSON.stringify(this.stateValue));
  }
}
