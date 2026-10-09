import {
  type HostedModelAccountProvider,
  type ModelServiceSettings,
  modelAuthorizationSchema,
} from "@openerx/contracts";

/** The provider lives in Main; refresh tokens never cross into renderer or workers. */
export class HostedModelAccess {
  #provider: HostedModelAccountProvider | null = null;
  register(provider: HostedModelAccountProvider): () => void {
    if (this.#provider) throw new Error("MODEL_PROVIDER_ALREADY_REGISTERED");
    this.#provider = provider;
    return () => {
      if (this.#provider === provider) this.#provider = null;
    };
  }
  accountId(): string | null {
    return this.#provider?.accountId() ?? null;
  }
  configured(): boolean {
    return this.#provider !== null;
  }
  settings(settings: ModelServiceSettings): ModelServiceSettings {
    if (!this.#provider) return settings;
    const accountId = this.accountId();
    const automatic =
      settings.updatedAt === null &&
      !settings.credentialConfigured &&
      !Object.values(settings.providerCredentials).some(Boolean);
    return {
      ...settings,
      mode: automatic && accountId ? "hosted" : settings.mode,
      hostedAccountId: accountId,
      hostedAvailable: true,
    };
  }
  async authorization(accountId = this.accountId(), rejectedAccessToken?: string) {
    const provider = this.#provider;
    if (!provider || !accountId || provider.accountId() !== accountId)
      throw new Error("AUTHENTICATION_REQUIRED");
    const result = modelAuthorizationSchema.parse(
      await provider.authorize(accountId, AbortSignal.timeout(15_000), rejectedAccessToken),
    );
    if (
      provider !== this.#provider ||
      provider.accountId() !== accountId ||
      result.accountId !== accountId ||
      result.modelApiVersion !== "v3"
    )
      throw new Error("ACCOUNT_CHANGED");
    return result;
  }
}
