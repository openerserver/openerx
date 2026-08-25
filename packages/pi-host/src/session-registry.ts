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
  version: 1;
  sessions: Record<string, string>;
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

  async sessionManager(conversationId: string): Promise<SessionManager> {
    const registry = await this.#load();
    const registered = registry.sessions[conversationId];
    if (registered && this.#isSafeSessionPath(registered) && existsSync(registered)) {
      return SessionManager.open(registered, this.#sessionDirectory, this.#cwd);
    }
    const discovered = (await SessionManager.list(this.#cwd, this.#sessionDirectory)).find(
      ({ id }) => id === conversationId,
    );
    if (discovered && this.#isSafeSessionPath(discovered.path)) {
      registry.sessions[conversationId] = discovered.path;
      this.#store(registry);
      return SessionManager.open(discovered.path, this.#sessionDirectory, this.#cwd);
    }
    const manager = SessionManager.create(this.#cwd, this.#sessionDirectory, {
      id: conversationId,
    });
    const sessionFile = manager.getSessionFile();
    if (!sessionFile) throw new Error("PI_SESSION_FILE_MISSING");
    registry.sessions[conversationId] = sessionFile;
    this.#store(registry);
    return manager;
  }

  async sessionFile(conversationId: string): Promise<string | null> {
    const registry = await this.#load();
    return registry.sessions[conversationId] ?? null;
  }

  async #load(): Promise<RegistryPayload> {
    if (existsSync(this.#registryPath)) {
      try {
        const parsed = JSON.parse(readFileSync(this.#registryPath, "utf8")) as RegistryPayload;
        if (parsed.version === 1 && parsed.sessions && typeof parsed.sessions === "object") {
          return parsed;
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
    const recovered: RegistryPayload = { version: 1, sessions };
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
