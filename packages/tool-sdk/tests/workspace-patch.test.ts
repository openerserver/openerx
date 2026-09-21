import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { applyWorkspaceFileTransaction } from "../src/workspace-file-transaction";
import {
  applyWorkspaceHunks,
  parseWorkspacePatch,
  workspaceUnifiedDiff,
} from "../src/workspace-patch";

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

function edit(before: string, body: string): string {
  const file = parseWorkspacePatch(
    `*** Begin Patch\n*** Update File: app.ts\n${body}\n*** End Patch`,
  )[0];
  if (file?.kind !== "modified") throw new Error("Expected update");
  return applyWorkspaceHunks(before, file.hunks);
}

describe("workspace context patches", () => {
  it("bounds repeated context scans and supports insertion after an explicit anchor", () => {
    expect(edit("start\nend\n", "@@ start\n+inserted")).toBe("start\ninserted\nend\n");
    const repeated = "same\n".repeat(5_000);
    expect(() => edit(repeated, `@@\n${" same\n".repeat(1_000)}-absent\n+replacement`)).toThrow(
      "WORKSPACE_PATCH_TOO_COMPLEX",
    );
  });
  it("parses additions, deletion and a rename with multiple hunks", () => {
    const files = parseWorkspacePatch(
      "*** Begin Patch\n*** Add File: new dir/readme.md\n+hello\n*** Update File: a.ts\n*** Move to: b.ts\n@@\n-old\n+new\n@@\n-last\n+end\n*** End of File\n*** Delete File: obsolete.ts\n*** End Patch\n",
    );
    expect(files.map(({ kind }) => kind)).toEqual(["created", "modified", "deleted"]);
    expect(files[0]).toMatchObject({ path: "new dir/readme.md", content: "hello\n" });
    expect(files[1]).toMatchObject({
      moveTo: "b.ts",
      hunks: [{ endOfFile: false }, { endOfFile: true }],
    });
  });

  it("uses function anchors and preserves unchanged context when tolerating trailing spaces", () => {
    const before = "function a() {\n  return 1;\n}\nfunction b() {\n  return 1;  \n}\n";
    expect(edit(before, "@@ function b() {\n-  return 1;\n+  return 2;")).toBe(
      before.replace("return 1;  ", "return 2;"),
    );
    expect(edit("head  \nold\ntail\n", "@@\n head\n-old\n+new\n tail")).toBe("head  \nnew\ntail\n");
  });

  it("preserves CRLF, final-newline state and non-ASCII content", () => {
    expect(edit("标题\r\n旧值\r\n", "@@\n-旧值\n+新值")).toBe("标题\r\n新值\r\n");
    expect(edit("first\nlast", "@@\n-last\n+changed\n*** End of File")).toBe("first\nchanged");
    expect(edit("only\n", "@@\n-only")).toBe("");
    expect(edit("head\n", "@@\n+tail\n*** End of File")).toBe("head\ntail\n");
  });

  it("refuses ambiguous, missing, overlapping and malformed context", () => {
    expect(() => edit("same\nsame\n", "@@\n-same\n+new")).toThrow("WORKSPACE_PATCH_AMBIGUOUS");
    expect(() => edit("present\n", "@@\n-absent\n+new")).toThrow(
      "WORKSPACE_PATCH_CONTEXT_MISMATCH",
    );
    expect(() => edit("  indented\n", "@@\n-indented\n+new")).toThrow(
      "WORKSPACE_PATCH_CONTEXT_MISMATCH",
    );
    expect(() =>
      parseWorkspacePatch("*** Begin Patch\n*** Add File: a\nmissing-plus\n*** End Patch"),
    ).toThrow("WORKSPACE_PATCH_INVALID");
    expect(() => parseWorkspacePatch("*** Begin Patch\n*** End Patch")).toThrow(
      "WORKSPACE_PATCH_INVALID",
    );
  });

  it("returns a small real diff for a one-line change in a large file", () => {
    const before = `${Array.from({ length: 1_000 }, (_, index) => `line ${index}`).join("\n")}\n`;
    const patch = workspaceUnifiedDiff(
      "large.txt",
      before,
      before.replace("line 500\n", "changed\n"),
    );
    expect(patch.split("\n").length).toBeLessThan(20);
    expect(patch).toContain("-line 500\n+changed");
    expect(patch).not.toContain("line 100\n");
    expect(workspaceUnifiedDiff("old.txt", "old\n", null)).toContain("+++ /dev/null");
  });
});

describe("workspace file transactions", () => {
  function fixture() {
    const root = mkdtempSync(path.join(tmpdir(), "openerx-patch-transaction-"));
    directories.push(root);
    writeFileSync(path.join(root, "a.txt"), "before-a\n");
    const plan = [
      {
        workspaceGrantId: "test",
        relativePath: "a.txt",
        beforeText: "before-a\n",
        afterText: "after-a\n",
      },
      { workspaceGrantId: "test", relativePath: "b.txt", beforeText: null, afterText: "after-b\n" },
    ];
    return { root, plan };
  }

  it("changes no files when any baseline is stale", () => {
    const { root, plan } = fixture();
    writeFileSync(path.join(root, "b.txt"), "user-created\n");
    expect(() =>
      applyWorkspaceFileTransaction(plan, ({ relativePath }) => path.join(root, relativePath)),
    ).toThrow("WORKSPACE_CHANGE_SET_CONFLICT");
    expect(readFileSync(path.join(root, "a.txt"), "utf8")).toBe("before-a\n");
    expect(readFileSync(path.join(root, "b.txt"), "utf8")).toBe("user-created\n");
  });

  it("restores already-written files if a later write fails", () => {
    const { root, plan } = fixture();
    let secondResolutions = 0;
    expect(() =>
      applyWorkspaceFileTransaction(plan, ({ relativePath }) => {
        if (relativePath === "b.txt" && ++secondResolutions === 2)
          throw new Error("SIMULATED_WRITE_FAILURE");
        return path.join(root, relativePath);
      }),
    ).toThrow("SIMULATED_WRITE_FAILURE");
    expect(readFileSync(path.join(root, "a.txt"), "utf8")).toBe("before-a\n");
    expect(existsSync(path.join(root, "b.txt"))).toBe(false);
  });

  it("does not overwrite an external edit while compensating a failed write", () => {
    const { root, plan } = fixture();
    let secondResolutions = 0;
    expect(() =>
      applyWorkspaceFileTransaction(plan, ({ relativePath }) => {
        if (relativePath === "b.txt" && ++secondResolutions === 2) {
          writeFileSync(path.join(root, "a.txt"), "user-edit\n");
          throw new Error("SIMULATED_WRITE_FAILURE");
        }
        return path.join(root, relativePath);
      }),
    ).toThrow("WORKSPACE_CHANGE_SET_RECOVERY_REQUIRED");
    expect(readFileSync(path.join(root, "a.txt"), "utf8")).toBe("user-edit\n");
  });
});
