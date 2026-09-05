import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Context } from "@earendil-works/pi-ai";
import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai/providers/faux";
import type { PiSkillMount } from "@openerx/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createProductPiSession, ModelRuntime } from "../src/agent-session";
import { createProductSkillTools, validateSkillMounts } from "../src/skill-tools";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture(): {
  root: string;
  cwd: string;
  agentDir: string;
  auto: PiSkillMount;
  manual: PiSkillMount;
} {
  const root = mkdtempSync(path.join(tmpdir(), "openerx-pi-skills-"));
  roots.push(root);
  const cwd = path.join(root, "workspace");
  const agentDir = path.join(root, "agent");
  mkdirSync(cwd);
  mkdirSync(agentDir);
  const create = (name: string, description: string, autoInvoke: boolean): PiSkillMount => {
    const installationId = randomUUID();
    const baseDir = path.join(root, "skill-packages", installationId, "versions", "1.0.0-fixture");
    mkdirSync(path.join(baseDir, "references"), { recursive: true });
    writeFileSync(
      path.join(baseDir, "SKILL.md"),
      `---\nname: ${name}\ndescription: ${description}\n---\n\nFULL ${name} INSTRUCTIONS\n`,
    );
    writeFileSync(path.join(baseDir, "references", "guide.md"), `${name} guide`);
    return { installationId, name, baseDir, autoInvoke };
  };
  return {
    root,
    cwd,
    agentDir,
    auto: create("auto-report", "Automatically prepare a report.", true),
    manual: create("manual-review", "Review only when explicitly selected.", false),
  };
}

describe("Pi native Skill alignment", () => {
  it("exposes only auto metadata and uses Pi native explicit command expansion", async () => {
    const { cwd, agentDir, auto, manual } = fixture();
    const request = vi.fn(async () => ({ content: "fixture" }));
    const tools = createProductSkillTools({
      generationId: randomUUID(),
      conversationId: randomUUID(),
      branchId: randomUUID(),
      assistantMessageId: randomUUID(),
      mounts: [auto, manual],
      transport: { request },
    });
    const contexts: Context[] = [];
    const runtime = await ModelRuntime.create({ modelsPath: null, refreshOnCreate: false });
    const faux = fauxProvider({ tokensPerSecond: 10_000 });
    runtime.registerNativeProvider(faux.provider);
    faux.setResponses([
      (context) => {
        contexts.push(context);
        return fauxAssistantMessage("done");
      },
    ]);
    const { session } = await createProductPiSession({
      cwd,
      agentDir,
      history: [],
      modelRuntime: runtime,
      model: faux.getModel(),
      customTools: tools,
      skills: [auto, manual],
    });

    expect(session.systemPrompt).toContain("auto-report");
    expect(session.systemPrompt).not.toContain("manual-review");
    expect(session.resourceLoader.getSkills().skills).toEqual([
      expect.objectContaining({ name: "auto-report", disableModelInvocation: false }),
      expect.objectContaining({ name: "manual-review", disableModelInvocation: true }),
    ]);
    await session.prompt("/skill:manual-review inspect this", { expandPromptTemplates: true });
    await session.waitForIdle();
    const finalUser = contexts[0]?.messages.at(-1);
    expect(finalUser?.role).toBe("user");
    expect(JSON.stringify(finalUser)).toContain("FULL manual-review INSTRUCTIONS");
    expect(JSON.stringify(finalUser)).toContain("inspect this");
    session.dispose();
  });

  it("maps progressive reads and scripts to mounted installation ids and blocks path escape", async () => {
    const { root, auto } = fixture();
    const request = vi.fn(async () => ({
      summary: "ok",
      content: [{ type: "text" as const, text: "ok" }],
      data: { ok: true },
      sources: [],
      artifacts: [],
      sideEffectCommitted: false,
      durationMs: 0,
    }));
    const tools = createProductSkillTools({
      generationId: randomUUID(),
      conversationId: randomUUID(),
      branchId: randomUUID(),
      assistantMessageId: randomUUID(),
      mounts: [auto],
      transport: { request },
    });
    const read = tools.find(({ name }) => name === "read");
    await read?.execute(
      "read-call",
      { path: path.join(auto.baseDir, "references", "guide.md") },
      undefined,
      undefined,
      {} as never,
    );
    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: expect.objectContaining({
          operation: "skill_read",
          installationId: auto.installationId,
          relativePath: "references/guide.md",
        }),
      }),
    );
    await expect(
      read?.execute(
        "escape-call",
        { path: path.join(root, "outside.md") },
        undefined,
        undefined,
        {} as never,
      ),
    ).rejects.toThrow("SKILL_RESOURCE_NOT_MOUNTED");

    expect(validateSkillMounts(root, [auto])).toEqual([auto]);
    expect(() =>
      validateSkillMounts(root, [{ ...auto, baseDir: path.join(root, "outside") }]),
    ).toThrow("SKILL_MOUNT_SCOPE_VIOLATION");
  });
});
