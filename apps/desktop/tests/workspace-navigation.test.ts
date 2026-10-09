import { expect, test } from "vitest";
import {
  workspaceHomePath,
  workspaceNavigationTarget,
  workspaceSettingsSection,
} from "../src/renderer/workspace-navigation";

const enterprise = { mode: "enterprise" as const, signedIn: true, search: "" };

test.each([
  "/chat/new",
  "/search",
  "/files",
  "/automations",
  "/assistant",
  "/projects/old",
  "/unknown",
])("enterprise login reuses the existing workspace route %s", (pathname) =>
  expect(workspaceNavigationTarget({ ...enterprise, pathname })).toBeNull(),
);

test("enterprise conversation links use the original conversation page through the scoped bridge", () => {
  expect(
    workspaceNavigationTarget({ ...enterprise, pathname: "/chat/existing-record" }),
  ).toBeNull();
  expect(workspaceNavigationTarget({ ...enterprise, pathname: "/enterprise" })).toBe("/chat/new");
  expect(workspaceNavigationTarget({ ...enterprise, pathname: "/enterprise/old-entry" })).toBe(
    "/chat/new",
  );
});

test("signed-out enterprise navigation requires central login while restoration stays pending", () => {
  expect(workspaceNavigationTarget({ ...enterprise, pathname: "/chat/new", signedIn: false })).toBe(
    "/settings/account?section=extension",
  );
  expect(
    workspaceNavigationTarget({ ...enterprise, pathname: "/chat/new", signedIn: null }),
  ).toBeNull();
  expect(
    workspaceNavigationTarget({ ...enterprise, pathname: "/settings/account", justSignedIn: true }),
  ).toBe("/chat/new");
});

test("enterprise settings cannot open personal model or billing setup and keep other settings parameters", () => {
  expect(
    workspaceNavigationTarget({
      ...enterprise,
      pathname: "/settings/account",
      search: "?section=model&detail=one",
    }),
  ).toBe("/settings/account?section=enterprise&detail=one");
  expect(workspaceSettingsSection("enterprise", "assistants")).toBe("enterprise");
  expect(workspaceSettingsSection("enterprise", "memory")).toBe("enterprise");
  expect(workspaceSettingsSection("enterprise", "billing")).toBe("extension");
  expect(
    workspaceNavigationTarget({
      ...enterprise,
      pathname: "/settings/account",
      search: "?section=appearance",
    }),
  ).toBeNull();
});

test.each([
  ["?section=extension&panel=devices", "/settings/account?section=extension&panel=devices"],
  ["?section=extension&panel=data", "/settings/account?section=extension&panel=data"],
  ["?section=enterprise&target=security", "/settings/account?section=enterprise&target=security"],
  ["?section=appearance", "/settings/account?section=appearance"],
  ["?panel=devices", "/settings/account?panel=devices&section=extension"],
  ["", "/settings/account?section=extension"],
])("legacy enterprise settings entry retains its destination %s", (search, expected) => {
  for (const signedIn of [true, false]) {
    expect(
      workspaceNavigationTarget({ ...enterprise, signedIn, pathname: "/settings", search }),
    ).toBe(expected);
  }
});

test.each([
  "/chat/new",
  "/chat/existing",
  "/search",
  "/files",
  "/automations",
  "/settings/account",
])("the personal edition retains its existing %s navigation", (pathname) =>
  expect(workspaceNavigationTarget({ ...enterprise, mode: "personal", pathname })).toBeNull(),
);

test("edition home and model settings stay explicit", () => {
  expect(workspaceHomePath("enterprise")).toBe("/chat/new");
  expect(workspaceHomePath("personal")).toBe("/chat/new");
  expect(workspaceSettingsSection("personal", "model")).toBe("model");
});
