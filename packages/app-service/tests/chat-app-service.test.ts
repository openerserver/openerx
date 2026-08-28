import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type {
  ConversationSnapshot,
  PiActivityEvent,
  PiFileToolRequestFrame,
  PiHostEventFrame,
  PiPromptFrame,
  PiSessionControlFrame,
  PiToolRequestFrame,
} from "@openerx/contracts";
import { FileAppService, MultiFormatParser } from "@openerx/file-service";
import { SkillPackageService } from "@openerx/skills";
import { ChatRepository, FileRepository, SkillRepository, ToolRepository } from "@openerx/storage";
import { afterEach, describe, expect, it } from "vitest";
import { ChatAppService, type PiHostClient, ToolAppService } from "../src";

interface TestGeneration {
  controller: AbortController;
  sequence: number;
  terminal: boolean;
}

class ScriptedPiHostClient implements PiHostClient {
  readonly prompts: PiPromptFrame[] = [];
  readonly #listeners = new Set<(event: PiHostEventFrame) => void>();
  readonly #generations = new Map<string, TestGeneration>();
  readonly #failedPrompts = new Set<string>();

  async prompt(frame: PiPromptFrame): Promise<void> {
    this.prompts.push(frame);
    const generation: TestGeneration = {
      controller: new AbortController(),
      sequence: 0,
      terminal: false,
    };
    this.#generations.set(frame.generationId, generation);
    void this.#run(frame, generation);
  }

  async abort(generationId: string): Promise<void> {
    const generation = this.#generations.get(generationId);
    if (!generation) return;
    generation.controller.abort();
    this.#emit(generationId, generation, { type: "stopped" });
  }

  async control(frame: PiSessionControlFrame): Promise<void> {
    if (frame.action === "abort") await this.abort(frame.generationId);
  }

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

  async #run(frame: PiPromptFrame, generation: TestGeneration): Promise<void> {
    const prompt = frame.history.at(-1)?.text ?? "";
    const shouldFail = prompt.includes("[PI_TEST_FAIL]") && !this.#failedPrompts.has(prompt);
    if (shouldFail) this.#failedPrompts.add(prompt);
    const response = this.#response(frame);
    const chunks = Array.from({ length: Math.ceil(response.length / 5) }, (_, index) =>
      response.slice(index * 5, index * 5 + 5),
    );
    for (let index = 0; index < chunks.length; index += 1) {
      await new Promise((resolve) => setTimeout(resolve, 1));
      if (generation.controller.signal.aborted || generation.terminal) return;
      this.#emit(frame.generationId, generation, { type: "delta", delta: chunks[index] });
      if (shouldFail && index === 1) {
        this.#emit(frame.generationId, generation, {
          type: "failed",
          errorCode: "PI_TEST_PROVIDER_FAILURE",
        });
        return;
      }
    }
    this.#emit(frame.generationId, generation, { type: "completed" });
  }

  #response(frame: PiPromptFrame): string {
    const prompt = frame.history.at(-1)?.text ?? "";
    if (prompt.includes("法国的首都")) return "巴黎。";
    if (prompt.includes("2000 字") || prompt.includes("[PI_TEST_SLOW]")) {
      return "这是用于验证停止后不再追加内容的固定段落。".repeat(80);
    }
    return `Pi AgentSession 已收到：${prompt}`;
  }

  #emit(
    generationId: string,
    generation: TestGeneration,
    event: Pick<PiHostEventFrame, "type"> & Partial<Pick<PiHostEventFrame, "delta" | "errorCode">>,
  ): void {
    if (generation.terminal) return;
    generation.sequence += 1;
    const frame: PiHostEventFrame = {
      kind: "pi.product-event",
      generationId,
      eventId: crypto.randomUUID(),
      sequence: generation.sequence,
      occurredAt: new Date().toISOString(),
      type: event.type,
      ...(event.delta === undefined ? {} : { delta: event.delta }),
      ...(event.errorCode === undefined ? {} : { errorCode: event.errorCode }),
    };
    if (event.type !== "delta") {
      generation.terminal = true;
      this.#generations.delete(generationId);
    }
    for (const listener of this.#listeners) listener(frame);
  }
}

