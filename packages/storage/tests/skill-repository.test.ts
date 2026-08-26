import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { SkillPackageManifest, SyncPullResult } from "@openerx/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { ChatRepository, SkillRepository } from "../src";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const accountId = "00000000-0000-4000-8000-000000000801";
const deviceA = "00000000-0000-4000-8000-000000000802";
const deviceB = "00000000-0000-4000-8000-000000000803";
const installationId = "00000000-0000-4000-8000-000000000804";
const manifest: SkillPackageManifest = {
  version: "1.0.0",
  publisher: "Fixture",
  tools: [],
  mcp_servers: [],
  permissions: [],
  platforms: ["darwin", "win32"],
  scripts: [],
};

describe("SkillRepository sync boundary", () => {
  it("syncs installation metadata without local package paths or device permission approval", () => {
    const root = mkdtempSync(path.join(tmpdir(), "openerx-skill-sync-"));
    roots.push(root);
    const sourceDb = path.join(root, "source.sqlite");
    const source = new SkillRepository(sourceDb, { ownerProfileId: accountId, deviceId: deviceA });
    const installed = source.installVersion({
      installationId,
      name: "sync-skill",
      displayName: "Sync skill",
      description: "Sync fixture",
      publisher: "Fixture",
      scope: "personal",
      workspaceId: null,
      sourceKind: "local_directory",
      sourceLabel: "fixture-source",
      trust: "unverified",
      version: "1.0.0",
      checksumSha256: "a".repeat(64),
      packagePath: "/device-a/private/skill-package",
      manifest,
      permissionDigest: "b".repeat(64),
    });
    source.setEnabled(installed.id, true);
    const sourceChat = new ChatRepository(sourceDb, {
      ownerProfileId: accountId,
      deviceId: deviceA,
    });
    const operations = sourceChat.pendingSyncOperations();
    const latest = operations.at(-1);
    expect(latest?.objectType).toBe("skill_installation");
    expect(JSON.stringify(latest?.payload)).not.toContain("/device-a/private");

    const targetDb = path.join(root, "target.sqlite");
    const targetChat = new ChatRepository(targetDb, {
      ownerProfileId: accountId,
      deviceId: deviceB,
    });
    const pull: SyncPullResult = {
      changes: [
        {
          cursor: "cursor:1",
          accountId,
          objectType: "skill_installation",
          objectId: installationId,
          revision: 1,
          tombstone: false,
          payloadVersion: 1,
          payload: latest?.payload ?? null,
          operationId: latest?.operationId ?? "00000000-0000-4000-8000-000000000805",
          changedAt: new Date().toISOString(),
          retainUntil: null,
        },
      ],
      nextCursor: "cursor:1",
    };
    targetChat.applySyncPull(pull);
    const target = new SkillRepository(targetDb, { ownerProfileId: accountId, deviceId: deviceB });
    expect(target.get(installationId)).toMatchObject({
      packageState: "missing",
      enabled: false,
      approvedPermissionDigest: null,
      version: "1.0.0",
    });
    target.close();
    targetChat.close();
    sourceChat.close();
    source.close();
  });
});
