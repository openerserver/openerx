import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type {
  PiActivityEvent,
  PiFileToolRequestFrame,
  PiHostEventFrame,
  PiPromptFrame,
  PiSessionControlFrame,
  PiToolRequestFrame,
  SkillInvocation,
} from "@openerx/contracts";
import { SkillPackageService } from "@openerx/skills";
import { ChatRepository, SkillRepository } from "@openerx/storage";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChatAppService, type PiHostClient } from "../src";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

class SkillPiHost implements PiHostClient {
  readonly prompts: PiPromptFrame[] = [];
  readonly #listeners = new Set<(event: PiHostEventFrame) => void>();

  async prompt(frame: PiPromptFrame): Promise<void> {
    this.prompts.push(frame);
    await new Promise((resolve) => setTimeout(resolve, 1));
    for (const listener of this.#listeners) {
      listener({
        kind: "pi.product-event",
        generationId: frame.generationId,
        eventId: crypto.randomUUID(),
        sequence: 1,
        occurredAt: new Date().toISOString(),
        type: "completed",
      });
    }
  }

  async abort(): Promise<void> {}
  async control(_frame: PiSessionControlFrame): Promise<void> {}
  onEvent(listener: (event: PiHostEventFrame) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }
  onFileToolRequest(_listener: (frame: PiFileToolRequestFrame) => Promise<unknown>): () => void {
    return () => undefined;
  }
  onToolRequest(_listener: (frame: PiToolRequestFrame) => Promise<unknown>): () => void {
    return () => undefined;
  }
  onActivity(_listener: (frame: PiActivityEvent) => void): () => void {
    return () => undefined;
  }
}

async function waitForInvocation(service: ChatAppService): Promise<SkillInvocation> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const invocations = (await service.handle({
      command: "skill.invocations.list",
      input: { limit: 20 },
    })) as SkillInvocation[];
    if (invocations[0]?.status === "completed") return invocations[0];
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  throw new Error("Skill invocation timeout");
}

describe("ChatAppService Skill lifecycle", () => {
  it("mounts an explicitly selected Skill, records visibility, and isolates package damage", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "openerx-app-skill-"));
    roots.push(root);
    const databasePath = path.join(root, "profile.sqlite");
    const repository = new ChatRepository(databasePath);
    const skillRepository = new SkillRepository(databasePath);
    const skills = new SkillPackageService(skillRepository, root);
    const [builtIn] = skills.seedBuiltIns();
    if (!builtIn) throw new Error("Built-in Skill missing");
    const pi = new SkillPiHost();
    const service = new ChatAppService(repository, pi, null, null, null, null, skills);

    await service.handle({
      command: "chat.send",
      input: {
        conversationId: null,
        text: "生成季度报告",
        idempotencyKey: "skill-explicit-0001",
        skillInstallationId: builtIn.id,
      },
    });
    await vi.waitFor(() => expect(pi.prompts).toHaveLength(1));
    expect(pi.prompts[0]?.history).toEqual([
      expect.objectContaining({ text: expect.stringContaining("/skill:structured-report") }),
    ]);
    expect(pi.prompts[0]?.skills).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ installationId: builtIn.id, autoInvoke: true }),
      ]),
    );
    expect(await waitForInvocation(service)).toMatchObject({
      installationId: builtIn.id,
      trigger: "explicit",
      status: "completed",
      reason: "Selected from the composer",
    });

    const packagePath = pi.prompts[0]?.skills?.find(
      ({ installationId }) => installationId === builtIn.id,
    )?.baseDir;
    if (!packagePath) throw new Error("Skill mount missing");
    writeFileSync(path.join(packagePath, "SKILL.md"), "damaged");
    await service.handle({
      command: "chat.send",
      input: {
        conversationId: null,
        text: "普通聊天仍应继续",
        idempotencyKey: "skill-isolation-0001",
      },
    });
    await vi.waitFor(() => expect(pi.prompts).toHaveLength(2));
    expect(pi.prompts[1]?.skills).toEqual(
      expect.not.arrayContaining([expect.objectContaining({ installationId: builtIn.id })]),
    );
    expect(pi.prompts[1]?.skills?.length).toBeGreaterThan(0);
    expect(
      await service.handle({ command: "skill.get", input: { installationId: builtIn.id } }),
    ).toMatchObject({
      packageState: "damaged",
      enabled: false,
    });
    service.close();
  });
});
