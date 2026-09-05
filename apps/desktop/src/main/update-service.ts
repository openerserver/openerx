import { readFileSync } from "node:fs";
import path from "node:path";
import {
  type ReleaseArch,
  type ReleasePlatform,
  type ReleaseUpdateConfiguration,
  type ReleaseUpdateState,
  releaseUpdateConfigurationSchema,
  releaseUpdateStateSchema,
  signedReleaseManifestSchema,
} from "@openerx/contracts";
import {
  assertReleaseChannel,
  isReleaseEligible,
  selectReleaseArtifact,
  verifySignedReleaseManifest,
} from "@openerx/release";

type AutoUpdaterEvent =
  | "checking-for-update"
  | "update-available"
  | "update-not-available"
  | "download-progress"
  | "update-downloaded"
  | "error";

export interface DesktopAutoUpdater {
  on(event: AutoUpdaterEvent, listener: (...arguments_: unknown[]) => void): void;
  setFeedURL(options: { url: string; headers?: Record<string, string> }): void;
  checkForUpdates(): Promise<unknown>;
  quitAndInstall(): void;
}

export interface DesktopUpdateServiceOptions {
  configuration: ReleaseUpdateConfiguration;
  currentVersion: string;
  platform: ReleasePlatform;
  arch: ReleaseArch;
  cohortId: string;
  updater: DesktopAutoUpdater;
  fetch?: typeof fetch;
  now?: () => Date;
}

const disabledUpdateConfiguration: ReleaseUpdateConfiguration = {
  enabled: false,
  channel: "internal",
  manifestUrl: null,
  keyId: null,
  publicKeyPem: null,
};

export function loadPackagedUpdateConfiguration(appPath: string): ReleaseUpdateConfiguration {
  const filePath = path.join(appPath, "release", "update-config.json");
  return releaseUpdateConfigurationSchema.parse(JSON.parse(readFileSync(filePath, "utf8")));
}

export function developmentUpdateConfiguration(): ReleaseUpdateConfiguration {
  return structuredClone(disabledUpdateConfiguration);
}

function updateErrorCode(error: unknown): string {
  if (error instanceof Error) {
    const code = error.message.split(":", 1)[0] ?? "";
    if (/^[A-Z0-9_]{2,80}$/u.test(code)) return code;
  }
  return "RELEASE_UPDATE_FAILED";
}

export class DesktopUpdateService {
  readonly #configuration: ReleaseUpdateConfiguration;
  readonly #currentVersion: string;
  readonly #platform: ReleasePlatform;
  readonly #arch: ReleaseArch;
  readonly #cohortId: string;
  readonly #updater: DesktopAutoUpdater;
  readonly #fetch: typeof fetch;
  readonly #now: () => Date;
  readonly #listeners = new Set<(state: ReleaseUpdateState) => void>();
  #state: ReleaseUpdateState;