class OfficeWorkflowPiHost implements PiHostClient {
  readonly prompts: PiPromptFrame[] = [];
  readonly results: unknown[] = [];
  readonly #listeners = new Set<(event: PiHostEventFrame) => void>();
  readonly #artifactIdsByConversation = new Map<string, string>();
  #fileTool: ((frame: PiFileToolRequestFrame) => Promise<unknown>) | null = null;

  async prompt(frame: PiPromptFrame): Promise<void> {
    this.prompts.push(frame);
    void this.#run(frame);
  }

  async abort(): Promise<void> {}
  async control(): Promise<void> {}

  onEvent(listener: (event: PiHostEventFrame) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  onFileToolRequest(listener: (frame: PiFileToolRequestFrame) => Promise<unknown>): () => void {
    this.#fileTool = listener;
    return () => {
      this.#fileTool = null;
    };
  }

  onToolRequest(_listener: (frame: PiToolRequestFrame) => Promise<unknown>): () => void {
    return () => undefined;
  }

  onActivity(_listener: (frame: PiActivityEvent) => void): () => void {
    return () => undefined;
  }

  async #run(frame: PiPromptFrame): Promise<void> {
    const fileTool = this.#fileTool;
    if (!fileTool) throw new Error("Office file tool listener missing");
    const prompt = frame.history.at(-1)?.text ?? "";
    const existingArtifactId = this.#artifactIdsByConversation.get(frame.conversationId);
    const request = officeRequestForPrompt(prompt, existingArtifactId);
    const result = await fileTool({
      kind: "pi.file-tool.request",
      requestId: crypto.randomUUID(),
      generationId: frame.generationId,
      conversationId: frame.conversationId,
      branchId: frame.branchId,
      assistantMessageId: frame.assistantMessageId,
      piToolCallId: crypto.randomUUID(),
      toolName: "openerx_office_artifact",
      request,
    });
    const artifactId = (result as { artifact?: { id?: unknown } }).artifact?.id;
    if (typeof artifactId !== "string") throw new Error("Office artifact result missing ID");
    this.#artifactIdsByConversation.set(frame.conversationId, artifactId);
    this.results.push(result);
    await new Promise((resolve) => setTimeout(resolve, 10));
    const events: PiHostEventFrame[] = [
      {
        kind: "pi.product-event",
        generationId: frame.generationId,
        eventId: crypto.randomUUID(),
        sequence: 1,
        occurredAt: new Date().toISOString(),
        type: "delta",
        delta: "成果已生成并完成全部画布检查。",
      },
      {
        kind: "pi.product-event",
        generationId: frame.generationId,
        eventId: crypto.randomUUID(),
        sequence: 2,
        occurredAt: new Date().toISOString(),
        type: "completed",
      },
    ];
    for (const event of events) for (const listener of this.#listeners) listener(event);
  }
}

function officeRequestForPrompt(
  prompt: string,
  artifactId?: string,
): PiFileToolRequestFrame["request"] {
  const revisionText = artifactId ? "Second revision from a natural-language Turn." : null;
  if (prompt.includes("/skill:documents")) {
    return {
      operation: "artifact.office.write",
      input: {
        ...(artifactId ? { artifactId } : {}),
        displayName: "agent-report",
        spec: {
          format: "docx",
          title: "Agent report",
          pages: [
            {
              heading: "Summary",
              paragraphs: [revisionText ?? "Generated from a natural-language Turn."],
              bullets: [],
            },
            { heading: "Next", paragraphs: [], bullets: ["Review every page"] },
          ],
          theme: { accentColor: "#2563EB", backgroundColor: "#FFFFFF" },
        },
      },
    };
  }
  if (prompt.includes("/skill:spreadsheets")) {
    return {
      operation: "artifact.office.write",
      input: {
        ...(artifactId ? { artifactId } : {}),
        displayName: "agent-budget",
        spec: {
          format: "xlsx",
          title: "Agent budget",
          sheets: [
            {
              name: "Data",
              rows: [
                ["Item", "Amount"],
                ["Build", 120],
              ],
              headerRows: 1,
            },
            {
              name: "Summary",
              rows: [
                ["Metric", "Value"],
                ["Total", { formula: "=SUM(Data!B2:B2)", value: 120 }],
                ...(revisionText ? [["Revision", revisionText]] : []),
              ],
              headerRows: 1,
            },
          ],
          theme: { accentColor: "#0F766E", backgroundColor: "#FFFFFF" },
        },
      },
    };
  }
  if (prompt.includes("/skill:presentations")) {
    return {
      operation: "artifact.office.write",
      input: {
        ...(artifactId ? { artifactId } : {}),
        displayName: "agent-deck",
        spec: {
          format: "pptx",
          title: "Agent deck",
          slides: [
            {
              title: "Context",
              body: revisionText ?? "Natural-language request",
              bullets: [],
            },
            { title: "Gate", bullets: ["Review every slide"] },
          ],
          theme: { accentColor: "#7C3AED", backgroundColor: "#FFFFFF" },
        },
      },
    };
  }
  if (prompt.includes("/skill:pdf")) {
    return {
      operation: "artifact.office.write",
      input: {
        ...(artifactId ? { artifactId } : {}),
        displayName: "agent-decision",
        spec: {
          format: "pdf",
          title: "Agent decision",
          pages: [
            {
              heading: "Decision",
              paragraphs: [revisionText ?? "Proceed."],
              bullets: [],
            },
            { heading: "Evidence", paragraphs: [], bullets: ["Rendered review"] },
          ],
          theme: { accentColor: "#B45309", backgroundColor: "#FFFFFF" },
        },
      },
    };
  }
  throw new Error(`Unexpected Office prompt: ${prompt}`);
}

const temporaryDirectories: string[] = [];

function createService(): ChatAppService {
  const directory = mkdtempSync(path.join(tmpdir(), "openerx-app-service-"));
  temporaryDirectories.push(directory);
  return new ChatAppService(
    new ChatRepository(path.join(directory, "chat.sqlite")),
    new ScriptedPiHostClient(),
  );
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

async function waitForTerminal(service: ChatAppService, conversationId: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("terminal event timeout")), 2_000);
    const unsubscribe = service.onEvent((event) => {
      if (
        event.conversationId === conversationId &&
        ["message.completed", "message.stopped", "message.interrupted", "message.failed"].includes(
          event.type,
        )
      ) {
        clearTimeout(timeout);
        unsubscribe();
        resolve();
      }
    });
  });
}

