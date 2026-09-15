import type { RemoteHost } from "@openerx/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MobileApi } from "../../apps/mobile/src/mobile-api";
import {
  hostPresenceLabel,
  isRemoteHostReachable,
  type MobileTask,
  taskConnectionLabel,
} from "../../apps/mobile/src/presentation";

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const host: RemoteHost = {
  version: 1,
  accountId: crypto.randomUUID(),
  hostDeviceId: crypto.randomUUID(),
  displayName: "测试电脑",
  platform: "darwin",
  arch: "arm64",
  appVersion: "2.0.5",
  capabilities: ["task.start"],
  remoteEnabled: true,
  presence: "online",
  revision: 1,
  presenceChangedAt: new Date().toISOString(),
};
const task: MobileTask = {
  id: crypto.randomUUID(),
  hostDeviceId: host.hostDeviceId,
  title: "历史任务",
  updatedAt: new Date().toISOString(),
  status: "completed",
  messages: [],
  activeMessageId: null,
};

describe("mobile connection recovery", () => {
  it("keeps a degraded, authorized host reachable and displays instability accurately", () => {
    const degraded = { ...host, presence: "degraded" as const };
    expect(isRemoteHostReachable(degraded)).toBe(true);
    expect(hostPresenceLabel(degraded)).toBe("连接不稳定");
    expect(taskConnectionLabel(degraded, true)).toBe("连接不稳定，正在自动重试");
  });
  it.each(["offline", "revoked"] as const)("blocks a genuinely %s host", (presence) => {
    expect(isRemoteHostReachable({ ...host, presence })).toBe(false);
  });
  it("blocks remote-disabled hosts and keeps authorization distinct from connectivity", () => {
    expect(isRemoteHostReachable({ ...host, remoteEnabled: false })).toBe(false);
    expect(taskConnectionLabel(host, false)).toContain("尚未授权");
  });
  it("does not call an online computer disconnected when viewing archived tasks or old branches", () => {
    expect(taskConnectionLabel(host, true, { ...task, archivedAt: task.updatedAt })).toBe(
      "已连接 · 已归档任务",
    );
    expect(
      taskConnectionLabel(host, true, {
        ...task,
        viewingBranchId: "old",
        activeBranchId: "current",
      }),
    ).toBe("已连接 · 历史分支");
  });
  it.each(["headers", "body"])(
    "releases a stalled %s read and permits the next discovery request",
    async (phase) => {
      vi.useFakeTimers();
      const hanging = new Promise<never>(() => undefined);
      const fetcher = vi
        .fn()
        .mockResolvedValueOnce(phase === "headers" ? hanging : { ok: true, json: () => hanging })
        .mockResolvedValueOnce(Response.json([host]));
      vi.stubGlobal("fetch", fetcher);
      const api = new MobileApi("https://platform.example");
      const pending = expect(api.listHosts("token")).rejects.toThrow("REMOTE_REQUEST_TIMEOUT");
      await vi.advanceTimersByTimeAsync(15_000);
      await pending;
      expect(fetcher.mock.calls[0]?.[1].signal.aborted).toBe(true);
      expect(await api.listHosts("token")).toEqual([host]);
      expect(vi.getTimerCount()).toBe(0);
    },
  );
});
