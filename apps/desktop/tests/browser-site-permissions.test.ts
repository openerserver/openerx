import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type BrowserSiteDecision,
  BrowserSitePermissions,
  browserSiteHost,
} from "../src/main/browser-computer-use/browser-site-permissions";

const directories: string[] = [];
function fixture(decision: BrowserSiteDecision = "task") {
  const directory = mkdtempSync(path.join(tmpdir(), "openerx-site-policy-"));
  directories.push(directory);
  const prompt = vi.fn(async () => decision);
  return { directory, prompt, permissions: new BrowserSitePermissions(directory, prompt) };
}
afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});
describe("browser website permissions", () => {
  it("cancels a prompt without permanently blocking the website", async () => {
    const { permissions } = fixture("deny");
    await expect(
      permissions.require("https://example.com", "task", new AbortController().signal),
    ).rejects.toThrow("BROWSER_NAVIGATION_DENIED");
    expect(permissions.policy).toEqual({
      allowAllSites: false,
      allowedHosts: [],
      blockedHosts: [],
    });
  });
  it("shares task permissions across tabs and paths, but never across tasks or restarts", async () => {
    const { permissions, prompt, directory } = fixture();
    const signal = new AbortController().signal;
    await permissions.require("https://example.com/a", "task-1", signal);
    await permissions.require("https://example.com/b", "task-1", signal);
    expect(prompt).toHaveBeenCalledTimes(1);
    expect(permissions.allows("https://example.com/b", "task-2")).toBe(false);
    expect(
      new BrowserSitePermissions(directory, prompt).allows("https://example.com/b", "task-1"),
    ).toBe(false);
    permissions.release("task-1");
    expect(permissions.allows("https://example.com", "task-1")).toBe(false);
  });
  it("persists allowed sites; deny rules override all-sites and removal returns to asking", async () => {
    const { permissions, prompt, directory } = fixture("site");
    await permissions.require("https://example.com/a", "task", new AbortController().signal);
    const restored = new BrowserSitePermissions(directory, prompt);
    expect(restored.allows("https://example.com/else", "new-task")).toBe(true);
    expect(restored.allows("https://sub.example.com", "task")).toBe(false);
    restored.update({ action: "all_sites", allowed: true });
    restored.update({ action: "site", host: "example.com", decision: "block" });
    await expect(
      restored.require("https://example.com", "task", new AbortController().signal),
    ).rejects.toThrow("BROWSER_NAVIGATION_DENIED");
    expect(restored.allows("https://other.test", "task")).toBe(true);
    restored.update({ action: "site", host: "example.com", decision: "ask" });
    restored.update({ action: "all_sites", allowed: false });
    expect(restored.allows("https://example.com", "task")).toBe(false);
  });
  it("rejects stale prompt decisions after revocation or cancellation", async () => {
    const { directory } = fixture();
    let decide!: (decision: BrowserSiteDecision) => void;
    const policy = new BrowserSitePermissions(
      directory,
      () =>
        new Promise((resolve) => {
          decide = resolve;
        }),
    );
    const abort = new AbortController();
    const pending = policy.require("https://example.com", "task", abort.signal);
    policy.update({ action: "site", host: "example.com", decision: "block" });
    decide("all");
    await expect(pending).rejects.toThrow("BROWSER_NAVIGATION_DENIED");
    const cancelled = policy.require("https://another.test", "task", abort.signal);
    abort.abort();
    decide("site");
    await expect(cancelled).rejects.toThrow("BROWSER_CANCELLED");
    expect(policy.policy.allowAllSites).toBe(false);
    expect(policy.policy.allowedHosts).toEqual([]);
  });
  it("validates host boundaries and rejects credentials and non-web schemes", () => {
    const { permissions } = fixture();
    permissions.update({ action: "site", host: "EXAMPLE.COM.", decision: "allow" });
    expect(permissions.allows("https://example.com/a", "task")).toBe(true);
    expect(permissions.allows("https://example.com.evil.test", "task")).toBe(false);
    for (const value of [
      "file:///etc/passwd",
      "chrome://settings",
      "https://user:secret@example.com/",
    ])
      expect(() => browserSiteHost(value)).toThrow();
    for (const host of ["*.example.com", "example.com/a", "example.com:443", "user@example.com"])
      expect(() => permissions.update({ action: "site", host, decision: "allow" })).toThrow();
  });
});
