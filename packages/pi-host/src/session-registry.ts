import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";

interface RegistryPayload {
  version: 2;
  sessions: Record<string, string>;
}

interface UntrustedRegistryPayload {
  version?: number;
  sessions?: Record<string, string>;
}

export class ProductSessionRegistry {
  readonly #cwd: string;
  readonly #sessionDirectory: string;
  readonly #registryPath: string;

  constructor(profileDirectory: string, cwd: string) {
    this.#cwd = cwd;
    this.#sessionDirectory = path.join(profileDirectory, "pi-sessions");
    this.#registryPath = path.join(this.#sessionDirectory, "conversation-sessions.json");
    mkdirSync(this.#sessionDirectory, { recursive: true });
  }

  async sessionManager(_conversationId: string, branchId: string): Promise<SessionManager> {
    const registry = await this.#load();
    const registered = registry.sessions[branchId];
    if (registered && this.#isSafeSessionPath(registered) && existsSync(registered)) {
      return SessionManager.open(registered, this.#sessionDirectory, this.#cwd);
    }
    const discovered = (await SessionManager.list(this.#cwd, this.#sessionDirectory)).find(
      ({ id }) => id === branchId,
    );
    if (discovered && this.#isSafeSessionPath(discovered.path)) {
      registry.sessions[branchId] = discovered.path;
      this.#store(registry);
      return SessionManager.open(discovered.path, this.#sessionDirectory, this.#cwd);
    }
    const manager = SessionManager.create(this.#cwd, this.#sessionDirectory, {
      id: branchId,
    });
    const sessionFile = manager.getSessionFile();
    if (!sessionFile) throw new Error("PI_SESSION_FILE_MISSING");
    registry.sessions[branchId] = sessionFile;
    this.#store(registry);
    return manager;
  }

  async sessionFile(_conversationId: string, branchId: string): Promise<string | null> {
    const registry = await this.#load();
    return registry.sessions[branchId] ?? null;
  }

  async #load(): Promise<RegistryPayload> {
    if (existsSync(this.#registryPath)) {
      try {
        const parsed = JSON.parse(
          readFileSync(this.#registryPath, "utf8"),
        ) as UntrustedRegistryPayload;
        if (parsed.sessions && typeof parsed.sessions === "object") {
          if (parsed.version === 2) return { version: 2, sessions: parsed.sessions };
          if (parsed.version === 1) {
            const migrated: RegistryPayload = { version: 2, sessions: parsed.sessions };
            this.#store(migrated);
            return migrated;
          }
        }
      } catch {
        // A damaged index is recoverable from Pi's append-only session headers below.
      }
    }
    const sessions = Object.fromEntries(
      (await SessionManager.list(this.#cwd, this.#sessionDirectory)).map((session) => [
        session.id,
        session.path,
      ]),
    );
    const recovered: RegistryPayload = { version: 2, sessions };
    this.#store(recovered);
    return recovered;
  }

  #store(payload: RegistryPayload): void {
    const temporary = `${this.#registryPath}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(payload, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    renameSync(temporary, this.#registryPath);
  }

  #isSafeSessionPath(candidate: string): boolean {
    const parent = realpathSync.native(this.#sessionDirectory);
    const absolute = existsSync(candidate)
      ? realpathSync.native(candidate)
      : path.resolve(candidate);
    const relative = path.relative(parent, absolute);
    return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
  }
}
