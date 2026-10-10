import { StringDecoder } from "node:string_decoder";
import {
  type ResolvedShellEncoding,
  type ShellEncoding,
  type ShellTextEncoding,
  shellEncodingSchema,
} from "@openerx/contracts";
import iconv from "iconv-lite";

export type ShellOutputStream = "stdout" | "stderr";
export interface ShellOutputDecodingError {
  stream: ShellOutputStream;
  encoding: ShellTextEncoding;
  code: "SHELL_OUTPUT_DECODING_FAILED";
}

export function shellOutputDecodingMessage(errors: readonly ShellOutputDecodingError[]): string {
  if (errors.length === 0) return "";
  return `终端输出无法按声明的编码解码（${errors.map((item) => `${item.stream}: ${item.encoding}`).join(", ")}）；真实退出码已保留。`;
}

export function normalizeShellEncoding(encoding?: ShellEncoding): ResolvedShellEncoding {
  const parsed = shellEncodingSchema.safeParse(encoding ?? {});
  if (!parsed.success) throw new Error("SHELL_ENCODING_UNSUPPORTED");
  return parsed.data;
}

function decoderLabel(encoding: ShellTextEncoding): string {
  if (encoding === "utf8") return "utf-8";
  if (encoding === "cp936") return "gbk";
  if (encoding === "utf16le") return "utf-16le";
  throw new Error("SHELL_ENCODING_UNSUPPORTED");
}

/** Decode bytes only with the caller's declared codec, never by guessing. */
export class ShellTextOutputDecoder {
  readonly #decoder: TextDecoder;
  #failed = false;

  constructor(encoding: ShellTextEncoding) {
    this.#decoder = new TextDecoder(decoderLabel(encoding), { fatal: true, ignoreBOM: true });
  }

  write(bytes: Uint8Array): string {
    if (this.#failed) return "";
    try {
      return this.#decoder.decode(bytes, { stream: true });
    } catch {
      this.#failed = true;
      throw new Error("SHELL_OUTPUT_DECODING_FAILED");
    }
  }

  finish(truncated = false): string {
    // Native byte caps may intentionally leave half a character. Never flush it
    // into replacement text or report that intentional cap as invalid output.
    if (truncated || this.#failed) return "";
    try {
      return this.#decoder.decode();
    } catch {
      this.#failed = true;
      throw new Error("SHELL_OUTPUT_DECODING_FAILED");
    }
  }
}

export function encodeShellInput(text: string, encoding: ShellTextEncoding): Buffer {
  const label = decoderLabel(encoding);
  for (let index = 0; index < text.length; index++) {
    const value = text.charCodeAt(index);
    if (value >= 0xd800 && value <= 0xdbff) {
      const next = text.charCodeAt(++index);
      if (!(next >= 0xdc00 && next <= 0xdfff)) throw new Error("SHELL_INPUT_INVALID_UNICODE");
    } else if (value >= 0xdc00 && value <= 0xdfff) throw new Error("SHELL_INPUT_INVALID_UNICODE");
  }
  const bytes = iconv.encode(text, encoding);
  // iconv deliberately substitutes unrepresentable input. A round trip makes
  // that impossible for terminal input: fail before writing any bytes instead.
  try {
    const decoded = new TextDecoder(label, {
      fatal: true,
      ignoreBOM: true,
    }).decode(bytes);
    if (decoded !== text) throw new Error("unrepresentable");
  } catch {
    throw new Error("SHELL_INPUT_ENCODING_UNREPRESENTABLE");
  }
  return bytes;
}

export function appendShellOutput(
  current: string,
  delta: string,
  byteLimit: number,
): { text: string; truncated: boolean } {
  const remaining = Math.max(0, byteLimit - Buffer.byteLength(current, "utf8"));
  const bytes = Buffer.from(delta, "utf8");
  if (bytes.length <= remaining) return { text: current + delta, truncated: false };
  return {
    text: current + new StringDecoder("utf8").write(bytes.subarray(0, remaining)),
    truncated: true,
  };
}
