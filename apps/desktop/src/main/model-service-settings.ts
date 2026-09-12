import { lookup } from "node:dns/promises";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { isIP } from "node:net";
import path from "node:path";
import {
  type AppServiceByokConfiguration,
  type ByokConnectionTestResult,
  type ByokModelConfiguration,
  type ByokProviderId,
  byokConnectionTestResultSchema,
  byokProviderPresets,
  classifyModelError,
  defaultByokModelConfiguration,
  type ModelServiceSettings,
  type ModelServiceSettingsUpdate,
  modelServiceSettingsSchema,
  modelServiceSettingsUpdateSchema,
  resolveByokModelPreset,
} from "@openerx/contracts";
import { isUnreadableCredentialError, type ToolCredentialVault } from "./credential-vault";

const credentialRef = "model-service:byok:api-key";

function providerCredentialRef(providerId: ByokProviderId): string {
  return `model-service:byok:${providerId}:api-key`;
}

function matchingProvider(configuration: ByokModelConfiguration | null | undefined) {
  if (!configuration) return null;
  return (
    byokProviderPresets.find((provider) =>
      provider.models.some(
        (model) => model.configuration.baseUrl === configuration.baseUrl.replace(/\/$/u, ""),
      ),
    ) ?? null
  );
}

type HostResolver = (hostname: string) => Promise<string[]>;

const resolveHost: HostResolver = async (hostname) =>
  (await lookup(hostname, { all: true, verbatim: true })).map(({ address }) => address);

function normalizedHostname(hostname: string): string {
  return hostname.replace(/^\[|\]$/gu, "").toLowerCase();
}

function isLoopbackAddress(address: string): boolean {
  const normalized = normalizedHostname(address);
  return (
    normalized === "::1" || normalized.startsWith("127.") || normalized.startsWith("::ffff:127.")
  );
}

function isPublicIpv4(address: string): boolean {
  const octets = address.split(".").map(Number);
  const [a = -1, b = -1, c = -1] = octets;
  if (
    octets.length !== 4 ||
    octets.some((value) => !Number.isInteger(value) || value < 0 || value > 255)
  ) {
    return false;
  }
  return !(
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && c === 0) ||
    (a === 192 && b === 0 && c === 2) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113) ||
    a >= 224
  );
}

function isPublicAddress(address: string): boolean {
  const normalized = normalizedHostname(address);
  if (normalized.startsWith("::ffff:")) return isPublicIpv4(normalized.slice(7));
  if (isIP(normalized) === 4) return isPublicIpv4(normalized);
  if (isIP(normalized) !== 6) return false;
  return !(
    normalized === "::" ||
    normalized === "::1" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    /^fe[89ab]/u.test(normalized) ||
    normalized.startsWith("ff") ||
    normalized.startsWith("2001:db8:")
  );
}

function assertSafeBaseUrl(value: string): string {
  const url = new URL(value);
  if (url.username || url.password) throw new Error("BYOK_BASE_URL_CREDENTIALS_FORBIDDEN");
  if (url.search || url.hash) throw new Error("BYOK_BASE_URL_QUERY_FORBIDDEN");
  const hostname = normalizedHostname(url.hostname);
  const loopback = hostname === "localhost" || isLoopbackAddress(hostname);
  if (url.protocol !== "https:" && !(loopback && url.protocol === "http:")) {
    throw new Error("BYOK_INSECURE_REMOTE_URL");
  }
  return url.toString().replace(/\/$/u, "");
}

async function assertSafeResolvedHost(baseUrl: string, resolver: HostResolver): Promise<void> {
  const hostname = normalizedHostname(new URL(baseUrl).hostname);
  let addresses: string[];
  try {
    addresses = isIP(hostname) > 0 ? [hostname] : await resolver(hostname);
  } catch {
    throw new Error("BYOK_HOST_RESOLUTION_FAILED");
  }
  if (addresses.length === 0) throw new Error("BYOK_HOST_RESOLUTION_FAILED");
  if (hostname === "localhost" || isLoopbackAddress(hostname)) {
    if (addresses.some((address) => !isLoopbackAddress(address))) {
      throw new Error("BYOK_PRIVATE_NETWORK_FORBIDDEN");
    }
    return;
  }
  if (addresses.some((address) => !isPublicAddress(address))) {
    throw new Error("BYOK_PRIVATE_NETWORK_FORBIDDEN");
  }
}

