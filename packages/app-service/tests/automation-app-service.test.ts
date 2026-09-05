import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { AutomationRepository } from "@openerx/storage";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AutomationAppService } from "../src";

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("AutomationAppService", () => {
  it("exposes create, list, pause, resume and run-now commands", async () => {
    const directory = mkdtempSync(path.join(tmpdir(), "openerx-automation-service-"));
    directories.push(directory);
    const now = "2026-08-29T02:00:00.000Z";
    const repository = new AutomationRepository(path.join(directory, "service.sqlite"), {
      now: () => now,
    });
    const wake = vi.fn().mockResolvedValue([]);
    const service = new AutomationAppService(repository, wake);
    const created = await service.handle({
      command: "automation.create",
      input: {
        name: "Daily",
        prompt: "Prepare a daily brief",
        kind: "standalone",
        schedule: {
          mode: "rrule",
          expression: "FREQ=DAILY",
          timezone: "UTC",
          startAt: "2026-08-30T02:00:00.000Z",
        },
      },
    });
    if (Array.isArray(created) || !("revision" in created)) throw new Error("create failed");

    expect(await service.handle({ command: "automation.list", input: {} })).toHaveLength(1);
    const preview = await service.handle({
      command: "automation.schedule.preview",
      input: {
        schedule: created.schedule,
        count: 2,
        after: now,
      },
    });
    expect(preview).toMatchObject({
      occurrences: ["2026-08-30T02:00:00.000Z", "2026-08-31T02:00:00.000Z"],
    });
    const updated = await service.handle({
      command: "automation.update",
      input: {
        automationId: created.id,
        revision: created.revision,
        changes: { name: "Updated daily" },
      },
    });
    if (Array.isArray(updated) || !("revision" in updated)) throw new Error("update failed");
    expect(updated.name).toBe("Updated daily");
    const paused = await service.handle({
      command: "automation.pause",
      input: { automationId: updated.id, revision: updated.revision },
    });
    if (Array.isArray(paused) || !("revision" in paused)) throw new Error("pause failed");
    expect(paused.status).toBe("paused");
    const resumed = await service.handle({
      command: "automation.resume",
      input: { automationId: paused.id, revision: paused.revision },
    });
    if (Array.isArray(resumed) || !("revision" in resumed)) throw new Error("resume failed");
    expect(resumed.status).toBe("active");
    expect(
      await service.handle({ command: "automation.runNow", input: { automationId: resumed.id } }),
    ).toMatchObject({ trigger: "manual", status: "scheduled" });
    expect(wake).toHaveBeenCalledTimes(4);
    repository.close();
  });
});
