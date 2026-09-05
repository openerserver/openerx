const MAX_PENDING_CHARACTERS = 64 * 1_024;

class AnsiStripper {
  #state: "normal" | "escape" | "csi" | "osc" | "osc_escape" = "normal";

  push(value: string): string {
    let output = "";
    for (const character of value) {
      const code = character.codePointAt(0) ?? 0;
      if (this.#state === "normal") {
        if (code === 27) this.#state = "escape";
        else output += character;
        continue;
      }
      if (this.#state === "escape") {
        if (character === "[") this.#state = "csi";
        else if (character === "]") this.#state = "osc";
        else this.#state = "normal";
        continue;
      }
      if (this.#state === "csi") {
        if (code >= 64 && code <= 126) this.#state = "normal";
        continue;
      }
      if (this.#state === "osc") {
        if (code === 7) this.#state = "normal";
        else if (code === 27) this.#state = "osc_escape";
        continue;
      }
      if (character === "\\") this.#state = "normal";
      else if (code !== 27) this.#state = "osc";
    }
    return output;
  }
}

function stripAnsi(value: string): string {
  return new AnsiStripper().push(value);
}

export interface OutputReplacement {
  target: string;
  replacement: string;
}

function scrubCredentials(value: string): string {
  return value
    .replace(/(authorization\s*:\s*(?:bearer|basic)\s+)[^\s]+/giu, "$1<redacted>")
    .replace(
      /((?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|passwd|secret|token)\s*[=:]\s*)('[^'\r\n]*'|"[^"\r\n]*"|[^\s\r\n]+)/giu,
      "$1<redacted>",
    )
    .replace(
      /\b(?:sk-[A-Za-z0-9_-]{16,}|gh[opsu]_[A-Za-z0-9]{20,}|AKIA[A-Z0-9]{16})\b/gu,
      "<redacted>",
    );
}

export function sanitizeBrokeredBashOutput(
  value: string,
  replacements: readonly OutputReplacement[] = [],
): string {
  let sanitized = stripAnsi(value).replace(/[^\P{Cc}\n\r\t]/gu, "�");
  for (const { target, replacement } of [...replacements].sort(
    (left, right) => right.target.length - left.target.length,
  )) {
    if (target) sanitized = sanitized.replaceAll(target, replacement);
  }
  return scrubCredentials(sanitized);
}

export class BrokeredBashOutputSanitizer {
  #pending = "";
  #discardingOverlongLine = false;
  readonly #ansi = new AnsiStripper();

  constructor(private readonly replacements: readonly OutputReplacement[] = []) {}

  push(chunk: string): string[] {
    let incoming = this.#ansi.push(chunk);
    const emitted: string[] = [];
    if (this.#discardingOverlongLine) {
      const newline = incoming.indexOf("\n");
      if (newline < 0) return emitted;
      this.#discardingOverlongLine = false;
      incoming = incoming.slice(newline + 1);
    }
    this.#pending += incoming;
    while (this.#pending.length > 0) {
      const newline = this.#pending.indexOf("\n");
      if (newline >= 0) {
        if (newline + 1 > MAX_PENDING_CHARACTERS) {
          this.#pending = this.#pending.slice(newline + 1);
          emitted.push("[overlong output line redacted]\n");
          continue;
        }
        emitted.push(this.#take(newline + 1));
        continue;
      }
      if (this.#pending.length >= MAX_PENDING_CHARACTERS) {
        this.#pending = "";
        this.#discardingOverlongLine = true;
        emitted.push("[overlong output line redacted]\n");
      }
      break;
    }
    return emitted.filter(Boolean);
  }

  finish(): string[] {
    if (this.#discardingOverlongLine) {
      this.#discardingOverlongLine = false;
      return [];
    }
    return this.#pending ? [this.#take(this.#pending.length)].filter(Boolean) : [];
  }

  #take(length: number): string {
    const raw = this.#pending.slice(0, length);
    this.#pending = this.#pending.slice(length);
    return sanitizeBrokeredBashOutput(raw, this.replacements);
  }
}
