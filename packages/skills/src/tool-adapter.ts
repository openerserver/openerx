import type { NormalizedToolResult, ToolOperation } from "@openerx/contracts";
import { ShellToolAdapter, type ToolAdapter, type ToolExecutionContext } from "@openerx/tool-sdk";
import type { SkillPackageService } from "./package-service";
import { readSkillScriptOutputs, type SkillScriptOutputFile } from "./script-outputs";

export type SkillScriptOutputCollector = (
  outputs: SkillScriptOutputFile[],
  context: ToolExecutionContext,
) => Promise<NormalizedToolResult>;

export class SkillToolAdapter implements ToolAdapter {
  readonly operations = ["skill_read", "skill_script_execute"] as const;
  readonly #shell: ShellToolAdapter;
  readonly #isolatedShells = new Set<ShellToolAdapter>();

  constructor(
    private readonly skills: SkillPackageService,
    private readonly versions?: ReadonlyMap<string, string>,
    private readonly options: {
      isolatedScripts?: boolean;
      collectOutputs?: SkillScriptOutputCollector;
    } = {},
  ) {
    this.#shell = new ShellToolAdapter([skills.packagesDirectory()]);
  }

  async execute(
    operation: ToolOperation,
    context: ToolExecutionContext,
  ): Promise<NormalizedToolResult> {
    context.signal.throwIfAborted();
    if (
      this.versions &&
      "installationId" in operation &&
      !this.versions.has(operation.installationId)
    )
      throw new Error("SKILL_NOT_MOUNTED");
    if (operation.operation === "skill_read") {
      const resource = this.skills.readResource(
        operation.installationId,
        operation.relativePath,
        this.versions?.get(operation.installationId),
      );
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
    if (
      operation.outputs?.length &&
      (!this.options.isolatedScripts || !this.options.collectOutputs)
    )
      throw new Error("SKILL_OUTPUTS_NOT_AVAILABLE");
    const script = this.skills.scriptDescriptor(
      operation.installationId,
      operation.relativePath,
      operation.allowNetwork,
      this.versions?.get(operation.installationId),
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
    const copy = this.options.isolatedScripts
      ? this.skills.scriptExecutionCopy(
          operation.installationId,
          operation.relativePath,
          operation.allowNetwork,
          this.versions?.get(operation.installationId),
        )
      : undefined;
    let shell: ShellToolAdapter | undefined;
    try {
      shell = copy ? new ShellToolAdapter([copy.packagePath]) : this.#shell;
      if (copy) this.#isolatedShells.add(shell);
      context.signal.throwIfAborted();
      const result = await shell.execute(
        {
          operation: "shell_execute",
          idempotencyKey: operation.idempotencyKey,
          cwd: copy?.packagePath ?? script.packagePath,
          command: copy ? (process.platform === "win32" ? "node.exe" : "node") : command,
          args: copy ? [copy.absolutePath, ...operation.args] : args,
          timeoutMs: operation.timeoutMs,
          background: false,
          allowNetwork: operation.allowNetwork,
        },
        context,
      );
      if (!operation.outputs?.length) return result;
      await shell.stopAll();
      context.signal.throwIfAborted();
      const outputs = readSkillScriptOutputs(copy!.packagePath, operation.outputs);
      context.signal.throwIfAborted();
      const collected = await this.options.collectOutputs!(outputs, context);
      return {
        ...result,
        summary: `${result.summary}\n${collected.summary}`,
        content: [...result.content, ...collected.content],
        artifacts: [...result.artifacts, ...collected.artifacts],
        data: { execution: result.data, outputs: collected.data },
        sideEffectCommitted: result.sideEffectCommitted || collected.sideEffectCommitted,
      };
    } finally {
      if (copy) {
        try {
          await shell?.stopAll();
        } finally {
          if (shell) this.#isolatedShells.delete(shell);
          copy.dispose();
        }
      }
    }
  }

  async stopAll(): Promise<void> {
    await Promise.all([this.#shell, ...this.#isolatedShells].map((shell) => shell.stopAll()));
  }
}
