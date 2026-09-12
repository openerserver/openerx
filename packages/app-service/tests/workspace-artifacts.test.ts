import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Artifact, ToolOperation, WorkspaceChangeSetEntry } from "@openerx/contracts";
import { FileAppService } from "@openerx/file-service";
import { ChatRepository, FileRepository, ToolRepository } from "@openerx/storage";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChatAppService, type PiHostClient, ToolAppService } from "../src";

const directories: string[] = [];
const disposers: Array<() => Promise<void>> = [];
const sha = (text: string): string => createHash("sha256").update(text).digest("hex");

function fixture() {
  const directory = mkdtempSync(path.join(tmpdir(), "openerx-workspace-outputs-"));
  directories.push(directory);
  const workspace = path.join(directory, "website");
  const profile = path.join(directory, "profile");
  mkdirSync(workspace);
  mkdirSync(profile);
  const database = path.join(profile, "openerx.sqlite");
  const chat = new ChatRepository(database);
  const repository = new ToolRepository(database);
  const files = new FileAppService(new FileRepository(database), profile);
  const pi: PiHostClient = {
    prompt: vi.fn(async () => undefined),
    abort: vi.fn(async () => undefined),
    control: vi.fn(async () => undefined),
    onEvent: () => () => undefined,
    onActivity: () => () => undefined,
    onFileToolRequest: () => () => undefined,
    onToolRequest: () => () => undefined,
  };
  const tools = new ToolAppService({
    repository,
    workspaceDirectory: profile,
    defaultWorkspaceDirectory: workspace,
    host: {
      availability: async () => ({ availableToolNames: [], unavailableReasons: {} }),
      execute: async () => {
        throw new Error("unused");
      },
      resolve: async () => "unused",
      clear: async () => undefined,
    },
    resolveUploadPath: () => "unused",
    ingestDownload: async () => {
      throw new Error("unused");
    },
    selectedModelRef: () => "platform/auto",
    emit: () => undefined,
    brokeredBashV1: false,
  });
  const service = new ChatAppService(chat, pi, null, files, tools);
  disposers.push(async () => {
    chat.close();
    files.close();
    await tools.close();
  });
  const generation = chat.createGeneration({ text: "生成外贸网站", idempotencyKey: randomUUID() });
  const conversationId = generation.receipt.conversationId;
  const generationId = randomUUID();
  const grant = repository.grantWorkspace({
    conversationId,
    displayName: "website",
    rootPath: workspace,
    access: "read_write",
    allowNetwork: false,
    expiresAt: null,
  });
  tools.setPermissionMode({ conversationId, mode: "full_access" });
  const call = (operation: ToolOperation, toolName = "openerx_workspace_apply_patch") =>
    tools.handleRequest({
      kind: "pi.tool.request",
      requestId: randomUUID(),
      generationId,
      conversationId,
      branchId: generation.receipt.branchId,
      assistantMessageId: generation.receipt.assistantMessageId,
      piToolCallId: randomUUID(),
      toolName,
      operation,
    });
  const patch = (relativePath: string, text: string, before: string | null = null) => {
    mkdirSync(path.dirname(path.join(workspace, relativePath)), { recursive: true });
    return call({
      operation: "workspace_apply_patch",
      workspaceGrantId: grant.id,
      relativePath,
      expectedSha256: before === null ? null : sha(before),
      replacements: [{ oldText: before ?? "", newText: text }],
      instructionDigests: [],
      idempotencyKey: randomUUID(),
    });
  };
  const outputs = (id = conversationId) =>
    service.handle({ command: "artifact.list", input: { conversationId: id } }) as Promise<
      Artifact[]
    >;
  return {
    directory,
    database,
    profile,
    workspace,
    chat,
    repository,
    files,
    tools,
    service,
    generation,
    conversationId,
    grant,
    call,
    patch,
    outputs,
  };
}