export class ModelServiceSettingsStore {
  constructor(
    private readonly filePath: string,
    private readonly credentials: ToolCredentialVault,
    private readonly resolver: HostResolver = resolveHost,
  ) {}

  async state(): Promise<ModelServiceSettings> {
    let stored: Omit<
      ModelServiceSettings,
      "credentialConfigured" | "providerCredentials" | "credentialIssue"
    > = {
      mode: "byok",
      byok: defaultByokModelConfiguration(),
      updatedAt: null,
    };
    try {
      stored = JSON.parse(await readFile(this.filePath, "utf8"));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    let references: string[] = [];
    let credentialIssue: ModelServiceSettings["credentialIssue"] = null;
    try {
      references = await this.credentials.references();
    } catch (error) {
      if (isUnreadableCredentialError(error)) credentialIssue = "unreadable";
      else if (error instanceof Error && error.message === "OS_CREDENTIAL_STORE_UNAVAILABLE")
        credentialIssue = "unavailable";
      else throw error;
    }
    const credentialConfigured = references.includes(credentialRef);
    const legacyProvider = credentialConfigured ? matchingProvider(stored.byok) : null;
    const providerCredentials: Partial<Record<ByokProviderId, boolean>> = {};
    for (const provider of byokProviderPresets) {
      providerCredentials[provider.id] =
        references.includes(providerCredentialRef(provider.id)) ||
        legacyProvider?.id === provider.id;
    }
    return modelServiceSettingsSchema.parse({
      ...stored,
      credentialConfigured,
      providerCredentials,
      credentialIssue,
    });
  }

  async update(raw: ModelServiceSettingsUpdate): Promise<ModelServiceSettings> {
    const input = modelServiceSettingsUpdateSchema.parse(raw);
    const byok = input.byok
      ? { ...input.byok, baseUrl: assertSafeBaseUrl(input.byok.baseUrl) }
      : null;
    const values: Record<string, string> = {};
    if (input.apiKey) values[credentialRef] = input.apiKey;
    for (const [providerId, apiKey] of Object.entries(input.providerApiKeys ?? {})) {
      values[providerCredentialRef(providerId as ByokProviderId)] = apiKey;
    }
    if (input.recoverUnreadableCredentials) await this.credentials.recoverUnreadable(values);
    else if (Object.keys(values).length > 0) await this.credentials.saveMany(values);
    const current = await this.state();
    const hasProviderCredential = Object.values(current.providerCredentials).some(Boolean);
    if (
      input.mode === "byok" &&
      !input.apiKey &&
      Object.keys(input.providerApiKeys ?? {}).length === 0 &&
      !current.credentialConfigured &&
      !hasProviderCredential
    ) {
      throw new Error("BYOK_API_KEY_REQUIRED");
    }
    const stored = {
      mode: input.mode,
      byok,
      providerModels: input.providerModels ?? current.providerModels,
      updatedAt: new Date().toISOString(),
    };
    await mkdir(path.dirname(this.filePath), { recursive: true, mode: 0o700 });
    const temporaryPath = `${this.filePath}.tmp`;
    try {
      await writeFile(temporaryPath, JSON.stringify(stored), { encoding: "utf8", mode: 0o600 });
      await rename(temporaryPath, this.filePath);
    } finally {
      await rm(temporaryPath, { force: true });
    }
    return await this.state();
  }

  async clearApiKey(providerId?: ByokProviderId): Promise<ModelServiceSettings> {
    if (!providerId) {
      await this.credentials.clear(credentialRef);
      return await this.state();
    }
    const current = await this.state();
    await this.credentials.clear(providerCredentialRef(providerId));
    if (current.credentialConfigured && matchingProvider(current.byok)?.id === providerId) {
      await this.credentials.clear(credentialRef);
    }
    return await this.state();
  }

  async execution(modelRef?: string): Promise<AppServiceByokConfiguration | undefined> {
    const state = await this.state();
    if (state.mode !== "byok") return undefined;
    const requested = modelRef ? resolveByokModelPreset(modelRef, state.providerModels) : null;
    if (modelRef?.includes(".custom-") && !requested) throw new Error("BYOK_MODEL_NOT_FOUND");
    const storedProvider = matchingProvider(state.byok);
    const selectedProvider =
      requested?.provider ??
      (storedProvider && state.providerCredentials[storedProvider.id] ? storedProvider : null) ??
      byokProviderPresets.find(({ id }) => state.providerCredentials[id]) ??
      null;
    const selectedModel = requested?.model ?? selectedProvider?.models[0] ?? null;
    if (selectedProvider && selectedModel) {
      let apiKey: string;
      try {
        apiKey = await this.credentials.resolve(providerCredentialRef(selectedProvider.id));
      } catch {
        if (!state.credentialConfigured || storedProvider?.id !== selectedProvider.id) {
          return undefined;
        }
        apiKey = await this.credentials.resolve(credentialRef);
      }
      await assertSafeResolvedHost(selectedModel.configuration.baseUrl, this.resolver);
      return { ...selectedModel.configuration, apiKey };
    }
    if (!state.byok || !state.credentialConfigured) return undefined;
    await assertSafeResolvedHost(state.byok.baseUrl, this.resolver);
    return { ...state.byok, apiKey: await this.credentials.resolve(credentialRef) };
  }

  async test(raw: ModelServiceSettingsUpdate): Promise<ByokConnectionTestResult> {
    const input = modelServiceSettingsUpdateSchema.parse(raw);
    if (!input.byok) throw new Error("BYOK_NOT_CONFIGURED");
    const baseUrl = assertSafeBaseUrl(input.byok.baseUrl);
    await assertSafeResolvedHost(baseUrl, this.resolver);
    const provider = matchingProvider(input.byok);
    let apiKey = provider ? input.providerApiKeys?.[provider.id] : undefined;
    if (!apiKey && provider) {
      try {
        apiKey = await this.credentials.resolve(providerCredentialRef(provider.id));
      } catch {
        apiKey = undefined;
      }
    }
    apiKey ??= input.apiKey ?? (await this.credentials.resolve(credentialRef));
    const started = performance.now();
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: input.byok.modelId,
        messages: [{ role: "user", content: "Reply with OK." }],
        max_tokens: 8,
        stream: false,
      }),
      signal: AbortSignal.timeout(20_000),
      redirect: "error",
    }).catch((error: unknown) => {
      throw new Error(classifyModelError(error).code);
    });
    const payload: unknown = await response.json().catch(() => {
      throw new Error(
        response.ok
          ? "MODEL_RESPONSE_INVALID"
          : classifyModelError("", { httpStatus: response.status }).code,
      );
    });
    const body = (payload && typeof payload === "object" ? payload : {}) as {
      model?: unknown;
      choices?: Array<{ message?: { content?: unknown } }>;
      error?: unknown;
    };
    if (!response.ok)
      throw new Error(
        classifyModelError(JSON.stringify(body.error ?? {}), { httpStatus: response.status }).code,
      );
    if (
      !Array.isArray(body.choices) ||
      !body.choices.some(
        (choice) =>
          typeof choice?.message?.content === "string" && choice.message.content.trim().length > 0,
      )
    ) {
      throw new Error("MODEL_RESPONSE_INVALID");
    }
    return byokConnectionTestResultSchema.parse({
      ok: true,
      latencyMs: Math.round(performance.now() - started),
      reportedModel: typeof body.model === "string" ? body.model : null,
    });
  }
}
