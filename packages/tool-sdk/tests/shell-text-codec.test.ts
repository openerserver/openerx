import { describe, expect, it } from "vitest";
import {
  appendShellOutput,
  encodeShellInput,
  normalizeShellEncoding,
  ShellTextOutputDecoder,
} from "../src/shell-text-codec";

describe("explicit shell text codecs", () => {
  it("defaults each stream independently and rejects unknown codecs or fields", () => {
    expect(normalizeShellEncoding()).toEqual({ stdin: "utf8", stdout: "utf8", stderr: "utf8" });
    expect(normalizeShellEncoding({ stdout: "cp936" })).toEqual({
      stdin: "utf8",
      stdout: "cp936",
      stderr: "utf8",
    });
    expect(() => normalizeShellEncoding({ stdout: "auto" } as never)).toThrow(
      "SHELL_ENCODING_UNSUPPORTED",
    );
    expect(() => normalizeShellEncoding({ extra: "utf8" } as never)).toThrow(
      "SHELL_ENCODING_UNSUPPORTED",
    );
    expect(() => new ShellTextOutputDecoder("auto" as never)).toThrow("SHELL_ENCODING_UNSUPPORTED");
    expect(() => encodeShellInput("hello", "latin1" as never)).toThrow(
      "SHELL_ENCODING_UNSUPPORTED",
    );
  });

  it.each([
    ["utf8", "中文🙂\n"],
    ["cp936", "中文€\n"],
    ["utf16le", "中文🙂\n"],
  ] as const)("decodes %s one byte at a time and round trips declared stdin", (encoding, text) => {
    const bytes = encodeShellInput(text, encoding);
    const decoder = new ShellTextOutputDecoder(encoding);
    let output = "";
    for (const byte of bytes) output += decoder.write(Buffer.from([byte]));
    output += decoder.finish();
    expect(output).toBe(text);
    expect(output).not.toContain("\uFFFD");
  });

  it("proves CP936 byte semantics rather than treating them as UTF-8", () => {
    expect(encodeShellInput("中文", "cp936").toString("hex")).toBe("d6d0cec4");
    expect(new ShellTextOutputDecoder("cp936").write(Buffer.from("d6d0cec4", "hex"))).toBe("中文");
    expect(() => new ShellTextOutputDecoder("utf8").write(Buffer.from("d6d0cec4", "hex"))).toThrow(
      "SHELL_OUTPUT_DECODING_FAILED",
    );
  });

  it("rejects unrepresentable stdin and invalid Unicode before any substitution", () => {
    expect(() => encodeShellInput("中文🙂", "cp936")).toThrow(
      "SHELL_INPUT_ENCODING_UNREPRESENTABLE",
    );
    for (const encoding of ["utf8", "cp936", "utf16le"] as const) {
      expect(() => encodeShellInput("\uD800", encoding)).toThrow("SHELL_INPUT_INVALID_UNICODE");
      expect(() => encodeShellInput("\uDC00", encoding)).toThrow("SHELL_INPUT_INVALID_UNICODE");
    }
  });

  it.each([
    ["utf8", "e4b8"],
    ["cp936", "81"],
    ["utf16le", "3dd8"],
  ] as const)(
    "distinguishes an invalid natural %s tail from an intentional byte cap",
    (encoding, hex) => {
      const natural = new ShellTextOutputDecoder(encoding);
      expect(natural.write(Buffer.from(hex, "hex"))).toBe("");
      expect(() => natural.finish()).toThrow("SHELL_OUTPUT_DECODING_FAILED");
      const capped = new ShellTextOutputDecoder(encoding);
      expect(capped.write(Buffer.from(hex, "hex"))).toBe("");
      expect(capped.finish(true)).toBe("");
    },
  );

  it("caps the displayed UTF-8 bytes without splitting a multibyte character or falsely flagging exact fit", () => {
    expect(appendShellOutput("", "中", 3)).toEqual({ text: "中", truncated: false });
    expect(appendShellOutput("x", "中文🙂", 4)).toEqual({ text: "x中", truncated: true });
    expect(appendShellOutput("x", "🙂", 4)).toEqual({ text: "x", truncated: true });
    expect(appendShellOutput("x中", "", 4)).toEqual({ text: "x中", truncated: false });
    const large = appendShellOutput("", "中".repeat(700_000), 2_000_000);
    expect(Buffer.byteLength(large.text)).toBe(1_999_998);
    expect(large.text).not.toContain("\uFFFD");
    expect(large.truncated).toBe(true);
  });
});