  constructor(options: DesktopUpdateServiceOptions) {
    this.#configuration = releaseUpdateConfigurationSchema.parse(options.configuration);
    this.#currentVersion = options.currentVersion;
    this.#platform = options.platform;
    this.#arch = options.arch;
    this.#cohortId = options.cohortId;
    this.#updater = options.updater;
    this.#fetch = options.fetch ?? fetch;
    this.#now = options.now ?? (() => new Date());
    this.#state = releaseUpdateStateSchema.parse({
      status: this.#configuration.enabled ? "idle" : "disabled",
      channel: this.#configuration.channel,
      currentVersion: this.#currentVersion,
      availableVersion: null,
      progressPercentage: null,
      lastCheckedAt: null,
      reason: this.#configuration.enabled ? null : "UPDATE_NOT_CONFIGURED",
    });
    this.#bindUpdater();
  }

  state(): ReleaseUpdateState {
    return structuredClone(this.#state);
  }

  onState(listener: (state: ReleaseUpdateState) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  async check(): Promise<ReleaseUpdateState> {
    if (!this.#configuration.enabled) return this.state();
    if (this.#state.status === "checking" || this.#state.status === "downloading") {
      return this.state();
    }
    this.#set({ status: "checking", progressPercentage: null, reason: null });
    try {
      const response = await this.#fetch(this.#configuration.manifestUrl, {
        method: "GET",
        cache: "no-store",
        headers: { accept: "application/json" },
      });
      if (!response.ok) throw new Error(`RELEASE_MANIFEST_HTTP_${response.status}`);
      const contentLength = Number(response.headers.get("content-length") ?? "0");
      if (contentLength > 1_048_576) throw new Error("RELEASE_MANIFEST_TOO_LARGE");
      const raw = await response.text();
      if (Buffer.byteLength(raw, "utf8") > 1_048_576) throw new Error("RELEASE_MANIFEST_TOO_LARGE");
      const envelope = signedReleaseManifestSchema.parse(JSON.parse(raw));
      const manifest = verifySignedReleaseManifest(
        envelope,
        this.#configuration.keyId,
        this.#configuration.publicKeyPem,
      );
      assertReleaseChannel(manifest.channel, this.#configuration.channel);
      if (Date.parse(manifest.publishedAt) > this.#now().getTime() + 5 * 60_000) {
        throw new Error("RELEASE_MANIFEST_FROM_FUTURE");
      }
      const checkedAt = this.#now().toISOString();
      if (!isReleaseEligible(manifest, this.#currentVersion, this.#cohortId)) {
        this.#set({
          status: "up_to_date",
          availableVersion: null,
          progressPercentage: null,
          lastCheckedAt: checkedAt,
          reason: null,
        });
        return this.state();
      }
      const artifact = selectReleaseArtifact(manifest, this.#platform, this.#arch);
      this.#updater.setFeedURL({
        url: artifact.feedUrl,
        headers: { "X-OpenerX-Manifest-Key": manifest.keyId },
      });
      this.#set({
        status: "available",
        availableVersion: manifest.version,
        progressPercentage: 0,
        lastCheckedAt: checkedAt,
        reason: null,
      });
      await this.#updater.checkForUpdates();
      return this.state();
    } catch (error) {
      this.#set({
        status: "error",
        progressPercentage: null,
        lastCheckedAt: this.#now().toISOString(),
        reason: updateErrorCode(error),
      });
      return this.state();
    }
  }

  install(): ReleaseUpdateState {
    if (this.#state.status !== "downloaded") {
      this.#set({ reason: "UPDATE_NOT_DOWNLOADED" });
      return this.state();
    }
    this.#updater.quitAndInstall();
    return this.state();
  }

  #bindUpdater(): void {
    this.#updater.on("checking-for-update", () => this.#set({ status: "checking" }));
    this.#updater.on("update-available", () => this.#set({ status: "downloading" }));
    this.#updater.on("update-not-available", () =>
      this.#set({ status: "up_to_date", progressPercentage: null }),
    );
    this.#updater.on("download-progress", (progress) => {
      const percentage =
        progress && typeof progress === "object" && "percent" in progress
          ? Number((progress as { percent: unknown }).percent)
          : Number.NaN;
      this.#set({
        status: "downloading",
        progressPercentage: Number.isFinite(percentage)
          ? Math.min(100, Math.max(0, percentage))
          : this.#state.progressPercentage,
      });
    });
    this.#updater.on("update-downloaded", () =>
      this.#set({ status: "downloaded", progressPercentage: 100 }),
    );
    this.#updater.on("error", () =>
      this.#set({ status: "error", progressPercentage: null, reason: "NATIVE_UPDATER_ERROR" }),
    );
  }

  #set(values: Partial<ReleaseUpdateState>): void {
    this.#state = releaseUpdateStateSchema.parse({ ...this.#state, ...values });
    const state = this.state();
    for (const listener of this.#listeners) listener(state);
  }
}
