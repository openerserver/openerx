import { describe, expect, it, vi } from "vitest";
import { createProductWorkspaceTools } from "../src/workspace-tools";

describe("workspace patch tool protocol", () => {
  it.each([
    ["WORKSPACE_READ_REQUIRED", "openerx_workspace_read"],
    ["WORKSPACE_INSTRUCTIONS_NOT_ACKNOWLEDGED", "openerx_workspace_instructions"],
    ["WORKSPACE_CONTENT_CHANGED", "重新读取"],
    ["WORKSPACE_PATCH_CONTEXT_MISMATCH", "重新读取"],
    ["WORKSPACE_PATCH_DUPLICATE_PATH", "*** Update File:"],
    ["PERMISSION_DENIED", "PERMISSION_DENIED"],
    ["TOOL_CANCELLED", "TOOL_CANCELLED"],
  ])(
    "keeps %s as an error and provides actionable recovery across code-only IPC",
    async (code, expected) => {
      const request = vi.fn(async () => {
        throw new Error(code);
      });
      const tool = createProductWorkspaceTools({
        generationId: crypto.randomUUID(),
        conversationId: crypto.randomUUID(),
        branchId: crypto.randomUUID(),
        assistantMessageId: crypto.randomUUID(),
        transport: { request },
      }).find(({ name }) => name === "openerx_workspace_apply_patch");
      if (!tool) throw new Error("tool missing");
      await expect(
        tool.execute(
          "patch-error",
          {
            workspaceGrantId: crypto.randomUUID(),
            patch: "*** Begin Patch\n*** Update File: a.txt\n@@\n-old\n+new\n*** End Patch",
          },
          undefined,
          undefined,
          {} as never,
        ),
      ).rejects.toThrow(expected);
      expect(request).toHaveBeenCalledTimes(1); // No blind automatic write/retry.
    },
  );
  it("uses a provider-compatible object schema and routes context patches without model-copied hashes", async () => {
    const request = vi.fn(async () => ({
      summary: "applied",
      content: [],
      data: {},
      sources: [],
      artifacts: [],
      durationMs: 0,
      sideEffectCommitted: true,
    }));
    const tool = createProductWorkspaceTools({
      generationId: crypto.randomUUID(),
      conversationId: crypto.randomUUID(),
      branchId: crypto.randomUUID(),
      assistantMessageId: crypto.randomUUID(),
      transport: { request },
    }).find(({ name }) => name === "openerx_workspace_apply_patch");
    if (!tool) throw new Error("tool missing");
    expect(tool.parameters).toMatchObject({ type: "object" });
    const workspaceGrantId = crypto.randomUUID();
    const patch = "*** Begin Patch\n*** Add File: a.txt\n+hello\n*** End Patch";
    await tool.execute("patch-1", { workspaceGrantId, patch }, undefined, undefined, {} as never);
    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: expect.objectContaining({
          operation: "workspace_patch",
          workspaceGrantId,
          patch,
        }),
      }),
    );
    await expect(
      tool.execute(
        "patch-2",
        { workspaceGrantId, patch, replacements: [] },
        undefined,
        undefined,
        {} as never,
      ),
    ).rejects.toThrow("WORKSPACE_PATCH_INVALID");
    await expect(
      tool.execute("patch-3", { workspaceGrantId }, undefined, undefined, {} as never),
    ).rejects.toThrow("WORKSPACE_PATCH_INVALID");
    expect(request).toHaveBeenCalledTimes(1);
  });
});
