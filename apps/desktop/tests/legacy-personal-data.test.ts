import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { ChatRepository, FileRepository } from "@openerx/storage";
import { strFromU8, unzipSync } from "fflate";
import { afterEach, expect, test } from "vitest";
import { LegacyPersonalDataReader } from "../src/main/legacy-personal-data";

const directories: string[] = [];
function directory() {
  const result = mkdtempSync(path.join(tmpdir(), "openerx-legacy-data-"));
  directories.push(result);
  return result;
}
afterEach(() => {
  for (const item of directories.splice(0)) rmSync(item, { recursive: true, force: true });
});
function seed(profile: string, text: string, ownerProfileId = "local-default") {
  mkdirSync(profile, { recursive: true });
  const repository = new ChatRepository(path.join(profile, "openerx-v2.sqlite"), {
    ownerProfileId,
  });
  try {
    return repository.createGeneration({ text, idempotencyKey: text }).receipt.conversationId;
  } finally {
    repository.close();
  }
}
function digest(file: string) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

test("legacy browsing reads only the fixed guest database and never mutates it", () => {
  const base = directory();
  const legacyId = seed(base, "upgrade-era guest record");
  const otherId = seed(
    path.join(base, "central-personal", "other-account"),
    "private account record",
    "other-account",
  );
  const file = path.join(base, "openerx-v2.sqlite");
  const before = digest(file);
  const reader = new LegacyPersonalDataReader(base);
  expect(reader.list().map(({ id }) => id)).toEqual([legacyId]);
  expect(reader.get(legacyId).messages[0]?.parts[0]?.text).toBe("upgrade-era guest record");
  expect(() => reader.get(otherId)).toThrow("Conversation not found");
  expect(reader.summary().conversations).toBe(1);
  const destination = path.join(base, "legacy.zip");
  reader.export(destination);
  const data = unzipSync(readFileSync(destination))["data.json"];
  if (!data) throw new Error("Missing export");
  const exported = strFromU8(data);
  expect(exported).toContain("upgrade-era guest record");
  expect(exported).not.toContain("private account record");
  expect(digest(file)).toBe(before);
});

test("read-only repository rejects mutations at the SQLite boundary", () => {
  const base = directory();
  seed(base, "preserved");
  const file = path.join(base, "openerx-v2.sqlite");
  const before = digest(file);
  const reader = new ChatRepository(file, { readOnly: true });
  try {
    expect(reader.listConversations()).toHaveLength(1);
    expect(() =>
      reader.createGeneration({ text: "must not persist", idempotencyKey: "readonly" }),
    ).toThrow();
  } finally {
    reader.close();
  }
  expect(digest(file)).toBe(before);
});

test("missing legacy data stays absent and cannot resolve a nested account database", () => {
  const base = directory();
  seed(path.join(base, "central-personal", "account"), "account-only", "account");
  const reader = new LegacyPersonalDataReader(base);
  expect(reader.list()).toEqual([]);
  expect(reader.summary().conversations).toBe(0);
  expect(existsSync(path.join(base, "openerx-v2.sqlite"))).toBe(false);
});

test("legacy paths cannot be redirected to a central account using a database symlink", () => {
  const base = directory();
  const other = path.join(base, "central-personal", "account");
  seed(other, "private", "account");
  symlinkSync(path.join(other, "openerx-v2.sqlite"), path.join(base, "openerx-v2.sqlite"));
  const reader = new LegacyPersonalDataReader(base);
  expect(() => reader.list()).toThrow("LEGACY_DATABASE_PATH_INVALID");
  expect(() => reader.summary()).toThrow("LEGACY_DATABASE_PATH_INVALID");
});

test("legacy export excludes account objects and symbolic links outside guest objects", () => {
  const base = directory();
  seed(base, "legacy");
  const privatePath = path.join(base, "central-personal", "account", "private.txt");
  mkdirSync(path.dirname(privatePath), { recursive: true });
  writeFileSync(privatePath, "PRIVATE-ACCOUNT-BINARY");
  const objectRef = `objects/sha256/aa/${"a".repeat(64)}`;
  const objectPath = path.join(base, objectRef);
  mkdirSync(path.dirname(objectPath), { recursive: true });
  symlinkSync(privatePath, objectPath);
  const files = new FileRepository(path.join(base, "openerx-v2.sqlite"));
  try {
    const scope = files.createScope({ kind: "file", displayName: "fixture.txt", rootPath: base });
    files.upsertPersonalFile({
      displayName: "fixture.txt",
      format: "text",
      mediaType: "text/plain",
      sizeBytes: 22,
      checksumSha256: "a".repeat(64),
      objectRef,
      sourceScopeId: scope.id,
      sourceRelativePath: "fixture.txt",
    });
  } finally {
    files.close();
  }
  const destination = path.join(base, "legacy.zip");
  new LegacyPersonalDataReader(base).export(destination);
  const archive = unzipSync(readFileSync(destination));
  expect(Object.keys(archive)).toEqual(["data.json"]);
  expect(strFromU8(archive["data.json"] ?? new Uint8Array())).not.toContain(
    "PRIVATE-ACCOUNT-BINARY",
  );
});