afterEach(async () => {
  for (const dispose of disposers.splice(0)) await dispose();
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

describe("workspace output artifacts", () => {
  it("backfills historical workspace writes, keeps source attachments separate, and supports preview/export", async () => {
    const f = fixture();
    const paths = [
      "index.html",
      "about.html",
      "collections.html",
      "contact.html",
      "policies.html",
      "product.html",
      "services.html",
      "assets/css/style.css",
      "assets/js/app.js",
      "assets/js/data.js",
      "tools/site-test.js",
      "README.md",
    ];
    for (const relative of paths) await f.patch(relative, `file: ${relative}`);
    writeFileSync(path.join(f.workspace, "supplier-notes.txt"), "input only");
    await f.files.importPaths([path.join(f.workspace, "supplier-notes.txt")], f.conversationId);
    expect(f.files.listArtifacts()).toHaveLength(0);
    expect(f.repository.artifactRetention(f.conversationId).deliverableIds).toEqual([]);

    const outputs = await f.outputs();
    expect(outputs.map(({ displayName }) => displayName).sort()).toEqual([...paths].sort());
    expect(f.files.listFiles(f.conversationId).map(({ displayName }) => displayName)).toEqual([
      "supplier-notes.txt",
    ]);
    expect((await f.outputs()).map(({ id, currentVersion }) => [id, currentVersion])).toEqual(
      outputs.map(({ id }) => [id, 1]),
    );
    const index = outputs.find(({ displayName }) => displayName === "index.html");
    if (!index) throw new Error("missing index artifact");
    await expect(
      f.service.handle({ command: "artifact.preview", input: { artifactId: index.id } }),
    ).resolves.toMatchObject({ source: "file: index.html", format: "html" });
    const destinationPath = path.join(f.directory, "export.html");
    await f.service.handle({
      command: "artifact.export",
      input: { artifactId: index.id, destinationPath },
    });
    expect(readFileSync(destinationPath, "utf8")).toBe("file: index.html");
    const reopened = new FileRepository(f.database);
    expect(reopened.workspaceArtifactLinks(f.conversationId)).toHaveLength(12);
    reopened.close();
  });

  it("versions an updated file once, preserves relative paths and isolates conversations", async () => {
    const f = fixture();
    await f.patch("index.html", "first");
    const [first] = await f.outputs();
    if (!first) throw new Error("missing first artifact");
    await f.patch("index.html", "second", "first");
    await f.patch("nested/index.html", "nested");
    const outputs = await f.outputs();
    const updated = outputs.find(({ id }) => id === first.id);
    if (!updated) throw new Error("missing updated artifact");
    expect(updated.currentVersion).toBe(2);
    expect(updated.versions.map(({ checksumSha256 }) => checksumSha256)).toEqual([
      sha("first"),
      sha("second"),
    ]);
    expect((await f.outputs()).find(({ id }) => id === first.id)?.currentVersion).toBe(2);
    expect(outputs.map(({ displayName }) => displayName)).toContain("nested/index.html");
    const other = f.chat.createGeneration({ text: "unrelated", idempotencyKey: randomUUID() });
    expect(await f.outputs(other.receipt.conversationId)).toEqual([]);
    const otherOwner = new ToolRepository(f.database, { ownerProfileId: "other-owner" });
    expect(otherOwner.workspaceOutputCandidates()).toEqual([]);
    otherOwner.close();
  });

  it("skips missing, changed, reverted, unsupported and symlinked files without hiding valid results", async () => {
    const f = fixture();
    await f.patch("valid.txt", "valid");
    await f.patch("missing.txt", "gone");
    rmSync(path.join(f.workspace, "missing.txt"));
    await f.patch("changed.txt", "generated");
    writeFileSync(path.join(f.workspace, "changed.txt"), "later user edit");
    await f.patch("unsupported.unknown", "unsupported");
    await f.patch("link.txt", "outside");
    const outside = path.join(f.directory, "outside.txt");
    writeFileSync(outside, "outside");
    rmSync(path.join(f.workspace, "link.txt"));
    symlinkSync(outside, path.join(f.workspace, "link.txt"));
    const reverted = await f.patch("reverted.txt", "reverted");
    const diff = reverted.content.find((part) => part.type === "diff");
    if (diff?.type !== "diff") throw new Error("missing diff");
    await f.call({
      operation: "workspace_undo",
      workspaceGrantId: f.grant.id,
      workspaceChangeId: diff.workspaceChangeId,
      idempotencyKey: randomUUID(),
    });
    expect((await f.outputs()).map(({ displayName }) => displayName)).toEqual(["valid.txt"]);
    await f.patch("revoked.txt", "revoked");
    f.repository.revokeWorkspaceGrant(f.grant.id);
    expect((await f.outputs()).map(({ displayName }) => displayName)).toEqual(["valid.txt"]);
  });

  it("only backfills applied change sets, including additional workspace roots", async () => {
    const f = fixture();
    await f.patch("seed.txt", "seed");
    const work = f.repository.listWorkItems(f.conversationId)[0];
    if (!work?.activeRunId) throw new Error("missing run");
    const run = f.repository.run(work.activeRunId);
    const extra = path.join(f.directory, "extra");
    mkdirSync(extra);
    const extraGrant = f.repository.grantWorkspace({
      conversationId: f.conversationId,
      displayName: "extra",
      rootPath: extra,
      access: "read_write",
      allowNetwork: false,
      expiresAt: null,
    });
    const entries: WorkspaceChangeSetEntry[] = [f.grant, extraGrant].map((grant) => ({
      workspaceGrantId: grant.id,
      workspaceLogicalName: grant.displayName,
      relativePath: "report.txt",
      previousRelativePath: null,
      kind: "created",
      entryType: "file",
      beforeSha256: null,
      afterSha256: sha(grant.displayName),
      beforeText: null,
      afterText: grant.displayName,
      applySupported: true,
    }));
    for (const grant of [f.grant, extraGrant])
      writeFileSync(path.join(grant.rootPath, "report.txt"), grant.displayName);
    const call = f.repository.createToolCall({
      runId: run.id,
      piCallRef: randomUUID(),
      toolName: "bash",
      source: "openerx",
      risk: "L3",
      idempotencyKey: randomUUID(),
      inputSummary: "write files",
      targetSummary: "workspace",
    });
    const changeSet = f.repository.createWorkspaceChangeSet({
      workspaceGrantId: f.grant.id,
      runId: run.id,
      toolCallId: call.toolCall.id,
      baselineRevision: sha("before"),
      finalRevision: sha("after"),
      manifest: [],
      diffs: [],
      entries,
      blocked: false,
    });
    expect((await f.outputs()).map(({ displayName }) => displayName)).toEqual(["seed.txt"]);
    f.repository.markWorkspaceChangeSet(changeSet.id, "applied");
    expect(
      (await f.outputs()).filter(({ displayName }) => displayName === "report.txt"),
    ).toHaveLength(2);
  });

  it.skipIf(process.platform !== "darwin")(
    "collects files actually created by foreground and background shell commands",
    async () => {
      const f = fixture();
      await f.call(
        {
          operation: "shell_execute",
          workspaceGrantId: f.grant.id,
          relativeCwd: ".",
          command: "/bin/sh",
          args: ["-c", "printf 'shell file' > shell.txt"],
          timeoutMs: 5000,
          background: false,
          allowNetwork: false,
          idempotencyKey: randomUUID(),
        },
        "openerx_shell",
      );
      expect((await f.outputs()).map(({ displayName }) => displayName)).toEqual(["shell.txt"]);
      await f.call(
        {
          operation: "shell_execute",
          workspaceGrantId: f.grant.id,
          relativeCwd: ".",
          command: "/bin/sh",
          args: ["-c", "sleep 0.1; printf 'background file' > background.txt"],
          timeoutMs: 5000,
          background: true,
          allowNetwork: false,
          idempotencyKey: randomUUID(),
        },
        "openerx_shell",
      );
      await vi.waitFor(async () =>
        expect((await f.outputs()).map(({ displayName }) => displayName).sort()).toEqual([
          "background.txt",
          "shell.txt",
        ]),
      );
    },
  );
});
