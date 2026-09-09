import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { type BrowserMode, browserModeSchema } from "@openerx/contracts";

export class BrowserSettingsStore {
  mode: BrowserMode = "auto";
  readonly #file: string;
  constructor(directory: string) {
    this.#file = path.join(directory, "browser-settings.json");
    try {
      this.mode = browserModeSchema.parse(JSON.parse(readFileSync(this.#file, "utf8")).mode);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") this.mode = "auto";
    }
  }
  save(mode: BrowserMode): void {
    const parsed = browserModeSchema.parse(mode);
    mkdirSync(path.dirname(this.#file), { recursive: true });
    writeFileSync(`${this.#file}.tmp`, JSON.stringify({ mode: parsed }), { mode: 0o600 });
    renameSync(`${this.#file}.tmp`, this.#file);
    this.mode = parsed;
  }
}
