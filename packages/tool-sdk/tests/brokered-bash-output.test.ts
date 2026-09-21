import { describe, expect, it } from "vitest";
import {
  BrokeredBashOutputSanitizer,
  sanitizeBrokeredBashOutput,
} from "../src/brokered-bash-output";

describe("BrokeredBashOutputSanitizer", () => {
  it("redacts paths, ANSI, controls and credentials split across chunks", () => {
    const sanitizer = new BrokeredBashOutputSanitizer([
      { target: "/private/workspace", replacement: "<workspace>" },
    ]);
    expect(sanitizer.push("\u001b[31m/private/work")).toEqual([]);
    expect(sanitizer.push("space\u001b[0m token=super")).toEqual([]);
    expect(sanitizer.push("-secret-value \u0000\n")).toEqual(["<workspace> token=<redacted> �\n"]);
    expect(sanitizer.finish()).toEqual([]);
  });

  it("removes common standalone credential forms", () => {
    expect(
      sanitizeBrokeredBashOutput(
        "Authorization: Bearer abc.def.ghi\nOPENAI_API_KEY=sk-abcdefghijklmnopqrstuvwxyz\n",
      ),
    ).toBe("Authorization: Bearer <redacted>\nOPENAI_API_KEY=<redacted>\n");
  });

  it("fails closed instead of splitting an overlong credential-bearing line", () => {
    const sanitizer = new BrokeredBashOutputSanitizer();
    expect(sanitizer.push(`prefix sk-${"a".repeat(70_000)}`)).toEqual([
      "[overlong output line redacted]\n",
    ]);
    expect(sanitizer.push("still-secret")).toEqual([]);
    expect(sanitizer.push("\nsafe\n")).toEqual(["safe\n"]);
    expect(sanitizer.finish()).toEqual([]);
  });

  it("keeps OSC stripping state across chunks and embedded newlines", () => {
    const sanitizer = new BrokeredBashOutputSanitizer();
    expect(sanitizer.push("\u001b]0;hidden\nsecret")).toEqual([]);
    expect(sanitizer.push("\u0007safe\n")).toEqual(["safe\n"]);
  });
});
