import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  type BrokeredBashEnvironmentPolicy,
  brokeredBashEnvironmentDigest,
  brokeredBashEnvironmentPolicyDigest,
  freezeBrokeredBashEnvironmentPolicy,
  resolveBrokeredBashEnvironment,
} from "../src";

const runtime = {
  runnerTempRoot: "/tmp/openerx-runner",
  bashExecutable: "/bin/bash",
  pathEntries: ["/usr/bin", "/bin"],
  additional: {
    OPENERX_RUNNER: "brokered-bash",
    OPENERX_WORKSPACE: ".",
    OPENERX_WORKSPACE_1: "/tmp/openerx-runner/workspaces/additional-1",
  },
};

function resolve(
  policy: BrokeredBashEnvironmentPolicy,
  hostEnvironment: NodeJS.ProcessEnv = {},
  allowAll = false,
): NodeJS.ProcessEnv {
  return resolveBrokeredBashEnvironment({
    policy,
    hostEnvironment,
    runtime,
    allowAll,
  });
}

describe("brokered Bash environment policy", () => {
  it("implements none/core with include, exclude and set precedence", () => {
    const none = resolve(
      {
        mode: "none",
        include: ["SAFE_HOST"],
        exclude: [],
        set: { FIXED: "trusted" },
      },
      { SAFE_HOST: "included", UNLISTED: "absent" },
    );
    expect(none).toEqual({
      SAFE_HOST: "included",
      FIXED: "trusted",
      OPENERX_RUNNER: "brokered-bash",
      OPENERX_WORKSPACE: ".",
      OPENERX_WORKSPACE_1: "/tmp/openerx-runner/workspaces/additional-1",
    });

    const core = resolve(
      {
        mode: "core",
        include: ["SAFE_HOST"],
        exclude: ["LANG", "SAFE_HOST"],
        set: { SAFE_HOST: "set-wins", CUSTOM: "value" },
      },
      { SAFE_HOST: "included", UNLISTED: "absent" },
    );
    expect(core).toMatchObject({
      PATH: runtime.pathEntries.join(path.delimiter),
      HOME: path.join(runtime.runnerTempRoot, "home"),
      SAFE_HOST: "set-wins",
      CUSTOM: "value",
      OPENERX_RUNNER: "brokered-bash",
    });
    expect(core).not.toHaveProperty("LANG");
    expect(core).not.toHaveProperty("UNLISTED");
  });

  it("blocks secret names and secret-like values even when included or inherited by all", () => {
    const host = {
      SAFE_VALUE: "visible",
      SSH_AUTH_SOCK: "/private/tmp/agent.sock",
      GITHUB_TOKEN: "github-canary",
      AWS_ACCESS_KEY_ID: "aws-canary",
      NPM_TOKEN: "npm-canary",
      PIP_INDEX_URL: "https://user:pass@example.invalid/simple",
      PI_SESSION_TOKEN: "pi-canary",
      HTTPS_PROXY: "http://user:pass@proxy.invalid",
      DATABASE_URL: "postgres://user:pass@db.invalid/database",
      DISGUISED: "token=secret-canary",
    };
    const included = resolve(
      { mode: "none", include: Object.keys(host), exclude: [], set: {} },
      host,
    );
    expect(included).toEqual({
      SAFE_VALUE: "visible",
      OPENERX_RUNNER: "brokered-bash",
      OPENERX_WORKSPACE: ".",
      OPENERX_WORKSPACE_1: "/tmp/openerx-runner/workspaces/additional-1",
    });

    const all = resolve({ mode: "all", include: [], exclude: [], set: {} }, host, true);
    expect(all).toEqual({
      SAFE_VALUE: "visible",
      OPENERX_RUNNER: "brokered-bash",
      OPENERX_WORKSPACE: ".",
      OPENERX_WORKSPACE_1: "/tmp/openerx-runner/workspaces/additional-1",
    });
  });

  it("rejects all outside a separately authorized danger_full_access profile", () => {
    expect(() => resolve({ mode: "all", include: [], exclude: [], set: {} })).toThrow(
      "BROKERED_BASH_ENVIRONMENT_ALL_DENIED",
    );
  });

  it("rejects secret-bearing set values and malformed variable names", () => {
    expect(() =>
      resolve({
        mode: "none",
        include: [],
        exclude: [],
        set: { SAFE: "api_key=canary" },
      }),
    ).toThrow("BROKERED_BASH_ENVIRONMENT_SECRET_BLOCKED");
    expect(() => resolve({ mode: "none", include: ["BAD-NAME"], exclude: [], set: {} })).toThrow(
      "BROKERED_BASH_ENVIRONMENT_POLICY_INVALID",
    );
  });

  it("produces an order-independent digest without logging values", () => {
    const left = brokeredBashEnvironmentDigest({ B: "two", A: "one" });
    const right = brokeredBashEnvironmentDigest({ A: "one", B: "two" });
    expect(left).toBe(right);
    expect(left).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(left).not.toContain("one");
    expect(left).not.toContain("two");
  });

  it("freezes included host values into the policy digest before execution", () => {
    const policy = {
      mode: "none" as const,
      include: ["SAFE_BUILD_FLAG", "GITHUB_TOKEN", "EXCLUDED"],
      exclude: ["EXCLUDED"],
      set: { FIXED: "trusted" },
    };
    const first = freezeBrokeredBashEnvironmentPolicy(policy, {
      SAFE_BUILD_FLAG: "first",
      GITHUB_TOKEN: "must-not-freeze",
      EXCLUDED: "must-not-freeze",
    });
    const second = freezeBrokeredBashEnvironmentPolicy(policy, {
      SAFE_BUILD_FLAG: "second",
      GITHUB_TOKEN: "must-not-freeze",
      EXCLUDED: "must-not-freeze",
    });
    expect(first).toEqual({
      mode: "none",
      include: [],
      exclude: ["EXCLUDED"],
      set: { SAFE_BUILD_FLAG: "first", FIXED: "trusted" },
    });
    expect(brokeredBashEnvironmentPolicyDigest(first)).not.toBe(
      brokeredBashEnvironmentPolicyDigest(second),
    );
  });
});
