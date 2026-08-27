import type { NormalizedToolResult, ToolOperation } from "@openerx/contracts";
import { ShellToolAdapter, type ToolAdapter, type ToolExecutionContext } from "@openerx/tool-sdk";
import type { SkillPackageService } from "./package-service";

export class SkillToolAdapter implements ToolAdapter {
  readonly operations = ["skill_read", "skill_script_execute"] as const;
  readonly #shell: ShellToolAdapter;

  constructor(private readonly skills: SkillPackageService) {
    this.#shell = new ShellToolAdapter([skills.packagesDirectory()]);
  }

  async execute(
    operation: ToolOperation,
    context: ToolExecutionContext,
  ): Promise<NormalizedToolResult> {
    if (operation.operation === "skill_read") {
      const resource = this.skills.readResource(operation.installationId, operation.relativePath);
      return {
        summary: `Loaded ${resource.name}/${resource.relativePath}`,
        content: [{ type: "text", text: resource.content }],
        data: resource,
        sources: [],
        artifacts: [],
        sideEffectCommitted: false,
        durationMs: 0,
      };
    }
    if (operation.operation !== "skill_script_execute") {
      throw new Error("SKILL_OPERATION_NOT_SUPPORTED");
    }
    const script = this.skills.scriptDescriptor(
      operation.installationId,
      operation.relativePath,
      operation.allowNetwork,
    );
    const extension = script.absolutePath.split(".").at(-1)?.toLowerCase();
    const command = process.platform === "win32" ? "node.exe" : "/usr/bin/env";
    const args =
      process.platform === "win32"
        ? [script.absolutePath, ...operation.args]
        : ["node", script.absolutePath, ...operation.args];
    if (extension !== "js" && extension !== "mjs" && extension !== "cjs") {
      throw new Error("SKILL_SCRIPT_RUNTIME_UNSUPPORTED");
    }
    return await this.#shell.execute(
      {
        operation: "shell_execute",
        idempotencyKey: operation.idempotencyKey,
        cwd: script.packagePath,
        command,
        args,
        timeoutMs: operation.timeoutMs,
        background: false,
        allowNetwork: operation.allowNetwork,
      },
      context,
    );
  }

  async stopAll(): Promise<void> {
    await this.#shell.stopAll?.();
  }
}
