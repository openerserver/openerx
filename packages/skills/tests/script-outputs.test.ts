import { randomUUID } from "node:crypto";
import {
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  truncateSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { toolOperationSchema } from "@openerx/contracts";
import { SkillRepository } from "@openerx/storage";
import { ShellToolAdapter } from "@openerx/tool-sdk";
import { strToU8, zipSync } from "fflate";
import { afterEach, expect, test, vi } from "vitest";
import { SkillPackageService, SkillToolAdapter } from "../src";
import { readSkillScriptOutputs } from "../src/script-outputs";

const roots: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
function root() {
  const directory = mkdtempSync(path.join(tmpdir(), "skill-output-test-"));
  roots.push(directory);
  mkdirSync(path.join(directory, "outputs"));
  return directory;
}
const output = {
  relativePath: "outputs/report.docx",
  displayName: "report.docx",
  purpose: "deliverable" as const,
};
test("declared binary files are captured byte for byte; undeclared files are omitted", () => {
  const directory = root(),
    bytes = Buffer.from([0, 255, 128, 1]);
  writeFileSync(path.join(directory, output.relativePath), bytes);
  writeFileSync(path.join(directory, "outputs/private.txt"), "not requested");
  expect(readSkillScriptOutputs(directory, [output])).toEqual([{ ...output, bytes }]);
  expect(() => readSkillScriptOutputs(directory, [output, output])).toThrow(
    "SKILL_OUTPUT_DUPLICATE",
  );
});
test.each([
  "../outside.docx",
  "outputs/../assets/source.docx",
  "/tmp/report.docx",
  "outputs\\report.docx",
  "outputs/C:/report.docx",
])("output path %s cannot escape or capture package inputs", (relativePath) => {
  expect(() => readSkillScriptOutputs(root(), [{ ...output, relativePath }])).toThrow();
});
test.each(["file", "ancestor", "hardlink"])("outputs reject %s links into host files", (kind) => {
  const directory = root(),
    outside = root(),
    target = path.join(outside, "host.docx");
  writeFileSync(target, "HOST_SECRET");
  const destination = path.join(directory, output.relativePath);
  if (kind === "file") symlinkSync(target, destination);
  else if (kind === "hardlink") linkSync(target, destination);
  else {
    rmSync(path.join(directory, "outputs"), { recursive: true });
    symlinkSync(outside, path.join(directory, "outputs"));
  }
  expect(() =>
    readSkillScriptOutputs(directory, [
      { ...output, relativePath: kind === "ancestor" ? "outputs/host.docx" : output.relativePath },
    ]),
  ).toThrow("SKILL_OUTPUT_PATH_INVALID");
});
test("missing and oversize outputs fail before a collector receives anything", () => {
  const directory = root();
  expect(() => readSkillScriptOutputs(directory, [output])).toThrow();
  writeFileSync(path.join(directory, output.relativePath), "");
  truncateSync(path.join(directory, output.relativePath), 10 * 1024 * 1024 + 1);
  expect(() => readSkillScriptOutputs(directory, [output])).toThrow("SKILL_OUTPUT_TOO_LARGE");
});
test("collecting outputs uses a pinned copy, captures before cleanup and keeps managed assets intact", async () => {
  const directory = root(),
    service = new SkillPackageService(new SkillRepository(":memory:"), directory, "darwin");
  const source = path.join(directory, "skill.zip");
  const install = (version: string) => {
    writeFileSync(
      source,
      zipSync({
        "SKILL.md": strToU8("---\nname: template-helper\ndescription: Render template.\n---\n"),
        "agents/openai.yaml": strToU8(
          `version: ${version}\npermissions: []\nscripts: [scripts/render.mjs]\nplatforms: [darwin]\n`,
        ),
        "scripts/render.mjs": strToU8("fixture"),
        "assets/template.docx": new Uint8Array([0, 255, Number(version[0])]),
      }),
    );
    return version === "1.0.0"
      ? service.install({
          sourcePath: source,
          sourceKind: "archive",
          scope: "personal",
          workspaceId: null,
        })
      : service.update({
          installationId: service.list()[0]?.id ?? "",
          sourcePath: source,
          sourceKind: "archive",
        });
  };
  const first = install("1.0.0");
  install("2.0.0");
  const context = { toolCallId: randomUUID(), signal: new AbortController().signal, update() {} };
  let scratch = "";
  vi.spyOn(ShellToolAdapter.prototype, "execute").mockImplementation(async (operation) => {
    if (operation.operation !== "shell_execute") throw new Error("wrong operation");
    if (!operation.cwd) throw new Error("missing scratch");
    scratch = operation.cwd;
    mkdirSync(path.join(scratch, "outputs"));
    writeFileSync(
      path.join(scratch, output.relativePath),
      readFileSync(path.join(scratch, "assets/template.docx")),
    );
    return {
      summary: "done",
      content: [],
      sources: [],
      artifacts: [],
      sideEffectCommitted: true,
      durationMs: 1,
    };
  });
  const collect = vi.fn(async (outputs: unknown) => {
    expect(existsSync(scratch)).toBe(true);
    expect(outputs).toEqual([{ ...output, bytes: Buffer.from([0, 255, 1]) }]);
    return {
      summary: "saved",
      content: [],
      sources: [],
      artifacts: ["saved-id"],
      sideEffectCommitted: true,
      durationMs: 1,
    };
  });
  const adapter = new SkillToolAdapter(service, new Map([[first.id, "1.0.0"]]), {
    isolatedScripts: true,
    collectOutputs: collect,
  });
  const operation = toolOperationSchema.parse({
    operation: "skill_script_execute",
    idempotencyKey: "binary-output",
    installationId: first.id,
    relativePath: "scripts/render.mjs",
    args: [],
    timeoutMs: 1000,
    outputs: [output],
  });
  try {
    expect((await adapter.execute(operation, context)).artifacts).toEqual(["saved-id"]);
    expect(existsSync(scratch)).toBe(false);
    expect(service.readResourceBytes(first.id, "assets/template.docx", "1.0.0").bytes).toEqual(
      Buffer.from([0, 255, 1]),
    );
    expect(() => service.readResourceBytes(first.id, "../outside.docx", "1.0.0")).toThrow();
    const mounted = service.versionMount(first.id, "1.0.0");
    writeFileSync(path.join(mounted.baseDir, "assets/template.docx"), "tampered");
    expect(() => service.readResourceBytes(first.id, "assets/template.docx", "1.0.0")).toThrow(
      "SKILL_PACKAGE_DAMAGED",
    );
  } finally {
    await adapter.stopAll();
    service.close();
  }
});
