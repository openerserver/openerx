import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  type BrowserPermissionUpdate,
  type BrowserSitePolicy,
  browserSitePolicySchema,
} from "@openerx/contracts";
import { BrowserObservationError } from "./ui-observation-registry";

export type BrowserSiteDecision = "task" | "site" | "all" | "block" | "deny";
export function browserSiteHost(value: string): string {
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password)
    throw new BrowserObservationError("BROWSER_NAVIGATION_DENIED");
  return url.hostname.toLowerCase().replace(/\.$/u, "");
}
function normalizeHost(value: string): string {
  const host = browserSiteHost(`https://${value}`);
  if (value.includes("*") || value.toLowerCase().replace(/\.$/u, "") !== host)
    throw new Error("请输入完整的网站域名，不要包含路径、端口或通配符");
  return host;
}

/** Website permission survives tab changes; task grants never survive a task or connection. */
export class BrowserSitePermissions {
  #policy: BrowserSitePolicy = { allowAllSites: false, allowedHosts: [], blockedHosts: [] };
  #once = new Map<string, Set<string>>();
  #pending = new Map<string, Promise<void>>();
  #revision = 0;
  readonly #file: string;
  constructor(
    directory: string,
    private readonly prompt: (host: string, signal: AbortSignal) => Promise<BrowserSiteDecision>,
  ) {
    this.#file = path.join(directory, "browser-site-permissions.json");
    try {
      const parsed = browserSitePolicySchema.parse(JSON.parse(readFileSync(this.#file, "utf8")));
      this.#policy = {
        ...parsed,
        allowedHosts: parsed.allowedHosts.map(normalizeHost),
        blockedHosts: parsed.blockedHosts.map(normalizeHost),
      };
    } catch {
      /* A missing or invalid policy starts with asking for each new site. */
    }
  }
  get policy(): BrowserSitePolicy {
    return structuredClone(this.#policy);
  }
  allows(url: string, scope: string): boolean {
    const host = browserSiteHost(url);
    return (
      !this.#policy.blockedHosts.includes(host) &&
      (this.#policy.allowAllSites ||
        this.#policy.allowedHosts.includes(host) ||
        !!this.#once.get(scope)?.has(host))
    );
  }
  update(input: Exclude<BrowserPermissionUpdate, { action: "disconnect" }>): void {
    const next = this.policy;
    if (input.action === "all_sites") next.allowAllSites = input.allowed;
    else {
      const host = normalizeHost(input.host.trim());
      next.allowedHosts = next.allowedHosts.filter((value) => value !== host);
      next.blockedHosts = next.blockedHosts.filter((value) => value !== host);
      if (input.decision === "allow") next.allowedHosts.push(host);
      if (input.decision === "block") next.blockedHosts.push(host);
      for (const granted of this.#once.values()) granted.delete(host);
    }
    mkdirSync(path.dirname(this.#file), { recursive: true });
    const temporary = `${this.#file}.${randomUUID()}.tmp`;
    writeFileSync(temporary, JSON.stringify(next), { mode: 0o600 });
    renameSync(temporary, this.#file);
    this.#policy = next;
    this.#revision++;
  }
  async require(url: string, scope: string, signal: AbortSignal): Promise<void> {
    if (signal.aborted) throw new BrowserObservationError("BROWSER_CANCELLED");
    const host = browserSiteHost(url);
    if (this.allows(url, scope)) return;
    if (this.#policy.blockedHosts.includes(host))
      throw new BrowserObservationError("BROWSER_NAVIGATION_DENIED");
    const key = `${scope}:${host}`;
    const existing = this.#pending.get(key);
    if (existing) {
      await existing;
      if (signal.aborted) throw new BrowserObservationError("BROWSER_CANCELLED");
      if (!this.allows(url, scope)) throw new BrowserObservationError("BROWSER_NAVIGATION_DENIED");
      return;
    }
    const revision = this.#revision;
    const pending = (async () => {
      const decision = await this.prompt(host, signal);
      if (signal.aborted) throw new BrowserObservationError("BROWSER_CANCELLED");
      if (decision === "deny") throw new BrowserObservationError("BROWSER_NAVIGATION_DENIED");
      if (revision !== this.#revision) {
        if (this.allows(url, scope)) return;
        throw new BrowserObservationError("BROWSER_NAVIGATION_DENIED");
      }
      if (decision === "task") {
        const granted = this.#once.get(scope) ?? new Set<string>();
        granted.add(host);
        this.#once.set(scope, granted);
      } else if (decision === "all") this.update({ action: "all_sites", allowed: true });
      else this.update({ action: "site", host, decision: decision === "site" ? "allow" : "block" });
      if (!this.allows(url, scope)) throw new BrowserObservationError("BROWSER_NAVIGATION_DENIED");
    })();
    this.#pending.set(key, pending);
    try {
      await pending;
    } finally {
      this.#pending.delete(key);
    }
  }
  release(scope?: string): void {
    if (scope) this.#once.delete(scope);
    else this.#once.clear();
    this.#revision++;
  }
}
