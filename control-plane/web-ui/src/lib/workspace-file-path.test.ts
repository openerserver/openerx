import { describe, expect, it } from "vitest";
import { normalizeWorkspaceFilePath } from "./workspace-file-path";

describe("normalizeWorkspaceFilePath", () => {
  it("normalizes workspace absolute paths to repo-relative paths", () => {
    expect(
      normalizeWorkspaceFilePath(
        "/Users/wanglei/Downloads/phones-cloud/openerx/control-plane/web-ui/src/pages/TaskDetailV3.vue",
      ),
    ).toBe("control-plane/web-ui/src/pages/TaskDetailV3.vue");
  });

  it("keeps valid repo-relative file paths", () => {
    expect(normalizeWorkspaceFilePath("package.json")).toBe("package.json");
    expect(normalizeWorkspaceFilePath("control-plane/web-ui/src/lib/api.ts")).toBe(
      "control-plane/web-ui/src/lib/api.ts",
    );
  });

  it("rejects plain text and bullet lines", () => {
    expect(
      normalizeWorkspaceFilePath("是要评估付费版本的并行处理能力与 GitHub Copilot 的对比？"),
    ).toBeUndefined();
    expect(
      normalizeWorkspaceFilePath("- 是要评估付费版本的并行处理能力与 GitHub Copilot 的对比？"),
    ).toBeUndefined();
  });

  it("rejects invalid or non-workspace locations", () => {
    expect(normalizeWorkspaceFilePath("https://example.com/file.ts")).toBeUndefined();
    expect(normalizeWorkspaceFilePath("/tmp/output.log")).toBeUndefined();
    expect(normalizeWorkspaceFilePath("../control-plane/web-ui/src/lib/api.ts")).toBeUndefined();
  });
});