describe("ChatAppService", () => {
  it("creates and edits DOCX, XLSX, PPTX and PDF from natural-language Skill Turns", async () => {
    const directory = mkdtempSync(path.join(tmpdir(), "openerx-office-workflow-"));
    temporaryDirectories.push(directory);
    const database = path.join(directory, "openerx.sqlite");
    const files = new FileAppService(new FileRepository(database), directory);
    const skills = new SkillPackageService(new SkillRepository(database), directory);
    const builtIns = skills.seedBuiltIns();
    const pi = new OfficeWorkflowPiHost();
    let service: ChatAppService;
    const toolsRepository = new ToolRepository(database);
    const tools = new ToolAppService({
      repository: toolsRepository,
      workspaceDirectory: directory,
      host: {
        availability: async () => ({
          availableToolNames: ["openerx_browser", "openerx_desktop"],
          unavailableReasons: {},
        }),
        execute: async () => ({
          summary: "unused",
          content: [{ type: "text", text: "unused" }],
          sources: [],
          artifacts: [],
          sideEffectCommitted: false,
          durationMs: 0,
        }),
        resolve: async () => "unused",
        clear: async () => undefined,
      },
      resolveUploadPath: () => "unused",
      ingestDownload: async () => ({ fileId: crypto.randomUUID(), displayName: "unused" }),
      selectedModelRef: () => "platform/auto",
      emit: (event) => service.emitExternal(event),
    });
    service = new ChatAppService(
      new ChatRepository(database),
      pi,
      null,
      files,
      tools,
      null,
      skills,
    );
    service.initialize();

    const officeSkills = builtIns.filter(({ name }) =>
      ["documents", "spreadsheets", "presentations", "pdf"].includes(name),
    );
    const conversations: Array<{ conversationId: string; skill: (typeof officeSkills)[number] }> =
      [];
    for (const [index, skill] of officeSkills.entries()) {
      const receipt = (await service.handle({
        command: "chat.send",
        input: {
          conversationId: null,
          text: `请创建 ${skill.displayName} 成果并完成视觉检查`,
          idempotencyKey: `office-natural-language-${index + 1}`,
          skillInstallationId: skill.id,
        },
      })) as { conversationId: string };
      await waitForTerminal(service, receipt.conversationId);
      conversations.push({ conversationId: receipt.conversationId, skill });
    }
    for (const [index, { conversationId, skill }] of conversations.entries()) {
      await service.handle({
        command: "chat.send",
        input: {
          conversationId,
          text: `请更新已有 ${skill.displayName}，加入 Second revision 并重新检查全部画布`,
          idempotencyKey: `office-natural-language-edit-${index + 1}`,
          skillInstallationId: skill.id,
        },
      });
      await waitForTerminal(service, conversationId);
    }

    const artifacts = files.listArtifacts();
    expect(artifacts.map(({ format }) => format).sort()).toEqual(["docx", "pdf", "pptx", "xlsx"]);
    for (const artifact of artifacts) {
      const preview = files.previewArtifact(artifact.id);
      expect(artifact).toMatchObject({ currentVersion: 2 });
      expect(artifact.versions).toHaveLength(2);
      expect(preview.renderedSurfaces).toHaveLength(2);
      expect(preview.parsedText).toContain("Second revision");
      expect(
        preview.renderedSurfaces.every(({ imageDataUrl }) =>
          imageDataUrl.startsWith("data:image/svg+xml;base64,"),
        ),
      ).toBe(true);
    }
    expect(pi.prompts).toHaveLength(8);
    expect(
      pi.prompts
        .filter((prompt) => !prompt.initialToolNames?.includes("openerx_office_artifact"))
        .map((prompt) => prompt.history.at(-1)?.text),
    ).toEqual([]);
    expect(pi.results).toHaveLength(8);
    const officeRuns = toolsRepository
      .listWorkItems()
      .map(({ id }) => toolsRepository.workItemDetail(id));
    expect(officeRuns).toHaveLength(8);
    expect(
      officeRuns.every(
        ({ items, toolCalls }) =>
          items.some(({ content }) => content.type === "tool") &&
          toolCalls.some(
            ({ input, resultContent }) =>
              input?.operation === "artifact.office.write" &&
              resultContent.some(({ type }) => type === "artifact"),
          ),
      ),
    ).toBe(true);
    service.close();
  }, 15_000);

  it("creates a persistent run before a pure-chat prompt", async () => {
    const directory = mkdtempSync(path.join(tmpdir(), "openerx-app-service-run-"));
    temporaryDirectories.push(directory);
    const database = path.join(directory, "openerx.sqlite");
    const toolsRepository = new ToolRepository(database);
    const tools = new ToolAppService({
      repository: toolsRepository,
      workspaceDirectory: directory,
      host: {
        availability: async () => ({
          availableToolNames: ["openerx_browser", "openerx_desktop"],
          unavailableReasons: {},
        }),
        execute: async () => ({
          summary: "unused",
          content: [{ type: "text", text: "unused" }],
          sources: [],
          artifacts: [],
          sideEffectCommitted: false,
          durationMs: 0,
        }),
        resolve: async () => "unused",
        clear: async () => undefined,
      },
      resolveUploadPath: () => "unused",
      ingestDownload: async () => ({ fileId: crypto.randomUUID(), displayName: "unused" }),
      selectedModelRef: () => "platform/auto",
      emit: () => undefined,
    });
    const service = new ChatAppService(
      new ChatRepository(database),
      new ScriptedPiHostClient(),
      null,
      null,
      tools,
    );
    const receipt = (await service.handle({
      command: "chat.send",
      input: { text: "纯聊天", idempotencyKey: "pure-chat-run-0001" },
    })) as { conversationId: string; assistantMessageId: string; branchId: string };
    const [workItem] = toolsRepository.listWorkItems(receipt.conversationId);
    expect(workItem?.messageId).toBe(receipt.assistantMessageId);
    if (!workItem) throw new Error("work item missing");
    expect(toolsRepository.workItemDetail(workItem.id)).toMatchObject({
      run: {
        branchId: receipt.branchId,
        thinkingLevel: "medium",
        initialToolNames: ["openerx_tool_search"],
        availableToolNames: expect.arrayContaining(["openerx_tool_search", "openerx_calculate"]),
        skillInstallationIds: [],
        instructionSources: [],
      },
      toolCalls: [],
    });
    await waitForTerminal(service, receipt.conversationId);
    expect(toolsRepository.workItemDetail(workItem.id).run.status).toBe("completed");
    service.close();
  });

  it("attaches a pending new-chat image to the user message and forwards it to Pi", async () => {
    const directory = mkdtempSync(path.join(tmpdir(), "openerx-app-service-vision-"));
    temporaryDirectories.push(directory);
    const database = path.join(directory, "openerx.sqlite");
    const profile = path.join(directory, "profile");
    const sourceImage = path.join(directory, "fixture.png");
    const imageBytes = Buffer.from("new-chat-image", "utf8");
    writeFileSync(sourceImage, imageBytes);
    const files = new FileAppService(new FileRepository(database), profile, {
      parser: new MultiFormatParser({
        extract: async () => ({ text: "", citations: [] }),
      }),
    });
    const [image] = await files.importPaths([sourceImage], null);
    if (!image) throw new Error("vision fixture import failed");
    const piHost = new ScriptedPiHostClient();
    const service = new ChatAppService(new ChatRepository(database), piHost, null, files);

    const receipt = (await service.handle({
      command: "chat.send",
      input: {
        conversationId: null,
        text: "图片里有什么？",
        idempotencyKey: "service-vision-send-0001",
        personalFileIds: [image.id],
      },
    })) as { conversationId: string; userMessageId: string };

    expect(files.listFiles(receipt.conversationId)).toHaveLength(1);
    const snapshot = (await service.handle({
      command: "chat.get",
      input: { conversationId: receipt.conversationId },
    })) as ConversationSnapshot;
    expect(snapshot.attachments).toMatchObject([
      {
        conversationId: receipt.conversationId,
        messageId: receipt.userMessageId,
        personalFileId: image.id,
      },
    ]);
    expect(piHost.prompts[0]).toMatchObject({
      conversationId: receipt.conversationId,
      images: [
        {
          personalFileId: image.id,
          displayName: "fixture.png",
          data: imageBytes.toString("base64"),
          mimeType: "image/png",
        },
      ],
    });
    await waitForTerminal(service, receipt.conversationId);
    await service.handle({
      command: "chat.send",
      input: {
        conversationId: receipt.conversationId,
        text: "继续纯文本",
        idempotencyKey: "service-vision-send-0002",
      },
    });
    expect(piHost.prompts[1]?.images).toBeUndefined();
    await waitForTerminal(service, receipt.conversationId);
    service.close();
  });

  it("projects Pi Host events into durable conversation state", async () => {
    const service = createService();
    const receipt = (await service.handle({
      command: "chat.send",
      input: {
        conversationId: null,
        text: "法国的首都是哪里？",
        idempotencyKey: "service-send-0001",
      },
    })) as { conversationId: string };
    await waitForTerminal(service, receipt.conversationId);
    const snapshot = (await service.handle({
      command: "chat.get",
      input: { conversationId: receipt.conversationId },
    })) as { messages: Array<{ status: string; parts: Array<{ text: string }> }> };
    expect(snapshot.messages.at(-1)).toMatchObject({ status: "completed" });
    expect(snapshot.messages.at(-1)?.parts[0]?.text).toBe("巴黎。");
    service.close();
  });

  it("stops a long generation without accepting later Pi deltas", async () => {
    const service = createService();
    const lifecycle: string[] = [];
    const unsubscribe = service.onEvent((event) => lifecycle.push(event.type));
    const receipt = (await service.handle({
      command: "chat.send",
      input: {
        conversationId: null,
        text: "写 2000 字 [PI_TEST_SLOW]",
        idempotencyKey: "service-stop-0001",
      },
    })) as { conversationId: string; assistantMessageId: string };
    await service.handle({
      command: "chat.stop",
      input: {
        conversationId: receipt.conversationId,
        assistantMessageId: receipt.assistantMessageId,
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 30));
    const snapshot = (await service.handle({
      command: "chat.get",
      input: { conversationId: receipt.conversationId },
    })) as { messages: Array<{ status: string }> };
    expect(snapshot.messages.at(-1)?.status).toBe("interrupted");
    expect(lifecycle.indexOf("message.cancelling")).toBeGreaterThanOrEqual(0);
    expect(lifecycle.indexOf("message.interrupted")).toBeGreaterThan(
      lifecycle.indexOf("message.cancelling"),
    );
    unsubscribe();
    service.close();
  });

  it("fails once with partial output and completes a regeneration branch", async () => {
    const service = createService();
    const failed = (await service.handle({
      command: "chat.send",
      input: {
        conversationId: null,
        text: "请失败 [PI_TEST_FAIL]",
        idempotencyKey: "service-fail-0001",
      },
    })) as { conversationId: string; assistantMessageId: string };
    await waitForTerminal(service, failed.conversationId);
    const retry = (await service.handle({
      command: "chat.regenerate",
      input: {
        conversationId: failed.conversationId,
        assistantMessageId: failed.assistantMessageId,
        idempotencyKey: "service-retry-0001",
      },
    })) as { assistantMessageId: string };
    await waitForTerminal(service, failed.conversationId);
    const snapshot = (await service.handle({
      command: "chat.get",
      input: { conversationId: failed.conversationId },
    })) as { branches: unknown[]; messages: Array<{ id: string; status: string }> };
    expect(snapshot.branches).toHaveLength(2);
    expect(snapshot.messages.find(({ id }) => id === retry.assistantMessageId)?.status).toBe(
      "completed",
    );
    service.close();
  });

  it("freezes PBASH-001 execution context into the Pi prompt without exposing legacy Shell", async () => {
    const directory = mkdtempSync(path.join(tmpdir(), "openerx-pbash-chat-"));
    temporaryDirectories.push(directory);
    const database = path.join(directory, "openerx.sqlite");
    const pi = new ScriptedPiHostClient();
    const toolRepository = new ToolRepository(database);
    let service: ChatAppService;
    const tools = new ToolAppService({
      repository: toolRepository,
      workspaceDirectory: directory,
      brokeredBashV1: true,
      host: {
        availability: async () => ({ availableToolNames: [], unavailableReasons: {} }),
        execute: async () => ({
          summary: "unused",
          content: [{ type: "text", text: "unused" }],
          sources: [],
          artifacts: [],
          sideEffectCommitted: false,
          durationMs: 0,
        }),
        resolve: async () => "unused",
        clear: async () => undefined,
      },
      resolveUploadPath: () => "unused",
      ingestDownload: async () => ({ fileId: crypto.randomUUID(), displayName: "unused" }),
      selectedModelRef: () => "platform/auto",
      emit: (event) => service.emitExternal(event),
    });
    const grant = tools.grantWorkspace({
      rootPath: directory,
      conversationId: null,
      access: "read_write",
      allowNetwork: false,
      expiresAt: null,
    });
    service = new ChatAppService(new ChatRepository(database), pi, null, null, tools);
    service.initialize();

    const receipt = (await service.handle({
      command: "chat.send",
      input: {
        conversationId: null,
        text: "运行构建测试命令",
        idempotencyKey: "pbash-chat-prompt-0001",
      },
    })) as { conversationId: string };
    await waitForTerminal(service, receipt.conversationId);

    expect(pi.prompts[0]?.availableToolNames).toContain("bash");
    expect(pi.prompts[0]?.availableToolNames).not.toContain("openerx_shell");
    expect(pi.prompts[0]?.workspace?.execution).toMatchObject({
      activeExecutionGrantId: grant.id,
      executionProfile: "workspace_write",
      networkPolicyId: "network-deny-v1",
      sandboxPolicyVersion: "pbash-fake-v1",
    });
    service.close();
  });
});
